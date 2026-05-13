# Canvas Timeline — behavior extraction & spec migration

**Date:** 2026-05-11
**Status:** Design — awaiting review before plan

## Problem

`src/components/CanvasTimeline.tsx` is an 83 KB monolith mixing canvas drawing, hit testing, gesture state, snap math, and intent dispatch. Many of its behaviors are not described in any `.feature` file, and the gesture logic is duplicated between CanvasTimeline (canvas-side) and discrete callers like `regionSlice` / WarpView. No test exercises CanvasTimeline's drag/dispatch branches — coverage lives only against the parallel `ThinTimeline` DOM components.

The goal is to:

1. Pull the timeline behaviors not already specced into `.feature` files.
2. Group all time-domain features under `spec/features/timeline/`.
3. Extract a pure controller module so behaviors can be asserted via BDD without rendering CanvasTimeline.
4. Add a shared model layer so each behavior is implemented once and called from both the live-drag path and the discrete-event path.

ThinTimeline is out of scope — it stays as-is, continues to consume `src/store/gesture.ts` directly.

## Non-goals

- Visual / rendering changes.
- ThinTimeline modifications.
- Promoting transient gesture state into Redux. Drag state stays per-instance and out of the store; commits dispatch as they do today.
- Persistence-format or schema changes.

## Architecture

Three layers, top to bottom:

```
CanvasTimeline.tsx (React wrapper)
   │  builds Snapshot from props + Redux selectors
   │  forwards events to controller; applies returned intents
   ▼
src/timeline/controller.ts (stateful, per-instance)
   │  drag state machine, hit-test routing, event → intent translation
   │  no React, no Redux
   ▼
src/timeline/model/*.ts (pure functions)
   conform, clampRegion, snapTarget, beatMap, newRegionBounds
   called by controller AND by regionSlice / videoThunks / WarpView
```

### Key principle: behavior lives in `model/`, the controller routes events through it

Every rule that today is duplicated between "live drag" and "discrete commit" is moved into `src/timeline/model/` and called from both sites. The controller becomes a routing layer over model functions.

Rules being moved into `model/`:

- `conform.ts` — `conformClipoutToAnchors(region, anchors, beatAnchors): { inBeat, outBeat }`. Used when an anchor sits on a region's in/out point, the clipout track conforms to the anchor's beat position.
- `clampRegion.ts` — min span (1s), clamp to `[0, max]`, prevent `in >= out` by shifting rather than rejecting.
- `snapTarget.ts` — input-space (scenes + clip edges), output-space (BPM grid clamped to smallest-visible-tick), plus `snapCandidates()` returning the 2 nearest on each side for hint rendering.
- `beatMap.ts` — `origToBeat(time, anchorPairs)` piecewise-linear mapping; `beatOffsetFor(region, anchors, beatAnchors)`.
- `newRegionBounds.ts` — viewport-aware bounds: 10% of view or 5s minimum, snap between surrounding scenes and adjacent regions. Currently in `src/utils/view.ts` — moves here.

### File layout

```
src/timeline/
├── model/
│   ├── conform.ts
│   ├── clampRegion.ts
│   ├── snapTarget.ts
│   ├── beatMap.ts
│   └── newRegionBounds.ts
├── controller.ts
├── hitTest.ts            # buildHitList(snapshot, layout) + hitAt(hits, x, y); no module-level mutable state
├── layout.ts             # buildLayout, ALL_TRACKS, TrackDef (moved from CanvasTimeline)
├── ruler.ts              # timeLayers, barsLayers, smallestVisibleBeatGridSec
├── view.ts               # wheel→view math, minimap→view math, clampView (consolidates utils/view.ts piece)
└── types.ts              # Snapshot, Intent, DragState, HitEntry

src/components/CanvasTimeline.tsx
   shrinks to: rendering + theme + props↔Snapshot mapping + controller wiring
src/components/CanvasTimeline.css   # unchanged
src/components/CanvasTimelineToolbar # unchanged (UI chrome, not timeline-domain)
```

`src/store/gesture.ts` is unchanged. ThinTimeline continues to read from it directly. The controller emits `pub*` intents that the CanvasTimeline wrapper translates into calls on the same gesture singleton.

### Controller API

