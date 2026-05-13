# BDD Controller Coverage Plan (PR4 of the timeline extraction)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Drive `spec/features/timeline/viewport.feature` and `spec/features/timeline/drag.feature` scenarios against the timeline controller, un-tagging `@ignore` as scenarios go green. This makes the previously-undocumented CanvasTimeline behaviors actually tested.

**Architecture:** Each scenario constructs a Snapshot, builds a controller, calls one or more `controller.<method>(event, snap)` invocations, and asserts on emitted intents. No DOM rendering required. The fixture is shared between viewport and drag tests.

**Tech Stack:** vitest-cucumber, vitest. Existing controller in `src/timeline/controller.ts`. Model fns in `src/timeline/model/`.

---

## Task 1: Test fixture + viewport.feature

Create the fixture (Snapshot builder + intent helpers) once. Use it to implement all 11 viewport.feature scenarios. Un-tag each as it goes green.

**Files:**
- Create: `tests/bdd/timeline/fixtures.ts` — shared helpers
- Create: `tests/bdd/timeline/viewport.test.ts` — drives viewport.feature
- Modify: `spec/features/timeline/viewport.feature` — remove `@ignore`/`@todo` tags from scenarios that pass

### Step 1: Create the fixture

```ts
// tests/bdd/timeline/fixtures.ts
import type {
  Snapshot, PointerEventLike, WheelEventLike, KeyEventLike, Intent, LayoutTrack, HitEntry,
} from '../../../src/timeline/types'
import type { Anchor, View, WarpSegment } from '../../../src/types'
import type { RegionBlock } from '../../../src/components/thin/RegionBand'
import { buildLayout, MINIMAP_H } from '../../../src/timeline/layout'

const DEFAULT_CANVAS = { width: 1000, height: 600 }
const DEFAULT_VIEW: View = { start: 0, end: 100 }
const DEFAULT_RECT = { left: 0, top: 0, width: 1000, height: 600 }

export interface SnapOverrides {
  view?: View
  duration?: number
  outputDuration?: number
  maxDuration?: number
  anchors?: Anchor[]
  beatAnchors?: Anchor[]
  selectedAnchorIds?: ReadonlySet<number>
  regions?: RegionBlock[]
  regionsOutput?: RegionBlock[]
  selectedClipIds?: ReadonlySet<string>
  scenes?: number[]
  selectedSceneTimes?: ReadonlySet<number>
  segments?: WarpSegment[]
  bpm?: number
  beatOffset?: number
  snapInterval?: number
  snapOffset?: number
  followDrag?: boolean
  warpCollapsed?: boolean
  canvas?: { width: number; height: number }
  tracks?: LayoutTrack[]
  hits?: HitEntry[]
  playhead?: number
}

export function makeSnap(o: SnapOverrides = {}): Snapshot {
  const canvas = o.canvas ?? DEFAULT_CANVAS
  const tracks = o.tracks ?? buildLayout(o.warpCollapsed ?? false, canvas.height)
  return {
    view: o.view ?? DEFAULT_VIEW,
    duration: o.duration ?? 100,
    outputDuration: o.outputDuration ?? 100,
    maxDuration: o.maxDuration ?? 100,
    anchors: o.anchors ?? [],
    beatAnchors: o.beatAnchors ?? [],
    selectedAnchorIds: o.selectedAnchorIds ?? new Set(),
    regions: o.regions ?? [],
    regionsOutput: o.regionsOutput,
    selectedClipIds: o.selectedClipIds ?? new Set(),
    scenes: o.scenes ?? [],
    selectedSceneTimes: o.selectedSceneTimes ?? new Set(),
    segments: o.segments ?? [],
    bpm: o.bpm ?? 120,
    beatOffset: o.beatOffset,
    snapInterval: o.snapInterval,
    snapOffset: o.snapOffset,
    followDrag: o.followDrag ?? false,
    warpCollapsed: o.warpCollapsed ?? false,
    canvas,
    tracks,
    hits: o.hits ?? [],
    playhead: o.playhead,
  }
}

export interface PointerOverrides {
  clientX: number
  clientY: number
  button?: number
  shiftKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  canvasRect?: { left: number; top: number; width: number; height: number }
}

export function makePointer(o: PointerOverrides): PointerEventLike {
  return {
    clientX: o.clientX,
    clientY: o.clientY,
    button: o.button ?? 0,
    shiftKey: o.shiftKey ?? false,
    ctrlKey: o.ctrlKey ?? false,
    metaKey: o.metaKey ?? false,
    altKey: o.altKey ?? false,
    canvasRect: o.canvasRect ?? DEFAULT_RECT,
  }
}

export interface WheelOverrides extends PointerOverrides {
  deltaX?: number
  deltaY?: number
}

export function makeWheel(o: WheelOverrides): WheelEventLike {
  return {
    ...makePointer(o),
    deltaX: o.deltaX ?? 0,
    deltaY: o.deltaY ?? 0,
  }
}

export function makeKey(key: string, mods: Partial<Pick<KeyEventLike, 'shiftKey'|'ctrlKey'|'metaKey'|'altKey'>> = {}): KeyEventLike {
  return {
    key,
    shiftKey: mods.shiftKey ?? false,
    ctrlKey: mods.ctrlKey ?? false,
    metaKey: mods.metaKey ?? false,
    altKey: mods.altKey ?? false,
  }
}

/** Find the first intent matching a kind. */
export function findIntent<K extends Intent['kind']>(intents: Intent[], kind: K): Extract<Intent, { kind: K }> | undefined {
  return intents.find(i => i.kind === kind) as Extract<Intent, { kind: K }> | undefined
}

/** Locate a track by id in a snapshot for hit-test setup. */
export function trackY(snap: Snapshot, id: string): number {
  const tr = snap.tracks.find(t => t.id === id)
  if (!tr) throw new Error(`Track ${id} not in snapshot`)
  return tr.y + tr.h / 2
}

/** Build a hit entry for a region at view-relative time positions. */
export function regionHit(snap: Snapshot, regionId: string, edge: 'in' | 'out' | 'body' = 'body'): HitEntry {
  const r = snap.regions.find(x => x.id === regionId)
  if (!r) throw new Error(`Region ${regionId} not found`)
  const tr = snap.tracks.find(t => t.id === 'clipin')
  if (!tr) throw new Error('clipin track missing')
  const W = snap.canvas.width
  const span = snap.view.end - snap.view.start
  const x1 = ((r.inPoint - snap.view.start) / span) * W
  const x2 = ((r.outPoint - snap.view.start) / span) * W
  if (edge === 'in') return { x: x1 - 4, y: tr.y, w: 8, h: tr.h, data: { kind: 'region-edge', id: regionId, edge: 'in', isOutput: false } }
  if (edge === 'out') return { x: x2 - 4, y: tr.y, w: 8, h: tr.h, data: { kind: 'region-edge', id: regionId, edge: 'out', isOutput: false } }
  return { x: x1 + 4, y: tr.y, w: Math.max(0, x2 - x1 - 8), h: tr.h, data: { kind: 'region', id: regionId, isOutput: false } }
}

export function anchorHit(snap: Snapshot, anchorId: number, space: 'input' | 'output' = 'input'): HitEntry {
  const list = space === 'input' ? snap.anchors : snap.beatAnchors
  const a = list.find(x => x.id === anchorId)
  if (!a) throw new Error(`Anchor ${anchorId} not found in ${space}`)
  const trId = space === 'input' ? 'markerin' : 'markerout'
  const tr = snap.tracks.find(t => t.id === trId)
  if (!tr) throw new Error(`${trId} track missing`)
  const W = snap.canvas.width
  const span = snap.view.end - snap.view.start
  const x = ((a.time - snap.view.start) / span) * W
  return { x: x - 5, y: tr.y, w: 10, h: tr.h, data: { kind: 'anchor', id: anchorId, space } }
}

export function sceneHit(snap: Snapshot, time: number): HitEntry {
  const tr = snap.tracks.find(t => t.id === 'scenes')
  if (!tr) throw new Error('scenes track missing')
  const W = snap.canvas.width
  const span = snap.view.end - snap.view.start
  const x = ((time - snap.view.start) / span) * W
  return { x: x - 6, y: tr.y, w: 12, h: tr.h, data: { kind: 'scene', time } }
}

export function minimapHit(): HitEntry {
  return { x: 0, y: 0, w: 1000, h: MINIMAP_H, data: { kind: 'minimap' } }
}
```

