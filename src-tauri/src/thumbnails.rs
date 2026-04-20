//! Background thumbnail pipeline.
//!
//! A per-video priority queue of frames that the UI wants to display. A small
//! pool of ffmpeg workers pulls the highest-priority unrendered frame, extracts
//! it with a hybrid input/output seek, writes it to the app's thumbnail cache,
//! and emits `thumbnail-ready` so the frontend can load it from disk.
//!
//! The frontend calls `set_thumbnail_priority` whenever the playhead, markers,
//! regions, scenes, or viewport move. That replaces the priority context for
//! that file; anything already in-flight continues, anything queued but not
//! started is effectively re-prioritized on the next scheduler pass.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Manager, Runtime};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

use crate::ffmpeg::find_bin;

const MAX_WORKERS: u32 = 3;
const MAX_CACHED_FRAMES: usize = 2000;
const THUMB_WIDTH: u32 = 120;
const PLAYHEAD_WINDOW: i64 = 15;
const VIEWPORT_SAMPLES: i64 = 40;

#[derive(Clone, Default, Debug)]
struct PriorityContext {
    playhead_frame: i64,
    region_frames: Vec<(i64, i64)>,
    marker_frames: Vec<i64>,
    scene_frames: Vec<i64>,
    viewport_frames: (i64, i64),
}

struct VideoState {
    video_path: String,
    fps: f64,
    max_frame: i64,
    cache_dir: PathBuf,
    ready: HashSet<i64>,
    in_flight: HashSet<i64>,
    context: PriorityContext,
    workers_running: u32,
}

#[derive(Default)]
pub struct Registry {
    videos: HashMap<String, Arc<Mutex<VideoState>>>,
}

pub struct ThumbnailsState(pub Arc<Mutex<Registry>>);

impl ThumbnailsState {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(Registry::default())))
    }
}

#[derive(serde::Deserialize)]
pub struct PriorityRequest {
    pub file_hash: String,
    pub video_path: String,
    pub fps: f64,
    pub duration: f64,
    pub playhead_frame: i64,
    #[serde(default)]
    pub region_frames: Vec<(i64, i64)>,
    #[serde(default)]
    pub marker_frames: Vec<i64>,
    #[serde(default)]
    pub scene_frames: Vec<i64>,
    pub viewport_frames: (i64, i64),
}

fn thumbnails_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("thumbnails");
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root)
}

fn cache_dir_for<R: Runtime>(app: &AppHandle<R>, file_hash: &str) -> Result<PathBuf, String> {
    if !file_hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("invalid file hash".to_string());
    }
    let dir = thumbnails_root(app)?.join(file_hash);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn thumb_path(cache_dir: &PathBuf, frame: i64) -> PathBuf {
    cache_dir.join(format!("{frame:08}.jpg"))
}

fn scan_ready(cache_dir: &PathBuf) -> HashSet<i64> {
    let mut out = HashSet::new();
    if let Ok(entries) = std::fs::read_dir(cache_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |e| e == "jpg") {
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    if let Ok(frame) = stem.parse::<i64>() {
                        out.insert(frame);
                    }
                }
            }
        }
    }
    out
}

/// Compute the set of frames worth having, each with a score (lower = higher
/// priority). The candidate list is intentionally small — a few hundred frames
/// at most — so the scheduler can sort on every kick without cost.
fn candidate_frames(ctx: &PriorityContext, max_frame: i64) -> Vec<(i64, f64)> {
    let mut out: Vec<(i64, f64)> = Vec::new();
    let clamp = |f: i64| f.clamp(0, max_frame);
    let ph = ctx.playhead_frame;

    // Playhead window — immediate neighbors rank before anything else.
    for offset in 0..=PLAYHEAD_WINDOW {
        for sign in [1i64, -1i64] {
            if offset == 0 && sign == -1 {
                continue;
            }
            let f = ph + sign * offset;
            if f < 0 || f > max_frame {
                continue;
            }
            out.push((f, offset as f64 * 0.1));
        }
    }

    // Markers — user-placed, so just after the playhead window.
    for &f in &ctx.marker_frames {
        let f = clamp(f);
        out.push((f, 5.0 + (f - ph).abs() as f64 * 0.0001));
    }

    // Region boundaries + sparse interior samples.
    for &(in_f, out_f) in &ctx.region_frames {
        let in_f = clamp(in_f);
        let out_f = clamp(out_f);
        if out_f <= in_f {
            continue;
        }
        out.push((in_f, 10.0));
        out.push((out_f, 10.0));
        let step = ((out_f - in_f) / 10).max(1);
        let mut f = in_f;
        while f < out_f {
            out.push((f, 20.0));
            f += step;
        }
    }

    // Scene markers.
    for &f in &ctx.scene_frames {
        let f = clamp(f);
        out.push((f, 30.0 + (f - ph).abs() as f64 * 0.0001));
    }

    // Viewport samples — lowest priority, background fill.
    let (vs, ve) = ctx.viewport_frames;
    let vs = clamp(vs);
    let ve = clamp(ve);
    if ve > vs {
        let step = ((ve - vs) / VIEWPORT_SAMPLES).max(1);
        let mut f = vs;
        while f < ve {
            out.push((f, 100.0));
            f += step;
        }
    }

    // Dedupe by frame, keeping the lowest score.
    out.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal)));
    out.dedup_by_key(|x| x.0);
    out.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
    out
}

