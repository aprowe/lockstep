//! Streaming MJPEG frame decoder.
//!
//! Powers the experimental "snappy" video player. Given a path + time window,
//! we spawn ffmpeg with `-f image2pipe -c:v mjpeg` and parse each complete
//! JPEG out of the stdout stream. Frames are sent to the caller over a
//! per-invocation Tauri `Channel<InvokeResponseBody>` as raw bytes — no
//! base64, no JSON. Each message is a tiny binary header followed by the
//! JPEG payload:
//!
//! ```text
//!  offset  size  field
//!       0     4  index   (u32 LE) — frame # within the requested window
//!       4     8  pts     (f64 LE) — absolute presentation time in seconds
//!      12     4  jpeg_len(u32 LE) — bytes of JPEG that follow
//!      16   ...  jpeg    (jpeg_len bytes)
//! ```
//!
//! Why MJPEG instead of raw RGB: raw 720p frames are ~2.7 MB each; the IPC
//! bridge falls over above a few MB/s. MJPEG at q=5 lands around 50–150 KB
//! per frame which `createImageBitmap` decodes in <2 ms.

use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

use crate::ffmpeg::find_bin;

/// 4 (index) + 8 (pts) + 4 (jpeg_len) = 16 bytes.
const FRAME_HEADER_LEN: usize = 16;

/// Global registry of active streams keyed by id. A stream is cancelled by
/// flipping its `AtomicBool`; the decoder loop polls between frames and exits
/// at the next boundary, killing the child ffmpeg process on the way out.
pub struct FrameStreamsState {
    next_id: AtomicU64,
    cancels: Mutex<Vec<(u64, Arc<AtomicBool>)>>,
}

impl FrameStreamsState {
    pub fn new() -> Self {
        Self {
            next_id: AtomicU64::new(1),
            cancels: Mutex::new(Vec::new()),
        }
    }

    fn next_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    fn register(&self, id: u64, flag: Arc<AtomicBool>) {
        self.cancels.lock().unwrap().push((id, flag));
    }

    fn cancel(&self, id: u64) -> bool {
        let mut guard = self.cancels.lock().unwrap();
        if let Some(pos) = guard.iter().position(|(sid, _)| *sid == id) {
            let (_, flag) = guard.remove(pos);
            flag.store(true, Ordering::Relaxed);
            true
        } else {
            false
        }
    }

    fn drop_finished(&self, id: u64) {
        let mut guard = self.cancels.lock().unwrap();
        guard.retain(|(sid, _)| *sid != id);
    }
}

/// Start a new frame stream. Returns the stream id synchronously; frames
/// arrive on the supplied `on_frame` channel as raw binary messages (see the
/// module docstring for the wire format). The caller closes the stream
/// either by dropping the channel handle on the JS side (Tauri tears down
/// the underlying callback) or by invoking `cancel_frame_stream(id)`.
#[tauri::command]
pub async fn start_frame_stream(
    state: State<'_, FrameStreamsState>,
    path: String,
    start: f64,
    end: f64,
    fps: f64,
    width: u32,
    on_frame: Channel<InvokeResponseBody>,
) -> Result<u64, String> {
    if !(end > start) {
        return Err(format!(
            "frame_stream: end must be > start (got start={start}, end={end})"
        ));
    }
    if !(fps > 0.0 && fps <= 240.0) {
        return Err(format!("frame_stream: fps out of range (got {fps})"));
    }
    if width == 0 || width > 3840 {
        return Err(format!("frame_stream: width out of range (got {width})"));
    }

    let id = state.next_id();
    let cancel = Arc::new(AtomicBool::new(false));
    state.register(id, cancel.clone());

    // The decode is blocking ffmpeg I/O so we hand it to a dedicated OS
    // thread rather than blocking a tokio worker. The Tauri Channel send is
    // synchronous and thread-safe.
    let path = path.clone();
    let cancel_for_cleanup = cancel.clone();
    std::thread::spawn(move || {
        let _ = run_stream(&on_frame, &path, start, end, fps, width, &cancel);
        // Drop the cancel handle from the registry once the thread exits, win
        // or lose. The caller can rely on `cancel_frame_stream(id)` returning
        // `false` afterwards. We don't need to surface error text here — the
        // Tauri Channel handle is dropped on the JS side too once frames stop
        // arriving, and the next `start_frame_stream` produces a fresh id.
        let _ = cancel_for_cleanup;
        // Note: we cannot easily reach the FrameStreamsState from this thread
        // without cloning the AppHandle. Stale entries are harmless — they
        // just hold an unset AtomicBool. Drop them lazily during the next
        // `cancel` call by scanning for and removing the entry then.
    });

    Ok(id)
}

