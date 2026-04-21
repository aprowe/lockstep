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
const PLAYHEAD_WINDOW: i64 = 15;
const VIEWPORT_SAMPLES: i64 = 40;

#[derive(Clone, Default, Debug)]
struct PriorityContext {
    playhead_frame: i64,
    region_frames: Vec<(i64, i64)>,
    marker_frames: Vec<i64>,
    scene_frames: Vec<i64>,
    /// Dense frame requests from UI features (e.g. the thumbnail strip track).
    /// Ranked above viewport-fill but below scene/region/marker so user-placed
    /// points still get thumbnails first.
    strip_frames: Vec<i64>,
    viewport_frames: (i64, i64),
    /// Hover preview frames — the frames under the user's cursor on the
    /// timeline. Lowest priority on purpose: workers only get to these when
    /// literally everything else is already satisfied.
    hover_frames: Vec<i64>,
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

/// Score any frame by which tier of interest it falls into. Lower = higher
/// priority. Tiers (in order): playhead window → marker → region boundary →
/// region interior → scene marker → viewport → nothing.
///
/// Used for both computation (by `candidate_frames` generating seed points in
/// these tiers) and retention (by `evict_overflow` scoring ready frames so the
/// least-wanted ones are dropped first). Keeping both paths on the same tier
/// scale means a fully thumbnailed region won't get wiped so a random outside
/// frame can stay.
fn frame_priority(ctx: &PriorityContext, frame: i64) -> f64 {
    let ph = ctx.playhead_frame;
    let dist_ph = (frame - ph).abs() as f64;
    let tiebreak = dist_ph * 0.0001;

    if (frame - ph).abs() <= PLAYHEAD_WINDOW {
        return dist_ph * 0.1;
    }

    for &m in &ctx.marker_frames {
        if (frame - m).abs() <= 1 {
            return 5.0 + tiebreak;
        }
    }

    for &(in_f, out_f) in &ctx.region_frames {
        if frame >= in_f && frame <= out_f {
            if (frame - in_f).abs() <= 1 || (frame - out_f).abs() <= 1 {
                return 10.0 + tiebreak;
            }
            return 20.0 + tiebreak;
        }
    }

    for &s in &ctx.scene_frames {
        if (frame - s).abs() <= 1 {
            return 30.0 + tiebreak;
        }
    }

    for &s in &ctx.strip_frames {
        if (frame - s).abs() <= 1 {
            return 50.0 + tiebreak;
        }
    }

    let (vs, ve) = ctx.viewport_frames;
    if frame >= vs && frame <= ve {
        return 100.0 + tiebreak;
    }

    for &h in &ctx.hover_frames {
        if (frame - h).abs() <= 1 {
            return 500.0 + tiebreak;
        }
    }

    1000.0 + tiebreak
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

    // Strip frames — dense grid requested by UI feature like the thumbnail
    // strip track. Ranked below scenes but above viewport fill.
    for &f in &ctx.strip_frames {
        let f = clamp(f);
        out.push((f, 50.0 + (f - ph).abs() as f64 * 0.0001));
    }

    // Viewport samples — background fill.
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

    // Hover frames — absolute-lowest real tier. Workers only pull these when
    // nothing higher-priority is pending.
    for &f in &ctx.hover_frames {
        let f = clamp(f);
        out.push((f, 500.0 + (f - ph).abs() as f64 * 0.0001));
    }

    // Dedupe by frame, keeping the lowest score.
    out.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal)));
    out.dedup_by_key(|x| x.0);
    out.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
    out
}

/// Pick the next frame to extract, if any. Must be called with the state lock held.
///
/// When the cache is full, we only pick frames whose score beats the worst
/// cached frame — otherwise `evict_overflow` would immediately drop the frame
/// we just extracted, and the next scheduler pass would pick it again. That's
/// an infinite thrash: the symptom is "N pending, cache full, workers busy
/// forever, no progress".
fn pick_next(st: &VideoState) -> Option<i64> {
    let cache_full = st.ready.len() + st.in_flight.len() >= st.max_cached_frames;
    let worst_cached_score: Option<f64> = if cache_full {
        st.ready
            .iter()
            .map(|&f| frame_priority(&st.context, f))
            .fold(None::<f64>, |acc, s| Some(acc.map_or(s, |a| a.max(s))))
    } else {
        None
    };

    for (f, score) in candidate_frames(&st.context, st.max_frame) {
        if st.ready.contains(&f) || st.in_flight.contains(&f) {
            continue;
        }
        if let Some(worst) = worst_cached_score {
            // Strict `>=` so ties also skip — a tied frame would self-evict
            // 50% of the time (HashSet iteration order is non-deterministic).
            if score >= worst {
                continue;
            }
        }
        return Some(f);
    }
    None
}

