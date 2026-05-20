# Thumbnail cache: sandbox-driven design

Source of truth for this doc: `thumbnail-cache-2026-04-21T07-51-52.json`, a recorded playhead/marker session replayed through the sandbox optimizer.

## Optimized parameters

| Param         | Value   | What it means                                                      |
| ------------- | ------- | ------------------------------------------------------------------ |
| `cacheSize`   | 99      | (Sandbox constraint — maps to `max_cached_frames` in prod.)        |
| `reqRadius`   | 3       | **Hard requirement**: frames within ±3 of playhead MUST be cached. |
| `wDist`       | **0.0** | Distance-to-playhead weight in the soft score.                     |
| `distFalloff` | 89      | (Unused — `wDist` is 0.)                                           |
| `wRec`        | 0.12    | Recency weight.                                                    |
| `recTau`      | 99 s    | Recency decay constant (seconds).                                  |
| `wMark`       | 0.39    | Marker weight.                                                     |
| `markRadius`  | 72      | Gaussian-ish falloff around each marker.                           |
| `markMode`    | `add`   | Marker contribution added to base score.                           |

### Scoring formula (from the sandbox)

For each frame `i`:

```
score(i) = wDist * exp(-|i - playhead| / distFalloff)
         + wRec  * exp(-age_seconds(i) / recTau)
         + wMark * max_m( exp(-|i - m| / markRadius) )   // m ∈ markers
```

Cache membership: all frames in `[playhead - reqRadius, playhead + reqRadius]`
**plus** the top `(cacheSize - reqWindowSize)` scoring frames from the rest.

### What's surprising

- **`wDist = 0`.** The optimizer discovered that once `reqRadius` forces the playhead neighbourhood into the cache, spending cache slots on soft distance bias is wasteful. Slots are better spent on markers the user revisits and recent history.
- **Markers dominate (0.39) over recency (0.12).** User-placed markers are a strong predictor of near-future playhead landings — much stronger than "where were you recently."
- **Long recency τ (99s).** Recency is used more like a slow LRU than a short-term bias.

---

## How this maps to `src-tauri/src/thumbnails.rs`

### Current state

- `frame_priority` is just `|frame - playhead|`. Markers / regions / scenes / viewport are parsed into `PriorityContext` but ignored (the tier logic is commented out).
- `candidate_frames` only considers `[playhead - W, playhead + W]` where `W = candidate_window(max_cached) ∈ [60, 400]`. Frames outside that window are never scheduled, even if there's marker activity there.
- Eviction is LRU on `frame_touched` (monotonic counter, incremented when playhead passes near).
- No prefetch around markers.

### Gaps vs the optimized algorithm

| Sandbox                                    | lockstep today                                  |
| ------------------------------------------ | ----------------------------------------------- |
| Scoring = distance + recency + marker      | Scoring = distance only                         |
| `reqRadius` (hard mandatory window)        | `PLAYHEAD_WINDOW=15` (only a CPU-priority hint) |
| Candidate set = whole timeline, top-K wins | Candidate set = narrow window around playhead   |
| Marker neighborhoods prefetched            | Markers ignored                                 |
| Eviction = lowest score                    | Eviction = oldest LRU touch                     |

The window-based candidate set is the biggest limitation: no amount of marker scoring helps if frames around a marker at playhead+1500 never enter the candidate list.

---

## Two marker types: user vs scene

User markers are intentional (1–20, likely to be visited). Scene markers are auto-generated (100s, most never visited) **and** their exact frames are displayed as thumbnails in the scene strip — so a subset of them are on screen right now and their single frames MUST be cached.

### Three-bucket model

Only the playhead window is truly hard-required. Everything else — including visible scene markers — is soft-scored, with weights chosen so the ordering is predictable under any cache size. If the UI shows so many scene thumbnails that they can't all fit, the cache degrades gracefully by keeping the ones closest to the viewport.

1. **Playhead window** `[playhead ± REQ_RADIUS]`: hard required. Small (~7 frames). Always fits.
2. **Visible scene markers**: soft with a dominating weight. Each gets a score far above anything a user marker or recency could produce, so whenever slots exist they're cached first. When they don't all fit, proximity to the viewport breaks ties.
3. **User markers + all scene markers + recency**: standard soft score, exactly as optimized by the sandbox.

### Frontend change

Add `visible_scene_frames: Vec<i64>` to `PriorityRequest`. The strip component already knows which scene markers it's rendering; pass that subset explicitly. Keep `scene_frames` for the full list (weak prefetch signal only).

### Scoring