/// Pick the next frame to extract, if any. Must be called with the state lock held.
fn pick_next(st: &VideoState) -> Option<i64> {
    for (f, _) in candidate_frames(&st.context, st.max_frame) {
        if !st.ready.contains(&f) && !st.in_flight.contains(&f) {
            return Some(f);
        }
    }
    None
}

/// Try to evict ready frames to stay under MAX_CACHED_FRAMES. Drops frames
/// with the lowest priority under the current context — i.e. those furthest
/// from anything the user cares about.
fn evict_overflow(st: &mut VideoState) {
    if st.ready.len() <= MAX_CACHED_FRAMES {
        return;
    }
    let ph = st.context.playhead_frame;
    let mut scored: Vec<(i64, f64)> = st
        .ready
        .iter()
        .map(|&f| (f, (f - ph).abs() as f64))
        .collect();
    // Largest distance first — those are the first to go.
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let excess = st.ready.len() - MAX_CACHED_FRAMES;
    for (f, _) in scored.into_iter().take(excess) {
        let p = thumb_path(&st.cache_dir, f);
        let _ = std::fs::remove_file(&p);
        st.ready.remove(&f);
    }
}

fn frame_to_time(frame: i64, fps: f64) -> f64 {
    (frame as f64 / fps).max(0.0)
}

fn extract_frame(video_path: &str, time: f64, out_path: &PathBuf) -> Result<(), String> {
    let bin = find_bin("ffmpeg");
    let out_str = out_path.to_string_lossy().to_string();
    let mut cmd = Command::new(&bin);
    cmd.args(["-hide_banner", "-nostats", "-loglevel", "error"]);

    // Hybrid seek: coarse input seek up to 0.5s before target, then precise
    // output seek to the exact frame. For t < 0.5s we skip the coarse step.
    if time >= 0.5 {
        let coarse = format!("{:.3}", time - 0.5);
        cmd.args(["-ss", &coarse, "-i", video_path, "-ss", "0.5"]);
    } else {
        let fine = format!("{:.3}", time);
        cmd.args(["-i", video_path, "-ss", &fine]);
    }

    cmd.args([
        "-frames:v",
        "1",
        "-vf",
        &format!("scale={THUMB_WIDTH}:-2"),
        "-q:v",
        "5",
        "-y",
        &out_str,
    ])
    .stdout(Stdio::null())
    .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd
        .output()
        .map_err(|e| format!("ffmpeg spawn failed at `{bin}`: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "ffmpeg thumbnail failed: {}",
            String::from_utf8_lossy(&output.stderr)
                .lines()
                .filter(|l| !l.trim().is_empty())
                .last()
                .unwrap_or("unknown error")
        ));
    }
    if !out_path.exists() {
        return Err("ffmpeg produced no thumbnail".to_string());
    }
    Ok(())
}

/// Top up worker slots until we hit MAX_WORKERS or run out of candidates.
fn schedule<R: Runtime>(
    app: AppHandle<R>,
    file_hash: String,
    entry: Arc<Mutex<VideoState>>,
) {
    loop {
        let next = {
            let mut st = entry.lock().unwrap();
            if st.workers_running >= MAX_WORKERS {
                return;
            }
            let Some(frame) = pick_next(&st) else {
                return;
            };
            st.in_flight.insert(frame);
            st.workers_running += 1;
            let video_path = st.video_path.clone();
            let fps = st.fps;
            let out_path = thumb_path(&st.cache_dir, frame);
            Some((frame, video_path, fps, out_path))
        };

        let Some((frame, video_path, fps, out_path)) = next else {
            return;
        };

        let app2 = app.clone();
        let entry2 = entry.clone();
        let file_hash2 = file_hash.clone();

        tokio::spawn(async move {
            let time = frame_to_time(frame, fps);
            let out_for_task = out_path.clone();
            let result = tokio::task::spawn_blocking(move || {
                extract_frame(&video_path, time, &out_for_task)
            })
            .await;

            let success = matches!(result, Ok(Ok(())));

            {
                let mut st = entry2.lock().unwrap();
                st.workers_running = st.workers_running.saturating_sub(1);
                st.in_flight.remove(&frame);
                if success {
                    st.ready.insert(frame);
                    evict_overflow(&mut st);
                }
            }

            if success {
                let _ = app2.emit(
                    "thumbnail-ready",
                    serde_json::json!({
                        "file_hash": &file_hash2,
                        "frame": frame,
                        "path": out_path.to_string_lossy().to_string(),
                    }),
                );
            }

            schedule(app2, file_hash2, entry2);
        });
    }
}

