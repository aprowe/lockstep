import { useSyncExternalStore } from 'react'

/**
 * Single source of truth for transient pointer state shared across the
 * timeline: hover targets, live snap hints while dragging, and the current
 * drag time. Lives outside Redux because (a) it updates at ~60Hz during
 * gestures and has no reason to participate in undo/history, and (b) it's
 * the only piece of UI state that *must* be cleared on every pointer
 * release — easier to own that invariant in one module than to scatter
 * cleanup across every interactive row.
 *
 * Children (MarkersTrack, RegionBand, SceneRow) publish into this store
 * directly. Consumers (ThinTimeline) subscribe via `useGesture()`.
 */

export type Space = 'input' | 'output'

export interface GestureState {
  hoveredAnchorId: number | null
  hoveredRegionId: string | null
  hoveredSceneTime: number | null
  snapHintsIn: readonly number[]
  snapHintsOut: readonly number[]
  /** Time of the actively-dragged marker, tagged by which space owns it.
   *  null when no marker is being dragged. */
  dragTime: { space: Space; time: number } | null
  dragRegion: { id: string; inPoint: number; outPoint: number } | null
  scrubTime: number | null
  lassoSelection: {
    clipIds: ReadonlySet<string>
    anchorIds: ReadonlySet<number>
    sceneTimes: ReadonlySet<number>
  } | null
}

const EMPTY_HINTS: readonly number[] = Object.freeze([])

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

let state: GestureState = initialState
const listeners = new Set<() => void>()

function notify() {
  for (const fn of listeners) fn()
}

function setState(next: GestureState) {
  if (next === state) return
  state = next
  notify()
}

// ── Publish API ─────────────────────────────────────────────────────────────

export const gesture = {
  setHoveredAnchor(id: number | null) {
    if (state.hoveredAnchorId === id) return
    setState({ ...state, hoveredAnchorId: id })
  },
  setHoveredRegion(id: string | null) {
    if (state.hoveredRegionId === id) return
    setState({ ...state, hoveredRegionId: id })
  },
  setHoveredScene(time: number | null) {
    if (state.hoveredSceneTime === time) return
    setState({ ...state, hoveredSceneTime: time })
  },
  setSnapHints(space: Space, times: readonly number[] | null) {
    const next = times && times.length > 0 ? times : EMPTY_HINTS
    const key = space === 'input' ? 'snapHintsIn' : 'snapHintsOut'
    if (state[key] === next) return
    // Avoid churn when both sides are already empty.
    if (next === EMPTY_HINTS && state[key] === EMPTY_HINTS) return
    setState({ ...state, [key]: next })
  },
  setDragTime(space: Space | null, time: number | null) {
    const next: GestureState['dragTime'] =
      space === null || time === null ? null : { space, time }
    const cur = state.dragTime
    if (cur === next) return
    if (cur && next && cur.space === next.space && cur.time === next.time) return
    setState({ ...state, dragTime: next })
  },
  setDragRegion(id: string, inPoint: number, outPoint: number) {
    const cur = state.dragRegion
    if (cur && cur.id === id && cur.inPoint === inPoint && cur.outPoint === outPoint) return
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
  /** Clear every transient field at once. Called by the window pointer-up /
   *  blur listener and usable by any caller that knows a gesture is done. */
  clearAll() {
    if (state === initialState) return
    setState(initialState)
  },
}

// ── Hook ────────────────────────────────────────────────────────────────────

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function getSnapshot(): GestureState {
  return state
}

/** Subscribe to the gesture store. Selector is re-run after each publish;
 *  identity-stable returns are up to the caller. */
export function useGesture<T>(selector: (s: GestureState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(state),
  )
}

// ── Single global cleanup ───────────────────────────────────────────────────
// Lives at module scope — attached once per document, regardless of how many
// timeline subtrees mount. pointerup + pointercancel + blur all clear state;
// individual rows don't need their own safety nets anymore.

if (typeof window !== 'undefined') {
  const onPointerUp = () => gesture.clearAll()
  const onBlur = () => gesture.clearAll()
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
  window.addEventListener('blur', onBlur)
}
