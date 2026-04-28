//! Background thumbnail pipeline.
//!
//! A per-video priority queue of frames that the UI wants to display. A small
//! pool of ffmpeg workers pulls the highest-priority unrendered frame, extracts
//! it with a hybrid input/output seek, writes it to the app's thumbnail cache,
//! and emits `thumbnail-ready` so the frontend can load it from disk.
//!
//! Scoring follows `docs/THUMBNAIL_CACHE_DESIGN.md`: a small required window
//! around the playhead is hard-mandatory; beyond that, a weighted score
//! (distance + recency + marker proximity) picks what to extract next and
//! what to evict. "Markers" here = user anchors ∪ scene cuts.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Instant;

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
/// normal Windows priority instead of BELOW_NORMAL. Decoupled from the
/// scoring `REQ_RADIUS` — process priority is a CPU hint, not cache policy.
const PLAYHEAD_WINDOW: i64 = 15;

// ── Scoring tiers ──────────────────────────────────────────────────────────
//
// Each tier's base outranks the next tier's max so a higher-tier candidate
// always beats a lower-tier one regardless of recency. Sub-ordering happens
// inside each band:
//   T1  Playhead radius — gradient closer = higher
//   T2  At-marker frames — sub-ordered by playhead proximity, then viewport
//   T3  Marker neighborhoods — softer falloff
//   +   Recency adds within whatever tier the frame falls in
//
// REQ_RADIUS is also the hard-protected eviction window — frames inside it
// are never dropped and `pick_next` scans them outward before scoring.
const REQ_RADIUS: i64 = 8;

const T_PLAYHEAD_BASE: f64 = 1000.0;
const T_PLAYHEAD_GRADIENT: f64 = 100.0;

const T_MARKER_BASE: f64 = 100.0;
const T_MARKER_PLAYHEAD: f64 = 50.0;
const T_MARKER_VIEWPORT: f64 = 25.0;

const T_NEAR_MARKER: f64 = 10.0;

const T_RECENCY: f64 = 5.0;

/// Falloff (in frames) for the playhead-proximity term that orders markers
/// in T2: at one DIST_FALLOFF the bonus drops to ~37% of its peak.
const DIST_FALLOFF: f64 = 90.0;
/// Falloff for the marker-neighborhood term in T3.
const MARK_RADIUS: f64 = 72.0;
const REC_TAU_SECS: f64 = 99.0;
/// 2× the falloff covers ~86% of the exponential mass; frames beyond that
/// carry negligible neighborhood weight, so we don't seed them as candidates.
const MARK_CANDIDATE_REACH: i64 = (MARK_RADIUS as i64) * 2;

