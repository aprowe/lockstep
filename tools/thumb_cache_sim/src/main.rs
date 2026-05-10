//! Thumbnail-cache simulator.
//!
//! Stand-alone tool — no Tauri, no FFmpeg. Replays a `thumb-recording-*.jsonl`
//! captured by `src/utils/devThumbnailRecorder.ts` through a discrete-event
//! cache simulator and compares cache algorithms / parameter settings.
//!
//! ## Usage
//!
//! ```
//! cargo run --release -- path/to/thumb-recording-2026-04-21T07-51-52.jsonl
//! ```
//!
//! The recording's `session_end` summary gives an extraction-time distribution
//! (p50 / p95) which the sim samples log-normally per ffmpeg job. Three workers
//! run concurrently (matching `MAX_WORKERS` in `src-tauri/src/thumbnails.rs`).
//!
//! ## Metrics reported
//!
//! - **req-miss**: % of UI ticks where any frame in `[playhead ± 3]` is uncached.
//! - **strip-miss**: % of `stripFrames` / `hoverFrames` uncached at the tick
//!   they were rendered. Captures the scrubbing-through-the-strip experience.
//! - **extracts**: total ffmpeg jobs run. Lower = less CPU/disk.
//! - **TTR p50 / p95**: median and 95th-percentile wall-clock time-to-ready,
//!   in ms, across every wanted-but-uncached frame in the trace. Frames never
//!   ready before trace end count as `trace_end + 5s`.
//!
//! ## Optimization
//!
//! Pass `--optimize` to run CMA-ES over the additive-scorer's seven continuous
//! parameters. Objective is scalarized:
//!   `objective = TTR_p95_secs + 10·req_miss + 5·strip_miss`
//! averaged across `--seeds N` (default 5) seeded sims per evaluation. The
//! best config found is appended to the report.

use std::collections::{BinaryHeap, HashMap, HashSet, VecDeque};
use std::env;

use serde::Deserialize;

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_WORKERS: usize = 3;
/// Independent of any policy's `req_radius` — this is the metric's idea of
/// "playback window is uncached," so it stays constant across algorithms.
const METRIC_REQ_RADIUS: i64 = 3;
/// Cap for frames that never become ready before the trace ends, added to
/// trace_end to keep TTR percentiles finite.
const NEVER_READY_PAD_MS: i64 = 5_000;

// ── Recording schema ─────────────────────────────────────────────────────────
//
// Mirrors the union in `src/utils/devThumbnailRecorder.ts`. Each JSONL line is
// one event; serde picks the variant via the `type` tag.

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum RawEntry {
    #[serde(rename = "session_start")]
    SessionStart {
        #[allow(dead_code)] ts: f64,
        #[serde(rename = "wallTime")] #[allow(dead_code)] wall_time: String,
        fps: f64,
        #[serde(rename = "fileHash")] #[allow(dead_code)] file_hash: String,
        duration: f64,
    },
    #[serde(rename = "priority_push")]
    PriorityPush {
        ts: f64,
        #[serde(rename = "fileHash")] #[allow(dead_code)] file_hash: String,
        fps: f64,
        duration: f64,
        #[serde(rename = "playheadFrame")] playhead_frame: i64,
        #[serde(rename = "regionFrames", default)] region_frames: Vec<(i64, i64)>,
        #[serde(rename = "markerFrames", default)] marker_frames: Vec<i64>,
        #[serde(rename = "sceneFrames", default)] scene_frames: Vec<i64>,
        #[serde(rename = "stripFrames", default)] strip_frames: Vec<i64>,
        #[serde(rename = "hoverFrames", default)] hover_frames: Vec<i64>,
        #[serde(rename = "viewportFrames")] viewport_frames: (i64, i64),
    },
    #[serde(rename = "session_end")]
    SessionEnd {
        #[allow(dead_code)] ts: f64,
        #[serde(rename = "thumbStats")] thumb_stats: ThumbStats,
    },
}

#[derive(Debug, Deserialize, Default, Clone, Copy)]
struct ThumbStats {
    #[allow(dead_code)] count: u64,
    #[serde(rename = "avgMs")] avg_ms: f64,
    #[serde(rename = "minMs")] #[allow(dead_code)] min_ms: f64,
    #[serde(rename = "maxMs")] #[allow(dead_code)] max_ms: f64,
    #[serde(rename = "p50Ms")] p50_ms: f64,
    #[serde(rename = "p95Ms")] p95_ms: f64,
}

#[derive(Debug, Clone)]
struct PushEvent {
    ts_ms: i64,
    #[allow(dead_code)] fps: f64,
    #[allow(dead_code)] duration_secs: f64,
    playhead_frame: i64,
    #[allow(dead_code)] region_frames: Vec<(i64, i64)>,
    marker_frames: Vec<i64>,
    scene_frames: Vec<i64>,
    strip_frames: Vec<i64>,
    hover_frames: Vec<i64>,
    viewport_frames: (i64, i64),
}

#[derive(Debug)]
struct Recording {
    fps: f64,
    duration_secs: f64,
    pushes: Vec<PushEvent>,
    stats: ThumbStats,
    max_frame: i64,
}

fn parse_recording(path: &str) -> Result<Recording, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("read {path}: {e}"))?;

    let mut fps: f64 = 30.0;
    let mut duration_secs: f64 = 0.0;
    let mut pushes: Vec<PushEvent> = Vec::new();
    let mut stats = ThumbStats::default();

    for (i, line) in text.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let entry: RawEntry = serde_json::from_str(line)
            .map_err(|e| format!("line {}: {e}\n  raw: {line}", i + 1))?;
        match entry {
            RawEntry::SessionStart { fps: f, duration, .. } => {
                fps = f;
                duration_secs = duration;
            }
            RawEntry::PriorityPush {
                ts, fps: f, duration, playhead_frame, region_frames, marker_frames,
                scene_frames, strip_frames, hover_frames, viewport_frames, ..
            } => {
                if duration_secs <= 0.0 { duration_secs = duration; }
                if fps <= 0.0 { fps = f; }
                pushes.push(PushEvent {
                    ts_ms: ts as i64,
                    fps: f,
                    duration_secs: duration,
                    playhead_frame,
                    region_frames,
                    marker_frames,
                    scene_frames,
                    strip_frames,
                    hover_frames,
                    viewport_frames,
                });
            }
            RawEntry::SessionEnd { thumb_stats, .. } => {
                stats = thumb_stats;
            }
        }
    }

    if pushes.is_empty() {
        return Err("recording has no priority_push events".to_string());
    }
    // Fallback model if the trace didn't capture any extraction timings.
    if stats.p50_ms <= 0.0 { stats.p50_ms = 60.0; }
    if stats.p95_ms <= stats.p50_ms { stats.p95_ms = stats.p50_ms * 2.5; }
    if stats.avg_ms <= 0.0 { stats.avg_ms = stats.p50_ms * 1.3; }

    let max_frame = (duration_secs * fps).floor() as i64;

    Ok(Recording { fps, duration_secs, pushes, stats, max_frame })
}

