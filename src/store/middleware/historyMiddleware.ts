import { createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit'
import type { RootState } from '../store'
import { pushSnapshot, undo, redo, type HistoryEntry } from '../slices/historySlice'
import {
  loadAnchors,
  loadWarpSettings,
  setOrigAnchors,
  setBeatAnchors,
  addAnchor,
  removeAnchors,
  moveOrigAnchor,
  setOrigAnchorsFromTimeline,
  moveBeatAnchor,
  setBeatAnchorsFromTimeline,
  resetBeatLinks,
  clearAnchors,
  setBeatZeroId,
  setBpm,
  setMinStretch,
  setMaxStretch,
  setLoopBeats,
  setTrimToLoop,
  setAddToEnd,
} from '../slices/warpSlice'
import {
  setRegions,
  addRegion,
  deleteRegion,
  updateRegionInOut,
  updateRegionBeatTimes,
  updateRegionLock,
  renameRegion,
  updateRegionBpm,
  updateRegionStretch,
  updateRegionTriggerMode,
} from '../slices/regionSlice'

export const historyMiddleware = createListenerMiddleware()

/**
 * Every action that mutates undo-worthy state. `loadAnchors`,
 * `loadWarpSettings` and `setRegions` are intentionally excluded — they're the
 * bulk-restore actions used BY undo/redo and must not trigger a fresh snapshot.
 * Selection, playhead, active-region-id, view and UI layout are excluded
 * because they don't belong in undo history.
 */
const snapshotTriggers = isAnyOf(
  // Warp anchors
  setOrigAnchors, setBeatAnchors, addAnchor, removeAnchors,
  moveOrigAnchor, setOrigAnchorsFromTimeline,
  moveBeatAnchor, setBeatAnchorsFromTimeline,
  resetBeatLinks, clearAnchors,
  setBeatZeroId,
  // Warp settings
  setBpm, setMinStretch, setMaxStretch,
  setLoopBeats, setTrimToLoop, setAddToEnd,
  // Regions
  addRegion, deleteRegion,
  updateRegionInOut, updateRegionBeatTimes, updateRegionLock,
  renameRegion, updateRegionBpm, updateRegionStretch, updateRegionTriggerMode,
)

export function snapshotFromState(state: RootState): HistoryEntry {
  return {
    origAnchors: state.warp.origAnchors,
    beatAnchors: state.warp.beatAnchors,
    linkedBeatIds: state.warp.linkedBeatIds,
    beatZeroId: state.warp.beatZeroId,
    bpm: state.warp.bpm,
    minStretch: state.warp.minStretch,
    maxStretch: state.warp.maxStretch,
    loopBeats: state.warp.loopBeats,
    trimToLoop: state.warp.trimToLoop,
    addToEnd: state.warp.addToEnd,
    regions: state.region.regions,
  }
}

// ── Snapshot recording: debounced 400ms after any undo-worthy mutation ─────

historyMiddleware.startListening({
  matcher: snapshotTriggers,
  effect: async (_action, listenerApi) => {
    listenerApi.cancelActiveListeners()
    await listenerApi.delay(400)
    const state = listenerApi.getState() as RootState
    listenerApi.dispatch(pushSnapshot(snapshotFromState(state)))
  },
})

// ── Undo / Redo: restore the snapshot at the current history index ────────

function restoreEntry(entry: HistoryEntry, dispatch: (a: unknown) => void) {
  dispatch(loadAnchors({
    origAnchors: entry.origAnchors,
    beatAnchors: entry.beatAnchors,
    linkedBeatIds: entry.linkedBeatIds,
    beatZeroId: entry.beatZeroId,
  }))
  dispatch(loadWarpSettings({
    bpm: entry.bpm,
    minStretch: entry.minStretch,
    maxStretch: entry.maxStretch,
    loopBeats: entry.loopBeats,
    trimToLoop: entry.trimToLoop,
    addToEnd: entry.addToEnd,
  }))
  dispatch(setRegions(entry.regions))
}

historyMiddleware.startListening({
  actionCreator: undo,
  effect: (_action, listenerApi) => {
    const state = listenerApi.getState() as RootState
    const entry = state.history.stack[state.history.index]
    if (!entry) return
    restoreEntry(entry, listenerApi.dispatch)
  },
})

historyMiddleware.startListening({
  actionCreator: redo,
  effect: (_action, listenerApi) => {
    const state = listenerApi.getState() as RootState
    const entry = state.history.stack[state.history.index]
    if (!entry) return
    restoreEntry(entry, listenerApi.dispatch)
  },
})
