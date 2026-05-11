# Gesture Store Extension — Design Spec

**Date:** 2026-05-10  
**Status:** Approved

## Problem

During timeline gestures (clip drag/resize, seek scrub, lasso selection), CanvasTimeline currently drives UI updates through Redux dispatches on every `mousemove`. This causes the entire React tree to re-render at ~60fps. Trace analysis showed 27 long tasks (200–280ms each), 22.8% of CPU in React commit, 18.8% in React render, and 16.3% in GC — all from creating and discarding React elements on every frame.

The gesture store (`src/store/gesture.ts`) already exists for exactly this purpose: transient pointer state that updates at high frequency and has no reason to participate in undo/history. It uses `useSyncExternalStore` with per-field selectors so each subscriber re-renders only when its specific field changes.

## Scope

- **In scope:** Extending the gesture store with three new fields; updating five consuming components to subscribe; adding `gesture.setDragRegion()` to `RegionBand.tsx` (thin timeline).
- **Out of scope:** Modifying `CanvasTimeline.tsx` (user is making changes there and will add the `gesture.set*()` calls themselves). Lasso selection commit logic (stays in CanvasTimeline). Anchor drag display — `dragTime` already exists and consumers can be added later.

## Gesture Store Changes (`src/store/gesture.ts`)

### New fields on `GestureState`

```ts
/** Live position of the clip being moved or edge-resized.
 *  Written by CanvasTimeline during region-move and region-edge drags.
 *  null when no clip is being dragged. */
dragRegion: { id: string; inPoint: number; outPoint: number } | null

/** Live playhead position during a seek-scrub drag on the timeline.
 *  Replaces the Redux-sourced currentTime in Toolbar while non-null.
 *  null when not scrubbing. */
scrubTime: number | null

/** Transient selection state during an active lasso drag.
 *  Consuming list panels use this as a display override so they can
 *  highlight live without a Redux dispatch per mousemove.
 *  null when no lasso is active. */
lassoSelection: {
  clipIds: ReadonlySet<string>
  anchorIds: ReadonlySet<number>
  sceneTimes: ReadonlySet<number>
} | null
```

### New setters on `gesture`

```ts
gesture.setDragRegion(id: string, inPoint: number, outPoint: number)
gesture.setScrubTime(t: number | null)
gesture.setLassoSelection(
  clipIds: ReadonlySet<string>,
  anchorIds: ReadonlySet<number>,
  sceneTimes: ReadonlySet<number>,
)
```

All three fields are cleared by the existing `gesture.clearAll()` (called on `pointerup`/`pointercancel`/`blur` at module scope). No additional cleanup is needed.

### Re-render isolation

`useSyncExternalStore` compares selector return values by reference (`Object.is`). Because each setter spreads the state (`{ ...state, dragRegion: next }`), only the changed field gets a new reference. A component subscribed to `s => s.lassoSelection` will not re-render when `dragRegion` changes. Each subscriber wakes only for its own field.

## Consuming Component Changes

### `RegionInfoPanel` (`src/components/RegionInfoPanel.tsx`)

Add `useGesture(s => s.dragRegion)`. In the In, Out, Dur, and Beats display spans, substitute the live values when `dragRegion?.id === activeRegion?.id`:

```ts
const dragRegion = useGesture(s => s.dragRegion)
const liveIn  = (dragRegion?.id === activeRegion?.id) ? dragRegion!.inPoint  : activeRegion?.inPoint  ?? 0
const liveOut = (dragRegion?.id === activeRegion?.id) ? dragRegion!.outPoint : activeRegion?.outPoint ?? 0
```

Use `liveIn`/`liveOut` in the read-only display spans only — not in the committed editing inputs. Beat count is recalculated inline from the live values. The `useEffect` hooks that sync `inInput`/`outInput`/`durInput` state remain keyed to the Redux-sourced `activeRegion` values and only fire on commit.

### `Toolbar` (`src/components/Toolbar.tsx`)

Add `useGesture(s => s.scrubTime)`. Replace `currentTime` with `scrubTime ?? currentTime` in:
- The `fmt()` timecode span (`tb-time__current`)
- The frame count span (`secondsToFrames(...)`)

The editing-frame input and seek-on-blur logic continue to use the committed `currentTime` prop.

### `ClipsPanel` (`src/layout/panels/ClipsPanel.tsx`)

Add `useGesture(s => s.lassoSelection)`. When `lassoSelection !== null`, derive a `Set<string>` from `lassoSelection.clipIds` and pass it as `selectedIdsOverride` to `ListPanel`. When null, fall back to existing Redux selection from `s.lists.selection.clips`.

`ListPanel` already supports `selectedIdsOverride` — no changes needed there.

### `MarkersPanel` (`src/layout/panels/MarkersPanel.tsx`)

Add `useGesture(s => s.lassoSelection)`. When `lassoSelection !== null`, convert `lassoSelection.anchorIds` to `Set<string>` (same string-coercion as the existing `selectedIdsAsStrings` memo) and pass as `selectedIdsOverride`. When null, use existing `selectedAnchorIdSet` from Redux.

`MarkersPanel` already passes `selectedIdsOverride` to `ListPanel` — just replace the source.

### `ScenesPanel` (`src/layout/panels/ScenesPanel.tsx`)

Add `useGesture(s => s.lassoSelection)`. When `lassoSelection !== null`, build the `selectedIdsOverride` set by matching `lassoSelection.sceneTimes` against `allItems` (each item has `start: number` and `id: string` which is the ordinal index). Derive via a memo:

```ts
const lassoSceneIdSet = useMemo(() => {
  if (!lassoSelection) return null
  const result = new Set<string>()
  for (const item of allItems)
    if (lassoSelection.sceneTimes.has(item.start)) result.add(item.id)
  return result
}, [lassoSelection, allItems])
```

Pass `lassoSceneIdSet ?? undefined` as `selectedIdsOverride`. When null, `ListPanel` falls back to its own Redux selection.

### `RegionBand` (`src/components/thin/RegionBand.tsx`)

Add `gesture.setDragRegion(id, inPoint, outPoint)` during region move/resize drags in the thin timeline (the same call CanvasTimeline will make). The existing `gesture.clearAll()` on `pointerup` handles cleanup.

## Commit Strategy

Single commit on the feature branch:
1. `gesture.ts` — new fields + setters
2. All consuming components in one sweep
3. `RegionBand.tsx` — setDragRegion call

## What the user adds (CanvasTimeline, not part of this spec)

- `gesture.setDragRegion(id, newIn, newOut)` during `region-move` and `region-edge` mouse moves instead of calling `onRegionMove`/`onRegionResize`
- `gesture.setScrubTime(t)` during `seek` drag
- `gesture.setLassoSelection(clipIds, anchorIds, sceneTimes)` during `lasso` drag instead of calling `onConnectorSelectionChange`/`onClipsSelectionChange`/`onScenesSelectionChange`
- On `mouseup`: commit final values to Redux once, then `gesture.clearAll()`