// ── Scoring parameters ───────────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct Params {
    cache_size: usize,
    req_radius: i64,
    w_dist: f64,
    dist_falloff: f64,
    w_rec: f64,
    rec_tau_secs: f64,
    w_mark: f64,
    mark_radius: f64,
    /// `true` ⇒ scene cuts are merged into the marker set (matches today's prod).
    /// `false` ⇒ scene cuts are ignored entirely.
    include_scenes_as_markers: bool,
    /// `true` ⇒ strip + hover frames are pinned (treated as required-window
    /// equivalents that can never be evicted).
    pin_strip_frames: bool,
}

impl Params {
    fn sandbox_default(cache_size: usize) -> Self {
        Self {
            cache_size,
            req_radius: 3,
            w_dist: 0.0,
            dist_falloff: 89.0,
            w_rec: 0.12,
            rec_tau_secs: 99.0,
            w_mark: 0.39,
            mark_radius: 72.0,
            include_scenes_as_markers: false,
            pin_strip_frames: false,
        }
    }
}

/// Mirrors the additive sandbox scoring. Used by Policy::Scored.
fn score_sandbox(p: &Params, ph: i64, markers: &[i64], frame: i64, age_secs: f64) -> f64 {
    let d = (frame - ph).abs() as f64;
    let dist = (-d / p.dist_falloff.max(1e-6)).exp();
    let rec  = (-age_secs / p.rec_tau_secs.max(1e-6)).exp();
    let mark = if markers.is_empty() {
        0.0
    } else {
        // Nearest-marker distance only — exp-falloff is dominated by the closest.
        let mut best = f64::INFINITY;
        for &m in markers {
            let d = (frame - m).abs() as f64;
            if d < best { best = d; }
        }
        (-best / p.mark_radius.max(1e-6)).exp()
    };
    p.w_dist * dist + p.w_rec * rec + p.w_mark * mark
}

/// Mirrors today's `src-tauri/src/thumbnails.rs::frame_score` (tiered).
fn score_prod_tiered(ph: i64, markers: &[i64], viewport: (i64, i64), frame: i64, age_secs: f64) -> f64 {
    const REQ_RADIUS: i64 = 8;
    const T_PLAYHEAD_BASE: f64 = 1000.0;
    const T_PLAYHEAD_GRADIENT: f64 = 100.0;
    const T_MARKER_BASE: f64 = 100.0;
    const T_MARKER_PLAYHEAD: f64 = 50.0;
    const T_MARKER_VIEWPORT: f64 = 25.0;
    const T_NEAR_MARKER: f64 = 10.0;
    const T_RECENCY: f64 = 5.0;
    const DIST_FALLOFF: f64 = 90.0;
    const MARK_RADIUS: f64 = 72.0;
    const REC_TAU_SECS: f64 = 99.0;

    let recency = (-age_secs / REC_TAU_SECS).exp();
    let recency_term = T_RECENCY * recency;
    let d_ph = (frame - ph).abs();

    if d_ph <= REQ_RADIUS {
        let closeness = 1.0 - (d_ph as f64) / (REQ_RADIUS as f64);
        return T_PLAYHEAD_BASE + T_PLAYHEAD_GRADIENT * closeness + recency_term;
    }
    let is_marker = markers.binary_search(&frame).is_ok();
    if is_marker {
        let prox = (-(d_ph as f64) / DIST_FALLOFF).exp();
        let (vp_lo, vp_hi) = viewport;
        let in_vp = if frame >= vp_lo && frame <= vp_hi { 1.0 } else { 0.0 };
        return T_MARKER_BASE + T_MARKER_PLAYHEAD * prox + T_MARKER_VIEWPORT * in_vp + recency_term;
    }
    let mark_prox = markers.iter().fold(0.0_f64, |acc, &m| {
        acc.max((-((frame - m).abs() as f64) / MARK_RADIUS).exp())
    });
    T_NEAR_MARKER * mark_prox + recency_term
}

// ── Policies ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
enum Policy {
    /// Drop oldest insertion when over capacity. No scoring; picks the
    /// least-recently-inserted uncached candidate around playhead window.
    Fifo { cache_size: usize, req_radius: i64 },
    /// Pure LRU by touch time. Picks the closest-to-playhead uncached frame.
    Lru { cache_size: usize, req_radius: i64 },
    /// Closest-to-playhead only. Mirrors what `frame_priority = |f - ph|`
    /// looked like before the sandbox.
    Distance { cache_size: usize, req_radius: i64 },
    /// Today's tiered scoring in `src-tauri/src/thumbnails.rs`.
    ProdTiered { cache_size: usize },
    /// Sandbox additive scoring with tunable weights.
    Scored(Params),
}

impl Policy {
    fn name(&self) -> String {
        match self {
            Policy::Fifo { cache_size, .. } => format!("FIFO  (cap={cache_size})"),
            Policy::Lru  { cache_size, .. } => format!("LRU   (cap={cache_size})"),
            Policy::Distance { cache_size, .. } => format!("Dist  (cap={cache_size})"),
            Policy::ProdTiered { cache_size } => format!("Prod-tiered (cap={cache_size})"),
            Policy::Scored(p) => format!(
                "Scored cap={} req={} wD={:.2} wR={:.2} wM={:.2} mark_r={}",
                p.cache_size, p.req_radius, p.w_dist, p.w_rec, p.w_mark, p.mark_radius as i64,
            ),
        }
    }
    fn cache_size(&self) -> usize {
        match self {
            Policy::Fifo { cache_size, .. } => *cache_size,
            Policy::Lru  { cache_size, .. } => *cache_size,
            Policy::Distance { cache_size, .. } => *cache_size,
            Policy::ProdTiered { cache_size } => *cache_size,
            Policy::Scored(p) => p.cache_size,
        }
    }
    fn req_radius(&self) -> i64 {
        match self {
            Policy::Fifo { req_radius, .. } => *req_radius,
            Policy::Lru  { req_radius, .. } => *req_radius,
            Policy::Distance { req_radius, .. } => *req_radius,
            Policy::ProdTiered { .. } => 8,
            Policy::Scored(p) => p.req_radius,
        }
    }
}

