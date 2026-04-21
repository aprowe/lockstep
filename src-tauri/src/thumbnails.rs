//! Background thumbnail pipeline.
//!
//! A per-video priority queue of frames that the UI wants to display. A small
//! pool of ffmpeg workers pulls the highest-priority unrendered frame, extracts
//! it with a hybrid input/output seek, writes it to the app's thumbnail cache,
//! and emits `thumbnail-ready` so the frontend can load it from disk.
//!
//! Current (simplified) priority = proximity to playhead + LRU eviction keyed
//! on when the playhead was last near a given frame. The tier-based scoring
//! for markers/regions/scenes/viewport is commented out below — leave the
//! request fields intact so the frontend keeps compiling, but the backend
//! ignores everything except `playhead_frame`.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Manager, Runtime};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// Windows process priority class. Background thumb workers run at
/// BELOW_NORMAL so a long queue can't fight the UI / scene detection /
/// foreground apps for CPU. Playhead-window frames keep normal priority
/// because the user is waiting on them right now.
#[cfg(target_os = "windows")]
const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;

use crate::ffmpeg::find_bin;

const MAX_WORKERS: u32 = 3;
const DEFAULT_MAX_CACHED_FRAMES: usize = 2000;
const DEFAULT_THUMB_WIDTH: u32 = 120;
/// Window (in frames, each side of playhead) where extraction runs at
/// normal Windows priority instead of BELOW_NORMAL.
const PLAYHEAD_WINDOW: i64 = 15;
/// How far around the playhead to generate candidate frames. Kept well
/// below `max_cached_frames` so the other half of the cache retains
/// "recently seen" history instead of getting evicted by fresh candidates
/// — that was the root cause of the worker-spin-forever bug.
fn candidate_window(max_cached: usize) -> i64 {
    ((max_cached as i64) / 4).clamp(60, 400)
}
// const VIEWPORT_SAMPLES: i64 = 40;
// const RECENT_PLAYHEAD_HISTORY: usize = 4;