### Step 2: Write the viewport BDD test

Create `tests/bdd/timeline/viewport.test.ts`. Use `describeFeature(loadFeature(...))` pattern from existing BDD tests. For each of the 11 scenarios in `spec/features/timeline/viewport.feature`, write a `Scenario(...)` block that drives the controller and asserts the right intent fires.

Use `@behavior viewport::<id>` annotations above each Scenario block. The hashes will be computed during the pre-commit hook's `behaviors` step — pick any unique 8-char hex per scenario (e.g., `viewport::wheel-pan`, `viewport::wheel-zoom`, etc.). Run `npm run behaviors` once; if the hashes don't match what the parser computes, the registry will tell you the correct ones.

Each scenario's pattern:
```ts
Scenario('Wheel scroll pans the viewport horizontally', ({ Given, When, Then, And }) => {
  const c = createTimelineController()
  let snap = makeSnap({ view: { start: 10, end: 20 } })
  let intents: Intent[] = []
  Given('[a video is loaded]', () => {})
  When('the user scrolls the mouse wheel with no modifier keys', () => {
    intents = c.wheel(makeWheel({ clientX: 500, clientY: 200, deltaX: 100, deltaY: 0 }), snap)
  })
  Then('the viewport pans horizontally', () => {
    const v = findIntent(intents, 'viewChange')!
    expect(v.view.start).not.toBe(10)
  })
  And('the viewport zoom span stays the same', () => {
    const v = findIntent(intents, 'viewChange')!
    expect(v.view.end - v.view.start).toBeCloseTo(10, 3)
  })
})
```

