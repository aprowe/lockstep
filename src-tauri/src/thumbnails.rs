//! Thumbnail cache v2: two retainers (Static uncapped, Dynamic LRU), keyframe-indexed
//! GOP clustering, two-worker pool, multi-input ffmpeg jobs with bonus-frame warming.
//!
//! See docs/superpowers/specs/2026-05-26-thumbnail-backend-cache-v2-design.md.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

use crate::ffmpeg::find_bin;

// ── constants ─────────────────────────────────────────────────────────────────

const DEFAULT_MAX_CACHED: usize = 2000;
const DEFAULT_THUMB_WIDTH: u32 = 120;
const MAX_WORKERS: usize = 2;
const MAX_INPUTS_PER_FFMPEG: usize = 32;
/// Absolute hard cap on frames per ffmpeg input — safety net for giant GOPs.
const MAX_GOP_LEN: i64 = 600;
/// Bonus frames are only retained on disk if within this many frames of a
/// currently-wanted frame. Bounds dynamic-cache fill for videos with giant GOPs,
/// where decoding to reach a single wanted frame would otherwise dump the whole
/// GOP into Dynamic.
const BONUS_RADIUS: i64 = 5;

// ── retainer bits ─────────────────────────────────────────────────────────────

const STATIC_BIT: u8 = 0b01;
const DYNAMIC_BIT: u8 = 0b10;

#[inline]
fn has(r: u8, bit: u8) -> bool {
    r & bit != 0
}

// ── reason enum + tier mapping ────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Hash, Eq, PartialEq, Clone, Copy, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum ThumbnailReason {
    Filmstrip,
    Clips,
    ClipHover,
    Scenes,
    SceneHover,
    Anchors,
    AnchorHover,
}

fn tier_of(r: ThumbnailReason) -> u8 {
    use ThumbnailReason::*;
    match r {
        ClipHover | SceneHover | AnchorHover => 0,
        Filmstrip => 1,
        Anchors | Clips => 2,
        Scenes => 3,
    }
}

// ── core structs ──────────────────────────────────────────────────────────────

struct FrameEntry {
    path: PathBuf,
    retainers: u8,
    /// Last time this frame was touched as Dynamic. Meaningless if DYNAMIC bit clear.
    dynamic_touch: Instant,
}

struct VideoCache {
    video_path: String,
    fps: f64,
    thumb_width: u32,
    cache_dir: PathBuf,

    ready: HashMap<i64, FrameEntry>,
    static_set: HashSet<i64>,
    dynamic_set: HashSet<i64>,
    max_dynamic: usize,

    pending: BTreeSet<i64>,
    in_flight: HashSet<i64>,
    priority_rank: HashMap<i64, u8>,

    /// Absolute frame numbers of I-frames, sorted ascending. Empty if not yet probed
    /// (or probe failed — workers fall back to single-frame jobs).
    keyframes: Vec<i64>,
    keyframes_probed: bool,

    active_workers: usize,
    generation: u64,

    // ── diagnostics ──
    /// Wanted frames whose extraction attempts have failed; key = frame, value = attempt count.
    /// Frames are auto-retried up to MAX_ATTEMPTS times before being abandoned.
    failed_attempts: HashMap<i64, u32>,
    /// Lifetime ffmpeg jobs that exited non-zero or produced no outputs.
    lifetime_failures: u64,
    /// Lifetime jobs attempted.
    lifetime_jobs: u64,
    /// Most recent ffmpeg stderr (truncated).
    last_error: Option<String>,
}

const MAX_ATTEMPTS: u32 = 3;

impl VideoCache {
    fn keyframe_at_or_before(&self, f: i64) -> i64 {
        if self.keyframes.is_empty() {
            return f;
        }
        match self.keyframes.binary_search(&f) {
            Ok(_) => f,
            Err(0) => self.keyframes[0],
            Err(idx) => self.keyframes[idx - 1],
        }
    }

    fn gop_len_from(&self, kf: i64) -> i64 {
        if self.keyframes.is_empty() {
            return 1;
        }
        match self.keyframes.binary_search(&kf) {
            Ok(idx) if idx + 1 < self.keyframes.len() => {
                (self.keyframes[idx + 1] - kf).clamp(1, MAX_GOP_LEN)
            }
            _ => MAX_GOP_LEN,
        }
    }
}

#[derive(Default)]
struct Registry {
    videos: HashMap<String, Arc<Mutex<VideoCache>>>,
}

pub struct ThumbnailsState(Arc<Mutex<Registry>>);

impl Default for ThumbnailsState {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(Registry::default())))
    }
}

impl ThumbnailsState {
    pub fn new() -> Self {
        Self::default()
    }
}

#[derive(Deserialize)]
pub struct SetWantsRequest {
    pub file_hash: String,
    pub video_path: String,
    pub fps: f64,
    pub by_reason: HashMap<ThumbnailReason, Vec<i64>>,
    pub max_cached_frames: Option<usize>,
    pub thumb_width: Option<u32>,
}

// ── helpers ───────────────────────────────────────────────────────────────────

fn app_cache_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let d = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("thumbnails");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