#[derive(Clone, Default, Debug)]
struct PriorityContext {
    playhead_frame: i64,
    // Tier signals are currently unused — simplified to playhead-only + LRU.
    // Kept so the frontend request shape + tests still compile.
    #[allow(dead_code)] recent_playheads: Vec<i64>,
    #[allow(dead_code)] region_frames: Vec<(i64, i64)>,
    #[allow(dead_code)] marker_frames: Vec<i64>,
    #[allow(dead_code)] scene_frames: Vec<i64>,
    #[allow(dead_code)] strip_frames: Vec<i64>,
    #[allow(dead_code)] viewport_frames: (i64, i64),
    #[allow(dead_code)] hover_frames: Vec<i64>,
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
    thumb_width: u32,
    max_cached_frames: usize,
    /// LRU tracking. Monotonic counter bumped every priority update + on
    /// each new ready frame. `frame_touched[f]` is the value it had the
    /// last time the playhead was within candidate_window of `f`.
    frame_touched: HashMap<i64, u64>,
    touch_counter: u64,
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
    #[serde(default)]
    pub strip_frames: Vec<i64>,
    #[serde(default)]
    pub hover_frames: Vec<i64>,
    pub viewport_frames: (i64, i64),
    /// Output width for extracted thumbnails. Changing this invalidates the
    /// existing cache for this video (entries at a different size get wiped).
    #[serde(default)]
    pub thumb_width: Option<u32>,
    /// Maximum number of cached frames per video before LRU-style eviction
    /// kicks in.
    #[serde(default)]
    pub max_cached_frames: Option<usize>,
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

/// Score any frame by distance to the playhead (lower = higher priority).
///
/// Simplified from the old tier-based scoring (markers / regions / scenes /
/// viewport). Bring those back by restoring the code below the early return
/// if we want tier-aware priority again.
fn frame_priority(ctx: &PriorityContext, frame: i64) -> f64 {
    (frame - ctx.playhead_frame).abs() as f64

    // --- disabled tier logic, kept for reference ---
    // let ph = ctx.playhead_frame;
    // let dist_ph = (frame - ph).abs() as f64;
    // let tiebreak = dist_ph * 0.0001;
    // if (frame - ph).abs() <= PLAYHEAD_WINDOW { return dist_ph * 0.1; }
    // for &m in &ctx.marker_frames {
    //     if (frame - m).abs() <= 1 { return 5.0 + tiebreak; }
    // }
    // for &(in_f, out_f) in &ctx.region_frames {
    //     if frame >= in_f && frame <= out_f {
    //         if (frame - in_f).abs() <= 1 || (frame - out_f).abs() <= 1 {
    //             return 10.0 + tiebreak;
    //         }
    //         return 20.0 + tiebreak;
    //     }
    // }
    // for &s in &ctx.scene_frames {
    //     if (frame - s).abs() <= 1 { return 30.0 + tiebreak; }
    // }
    // for &s in &ctx.strip_frames {
    //     if (frame - s).abs() <= 1 { return 50.0 + tiebreak; }
    // }
    // let (vs, ve) = ctx.viewport_frames;
    // if frame >= vs && frame <= ve { return 100.0 + tiebreak; }
    // for &h in &ctx.hover_frames {
    //     if (frame - h).abs() <= 1 { return 500.0 + tiebreak; }
    // }
    // 1000.0 + tiebreak
}

/// Candidate frames = everything within ±candidate_window(max_cached) of the
/// playhead, sorted by distance (closest first).
fn candidate_frames(ctx: &PriorityContext, max_frame: i64, max_cached: usize) -> Vec<(i64, f64)> {
    let ph = ctx.playhead_frame;
    let win = candidate_window(max_cached);
    let lo = (ph - win).max(0);
    let hi = (ph + win).min(max_frame);
    if hi < lo { return Vec::new(); }
    let mut out: Vec<(i64, f64)> = (lo..=hi)
        .map(|f| (f, (f - ph).abs() as f64))
        .collect();
    out.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
    out
}

/// Pick the next frame to extract — closest to the playhead that isn't
/// already cached or in flight. With LRU eviction + touching-on-extract,
/// a newly extracted frame is always MRU, so self-evict thrashing can't
/// happen: no need for the old cache-full score guard.
fn pick_next(st: &VideoState) -> Option<i64> {
    for (f, _) in candidate_frames(&st.context, st.max_frame, st.max_cached_frames) {
        if st.ready.contains(&f) || st.in_flight.contains(&f) { continue; }
        return Some(f);
    }
    None
}

/// Evict ready frames to stay under the per-video cache cap. LRU: drop the
/// frames that haven't been near the playhead for the longest. Ties broken
/// by distance to the current playhead (drop farther first) so eviction is
/// deterministic even on a fresh cache where nothing's touched yet.
fn evict_overflow(st: &mut VideoState) {
    if st.ready.len() <= st.max_cached_frames {
        return;
    }
    let ph = st.context.playhead_frame;
    let mut scored: Vec<(i64, u64, i64)> = st
        .ready
        .iter()
        .map(|&f| (f, *st.frame_touched.get(&f).unwrap_or(&0), (f - ph).abs()))
        .collect();
    // Oldest touch first; if tied, farther from playhead first.
    scored.sort_by(|a, b| a.1.cmp(&b.1).then(b.2.cmp(&a.2)));
    let excess = st.ready.len() - st.max_cached_frames;
    let dropped: Vec<i64> = scored.iter().take(excess).map(|(f, _, _)| *f).collect();
    for (f, _, _) in scored.into_iter().take(excess) {
        let p = thumb_path(&st.cache_dir, f);
        let _ = std::fs::remove_file(&p);
        st.ready.remove(&f);
        st.frame_touched.remove(&f);
    }
    eprintln!(
        "[thumb] evict {} frame(s): {:?}{}",
        dropped.len(),
        &dropped[..dropped.len().min(8)],
        if dropped.len() > 8 { " …" } else { "" },
    );
}

/// Mark every ready frame within the candidate window as "just used".
/// Called on every priority update so frames near the moving playhead
/// keep getting their LRU timestamps refreshed.
fn touch_near_playhead(st: &mut VideoState) {
    st.touch_counter += 1;
    let t = st.touch_counter;
    let ph = st.context.playhead_frame;
    let win = candidate_window(st.max_cached_frames);
    for &f in st.ready.iter() {
        if (f - ph).abs() <= win {
            st.frame_touched.insert(f, t);
        }
    }
}

/// Wipe every cached thumbnail + in-memory tracking for this video. Called
/// when the requested thumb width changes, since existing files are at the
/// wrong resolution.
fn purge_video_cache(st: &mut VideoState) {
    if let Ok(entries) = std::fs::read_dir(&st.cache_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |e| e == "jpg") {
                let _ = std::fs::remove_file(&path);
            }
        }
    }
    st.ready.clear();
    st.frame_touched.clear();
}