// ── Simulator state ──────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct Ctx {
    playhead: i64,
    markers: Vec<i64>,         // sorted, deduped — user ∪ scene per policy
    viewport: (i64, i64),
    strip_frames: Vec<i64>,    // sorted, deduped
    insertion_seq: u64,        // strictly increasing per ready insertion (FIFO)
}

// Min-heap over finish_ms.
#[derive(PartialEq, Eq)]
struct WorkerKey(i64, i64);
impl Ord for WorkerKey {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        // Reverse so BinaryHeap acts as min-heap on finish_ms, tie-break by frame.
        other.0.cmp(&self.0).then(other.1.cmp(&self.1))
    }
}
impl PartialOrd for WorkerKey {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> { Some(self.cmp(other)) }
}

struct SimState {
    now_ms: i64,
    ready: HashSet<i64>,
    in_flight: HashSet<i64>,
    workers: BinaryHeap<WorkerKey>,
    /// Wall-clock touch (ms) per cached frame. Recency term uses (now - touched)/1000.
    touched_at_ms: HashMap<i64, i64>,
    /// Insertion order for FIFO eviction.
    inserted_seq: HashMap<i64, u64>,
    ctx: Ctx,
    max_frame: i64,
    /// Pending "wanted but uncached" requests, awaiting their first ready time.
    /// Map frame -> earliest ts at which it was wanted.
    waiting_for: HashMap<i64, i64>,
}

#[derive(Default, Debug, Clone)]
struct Metrics {
    pushes: u64,
    req_miss_pushes: u64,   // pushes where required-window had ≥1 miss
    strip_wants: u64,
    strip_misses: u64,
    extracts: u64,
    /// Per-frame TTR samples (ms).
    ttr_ms: Vec<i64>,
}

impl Metrics {
    fn req_miss_rate(&self) -> f64 {
        if self.pushes == 0 { 0.0 } else { self.req_miss_pushes as f64 / self.pushes as f64 }
    }
    fn strip_miss_rate(&self) -> f64 {
        if self.strip_wants == 0 { 0.0 } else { self.strip_misses as f64 / self.strip_wants as f64 }
    }
    fn ttr_p(&self, p: f64) -> i64 {
        if self.ttr_ms.is_empty() { return 0; }
        let mut v = self.ttr_ms.clone();
        v.sort_unstable();
        let idx = ((p * v.len() as f64).ceil() as usize).saturating_sub(1).min(v.len() - 1);
        v[idx]
    }
}

// ── Random extraction-time model ─────────────────────────────────────────────