```ts
interface Snapshot {
  view: View; duration: number; outputDuration: number; maxDuration: number
  anchors: Anchor[]; beatAnchors: Anchor[]; selectedAnchorIds: ReadonlySet<number>
  regions: RegionBlock[]; regionsOutput?: RegionBlock[]; selectedClipIds: ReadonlySet<string>
  scenes: number[]; selectedSceneTimes: ReadonlySet<number>
  segments: WarpSegment[]; bpm: number; beatOffset?: number
  snapInterval?: number; snapOffset?: number
  followDrag: boolean; warpCollapsed: boolean
  canvas: { width: number; height: number }
  tracks: LayoutTrack[]
  playhead?: number
}

type Intent =
  // commits (fire prop callbacks → Redux dispatches as today)
  | { kind: 'seek' | 'seekBeat'; time: number }
  | { kind: 'viewChange'; view: View }
  | { kind: 'anchorsChanged' | 'beatAnchorsChanged'; next: Anchor[] }
  | { kind: 'regionResize' | 'regionMove'; id: string; inPoint: number; outPoint: number; isOutput: boolean }
  | { kind: 'anchorAdd'; time: number }
  | { kind: 'anchorDelete' | 'beatAnchorDelete'; id: number }
  | { kind: 'anchorSelect' | 'beatAnchorSelect'; id: number; additive: boolean }
  | { kind: 'anchorContextMenu' | 'beatAnchorContextMenu'; id: number; x: number; y: number }
  | { kind: 'sceneContextMenu'; time: number; x: number; y: number }
  | { kind: 'regionContextMenu'; id: string; x: number; y: number }
  | { kind: 'timelineContextMenu'; time: number; x: number; y: number }
  | { kind: 'sceneAdd' | 'sceneDelete'; time: number }
  | { kind: 'regionAdd'; time: number }
  | { kind: 'regionSelect' | 'regionZoom'; id: string }
  | { kind: 'timelineDeselect' | 'timelineDelete' }
  | { kind: 'clipsSelectionChange'; ids: Set<string> }
  | { kind: 'scenesSelectionChange'; times: Set<number> }
  | { kind: 'connectorSelectionChange'; ids: Set<number> }
  // gesture-store publishes (wrapper forwards to src/store/gesture.ts)
  | { kind: 'pubDragRegion'; id: string; inPoint: number; outPoint: number }
  | { kind: 'pubDragTime'; space: Space | null; time: number | null }
  | { kind: 'pubSnapHints'; space: Space; times: readonly number[] }
  | { kind: 'pubScrubTime'; time: number | null }
  | { kind: 'pubLasso'; clipIds: Set<string>; anchorIds: Set<number>; sceneTimes: Set<number> }
  | { kind: 'pubClearGesture' }
  // canvas-side hints
  | { kind: 'cursor'; cursor: '' | 'grab' | 'grabbing' | 'ew-resize' | 'pointer' }
  | { kind: 'redraw' }

interface Controller {
  pointerDown(e: PointerEventLike, snap: Snapshot): Intent[]
  pointerMove(e: PointerEventLike, snap: Snapshot): Intent[]
  pointerUp(snap: Snapshot): Intent[]
  cancel(): Intent[]            // pointercancel, blur, Escape — no commit
  wheel(e: WheelEventLike, snap: Snapshot): Intent[]
  doubleClick(e: PointerEventLike, snap: Snapshot): Intent[]
  contextMenu(e: PointerEventLike, snap: Snapshot): Intent[]
  keyDown(e: KeyEventLike): Intent[]
  getDragState(): DragState | null   // for canvas draw (live anchors, lasso rect)
}

function createTimelineController(): Controller
```

`PointerEventLike` / `WheelEventLike` / `KeyEventLike` are plain structural types (`clientX`, `clientY`, `button`, modifier flags, `deltaX`, `deltaY`, `key`, plus an explicit `canvasRect`) so tests don't need DOM event objects.

The Snapshot is built fresh per event. The controller holds no closures over caller state — only its own drag bookkeeping.

### State, undo, persistence

Unchanged.

- Live drag state moves from CanvasTimeline refs into the controller's internal state. Same shape, same lifetime. Still wiped on `pointerUp` and `cancel`.
- Commit intents are emitted at the same moments today's prop callbacks fire. The wrapper forwards each intent to the same prop callback. WarpView's dispatch path is bit-identical.
- `historyMiddleware` sees the same dispatched actions → captures undo snapshots at the same boundaries.
- `persistenceMiddleware` writes on the same actions → same persistence cadence.
- The Redux schema is unchanged. No migration.

Side effect — incidental fix: `pointercancel` and window `blur` today only run `gesture.clearAll()` from the global listener in `gesture.ts`. CanvasTimeline's own drag state (`liveRegion`, `liveAnchorsIn`, etc.) is not reset, so a drag that ends via blur leaks live state. The controller's explicit `cancel()` makes this a one-liner and is wired to `pointercancel` and `blur` in the CanvasTimeline wrapper.