fn frame_to_time(frame: i64, fps: f64) -> f64 {
    // ffmpeg's output seek keeps the first frame whose pts >= seek_time and
    // drops earlier ones. Frame N has pts = N/fps, so we need to seek to
    // *just before* that — overshooting by even a fraction lands us on frame
    // N+1 (off-by-one). Half a frame duration earlier is a safe margin.
    ((frame as f64 - 0.5) / fps).max(0.0)
}

fn extract_frame(
    video_path: &str,
    time: f64,
    out_path: &PathBuf,
    width: u32,
    high_priority: bool,
) -> Result<(), String> {
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
        &format!("scale={width}:-2"),
        "-q:v",
        "5",
        "-y",
        &out_str,
    ])
    .stdout(Stdio::null())
    .stderr(Stdio::piped());

    // Dev-time tracing: one line per extraction so we can see the worker loop
    // in the terminal and spot repeat-offender frames (thrashing symptom).
    let pri = if high_priority { "HIGH" } else { "low " };
    eprintln!(
        "[thumb] {pri} extract t={time:.3}s w={width} -> {}",
        out_path.file_name().and_then(|s| s.to_str()).unwrap_or("?")
    );

    // Background thumb workers run at BELOW_NORMAL so a long queue can't fight
    // the UI thread / scene detection for CPU. Playhead-window frames keep
    // normal priority because the user is waiting on them right now.
    #[cfg(target_os = "windows")]
    {
        let flags = if high_priority {
            CREATE_NO_WINDOW
        } else {
            CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS
        };
        cmd.creation_flags(flags);
    }

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
                eprintln!(
                    "[thumb] idle ready={} in_flight={} workers={} cap={}",
                    st.ready.len(),
                    st.in_flight.len(),
                    st.workers_running,
                    st.max_cached_frames,
                );
                return;
            };
            st.in_flight.insert(frame);
            st.workers_running += 1;
            let video_path = st.video_path.clone();
            let fps = st.fps;
            let width = st.thumb_width;
            let playhead = st.context.playhead_frame;
            let out_path = thumb_path(&st.cache_dir, frame);
            eprintln!(
                "[thumb] pick frame={} ready={} in_flight={} workers={}",
                frame,
                st.ready.len(),
                st.in_flight.len(),
                st.workers_running,
            );
            Some((frame, video_path, fps, width, playhead, out_path))
        };

        let Some((frame, video_path, fps, width, playhead, out_path)) = next else {
            return;
        };

        let app2 = app.clone();
        let entry2 = entry.clone();
        let file_hash2 = file_hash.clone();

        tokio::spawn(async move {
            let time = frame_to_time(frame, fps);
            let out_for_task = out_path.clone();
            // Only frames the user is actively watching run at normal priority.
            // Everything else yields to the foreground UI + other workloads.
            let high_priority = (frame - playhead).abs() <= PLAYHEAD_WINDOW;
            let result = tokio::task::spawn_blocking(move || {
                extract_frame(&video_path, time, &out_for_task, width, high_priority)
            })
            .await;

            let success = matches!(result, Ok(Ok(())));

            {
                let mut st = entry2.lock().unwrap();
                st.workers_running = st.workers_running.saturating_sub(1);
                st.in_flight.remove(&frame);
                if success {
                    st.ready.insert(frame);
                    // Freshly extracted frames are MRU by definition — seed
                    // their touch counter so LRU eviction won't immediately
                    // drop them on the same pass.
                    st.touch_counter += 1;
                    let t = st.touch_counter;
                    st.frame_touched.insert(frame, t);
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

    let thumb_width = req.thumb_width.unwrap_or(DEFAULT_THUMB_WIDTH).max(16);
    let max_cached_frames = req
        .max_cached_frames
        .unwrap_or(DEFAULT_MAX_CACHED_FRAMES)
        .max(16);

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
                    thumb_width,
                    max_cached_frames,
                    frame_touched: HashMap::new(),
                    touch_counter: 0,
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
        // Thumb width change invalidates on-disk cache — wipe it so workers
        // regenerate at the new size.
        if st.thumb_width != thumb_width {
            st.thumb_width = thumb_width;
            purge_video_cache(&mut st);
        }
        st.max_cached_frames = max_cached_frames;
        st.context = PriorityContext {
            playhead_frame: req.playhead_frame,
            // Tier signals received but unused — LRU scoring ignores them.
            recent_playheads: Vec::new(),
            region_frames: req.region_frames,
            marker_frames: req.marker_frames,
            scene_frames: req.scene_frames,
            strip_frames: req.strip_frames,
            viewport_frames: req.viewport_frames,
            hover_frames: req.hover_frames,
        };
        // Refresh LRU timestamps for cached frames near the new playhead,
        // then evict oldest first to make room for whatever's queued.
        touch_near_playhead(&mut st);
        evict_overflow(&mut st);
    }

    schedule(app, req.file_hash, entry);
    Ok(())
}

#[derive(serde::Serialize)]
pub struct QueueTierStats {
    pub name: String,
    pub total: usize,
    pub ready: usize,
    pub in_flight: usize,
    pub pending: usize,
}

#[derive(serde::Serialize)]
pub struct QueueStats {
    pub file_hash: String,
    pub workers_running: u32,
    pub total_ready: usize,
    pub total_in_flight: usize,
    pub max_cached_frames: usize,
    pub max_frame: i64,
    pub tiers: Vec<QueueTierStats>,
}

/// Score → tier label. Scoring is now plain distance-to-playhead, so the
/// former marker/region/scene/viewport tiers don't apply. Buckets are
/// distance bands instead.
fn tier_name(score: f64) -> &'static str {
    let d = score as i64;
    if d <= PLAYHEAD_WINDOW { "playhead" }
    else if d <= 120 { "near" }        // ~4s @ 30fps
    else if d <= 600 { "mid" }         // ~20s @ 30fps
    else { "far" }
}

#[tauri::command]
pub async fn get_thumbnail_queue_stats(
    state: tauri::State<'_, ThumbnailsState>,
    file_hash: String,
) -> Result<Option<QueueStats>, String> {
    let entry = {
        let reg = state.0.lock().unwrap();
        match reg.videos.get(&file_hash) {
            Some(e) => e.clone(),
            None => return Ok(None),
        }
    };
    let st = entry.lock().unwrap();
    let cands = candidate_frames(&st.context, st.max_frame, st.max_cached_frames);

    let order = ["playhead", "near", "mid", "far"];
    let mut by_name: std::collections::HashMap<&'static str, QueueTierStats> =
        std::collections::HashMap::new();
    for name in order.iter() {
        by_name.insert(*name, QueueTierStats {
            name: (*name).to_string(),
            total: 0, ready: 0, in_flight: 0, pending: 0,
        });
    }
    for (f, score) in &cands {
        let name = tier_name(*score);
        let t = by_name.get_mut(name).unwrap();
        t.total += 1;
        if st.ready.contains(f) {
            t.ready += 1;
        } else if st.in_flight.contains(f) {
            t.in_flight += 1;
        } else {
            t.pending += 1;
        }
    }
    let tiers: Vec<QueueTierStats> = order
        .iter()
        .map(|n| by_name.remove(*n).unwrap())
        .collect();

    Ok(Some(QueueStats {
        file_hash: file_hash.clone(),
        workers_running: st.workers_running,
        total_ready: st.ready.len(),
        total_in_flight: st.in_flight.len(),
        max_cached_frames: st.max_cached_frames,
        max_frame: st.max_frame,
        tiers,
    }))
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

#[tauri::command]
pub async fn clear_all_thumbnails<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, ThumbnailsState>,
) -> Result<(), String> {
    {
        let mut reg = state.0.lock().unwrap();
        reg.videos.clear();
    }
    let root = thumbnails_root(&app)?;
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_state(playhead: i64, ready: HashSet<i64>, cap: usize) -> VideoState {
        VideoState {
            video_path: "x".to_string(),
            fps: 30.0,
            max_frame: 1_000_000,
            cache_dir: PathBuf::from("."),
            ready,
            in_flight: HashSet::new(),
            context: PriorityContext { playhead_frame: playhead, ..Default::default() },
            workers_running: 0,
            thumb_width: 120,
            max_cached_frames: cap,
            frame_touched: HashMap::new(),
            touch_counter: 0,
        }
    }

    #[test]
    fn playhead_window_is_highest_priority() {
        let ctx = PriorityContext {
            playhead_frame: 100,
            marker_frames: vec![50],
            scene_frames: vec![200],
            region_frames: vec![(300, 400)],
            viewport_frames: (0, 1000),
            ..Default::default()
        };
        let cands = candidate_frames(&ctx, 1000, 200);
        // First candidate should be the playhead itself.
        assert_eq!(cands[0].0, 100);
        // Frames right next to the playhead come before far-away markers.
        let ph_window: Vec<i64> = cands.iter().take(8).map(|(f, _)| *f).collect();
        assert!(ph_window.contains(&99));
        assert!(ph_window.contains(&101));
    }

    #[test]
    fn candidates_respect_max_frame() {
        let ctx = PriorityContext { playhead_frame: 5, ..Default::default() };
        let cands = candidate_frames(&ctx, 10, 200);
        for (f, _) in &cands {
            assert!(*f >= 0 && *f <= 10, "frame {f} out of [0,10]");
        }
    }

    #[test]
    fn pick_next_returns_closest_uncached() {
        // Playhead at 500. Frames 495-505 already cached. Expect the closest
        // uncached neighbour (494 or 506, either is distance 6).
        let ready: HashSet<i64> = (495..=505).collect();
        let st = make_state(500, ready, 100);
        let picked = pick_next(&st).unwrap();
        assert!(
            (picked - 500).abs() == 6,
            "expected closest uncached (dist 6), got {picked}"
        );
    }

    #[test]
    fn evict_overflow_drops_oldest_touched_first() {
        // Four cached frames, all same distance to playhead (none). Touch
        // counters differ — evict_overflow should drop the one with the
        // lowest counter.
        let ready: HashSet<i64> = [100i64, 200, 300, 400].into_iter().collect();
        let mut st = make_state(250, ready, 3);
        st.frame_touched.insert(100, 1);
        st.frame_touched.insert(200, 4);
        st.frame_touched.insert(300, 3);
        st.frame_touched.insert(400, 2);
        evict_overflow(&mut st);
        assert_eq!(st.ready.len(), 3);
        assert!(!st.ready.contains(&100), "frame 100 (oldest) should be gone");
    }

    #[test]
    fn evict_overflow_tiebreak_drops_farther() {
        // All frames tied on touch counter (fresh cache). Tiebreak should
        // prefer dropping the one farther from the playhead.
        let ready: HashSet<i64> = [450i64, 900].into_iter().collect();
        let mut st = make_state(500, ready, 1);
        // Both untouched => both default to 0; farther wins tiebreak.
        evict_overflow(&mut st);
        assert_eq!(st.ready.len(), 1);
        assert!(st.ready.contains(&450), "closer frame (dist 50) should survive");
    }

    #[test]
    fn touch_near_playhead_refreshes_only_in_window() {
        let ready: HashSet<i64> = [500i64, 5_000_000].into_iter().collect();
        let mut st = make_state(500, ready, 1000);
        touch_near_playhead(&mut st);
        let t_near = st.frame_touched.get(&500).copied().unwrap_or(0);
        let t_far = st.frame_touched.get(&5_000_000).copied().unwrap_or(0);
        assert!(t_near > 0);
        assert_eq!(t_far, 0, "frame outside candidate_window should not be touched");
    }
}