### Step 3: Un-tag each passing scenario

For every scenario where the test passes, edit `spec/features/timeline/viewport.feature`:
1. Remove the Feature-level `@todo @ignore` tags ONLY if every scenario is now implemented.
2. Otherwise, leave Feature-level tags but add `@ignore` per remaining scenario? No — simpler: remove Feature-level `@todo @ignore` when ALL viewport scenarios are implemented. If some are deferred, add `@todo` per deferred scenario.

For PR4 Task 1's goal: implement ALL 11 viewport scenarios. Then drop the Feature-level tags.

### Step 4: Verify

```
npm test
npm run behaviors
```

Expected: 940 + 11 = ~951 tests passing. Behaviors 100%.

### Step 5: Commit

```
git add tests/bdd/timeline/fixtures.ts tests/bdd/timeline/viewport.test.ts spec/features/timeline/viewport.feature spec/generated/behavior-registry.json
git commit -m "test(timeline/viewport): BDD coverage for wheel/pan/zoom/minimap scenarios"
```

---

## Task 2: drag.feature scenarios

`spec/features/timeline/drag.feature` has ~25 scenarios. Implement them in `tests/bdd/timeline/drag.test.ts` using the fixture from Task 1.

This is the bulk of PR4. The scenarios cover:
- Lasso lifecycle (arm, activate, release before threshold, additive)
- Anchor drag (input/output snapping, hints, follow-drag)
- Region drag (edge clamp, move, snap)
- Cancellation (pointercancel/blur/Escape — note: the controller has `cancel()` which is what these tests drive; the wrapper's window listeners are tested via CanvasTimeline integration but those aren't in this file)
- Cursor changes (Scenario Outline)
- Right-click dispatch (Scenario Outline — INCLUDING beat-anchor fix)
- Double-click dispatch (Scenario Outline)
- Empty-track double-click adds (Scenario Outline)
- Keyboard (Delete, Cmd+D)
- Hover scene → thumbnail popup

### Approach

Loop through each scenario. For each:
1. Read the Gherkin to understand the assertion.
2. Set up the snapshot with relevant hit entries.
3. Drive the controller method that fits the When clause.
4. Assert on intents that match the Then clause.

Some scenarios test things the controller emits via intents (e.g., `pubSnapHints`, `regionMove`); the assertion is straightforward.

Some scenarios test scenarios already implicit in the controller's design (e.g., "Region edge clamp — min 0.1s span") — these tests pin the invariant via a sequence: pointerDown → pointerMove (trying to shrink past 0.1s) → assert resulting `pubDragRegion` has span >= 0.1s.

### Scenario Outlines

vitest-cucumber supports `ScenarioOutline` — use it for the cursor/right-click/double-click/double-click-empty Outlines. Each row in the Examples table becomes a test case.

### Step 1: Implement all drag.feature scenarios

Same pattern as Task 1. ~25 scenarios.

### Step 2: Un-tag

Drop Feature-level `@todo @ignore` from `spec/features/timeline/drag.feature` once all scenarios are implemented and passing.

### Step 3: Verify

```
npm test
npm run behaviors
```

Expected: ~951 + 25 = ~976 tests passing. Behaviors 100%.

### Step 4: Commit

```
git add tests/bdd/timeline/drag.test.ts spec/features/timeline/drag.feature spec/generated/behavior-registry.json
git commit -m "test(timeline/drag): BDD coverage for lasso/snap/cancellation/dispatch scenarios"
```

---

## Task 3: Verify PR4

```
npm test
npm run behaviors
npx tsc --noEmit
git log --oneline <PR3-end-sha>..HEAD
git diff --stat <PR3-end-sha>..HEAD
```

Expected:
- ~976 tests passing
- behaviors 100%, 0 todos remaining (all 36 viewport+drag scenarios are now real tests, not @todo)
- tsc: only pre-existing menubar.tsx error
- 2-3 commits since PR3 end
- 2 new test files + 2 modified feature files

If any scenarios were deferred / left with `@todo`, they need to be explicitly listed in the verification report.

No commit; verification only.

---

## Self-review notes

- The controller's unit tests (65 tests in `controller.test.ts`) already cover much of this logic — the BDD scenarios are higher-level demonstrations bound to user-observable feature descriptions.
- Test isolation: each scenario creates its own controller + snapshot. No shared state.
- Hit entries are explicitly constructed in the fixture helpers. This makes the scenarios precise about WHAT they're clicking on.
- For the lasso threshold scenario, the fixture's `makePointer` defaults position events relative to the canvas — drive `pointerDown(x=100, y=400)` then `pointerMove(x=101, y=401)` (below threshold) then `pointerMove(x=110, y=410)` (above threshold) and assert the lasso activates.

## Out of scope

- Visual / rendering tests
- Controller features beyond what's already implemented in `src/timeline/controller.ts`
- ThinTimeline scenarios (those live in `tests/bdd/timeline/tracks.test.ts` and are unaffected)
