# Thumbnail System Redo — Design

**Date:** 2026-05-25
**Status:** Design

## Goal

Rebuild the thumbnail system around a reusable `<Thumbnail />` component, a thumbnail slice, and a thumbnail middleware that owns IPC to the backend. Replace the current multi-tier scoring backend with a clean-slate minimal LRU cache so backend complexity (per-reason priority, batching, hover boost, smarter eviction) can be added intentionally rather than inherited.

The frontend tells the backend *why* each frame is wanted using a fixed set of reasons. Reasons are stored end-to-end but the v1 backend treats all wanted frames equally — its only job is "extract anything wanted that isn't cached, and evict the least-recently-touched unwanted frame when full."

## Non-goals (v1)

- Per-reason priority on the backend.
- Hover-boost scoring on the backend.
- Multi-worker pool, RIFE pass, region-/scene-aware pre-warming.
- Any migration shim or backwards-compat shoulder with the old `set_thumbnail_priority` protocol. The app is pre-release; the wire is replaced.

These are the complexity the user wants room to design themselves on top of the v1 scaffold.

## Reason taxonomy

Seven reasons, defined as enums on both sides of the IPC boundary. Frontend:

```ts
export enum ThumbnailReason {
  Filmstrip   = "filmstrip",
  Clips       = "clips",
  ClipHover   = "clip-hover",
  Scenes      = "scenes",
  SceneHover  = "scene-hover",
  Anchors     = "anchors",
  AnchorHover = "anchor-hover",
}
```

Rust mirror with `serde(rename = "...")` so the wire format is the same kebab-case strings:

```rust
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
```

Nothing accepts a bare string — all slice payloads, middleware dispatches, IPC types, and `wants_by_reason` keys are typed by the enum.

| Reason | Carries | Velocity | Derived from |
|---|---|---|---|
| `filmstrip` | 7 frames centered on playhead | high | `warp.playhead` |
| `clips` | inPoint frame of every region | low | `region.regions` |
| `clip-hover` | one frame (the hovered clip) or empty | event | pointer enter/leave on a clip row |
| `scenes` | every visible scene cut frame | very low | `visibleSceneCuts(scene.cutsByPath, scene.userCutsByPath, minGap)` |
| `scene-hover` | one frame or empty | event | pointer enter/leave on a scene row or diamond |
| `anchors` | every anchor frame | low | `warp.origAnchors` |
| `anchor-hover` | one frame or empty | event | pointer enter/leave on an anchor row or timeline anchor |

A single frame may appear under several reasons (e.g., an anchor that happens to coincide with a scene cut and sits inside the filmstrip window). The backend sees the **union** as the wanted-set; the reason buckets are stored verbatim for future use.

## Frontend

### Slice — `src/store/slices/thumbnailsSlice.ts` (rewritten)

```ts
interface ThumbnailsState {
  pathsByHashAndFrame: Record<string, Record<number, string>>;
  // Only the three hover reasons live in the slice. Steady-state reasons
  // (filmstrip, clips, scenes, anchors) are derived lazily by the middleware
  // at IPC-fire time directly from warp / region / scene slices — there's no
  // intermediate stored copy, so no redundant dispatch fan-out when a single
  // thunk mutates multiple sources.
  hoverByHash: Record<string, Partial<Record<HoverReason, number>>>;
}

type HoverReason = ThumbnailReason.ClipHover | ThumbnailReason.SceneHover | ThumbnailReason.AnchorHover;
```

Reducers:
- `setThumbnail({ fileHash, frame, path })` — write a resolved cache path.
- `setHover({ fileHash, reason, frame })` — set or clear (`frame: null`) one hover reason.
- `clearForHash(fileHash)` — drop paths and hover for one video.

Selectors:
- `selectThumbnailPath(fileHash, frame)` — returns `string | undefined`.

Old surface removed: `stripFramesBySource`, `hoverFramesByHash`, `selectStripFramesFor`, `setStripFrames`, `setHoverFrames`, `selectThumbnailPathsFor` (replaced by per-frame `selectThumbnailPath`).

### Component — `src/components/Thumbnail.tsx` (new)

```tsx
interface ThumbnailProps {
  fileHash: string | null | undefined;
  frame: number | null | undefined;
  className?: string;
  placeholderClassName?: string;
  alt?: string;
}
```

Pure renderer. Reads `selectThumbnailPath(fileHash, frame)` and renders `<img>` if present, placeholder `<div>` otherwise. Calls `convertFileSrc` itself so callers don't have to. Renders nothing if `fileHash` or `frame` is null.

