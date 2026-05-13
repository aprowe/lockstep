# Timeline Controller Extraction Plan (PR3 of the timeline extraction)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Extract the gesture state machine from `src/components/CanvasTimeline.tsx` into a pure `src/timeline/controller.ts`. CanvasTimeline becomes a thin React adapter: builds a Snapshot from props + Redux, forwards events to the controller, applies returned intents (forwarding prop callbacks, publishing to gesture store, setting cursor, requesting redraw). ThinTimeline is untouched.

**Architecture:** Per the design spec at `docs/superpowers/specs/2026-05-11-canvas-timeline-extract-design.md`. The controller is stateful only for in-flight drags. All inputs flow through a per-event `Snapshot`. All outputs flow through a returned `Intent[]` list. No React, no Redux, no DOM access — that's the wrapper's job.

**Tech Stack:** TypeScript, vitest. No new dependencies.

---

## File Structure

**New:**
- `src/timeline/types.ts` — `Snapshot`, `Intent` union, `DragState` union, `HitEntry`, `Space`, `PointerEventLike`, `WheelEventLike`, `KeyEventLike`
- `src/timeline/layout.ts` — `TrackDef`, `LayoutTrack`, `ALL_TRACKS`, `buildLayout` (moved from CanvasTimeline)
- `src/timeline/ruler.ts` — `TIME_TIERS`, `timeLayers`, `barsLayers`, `TickLayer` (moved from CanvasTimeline)
- `src/timeline/view.ts` — `clampViewForCanvas` (wheel→view, minimap→view, zoom-around-cursor math; re-exports the existing `clampView` from `utils/view`)
- `src/timeline/hitTest.ts` — `buildHitList(snap, ctx)` returns `HitEntry[]`; `hitAt(hits, x, y)` — no module-level mutable state
- `src/timeline/controller.ts` — `createTimelineController()` returns `Controller` per spec
- `tests/unit/timeline/{layout,ruler,view,hitTest,controller}.test.ts`