/// Try to evict ready frames to stay under the per-video cache cap. Scores
/// each ready frame with the same tier logic that drives extraction, so a
/// frame inside a region beats a random outside frame even if the outside one
/// is closer to the playhead.
fn evict_overflow(st: &mut VideoState) {
    if st.ready.len() <= st.max_cached_frames {
        return;
    }
    let mut scored: Vec<(i64, f64)> = st
        .ready
        .iter()
        .map(|&f| (f, frame_priority(&st.context, f)))
        .collect();
    // Highest score first — those are the least wanted, so drop them first.
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let excess = st.ready.len() - st.max_cached_frames;
    for (f, _) in scored.into_iter().take(excess) {
        let p = thumb_path(&st.cache_dir, f);
        let _ = std::fs::remove_file(&p);
        st.ready.remove(&f);
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
                return;
            };
            st.in_flight.insert(frame);
            st.workers_running += 1;
            let video_path = st.video_path.clone();
            let fps = st.fps;
            let width = st.thumb_width;
            let playhead = st.context.playhead_frame;
            let out_path = thumb_path(&st.cache_dir, frame);
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
            region_frames: req.region_frames,
            marker_frames: req.marker_frames,
            scene_frames: req.scene_frames,
            strip_frames: req.strip_frames,
            viewport_frames: req.viewport_frames,
            hover_frames: req.hover_frames,
        };
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

fn tier_name(score: f64) -> &'static str {
    if score < 5.0 { "playhead" }
    else if score < 10.0 { "markers" }
    else if score < 20.0 { "region_edges" }
    else if score < 30.0 { "region_interior" }
    else if score < 50.0 { "scenes" }
    else if score < 100.0 { "strip" }
    else if score < 500.0 { "viewport" }
    else if score < 1000.0 { "hover" }
    else { "other" }
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
    let cands = candidate_frames(&st.context, st.max_frame);

    let order = [
        "playhead", "markers", "region_edges", "region_interior",
        "scenes", "strip", "viewport", "hover", "other",
    ];
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

    #[test]
    fn frame_priority_tiers_order_correctly() {
        // Playhead at 0, region [500, 600], viewport [0, 10000]. Frame 550
        // (inside region, far from playhead) should outrank frame 2000 (just
        // in viewport, also far from playhead).
        let ctx = PriorityContext {
            playhead_frame: 0,
            region_frames: vec![(500, 600)],
            viewport_frames: (0, 10000),
            ..Default::default()
        };
        let in_region = frame_priority(&ctx, 550);
        let outside_region = frame_priority(&ctx, 2000);
        assert!(
            in_region < outside_region,
            "region frame ({in_region}) should outrank viewport-only frame ({outside_region})"
        );
        // And a frame outside everything is worst of all.
        let ctx_no_vp = PriorityContext {
            playhead_frame: 0,
            region_frames: vec![(500, 600)],
            viewport_frames: (0, 100),
            ..Default::default()
        };
        let nowhere = frame_priority(&ctx_no_vp, 5000);
        assert!(nowhere > 500.0);
    }

    #[test]
    fn pick_next_skips_frames_that_would_self_evict() {
        // Cache is full; every pending candidate scores worse than everything
        // already cached. Extracting any of them would just evict themselves
        // on the next `evict_overflow` pass — that's the thrash bug.
        //
        // Setup: ctx has 4 scene cuts. Playhead-window candidates (around
        // frame 0) and the first 3 scenes are already in `ready`. The only
        // candidate left is scene #4, which scores worse than scene #3.
        let ctx = PriorityContext {
            playhead_frame: 0,
            scene_frames: vec![100, 200, 300, 400],
            ..Default::default()
        };
        let mut ready: HashSet<i64> = (0..=15).collect(); // playhead window
        for &f in &[100i64, 200, 300] {
            ready.insert(f);
        }
        let st = VideoState {
            video_path: "x".to_string(),
            fps: 30.0,
            max_frame: 1000,
            cache_dir: PathBuf::from("."),
            ready,
            in_flight: HashSet::new(),
            context: ctx,
            workers_running: 0,
            thumb_width: 120,
            max_cached_frames: 19, // == ready.len(), so cache is full
        };
        assert_eq!(pick_next(&st), None, "must not thrash on full cache");
    }

    #[test]
    fn pick_next_accepts_strictly_better_frame_when_full() {
        // Cache is full of scene-tier frames (score ~30). A marker-tier
        // candidate (~5) shows up — it's strictly better than the worst
        // cached, so it should win even though the cache is full.
        let ctx = PriorityContext {
            playhead_frame: 0,
            marker_frames: vec![50],
            scene_frames: vec![100, 200, 300],
            ..Default::default()
        };
        let mut ready: HashSet<i64> = (0..=15).collect();
        for &f in &[100i64, 200, 300] {
            ready.insert(f);
        }
        let st = VideoState {
            video_path: "x".to_string(),
            fps: 30.0,
            max_frame: 1000,
            cache_dir: PathBuf::from("."),
            ready,
            in_flight: HashSet::new(),
            context: ctx,
            workers_running: 0,
            thumb_width: 120,
            max_cached_frames: 19,
        };
        assert_eq!(pick_next(&st), Some(50));
    }

    #[test]
    fn eviction_prefers_dropping_outside_frames() {
        // Build a context where some ready frames are inside a region and
        // others are nowhere. The outside ones must be evicted first, even
        // though some of them are closer to the playhead.
        let ctx = PriorityContext {
            playhead_frame: 1000,
            region_frames: vec![(2000, 2100)],
            viewport_frames: (0, 3000),
            ..Default::default()
        };
        // Score a frame inside the region vs an outside frame *closer to*
        // the playhead. The region frame should still win.
        let inside = frame_priority(&ctx, 2050);
        let closer_outside = frame_priority(&ctx, 1500);
        assert!(
            inside < closer_outside,
            "region-interior ({inside}) should beat closer viewport-only ({closer_outside})"
        );
    }
}