```rust
// Dominates everything else. 5.0 >> 0.39 + 0.12 + 0.02 = max possible soft score.
const W_VISIBLE_SCENE: f64 = 5.0;

const W_USER_MARK: f64  = 0.39;
const W_SCENE_MARK: f64 = 0.02;
const MARK_RADIUS: f64  = 72.0;

fn frame_score(ctx: &PriorityContext, frame: i64, age_secs: f64) -> f64 {
    let d = (frame - ctx.playhead_frame).abs() as f64;
    let mut s = W_DIST * (-d / DIST_FALLOFF).exp()
              + W_REC  * (-age_secs / REC_TAU_SECS).exp()
              + W_USER_MARK  * marker_term(&ctx.marker_frames, MARK_RADIUS, frame)
              + W_SCENE_MARK * marker_term(&ctx.scene_frames,  MARK_RADIUS, frame);

    if ctx.visible_scene_frames.binary_search(&frame).is_ok() {
        // Normalize proximity by viewport half-width so the ordering of visible
        // scenes is scale-invariant: at 1x zoom and at 10x zoom, the scene at
        // the viewport center gets score 1.0 and the one at the viewport edge
        // gets exp(-1) ≈ 0.37. A huge viewport doesn't deflate the score; it
        // just means more scenes compete for cache slots.
        let (vs, ve) = ctx.viewport_frames;
        let half = ((ve - vs).max(1) as f64) * 0.5;
        let center = (vs + ve) / 2;
        let vd = (frame - center).abs() as f64;
        s += W_VISIBLE_SCENE * (-vd / half).exp();
    }
    s
}
```

Keep `visible_scene_frames` sorted at the API boundary so the `binary_search` is fast. Every visible scene scores ≥ `W_VISIBLE_SCENE * exp(-1) ≈ 1.84`, which still dominates the max achievable non-visible score (~0.53), so visible scenes always outrank everything else. Within the visible set, closest-to-viewport-center wins.

**Cache-budget degradation.** If the viewport is huge and shows more visible scenes than `max_cached_frames`, not all can be cached — that's physically unavoidable. The scale-invariant proximity term means the ones nearest the viewport center fill first, and the cache fills with a reasonable subset rather than a random slice. The UI shows placeholders for the rest until the user scrolls/zooms to bring them into "near center" range.

**Why no hard requirement.** A hard set that can't fit forces the cache to grow beyond capacity or to silently drop entries — inconsistent. A dominating soft weight guarantees the same outcome when slots exist _and_ degrades predictably when they don't.

```rust
const W_USER_MARK: f64  = 0.39;
const W_SCENE_MARK: f64 = 0.02;
const MARK_RADIUS: f64  = 72.0;

fn marker_term(markers: &[i64], radius: f64, frame: i64) -> f64 {
    markers.iter()
        .map(|&m| (-((frame - m).abs() as f64) / radius).exp())
        .fold(0.0_f64, f64::max)
}

fn frame_score(ctx: &PriorityContext, frame: i64, age_secs: f64) -> f64 {
    let d = (frame - ctx.playhead_frame).abs() as f64;
      W_DIST       * (-d / DIST_FALLOFF).exp()
    + W_REC        * (-age_secs / REC_TAU_SECS).exp()
    + W_USER_MARK  * marker_term(&ctx.marker_frames, MARK_RADIUS, frame)
    + W_SCENE_MARK * marker_term(&ctx.scene_frames,  MARK_RADIUS, frame)
}
```

**Cost control** — 300 scene markers × candidate union would blow up the candidate set:

1. Cap the candidate set at `max_cached_frames * 3` (score first, truncate).
2. Precompute nearest-user-marker and nearest-scene-marker distance per candidate with a single sweep — scoring becomes `O(N_cands + N_markers)` instead of `O(N_cands * N_markers)`.
3. Exclude scene-marker neighborhoods from the _candidate union_ entirely; only score them if they're already cached (so an activated scene keeps its slot) or inside the user-marker / required / playhead-distance union. The `W_SCENE_MARK * 0.02` contribution alone doesn't justify adding 43k candidate frames.

Request wiring: `PriorityRequest` already carries `marker_frames` and `scene_frames` separately — no frontend change.

---

## Proposed implementation

### 1. Replace `frame_priority`

Higher score = higher priority (sandbox convention). Flip the existing "lower = higher" convention or keep it by negating — whichever keeps diffs smaller. Suggesting higher-is-better for clarity:

