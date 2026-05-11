# Gesture Store Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the gesture store with three new fields (`dragRegion`, `scrubTime`, `lassoSelection`) and wire five consuming components to subscribe, so clip drag, timeline scrub, and lasso selection update only the relevant UI without Redux-driven full-tree re-renders.

**Architecture:** The gesture store (`src/store/gesture.ts`) is a module-level singleton that uses `useSyncExternalStore` with per-field selectors; components only re-render when their specific selector's return value changes by reference. CanvasTimeline (modified separately by the user) writes the new fields during gestures; this plan adds the fields/setters, unit tests, and updates the five consuming components. `RegionBand.tsx` (thin timeline) also gets the `setDragRegion` write since it owns region drag there.

**Tech Stack:** TypeScript, React `useSyncExternalStore`, Redux Toolkit, Vitest

---

## Files

| Action | File |
|---|---|
| Modify | `src/store/gesture.ts` — add 3 fields, 3 setters, export `getSnapshot` |
| Create | `tests/unit/gesture.test.ts` — unit tests for new fields |
| Modify | `src/components/RegionInfoPanel.tsx` — subscribe to `dragRegion` |
| Modify | `src/components/Toolbar.tsx` — subscribe to `scrubTime` |
| Modify | `src/layout/panels/ClipsPanel.tsx` — subscribe to `lassoSelection` |
| Modify | `src/layout/panels/MarkersPanel.tsx` — subscribe to `lassoSelection` |
| Modify | `src/layout/panels/ScenesPanel.tsx` — subscribe to `lassoSelection` |
| Modify | `src/components/thin/RegionBand.tsx` — write `setDragRegion` during drag |

---

## Task 1: Extend gesture store + unit tests

**Files:**
- Modify: `src/store/gesture.ts`
- Create: `tests/unit/gesture.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/gesture.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { gesture, getSnapshot } from '../../src/store/gesture'

describe('gesture store', () => {
  beforeEach(() => { gesture.clearAll() })

  describe('setDragRegion', () => {
    it('stores the drag region', () => {
      gesture.setDragRegion('clip-1', 1.5, 3.0)
      expect(getSnapshot().dragRegion).toEqual({ id: 'clip-1', inPoint: 1.5, outPoint: 3.0 })
    })

    it('overwrites a previous value', () => {
      gesture.setDragRegion('clip-1', 1.0, 2.0)
      gesture.setDragRegion('clip-1', 1.5, 2.5)
      expect(getSnapshot().dragRegion).toEqual({ id: 'clip-1', inPoint: 1.5, outPoint: 2.5 })
    })

    it('is cleared by clearAll', () => {
      gesture.setDragRegion('clip-1', 1.5, 3.0)
      gesture.clearAll()
      expect(getSnapshot().dragRegion).toBeNull()
    })
  })

  describe('setScrubTime', () => {
    it('stores a scrub time', () => {
      gesture.setScrubTime(42.5)
      expect(getSnapshot().scrubTime).toBe(42.5)
    })

    it('can be set to null', () => {
      gesture.setScrubTime(42.5)
      gesture.setScrubTime(null)
      expect(getSnapshot().scrubTime).toBeNull()
    })

    it('is cleared by clearAll', () => {
      gesture.setScrubTime(42.5)
      gesture.clearAll()
      expect(getSnapshot().scrubTime).toBeNull()
    })
  })

  describe('setLassoSelection', () => {
    it('stores the lasso selection sets by reference', () => {
      const clipIds = new Set(['clip-1', 'clip-2'])
      const anchorIds = new Set([1, 2])
      const sceneTimes = new Set([1.0, 2.0])
      gesture.setLassoSelection(clipIds, anchorIds, sceneTimes)
      const s = getSnapshot().lassoSelection!
      expect(s.clipIds).toBe(clipIds)
      expect(s.anchorIds).toBe(anchorIds)
      expect(s.sceneTimes).toBe(sceneTimes)
    })

    it('is cleared by clearAll', () => {
      gesture.setLassoSelection(new Set(), new Set(), new Set())
      gesture.clearAll()
      expect(getSnapshot().lassoSelection).toBeNull()
    })
  })

  describe('selector isolation', () => {
    it('dragRegion reference is unchanged when scrubTime changes', () => {
      gesture.setDragRegion('clip-1', 1.0, 2.0)
      const before = getSnapshot().dragRegion
      gesture.setScrubTime(5.0)
      expect(getSnapshot().dragRegion).toBe(before)
    })

    it('lassoSelection reference is unchanged when dragRegion changes', () => {
      const clipIds = new Set<string>()
      gesture.setLassoSelection(clipIds, new Set(), new Set())
      const before = getSnapshot().lassoSelection
      gesture.setDragRegion('clip-1', 1.0, 2.0)
      expect(getSnapshot().lassoSelection).toBe(before)
    })
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```
rtk vitest run tests/unit/gesture.test.ts
```

Expected: all tests fail with errors like `gesture.setDragRegion is not a function` and `getSnapshot is not exported`.

- [ ] **Step 3: Implement the gesture store changes**

In `src/store/gesture.ts`, make these changes:

**a. Add three fields to `GestureState`:**

```ts
export interface GestureState {
  hoveredAnchorId: number | null
  hoveredRegionId: string | null
  hoveredSceneTime: number | null
  snapHintsIn: readonly number[]
  snapHintsOut: readonly number[]
  dragTime: { space: Space; time: number } | null
  dragRegion: { id: string; inPoint: number; outPoint: number } | null
  scrubTime: number | null
  lassoSelection: {
    clipIds: ReadonlySet<string>
    anchorIds: ReadonlySet<number>
    sceneTimes: ReadonlySet<number>
  } | null
}
```

**b. Add three fields to `initialState`:**

```ts
const initialState: GestureState = {
  hoveredAnchorId: null,
  hoveredRegionId: null,
  hoveredSceneTime: null,
  snapHintsIn: EMPTY_HINTS,
  snapHintsOut: EMPTY_HINTS,
  dragTime: null,
  dragRegion: null,
  scrubTime: null,
  lassoSelection: null,
}
```

**c. Add three setters to the `gesture` object (after `setDragTime`):**

```ts
  setDragRegion(id: string, inPoint: number, outPoint: number) {
    setState({ ...state, dragRegion: { id, inPoint, outPoint } })
  },
  setScrubTime(t: number | null) {
    if (state.scrubTime === t) return
    setState({ ...state, scrubTime: t })
  },
  setLassoSelection(
    clipIds: ReadonlySet<string>,
    anchorIds: ReadonlySet<number>,
    sceneTimes: ReadonlySet<number>,
  ) {
    setState({ ...state, lassoSelection: { clipIds, anchorIds, sceneTimes } })
  },