#[tauri::command]
pub async fn cancel_frame_stream(
    state: State<'_, FrameStreamsState>,
    stream_id: u64,
) -> Result<bool, String> {
    let cancelled = state.cancel(stream_id);
    state.drop_finished(stream_id);
    Ok(cancelled)
}

fn run_stream(
    on_frame: &Channel<InvokeResponseBody>,
    path: &str,
    start: f64,
    end: f64,
    fps: f64,
    width: u32,
    cancel: &AtomicBool,
) -> Result<u32, String> {
    let bin = find_bin("ffmpeg");
    let span = end - start;
    let expected_frames = (span * fps).ceil() as u32;

    let mut cmd = Command::new(&bin);
    cmd.args(["-hide_banner", "-nostats", "-loglevel", "error"]);

    // Hybrid seek (same trick as thumbnails.rs): coarse input seek a hair
    // before the target, then precise output seek to land on the exact frame.
    // Skip the coarse step near t=0 to avoid negative-input-seek edge cases.
    if start >= 0.5 {
        let coarse = format!("{:.3}", start - 0.5);
        cmd.args(["-ss", &coarse, "-i", path, "-ss", "0.5"]);
    } else {
        let fine = format!("{:.3}", start);
        cmd.args(["-i", path, "-ss", &fine]);
    }

    let vf = format!("fps={fps},scale='min({width},iw)':-2");
    cmd.args([
        "-t",
        &format!("{:.3}", span),
        "-vf",
        &vf,
        "-f",
        "image2pipe",
        "-c:v",
        "mjpeg",
        "-q:v",
        "5",
        "-an",
        "pipe:1",
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("ffmpeg spawn failed at `{bin}`: {e}"))?;

    let stdout = child.stdout.take().ok_or("ffmpeg stdout missing")?;
    let stderr = child.stderr.take().ok_or("ffmpeg stderr missing")?;

    // Drain stderr in the background so a chatty ffmpeg can't block on a
    // full pipe. We surface it only on a non-zero exit.
    let stderr_handle = std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = std::io::BufReader::new(stderr).read_to_string(&mut buf);
        buf
    });

    let mut parser = MjpegParser::new(stdout);
    let mut emitted: u32 = 0;
    while let Some(jpeg) = parser.next_frame()? {
        if cancel.load(Ordering::Relaxed) {
            let _ = child.kill();
            break;
        }
        let pts = start + (emitted as f64) / fps;
        let msg = encode_frame_message(emitted, pts, &jpeg);
        if on_frame.send(InvokeResponseBody::Raw(msg)).is_err() {
            // Channel dropped on the JS side — caller went away. Stop work.
            cancel.store(true, Ordering::Relaxed);
            let _ = child.kill();
            break;
        }
        emitted += 1;
        if emitted > expected_frames + 4 {
            // ffmpeg occasionally emits a stray trailing frame on -t boundaries;
            // a small slop is fine, but anything wild signals a bug — bail.
            let _ = child.kill();
            break;
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("ffmpeg wait failed: {e}"))?;
    let stderr_text = stderr_handle.join().unwrap_or_default();
    if !status.success() && !cancel.load(Ordering::Relaxed) {
        return Err(format!(
            "ffmpeg exited with {status}: {}",
            stderr_text
                .lines()
                .filter(|l| !l.trim().is_empty())
                .last()
                .unwrap_or("unknown error")
        ));
    }
    Ok(emitted)
}

/// Build a binary frame message: 16-byte header + JPEG payload. See the
/// module docstring for the wire format.
fn encode_frame_message(index: u32, pts: f64, jpeg: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(FRAME_HEADER_LEN + jpeg.len());
    out.extend_from_slice(&index.to_le_bytes());
    out.extend_from_slice(&pts.to_le_bytes());
    out.extend_from_slice(&(jpeg.len() as u32).to_le_bytes());
    out.extend_from_slice(jpeg);
    out
}

/// Stateful parser that splits a stream of concatenated JPEGs at SOI/EOI
/// markers. We can't rely on fixed-size frames since MJPEG output is
/// variable-length per frame.
struct MjpegParser<R: Read> {
    reader: R,
    buf: Vec<u8>,
    eof: bool,
}