## Spec organization

Criterion: a feature goes into `spec/features/timeline/` if it describes how the time axis / time domain behaves to the user. Sidebar list interactions, name editing, and toolbar-driven navigation stay top-level even when they have time-related side effects.

```
spec/features/
├── timeline/
│   ├── tracks.feature           (renamed from timeline_tracks.feature)
│   ├── ruler.feature            (renamed from ruler-layer.feature)
│   ├── region-creation.feature  (moved)
│   ├── region-bounds.feature    (NEW — scenarios moved from region-editing.feature)
│   ├── viewport.feature         (NEW — wheel, pan, zoom, minimap)
│   └── drag.feature             (NEW — gesture behaviors not currently specced)
├── region-editing.feature       (slimmed: rename, sidebar row click→seek Outline kept here intact)
├── list-selection.feature       (unchanged)
├── navigation.feature           (unchanged — Prev/Next toolbar)
└── … (other top-level files unchanged)
```

Splits from `region-editing.feature` → `timeline/region-bounds.feature`:

- Start/end bounds undoable
- Start past end / out before in moves region
- Set in/out from button creates new region when crossing existing edge
- Min span clamp (`A region is prevented from being too small`)
- Region zoom action (double-click + viewport behavior on second invoke)

Stays in `region-editing.feature`:

- "Clicking a region moves the playhead to its start" Outline (`clip sidebar` + `timeline overlay` surfaces) — the Outline's whole point is "same behavior across surfaces"; splitting defeats it.
- Sidebar rename / context-menu Rename.

### New `timeline/viewport.feature` scenarios

- Wheel scroll → horizontal pan.
- Wheel + Shift → horizontal pan (treats deltaY as deltaX when deltaX is 0).
- Wheel + Ctrl/Cmd → zoom around cursor (cursor's time stays fixed at the cursor's x).
- Alt-click + drag → pan.
- Middle-mouse drag → pan.
- Minimap click → recenter viewport on click position, span preserved.
- Minimap drag → continuous recenter.
- Zoom span clamped to ≥0.1s and ≤2 × maxDuration.
- View always clamped to `[0, maxDuration]`.
- Zoom-to-region toggles back to the previous view on a second invoke.

### New `timeline/drag.feature` scenarios