```

**d. Export `getSnapshot` (change `function getSnapshot` to `export function getSnapshot`):**

```ts
export function getSnapshot(): GestureState {
  return state
}
```

- [ ] **Step 4: Run tests — verify they pass**

```
rtk vitest run tests/unit/gesture.test.ts
```

Expected: all 10 tests pass.

- [ ] **Step 5: Run full behavior suite**

```
npm run behaviors
```

Expected: no regressions.

- [ ] **Step 6: Commit**

```
rtk git add src/store/gesture.ts tests/unit/gesture.test.ts
rtk git commit -m "feat(gesture): add dragRegion, scrubTime, lassoSelection fields"
```

---

## Task 2: RegionInfoPanel subscribes to dragRegion

**Files:**
- Modify: `src/components/RegionInfoPanel.tsx`

- [ ] **Step 1: Add import and live-value computation**

Add `useGesture` to the existing import from `'../store/gesture'`. In `RegionInfoPanel.tsx`, the import is currently:

```ts
import { useEffect, useRef, useState } from 'react'
```

Change to:

```ts
import { useEffect, useRef, useState } from 'react'
import { useGesture } from '../store/gesture'
```

Then, inside the `RegionInfoPanel` function body, after the existing state declarations (after the `useState` calls around line 67-76), add:

```ts
const dragRegion = useGesture(s => s.dragRegion)
const isLiveDrag = dragRegion?.id === activeRegion?.id
const liveIn  = isLiveDrag ? dragRegion!.inPoint  : (activeRegion?.inPoint  ?? 0)
const liveOut = isLiveDrag ? dragRegion!.outPoint : (activeRegion?.outPoint ?? 0)
const liveBeatSpan = isLiveDrag
  ? (activeRegion?.outBeatTime ?? liveOut) - (activeRegion?.inBeatTime ?? liveIn)
  : beatSpan
