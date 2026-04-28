//! Shot-cut detection via ffmpeg's `scdet` filter.
//!
//! Runs a single-pass ffmpeg invocation with `-vf scdet=t=<threshold>` and
//! parses the `lavfi.scd.time: <seconds>` lines the filter writes to stderr.
//! No video is re-encoded — the output is routed to the null muxer so the
//! filter only has to do decode + frame-diff work.

use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// Windows process priority class. Lets foreground apps win the CPU without
/// fully starving scene detection (IDLE_PRIORITY_CLASS can take forever on
/// a busy system).
#[cfg(target_os = "windows")]
const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;

use crate::ffmpeg::find_bin;

/// Default scdet threshold. Higher = fewer, more confident cuts.
/// 10 is ffmpeg's documented default and matches typical cut detection needs.
pub const DEFAULT_THRESHOLD: f64 = 10.0;

/// Half-open scan window in source-time seconds. When `Some`, ffmpeg seeks to
/// `start` before opening the demuxer and reads through `end`; cut times
/// emitted by `scdet` are then in window-relative seconds and the caller
/// shifts them back into source time. `None` (the default) scans the full
/// file from t=0.
#[derive(Clone, Copy, Debug)]
pub struct ScanWindow {
    pub start: f64,
    pub end: f64,
}