- Lasso arms on pointerdown in an empty area; activates only after 4 px movement threshold.
- Pointer released before threshold → treated as a click: `timelineDeselect` + seek to click time when not additive; just seek when additive.
- Lasso vertical coverage decides which sets update (anchors / clips / scenes).
- Ctrl/Cmd held at lasso start → additive (merges with prior selection).
- Anchor drag input-space: snaps to scenes + clip boundaries; no grid snap.
- Anchor drag output-space: snaps to BPM grid, clamped to smallest-visible-tick spacing.
- During anchor drag: snap-hint candidates published (nearest 2 each side of subject in input space; only the active snap in output space).
- Region edge / move drag snaps to: anchors in matching space + scenes (input only) + other clips' edges + grid (output only).
- Region-move publishes `pubDragTime` for whichever edge wins the snap.
- Region edge clamp: min 0.1 s span; clamps to `[0, MAX]`.
- Follow-drag mode: anchor drag also seeks the playhead live.
- Scrub during ruler drag publishes `scrubTime`.
- `pointercancel` / window `blur` / Escape: drag state resets, **no commit fires**.
- Cursor changes by hit: anchor / region → `grab`; while dragging → `grabbing`; region edge → `ew-resize`; scene → `pointer`.
- Right-click dispatch by hit kind: anchor → `anchorContextMenu`; **beat anchor → `beatAnchorContextMenu`** (new — fixes today's silent drop); region → `regionContextMenu`; scene → `sceneContextMenu`; empty → `timelineContextMenu(time)`.
- Double-click dispatch by hit kind: anchor → delete; region → zoom; scene → delete.
- Double-click on empty track by row: scenes → add scene; clipin → add region; markerin → add anchor; others no-op.
- Delete / Backspace → `timelineDelete`. Cmd/Ctrl+D → `timelineDeselect`.
- Clipout track is not a drag target (re-asserts the existing scenario from the gesture POV — same behavior).
- Hover on scene → drives the scene-thumbnail popup, positioned at the diamond.

## Test surface

```
tests/bdd/timeline/
├── tracks.test.ts          (moved from tests/bdd/timelineTracks.test.ts; ThinTimeline-side; unchanged)
├── ruler.test.ts           (moved from rulerLayer.test.tsx)
├── region-creation.test.ts (moved from regionCreation.test.ts)
├── region-bounds.test.ts   (NEW — drives both controller and regionSlice for dual-trigger scenarios)
├── viewport.test.ts        (NEW — drives controller)
└── drag.test.ts            (NEW — drives controller)

tests/unit/timeline/model/
├── conform.test.ts
├── clampRegion.test.ts
├── snapTarget.test.ts
├── beatMap.test.ts
└── newRegionBounds.test.ts
```

**BDD test shape** (drag scenarios drive the controller; assertions are over emitted intents):

```ts
Scenario('Anchor drag in input space snaps to a nearby scene cut', ({ Given, When, Then }) => {
  const c = createTimelineController()
  let snap: Snapshot
  let intents: Intent[] = []

  Given('a video with scene at 10s and anchor 5 at 9.95s', () => { snap = makeSnap({...}) })
  When('the user drags anchor 5 toward the scene', () => {
    c.pointerDown({ clientX: 99, clientY: ANCHOR_Y, button: 0, canvasRect: RECT }, snap)
    intents = c.pointerMove({ clientX: 100, clientY: ANCHOR_Y, canvasRect: RECT }, snap)
  })
  Then('the live drag time is 10', () => {
    expect(intents).toContainEqual(expect.objectContaining({
      kind: 'pubDragTime', space: 'input', time: 10,
    }))
  })
  And('no commit has fired yet', () => {
    expect(intents.find(i => i.kind === 'anchorsChanged')).toBeUndefined()
  })
  When('the user releases', () => { intents = c.pointerUp(snap) })
  Then('anchorsChanged fires with anchor 5 at time 10', () => {
    const commit = intents.find(i => i.kind === 'anchorsChanged')!
    expect(commit.next.find(a => a.id === 5)?.time).toBe(10)
  })
})
```

**Dual-trigger pattern** (`timeline/region-bounds.test.ts`): the same scenario is run twice via Scenario Outline `<trigger>`. One trigger drives `controller.pointerDown / pointerMove / pointerUp`; the other dispatches `regionSlice.actions.updateRegionInOut(...)` directly. Both call into `src/timeline/model/clampRegion.ts` and `src/timeline/model/conform.ts`, so the observable result is shared.

## Migration order

Five PRs, each shippable and reversible. PR1 has the largest blast radius (touches the regionSlice path) but the smallest behavior delta. PR3 is the most code-heavy.

**PR1 — `src/timeline/model/`.** Extract conform, clampRegion, snapTarget, beatMap, newRegionBounds as pure functions. Add unit tests. Route both `regionSlice` and CanvasTimeline through them. No behavior change intended — but any subtle clamp/snap differences between today's two implementations will surface here, so each function gets parity tests against the current behavior.

**PR2 — spec migration.** Move `timeline_tracks.feature` → `timeline/tracks.feature`, `ruler-layer.feature` → `timeline/ruler.feature`, `region-creation.feature` → `timeline/region-creation.feature`. Split `region-editing.feature` into `timeline/region-bounds.feature` + slimmed top-level. Move corresponding `tests/bdd/*.test.ts` into `tests/bdd/timeline/`. Add `timeline/viewport.feature` and `timeline/drag.feature` with `@todo @ignore` tags so coverage doesn't gate on the new scenarios yet. Update `npm run behaviors` if it has hard-coded paths.

**PR3 — `src/timeline/controller.ts`.** Extract the gesture state machine and `layout.ts` / `ruler.ts` / `view.ts` / `hitTest.ts` helpers. CanvasTimeline shrinks to an adapter: builds Snapshot from props + Redux selectors, calls controller, applies returned intents (forwards prop callbacks, calls into `gesture` singleton, sets cursor, requests redraw). Wire `pointercancel` / `blur` / Escape → `controller.cancel()`. Fix beat-anchor context-menu dispatch as part of this PR. No new behaviors yet.

**PR4 — BDD coverage.** Implement `viewport.test.ts` and `drag.test.ts` against the controller. Drop `@ignore` tags in chunks as each scenario goes green. Implement `region-bounds.test.ts` dual-trigger scenarios.

**PR5 — cleanup.** Delete dead code paths in CanvasTimeline that are now unreachable. Tighten types. Remove module-level mutable `hits` array. Drop legacy `utils/view.ts` shims if anything is left over.

## Open questions

None at design time. Plan-writing time may surface ordering choices inside individual PRs.

## Out of scope (explicit)

- ThinTimeline modifications.
- Promoting drag state into Redux.
- Persistence schema changes.
- Visual / rendering rework.
- Replacing `src/store/gesture.ts`.