#[derive(Clone, Default, Debug)]
struct PriorityContext {
    playhead_frame: i64,
    /// Scoring markers = user anchors ∪ filtered scene cuts. MUST be sorted
    /// — `frame_score` uses binary_search to test "is f a marker?".
    markers: Vec<i64>,
    /// (start, end) viewport frames. Markers inside this range get a T2 bonus
    /// so off-playhead-but-on-screen scenes outrank far-from-screen scenes.
    viewport_frames: (i64, i64),
    #[allow(dead_code)] recent_playheads: Vec<i64>,
    #[allow(dead_code)] region_frames: Vec<(i64, i64)>,
    #[allow(dead_code)] strip_frames: Vec<i64>,
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
    /// Wall-clock last-touch time per cached frame. Feeds the recency term
    /// in `frame_score`. Absent = never touched (age → ∞, recency = 0).
    frame_touched_at: HashMap<i64, Instant>,
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

/// Scoring function — higher = higher priority. See the tier comment block
/// at the top of this file for the design.
///
/// The required window is *also* enforced as a hard preference in `pick_next`
/// (outward scan) and `evict_overflow` (radius frames are never dropped) so
/// even ties / float fuzz can't bump T1 frames to the back.
fn frame_score(ctx: &PriorityContext, frame: i64, age_secs: f64) -> f64 {
    let recency = (-age_secs / REC_TAU_SECS).exp();
    let recency_term = T_RECENCY * recency;

    let d_playhead = (frame - ctx.playhead_frame).abs();

    if d_playhead <= REQ_RADIUS {
        // T1 — playhead radius. Closer wins via a linear gradient so the
        // exact-playhead frame always edges out its neighbours, and so on.
        let closeness = 1.0 - (d_playhead as f64) / (REQ_RADIUS as f64);
        return T_PLAYHEAD_BASE + T_PLAYHEAD_GRADIENT * closeness + recency_term;
    }

    // Cheap binary_search relies on `markers` being sorted in
    // `set_thumbnail_priority`.
    let is_marker = ctx.markers.binary_search(&frame).is_ok();
    if is_marker {
        // T2 — at a marker (user anchor or filtered scene cut). Sub-order:
        // playhead-near markers first, then in-viewport, then everywhere else.
        let prox = (-(d_playhead as f64) / DIST_FALLOFF).exp();
        let (vp_lo, vp_hi) = ctx.viewport_frames;
        let in_vp = if frame >= vp_lo && frame <= vp_hi { 1.0 } else { 0.0 };
        return T_MARKER_BASE
            + T_MARKER_PLAYHEAD * prox
            + T_MARKER_VIEWPORT * in_vp
            + recency_term;
    }

    // T3 — in the neighborhood of some marker. Soft falloff to the nearest
    // marker; a frame far from every marker scores ≈ recency_term alone.
    let mark_prox = ctx.markers.iter().fold(0.0_f64, |acc, &m| {
        acc.max((-((frame - m).abs() as f64) / MARK_RADIUS).exp())
    });
    T_NEAR_MARKER * mark_prox + recency_term
}

fn required_window(ph: i64, max_frame: i64) -> std::ops::RangeInclusive<i64> {
    (ph - REQ_RADIUS).max(0)..=(ph + REQ_RADIUS).min(max_frame)
}

fn age_secs(frame_touched_at: &HashMap<i64, Instant>, frame: i64, now: Instant) -> f64 {
    frame_touched_at
        .get(&frame)
        .map(|t| now.saturating_duration_since(*t).as_secs_f64())
        .unwrap_or(f64::INFINITY)
}

/// Candidate set = required window ∪ marker neighborhoods ∪ already-cached.
/// Returned as (frame, score) pairs, unsorted — callers sort as needed.
fn candidate_frames(st: &VideoState) -> Vec<(i64, f64)> {
    let ctx = &st.context;
    let ph = ctx.playhead_frame;
    let max_frame = st.max_frame;
    let mut set: HashSet<i64> = HashSet::new();

    for f in required_window(ph, max_frame) {
        set.insert(f);
    }
    for &m in &ctx.markers {
        let lo = (m - MARK_CANDIDATE_REACH).max(0);
        let hi = (m + MARK_CANDIDATE_REACH).min(max_frame);
        for f in lo..=hi {
            set.insert(f);
        }
    }
    for &f in &st.ready {
        set.insert(f);
    }

    let now = Instant::now();
    set.into_iter()
        .map(|f| (f, frame_score(ctx, f, age_secs(&st.frame_touched_at, f, now))))
        .collect()
}

/// Pick the next frame to extract. Required-window frames always win if any
/// aren't cached; otherwise, the highest-scoring candidate within the top-K
/// (where K = cache capacity) that isn't ready or in flight.
fn pick_next(st: &VideoState) -> Option<i64> {
    let ph = st.context.playhead_frame;
    // Scan required window outward so frames at the playhead get picked
    // before their neighbours.
    for r in 0..=REQ_RADIUS {
        for &offset in &[-r, r] {
            let f = ph + offset;
            if f < 0 || f > st.max_frame { continue; }
            if !st.ready.contains(&f) && !st.in_flight.contains(&f) {
                return Some(f);
            }
        }
    }
    let mut cands = candidate_frames(st);
    cands.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    cands.truncate(st.max_cached_frames);
    cands.into_iter()
        .find(|(f, _)| !st.ready.contains(f) && !st.in_flight.contains(f))
        .map(|(f, _)| f)
}

/// Evict ready frames to stay under the per-video cache cap. Drops the
/// lowest-scoring frames first; required-window frames are preserved.
fn evict_overflow(st: &mut VideoState) {
    if st.ready.len() <= st.max_cached_frames {
        return;
    }
    let ph = st.context.playhead_frame;
    let now = Instant::now();
    let mut scored: Vec<(i64, f64)> = st
        .ready
        .iter()
        .filter(|&&f| (f - ph).abs() > REQ_RADIUS)
        .map(|&f| (f, frame_score(&st.context, f, age_secs(&st.frame_touched_at, f, now))))
        .collect();
    scored.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
    let excess = st.ready.len() - st.max_cached_frames;
    for (f, _) in scored.into_iter().take(excess) {
        let p = thumb_path(&st.cache_dir, f);
        let _ = std::fs::remove_file(&p);
        st.ready.remove(&f);
        st.frame_touched_at.remove(&f);
    }
}

/// Stamp the required-window cached frames as "just used" — recency term
/// decays for everything else. The sandbox found narrow touch (≈ playhead)
/// beats wider touch bands.
fn touch_near_playhead(st: &mut VideoState) {
    let now = Instant::now();
    for f in required_window(st.context.playhead_frame, st.max_frame) {
        if st.ready.contains(&f) {
            st.frame_touched_at.insert(f, now);
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
    st.frame_touched_at.clear();
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
                    // Freshly extracted frames are MRU by definition — stamp
                    // them so the recency term starts at 1.0 instead of 0.
                    st.frame_touched_at.insert(frame, Instant::now());
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
                    frame_touched_at: HashMap::new(),
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
        // Scoring treats user anchors + scene cuts as a single marker set —
        // both are "places the user is likely to jump to." Dedup so a cut
        // that also has a user anchor doesn't get double weight.
        let mut markers = req.marker_frames.clone();
        markers.extend(req.scene_frames.iter().copied());
        markers.sort_unstable();
        markers.dedup();
        st.context = PriorityContext {
            playhead_frame: req.playhead_frame,
            markers,
            recent_playheads: Vec::new(),
            region_frames: req.region_frames,
            strip_frames: req.strip_frames,
            viewport_frames: req.viewport_frames,
            hover_frames: req.hover_frames,
        };
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

/// Bucket a candidate frame for stats reporting. Mirrors the scoring tiers:
/// required (T1 / playhead radius), marker (T2 / at a marker), neighborhood
/// (T3 / near a marker), recent (recency carries it), cold (low-score carry).
fn tier_name(ctx: &PriorityContext, max_frame: i64, frame: i64, age: f64) -> &'static str {
    let ph = ctx.playhead_frame;
    if (frame - ph).abs() <= REQ_RADIUS && frame >= 0 && frame <= max_frame {
        return "required";
    }
    if ctx.markers.binary_search(&frame).is_ok() {
        return "marker";
    }
    let mark = ctx.markers.iter().fold(0.0_f64, |acc, &m| {
        acc.max((-((frame - m).abs() as f64) / MARK_RADIUS).exp())
    });
    if T_NEAR_MARKER * mark >= 0.5 { return "neighborhood"; }
    let rec = (-age / REC_TAU_SECS).exp();
    if T_RECENCY * rec >= 0.5 { return "recent"; }
    "cold"
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
    let cands = candidate_frames(&st);
    let now = Instant::now();

    let order = ["required", "marker", "neighborhood", "recent", "cold"];
    let mut by_name: std::collections::HashMap<&'static str, QueueTierStats> =
        std::collections::HashMap::new();
    for name in order.iter() {
        by_name.insert(*name, QueueTierStats {
            name: (*name).to_string(),
            total: 0, ready: 0, in_flight: 0, pending: 0,
        });
    }
    for (f, _score) in &cands {
        let age = age_secs(&st.frame_touched_at, *f, now);
        let name = tier_name(&st.context, st.max_frame, *f, age);
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
            frame_touched_at: HashMap::new(),
        }
    }

    #[test]
    fn required_window_picked_first() {
        // Nothing cached; playhead at 100. pick_next must return a frame in
        // [97..=103] before anything in the marker neighborhood.
        let mut st = make_state(100, HashSet::new(), 500);
        st.context.markers = vec![500, 1000];
        let picked = pick_next(&st).unwrap();
        assert!(
            (picked - 100).abs() <= REQ_RADIUS,
            "expected required-window pick, got {picked}"
        );
    }

    #[test]
    fn required_window_is_never_evicted() {
        // Cache already full of required + marker neighbourhood frames.
        // evict_overflow must drop the marker frame, not the required one.
        let ready: HashSet<i64> = [100i64, 101, 500].into_iter().collect();
        let mut st = make_state(100, ready, 2);
        st.context.markers = vec![500];
        evict_overflow(&mut st);
        assert_eq!(st.ready.len(), 2);
        assert!(st.ready.contains(&100), "required frame 100 must survive");
        assert!(st.ready.contains(&101), "required frame 101 must survive");
        assert!(!st.ready.contains(&500), "non-required marker frame should evict");
    }

    #[test]
    fn marker_neighborhood_enters_candidates() {
        // Playhead far from the marker. The marker's neighbourhood should
        // still show up as candidates so workers extract those frames.
        let mut st = make_state(0, HashSet::new(), 500);
        st.context.markers = vec![10_000];
        let cands = candidate_frames(&st);
        let frames: HashSet<i64> = cands.iter().map(|(f, _)| *f).collect();
        assert!(frames.contains(&10_000), "marker itself should be a candidate");
        assert!(frames.contains(&(10_000 - 50)), "frames near a marker should be candidates");
        assert!(frames.contains(&(10_000 + 50)), "frames near a marker should be candidates");
    }

    #[test]
    fn evict_drops_lowest_scoring() {
        // Two non-required ready frames: one close to a marker, one not.
        // Cap=1 forces one eviction; the far-from-marker one should go.
        let ready: HashSet<i64> = [1_000i64, 2_000].into_iter().collect();
        let mut st = make_state(0, ready, 1);
        st.context.markers = vec![1_000]; // 1_000 is on a marker, 2_000 isn't
        evict_overflow(&mut st);
        assert_eq!(st.ready.len(), 1);
        assert!(st.ready.contains(&1_000), "on-marker frame should survive");
    }

    #[test]
    fn touch_near_playhead_stamps_required_only() {
        let ready: HashSet<i64> = [100i64, 200].into_iter().collect();
        let mut st = make_state(100, ready, 1000);
        touch_near_playhead(&mut st);
        assert!(st.frame_touched_at.contains_key(&100), "playhead frame should be stamped");
        assert!(!st.frame_touched_at.contains_key(&200), "distant frame must not be stamped");
    }

    #[test]
    fn score_prefers_marker_over_nothing() {
        let ctx = PriorityContext { playhead_frame: 0, markers: vec![1_000], ..Default::default() };
        let s_on_marker = frame_score(&ctx, 1_000, f64::INFINITY);
        let s_far = frame_score(&ctx, 50_000, f64::INFINITY);
        assert!(s_on_marker > s_far, "on-marker must outscore a distant cold frame");
    }

    #[test]
    fn playhead_radius_outranks_any_marker() {
        // A frame anywhere in T1 must beat any T2 frame, even a marker that's
        // both close to playhead AND in the viewport.
        let ctx = PriorityContext {
            playhead_frame: 100,
            markers: vec![120],
            viewport_frames: (0, 200),
            ..Default::default()
        };
        let s_radius_edge = frame_score(&ctx, 100 + REQ_RADIUS, 0.0);
        let s_marker = frame_score(&ctx, 120, 0.0);
        assert!(
            s_radius_edge > s_marker,
            "T1 edge ({s_radius_edge}) must beat T2 marker ({s_marker})",
        );
    }

    #[test]
    fn within_radius_closer_scores_higher() {
        // Inside the playhead radius, closeness to the playhead increases
        // priority — the gradient drives extraction order.
        let ctx = PriorityContext { playhead_frame: 100, ..Default::default() };
        let s_at = frame_score(&ctx, 100, 0.0);
        let s_near = frame_score(&ctx, 102, 0.0);
        let s_edge = frame_score(&ctx, 100 + REQ_RADIUS, 0.0);
        assert!(s_at > s_near && s_near > s_edge, "expected at > near > edge");
    }

    #[test]
    fn marker_in_viewport_outranks_marker_outside() {
        // Two markers at the same playhead distance — the in-viewport one wins.
        let ctx = PriorityContext {
            playhead_frame: 0,
            markers: vec![1_000, 10_000],
            // Viewport contains 1000 but not 10000.
            viewport_frames: (500, 5_000),
            ..Default::default()
        };
        // Equalize playhead-proximity by scoring same-distance markers — pick
        // markers that are both far enough that the proximity term is tiny.
        let m_in_vp = frame_score(&ctx, 1_000, f64::INFINITY);
        let m_out_vp = frame_score(&ctx, 10_000, f64::INFINITY);
        assert!(
            m_in_vp > m_out_vp,
            "in-viewport marker ({m_in_vp}) must outscore out-of-viewport ({m_out_vp})",
        );
    }

    #[test]
    fn at_marker_outranks_neighborhood() {
        // A frame that *is* a marker (T2) must beat a frame in the marker's
        // neighborhood (T3), so the marker frame itself fills first.
        let ctx = PriorityContext {
            playhead_frame: 0,
            markers: vec![10_000],
            ..Default::default()
        };
        let s_at = frame_score(&ctx, 10_000, 0.0);
        let s_neighbor = frame_score(&ctx, 10_010, 0.0);
        assert!(s_at > s_neighbor, "at-marker ({s_at}) must beat neighbor ({s_neighbor})");
    }

    #[test]
    fn recency_does_not_promote_t3_above_t2() {
        // Even a max-recency T3 frame must not climb into the T2 band.
        let ctx = PriorityContext {
            playhead_frame: 0,
            markers: vec![10_000, 20_000],
            ..Default::default()
        };
        let s_t2_stale = frame_score(&ctx, 20_000, f64::INFINITY);
        let s_t3_fresh = frame_score(&ctx, 10_010, 0.0);
        assert!(
            s_t2_stale > s_t3_fresh,
            "stale T2 ({s_t2_stale}) must outrank fresh T3 ({s_t3_fresh})",
        );
    }
}
