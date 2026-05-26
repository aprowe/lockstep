# Thumbnail Backend Cache v2 — Design

**Date:** 2026-05-26
**Status:** Design
**Parent:** `docs/superpowers/specs/2026-05-25-thumbnail-system-redo-design.md` (frontend layer unchanged; this spec replaces the v1 backend it describes)

## Goal

Replace the minimal v1 LRU backend with a two-retainer cache + batched-decode worker pool. v1's frontend (`<Thumbnail />`, slice, middleware, `set_thumbnail_wants` IPC) is kept; this spec changes only what happens inside `src-tauri/src/thumbnails.rs`, plus a small middleware adjustment for width-change synchronization.

The user-visible win: filmstrip drags decode in one ffmpeg invocation instead of seven; a batch of fifty scene cuts decodes in two ffmpeg invocations instead of fifty; recently-hovered or recently-near-playhead frames stay warm so re-hover and scrub-back feel instant.

## Non-goals

- No persistent libav decoder (subprocess ffmpeg stays).
- No mid-extraction cancellation.
- No multi-width on-disk cache. Width changes purge.
- No protocol changes from v1 except the meaning of `max_cached_frames` (now "dynamic cap only").

## Architecture

Two retainer kinds, one shared storage layer.

| Retainer | Capacity | Holds |
|---|---|---|
| **Static** | uncapped | frames wanted by `Clips`, `Scenes`, `Anchors`, `ClipHover`, `SceneHover`, `AnchorHover` |
| **Dynamic** | capped (`settings.maxCachedFrames`) | frames wanted by `Filmstrip` + bonus frames decoded as byproducts |

A frame can hold both retainer bits simultaneously. One file on disk per frame, regardless of how many retainers hold it. A frame is on disk **iff** at least one retainer bit is set on its `FrameEntry`.

Priority is orthogonal to retention. Hover frames live in Static (uncapped) but jump the decode queue; filmstrip frames live in Dynamic (LRU) but also jump ahead of scenes; scenes are background. Retention says "should we keep it after extraction"; priority says "which order to extract in."

## Data structures

```rust
bitflags! {
    pub struct RetainerSet: u8 {
        const STATIC  = 0b01;
        const DYNAMIC = 0b10;
    }
}

pub struct FrameEntry {
    path: PathBuf,
    retainers: RetainerSet,
    dynamic_touch: Instant,   // only meaningful if DYNAMIC bit is set
}

pub struct VideoCache {
    video_path: String,
    fps: f64,
    thumb_width: u32,
    cache_dir: PathBuf,

    // One source of truth for what's on disk.
    ready: HashMap<i64, FrameEntry>,

    // Current wants (mirrored from the latest set_thumbnail_wants payload).
    static_set: HashSet<i64>,
    dynamic_set: HashSet<i64>,
    max_dynamic: usize,

    // Scheduling state.
    pending: BTreeSet<i64>,             // wanted but not ready / not in_flight
    in_flight: HashSet<i64>,
    priority_rank: HashMap<i64, u8>,    // 0 = highest; derived from reason buckets

    // Keyframe index (ffprobe one-shot, cached).
    keyframes: Vec<i64>,                // absolute frame numbers, sorted

    // Pool state.
    active_workers: usize,

    // Width-change race guard.
    generation: u64,
}

pub struct ThumbnailsState(pub Arc<Mutex<HashMap<String /* file_hash */, Arc<Mutex<VideoCache>>>>>);
```

**Invariants:**
- `ready[f]` exists ⟺ a file is on disk at `frame_path(f)` ⟺ `entry.retainers != 0`.
- `static_set` and `dynamic_set` reflect *current wants*, not what's cached. A frame can be in `ready` with the DYNAMIC bit but not in `dynamic_set` (warm leftover from a prior wants payload — eligible for LRU eviction).
- `keyframes[0] = 0` always (start of video is a keyframe by container convention).
- `priority_rank[f] = u8::MAX` (or absent) means "background" — only relevant if a frame is in pending.