/// Run scene-cut detection and return cut times in seconds, sorted ascending.
///
/// `on_progress` receives a rough 0.0–1.0 progress fraction as ffmpeg streams
/// `time=HH:MM:SS.xx` status lines; it's called best-effort and may not fire
/// if the duration is unknown. `on_cut` fires once per detected cut (in the
/// order ffmpeg reports them) so callers can stream results to the UI.
///
/// `window` constrains the scan to a sub-range of the file; when `Some`,
/// returned cut times are in absolute (source-time) seconds.
///
/// If `cancel` flips to true, the running ffmpeg child is killed and the
/// function returns `Err("cancelled")`. ffmpeg is spawned at
/// BELOW_NORMAL priority on Windows so a long analysis doesn't fight the
/// foreground UI for CPU.
pub fn detect_cuts<F, G>(
    video_path: &str,
    threshold: f64,
    duration: Option<f64>,
    window: Option<ScanWindow>,
    mut on_progress: F,
    mut on_cut: G,
    cancel: Arc<AtomicBool>,
) -> Result<Vec<f64>, String>
where
    F: FnMut(f64),
    G: FnMut(f64),
{
    let filter = format!("scdet=t={threshold}");
    let mut cmd = Command::new(find_bin("ffmpeg"));
    cmd.arg("-hide_banner").arg("-nostats");
    // `-ss <start>` *before* `-i` is the fast path — ffmpeg seeks the demuxer
    // to roughly the requested timestamp, then keyframe-aligns. `-t <length>`
    // (output-side) bounds the read window. We deliberately use `-t` instead
    // of `-to` so the value is a duration (window-relative), independent of
    // the input seek. Cut times emitted by scdet are then relative to the
    // demuxer's seek point; we add `start` back below.
    let window_offset = window.map(|w| w.start.max(0.0)).unwrap_or(0.0);
    let start_str;
    let length_str;
    if let Some(w) = window {
        if w.start > 0.0 {
            start_str = format!("{:.3}", w.start.max(0.0));
            cmd.arg("-ss").arg(&start_str);
        }
        let length = (w.end - w.start).max(0.0);
        if length > 0.0 {
            length_str = format!("{:.3}", length);
            cmd.arg("-t").arg(&length_str);
        }
    }
    cmd.arg("-i").arg(video_path);
    cmd.args(["-vf", &filter, "-an", "-f", "null", "-"]);
    cmd.stdout(Stdio::null()).stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS);

    let mut child = cmd.spawn().map_err(|e| format!("ffmpeg spawn failed: {e}"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "ffmpeg stderr unavailable".to_string())?;
    let reader = BufReader::new(stderr);

    let mut cuts: Vec<f64> = Vec::new();
    let mut tail: Vec<String> = Vec::with_capacity(8);
    let mut cancelled = false;

    for line in reader.lines().map_while(Result::ok) {
        if cancel.load(Ordering::Relaxed) {
            let _ = child.kill();
            cancelled = true;
            break;
        }
        // Keep a small rolling tail for error reporting.
        if tail.len() == 8 {
            tail.remove(0);
        }
        tail.push(line.clone());

        if let Some(t) = parse_cut_time(&line) {
            // scdet reports times relative to the demuxer's seek point. When
            // a window is set, shift back into source-time so callers and the
            // UI see absolute cut positions.
            let absolute = t + window_offset;
            cuts.push(absolute);
            on_cut(absolute);
        } else if let (Some(t), Some(dur)) = (parse_progress_time(&line), duration) {
            // Progress is also seek-relative; report it as a fraction of the
            // window when one is set, otherwise as a fraction of the file.
            let span = window
                .map(|w| (w.end - w.start).max(0.0))
                .filter(|s| *s > 0.0)
                .unwrap_or(dur);
            if span > 0.0 {
                on_progress((t / span).clamp(0.0, 1.0));
            }
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("ffmpeg wait failed: {e}"))?;
    if cancelled {
        return Err("cancelled".to_string());
    }
    if !status.success() {
        return Err(format!("ffmpeg scdet failed: {}", tail.join(" | ")));
    }

    cuts.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    cuts.dedup_by(|a, b| (*a - *b).abs() < 1e-3);
    Ok(cuts)
}

/// Parse the timestamp out of an `scdet` stderr line, e.g.
/// `[scdet @ 0x...] lavfi.scd.score: 12.34, lavfi.scd.mafd: 5.67, lavfi.scd.time: 2.5`.
fn parse_cut_time(line: &str) -> Option<f64> {
    let key = "lavfi.scd.time:";
    let idx = line.find(key)?;
    let rest = line[idx + key.len()..].trim_start();
    let end = rest
        .find(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-' || c == '+' || c == 'e' || c == 'E'))
        .unwrap_or(rest.len());
    rest[..end].parse::<f64>().ok()
}

/// Parse the `time=HH:MM:SS.xx` field from ffmpeg's periodic status lines.
fn parse_progress_time(line: &str) -> Option<f64> {
    let key = "time=";
    let idx = line.find(key)?;
    let rest = &line[idx + key.len()..];
    let end = rest.find(' ').unwrap_or(rest.len());
    let stamp = &rest[..end];
    let parts: Vec<&str> = stamp.split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let h: f64 = parts[0].parse().ok()?;
    let m: f64 = parts[1].parse().ok()?;
    let s: f64 = parts[2].parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_scdet_time_line() {
        let line = "[scdet @ 0x7fa] lavfi.scd.score: 12.34, lavfi.scd.mafd: 5.67, lavfi.scd.time: 2.5";
        assert_eq!(parse_cut_time(line), Some(2.5));
    }

    #[test]
    fn parses_scdet_time_at_end_of_line() {
        let line = "[scdet @ 0x7fa] lavfi.scd.time: 17.625";
        assert_eq!(parse_cut_time(line), Some(17.625));
    }

    #[test]
    fn returns_none_for_unrelated_lines() {
        assert_eq!(parse_cut_time("frame= 120 fps=30 time=00:00:04.00"), None);
        assert_eq!(parse_cut_time(""), None);
    }

    #[test]
    fn parses_progress_time_hms() {
        let line = "frame= 600 fps=30 q=-0.0 size=N/A time=00:01:23.45 bitrate=N/A speed=5.2x";
        let t = parse_progress_time(line).unwrap();
        assert!((t - (60.0 + 23.45)).abs() < 1e-6, "got {t}");
    }

    #[test]
    fn progress_time_returns_none_when_absent() {
        assert_eq!(parse_progress_time("[scdet @ 0x7fa] lavfi.scd.time: 1.0"), None);
    }
}