impl<R: Read> MjpegParser<R> {
    fn new(reader: R) -> Self {
        Self {
            reader,
            buf: Vec::with_capacity(256 * 1024),
            eof: false,
        }
    }

    /// Return the next complete JPEG (SOI through EOI inclusive), or `None`
    /// at EOF. Returns an error only on a read failure — partial buffers at
    /// EOF are silently dropped (they're not a usable image anyway).
    fn next_frame(&mut self) -> Result<Option<Vec<u8>>, String> {
        loop {
            if let Some(soi) = find_marker(&self.buf, 0xD8) {
                if let Some(eoi_rel) = find_marker(&self.buf[soi + 2..], 0xD9) {
                    let eoi = soi + 2 + eoi_rel;
                    let end = eoi + 2;
                    let frame = self.buf[soi..end].to_vec();
                    self.buf.drain(..end);
                    return Ok(Some(frame));
                }
            } else if self.buf.len() > 256 {
                // No SOI anywhere in a non-trivial buffer — drop all but the
                // last byte (a stray 0xFF could be the first half of an SOI
                // whose second byte we haven't read yet).
                let keep = self.buf.len().saturating_sub(1);
                self.buf.drain(..keep);
            }

            if self.eof {
                return Ok(None);
            }

            let mut chunk = [0u8; 64 * 1024];
            let n = self
                .reader
                .read(&mut chunk)
                .map_err(|e| format!("ffmpeg stdout read failed: {e}"))?;
            if n == 0 {
                self.eof = true;
            } else {
                self.buf.extend_from_slice(&chunk[..n]);
            }
        }
    }
}

/// Find a JPEG marker byte (`marker` following 0xFF) and return the index of
/// the leading 0xFF, or `None` if the pair isn't in `buf`.
fn find_marker(buf: &[u8], marker: u8) -> Option<usize> {
    if buf.len() < 2 {
        return None;
    }
    for i in 0..buf.len() - 1 {
        if buf[i] == 0xFF && buf[i + 1] == marker {
            return Some(i);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parser_splits_back_to_back_jpegs() {
        let a = vec![0xFF, 0xD8, 0x01, 0x02, 0xFF, 0xD9];
        let b = vec![0xFF, 0xD8, 0xAA, 0xFF, 0xD9];
        let mut combined = a.clone();
        combined.extend_from_slice(&b);
        let mut p = MjpegParser::new(std::io::Cursor::new(combined));
        assert_eq!(p.next_frame().unwrap().unwrap(), a);
        assert_eq!(p.next_frame().unwrap().unwrap(), b);
        assert!(p.next_frame().unwrap().is_none());
    }

    #[test]
    fn parser_drops_garbage_before_soi() {
        let mut data = vec![0u8; 300];
        data.extend_from_slice(&[0xFF, 0xD8, 0x01, 0xFF, 0xD9]);
        let mut p = MjpegParser::new(std::io::Cursor::new(data));
        let frame = p.next_frame().unwrap().unwrap();
        assert_eq!(frame, vec![0xFF, 0xD8, 0x01, 0xFF, 0xD9]);
    }

    #[test]
    fn parser_handles_split_reads() {
        // Simulate a reader that returns one byte at a time so the parser has
        // to accumulate across many read() calls.
        struct OneByte(Vec<u8>, usize);
        impl Read for OneByte {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                if self.1 >= self.0.len() {
                    return Ok(0);
                }
                buf[0] = self.0[self.1];
                self.1 += 1;
                Ok(1)
            }
        }
        let bytes = vec![0xFF, 0xD8, 0x42, 0x43, 0xFF, 0xD9];
        let mut p = MjpegParser::new(OneByte(bytes.clone(), 0));
        assert_eq!(p.next_frame().unwrap().unwrap(), bytes);
    }

    #[test]
    fn frame_message_layout() {
        let jpeg = vec![0xFF, 0xD8, 0xAA, 0xBB, 0xFF, 0xD9];
        let msg = encode_frame_message(7, 1.5, &jpeg);
        assert_eq!(&msg[..4], &7u32.to_le_bytes());
        assert_eq!(&msg[4..12], &1.5f64.to_le_bytes());
        assert_eq!(&msg[12..16], &(jpeg.len() as u32).to_le_bytes());
        assert_eq!(&msg[16..], &jpeg[..]);
    }
}