fn cache_dir_for<R: Runtime>(app: &AppHandle<R>, file_hash: &str) -> Result<PathBuf, String> {
    let d = app_cache_dir(app)?.join(file_hash);
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

fn frame_path(cache_dir: &Path, frame: i64) -> PathBuf {
    cache_dir.join(format!("{frame}.jpg"))
}

fn scan_existing(cache_dir: &Path) -> HashMap<i64, FrameEntry> {
    let mut out = HashMap::new();
    let now = Instant::now();
    if let Ok(rd) = std::fs::read_dir(cache_dir) {
        for entry in rd.flatten() {
            let name = entry.file_name();
            let s = name.to_string_lossy();
            if let Some(stem) = s.strip_suffix(".jpg") {
                if let Ok(f) = stem.parse::<i64>() {
                    // Re-hydrated frames are treated as Dynamic warm leftovers; the
                    // next set_thumbnail_wants will tag STATIC if the user wants them.
                    out.insert(
                        f,
                        FrameEntry {
                            path: cache_dir.join(name),
                            retainers: DYNAMIC_BIT,
                            dynamic_touch: now,
                        },
                    );
                }
            }
        }
    }
    out
}

/// Project a reason→frames map into (static_set, dynamic_set, priority_rank).
fn project_wants(
    by_reason: &HashMap<ThumbnailReason, Vec<i64>>,
) -> (HashSet<i64>, HashSet<i64>, HashMap<i64, u8>) {
    let mut static_set = HashSet::new();
    let mut dynamic_set = HashSet::new();
    let mut rank: HashMap<i64, u8> = HashMap::new();
    for (r, frames) in by_reason {
        let t = tier_of(*r);
        let target = if matches!(r, ThumbnailReason::Filmstrip) {
            &mut dynamic_set
        } else {
            &mut static_set
        };
        for &f in frames {
            if f < 0 {
                continue;
            }
            target.insert(f);
            rank.entry(f).and_modify(|v| *v = (*v).min(t)).or_insert(t);
        }
    }
    (static_set, dynamic_set, rank)
}

// ── ffprobe keyframe index ────────────────────────────────────────────────────

fn probe_keyframes(video_path: &str, fps: f64) -> Vec<i64> {
    if fps <= 0.0 {
        return vec![];
    }
    let bin = find_bin("ffprobe");
    let mut cmd = Command::new(bin);
    cmd.arg("-v")
        .arg("error")
        .arg("-select_streams")
        .arg("v:0")
        .arg("-show_packets")
        .arg("-show_entries")
        .arg("packet=pts_time,flags")
        .arg("-of")
        .arg("csv=p=0")
        .arg(video_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = match cmd.output() {
        Ok(o) => o,
        Err(_) => return vec![],
    };
    if !output.status.success() {
        return vec![];
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut frames: Vec<i64> = Vec::new();
    for line in text.lines() {
        // Expected: "<pts_time>,<flags>" — flags like "K_" or "K__" mark keyframes.
        let mut it = line.split(',');
        let t = match it.next().and_then(|s| s.trim().parse::<f64>().ok()) {
            Some(v) => v,
            None => continue,
        };
        let flags = it.next().unwrap_or("");
        if flags.contains('K') {
            let f = (t * fps).floor() as i64;
            if f >= 0 {
                frames.push(f);
            }
        }
    }
    frames.sort_unstable();
    frames.dedup();
    if frames.first().copied() != Some(0) {
        frames.insert(0, 0);
    }
    frames
}

// ── eviction ──────────────────────────────────────────────────────────────────

fn evict_dynamic(c: &mut VideoCache) {
    let mut dynamic_count = c
        .ready
        .values()
        .filter(|e| has(e.retainers, DYNAMIC_BIT))
        .count();
    if dynamic_count <= c.max_dynamic {
        return;
    }

    let mut victims: Vec<(i64, Instant)> = c
        .ready
        .iter()
        .filter(|(f, e)| has(e.retainers, DYNAMIC_BIT) && !c.dynamic_set.contains(*f))
        .map(|(f, e)| (*f, e.dynamic_touch))
        .collect();
    victims.sort_by_key(|(_, t)| *t);

    for (f, _) in victims {
        if dynamic_count <= c.max_dynamic {
            break;
        }
        let mut delete_file: Option<PathBuf> = None;
        if let Some(e) = c.ready.get_mut(&f) {
            e.retainers &= !DYNAMIC_BIT;
            if e.retainers == 0 {
                delete_file = Some(e.path.clone());
            }
        }
        if let Some(p) = delete_file {
            c.ready.remove(&f);
            let _ = std::fs::remove_file(&p);
        }
        dynamic_count -= 1;
    }
}

// ── job picking ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct GopCluster {
    keyframe_frame: i64,
    gop_len: i64,
    /// Frames in this GOP that were explicitly pending (drives tier selection).
    wanted_pending: Vec<i64>,
    /// Min priority tier across `wanted_pending`. Lower = more urgent.
    tier: u8,
}

#[derive(Debug)]
struct Job {
    generation: u64,
    clusters: Vec<GopCluster>,
}

fn pick_job(c: &mut VideoCache) -> Option<Job> {
    if c.pending.is_empty() {
        return None;
    }

    // 1. Group pending frames by their containing GOP. Snapshot pending into a
    //    Vec so we can call methods on `c` inside the loop without conflicting
    //    with the BTreeSet borrow.
    let mut by_kf: HashMap<i64, GopCluster> = HashMap::new();
    let pending: Vec<i64> = c.pending.iter().copied().collect();
    for f in pending {
        let kf = c.keyframe_at_or_before(f);
        let gop_len = c.gop_len_from(kf);
        let tier = c.priority_rank.get(&f).copied().unwrap_or(u8::MAX);
        let cl = by_kf.entry(kf).or_insert(GopCluster {
            keyframe_frame: kf,
            gop_len,
            wanted_pending: vec![],
            tier: u8::MAX,
        });
        cl.wanted_pending.push(f);
        cl.tier = cl.tier.min(tier);
    }

    // 2. Tighten each cluster's gop_len: cover all wanted frames plus a small
    //    trailing bonus of BONUS_RADIUS frames, bounded by the natural GOP.
    //    Leading bonus (between keyframe and the first wanted) comes "for free"
    //    from the decode but is filtered for retention in the worker.
    for cl in by_kf.values_mut() {
        let furthest = cl.wanted_pending.iter().max().copied().unwrap_or(cl.keyframe_frame);
        let needed = furthest - cl.keyframe_frame + 1 + BONUS_RADIUS;
        cl.gop_len = cl.gop_len.min(needed);
    }

    // 3. Best tier present.
    let best_tier = by_kf.values().map(|cl| cl.tier).min()?;

    // 4. Same-tier clusters, sorted by keyframe for deterministic ordering.
    let mut chosen: Vec<GopCluster> = by_kf
        .into_values()
        .filter(|cl| cl.tier == best_tier)
        .collect();
    chosen.sort_by_key(|cl| cl.keyframe_frame);
    if chosen.len() > MAX_INPUTS_PER_FFMPEG {
        chosen.truncate(MAX_INPUTS_PER_FFMPEG);
    }

    // 5. Move every frame in each cluster's span from pending → in_flight.
    for cl in &chosen {
        for off in 0..cl.gop_len {
            let f = cl.keyframe_frame + off;
            c.pending.remove(&f);
            c.in_flight.insert(f);
        }
    }

    Some(Job {
        generation: c.generation,
        clusters: chosen,
    })
}

/// Decide whether a decoded frame should be retained and with what retainer bits.
/// `None` means "discard — outside both retainer sets and not close enough to a
/// wanted frame to be worth keeping as bonus."
fn retention_for_decoded(
    f: i64,
    static_set: &HashSet<i64>,
    dynamic_set: &HashSet<i64>,
    cluster_wanted: &[i64],
) -> Option<u8> {
    let mut bits = 0u8;
    if static_set.contains(&f) {
        bits |= STATIC_BIT;
    }
    if dynamic_set.contains(&f) {
        bits |= DYNAMIC_BIT;
    }
    if bits != 0 {
        return Some(bits);
    }
    let close = cluster_wanted.iter().any(|&w| (f - w).abs() <= BONUS_RADIUS);
    if close {
        Some(DYNAMIC_BIT)
    } else {
        None
    }
}

/// Increment per-frame attempt counts and re-add wanted frames to `pending`
/// when still under the retry cap. Used by both ffmpeg-failure and
/// zero-output failure paths in the worker.
fn requeue_failed_wanted(c: &mut VideoCache, wanted_pending: &[i64]) {
    for &wf in wanted_pending {
        let attempts = c.failed_attempts.entry(wf).or_insert(0);
        *attempts += 1;
        if *attempts < MAX_ATTEMPTS
            && (c.static_set.contains(&wf) || c.dynamic_set.contains(&wf))
        {
            c.pending.insert(wf);
        }
    }
}

// ── ffmpeg job runner ─────────────────────────────────────────────────────────

/// Run one ffmpeg job. Returns `Ok(())` if ffmpeg exited 0; `Err(stderr)` otherwise.
/// The worker still checks output presence per-frame — a 0-exit with no files
/// is counted as a failure separately.
fn run_ffmpeg_job(
    bin: &str,
    video_path: &str,
    fps: f64,
    thumb_width: u32,
    cache_dir: &Path,
    job: &Job,
) -> Result<(), String> {
    if job.clusters.is_empty() {
        return Err("empty job".into());
    }
    if fps <= 0.0 {
        return Err("invalid fps".into());
    }
    let mut cmd = Command::new(bin);
    cmd.arg("-y").arg("-loglevel").arg("error");

    // N inputs, each with its own -ss before -i.
    for cl in &job.clusters {
        let t = (cl.keyframe_frame as f64) / fps.max(0.0001);
        cmd.arg("-ss").arg(format!("{:.3}", t)).arg("-i").arg(video_path);
    }
    // N outputs, one per input.
    let out_pattern = cache_dir.join("%d.jpg");
    let out_str = out_pattern.to_string_lossy().to_string();
    for (i, cl) in job.clusters.iter().enumerate() {
        cmd.arg("-map")
            .arg(format!("{i}:v:0"))
            .arg("-frames:v")
            .arg(cl.gop_len.to_string())
            .arg("-fps_mode")
            .arg("passthrough")
            .arg("-vf")
            .arg(format!("scale={thumb_width}:-2"))
            .arg("-q:v")
            .arg("4")
            .arg("-start_number")
            .arg(cl.keyframe_frame.to_string())
            .arg("-f")
            .arg("image2")
            .arg(&out_str);
    }
    cmd.stdout(Stdio::null()).stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd
        .output()
        .map_err(|e| format!("spawn failed: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("ffmpeg exited {}", output.status)
        } else {
            stderr
        });
    }
    Ok(())
}

// ── worker loop ───────────────────────────────────────────────────────────────

fn worker_loop<R: Runtime>(
    app: AppHandle<R>,
    file_hash: String,
    entry: Arc<Mutex<VideoCache>>,
) {
    let bin = find_bin("ffmpeg");
    loop {
        let job = {
            let mut c = entry.lock().unwrap();
            match pick_job(&mut c) {
                Some(j) => j,
                None => {
                    c.active_workers = c.active_workers.saturating_sub(1);
                    return;
                }
            }
        };

        let (video_path, fps, thumb_width, cache_dir, expected_gen) = {
            let c = entry.lock().unwrap();
            (
                c.video_path.clone(),
                c.fps,
                c.thumb_width,
                c.cache_dir.clone(),
                job.generation,
            )
        };

        let job_result = run_ffmpeg_job(&bin, &video_path, fps, thumb_width, &cache_dir, &job);

        // Post-process outputs.
        let mut emit_list: Vec<(i64, String)> = Vec::new();
        {
            let mut c = entry.lock().unwrap();

            // Width-change race: discard everything and clean up files we just
            // wrote. Don't count toward lifetime_jobs — this isn't a "real" job.
            if c.generation != expected_gen {
                for cl in &job.clusters {
                    for off in 0..cl.gop_len {
                        let f = cl.keyframe_frame + off;
                        c.in_flight.remove(&f);
                        let _ = std::fs::remove_file(frame_path(&cache_dir, f));
                    }
                }
                continue;
            }

            c.lifetime_jobs = c.lifetime_jobs.saturating_add(1);

            // ffmpeg-level failure: log, increment counters, retry wanted frames
            // up to MAX_ATTEMPTS, and clear in_flight for the cluster span.
            if let Err(err) = &job_result {
                let truncated: String = err.chars().take(400).collect();
                log::warn!(
                    target: "thumbnails",
                    "ffmpeg job failed (clusters={}, gen={}): {truncated}",
                    job.clusters.len(),
                    expected_gen,
                );
                c.lifetime_failures = c.lifetime_failures.saturating_add(1);
                c.last_error = Some(truncated);
                for cl in &job.clusters {
                    for off in 0..cl.gop_len {
                        c.in_flight.remove(&(cl.keyframe_frame + off));
                    }
                    let wanted = cl.wanted_pending.clone();
                    requeue_failed_wanted(&mut c, &wanted);
                }
                continue;
            }

            let now = Instant::now();
            let mut inserted_count = 0usize;
            let mut wanted_in_job = 0usize;
            for cl in &job.clusters {
                // Snapshot of currently-wanted frames in this cluster's range,
                // used as the bonus-retention reference for nearby decoded frames.
                let cluster_wanted: Vec<i64> = (cl.keyframe_frame
                    ..cl.keyframe_frame + cl.gop_len)
                    .filter(|f| c.static_set.contains(f) || c.dynamic_set.contains(f))
                    .collect();
                wanted_in_job += cluster_wanted.len();

                for off in 0..cl.gop_len {
                    let f = cl.keyframe_frame + off;
                    c.in_flight.remove(&f);
                    let path = frame_path(&cache_dir, f);
                    if !path.exists() {
                        continue;
                    }
                    match retention_for_decoded(
                        f,
                        &c.static_set,
                        &c.dynamic_set,
                        &cluster_wanted,
                    ) {
                        Some(bits) => {
                            c.ready.insert(
                                f,
                                FrameEntry {
                                    path: path.clone(),
                                    retainers: bits,
                                    dynamic_touch: now,
                                },
                            );
                            inserted_count += 1;
                            // Clear failure tracking on success.
                            c.failed_attempts.remove(&f);
                            emit_list.push((f, path.to_string_lossy().to_string()));
                        }
                        None => {
                            // Outside retainer sets and not close to any wanted
                            // frame in this cluster — discard the decoded JPEG.
                            let _ = std::fs::remove_file(&path);
                        }
                    }
                }
            }

            // Zero-output detection: ffmpeg exited 0 but produced no usable
            // outputs for the frames we expected. Treat as a soft failure so
            // the panel surfaces it; retry within MAX_ATTEMPTS.
            if wanted_in_job > 0 && inserted_count == 0 {
                log::warn!(
                    target: "thumbnails",
                    "ffmpeg job returned success but produced no usable outputs \
                     (clusters={}, wanted={wanted_in_job}); retrying within cap",
                    job.clusters.len(),
                );
                c.lifetime_failures = c.lifetime_failures.saturating_add(1);
                c.last_error = Some("ffmpeg produced no outputs".into());
                for cl in &job.clusters {
                    let wanted = cl.wanted_pending.clone();
                    requeue_failed_wanted(&mut c, &wanted);
                }
            } else if inserted_count > 0 {
                // Healthy job — clear stale error message so the panel reflects
                // current state.
                c.last_error = None;
            }

            evict_dynamic(&mut c);
        }

        for (f, p) in emit_list {
            let _ = app.emit(
                "thumbnail-ready",
                serde_json::json!({
                    "file_hash": &file_hash,
                    "frame": f,
                    "path": p,
                }),
            );
        }
    }
}

/// Spawn workers up to `MAX_WORKERS` for the given file's cache. The worker's
/// captured `Arc<Mutex<VideoCache>>` keeps the cache alive even if it gets
/// removed from the registry mid-decode (e.g., via `clear_thumbnails`).
fn ensure_workers<R: Runtime>(
    app: AppHandle<R>,
    file_hash: String,
    entry: Arc<Mutex<VideoCache>>,
) {
    let to_spawn = {
        let mut c = entry.lock().unwrap();
        let mut s = 0;
        while c.active_workers < MAX_WORKERS && !c.pending.is_empty() {
            c.active_workers += 1;
            s += 1;
        }
        s
    };
    for _ in 0..to_spawn {
        let app = app.clone();
        let entry = entry.clone();
        let file_hash = file_hash.clone();
        std::thread::spawn(move || worker_loop(app, file_hash, entry));
    }
}

// ── tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn set_thumbnail_wants<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, ThumbnailsState>,
    req: SetWantsRequest,
) -> Result<(), String> {
    if req.fps <= 0.0 {
        return Err("invalid fps".into());
    }
    let cache_dir = cache_dir_for(&app, &req.file_hash)?;
    let thumb_width = req.thumb_width.unwrap_or(DEFAULT_THUMB_WIDTH).max(16);
    let max_dynamic = req.max_cached_frames.unwrap_or(DEFAULT_MAX_CACHED).max(16);

    let entry = {
        let mut reg = state.0.lock().unwrap();
        reg.videos
            .entry(req.file_hash.clone())
            .or_insert_with(|| {
                let ready = scan_existing(&cache_dir);
                Arc::new(Mutex::new(VideoCache {
                    video_path: req.video_path.clone(),
                    fps: req.fps,
                    thumb_width,
                    cache_dir: cache_dir.clone(),
                    ready,
                    static_set: HashSet::new(),
                    dynamic_set: HashSet::new(),
                    max_dynamic,
                    pending: BTreeSet::new(),
                    in_flight: HashSet::new(),
                    priority_rank: HashMap::new(),
                    keyframes: Vec::new(),
                    keyframes_probed: false,
                    active_workers: 0,
                    generation: 0,
                    failed_attempts: HashMap::new(),
                    lifetime_failures: 0,
                    lifetime_jobs: 0,
                    last_error: None,
                }))
            })
            .clone()
    };

    // ffprobe runs outside the lock (it can be slow). Capture path+fps inside.
    let need_probe = {
        let c = entry.lock().unwrap();
        !c.keyframes_probed
    };
    let probed = if need_probe {
        Some(probe_keyframes(&req.video_path, req.fps))
    } else {
        None
    };

    let mut hit_emits: Vec<(i64, String)> = Vec::new();
    {
        let mut c = entry.lock().unwrap();
        c.video_path = req.video_path;
        c.fps = req.fps;
        c.max_dynamic = max_dynamic;
        if let Some(kf) = probed {
            c.keyframes = kf;
            c.keyframes_probed = true;
        }

        // 1. Width change → purge + bump generation.
        if c.thumb_width != thumb_width {
            c.generation = c.generation.wrapping_add(1);
            let drained: Vec<(i64, FrameEntry)> = c.ready.drain().collect();
            for (_, e) in drained {
                let _ = std::fs::remove_file(&e.path);
            }
            c.static_set.clear();
            c.dynamic_set.clear();
            c.pending.clear();
            c.thumb_width = thumb_width;
        }

        // 2. Project new wants.
        let (new_static, new_dynamic, new_rank) = project_wants(&req.by_reason);

        // 3. Diff: clear retainer bits for frames that left their respective set.
        let dropped_static: Vec<i64> = c
            .static_set
            .iter()
            .filter(|f| !new_static.contains(f))
            .copied()
            .collect();
        let dropped_dynamic: Vec<i64> = c
            .dynamic_set
            .iter()
            .filter(|f| !new_dynamic.contains(f))
            .copied()
            .collect();
        for f in dropped_static {
            if let Some(e) = c.ready.get_mut(&f) {
                e.retainers &= !STATIC_BIT;
            }
        }
        for f in dropped_dynamic {
            if let Some(e) = c.ready.get_mut(&f) {
                e.retainers &= !DYNAMIC_BIT;
            }
        }

        // 4. Apply new retainers + touch + enqueue or queue cache-hit emits.
        let now = Instant::now();
        let union: HashSet<i64> = new_static.union(&new_dynamic).copied().collect();
        for &f in &union {
            let in_static = new_static.contains(&f);
            let in_dynamic = new_dynamic.contains(&f);
            if let Some(e) = c.ready.get_mut(&f) {
                if in_static {
                    e.retainers |= STATIC_BIT;
                }
                if in_dynamic {
                    e.retainers |= DYNAMIC_BIT;
                    e.dynamic_touch = now;
                }
                hit_emits.push((f, e.path.to_string_lossy().to_string()));
            } else if !c.in_flight.contains(&f) {
                c.pending.insert(f);
            }
        }

        c.static_set = new_static;
        c.dynamic_set = new_dynamic;
        c.priority_rank = new_rank;

        // 5. Reap zero-retainer entries.
        let zeroed: Vec<i64> = c
            .ready
            .iter()
            .filter(|(_, e)| e.retainers == 0)
            .map(|(f, _)| *f)
            .collect();
        for f in zeroed {
            if let Some(e) = c.ready.remove(&f) {
                let _ = std::fs::remove_file(&e.path);
            }
        }

        // 6. Evict over-cap Dynamic.
        evict_dynamic(&mut c);
    }

    // 7. Emit cache-hit thumbnail-ready events outside the lock.
    for (f, p) in hit_emits {
        let _ = app.emit(
            "thumbnail-ready",
            serde_json::json!({
                "file_hash": &req.file_hash,
                "frame": f,
                "path": p,
            }),
        );
    }

    // 8. Spin up workers if there's work and pool has slack.
    ensure_workers(app, req.file_hash, entry);
    Ok(())
}