/// Tiny deterministic xorshift64 — we want repeatable runs across policies.
struct Rng(u64);
impl Rng {
    fn new(seed: u64) -> Self { Self(seed.max(1)) }
    fn next_u64(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn unit_f64(&mut self) -> f64 {
        // 53-bit mantissa for a uniform (0,1].
        let bits = (self.next_u64() >> 11) | 1;
        (bits as f64) / (1u64 << 53) as f64
    }
    /// Box-Muller standard normal.
    fn std_normal(&mut self) -> f64 {
        let u1 = self.unit_f64().max(1e-300);
        let u2 = self.unit_f64();
        (-2.0_f64 * u1.ln()).sqrt() * (2.0 * std::f64::consts::PI * u2).cos()
    }
}

/// Sample a log-normal extraction time (ms) fitted to (p50, p95).
fn sample_extract_ms(rng: &mut Rng, stats: &ThumbStats) -> i64 {
    // ln(X) ~ N(mu, sigma); median = exp(mu); 95th = exp(mu + 1.645*sigma).
    let mu = stats.p50_ms.max(1.0).ln();
    let z95 = 1.645_f64;
    let sigma = ((stats.p95_ms.max(stats.p50_ms + 1.0).ln()) - mu) / z95;
    let x = (mu + sigma * rng.std_normal()).exp();
    x.round() as i64
}

// ── Candidate set + pick / evict ──────────────────────────────────────────────

const MARK_NEIGHBOR_REACH: i64 = 144; // ≈ 2 × MARK_RADIUS; matches prod's MARK_CANDIDATE_REACH

/// Union of: required window, strip pins, user-marker neighborhoods, currently
/// cached. Clamped to [0, max_frame].
fn candidate_set(state: &SimState, policy: &Policy) -> HashSet<i64> {
    let mut set: HashSet<i64> = HashSet::new();
    let req = policy.req_radius();
    let ph = state.ctx.playhead;
    let lo = (ph - req).max(0);
    let hi = (ph + req).min(state.max_frame);
    for f in lo..=hi { set.insert(f); }
    for &f in &state.ctx.strip_frames {
        if f >= 0 && f <= state.max_frame { set.insert(f); }
    }
    for &m in &state.ctx.markers {
        let lo = (m - MARK_NEIGHBOR_REACH).max(0);
        let hi = (m + MARK_NEIGHBOR_REACH).min(state.max_frame);
        for f in lo..=hi { set.insert(f); }
    }
    for &f in &state.ready { set.insert(f); }
    set
}

fn frame_age_secs(state: &SimState, frame: i64) -> f64 {
    match state.touched_at_ms.get(&frame) {
        Some(&t) => ((state.now_ms - t).max(0) as f64) / 1000.0,
        None => f64::INFINITY,
    }
}

fn score_frame(state: &SimState, policy: &Policy, frame: i64) -> f64 {
    let ctx = &state.ctx;
    let age = frame_age_secs(state, frame);
    match policy {
        Policy::Fifo { .. } => {
            // Lower insertion seq = older. Score = -seq so that newest wins.
            // For frames not yet cached we still need a tie-break: prefer near playhead.
            let seq = state.inserted_seq.get(&frame).copied().unwrap_or(u64::MAX) as f64;
            -seq * 1.0 - (frame - ctx.playhead).abs() as f64 * 1e-9
        }
        Policy::Lru { .. } => {
            // Newest touch wins; if untouched, fall back to playhead-closeness.
            let t = state.touched_at_ms.get(&frame).copied().unwrap_or(i64::MIN) as f64;
            t - (frame - ctx.playhead).abs() as f64 * 1e-6
        }
        Policy::Distance { .. } => -(frame - ctx.playhead).abs() as f64,
        Policy::ProdTiered { .. } => score_prod_tiered(ctx.playhead, &ctx.markers, ctx.viewport, frame, age),
        Policy::Scored(p) => {
            // Treat req_radius window as a hard bonus so it always tops the scored list
            // — pick_next handles it explicitly anyway, but this also keeps eviction
            // from dropping it before the explicit retain() does.
            let base = score_sandbox(p, ctx.playhead, &ctx.markers, frame, age);
            let in_req = (frame - ctx.playhead).abs() <= p.req_radius;
            let pinned = p.pin_strip_frames && ctx.strip_frames.binary_search(&frame).is_ok();
            let bonus = if in_req || pinned { 1_000_000.0 } else { 0.0 };
            base + bonus
        }
    }
}

/// Required-window frames are pinned. Optionally strip frames too (Scored.pin).
fn is_pinned(state: &SimState, policy: &Policy, frame: i64) -> bool {
    let ctx = &state.ctx;
    let req = policy.req_radius();
    if (frame - ctx.playhead).abs() <= req && frame >= 0 && frame <= state.max_frame {
        return true;
    }
    if let Policy::Scored(p) = policy {
        if p.pin_strip_frames && ctx.strip_frames.binary_search(&frame).is_ok() {
            return true;
        }
    }
    false
}

/// Scan required window outward (closest first) for un-cached / un-in-flight,
/// then the highest-scoring candidate within top-K of the cache size.
fn pick_next(state: &SimState, policy: &Policy) -> Option<i64> {
    let ph = state.ctx.playhead;
    let req = policy.req_radius();
    for r in 0..=req {
        for &off in &[-r, r] {
            let f = ph + off;
            if f < 0 || f > state.max_frame { continue; }
            if !state.ready.contains(&f) && !state.in_flight.contains(&f) {
                return Some(f);
            }
        }
    }
    // Strip pins next (if the policy pins them).
    if matches!(policy, Policy::Scored(p) if p.pin_strip_frames) {
        for &f in &state.ctx.strip_frames {
            if f < 0 || f > state.max_frame { continue; }
            if !state.ready.contains(&f) && !state.in_flight.contains(&f) {
                return Some(f);
            }
        }
    }
    let cap = policy.cache_size();
    let cands = candidate_set(state, policy);
    let mut scored: Vec<(i64, f64)> = cands.into_iter()
        .map(|f| (f, score_frame(state, policy, f)))
        .collect();
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(cap);
    scored.into_iter()
        .find(|(f, _)| !state.ready.contains(f) && !state.in_flight.contains(f))
        .map(|(f, _)| f)
}

fn evict_overflow(state: &mut SimState, policy: &Policy) {
    let cap = policy.cache_size();
    if state.ready.len() <= cap { return; }
    let mut scored: Vec<(i64, f64)> = state.ready.iter()
        .filter(|&&f| !is_pinned(state, policy, f))
        .map(|&f| (f, score_frame(state, policy, f)))
        .collect();
    scored.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
    let mut excess = state.ready.len().saturating_sub(cap);
    for (f, _) in scored.into_iter() {
        if excess == 0 { break; }
        state.ready.remove(&f);
        state.touched_at_ms.remove(&f);
        state.inserted_seq.remove(&f);
        excess -= 1;
    }
}

fn touch_near_playhead(state: &mut SimState, policy: &Policy) {
    let ph = state.ctx.playhead;
    let req = policy.req_radius();
    let now = state.now_ms;
    for f in (ph - req).max(0)..=(ph + req).min(state.max_frame) {
        if state.ready.contains(&f) {
            state.touched_at_ms.insert(f, now);
        }
    }
}

// ── Discrete-event simulation ────────────────────────────────────────────────

fn apply_push(state: &mut SimState, policy: &Policy, push: &PushEvent) {
    // Merge user markers + (optionally) scene cuts into the marker set.
    let mut markers: Vec<i64> = push.marker_frames.clone();
    if let Policy::Scored(p) = policy {
        if p.include_scenes_as_markers {
            markers.extend(push.scene_frames.iter().copied());
        }
    } else if matches!(policy, Policy::ProdTiered { .. } | Policy::Distance { .. } | Policy::Lru { .. } | Policy::Fifo { .. }) {
        // Match prod's behaviour: scenes + user merged.
        markers.extend(push.scene_frames.iter().copied());
    }
    markers.sort_unstable();
    markers.dedup();

    let mut strip = push.strip_frames.clone();
    strip.extend(push.hover_frames.iter().copied());
    strip.sort_unstable();
    strip.dedup();

    state.ctx.playhead = push.playhead_frame;
    state.ctx.markers = markers;
    state.ctx.viewport = push.viewport_frames;
    state.ctx.strip_frames = strip;
    touch_near_playhead(state, policy);
}

fn fill_workers(state: &mut SimState, policy: &Policy, stats: &ThumbStats, rng: &mut Rng) {
    while state.in_flight.len() < MAX_WORKERS {
        let Some(frame) = pick_next(state, policy) else { return; };
        state.in_flight.insert(frame);
        let dt = sample_extract_ms(rng, stats).max(1);
        let finish = state.now_ms + dt;
        state.workers.push(WorkerKey(finish, frame));
    }
}

fn record_and_wait(state: &mut SimState, policy: &Policy, push: &PushEvent, metrics: &mut Metrics) {
    metrics.pushes += 1;
    let ph = push.playhead_frame;
    let lo = (ph - METRIC_REQ_RADIUS).max(0);
    let hi = (ph + METRIC_REQ_RADIUS).min(state.max_frame);
    let mut any_miss = false;
    for f in lo..=hi {
        if !state.ready.contains(&f) {
            any_miss = true;
            state.waiting_for.entry(f).or_insert(push.ts_ms);
        }
    }
    if any_miss { metrics.req_miss_pushes += 1; }
    for &f in push.strip_frames.iter().chain(push.hover_frames.iter()) {
        if f < 0 || f > state.max_frame { continue; }
        metrics.strip_wants += 1;
        if !state.ready.contains(&f) {
            metrics.strip_misses += 1;
            state.waiting_for.entry(f).or_insert(push.ts_ms);
        }
    }
    let _ = policy;
}

// ── Reporter ──────────────────────────────────────────────────────────────────

fn print_table(rows: &[(String, Metrics)]) {
    println!(
        "| {:<54} | {:>9} | {:>10} | {:>9} | {:>8} | {:>8} |",
        "policy", "req-miss%", "strip-miss%", "extracts", "TTR p50", "TTR p95",
    );
    println!(
        "|{}|{}|{}|{}|{}|{}|",
        "-".repeat(56), "-".repeat(11), "-".repeat(12), "-".repeat(11),
        "-".repeat(10), "-".repeat(10),
    );
    for (name, m) in rows {
        println!(
            "| {:<54} | {:>8.1}% | {:>9.1}% | {:>9} | {:>6} ms | {:>6} ms |",
            truncate(name, 54),
            100.0 * m.req_miss_rate(),
            100.0 * m.strip_miss_rate(),
            m.extracts,
            m.ttr_p(0.50),
            m.ttr_p(0.95),
        );
    }
}

fn truncate(s: &str, n: usize) -> String {
    if s.len() <= n { s.to_string() } else { format!("{}…", &s[..n.saturating_sub(1)]) }
}

// ── CMA-ES optimizer ──────────────────────────────────────────────────────────
//
// Standard (μ/μ_w, λ)-CMA-ES per Hansen 2016, full covariance, search in a
// normalized [0,1]^n hypercube. Bound-handling = clamp at evaluation. Eigen-
// decomposition done in-place with Jacobi rotations (sweeps until off-diagonal
// mass < tol). Seven parameters, ~9 pop, ~60 generations ≈ 540 evals * seeds
// replicates — under a second for tiny traces, single-digit seconds otherwise.

/// One search dimension in the normalized space. `log: true` means the [0,1]
/// coordinate maps log-uniformly between `lo` and `hi` — used for radii /
/// falloffs that span orders of magnitude.
struct Dim {
    #[allow(dead_code)] name: &'static str,
    lo: f64,
    hi: f64,
    log: bool,
}

const DIMS: [Dim; 7] = [
    Dim { name: "req_radius",   lo: 1.0,  hi: 15.0,  log: false },
    Dim { name: "w_dist",       lo: 0.0,  hi: 3.0,   log: false },
    Dim { name: "dist_falloff", lo: 20.0, hi: 400.0, log: true  },
    Dim { name: "w_rec",        lo: 0.0,  hi: 2.0,   log: false },
    Dim { name: "rec_tau_secs", lo: 5.0,  hi: 500.0, log: true  },
    Dim { name: "w_mark",       lo: 0.0,  hi: 5.0,   log: false },
    Dim { name: "mark_radius",  lo: 10.0, hi: 400.0, log: true  },
];

fn unit_to_param(d: &Dim, u: f64) -> f64 {
    let u = u.clamp(0.0, 1.0);
    if d.log {
        (d.lo.ln() + u * (d.hi.ln() - d.lo.ln())).exp()
    } else {
        d.lo + u * (d.hi - d.lo)
    }
}

fn param_to_unit(d: &Dim, v: f64) -> f64 {
    if d.log {
        ((v.max(d.lo).min(d.hi).ln() - d.lo.ln()) / (d.hi.ln() - d.lo.ln())).clamp(0.0, 1.0)
    } else {
        ((v - d.lo) / (d.hi - d.lo)).clamp(0.0, 1.0)
    }
}

fn z_to_params(z: &[f64], cache_size: usize) -> Params {
    Params {
        cache_size,
        req_radius:   unit_to_param(&DIMS[0], z[0]).round() as i64,
        w_dist:       unit_to_param(&DIMS[1], z[1]),
        dist_falloff: unit_to_param(&DIMS[2], z[2]),
        w_rec:        unit_to_param(&DIMS[3], z[3]),
        rec_tau_secs: unit_to_param(&DIMS[4], z[4]),
        w_mark:       unit_to_param(&DIMS[5], z[5]),
        mark_radius:  unit_to_param(&DIMS[6], z[6]),
        include_scenes_as_markers: false,
        pin_strip_frames: false,
    }
}

fn params_to_z(p: &Params) -> Vec<f64> {
    vec![
        param_to_unit(&DIMS[0], p.req_radius as f64),
        param_to_unit(&DIMS[1], p.w_dist),
        param_to_unit(&DIMS[2], p.dist_falloff),
        param_to_unit(&DIMS[3], p.w_rec),
        param_to_unit(&DIMS[4], p.rec_tau_secs),
        param_to_unit(&DIMS[5], p.w_mark),
        param_to_unit(&DIMS[6], p.mark_radius),
    ]
}

/// Scalarized multi-objective: tight on required-window misses (10× weight),
/// medium on strip misses (5×), and TTR p95 in seconds adds linearly. Averaged
/// over `seeds` independent sim runs to attenuate lognormal noise.
fn objective(rec: &Recording, params: &Params, seeds: u64) -> f64 {
    let mut sum = 0.0;
    for s in 1..=seeds {
        let m = run_with_state(rec, &Policy::Scored(params.clone()), s);
        let ttr_s = (m.ttr_p(0.95) as f64) / 1000.0;
        sum += ttr_s + 10.0 * m.req_miss_rate() + 5.0 * m.strip_miss_rate();
    }
    sum / (seeds as f64)
}

// ── Tiny linear algebra (symmetric eigen via Jacobi) ─────────────────────────

fn eye(n: usize) -> Vec<Vec<f64>> {
    let mut m = vec![vec![0.0; n]; n];
    for i in 0..n { m[i][i] = 1.0; }
    m
}

fn mat_vec(m: &[Vec<f64>], v: &[f64]) -> Vec<f64> {
    let n = m.len();
    let mut out = vec![0.0; n];
    for i in 0..n {
        let mut s = 0.0;
        for j in 0..n { s += m[i][j] * v[j]; }
        out[i] = s;
    }
    out
}

/// Returns (eigenvalues, eigenvectors-as-columns-of-B). Operates on a copy of
/// `a` (must be symmetric). 50 sweeps is well above what 7×7 ever needs.
fn jacobi_eigen(a_in: &[Vec<f64>]) -> (Vec<f64>, Vec<Vec<f64>>) {
    let n = a_in.len();
    let mut a: Vec<Vec<f64>> = a_in.iter().map(|r| r.clone()).collect();
    let mut v = eye(n);
    for _ in 0..50 {
        let mut off = 0.0;
        for p in 0..n {
            for q in (p+1)..n { off += a[p][q].abs(); }
        }
        if off < 1e-12 { break; }
        for p in 0..n {
            for q in (p+1)..n {
                if a[p][q].abs() < 1e-14 { continue; }
                let theta = (a[q][q] - a[p][p]) / (2.0 * a[p][q]);
                let t = if theta >= 0.0 {
                    1.0 / (theta + (1.0 + theta*theta).sqrt())
                } else {
                    1.0 / (theta - (1.0 + theta*theta).sqrt())
                };
                let c = 1.0 / (1.0 + t*t).sqrt();
                let s = t * c;
                let app = a[p][p]; let aqq = a[q][q]; let apq = a[p][q];
                a[p][p] = app - t * apq;
                a[q][q] = aqq + t * apq;
                a[p][q] = 0.0; a[q][p] = 0.0;
                for i in 0..n {
                    if i != p && i != q {
                        let aip = a[i][p]; let aiq = a[i][q];
                        a[i][p] = c*aip - s*aiq;
                        a[p][i] = a[i][p];
                        a[i][q] = s*aip + c*aiq;
                        a[q][i] = a[i][q];
                    }
                    let vip = v[i][p]; let viq = v[i][q];
                    v[i][p] = c*vip - s*viq;
                    v[i][q] = s*vip + c*viq;
                }
            }
        }
    }
    let evals: Vec<f64> = (0..n).map(|i| a[i][i]).collect();
    (evals, v)
}

struct CmaEs {
    n: usize,
    mean: Vec<f64>,
    sigma: f64,
    c: Vec<Vec<f64>>,
    b: Vec<Vec<f64>>,   // columns = eigenvectors of C
    d: Vec<f64>,        // sqrt of eigenvalues of C
    pc: Vec<f64>,
    ps: Vec<f64>,
    gen: usize,
    last_eigen_gen: usize,