```rust
// Tunable constants (see "Defaults" below). These are `f64` because the
// scoring combines exponentials at very different magnitudes.
const W_DIST: f64 = 0.0;
const DIST_FALLOFF: f64 = 89.0;
const W_REC: f64 = 0.12;
const REC_TAU_SECS: f64 = 99.0;
const W_MARK: f64 = 0.39;
const MARK_RADIUS: f64 = 72.0;
const REQ_RADIUS: i64 = 3;

fn frame_score(ctx: &PriorityContext, frame: i64, age_secs: f64) -> f64 {
    let d = (frame - ctx.playhead_frame).abs() as f64;
    let dist = (-d / DIST_FALLOFF).exp();
    let rec  = (-age_secs / REC_TAU_SECS).exp();
    let mark = ctx.marker_frames.iter()
        .map(|&m| (-((frame - m).abs() as f64) / MARK_RADIUS).exp())
        .fold(0.0_f64, f64::max);
    W_DIST * dist + W_REC * rec + W_MARK * mark
}
```

### 2. Rework `candidate_frames`

The candidate set is the union of:

- **Required frames** (must be extracted if not already cached):
    - `[playhead - REQ_RADIUS, playhead + REQ_RADIUS]` — playback needs this window.
    - `visible_scene_frames` — each is a single frame currently rendered in the scene strip.
- **Soft-score neighborhoods** (to enlarge the eviction pool):
    - `[m - MARK_RADIUS * 2, m + MARK_RADIUS * 2]` around each **user** marker.
- Everything currently cached (so the scorer can decide what to keep vs evict).

Scene markers **are not** expanded into neighborhoods. 500 × 144 frames would blow up the candidate set. The visible ones are in via `visible_scene_frames`; the rest only influence scoring if a frame is already in the union for another reason.

```rust
fn required_frames(ctx: &PriorityContext, max_frame: i64) -> Vec<i64> {
    let ph = ctx.playhead_frame;
    let mut out: Vec<i64> = ((ph - REQ_RADIUS).max(0)..=(ph + REQ_RADIUS).min(max_frame)).collect();
    for &f in &ctx.visible_scene_frames {
        if f >= 0 && f <= max_frame { out.push(f); }
    }
    out.sort_unstable();
    out.dedup();
    out
}

fn candidate_frames(st: &VideoState) -> Vec<(i64, f64)> {
    let ctx = &st.context;
    let mut set: HashSet<i64> = HashSet::new();

    for f in required_frames(ctx, st.max_frame) { set.insert(f); }

    let mr = (MARK_RADIUS * 2.0) as i64;
    for &m in &ctx.marker_frames {  // user markers only
        for f in (m - mr).max(0)..=(m + mr).min(st.max_frame) { set.insert(f); }
    }
    for &f in &st.ready { set.insert(f); }

    let now = Instant::now();
    set.into_iter()
        .map(|f| {
            let age = st.frame_touched_at.get(&f)
                .map(|t| now.duration_since(*t).as_secs_f64())
                .unwrap_or(f64::INFINITY);
            (f, frame_score(ctx, f, age))
        })
        .collect()
}
```

### 3. Separate "must cache" from "should cache"

```rust
fn pick_next(st: &VideoState) -> Option<i64> {
    // Priority 1: required frames not ready/in-flight. Within this set, prefer
    // the ones closest to the playhead — the playback window is more urgent than
    // a scene marker at the end of the strip.
    let ph = st.context.playhead_frame;
    let mut req = required_frames(&st.context, st.max_frame);
    req.sort_by_key(|f| (f - ph).abs());
    for f in req {
        if !st.ready.contains(&f) && !st.in_flight.contains(&f) {
            return Some(f);
        }
    }
    // Priority 2: highest-scoring soft candidate within top-K.
    let mut cands = candidate_frames(st);
    cands.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    cands.truncate(st.max_cached_frames);
    cands.into_iter()
        .find(|(f, _)| !st.ready.contains(f) && !st.in_flight.contains(f))
        .map(|(f, _)| f)
}
```

### 4. Rework eviction

Swap LRU-by-counter for LRU-by-score. An already-cached frame whose score has dropped below the cutoff gets evicted — _unless_ it's in the required window.