#[tauri::command]
pub async fn set_thumbnail_priority<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, ThumbnailsState>,
    req: PriorityRequest,
) -> Result<(), String> {
    if req.fps <= 0.0 || req.duration <= 0.0 {
        return Err("invalid fps/duration".to_string());
    }
    let max_frame = (req.duration * req.fps).floor() as i64;
    let cache_dir = cache_dir_for(&app, &req.file_hash)?;

    let entry = {
        let mut reg = state.0.lock().unwrap();
        reg.videos
            .entry(req.file_hash.clone())
            .or_insert_with(|| {
                let ready = scan_ready(&cache_dir);
                Arc::new(Mutex::new(VideoState {
                    video_path: req.video_path.clone(),
                    fps: req.fps,
                    max_frame,
                    cache_dir: cache_dir.clone(),
                    ready,
                    in_flight: HashSet::new(),
                    context: PriorityContext::default(),
                    workers_running: 0,
                }))
            })
            .clone()
    };

    {
        let mut st = entry.lock().unwrap();
        // The path/fps can change if a file is replaced on disk without the
        // hash changing (rare, but keep the latest).
        st.video_path = req.video_path;
        st.fps = req.fps;
        st.max_frame = max_frame;
        st.context = PriorityContext {
            playhead_frame: req.playhead_frame,
            region_frames: req.region_frames,
            marker_frames: req.marker_frames,
            scene_frames: req.scene_frames,
            viewport_frames: req.viewport_frames,
        };
    }

    schedule(app, req.file_hash, entry);
    Ok(())
}

#[tauri::command]
pub async fn get_thumbnail_path<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, ThumbnailsState>,
    file_hash: String,
    frame: i64,
) -> Result<Option<String>, String> {
    let is_ready = {
        let reg = state.0.lock().unwrap();
        reg.videos
            .get(&file_hash)
            .map(|entry| entry.lock().unwrap().ready.contains(&frame))
            .unwrap_or(false)
    };
    if !is_ready {
        // Fall back to disk (registry may not have been warmed for this hash yet).
        let dir = cache_dir_for(&app, &file_hash)?;
        let path = thumb_path(&dir, frame);
        if path.exists() {
            return Ok(Some(path.to_string_lossy().to_string()));
        }
        return Ok(None);
    }
    let dir = cache_dir_for(&app, &file_hash)?;
    let path = thumb_path(&dir, frame);
    Ok(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn clear_thumbnails<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, ThumbnailsState>,
    file_hash: String,
) -> Result<(), String> {
    {
        let mut reg = state.0.lock().unwrap();
        reg.videos.remove(&file_hash);
    }
    let dir = cache_dir_for(&app, &file_hash)?;
    let _ = std::fs::remove_dir_all(&dir);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn playhead_window_is_highest_priority() {
        let ctx = PriorityContext {
            playhead_frame: 100,
            marker_frames: vec![50],
            scene_frames: vec![200],
            region_frames: vec![(300, 400)],
            viewport_frames: (0, 1000),
        };
        let cands = candidate_frames(&ctx, 1000);
        // First candidate should be the playhead itself.
        assert_eq!(cands[0].0, 100);
        // Frames right next to the playhead come before far-away markers.
        let ph_window: Vec<i64> = cands.iter().take(8).map(|(f, _)| *f).collect();
        assert!(ph_window.contains(&99));
        assert!(ph_window.contains(&101));
    }

    #[test]
    fn dedupe_keeps_best_score() {
        let ctx = PriorityContext {
            playhead_frame: 100,
            marker_frames: vec![100],
            ..Default::default()
        };
        let cands = candidate_frames(&ctx, 1000);
        let hits: Vec<_> = cands.iter().filter(|(f, _)| *f == 100).collect();
        assert_eq!(hits.len(), 1);
        // Score 0.0 from the playhead beats 5.0 from the marker.
        assert!(hits[0].1 < 1.0);
    }

    #[test]
    fn candidates_respect_max_frame() {
        let ctx = PriorityContext {
            playhead_frame: 5,
            ..Default::default()
        };
        let cands = candidate_frames(&ctx, 10);
        for (f, _) in &cands {
            assert!(*f >= 0 && *f <= 10, "frame {f} out of [0,10]");
        }
    }
}