    lambda: usize,
    mu: usize,
    weights: Vec<f64>,
    mueff: f64,
    cc: f64,
    cs: f64,
    c1: f64,
    cmu: f64,
    damps: f64,
    chi_n: f64,
}

impl CmaEs {
    fn new(initial_mean: Vec<f64>, initial_sigma: f64) -> Self {
        let n = initial_mean.len();
        let nf = n as f64;
        let lambda = 4 + (3.0 * nf.ln()).floor() as usize;
        let mu = lambda / 2;

        // Recombination weights: ln((λ+1)/2) - ln(i), positive μ kept + renormalized.
        let raw: Vec<f64> = (1..=mu)
            .map(|i| ((lambda as f64 + 1.0) / 2.0).ln() - (i as f64).ln())
            .collect();
        let sum_w: f64 = raw.iter().sum();
        let weights: Vec<f64> = raw.iter().map(|w| w / sum_w).collect();
        let mueff: f64 = 1.0 / weights.iter().map(|w| w * w).sum::<f64>();

        let cc = (4.0 + mueff / nf) / (nf + 4.0 + 2.0 * mueff / nf);
        let cs = (mueff + 2.0) / (nf + mueff + 5.0);
        let c1 = 2.0 / ((nf + 1.3).powi(2) + mueff);
        let cmu = ((2.0 * (mueff - 2.0 + 1.0 / mueff)) / ((nf + 2.0).powi(2) + mueff)).min(1.0 - c1);
        let damps = 1.0 + 2.0 * ((mueff - 1.0).max(0.0) / (nf + 1.0)).sqrt().max(0.0) + cs;
        let chi_n = nf.sqrt() * (1.0 - 1.0 / (4.0 * nf) + 1.0 / (21.0 * nf * nf));

        Self {
            n, mean: initial_mean, sigma: initial_sigma,
            c: eye(n), b: eye(n), d: vec![1.0; n],
            pc: vec![0.0; n], ps: vec![0.0; n],
            gen: 0, last_eigen_gen: 0,
            lambda, mu, weights, mueff, cc, cs, c1, cmu, damps, chi_n,
        }
    }