#[tauri::command]
pub fn clear_thumbnails(
    state: tauri::State<'_, ThumbnailsState>,
    file_hash: String,
) -> Result<(), String> {
    let entry = {
        let mut reg = state.0.lock().unwrap();
        reg.videos.remove(&file_hash)
    };
    if let Some(e) = entry {
        let c = e.lock().unwrap();
        let _ = std::fs::remove_dir_all(&c.cache_dir);
    }
    Ok(())
}

#[derive(Serialize)]
pub struct ThumbnailStats {
    pub file_hash: String,
    pub thumb_width: u32,
    pub max_dynamic: usize,
    pub generation: u64,
    pub keyframes_probed: bool,
    pub keyframes_count: usize,
    pub active_workers: usize,
    pub static_set: usize,
    pub dynamic_set: usize,
    pub ready_total: usize,
    pub ready_static_only: usize,
    pub ready_dynamic_only: usize,
    pub ready_both: usize,
    pub ready_dynamic_unwanted: usize,
    pub pending: usize,
    pub in_flight: usize,
    pub lifetime_jobs: u64,
    pub lifetime_failures: u64,
    pub abandoned_frames: usize,
    pub last_error: Option<String>,
}

#[tauri::command]
pub fn get_thumbnail_stats(
    state: tauri::State<'_, ThumbnailsState>,
    file_hash: String,
) -> Option<ThumbnailStats> {
    let reg = state.0.lock().unwrap();
    let entry = reg.videos.get(&file_hash)?.clone();
    drop(reg);
    let c = entry.lock().unwrap();

    let mut s_only = 0usize;
    let mut d_only = 0usize;
    let mut both = 0usize;
    let mut d_unwanted = 0usize;
    for (f, e) in &c.ready {
        let s = has(e.retainers, STATIC_BIT);
        let d = has(e.retainers, DYNAMIC_BIT);
        match (s, d) {
            (true, true) => both += 1,
            (true, false) => s_only += 1,
            (false, true) => {
                d_only += 1;
                if !c.dynamic_set.contains(f) {
                    d_unwanted += 1;
                }
            }
            (false, false) => {}
        }
    }

    Some(ThumbnailStats {
        file_hash,
        thumb_width: c.thumb_width,
        max_dynamic: c.max_dynamic,
        generation: c.generation,
        keyframes_probed: c.keyframes_probed,
        keyframes_count: c.keyframes.len(),
        active_workers: c.active_workers,
        static_set: c.static_set.len(),
        dynamic_set: c.dynamic_set.len(),
        ready_total: c.ready.len(),
        ready_static_only: s_only,
        ready_dynamic_only: d_only,
        ready_both: both,
        ready_dynamic_unwanted: d_unwanted,
        pending: c.pending.len(),
        in_flight: c.in_flight.len(),
        lifetime_jobs: c.lifetime_jobs,
        lifetime_failures: c.lifetime_failures,
        abandoned_frames: c
            .failed_attempts
            .iter()
            .filter(|(_, n)| **n >= MAX_ATTEMPTS)
            .count(),
        last_error: c.last_error.clone(),
    })
}

