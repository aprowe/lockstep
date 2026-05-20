import { createSlice, original, type PayloadAction } from '@reduxjs/toolkit'
import type { Anchor, Region } from '../../types'

/**
 * One undo/redo snapshot — the full set of state fields that participate in
 * undo. Any user-visible mutation worth reversing must be captured here.
 * Excluded on purpose: selection, playhead, active-region-id, view, UI layout,
 * and the internal globalMarkers cache.
 *
 * The constraint graph is no longer snapshotted — it is derived on demand from
 * the slice via selectConstraintGraph. The slice IS the source of truth for
 * positions.
 */
export interface HistoryEntry {
  // Warp anchors
  origAnchors: Anchor[]
  beatAnchors: Anchor[]
  beatZeroId: number | null
  // Warp settings
  bpm: number
  minStretch: number
  maxStretch: number
  // Regions
  regions: Region[]
}

interface HistoryState {
  stack: HistoryEntry[]
  index: number
}

const emptyEntry: HistoryEntry = {
  origAnchors: [],
  beatAnchors: [],
  beatZeroId: null,
  bpm: 120,
  minStretch: 0.5,
  maxStretch: 2.0,
  regions: [],
}

const initialState: HistoryState = {
  stack: [emptyEntry],
  index: 0,
}

function anchorsEqual(a: Anchor[], b: Anchor[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false
    if (Math.abs(a[i].time - b[i].time) > 0.0001) return false
  }
  return true
}

function regionsEqual(a: Region[], b: Region[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const ra = a[i], rb = b[i]
    if (ra.id !== rb.id) return false
    if (ra.name !== rb.name) return false
    if (ra.inPoint !== rb.inPoint || ra.outPoint !== rb.outPoint) return false
    if (ra.inBeatTime !== rb.inBeatTime || ra.outBeatTime !== rb.outBeatTime) return false
    if (ra.bpm !== rb.bpm) return false
    if (ra.minStretch !== rb.minStretch || ra.maxStretch !== rb.maxStretch) return false
    if (ra.lockedBeats !== rb.lockedBeats) return false
  }
  return true
}

function entriesEqual(a: HistoryEntry, b: HistoryEntry): boolean {
  return a.bpm === b.bpm
    && a.minStretch === b.minStretch
    && a.maxStretch === b.maxStretch
    && a.beatZeroId === b.beatZeroId
    && anchorsEqual(a.origAnchors, b.origAnchors)
    && anchorsEqual(a.beatAnchors, b.beatAnchors)
    && regionsEqual(a.regions, b.regions)
}

const historySlice = createSlice({
  name: 'history',
  initialState,
  reducers: {
    pushSnapshot(state, action: PayloadAction<HistoryEntry>) {
      const entry = action.payload
      const cur = state.stack[state.index]
      // Use original() so reference comparisons on nested objects (e.g. graph)
      // see the underlying value rather than the Immer draft proxy.
      const curOriginal = (cur && original(cur)) || cur
      if (curOriginal && entriesEqual(curOriginal as HistoryEntry, entry)) return
      // Truncate future entries
      state.stack = state.stack.slice(0, state.index + 1)
      state.stack.push(entry)
      // Cap at 100 entries
      if (state.stack.length > 100) state.stack.shift()
      state.index = state.stack.length - 1
    },
    undo(state) {
      if (state.index > 0) state.index--
    },
    redo(state) {
      if (state.index < state.stack.length - 1) state.index++
    },
    resetHistory(state, action: PayloadAction<HistoryEntry>) {
      state.stack = [action.payload]
      state.index = 0
    },
  },
})

export const { pushSnapshot, undo, redo, resetHistory } = historySlice.actions
export default historySlice.reducer