    /// Sample `lambda` candidates from N(mean, sigma^2 * C).
    fn ask(&self, rng: &mut Rng) -> Vec<Vec<f64>> {
        let mut out = Vec::with_capacity(self.lambda);
        for _ in 0..self.lambda {
            // y = B * D * z, where z ~ N(0,I)
            let z: Vec<f64> = (0..self.n).map(|_| rng.std_normal()).collect();
            let dz: Vec<f64> = z.iter().zip(self.d.iter()).map(|(zi, di)| zi * di).collect();
            let y = mat_vec(&self.b, &dz);
            let x: Vec<f64> = self.mean.iter().zip(y.iter()).map(|(m, yi)| m + self.sigma * yi).collect();
            out.push(x);
        }
        out
    }

    fn tell(&mut self, samples: Vec<Vec<f64>>, fitnesses: Vec<f64>) {
        // Sort indices ascending by fitness (minimization).
        let mut idx: Vec<usize> = (0..samples.len()).collect();
        idx.sort_by(|&a, &b| fitnesses[a].partial_cmp(&fitnesses[b]).unwrap_or(std::cmp::Ordering::Equal));

        let m_old = self.mean.clone();
        // Weighted mean of best μ.
        let mut new_mean = vec![0.0; self.n];
        for k in 0..self.mu {
            let xk = &samples[idx[k]];
            let w = self.weights[k];
            for i in 0..self.n { new_mean[i] += w * xk[i]; }
        }
        self.mean = new_mean;

        // y_w = (mean - m_old) / sigma  ==  sum w_k * y_k
        let yw: Vec<f64> = self.mean.iter().zip(m_old.iter())
            .map(|(m, mo)| (m - mo) / self.sigma).collect();

        // C^{-1/2} y_w  =  B * diag(1/D) * B^T * y_w
        let bt_yw = {
            let mut out = vec![0.0; self.n];
            for j in 0..self.n {
                let mut s = 0.0;
                for i in 0..self.n { s += self.b[i][j] * yw[i]; }
                out[j] = s;
            }
            out
        };
        let dinv_btyw: Vec<f64> = bt_yw.iter().zip(self.d.iter())
            .map(|(v, di)| v / di.max(1e-20)).collect();
        let c_inv_half_yw = mat_vec(&self.b, &dinv_btyw);

        // p_sigma update
        let coef = (self.cs * (2.0 - self.cs) * self.mueff).sqrt();
        for i in 0..self.n {
            self.ps[i] = (1.0 - self.cs) * self.ps[i] + coef * c_inv_half_yw[i];
        }
        let ps_norm: f64 = self.ps.iter().map(|x| x * x).sum::<f64>().sqrt();

        // h_sigma gate (avoid spurious C inflation while sigma is still moving)
        let denom = (1.0 - (1.0 - self.cs).powi(2 * (self.gen as i32 + 1))).sqrt().max(1e-20);
        let h_sigma = if ps_norm / denom < (1.4 + 2.0 / (self.n as f64 + 1.0)) * self.chi_n { 1.0 } else { 0.0 };

        // p_c update
        let coef2 = (self.cc * (2.0 - self.cc) * self.mueff).sqrt();
        for i in 0..self.n {
            self.pc[i] = (1.0 - self.cc) * self.pc[i] + h_sigma * coef2 * yw[i];
        }

        // Covariance update: rank-1 (pc ⊗ pc) + rank-μ (Σ w_k y_k ⊗ y_k)
        let delta_hs = (1.0 - h_sigma) * self.cc * (2.0 - self.cc);
        for i in 0..self.n {
            for j in 0..self.n {
                let old = self.c[i][j];
                let rank1 = self.pc[i] * self.pc[j] + delta_hs * old;
                let mut rank_mu = 0.0;
                for k in 0..self.mu {
                    let xk = &samples[idx[k]];
                    let yk_i = (xk[i] - m_old[i]) / self.sigma;
                    let yk_j = (xk[j] - m_old[j]) / self.sigma;
                    rank_mu += self.weights[k] * yk_i * yk_j;
                }
                self.c[i][j] = (1.0 - self.c1 - self.cmu) * old
                             + self.c1 * rank1
                             + self.cmu * rank_mu;
            }
        }

        // Sigma update
        self.sigma *= ((self.cs / self.damps) * (ps_norm / self.chi_n - 1.0)).exp();
        // Soft cap so a runaway sigma can't push us to ±∞.
        self.sigma = self.sigma.clamp(1e-6, 10.0);

        self.gen += 1;

        // Re-eigen every ~n/(c1+cmu)/10 generations (Hansen's rule of thumb).
        let eigen_period = (1.0 / (self.c1 + self.cmu) / (self.n as f64) / 10.0).ceil() as usize;
        if self.gen - self.last_eigen_gen >= eigen_period.max(1) {
            // Symmetrize defensively.
            for i in 0..self.n {
                for j in (i+1)..self.n {
                    let avg = 0.5 * (self.c[i][j] + self.c[j][i]);
                    self.c[i][j] = avg; self.c[j][i] = avg;
                }
            }
            let (evals, evecs) = jacobi_eigen(&self.c);
            self.b = evecs;
            self.d = evals.iter().map(|e| e.max(1e-20).sqrt()).collect();
            self.last_eigen_gen = self.gen;
        }
    }
}

fn optimize_cmaes(rec: &Recording, cache_size: usize, generations: usize, seeds: u64)
    -> (Params, f64, Vec<f64>)
{
    // Start from the sandbox defaults — they're a decent prior for this objective.
    let start = params_to_z(&Params::sandbox_default(cache_size));
    let mut cma = CmaEs::new(start, 0.3);
    let mut rng = Rng::new(42);
    let mut best_z = cma.mean.clone();
    let mut best_f = f64::INFINITY;
    let mut trace: Vec<f64> = Vec::with_capacity(generations);

    for _ in 0..generations {
        let samples = cma.ask(&mut rng);
        let fitnesses: Vec<f64> = samples.iter().map(|x| {
            let p = z_to_params(x, cache_size);
            objective(rec, &p, seeds)
        }).collect();
        for (x, &f) in samples.iter().zip(fitnesses.iter()) {
            if f < best_f { best_f = f; best_z = x.clone(); }
        }
        trace.push(best_f);
        cma.tell(samples, fitnesses);
    }
    (z_to_params(&best_z, cache_size), best_f, trace)
}

// ── Main ──────────────────────────────────────────────────────────────────────

fn main() {
    let raw: Vec<String> = env::args().collect();
    // Manual flag parsing — keeps the crate dependency-free.
    let mut positional: Vec<String> = Vec::new();
    let mut optimize = false;
    let mut generations: usize = 60;
    let mut seeds: u64 = 5;
    let mut i = 1;
    while i < raw.len() {
        let a = &raw[i];
        match a.as_str() {
            "--optimize" | "-O" => optimize = true,
            "--seeds" => {
                i += 1;
                seeds = raw.get(i).and_then(|s| s.parse().ok()).unwrap_or(5).max(1);
            }
            "--generations" | "--gens" => {
                i += 1;
                generations = raw.get(i).and_then(|s| s.parse().ok()).unwrap_or(60).max(1);
            }
            _ => positional.push(a.clone()),
        }
        i += 1;
    }
    if positional.is_empty() {
        eprintln!(
            "usage: {} <recording.jsonl> [cache_size] [--optimize] [--seeds N] [--generations N]\n\n\
             Produces a markdown table comparing cache policies. With --optimize, runs CMA-ES\n\
             over the additive-scorer parameters.",
            raw[0],
        );
        std::process::exit(2);
    }
    let path = &positional[0];
    let cache_size: usize = positional.get(1).and_then(|s| s.parse().ok()).unwrap_or(2000);

    let rec = match parse_recording(path) {
        Ok(r) => r,
        Err(e) => { eprintln!("failed to parse recording: {e}"); std::process::exit(1); }
    };

    println!("# Thumbnail-cache simulation");
    println!();
    println!(
        "Recording: `{}`\n- fps: {:.3}\n- duration: {:.1}s ({} frames)\n- pushes: {}\n- extract p50: {:.0}ms · p95: {:.0}ms · avg: {:.0}ms",
        path, rec.fps, rec.duration_secs, rec.max_frame, rec.pushes.len(),
        rec.stats.p50_ms, rec.stats.p95_ms, rec.stats.avg_ms,
    );
    println!();
    println!("Cache size: {cache_size}. Workers: {MAX_WORKERS}. Seed: 1.\n");

    // ── Baselines ────────────────────────────────────────────────────────────
    let baselines = vec![
        Policy::Fifo { cache_size, req_radius: 3 },
        Policy::Lru  { cache_size, req_radius: 3 },
        Policy::Distance { cache_size, req_radius: 3 },
        Policy::ProdTiered { cache_size },
        Policy::Scored({
            let mut p = Params::sandbox_default(cache_size);
            p.req_radius = 3;
            p
        }),
        Policy::Scored({
            let mut p = Params::sandbox_default(cache_size);
            p.pin_strip_frames = true;
            p
        }),
        Policy::Scored({
            let mut p = Params::sandbox_default(cache_size);
            p.include_scenes_as_markers = true;
            p
        }),
    ];

    println!("## Baselines\n");
    let mut rows: Vec<(String, Metrics)> = baselines.iter()
        .map(|pol| (pol.name(), run_with_state(&rec, pol, 1)))
        .collect();
    rows.sort_by(|a, b| a.1.ttr_p(0.95).cmp(&b.1.ttr_p(0.95)));
    print_table(&rows);
    println!();

    // ── Sweep around the sandbox additive scorer ─────────────────────────────
    println!("## Sweep — additive scorer, top configs by TTR p95\n");
    let mut sweep_rows: Vec<(String, Metrics)> = Vec::new();
    let w_dists = [0.0, 0.1, 0.3];
    let w_recs  = [0.05, 0.12, 0.30];
    let w_marks = [0.20, 0.39, 0.80, 1.50];
    let mark_radii = [36.0, 72.0, 144.0];
    let req_radii = [3, 6, 10];
    for &req in &req_radii {
        for &wd in &w_dists {
            for &wr in &w_recs {
                for &wm in &w_marks {
                    for &mr in &mark_radii {
                        let p = Params {
                            cache_size,
                            req_radius: req,
                            w_dist: wd,
                            dist_falloff: 90.0,
                            w_rec: wr,
                            rec_tau_secs: 99.0,
                            w_mark: wm,
                            mark_radius: mr,
                            include_scenes_as_markers: false,
                            pin_strip_frames: false,
                        };
                        let pol = Policy::Scored(p);
                        sweep_rows.push((pol.name(), run_with_state(&rec, &pol, 1)));
                    }
                }
            }
        }
    }
    sweep_rows.sort_by(|a, b| {
        let ka = (a.1.ttr_p(0.95), a.1.req_miss_pushes, a.1.strip_misses);
        let kb = (b.1.ttr_p(0.95), b.1.req_miss_pushes, b.1.strip_misses);
        ka.cmp(&kb)
    });
    let top: Vec<(String, Metrics)> = sweep_rows.iter().take(8).cloned().collect();
    print_table(&top);
    println!();
    println!(
        "(swept {} configs over req_radius × w_dist × w_rec × w_mark × mark_radius)",
        sweep_rows.len(),
    );

    // ── CMA-ES optimization ──────────────────────────────────────────────────
    if optimize {
        println!();
        println!("## CMA-ES optimization");
        println!();
        println!(
            "Search space: 7 params (req_radius, w_dist, dist_falloff, w_rec, rec_tau, w_mark, mark_radius).\n\
             Objective per eval: TTR_p95_secs + 10·req_miss + 5·strip_miss, averaged over {seeds} seeds.\n\
             Population λ=auto, generations={generations}, initial σ=0.3.\n"
        );

        let (best, best_f, trace) = optimize_cmaes(&rec, cache_size, generations, seeds);

        // Convergence trace — print every Kth generation so it's readable.
        let stride = (trace.len() / 10).max(1);
        println!("Convergence (best-so-far):");
        for (g, f) in trace.iter().enumerate().filter(|(g, _)| g % stride == 0 || *g == trace.len() - 1) {
            println!("- gen {:>3}: {:.4}", g, f);
        }
        println!();

        println!("Best objective: **{:.4}**\n", best_f);
        println!("Best params:");
        println!("- req_radius:   {}", best.req_radius);
        println!("- w_dist:       {:.3}", best.w_dist);
        println!("- dist_falloff: {:.1}", best.dist_falloff);
        println!("- w_rec:        {:.3}", best.w_rec);
        println!("- rec_tau_secs: {:.1}", best.rec_tau_secs);
        println!("- w_mark:       {:.3}", best.w_mark);
        println!("- mark_radius:  {:.1}", best.mark_radius);
        println!();

        // Re-run once with seed=1 so the row matches the baseline section's seed.
        let pol = Policy::Scored(best.clone());
        let m = run_with_state(&rec, &pol, 1);
        println!("## Final comparison: CMA-ES best vs prod-tiered (seed=1)\n");
        let rows = vec![
            ("Prod-tiered".to_string(), run_with_state(&rec, &Policy::ProdTiered { cache_size }, 1)),
            ("Sandbox-default".to_string(), run_with_state(&rec, &Policy::Scored(Params::sandbox_default(cache_size)), 1)),
            ("CMA-ES best".to_string(), m),
        ];
        print_table(&rows);
    }
}

fn run_with_state(rec: &Recording, policy: &Policy, seed: u64) -> Metrics {
    let mut rng = Rng::new(seed);
    let mut state = SimState {
        now_ms: 0,
        ready: HashSet::new(),
        in_flight: HashSet::new(),
        workers: BinaryHeap::new(),
        touched_at_ms: HashMap::new(),
        inserted_seq: HashMap::new(),
        ctx: Ctx {
            playhead: 0,
            markers: Vec::new(),
            viewport: (0, 0),
            strip_frames: Vec::new(),
            insertion_seq: 0,
        },
        max_frame: rec.max_frame.max(1),
        waiting_for: HashMap::new(),
    };
    let mut metrics = Metrics::default();
    let mut pushes: VecDeque<&PushEvent> = rec.pushes.iter().collect();
    let trace_end_ms = rec.pushes.last().map(|p| p.ts_ms).unwrap_or(0);

    loop {
        let next_push_ts = pushes.front().map(|p| p.ts_ms);
        let next_finish_ts = state.workers.peek().map(|w| w.0);
        let next_ts = match (next_push_ts, next_finish_ts) {
            (Some(a), Some(b)) => a.min(b),
            (Some(a), None) => a,
            (None, Some(b)) => b,
            (None, None) => break,
        };

        while let Some(top) = state.workers.peek() {
            if top.0 > next_ts { break; }
            let WorkerKey(finish_ms, frame) = state.workers.pop().unwrap();
            state.now_ms = finish_ms.max(state.now_ms);
            state.in_flight.remove(&frame);
            state.ready.insert(frame);
            state.touched_at_ms.insert(frame, state.now_ms);
            state.ctx.insertion_seq += 1;
            state.inserted_seq.insert(frame, state.ctx.insertion_seq);
            metrics.extracts += 1;
            if let Some(req_ms) = state.waiting_for.remove(&frame) {
                metrics.ttr_ms.push(state.now_ms - req_ms);
            }
            evict_overflow(&mut state, policy);
            // Only top up workers while there are still pushes to come — otherwise
            // pick_next keeps returning candidates and we'd churn indefinitely.
            if !pushes.is_empty() {
                fill_workers(&mut state, policy, &rec.stats, &mut rng);
            }
        }

        if Some(next_ts) == next_push_ts {
            let push = pushes.pop_front().unwrap();
            state.now_ms = next_ts.max(state.now_ms);
            apply_push(&mut state, policy, push);
            record_and_wait(&mut state, policy, push, &mut metrics);
            evict_overflow(&mut state, policy);
            fill_workers(&mut state, policy, &rec.stats, &mut rng);
        }
    }

    for &req_ms in state.waiting_for.values() {
        let cap = trace_end_ms + NEVER_READY_PAD_MS;
        metrics.ttr_ms.push((cap - req_ms).max(0));
    }
    metrics
}