```rust
fn evict_overflow(st: &mut VideoState) {
    if st.ready.len() <= st.max_cached_frames { return; }
    let ph = st.context.playhead_frame;
    let now = Instant::now();

    let mut scored: Vec<(i64, f64)> = st.ready.iter().map(|&f| {
        let age = st.frame_touched_at.get(&f)
            .map(|t| now.duration_since(*t).as_secs_f64())
            .unwrap_or(f64::INFINITY);
        (f, frame_score(&st.context, f, age))
    }).collect();

    // Never evict required-window frames.
    scored.retain(|(f, _)| (f - ph).abs() > REQ_RADIUS);
    scored.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));

    let excess = st.ready.len() - st.max_cached_frames;
    for (f, _) in scored.into_iter().take(excess) {
        let p = thumb_path(&st.cache_dir, f);
        let _ = std::fs::remove_file(&p);
        st.ready.remove(&f);
        st.frame_touched_at.remove(&f);
    }
}
```

### 5. Replace `frame_touched: HashMap<i64, u64>` with `Instant`

The sandbox uses wall-clock seconds for recency, not a monotonic counter. Switch:

```rust
// was: frame_touched: HashMap<i64, u64>, touch_counter: u64
frame_touched_at: HashMap<i64, Instant>,
```

`touch_near_playhead` becomes:

```rust
fn touch_near_playhead(st: &mut VideoState) {
    let now = Instant::now();
    let ph = st.context.playhead_frame;
    // Touch the required window; the soft recency falls off naturally.
    for f in (ph - REQ_RADIUS).max(0)..=(ph + REQ_RADIUS).min(st.max_frame) {
        if st.ready.contains(&f) {
            st.frame_touched_at.insert(f, now);
        }
    }
}
```

Widen or narrow the touched band to taste — the sandbox got best results when recency was tied strictly to the playhead, not a surrounding window.

---

## Defaults / tuning

The sandbox numbers were optimized for a **99-frame cache over 2000 frames (≈5% coverage)**. Lockstep's default is **2000 cached / typically much longer videos** — e.g. at 30fps a 10-minute clip has 18 000 frames, so 2000 cached ≈ 11% coverage. Re-tune when possible, but these translate reasonably:

- `REQ_RADIUS = 3` — independent of cache size; keep as-is.
- `DIST_FALLOFF = 89` — scales with "how many frames left/right you expect to scrub through." 89 feels low for 30fps; try `fps * 3` (≈90 at 30fps, ≈180 at 60fps) and re-record.
- `MARK_RADIUS = 72` — should scale with typical marker-to-marker distance. 72 ≈ 2.4s at 30fps. Reasonable default.
- `REC_TAU_SECS = 99` — how long a "recent" frame stays warm. 99s ≈ 1.5 min. Reasonable default.
- Weights (0, 0.12, 0.39) — exposure as constants is fine for now; re-derive with a recording against a 2000-cache workload before shipping.

Consider adding `tauri-plugin-store` keys so these are tweakable in dev without a rebuild.

---

## Migration checklist

- [ ] Un-comment (or rip out entirely) the tier-based scoring block in `frame_priority`.
- [ ] Wire `marker_frames` through `PriorityContext` (it's already in the struct, just unused).
- [ ] Update `candidate_frames` to return the whole scored set (not a hard window).
- [ ] Split `pick_next` into required-first, top-K-second.
- [ ] Swap `u64` touch counter for `Instant`-based recency.
- [ ] Update tests in `thumbnails.rs`:
    - `playhead_window_is_highest_priority` — still valid; assert playhead is picked first.
    - `evict_overflow_drops_oldest_touched_first` — rewrite: evicted frame should be the lowest-scoring non-required, not just oldest.
    - `evict_overflow_tiebreak_drops_farther` — subsumed by score-based ranking.
    - Add: `required_window_is_never_evicted` (cache full, required frames preserved).
    - Add: `marker_neighborhood_enters_candidates` (distant marker → frames near it show up in candidates).
- [ ] `tier_name` / `QueueTierStats` in `get_thumbnail_queue_stats` — update bucket definitions so the UI isn't lying. Probably: `required`, `marker`, `recent`, `cold`.
- [ ] Consider raising `MAX_WORKERS` from 3 if the new candidate set is much larger. Or leave it — more workers = more disk/ffmpeg contention.

---

## Open questions

1. **Does the optimizer's `wDist = 0` hold up on longer recordings?** The 20s session with 99-frame cache is small. Record a 5-minute scrubbing session against a 2000-frame cache before locking in the weights.
2. **Scenes/regions/strip_frames/hover_frames.** The sandbox only models markers. If those signals matter in practice, either treat them as markers (with their own weight) or extend the sandbox to model them and re-optimize.
3. **Required-window failure mode.** If `cacheSize < 2*REQ_RADIUS + 1` the required window can't fit; current code handles it gracefully but the user should never see it. Enforce `max_cached_frames >= 2*REQ_RADIUS + 1` at the API boundary.