**Modified:**
- `src/components/CanvasTimeline.tsx` — shrinks substantially:
  - Removes inline `buildLayout`, `timeLayers`, `barsLayers`, `TIME_TIERS`, `TickLayer`, `TrackDef`, `LayoutTrack`, `ALL_TRACKS`, `clearHits`, `addHit`, `hitAt`, `hits` (module-level)
  - Removes inline `handleMouseDown`, `handleMouseMove`, `handleMouseUp`, `handleDoubleClick`, `handleContextMenu`, `handleWheel`, `handleKeyDown`
  - Removes inline `dragRef`, `liveAnchorsIn`, `liveAnchorsOut`, `liveRegion`, `lassoAnchorIds`, `lassoClipIds`, `lassoSceneTimes` (these move into the controller's internal state — but the wrapper still consumes `getDragState()` to know what to draw)
  - Adds: `useMemo(() => createTimelineController(), [])`, snapshot building, intent forwarding, window listeners for `pointercancel` / `blur` / `keydown:Escape` → `controller.cancel()`
  - Keeps: `draw()` function (modified to read from `controller.getDragState()` for live drag visuals), theme refs, drag/drop UI chrome, props interface

**Out of scope:**
- ThinTimeline (untouched)
- Visual / rendering changes
- New BDD tests (PR4)
- The `@todo @ignore`-tagged scenarios in `spec/features/timeline/viewport.feature` and `drag.feature` stay ignored

---

## Task 1: Extract scaffolding (types, layout, ruler, view, hitTest)

Five new pure modules under `src/timeline/`, each with unit tests where useful. CanvasTimeline imports from these but otherwise unchanged.

**Files:**
- Create: `src/timeline/types.ts`, `src/timeline/layout.ts`, `src/timeline/ruler.ts`, `src/timeline/view.ts`, `src/timeline/hitTest.ts`
- Create tests: `tests/unit/timeline/layout.test.ts`, `tests/unit/timeline/ruler.test.ts`, `tests/unit/timeline/view.test.ts`, `tests/unit/timeline/hitTest.test.ts` (types.ts is just type declarations — no test)
- Modify: `src/components/CanvasTimeline.tsx` — import from new modules; delete the duplicated inline code

### Step 1: Create `src/timeline/types.ts`

This file defines the contract types. It has no runtime code.

```ts
import type { Anchor, View, WarpSegment } from '../types'
import type { RegionBlock } from '../components/thin/RegionBand'

export type Space = 'input' | 'output'

export interface Snapshot {
  view: View
  duration: number
  outputDuration: number
  maxDuration: number
  anchors: Anchor[]
  beatAnchors: Anchor[]
  selectedAnchorIds: ReadonlySet<number>
  regions: RegionBlock[]
  regionsOutput?: RegionBlock[]
  selectedClipIds: ReadonlySet<string>
  scenes: number[]
  selectedSceneTimes: ReadonlySet<number>
  segments: WarpSegment[]
  bpm: number
  beatOffset?: number
  snapInterval?: number
  snapOffset?: number
  followDrag: boolean
  warpCollapsed: boolean
  canvas: { width: number; height: number }
  tracks: LayoutTrack[]
  playhead?: number
}

export interface TrackDef {
  id: string
  label: string
  h: number
  space: 'input' | 'warp' | 'output'
  flex: number
}

export interface LayoutTrack extends TrackDef {
  y: number
}

export interface HitEntry {
  x: number
  y: number
  w: number
  h: number
  data: unknown
}

export interface PointerEventLike {
  clientX: number
  clientY: number
  button: number
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  canvasRect: { left: number; top: number; width: number; height: number }
}

export interface WheelEventLike extends PointerEventLike {
  deltaX: number
  deltaY: number
}

export interface KeyEventLike {
  key: string
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}

export type DragState =
  | { kind: 'seek'; space: Space }
  | { kind: 'pan'; startClientX: number; startView: View }
  | { kind: 'minimap'; startClientX: number; startView: View }
  | { kind: 'anchor'; id: number; space: Space; origTime: number; liveAnchors: Anchor[]; liveBeatAnchors: Anchor[] }
  | { kind: 'region-edge'; id: string; edge: 'in' | 'out'; isOutput: boolean; origIn: number; origOut: number; liveRegion: { id: string; inPoint: number; outPoint: number } | null }
  | { kind: 'region-move'; id: string; isOutput: boolean; origIn: number; origOut: number; anchorX: number; liveRegion: { id: string; inPoint: number; outPoint: number } | null }
  | {
      kind: 'lasso'
      startX: number; startY: number
      curX: number; curY: number
      additive: boolean
      initialAnchorIds: Set<number>
      initialClipIds: Set<string>
      initialSceneTimes: Set<number>
      active: boolean
      lassoAnchorIds: Set<number>
      lassoClipIds: Set<string>
      lassoSceneTimes: Set<number>
    }

export type Intent =
  // commits — wrapper forwards to prop callbacks
  | { kind: 'seek' | 'seekBeat'; time: number }
  | { kind: 'viewChange'; view: View }
  | { kind: 'anchorsChanged'; next: Anchor[] }
  | { kind: 'beatAnchorsChanged'; next: Anchor[] }
  | { kind: 'regionResize'; id: string; inPoint: number; outPoint: number; isOutput: boolean }
  | { kind: 'regionMove'; id: string; inPoint: number; outPoint: number; isOutput: boolean }
  | { kind: 'anchorAdd'; time: number }
  | { kind: 'anchorDelete'; id: number }
  | { kind: 'beatAnchorDelete'; id: number }
  | { kind: 'anchorSelect'; id: number; additive: boolean }
  | { kind: 'beatAnchorSelect'; id: number; additive: boolean }
  | { kind: 'anchorContextMenu'; id: number; x: number; y: number }
  | { kind: 'beatAnchorContextMenu'; id: number; x: number; y: number }
  | { kind: 'sceneContextMenu'; time: number; x: number; y: number }
  | { kind: 'regionContextMenu'; id: string; x: number; y: number }
  | { kind: 'timelineContextMenu'; time: number; x: number; y: number }
  | { kind: 'sceneAdd'; time: number }
  | { kind: 'sceneDelete'; time: number }
  | { kind: 'regionAdd'; time: number }
  | { kind: 'regionSelect'; id: string }
  | { kind: 'regionZoom'; id: string }
  | { kind: 'timelineDeselect' }
  | { kind: 'timelineDelete' }
  | { kind: 'clipsSelectionChange'; ids: Set<string> }
  | { kind: 'scenesSelectionChange'; times: Set<number> }
  | { kind: 'connectorSelectionChange'; ids: Set<number> }
  // gesture-store publishes — wrapper forwards to src/store/gesture.ts singleton
  | { kind: 'pubDragRegion'; id: string; inPoint: number; outPoint: number }
  | { kind: 'pubDragTime'; space: Space | null; time: number | null }
  | { kind: 'pubSnapHints'; space: Space; times: readonly number[] }
  | { kind: 'pubScrubTime'; time: number | null }
  | { kind: 'pubLasso'; clipIds: Set<string>; anchorIds: Set<number>; sceneTimes: Set<number> }
  | { kind: 'pubClearGesture' }
  // canvas-side hints
  | { kind: 'cursor'; cursor: '' | 'grab' | 'grabbing' | 'ew-resize' | 'pointer' }
  | { kind: 'redraw' }
```

### Step 2: Create `src/timeline/layout.ts`

Move from CanvasTimeline lines ~59-104. Constants: `RAIL_W = 72`, `MINIMAP_H = 24`, `TRI_HALF = 6`, `TRI_H = 9`, `FONT = 'ui-monospace, Consolas, monospace'`. Export `ALL_TRACKS`, `buildLayout(warpCollapsed, totalH, overrides?) → LayoutTrack[]`. Import `TrackDef` and `LayoutTrack` from `types.ts` and re-export them for backward convenience.

```ts
import type { TrackDef, LayoutTrack } from './types'

export const RAIL_W = 72
export const MINIMAP_H = 24
export const TRI_HALF = 6
export const TRI_H = 9
export const FONT = 'ui-monospace, Consolas, monospace'

export type { TrackDef, LayoutTrack }

export const ALL_TRACKS: TrackDef[] = [
  { id: 'time',      label: 'Time',       h: 20, space: 'input',  flex: 1 },
  { id: 'scenes',    label: 'Scenes',     h: 18, space: 'input',  flex: 0 },
  { id: 'clipin',    label: 'Clip In',    h: 28, space: 'input',  flex: 1 },
  { id: 'markerin',  label: 'Anchor In',  h: 28, space: 'input',  flex: 1 },
  { id: 'warp',      label: 'Warp',       h: 44, space: 'warp',   flex: 1 },
  { id: 'markerout', label: 'Anchor Out', h: 28, space: 'output', flex: 1 },
  { id: 'clipout',   label: 'Clip Out',   h: 28, space: 'output', flex: 0 },
  { id: 'beat',      label: 'Beats',      h: 20, space: 'output', flex: 1 },
  { id: 'speed',     label: 'Speed',      h: 22, space: 'output', flex: 0 },
]

export function buildLayout(
  warpCollapsed: boolean,
  totalH: number,
  overrides: Record<string, number> = {},
): LayoutTrack[] {
  const visible = ALL_TRACKS.filter(def => !(warpCollapsed && def.space !== 'input'))
  const available = totalH - MINIMAP_H - 1 - visible.length

  let usedH = 0
  let flexSum = 0
  for (const t of visible) {
    if (overrides[t.id] !== undefined) usedH += overrides[t.id]
    else { usedH += t.h; flexSum += t.flex }
  }
  const extra = Math.max(0, available - usedH)

  const result: LayoutTrack[] = []
  let y = MINIMAP_H + 1
  for (const def of visible) {
    let h: number
    if (overrides[def.id] !== undefined) h = overrides[def.id]
    else h = def.h + (flexSum > 0 ? (def.flex / flexSum) * extra : 0)
    result.push({ ...def, h, y })
    y += h + 1
  }
  return result
}
```

Tests at `tests/unit/timeline/layout.test.ts`: cases for warp-collapsed (only input tracks present), flex distribution, override per row.

### Step 3: Create `src/timeline/ruler.ts`

Move from CanvasTimeline lines ~107-180. `TARGET_PX = 60`, `TIME_TIERS`, `TickLayer` interface, `timeLayers`, `barsLayers`.

```ts
export const TARGET_PX = 60

export const TIME_TIERS: readonly [number, number][] = [
  [0.001,0.0002],[0.002,0.0005],[0.005,0.001],[0.01,0.002],[0.02,0.005],
  [0.05,0.01],[0.1,0.02],[0.2,0.05],[0.5,0.1],[1,0.2],[2,0.5],[5,1],
  [10,2],[15,5],[30,10],[60,15],[120,30],[300,60],[600,120],[1800,300],[3600,600],
]

export interface TickLayer {
  spacingUnit: number
  styleKey: 'bar' | 'beat' | 'sub'
  tickHeight?: number
  isMajor?: boolean
  skipModulo?: number
  label?: ((unit: number) => string | null) | null
  labelStyle?: 'major' | 'minor'
}

export function timeLayers(pps: number, span: number): TickLayer[] {
  let tier: readonly [number, number] = TIME_TIERS[TIME_TIERS.length - 1]
  for (const t of TIME_TIERS) { if (t[0] * pps >= TARGET_PX) { tier = t; break } }
  const [major, sub] = tier
  const ratio = Math.round(major / sub)
  const layers: TickLayer[] = []
  if (sub * pps >= 6) layers.push({ spacingUnit: sub, styleKey: 'sub', tickHeight: 5, skipModulo: ratio })
  const decimals = major >= 1 ? 0 : span < 2 ? 3 : 2
  layers.push({
    spacingUnit: major, styleKey: 'bar', isMajor: true,
    label: (s) => {
      if (s < 0) return null
      const ip = Math.floor(s)
      if (decimals === 0) return `${String(ip).padStart(2, '0')}s`
      return `${String(ip).padStart(2, '0')}${(s - ip).toFixed(decimals).slice(1)}s`
    },
    labelStyle: 'major',
  })
  return layers
}

export function barsLayers(ppb: number, bpb: number): TickLayer[] {
  const ppbar = ppb * bpb
  let barGroup = 1
  while (ppbar * barGroup < TARGET_PX) barGroup *= 2
  if (barGroup > 4096) barGroup = 4096
  const subBarGroup = barGroup >= 8 ? barGroup / 8 : barGroup >= 2 ? 1 : 0
  const show16 = barGroup === 1 && ppb / 4 >= 6
  const show8  = barGroup === 1 && !show16 && ppb / 2 >= 9
  const showBt = barGroup === 1 && ppb >= 22
  const lblBt  = barGroup === 1 && ppb >= 70
  const layers: TickLayer[] = []
  if (show16) layers.push({ spacingUnit: 0.25, styleKey: 'sub', tickHeight: 4, skipModulo: 4 })
  else if (show8) layers.push({ spacingUnit: 0.5, styleKey: 'sub', tickHeight: 5, skipModulo: 2 })
  if (showBt) {
    layers.push({
      spacingUnit: 1, styleKey: 'beat', tickHeight: 9, skipModulo: bpb,
      label: lblBt ? (b) => {
        const bar = Math.floor(b / bpb)
        return `${bar >= 0 ? bar + 1 : bar}.${Math.floor(b % bpb) + 1}`
      } : null,
      labelStyle: 'minor',
    })
  }
  if (subBarGroup > 0) layers.push({
    spacingUnit: subBarGroup * bpb, styleKey: 'beat', tickHeight: 11,
    skipModulo: barGroup / subBarGroup,
  })
  layers.push({
    spacingUnit: barGroup * bpb, styleKey: 'bar', isMajor: true,
    label: (b) => { const bar = Math.floor(b / bpb); return String(bar >= 0 ? bar + 1 : bar) },
    labelStyle: 'major',
  })
  return layers
}
```

Tests at `tests/unit/timeline/ruler.test.ts`: a few cases for `timeLayers` at different `pps` (verify tier selection), `barsLayers` for typical zoom levels.

### Step 4: Create `src/timeline/view.ts`

Wheel and minimap math, plus re-export the existing `clampView`.

```ts
import type { View } from '../types'
import { clampView as baseClampView } from '../utils/view'

export const clampView = baseClampView

/** Compute the next view after a wheel zoom around `cursorX`. */
export function wheelZoom(
  view: View,
  cursorX: number,
  canvasWidth: number,
  deltaY: number,
  maxDuration: number,
): View {
  const factor = Math.exp(-deltaY * 0.002)
  const unitAt = view.start + (cursorX / canvasWidth) * (view.end - view.start)
  const span = view.end - view.start
  const newSpan = Math.max(0.1, Math.min(maxDuration * 2, span / factor))
  const newStart = unitAt - cursorX / canvasWidth * newSpan
  return clampView(newStart, newStart + newSpan, maxDuration)
}

/** Compute the next view after a wheel pan (no zoom modifier). */
export function wheelPan(
  view: View,
  canvasWidth: number,
  deltaX: number,
  deltaY: number,
  shiftKey: boolean,
  maxDuration: number,
): View {
  const span = view.end - view.start
  const px = (shiftKey && deltaX === 0) ? deltaY : (deltaX !== 0 ? deltaX : deltaY)
  const delta = px / canvasWidth * span
  return clampView(view.start + delta, view.end + delta, maxDuration)
}

/** Compute the next view from a minimap click at `clientXInMinimap`. */
export function minimapRecenter(
  view: View,
  clientXInMinimap: number,
  minimapWidth: number,
  maxDuration: number,
): View {
  const t = (clientXInMinimap / minimapWidth) * maxDuration
  const span = view.end - view.start
  return clampView(t - span / 2, t + span / 2, maxDuration)
}

/** Compute the next view for a click-and-drag pan. */
export function dragPan(
  startView: View,
  canvasWidth: number,
  pxDelta: number,
  maxDuration: number,
): View {
  const span = startView.end - startView.start
  const dx = pxDelta / canvasWidth * span
  return clampView(startView.start - dx, startView.end - dx, maxDuration)
}
```

Tests at `tests/unit/timeline/view.test.ts`: each function with representative inputs.

### Step 5: Create `src/timeline/hitTest.ts`

Currently CanvasTimeline uses a module-level mutable `hits` array (lines ~258-268). Replace with a pure function that takes the relevant inputs and returns a fresh array.

The function builds hit entries during `draw()` — every clickable element registers a rect. We can extract this without breaking the draw loop by having `buildHitList` accept the same inputs the draw loop has access to (snapshot + layout + various live state).

Actually, the hit list is built incrementally during draw. The simplest extraction is to have the controller's wrapper just construct it from the same data using a builder:

```ts
import type { HitEntry, Snapshot, LayoutTrack } from './types'

export interface HitListBuilder {
  add(x: number, y: number, w: number, h: number, data: unknown): void
  result(): HitEntry[]
}

export function createHitListBuilder(): HitListBuilder {
  const hits: HitEntry[] = []
  return {
    add(x, y, w, h, data) { hits.push({ x, y, w, h, data }) },
    result() { return hits },
  }
}

export function hitAt(hits: readonly HitEntry[], px: number, py: number): unknown {
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i]
    if (px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h) return h.data
  }
  return null
}
```

The wrapper creates a builder per draw call and passes it into a `recordHits` step that mirrors draw's structure. Alternatively, keep the builder inline in `draw()` but use the module-level functions. Pick the simpler one — likely the latter:

CanvasTimeline's `draw()` continues to call `addHit(...)` during its existing flow, but `addHit` now comes from a builder created at the top of `draw()`. After draw, the builder's result is stored in a ref the controller can read. The controller's pointer handlers then call `hitAt(getHits(), x, y)`.

The plan deliberately leaves the exact builder mechanics flexible — the implementer can choose between "module-level globals" (current style), "builder threaded through draw", or "draw returns hits". Pick what's least disruptive to draw().

Tests at `tests/unit/timeline/hitTest.test.ts`: `hitAt` with a few rects + check last-wins behavior.

### Step 6: Update CanvasTimeline to import from new modules

Replace the inline `TrackDef`, `LayoutTrack`, `ALL_TRACKS`, `buildLayout`, `TIME_TIERS`, `TickLayer`, `timeLayers`, `barsLayers`, `RAIL_W`, `MINIMAP_H`, `TRI_HALF`, `TRI_H`, `FONT`, `hits`, `clearHits`, `addHit`, `hitAt` with imports from the new modules.

If `hitTest.ts` uses the builder pattern, replace the module-level `hits` with a `useRef` holding the latest result. If it uses globals, just re-export them. Either way, `addHit` calls inside `draw()` still work the same.

### Step 7: Run tests + commit

```
npm test
```

Expected: 828+ passing (new model unit tests add to count). Pre-existing failures unchanged.

```
git add src/timeline/{types,layout,ruler,view,hitTest}.ts tests/unit/timeline/{layout,ruler,view,hitTest}.test.ts src/components/CanvasTimeline.tsx
git commit -m "feat(timeline): extract layout/ruler/view/hitTest scaffolding from CanvasTimeline"
```

---

## Task 2: Controller core — state machine, pointerDown, cancel

Implement `createTimelineController()` returning an object with stub methods, then fill in `pointerDown` and `cancel`. `pointerMove` / `pointerUp` / etc. throw `Error('not yet implemented')` so tests fail loudly until they're filled in.

**Files:**
- Create: `src/timeline/controller.ts`
- Create: `tests/unit/timeline/controller.test.ts`

The controller holds `DragState | null` and `LayoutTrack[]` (last seen via snapshot, used inside pointerMove). It does NOT call into the gesture store or model directly — model usage happens inside each event handler via the imported pure functions.

**Key invariants the tests should pin:**
- `pointerDown` on minimap → emits `viewChange` + sets DragState `{kind:'minimap'}`.
- `pointerDown` on anchor hit → sets DragState `{kind:'anchor', ...}`, emits `anchorSelect`, captures live anchor arrays from snapshot.
- `pointerDown` on region body hit → sets DragState `{kind:'region-move', ...}`, emits `regionSelect`.
- `pointerDown` on region-edge hit → sets DragState `{kind:'region-edge', ...}`, emits `regionSelect`.
- `pointerDown` on time/beat ruler → sets DragState `{kind:'seek', space}`, emits `seek` or `seekBeat`.
- `pointerDown` with `altKey || button === 1` → sets DragState `{kind:'pan', ...}`.
- `pointerDown` on empty area → sets DragState `{kind:'lasso', active: false, ...}`.
- `cancel()` clears DragState, emits `pubClearGesture`. No commit intents.

Tests should exercise each branch with a synthetic Snapshot (a `makeSnapshot()` helper at the top of the test file).

### Subagent guidance
- Use `hitAt(snap.hits, x, y)` for routing. The hits live in the Snapshot (added in Task 1 — if `hitTest.ts` uses the builder pattern, the wrapper passes the builder result on the snapshot; if globals, the controller just calls `hitAt` directly).
- For now, accept that hits are in `snap.hits: HitEntry[]`. Update Snapshot to include this field if it doesn't yet.

### Verify

```
npx vitest run tests/unit/timeline/controller.test.ts
```

All `pointerDown` branches + `cancel` test pass.

### Commit

```
git add src/timeline/controller.ts tests/unit/timeline/controller.test.ts src/timeline/types.ts
git commit -m "feat(timeline/controller): pointerDown routing + cancel state machine"
```

---

## Task 3: pointerMove for every drag kind

Fill in `pointerMove` to handle each drag kind. The bulk of the gesture logic lives here.

Each kind emits the right intents:
- `seek`: pubScrubTime + seek/seekBeat
- `pan`: viewChange
- `minimap`: viewChange (recenter)
- `anchor`: snap (using `model/snapTarget`), update live arrays, pubDragTime, pubSnapHints, followDrag → seek/seekBeat
- `region-edge`: snap (regionDragTargets), clamp (model/clampRegion), pubDragRegion (input-only), pubDragTime, pubSnapHints, update liveRegion
- `region-move`: snap, clamp (move both edges rigidly), pubDragRegion, pubDragTime, pubSnapHints, update liveRegion
- `lasso`: arm/activate threshold, compute coverage from tracks, update lasso sets, pubLasso

The controller's internal `DragState` must be mutated in place for live arrays — return `Intent[]` for everything else.

**Test coverage:** at minimum 1 test per drag kind covering the "happy path" + 1 test for snap-snapped-to-something.

### Commit

```
git add src/timeline/controller.ts tests/unit/timeline/controller.test.ts
git commit -m "feat(timeline/controller): pointerMove for all drag kinds with snap + clamp"
```

---

## Task 4: pointerUp commits, wheel, doubleClick, contextMenu, keyDown

`pointerUp` emits the commit intents based on `DragState.kind`:
- `anchor`: anchorsChanged (input space) or beatAnchorsChanged (output space)
- `region-edge` / `region-move`: regionResize / regionMove (with isOutput flag)
- `lasso` active: clipsSelectionChange / scenesSelectionChange / connectorSelectionChange
- `lasso` not active, not additive: timelineDeselect + seek (the "click in empty area" fallback)

After commits fire, the controller clears DragState and emits `pubClearGesture`.

`wheel(e, snap)`:
- If `e.ctrlKey || e.metaKey` → wheelZoom → viewChange
- Otherwise → wheelPan → viewChange

`doubleClick(e, snap)`:
- Hit-test
- anchor (input) → anchorDelete
- anchor (output) → beatAnchorDelete
- region → regionZoom
- scene → sceneDelete
- Otherwise look up track under cursor → sceneAdd / regionAdd / anchorAdd

`contextMenu(e, snap)`:
- Hit-test
- anchor input → anchorContextMenu
- anchor output → **beatAnchorContextMenu** (NEW — fixes the silent-drop bug)
- region → regionContextMenu
- scene → sceneContextMenu
- Otherwise → timelineContextMenu(time)

`keyDown(e)`:
- Delete/Backspace → timelineDelete
- Cmd/Ctrl+D (no shift) → timelineDeselect

### Commit

```
git add src/timeline/controller.ts tests/unit/timeline/controller.test.ts
git commit -m "feat(timeline/controller): pointerUp commits + wheel/dblclick/contextmenu/keydown"
```

---

## Task 5: Wire CanvasTimeline through the controller

The big integration. Replace the inline `handle*` functions in CanvasTimeline with controller calls.

### Step 1: Capture baseline

```
npm test
```

Note pass count.

### Step 2: Build the Snapshot adapter

Add a `makeSnapshot()` function inside CanvasTimeline that reads from props, Redux selectors (`useAppSelector`s already present in the file), the canvas rect, and the current `tracks` array. The snapshot is built fresh per event — no caching.

### Step 3: Add controller + intent dispatcher

```ts
import { createTimelineController } from '../timeline/controller'
import { gesture } from '../store/gesture'

// inside the component:
const controllerRef = useRef(createTimelineController())

function applyIntents(intents: Intent[]) {
  const p = propsRef.current
  for (const i of intents) {
    switch (i.kind) {
      case 'seek': p.onSeek?.(i.time); break
      case 'seekBeat': p.onSeekBeat?.(i.time); break
      case 'viewChange': p.onViewChange(i.view); break
      case 'anchorsChanged': p.onAnchorsChange?.(i.next); break
      case 'beatAnchorsChanged': p.onBeatAnchorsChange?.(i.next); break
      case 'regionResize':
        i.isOutput ? p.onRegionResizeOutput?.(i.id, i.inPoint, i.outPoint)
                   : p.onRegionResize?.(i.id, i.inPoint, i.outPoint)
        break
      case 'regionMove':
        i.isOutput ? p.onRegionMoveOutput?.(i.id, i.inPoint, i.outPoint)
                   : p.onRegionMove?.(i.id, i.inPoint, i.outPoint)
        break
      case 'anchorAdd': p.onAnchorAdd?.(i.time); break
      case 'anchorDelete': p.onAnchorDelete?.(i.id); break
      case 'beatAnchorDelete': p.onBeatAnchorDelete?.(i.id); break
      case 'anchorSelect': p.onAnchorSelect?.(i.id, i.additive); break
      case 'beatAnchorSelect': p.onBeatAnchorSelect?.(i.id, i.additive); break
      case 'anchorContextMenu': p.onAnchorContextMenu?.(i.id, i.x, i.y); break
      case 'beatAnchorContextMenu': p.onBeatAnchorContextMenu?.(i.id, i.x, i.y); break
      case 'sceneContextMenu': p.onSceneContextMenu?.(i.time, i.x, i.y); break
      case 'regionContextMenu': p.onRegionContextMenu?.(i.id, i.x, i.y); break
      case 'timelineContextMenu': p.onTimelineContextMenu?.(i.time, i.x, i.y); break
      case 'sceneAdd': p.onSceneAdd?.(i.time); break
      case 'sceneDelete': p.onSceneDelete?.(i.time); break
      case 'regionAdd': p.onRegionAdd?.(i.time); break
      case 'regionSelect': p.onRegionSelect?.(i.id); break
      case 'regionZoom': p.onRegionZoom?.(i.id); break
      case 'timelineDeselect': p.onTimelineDeselect?.(); break
      case 'timelineDelete': p.onTimelineDelete?.(); break
      case 'clipsSelectionChange': p.onClipsSelectionChange?.(i.ids); break
      case 'scenesSelectionChange': p.onScenesSelectionChange?.(i.times); break
      case 'connectorSelectionChange': p.onConnectorSelectionChange?.(i.ids); break
      case 'pubDragRegion': gesture.setDragRegion(i.id, i.inPoint, i.outPoint); break
      case 'pubDragTime': gesture.setDragTime(i.space, i.time); break
      case 'pubSnapHints': gesture.setSnapHints(i.space, i.times); break
      case 'pubScrubTime': gesture.setScrubTime(i.time); break
      case 'pubLasso': gesture.setLassoSelection(i.clipIds, i.anchorIds, i.sceneTimes); break
      case 'pubClearGesture': gesture.clearAll(); break
      case 'cursor': if (canvasRef.current) canvasRef.current.style.cursor = i.cursor; break
      case 'redraw': drawRef.current(); break
    }
  }
}
```

### Step 4: Replace each handler

`handleMouseDown(e)` becomes:
```ts
function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
  const snap = makeSnapshot(e.currentTarget)
  const intents = controllerRef.current.pointerDown(toPointerEvent(e), snap)
  applyIntents(intents)
}
```

Same pattern for `handleMouseMove`, `handleMouseUp`, `handleWheel`, `handleDoubleClick`, `handleContextMenu`, `handleKeyDown`. Add a `toPointerEvent(e)` / `toWheelEvent(e)` / `toKeyEvent(e)` adapter that produces the `*EventLike` types from React's event objects.

Window-level listeners get `pointercancel` + `blur` + `keydown:Escape` → `controllerRef.current.cancel(); applyIntents(intents)`.

### Step 5: Adapt draw() to read controller state for live visuals

`draw()` currently reads from `liveAnchorsIn.current`, `liveAnchorsOut.current`, `liveRegion.current`, `lassoAnchorIds.current`, etc. Replace with `controllerRef.current.getDragState()` and pattern-match by kind to extract the live arrays. The conform logic and beatOffset derivation work the same way using the live data.

### Step 6: Verify

```
npm test
npx tsc --noEmit
```

All existing tests still pass. Specifically: timelineTracks tests (which exercise the model via the live-drag path), regionEditing tests (live commits), regionCreation tests.

Smoke-test list (you can't run the app in a subagent — verify by inspection):
- Drag an anchor → conform updates clipout live (the test in tracks.feature)
- Drag a clip → snap to scenes/anchors works
- Lasso → arm → activate threshold → select
- Wheel zoom → cursor stays under fixed time
- Right-click on beat anchor → onBeatAnchorContextMenu fires (this is the new fix)

### Step 7: Commit

```
git add src/components/CanvasTimeline.tsx
git commit -m "refactor(CanvasTimeline): wire through pure controller; window listeners for cancel"
```

---

## Task 6: Cleanup + verify PR3

### Step 1: Remove leftover dead code

After Task 5, CanvasTimeline.tsx may have:
- Unused imports (anything from the old inline helpers)
- Dead refs (liveAnchorsIn, liveAnchorsOut, etc. now redundant with controller state)
- The old DragKind type if it duplicates the new one
- A now-unused `hits` array if hitTest.ts replaced it

Audit and remove. Run tests after each removal.

### Step 2: Full verification

```
npm test
npm run behaviors
npx tsc --noEmit
git log --oneline 5f64033..HEAD
git diff --stat 5f64033..HEAD
```

Expected:
- 828+ tests pass (+ new controller unit tests)
- behaviors 100%
- tsc: only pre-existing menubar.tsx error
- ~7 commits since PR2 finish
- CanvasTimeline.tsx significantly shorter (~400-600 lines removed)

### Step 3: Commit any cleanup

```
git add src/components/CanvasTimeline.tsx
git commit -m "chore(CanvasTimeline): remove dead inline gesture code superseded by controller"
```

---

## Self-review notes

- Each task ends with a green test suite + a commit.
- Task 1 doesn't change behavior (pure extraction).
- Task 5 is the riskiest — wraps a 1000+ line file in a new abstraction. Subagent should run smoke-test cases via `npm test` after every change.
- The beat-anchor right-click fix lands in Task 4 (via the controller) and integrates in Task 5 (via the prop callback).
- The pointercancel/blur/Escape cancel listeners land in Task 5.
- ThinTimeline stays untouched. The gesture singleton is the only shared write surface.

## Out of scope (explicit)

- BDD tests for the controller (PR4)
- Removing `@todo @ignore` from viewport.feature / drag.feature (PR4)
- Visual / rendering changes
- ThinTimeline modifications