## Protocol

Unchanged from v1 spec except for the meaning of `max_cached_frames`:

```rust
#[derive(Deserialize)]
pub struct SetWantsRequest {
    pub file_hash: String,
    pub video_path: String,
    pub fps: f64,
    pub by_reason: HashMap<ThumbnailReason, Vec<i64>>,
    pub max_cached_frames: Option<usize>,   // applies to Dynamic only
    pub thumb_width: Option<u32>,
}
```

Backend derives Static/Dynamic membership and per-frame priority on receipt:

```rust
fn tier_of(r: ThumbnailReason) -> u8 {
    match r {
        ClipHover | SceneHover | AnchorHover => 0,
        Filmstrip                            => 1,
        Anchors | Clips                      => 2,
        Scenes                               => 3,
    }
}

fn project_wants(by_reason: &HashMap<ThumbnailReason, Vec<i64>>)
    -> (HashSet<i64>, HashSet<i64>, HashMap<i64, u8>)
{
    let mut static_set = HashSet::new();
    let mut dynamic_set = HashSet::new();
    let mut rank: HashMap<i64, u8> = HashMap::new();
    for (r, frames) in by_reason {
        let t = tier_of(*r);
        let target = if matches!(r, Filmstrip) { &mut dynamic_set } else { &mut static_set };
        for &f in frames {
            target.insert(f);
            rank.entry(f).and_modify(|v| *v = (*v).min(t)).or_insert(t);
        }
    }
    (static_set, dynamic_set, rank)
}
```

A frame wanted by both a hover reason and filmstrip ends up in both retainer sets and gets the better (lower) tier — exactly the desired effect for the rare overlap case.

## `set_thumbnail_wants` algorithm

```rust
fn set_thumbnail_wants(req: SetWantsRequest) {
    let c = get_or_create_cache(&req.file_hash);
    let mut c = c.lock();

    // 1. Width change → purge.
    if req.thumb_width != c.thumb_width {
        c.generation = c.generation.wrapping_add(1);
        for (_, e) in c.ready.drain() { let _ = std::fs::remove_file(&e.path); }
        c.static_set.clear();
        c.dynamic_set.clear();
        c.pending.clear();
        c.thumb_width = req.thumb_width;
        // in_flight workers may still be running with old generation;
        // their outputs will be discarded on completion.
    }

    // 2. Build keyframe index lazily.
    if c.keyframes.is_empty() {
        c.keyframes = probe_keyframes(&req.video_path, req.fps);
    }

    // 3. Project new wants.
    let (new_static, new_dynamic, new_rank) = project_wants(&req.by_reason);

    // 4. Diff: clear retainer bits for frames that left their respective set.
    let dropped_static = c.static_set.difference(&new_static).copied().collect::<Vec<_>>();
    let dropped_dynamic = c.dynamic_set.difference(&new_dynamic).copied().collect::<Vec<_>>();
    for f in dropped_static {
        if let Some(e) = c.ready.get_mut(&f) { e.retainers.remove(STATIC); }
    }
    for f in dropped_dynamic {
        if let Some(e) = c.ready.get_mut(&f) { e.retainers.remove(DYNAMIC); }
    }

    // 5. Apply new retainers + touch + enqueue or emit-immediately for cache hits.
    let union: HashSet<i64> = new_static.union(&new_dynamic).copied().collect();
    let now = Instant::now();
    let mut hit_emits: Vec<(i64, PathBuf)> = vec![];
    for &f in &union {
        let in_static = new_static.contains(&f);
        let in_dynamic = new_dynamic.contains(&f);
        if let Some(e) = c.ready.get_mut(&f) {
            if in_static  { e.retainers.insert(STATIC); }
            if in_dynamic { e.retainers.insert(DYNAMIC); e.dynamic_touch = now; }
            // Already on disk — could be a bonus frame just promoted to wanted, or
            // a previously-wanted frame still warm. Either way, emit thumbnail-ready
            // unconditionally; the frontend slice's setThumbnail is idempotent.
            hit_emits.push((f, e.path.clone()));
        } else if !c.in_flight.contains(&f) {
            c.pending.insert(f);
        }
    }
    // hit_emits are dispatched outside the lock after step 7.

    c.static_set = new_static;
    c.dynamic_set = new_dynamic;
    c.priority_rank = new_rank;
    c.max_dynamic = req.max_cached_frames.unwrap_or(c.max_dynamic);

    // 6. Reap zero-retainer entries (file deletes).
    let zeroed: Vec<i64> = c.ready.iter()
        .filter(|(_, e)| e.retainers.is_empty())
        .map(|(f, _)| *f)
        .collect();
    for f in zeroed {
        if let Some(e) = c.ready.remove(&f) { let _ = std::fs::remove_file(&e.path); }
    }

    // 7. Evict Dynamic if over cap.
    evict_dynamic(&mut c);

    // 8. Ensure workers are spun up if there's work.
    drop(c);
    ensure_workers(/* state */);
}
```