No reason prop — the slice/middleware already know everything from the wants table. The component does **not** register or dispatch anything on mount/unmount.

### Middleware — `src/store/middleware/thumbnailMiddleware.ts` (new)

Owns three responsibilities:

**1. Mark reasons dirty on relevant slice changes.**
After each dispatched action, runs cheap reference checks against a prior snapshot to detect which inputs moved. Affected reasons are added to an internal `dirty: Set<ThumbnailReason>` and a debounce timer is armed (or extended). No `setWants`-style dispatch happens here — only flagging.

| Reason | Inputs (reference-compared) |
|---|---|
| `Filmstrip` | `warp.playhead`, `video.video.fps`, `video.video.duration`, `ui.playing` (freezes set while playing) |
| `Clips` | `region.regions`, `video.video.fps` |
| `Scenes` | `scene.cutsByPath[path]`, `scene.userCutsByPath[path]`, `scene.minGapByPath[path]`, `video.video.fps`, `video.video.path` |
| `Anchors` | `warp.origAnchors`, `video.video.fps` |
| `ClipHover` / `SceneHover` / `AnchorHover` | corresponding entry in `thumbnails.hoverByHash` |

A single thunk that mutates regions + anchors + scenes marks three reasons dirty in one pass — and fires one IPC call.

**2. Derive + send IPC at debounce-fire time.**
When the debounce timer fires:
1. Read store state once.
2. For each dirty reason, compute its frame list from the current inputs. Reasons not dirty are reused from the last-sent payload (cached internally — `lastSent: Map<Reason, number[]>`).
3. Build the full `by_reason` payload (always all 7 reasons, even if only one changed — the backend's `set_thumbnail_wants` is a full-state replace).
4. Bail if the payload deep-equals `lastSent` (e.g., the drag-end re-derivation produced the same frames it had before).
5. Call `set_thumbnail_wants(payload)`. Update `lastSent`. Clear `dirty`.

Single timer per file hash, ~100ms. Steady-state derivation work runs at most once per debounce window per reason, regardless of how many actions touched the inputs in that window.

**3. Listen for `thumbnail-ready`.**
Subscribes once at startup and dispatches `setThumbnail` for each event.

**Drag gating.** While `drag.active === true`, the middleware suppresses *both* dirty-marking and IPC dispatch:

- Slice subscribers do not mark `Clips`, `Scenes`, `Anchors`, or `Filmstrip` dirty even though `regions` / `origAnchors` / `playhead` are mutating every pointer event. The transient mid-drag values are not thumbnail-worthy — they exist purely so the constraint pipeline can replay each frame.
- Hover dispatches from components are also suppressed (a drag in progress isn't a hover) — the middleware ignores `setHover` actions while `drag.active`.
- The pending debounce timer, if any, is *cancelled* on `dragStart`. On `dragEnd` the middleware marks all four steady-state reasons dirty and arms a fresh debounce — so a drag through 100 intermediate positions fires zero IPC calls and exactly one update with the final positions.
- The currently-running ffmpeg worker on the backend is left alone — there's no need to cancel mid-extraction. Dropped frames just become unwanted and age out via LRU.

This mirrors `historyMiddleware` and `persistenceMiddleware`, both of which already use `drag.active` as a "skip" gate.

**3. Listen for `thumbnail-ready`.**
On startup, subscribes to the `thumbnail-ready` event and dispatches `setThumbnail` for each one. Replaces the listener that lived in `Filmstrip`.

**Lifecycle**:
- On `videoSlice` swap (different `fileHash`): dispatch `clearForHash` for the previous video and call `clear_thumbnails(oldHash)` on the backend. Reset internal snapshots.

### Hover dispatch sites

Components that own hover state dispatch `setHover` directly:

- **Clips panel `RowShell`** → on `mouseenter` dispatches `setHover({ reason: ThumbnailReason.ClipHover, frame: clipInFrame })`; on `mouseleave` dispatches with `frame: null`.
- **Scenes panel rows** → `SceneHover` analogously.
- **Markers panel rows** → `AnchorHover` analogously.
- **`SceneRow.tsx` diamonds** → `SceneHover` on diamond enter/leave (replaces the current `useSetThumbnailHover` plumbing for that case).
- **Future timeline anchor band** → `AnchorHover`.

The `ThumbnailPopup` keeps its existing hover context (pointer x/y), but its child render becomes `<Thumbnail fileHash={hash} frame={hoveredFrame} />`. Whoever invokes `setHovered` for the popup is also responsible for the matching `setWants` hover dispatch for the right reason.

### Component rewiring

- **`Filmstrip.tsx`** — keeps the layout and resizer. Loses the `useEffect` that built the priority payload, loses its own `listenThumbnailReady`. Renders 7 `<Thumbnail />` instead of inline `<img>` per slot.
- **`SceneRow.tsx`** — replaces its inline `convertFileSrc` block with `<Thumbnail />`. Drops `selectThumbnailPathsFor` use.
- **`RowShell.tsx`** (used by ClipRow, SceneRow-list, MarkerRow) — the `thumbnailSrc` prop is replaced by `thumbnailFrame: number | null`, and the row renders `<Thumbnail fileHash={hash} frame={frame} />` internally. `ListPanel` stops resolving paths.
- **`ThumbnailPopup.tsx`** — uses `<Thumbnail />`.
- **`Filmstrip` no longer reads** `regions`, `origAnchors`, `scenes`, `view`, `thumbWidth`, `maxCachedFrames`, `hoverFrames` from the store — those subscriptions move to the middleware.

### Deletions

- `src/api/thumbnails.ts`: `setThumbnailPriority`, `ThumbnailPriorityRequest`, `getThumbnailQueueStats`, `QueueStats`, `QueueTierStats`.
  Add: `setThumbnailWants(req)`.
  Keep: `getThumbnailPath`, `clearThumbnails`, `clearAllThumbnails`, `listenThumbnailReady`, `ThumbnailReadyPayload`.
- `ThumbnailQueueDebug.tsx` — delete in v1. The diagnostic panel comes back when the backend grows complexity worth surfacing.

## Backend

### File — `src-tauri/src/thumbnails.rs` (rewritten, ~250 lines)

```rust
pub struct VideoCache {
    video_path: String,
    fps: f64,
    cache_dir: PathBuf,
    wants_by_reason: HashMap<ThumbnailReason, Vec<i64>>,
    wanted_set: HashSet<i64>,
    ready: HashMap<i64, Instant>,
    in_flight: HashSet<i64>,
    queue: VecDeque<i64>,
    max_cached: usize,
    thumb_width: u32,
    worker_running: bool,
}

#[derive(Default)]
pub struct Registry { videos: HashMap<String, Arc<Mutex<VideoCache>>> }
pub struct ThumbnailsState(pub Arc<Mutex<Registry>>);
```

### Commands

```rust
#[tauri::command]
fn set_thumbnail_wants(req: SetWantsRequest, ...) -> ();

#[tauri::command]
fn get_thumbnail_path(file_hash: String, frame: i64, ...) -> Option<String>;

#[tauri::command]
fn clear_thumbnails(file_hash: String, ...) -> ();

#[tauri::command]
fn clear_all_thumbnails(...) -> ();
```

```rust
struct SetWantsRequest {
    file_hash: String,
    video_path: String,
    fps: f64,
    by_reason: HashMap<ThumbnailReason, Vec<i64>>,
    max_cached_frames: Option<usize>,
    thumb_width: Option<u32>,
}
```

### `set_thumbnail_wants` algorithm

1. Get or create the `VideoCache` for `file_hash`. Update `video_path`, `fps`, `max_cached`, `thumb_width`.
2. Replace `wants_by_reason` with `req.by_reason`.
3. Recompute `wanted_set` = union of all reason vectors, clamped to `[0, max_frame]`.
4. For each `f` in `wanted_set`:
   - If `ready.contains_key(&f)` → `ready.insert(f, Instant::now())` (touch).
   - Else if `!in_flight.contains(&f)` and not already queued → push to `queue`.
5. Eviction sweep: while `ready.len() > max_cached`, pop the oldest entry by `Instant` that is **not** in `wanted_set`. If no such entry exists, stop (wanted frames are protected even past cap).
6. Kick the worker if not running.

### Worker

Single worker. `spawn_blocking` started inside a `tokio::spawn` to keep the command non-blocking.

Loop:
1. Pop front of `queue`. Skip if already in `ready` or `in_flight`. If queue empty, set `worker_running = false` and exit.
2. Mark `in_flight.insert(f)`.
3. Release lock; run ffmpeg (hybrid input/output seek, same approach as today's `extract_single_frame`). Output goes to `cache_dir/<file_hash>/<frame>.jpg`.
4. Reacquire lock. Remove from `in_flight`. On success: `ready.insert(f, Instant::now())`. Emit `thumbnail-ready { file_hash, frame, path }`.
5. Repeat.

Worker re-reads `queue` each iteration, so newer `set_thumbnail_wants` calls take effect on the next loop turn. No mid-extraction cancellation in v1 — a frame currently being extracted by ffmpeg runs to completion even if it just got dropped from the wanted-set.

### Eviction policy summary

- Wanted frames are never evicted, even past `max_cached`.
- Unwanted frames evict in last-touch order (true LRU).
- Eviction sweep runs only on `set_thumbnail_wants`, not on worker completion. (A completed extraction can push `ready` one over cap until the next wants payload; acceptable in v1.)
- Eviction removes the in-memory entry from `ready` and deletes the cache file. The frontend's stored path becomes stale; the next render falls back to placeholder until the frame is re-extracted. (Frontend doesn't track eviction in v1 — if a frame is wanted again, the worker re-extracts and emits `thumbnail-ready`, which overwrites the slice path.)

### Cache directory

Unchanged: `app_data_dir / "thumbnails" / <file_hash> / <frame>.jpg`. `clear_thumbnails` and `clear_all_thumbnails` delete on-disk and in-memory state.

### Removed from `thumbnails.rs`

Multi-tier scoring (`T_PLAYHEAD_*`, `T_MARKER_*`, `T_NEAR_MARKER`, `T_RECENCY`, `DIST_FALLOFF`, `MARK_RADIUS`, `REC_TAU_SECS`), `PriorityContext`, `frame_score`, marker neighborhood seeding, `PLAYHEAD_WINDOW` Windows-priority logic, multi-worker pool, per-tier queue stats.

## Tests

### Vitest

- **`tests/unit/thumbnails/middleware.test.ts`** (new):
  - Playhead change → `filmstrip` wants updates with 7 centered frames.
  - Region added/removed → `clips` wants updates.
  - Scene detection completes → `scenes` wants updates.
  - Anchor added → `anchors` wants updates.
  - Video swap → `clearForHash` for the old video, fresh wants for the new.
  - Debounce: rapid playhead ticks coalesce into one `set_thumbnail_wants` call.
  - Playing freezes `filmstrip` wants.
  - `drag.active` gate: dragging an anchor through 100 intermediate positions produces zero IPC calls; one call fires on `dragEnd` with the final positions.
  - Hover dispatches are dropped while `drag.active` is true.
  - Multi-source coalescing: one thunk dispatching region + anchor + scene changes in sequence produces exactly one IPC call whose payload reflects all three.
  - Idempotence: re-dispatching the same inputs (e.g. a no-op `dragEnd`) does not emit an IPC call because the payload deep-equals `lastSent`.

- **`tests/unit/thumbnails/slice.test.ts`** (new): reducer-level coverage of `setWants` / `setThumbnail` / `clearForHash`.

- **`tests/unit/components/Thumbnail.test.tsx`** (new): renders `<img>` when path present, placeholder when not, nothing when `frame=null`.

### Rust (`src-tauri/`)

- Cache unit tests: wanted frames don't evict, LRU order respected, queue dedupes against `ready` and `in_flight`, `clear` resets state.
- Existing `extract_single_frame` ffmpeg path is reused — no new integration tests needed.

### Behavior coverage

`spec/features/thumbnails.feature` will need rewrites (T1/T2/T3 scenarios are gone). **Per the project rule, the spec/ directory is not edited without an explicit ask.** I'll surface the list of stale behaviors and you decide what to update.

## Migration plan (one PR, ordered commits)

1. **Slice + component + middleware** — add new types, register middleware in `store.ts`. No consumers wired yet.
2. **Rewire consumers** — Filmstrip, SceneRow, RowShell, ListPanel, ThumbnailPopup, ScenesPanel, ClipsPanel, MarkersPanel. Drop old prop shapes (`thumbnailSrc` → `thumbnailFrame`).
3. **Replace backend** — wholesale rewrite of `thumbnails.rs`, swap `set_thumbnail_priority` → `set_thumbnail_wants` in `commands.rs` and `src/api/thumbnails.ts`.
4. **Delete dead exports** — old slice surface, `ThumbnailQueueDebug`, old API types, `THUMBNAIL_CACHE_DESIGN.md` (now stale — replaced by this doc).

## Open questions deferred to implementation

- Exact debounce window (100ms is the starting point; tune against the existing 120ms in Filmstrip).
- Whether `Thumbnail` should fade-in when the path arrives (cosmetic; can be added in CSS without API change).
- Whether `clear_thumbnails` on video swap should also delete on-disk cache (current behavior: yes; reconsider — cached frames are cheap to keep across video switches).
