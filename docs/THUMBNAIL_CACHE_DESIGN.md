# Thumbnail cache: sandbox-driven design

Source of truth for this doc: `thumbnail-cache-2026-04-21T07-51-52.json`, a recorded playhead/marker session replayed through the sandbox optimizer.

## Optimized parameters

| Param          | Value   | What it means                                                  |
|----------------|---------|----------------------------------------------------------------|
| `cacheSize`    | 99      | (Sandbox constraint — maps to `max_cached_frames` in prod.)    |
| `reqRadius`    | 3       | **Hard requirement**: frames within ±3 of playhead MUST be cached. |
| `wDist`        | **0.0** | Distance-to-playhead weight in the soft score.                 |
| `distFalloff`  | 89      | (Unused — `wDist` is 0.)                                       |
| `wRec`         | 0.12    | Recency weight.                                                |
| `recTau`       | 99 s    | Recency decay constant (seconds).                              |
| `wMark`        | 0.39    | Marker weight.                                                 |
| `markRadius`   | 72      | Gaussian-ish falloff around each marker.                       |
| `markMode`     | `add`   | Marker contribution added to base score.                       |

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

| Sandbox                                    | lockstep today                                 |
|--------------------------------------------|------------------------------------------------|
| Scoring = distance + recency + marker      | Scoring = distance only                        |
| `reqRadius` (hard mandatory window)        | `PLAYHEAD_WINDOW=15` (only a CPU-priority hint) |
| Candidate set = whole timeline, top-K wins | Candidate set = narrow window around playhead  |
| Marker neighborhoods prefetched            | Markers ignored                                 |
| Eviction = lowest score                    | Eviction = oldest LRU touch                    |

The window-based candidate set is the biggest limitation: no amount of marker scoring helps if frames around a marker at playhead+1500 never enter the candidate list.

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

The candidate set should be the union of:

- The **required window** `[playhead - REQ_RADIUS, playhead + REQ_RADIUS]` (these must be extracted if not already cached).
- A **marker window** around each marker: `[m - MARK_RADIUS, m + MARK_RADIUS]` (plus some factor; sandbox used `markRadius=72`, so ~2τ ≈ 144 frames covers most of the exponential mass).
- Everything currently cached (so the scorer can decide what to keep vs evict).

Then sort by `frame_score` descending and take the top `max_cached_frames`.

```rust
fn candidate_frames(st: &VideoState) -> Vec<(i64, f64)> {
    let ctx = &st.context;
    let ph = ctx.playhead_frame;
    let mut set: HashSet<i64> = HashSet::new();

    // Required window (hard).
    for f in (ph - REQ_RADIUS).max(0)..=(ph + REQ_RADIUS).min(st.max_frame) {
        set.insert(f);
    }
    // Marker windows. 2 * markRadius covers >85% of the exponential.
    let mr = (MARK_RADIUS * 2.0) as i64;
    for &m in &ctx.marker_frames {
        for f in (m - mr).max(0)..=(m + mr).min(st.max_frame) {
            set.insert(f);
        }
    }
    // Keep currently-ready frames in consideration (for eviction scoring).
    for &f in &st.ready { set.insert(f); }

    let now = Instant::now();
    set.into_iter()
        .map(|f| {
            let age = st.frame_touched_at.get(&f)
                .map(|t| now.duration_since(*t).as_secs_f64())
                .unwrap_or(f64::INFINITY);
            (f, frame_score(ctx, f, age))
        })
        .collect::<Vec<_>>()
        .into_iter()
        .collect()
}
```

### 3. Separate "must cache" from "should cache"

The sandbox distinguishes **required** (hard) from **top-K scoring** (soft). Mirror this in the scheduler:

```rust
fn pick_next(st: &VideoState) -> Option<i64> {
    // Priority 1: any frame in the required window that isn't ready/in-flight.
    let ph = st.context.playhead_frame;
    for r in 0..=REQ_RADIUS {
        for offset in &[-r, r] {
            let f = ph + offset;
            if f < 0 || f > st.max_frame { continue; }
            if !st.ready.contains(&f) && !st.in_flight.contains(&f) {
                return Some(f);
            }
        }
    }
    // Priority 2: highest-scoring soft candidate not ready/in-flight,
    // within the top-K by score.
    let mut cands = candidate_frames(st);
    cands.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    cands.truncate(st.max_cached_frames);
    cands.into_iter()
        .find(|(f, _)| !st.ready.contains(f) && !st.in_flight.contains(f))
        .map(|(f, _)| f)
}
```

### 4. Rework eviction

Swap LRU-by-counter for LRU-by-score. An already-cached frame whose score has dropped below the cutoff gets evicted — *unless* it's in the required window.

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