**Note on step 5's "already on disk" branch:** the frontend tracks paths in `thumbnails.pathsByHashAndFrame`. A frame that was bonus-warmed by a prior decode is on disk in the backend's `ready` but **may or may not** have a slice entry on the frontend (the original `thumbnail-ready` event for that frame was either emitted as a bonus — in which case the frontend has the path — or suppressed — in which case it doesn't). The simplest correct rule: emit `thumbnail-ready` for **all** wanted frames that are already in `ready` on this `set_thumbnail_wants`, regardless of whether they were bonus-warmed or fully-wanted before. The frontend's slice dedupes naturally. See "Events" below.

## Eviction (Dynamic LRU)

```rust
fn evict_dynamic(c: &mut VideoCache) {
    let mut dynamic_count = c.ready.values()
        .filter(|e| e.retainers.contains(DYNAMIC))
        .count();
    if dynamic_count <= c.max_dynamic { return; }

    // Evict-eligible: DYNAMIC bit set AND not currently wanted as Dynamic.
    let mut victims: Vec<(i64, Instant)> = c.ready.iter()
        .filter(|(f, e)| e.retainers.contains(DYNAMIC) && !c.dynamic_set.contains(f))
        .map(|(f, e)| (*f, e.dynamic_touch))
        .collect();
    victims.sort_by_key(|(_, t)| *t);

    for (f, _) in victims {
        if dynamic_count <= c.max_dynamic { break; }
        let entry = c.ready.get_mut(&f).unwrap();
        entry.retainers.remove(DYNAMIC);
        if entry.retainers.is_empty() {
            let path = entry.path.clone();
            c.ready.remove(&f);
            let _ = std::fs::remove_file(&path);
        }
        // else: STATIC keeps the file; we just dropped the dynamic claim.
        dynamic_count -= 1;
    }
}
```

Eviction only runs at the end of `set_thumbnail_wants` (and at the end of worker job completion when new bonus frames land). Currently-wanted Dynamic frames are protected; warm leftovers are not.

## Keyframe index

One ffprobe pass per file, cached on `VideoCache.keyframes`:

```bash
ffprobe -v error -select_streams v:0 -skip_frame nokey \
  -show_entries frame=best_effort_timestamp_time \
  -of csv=p=0 video.mp4
```

Returns one timestamp per I-frame. Convert via `floor(t * fps)` to absolute frame numbers. Sort. The first probe runs synchronously inside `set_thumbnail_wants` before workers spin up (acceptable: ffprobe with `-skip_frame nokey` typically completes in 200ms–1s and only happens once per file).

Helpers:
```rust
fn keyframe_at_or_before(&self, f: i64) -> i64 { /* binary search */ }
fn gop_len(&self, keyframe_frame: i64, total_frames: i64) -> i64 { /* next kf or end */ }
```

## Worker pool & job dispatch

```rust
const MAX_WORKERS: usize = 2;
const MAX_INPUTS_PER_FFMPEG: usize = 32;

fn ensure_workers(state: SharedState, file_hash: String) {
    let to_spawn = {
        let reg = state.0.lock();
        let entry = match reg.get(&file_hash) { Some(e) => e.clone(), None => return };
        drop(reg);
        let mut c = entry.lock();
        let mut spawn = 0;
        while c.active_workers < MAX_WORKERS && !c.pending.is_empty() {
            c.active_workers += 1;
            spawn += 1;
        }
        spawn
    };
    for _ in 0..to_spawn {
        let s = state.clone(); let h = file_hash.clone();
        std::thread::spawn(move || worker_loop(s, h));
    }
}
```

### Job picking

A **GOP-cluster** is the set of `pending` frames falling in one GOP. A **job** is one or more GOP-clusters of the same priority tier, packed into one ffmpeg invocation (up to `MAX_INPUTS_PER_FFMPEG` clusters).

```rust
struct GopCluster {
    keyframe_frame: i64,
    gop_len: i64,
    wanted: Vec<i64>,    // pending frames in this GOP
    tier: u8,            // min priority_rank across wanted
}

struct Job {
    generation: u64,
    clusters: Vec<GopCluster>,
}

fn pick_job(c: &mut VideoCache) -> Option<Job> {
    if c.pending.is_empty() { return None; }

    // 1. Group pending frames by GOP.
    let mut by_kf: HashMap<i64, GopCluster> = HashMap::new();
    for &f in &c.pending {
        let kf = c.keyframe_at_or_before(f);
        let tier = *c.priority_rank.get(&f).unwrap_or(&u8::MAX);
        let entry = by_kf.entry(kf).or_insert_with(|| GopCluster {
            keyframe_frame: kf,
            gop_len: c.gop_len(kf, /* total */),
            wanted: vec![],
            tier: u8::MAX,
        });
        entry.wanted.push(f);
        entry.tier = entry.tier.min(tier);
    }

    // 2. Find best tier present.
    let best_tier = by_kf.values().map(|c| c.tier).min().unwrap();

    // 3. Build the job: best-tier cluster first, then greedy-pack same-tier siblings.
    let mut chosen: Vec<GopCluster> = by_kf.into_values()
        .filter(|c| c.tier == best_tier)
        .collect();
    chosen.sort_by_key(|c| c.keyframe_frame);
    chosen.truncate(MAX_INPUTS_PER_FFMPEG);

    // 4. Mark in_flight up front, remove from pending.
    for cluster in &chosen {
        for f in cluster.keyframe_frame .. (cluster.keyframe_frame + cluster.gop_len) {
            c.pending.remove(&f);
            c.in_flight.insert(f);
        }
    }

    Some(Job { generation: c.generation, clusters: chosen })
}
```

**Same-tier packing rule:** tier 0 (hover) clusters are typically single-frame anyway, so they pack trivially. Tiers 1–3 pack greedily with same-tier siblings. A high-priority cluster never piggybacks on lower-tier work — that would add latency for the interactive tier.

### Worker loop

```rust
fn worker_loop(state: SharedState, file_hash: String) {
    let bin = match find_bin("ffmpeg") { Some(b) => b, None => return };
    let entry = match state.0.lock().get(&file_hash) { Some(e) => e.clone(), None => return };

    loop {
        let job = {
            let mut c = entry.lock();
            match pick_job(&mut c) {
                Some(j) => j,
                None => { c.active_workers -= 1; return; }
            }
        };

        let (video_path, fps, thumb_width, cache_dir, expected_generation) = {
            let c = entry.lock();
            (c.video_path.clone(), c.fps, c.thumb_width, c.cache_dir.clone(), job.generation)
        };

        let ok = run_ffmpeg_job(&bin, &video_path, fps, thumb_width, &cache_dir, &job);

        let mut c = entry.lock();
        // Generation guard: width changed mid-job → discard.
        if c.generation != expected_generation {
            for cluster in &job.clusters {
                for f in cluster.keyframe_frame .. (cluster.keyframe_frame + cluster.gop_len) {
                    c.in_flight.remove(&f);
                    let _ = std::fs::remove_file(frame_path(&cache_dir, f));
                }
            }
            continue;
        }

        let now = Instant::now();
        let mut emitted: Vec<i64> = vec![];
        for cluster in &job.clusters {
            for i in 0 .. cluster.gop_len {
                let f = cluster.keyframe_frame + i;
                c.in_flight.remove(&f);
                let path = frame_path(&cache_dir, f);
                if !ok || !path.exists() { continue; }

                let mut bits = RetainerSet::empty();
                if c.static_set.contains(&f) { bits.insert(STATIC); }
                if c.dynamic_set.contains(&f) { bits.insert(DYNAMIC); }
                // Bonus frames (not in either set right now): tag DYNAMIC as speculative warming.
                if bits.is_empty() { bits.insert(DYNAMIC); }

                c.ready.insert(f, FrameEntry {
                    path: path.clone(), retainers: bits, dynamic_touch: now,
                });
                emitted.push(f);
            }
        }

        evict_dynamic(&mut c);

        drop(c);
        // Emit thumbnail-ready outside the lock.
        for f in emitted {
            let _ = app_handle.emit("thumbnail-ready", json!({
                "file_hash": &file_hash,
                "frame": f,
                "path": frame_path(&cache_dir, f).to_string_lossy().to_string(),
            }));
        }
    }
}
```

## ffmpeg command shape

One invocation, N inputs, one output stream per input:

```
ffmpeg -y \
  -ss <T_kf1> -i <video.mp4> \
  -ss <T_kf2> -i <video.mp4> \
  ... \
  -map 0:v:0 -frames:v <gop1_len> -vsync 0 -vf "scale=<W>:-2" -q:v 4 -start_number <kf1> <cache_dir>/%d.jpg \
  -map 1:v:0 -frames:v <gop2_len> -vsync 0 -vf "scale=<W>:-2" -q:v 4 -start_number <kf2> <cache_dir>/%d.jpg \
  ...
```

`-start_number <kf>` makes ffmpeg write outputs as `<keyframe_frame>.jpg`, `<keyframe_frame+1>.jpg`, etc. — absolute frame names match the storage scheme. No post-rename pass needed.

Windows: `CREATE_NO_WINDOW` flag, same as today's `extract_single_frame`.

The exact `-start_number` cohabitation with multiple `-map` outputs is supported (ffmpeg applies `-start_number` per output stream). If a quirk is found during implementation, fall back to writing to per-cluster temp subdirs and renaming.

## Events

```rust
// thumbnail-ready (unchanged from v1 wire format):
{ "file_hash": "...", "frame": 42, "path": "..." }
```

Emitted by the worker for every frame written to `ready` (wanted or bonus), once the lock is released. The frontend slice's `setThumbnail` reducer is idempotent — duplicate emits for the same `(hash, frame)` are harmless.

No new events. No `thumbnail-evicted` event in v2 — eviction silently deletes the file. If the frontend's slice still holds a path for an evicted frame, the next `<img>` render gets a 404; on width-change purges, the frontend has already cleared its slice via `clearForHash`. For non-width-change eviction (Dynamic LRU pushing a frame out): an evicted frame, by definition, was *not* currently wanted, so no `<Thumbnail />` is currently rendering it. If it becomes wanted again, the next `set_thumbnail_wants` enqueues it; a fresh `thumbnail-ready` overwrites the slice path. No staleness in practice.

## Frontend changes (delta from v1 spec)

Only one change in `src/store/middleware/thumbnailMiddleware.ts`:

**Width-change synchronization.** Add `settings.thumbWidth` to the source snapshot (already there in v1 plan as `thumbWidth`). When it changes:

```ts
if (curr.thumbWidth !== prev?.thumbWidth && curr.fileHash) {
    api.dispatch(clearForHash(curr.fileHash));
    lastSent = { fileHash: null, byReason: {} };  // force resend
    for (const r of ALL_REASONS) dirty.add(r);
}
```

This runs before the normal diff. After it, the standard flush sends `set_thumbnail_wants` with the new `thumb_width`; the backend purges and re-extracts.

Everything else in the v1 spec (slice, `<Thumbnail />`, API client, hover dispatch sites, drag gating, debounce, listener wiring) is unchanged.

## Tests

### Rust (`src-tauri/`)

- **Retention diff**: a frame in `static_set` then dropped clears STATIC bit; if no other retainer holds it, file is deleted.
- **Both retainers**: frame in both `static_set` and `dynamic_set` has bits `STATIC|DYNAMIC`; dropping from `dynamic_set` leaves file on disk.
- **Dynamic LRU**: with cap=3 and 4 unwanted Dynamic frames, oldest by `dynamic_touch` is evicted; file deleted; entry removed.
- **Wanted Dynamic protected**: with cap=2 and 3 frames all in `dynamic_set`, eviction is a no-op (wanted frames don't evict even past cap).
- **Bonus frames**: insert a `FrameEntry` with no current retainer matching, retainers=DYNAMIC, dynamic_touch=now. Subsequent `set_thumbnail_wants` that adds the same frame to `static_set` correctly OR-s the STATIC bit.
- **GOP grouping**: with `keyframes = [0, 60, 120]` and `pending = {10, 20, 70, 130}`, three GOP-clusters are formed: {10,20} at kf=0, {70} at kf=60, {130} at kf=120.
- **Job packing**: same-tier clusters pack up to `MAX_INPUTS_PER_FFMPEG`; higher-tier cluster always wins selection over lower-tier siblings even when lower-tier is older.
- **Generation guard**: a job started at gen=N produces outputs that are discarded when `c.generation` advanced to N+1 mid-job.
- **Keyframe probe**: `probe_keyframes` returns a sorted `Vec<i64>` starting with 0 for a small test fixture (use one of the existing test videos).

### Vitest (`tests/unit/thumbnails/middleware.test.ts`)

Add one scenario:
- **Width change purges slice and resends**: change `settings.thumbWidth`, advance debounce, assert `clearForHash` was dispatched and `set_thumbnail_wants` was called with the new width.

All existing v1 middleware tests stay green — width-change is additive.

### Behavior coverage

`spec/features/thumbnails.feature` is already on the v1 stale-scenarios list (per the parent spec). v2 doesn't make it any more stale — the user-visible behavior is unchanged. The list of scenarios needing update is surfaced at end-of-implementation per project rule.

## Migration

This spec replaces the backend portion of the v1 plan (Task 8 in `docs/superpowers/plans/2026-05-25-thumbnail-system-redo.md`). Implementation ordering:

1. Frontend tasks 1–7 of the v1 plan land first (slice, component, middleware, API client). They're backend-agnostic.
2. Task 8 (backend) replaces v1's minimal LRU with this design in one commit (or split into "data structures + diff handler" / "keyframe probe + workers" / "ffmpeg job shape").
3. Add the width-change synchronization branch to `thumbnailMiddleware.ts`.
4. Frontend rewiring tasks 9–13 land as planned.

No backwards-compat shim. The wire format adds no fields; only the *meaning* of `max_cached_frames` shifts from "total cache cap" to "dynamic cap only," which is invisible to the frontend.

## Open questions deferred to implementation

- Default `max_cached_frames` value: keep the current default from `settings.maxCachedFrames` (was 2000 in v1 backend; reuse whatever the settings slice ships). 2000 is generous for Dynamic-only.
- ffmpeg `-start_number` behavior with multi-output jobs: verify in implementation; fall back to per-cluster temp dirs + rename if needed.
- `MAX_INPUTS_PER_FFMPEG = 32`: a guess. Implementation should test with a 50-scene fixture to confirm ffmpeg handles 32 inputs cleanly across Windows/macOS/Linux. Lower if not.
- ffprobe keyframe scan time on long files (>30 min): if it exceeds ~2s, run it on a worker thread and let `set_thumbnail_wants` return immediately; workers wait on a `keyframes_ready` condvar.