const liveTotalBeats = beat > 0 ? liveBeatSpan / beat : 0
```

- [ ] **Step 2: Update the In display span**

Find the line that renders `activeRegion.inPoint` in the read-only In span (inside the `!editingIn` branch):

```tsx
{formatTimecode(activeRegion.inPoint)}
```

Change it to:

```tsx
{formatTimecode(liveIn)}
```

Also update the `onClick` handler on that same span to use `liveIn` as the initial edit value:

```tsx
onClick={() => { setInInput(formatTimecode(liveIn)); setEditingIn(true) }}
```

- [ ] **Step 3: Update the Out display span**

Find the line that renders `activeRegion.outPoint` in the read-only Out span:

```tsx
{formatTimecode(activeRegion.outPoint)}
```

Change it to:

```tsx
{formatTimecode(liveOut)}
```

Also update the `onClick` handler:

```tsx
onClick={() => { setOutInput(formatTimecode(liveOut)); setEditingOut(true) }}
```

- [ ] **Step 4: Update the Dur display span and Beats input**

Find the Dur display span and its `onClick`. Change both occurrences of `activeRegion.outPoint - activeRegion.inPoint` to `liveOut - liveIn`:

```tsx
onClick={() => { setDurInput(formatTimecode(liveOut - liveIn)); setEditingDur(true) }}
// ...
{formatTimecode(liveOut - liveIn)}
```

For the beats input, the `value` prop is currently `beatsInput`. Override it during live drag so the field shows the live beat count without triggering `useEffect`:

```tsx
value={isLiveDrag && liveTotalBeats > 0 ? liveTotalBeats.toFixed(1) : beatsInput}
```

- [ ] **Step 5: Run behaviors**

```
npm run behaviors
```

Expected: no regressions. The In/Out/Dur/Beats fields now update at gesture-store rate (no Redux) when a clip is being dragged.

- [ ] **Step 6: Commit**

```
rtk git add src/components/RegionInfoPanel.tsx
rtk git commit -m "feat(RegionInfoPanel): live In/Out/Dur from gesture store during clip drag"
```

---

## Task 3: Toolbar subscribes to scrubTime

**Files:**
- Modify: `src/components/Toolbar.tsx`

- [ ] **Step 1: Add import**

`Toolbar.tsx` currently imports from React only. Add `useGesture`:

```ts
import { useEffect, useRef, useState } from 'react'
import { useGesture } from '../store/gesture'
```

- [ ] **Step 2: Compute displayTime**

Inside the `Toolbar` function body, after the existing `useState` and `useRef` declarations, add:

```ts
const scrubTime = useGesture(s => s.scrubTime)
const displayTime = scrubTime ?? currentTime
```

- [ ] **Step 3: Update the timecode display span**

Find the span with `data-layout-id="play-time"`:

```tsx
<span data-layout-id="play-time" className="tb-time__current">{fmt(currentTime)}</span>
```

Change to:

```tsx
<span data-layout-id="play-time" className="tb-time__current">{fmt(displayTime)}</span>
```

- [ ] **Step 4: Update the frame count display**

Find the span that renders `secondsToFrames(currentTime, fps)` (inside the non-editing branch of the frame counter):

```tsx
<span className="tb-time__count-value">{secondsToFrames(currentTime, fps)}</span>
```

Change to:

```tsx
<span className="tb-time__count-value">{secondsToFrames(displayTime, fps)}</span>
```

The `editingFrame` input and its `onBlur` seek logic continue to use the committed `currentTime` prop — do not change those.

- [ ] **Step 5: Run behaviors**

```
npm run behaviors
```

Expected: no regressions. The Toolbar timecode and frame count will update from the gesture store during seek scrub.

- [ ] **Step 6: Commit**

```
rtk git add src/components/Toolbar.tsx
rtk git commit -m "feat(Toolbar): live timecode from gesture store during scrub"
```

---

## Task 4: ClipsPanel subscribes to lassoSelection

**Files:**
- Modify: `src/layout/panels/ClipsPanel.tsx`

- [ ] **Step 1: Add import**

```ts
import { useGesture } from '../../store/gesture'
```

- [ ] **Step 2: Subscribe and compute override**

Inside `ClipsPanel`, after the existing `const selectedClipIds = useAppSelector(...)` line, add:

```ts
const lassoSelection = useGesture(s => s.lassoSelection)
```

- [ ] **Step 3: Pass selectedIdsOverride to ListPanel**

`ListPanel` already supports `selectedIdsOverride?: ReadonlySet<string>`. `lassoSelection.clipIds` is already a `ReadonlySet<string>`, so it can be passed directly.

Find the `<ListPanel` opening tag and add the prop:

```tsx
<ListPanel
  listId="clips"
  items={items}
  activeId={activeRegionId}
  onActivate={onActivate}
  onDelete={onDelete}
  selectedIdsOverride={lassoSelection?.clipIds}
  hideClipFilter
  ...