#[tauri::command]
pub fn clear_all_thumbnails<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, ThumbnailsState>,
) -> Result<(), String> {
    let mut reg = state.0.lock().unwrap();
    reg.videos.clear();
    let root = app_cache_dir(&app)?;
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(())
}

// ── tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn fresh_cache() -> VideoCache {
        VideoCache {
            video_path: "/tmp/x.mp4".into(),
            fps: 30.0,
            thumb_width: 120,
            cache_dir: std::env::temp_dir().join(format!("thumbtest_{}", std::process::id())),
            ready: HashMap::new(),
            static_set: HashSet::new(),
            dynamic_set: HashSet::new(),
            max_dynamic: 3,
            pending: BTreeSet::new(),
            in_flight: HashSet::new(),
            priority_rank: HashMap::new(),
            keyframes: vec![],
            keyframes_probed: false,
            active_workers: 0,
            generation: 0,
            failed_attempts: HashMap::new(),
            lifetime_failures: 0,
            lifetime_jobs: 0,
            last_error: None,
        }
    }

    fn entry(retainers: u8, touch: Instant) -> FrameEntry {
        FrameEntry {
            path: PathBuf::from("/tmp/x.jpg"),
            retainers,
            dynamic_touch: touch,
        }
    }

    #[test]
    fn project_wants_routes_filmstrip_to_dynamic_others_to_static() {
        use ThumbnailReason::*;
        let mut by_reason = HashMap::new();
        by_reason.insert(Filmstrip, vec![10, 11, 12]);
        by_reason.insert(Scenes, vec![100]);
        by_reason.insert(ClipHover, vec![50]);

        let (s, d, rank) = project_wants(&by_reason);
        assert_eq!(d, [10, 11, 12].into_iter().collect());
        assert_eq!(s, [100, 50].into_iter().collect());
        assert_eq!(rank.get(&50), Some(&0)); // hover tier
        assert_eq!(rank.get(&10), Some(&1)); // filmstrip tier
        assert_eq!(rank.get(&100), Some(&3)); // scenes tier
    }

    #[test]
    fn project_wants_takes_min_tier_when_frame_in_multiple_reasons() {
        use ThumbnailReason::*;
        let mut by_reason = HashMap::new();
        by_reason.insert(Scenes, vec![42]);
        by_reason.insert(SceneHover, vec![42]);
        let (_, _, rank) = project_wants(&by_reason);
        assert_eq!(rank.get(&42), Some(&0)); // hover wins
    }

    #[test]
    fn dynamic_wanted_never_evicted_past_cap() {
        let mut c = fresh_cache();
        c.max_dynamic = 2;
        let now = Instant::now();
        for f in 1..=4i64 {
            c.ready.insert(f, entry(DYNAMIC_BIT, now));
            c.dynamic_set.insert(f);
        }
        evict_dynamic(&mut c);
        assert_eq!(c.ready.len(), 4, "currently-wanted Dynamic frames are protected");
    }

    #[test]
    fn dynamic_lru_evicts_oldest_unwanted() {
        let mut c = fresh_cache();
        c.max_dynamic = 2;
        let base = Instant::now();
        c.ready.insert(1, entry(DYNAMIC_BIT, base));
        c.ready
            .insert(2, entry(DYNAMIC_BIT, base + Duration::from_millis(10)));
        c.ready
            .insert(3, entry(DYNAMIC_BIT, base + Duration::from_millis(20)));
        c.ready
            .insert(4, entry(DYNAMIC_BIT, base + Duration::from_millis(30)));
        // None in dynamic_set → all eligible. Drop oldest until at cap.
        evict_dynamic(&mut c);
        assert_eq!(c.ready.len(), 2);
        assert!(!c.ready.contains_key(&1));
        assert!(!c.ready.contains_key(&2));
        assert!(c.ready.contains_key(&3));
        assert!(c.ready.contains_key(&4));
    }

    #[test]
    fn dynamic_eviction_keeps_static_bit_alive() {
        let mut c = fresh_cache();
        c.max_dynamic = 0;
        let now = Instant::now();
        // Frame held by both retainers, dynamic_set empty → eligible for Dynamic eviction.
        c.ready.insert(7, entry(STATIC_BIT | DYNAMIC_BIT, now));
        evict_dynamic(&mut c);
        // Entry stays (STATIC bit), file not deleted, DYNAMIC bit cleared.
        let e = c.ready.get(&7).expect("entry must remain");
        assert_eq!(e.retainers, STATIC_BIT);
    }

    #[test]
    fn dynamic_eviction_drops_entry_when_no_retainers_left() {
        let mut c = fresh_cache();
        c.max_dynamic = 0;
        let now = Instant::now();
        c.ready.insert(8, entry(DYNAMIC_BIT, now));
        evict_dynamic(&mut c);
        assert!(!c.ready.contains_key(&8));
    }

    #[test]
    fn gop_lookup_with_keyframes() {
        let mut c = fresh_cache();
        c.keyframes = vec![0, 60, 120, 180];
        c.keyframes_probed = true;
        assert_eq!(c.keyframe_at_or_before(0), 0);
        assert_eq!(c.keyframe_at_or_before(59), 0);
        assert_eq!(c.keyframe_at_or_before(60), 60);
        assert_eq!(c.keyframe_at_or_before(119), 60);
        assert_eq!(c.keyframe_at_or_before(200), 180);
        assert_eq!(c.gop_len_from(0), 60);
        assert_eq!(c.gop_len_from(60), 60);
        assert_eq!(c.gop_len_from(180), MAX_GOP_LEN);
    }

    #[test]
    fn gop_lookup_falls_back_when_unprobed() {
        let c = fresh_cache();
        assert_eq!(c.keyframe_at_or_before(42), 42);
        assert_eq!(c.gop_len_from(42), 1);
    }

    #[test]
    fn pick_job_groups_by_gop_and_picks_best_tier() {
        let mut c = fresh_cache();
        c.keyframes = vec![0, 60, 120];
        c.keyframes_probed = true;
        // Three pending frames across two GOPs; tier 3 (scenes) at frames 70 and 130,
        // tier 1 (filmstrip) at frame 10.
        c.pending.insert(10);
        c.pending.insert(70);
        c.pending.insert(130);
        c.priority_rank.insert(10, 1);
        c.priority_rank.insert(70, 3);
        c.priority_rank.insert(130, 3);
        let job = pick_job(&mut c).unwrap();
        assert_eq!(job.clusters.len(), 1, "only tier-1 cluster picked");
        assert_eq!(job.clusters[0].keyframe_frame, 0);
        // Wanted offset 10 + BONUS_RADIUS=5 trailing → 16 frames.
        assert_eq!(job.clusters[0].gop_len, 11 + BONUS_RADIUS);
        assert!(c.in_flight.contains(&10));
        // Other-tier pending frames are untouched.
        assert!(c.pending.contains(&70));
        assert!(c.pending.contains(&130));
    }

    #[test]
    fn pick_job_packs_same_tier_clusters() {
        let mut c = fresh_cache();
        c.keyframes = vec![0, 60, 120];
        c.keyframes_probed = true;
        c.pending.insert(10);
        c.pending.insert(70);
        c.pending.insert(130);
        // All same tier — should pack all three GOPs into one job.
        c.priority_rank.insert(10, 3);
        c.priority_rank.insert(70, 3);
        c.priority_rank.insert(130, 3);
        let job = pick_job(&mut c).unwrap();
        assert_eq!(job.clusters.len(), 3);
    }

    #[test]
    fn pick_job_returns_none_when_pending_empty() {
        let mut c = fresh_cache();
        assert!(pick_job(&mut c).is_none());
    }

    #[test]
    fn pick_job_gop_len_covers_far_wanted_frame_plus_radius() {
        let mut c = fresh_cache();
        c.keyframes = vec![0];
        c.keyframes_probed = true;
        c.pending.insert(50);
        c.priority_rank.insert(50, 1);
        let job = pick_job(&mut c).unwrap();
        // Wanted offset 50 + radius 5 trailing → 56 frames.
        assert_eq!(job.clusters[0].gop_len, 51 + BONUS_RADIUS);
    }

    #[test]
    fn pick_job_gop_len_respects_natural_gop_boundary() {
        let mut c = fresh_cache();
        c.keyframes = vec![0, 10, 20];
        c.keyframes_probed = true;
        // Wanted offset 8 in a 10-frame GOP: needed = 8+1+5 = 14, capped at 10.
        c.pending.insert(8);
        c.priority_rank.insert(8, 1);
        let job = pick_job(&mut c).unwrap();
        assert_eq!(job.clusters[0].gop_len, 10);
    }

    #[test]
    fn retention_keeps_wanted_frames() {
        let s: HashSet<i64> = [10].into_iter().collect();
        let d: HashSet<i64> = HashSet::new();
        let bits = retention_for_decoded(10, &s, &d, &[10]).unwrap();
        assert_eq!(bits, STATIC_BIT);
        let bits = retention_for_decoded(10, &HashSet::new(), &[10].into_iter().collect(), &[10]).unwrap();
        assert_eq!(bits, DYNAMIC_BIT);
    }

    #[test]
    fn retention_keeps_bonus_within_radius() {
        let s: HashSet<i64> = HashSet::new();
        let d: HashSet<i64> = HashSet::new();
        let wanted = vec![100];
        for off in -BONUS_RADIUS..=BONUS_RADIUS {
            let f = 100 + off;
            let bits = retention_for_decoded(f, &s, &d, &wanted);
            assert!(bits.is_some(), "frame {} (offset {}) should be kept", f, off);
            // Bonus-only retention → DYNAMIC only.
            if off != 0 {
                assert_eq!(bits.unwrap(), DYNAMIC_BIT);
            }
        }
    }

    #[test]
    fn retention_discards_bonus_outside_radius() {
        let s: HashSet<i64> = HashSet::new();
        let d: HashSet<i64> = HashSet::new();
        let wanted = vec![100];
        assert!(retention_for_decoded(100 + BONUS_RADIUS + 1, &s, &d, &wanted).is_none());
        assert!(retention_for_decoded(100 - BONUS_RADIUS - 1, &s, &d, &wanted).is_none());
        // Empty cluster_wanted → never bonus-kept.
        assert!(retention_for_decoded(0, &s, &d, &[]).is_none());
    }
}