/>
```

When `lassoSelection` is null, `lassoSelection?.clipIds` is `undefined`, and `ListPanel` falls back to its own Redux selection from `s.lists.selection.clips`.

- [ ] **Step 4: Run behaviors**

```
npm run behaviors
```

Expected: no regressions. Clip rows in the panel now highlight live during lasso without Redux dispatch.

- [ ] **Step 5: Commit**

```
rtk git add src/layout/panels/ClipsPanel.tsx
rtk git commit -m "feat(ClipsPanel): live lasso selection from gesture store"
```

---

## Task 5: MarkersPanel subscribes to lassoSelection

**Files:**
- Modify: `src/layout/panels/MarkersPanel.tsx`

- [ ] **Step 1: Add import**

```ts
import { useGesture } from '../../store/gesture'
```

- [ ] **Step 2: Subscribe and derive override**

`MarkersPanel` uses numeric anchor IDs internally and already stringifies them via `selectedIdsAsStrings`. The gesture store stores `anchorIds: ReadonlySet<number>`, so we apply the same conversion.

After the existing `const selectedIdsAsStrings = useMemo(...)` block (around line 26), add:

```ts
const lassoSelection = useGesture(s => s.lassoSelection)
const selectedIdsOverride = useMemo(() => {
  if (lassoSelection) return new Set(Array.from(lassoSelection.anchorIds, n => String(n)))
  return selectedIdsAsStrings
}, [lassoSelection, selectedIdsAsStrings])
```

- [ ] **Step 3: Pass the override to ListPanel**

`MarkersPanel` already passes `selectedIdsOverride={selectedIdsAsStrings}` to `ListPanel`. Replace `selectedIdsAsStrings` with `selectedIdsOverride`:

```tsx
<ListPanel
  ...
  selectedIdsOverride={selectedIdsOverride}
  onSelectionChangeOverride={onSelectionChangeOverride}
  ...
/>
```

- [ ] **Step 4: Run behaviors**

```
npm run behaviors
```

Expected: no regressions. Anchor rows now highlight live during lasso.

- [ ] **Step 5: Commit**

```
rtk git add src/layout/panels/MarkersPanel.tsx
rtk git commit -m "feat(MarkersPanel): live lasso selection from gesture store"
```

---

## Task 6: ScenesPanel subscribes to lassoSelection

**Files:**
- Modify: `src/layout/panels/ScenesPanel.tsx`

- [ ] **Step 1: Add import**

```ts
import { useGesture } from '../../store/gesture'
```

- [ ] **Step 2: Subscribe and build override**

`SceneRowData.id` is the ordinal index as a string (`String(i)`), set in `ScenesPanel`'s `allItems` memo. `lassoSelection.sceneTimes` contains the raw time values. Match via `item.start`.

After the `const allItems = useMemo<SceneRowData[]>(...)` block, add:

```ts
const lassoSelection = useGesture(s => s.lassoSelection)
const lassoSceneIdSet = useMemo(() => {
  if (!lassoSelection) return undefined
  const result = new Set<string>()
  for (const item of allItems) {
    if (lassoSelection.sceneTimes.has(item.start)) result.add(item.id)
  }
  return result
}, [lassoSelection, allItems])
```

- [ ] **Step 3: Pass selectedIdsOverride to ListPanel**

Find the `<ListPanel` in `ScenesPanel` and add:

```tsx
<ListPanel
  listId="scenes"
  selectedIdsOverride={lassoSceneIdSet}
  ...
/>
```

When `lassoSceneIdSet` is `undefined` (no active lasso), `ListPanel` uses its own Redux selection.

- [ ] **Step 4: Run behaviors**

```
npm run behaviors
```

Expected: no regressions.

- [ ] **Step 5: Commit**

```
rtk git add src/layout/panels/ScenesPanel.tsx
rtk git commit -m "feat(ScenesPanel): live lasso selection from gesture store"
```

---

## Task 7: RegionBand writes setDragRegion

**Files:**
- Modify: `src/components/thin/RegionBand.tsx`

`gesture` is already imported in `RegionBand.tsx` (line 5: `import { gesture } from '../../store/gesture'`). No import change needed.

- [ ] **Step 1: Add setDragRegion call in flushPending**

In `flushPending` (around line 83), after the existing `gesture.setDragTime(space, dt)` line, add:

```ts
if (p) gesture.setDragRegion(p.id, p.inPoint, p.outPoint)
```

The full updated `flushPending` callback becomes:

```ts
const flushPending = useCallback(() => {
  const p = pendingRef.current
  const h = pendingHintsRef.current
  const dt = pendingDragTimeRef.current
  pendingRef.current = null
  pendingHintsRef.current = null
  pendingDragTimeRef.current = null
  if (p && p.kind === 'resize' && onResize) onResize(p.id, p.inPoint, p.outPoint)
  else if (p && p.kind === 'move' && onMove) onMove(p.id, p.inPoint, p.outPoint)
  if (h !== null) gesture.setSnapHints(space, h)
  gesture.setDragTime(space, dt)
  if (p) gesture.setDragRegion(p.id, p.inPoint, p.outPoint)
}, [onResize, onMove, space])
```

`gesture.clearAll()` is called globally on `pointerup` (module-level listener in `gesture.ts`), which resets `dragRegion` to null after the gesture ends. No local cleanup needed.

- [ ] **Step 2: Run behaviors**

```
npm run behaviors
```

Expected: no regressions. `RegionInfoPanel` now receives live position updates from the thin timeline's region drags via the gesture store.

- [ ] **Step 3: Commit**

```
rtk git add src/components/thin/RegionBand.tsx
rtk git commit -m "feat(RegionBand): publish dragRegion to gesture store during drag"
```
