import { createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit'
import type { RootState } from '../store'
import { pushSnapshot, undo, redo, type HistoryEntry } from '../slices/historySlice'
import { dragEnd } from '../slices/dragSlice'
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
  applyLinkingEvent,
  resetRegionBoundary,
  applyConformedClipout,
  applyBpmEdit,
  applyBeatsEdit,
} from '../slices/regionSlice'

export const historyMiddleware = createListenerMiddleware()

/**
 * Every action that mutates undo-worthy state via the debounced path.
 * `loadAnchors`, `loadWarpSettings` and `setRegions` are intentionally
 * excluded — they're the bulk-restore actions used BY undo/redo and must not
 * trigger a fresh snapshot. `dragEnd` is excluded here because it has its own
 * immediate (non-debounced) listener below. Selection, playhead,
 * active-region-id, view and UI layout are excluded because they don't belong
 * in undo history.
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
  applyLinkingEvent, resetRegionBoundary, applyConformedClipout,
  applyBpmEdit, applyBeatsEdit,
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

// ── Snapshot on drag end: fires immediately, no debounce ────────────────────
// dragEnd sets drag.active=false synchronously before this effect runs.
// A dedicated immediate listener ensures the post-drag snapshot is in the
// stack before the user can press Ctrl+Z, preventing the 400ms debounce race
// where an undo fires before the snapshot is committed.

historyMiddleware.startListening({
  actionCreator: dragEnd,
  effect: (_action, listenerApi) => {
    const state = listenerApi.getState() as RootState
    listenerApi.dispatch(pushSnapshot(snapshotFromState(state)))
  },
})

// ── Snapshot recording: debounced 400ms after any undo-worthy mutation ─────
// Skipped during drag (rapid pointer-move commits must not flood history).
// dragEnd is handled by the immediate listener above and is excluded from
// snapshotTriggers to avoid a duplicate debounced snapshot 400ms later.

historyMiddleware.startListening({
  matcher: snapshotTriggers,
  effect: async (_action, listenerApi) => {
    listenerApi.cancelActiveListeners()
    await listenerApi.delay(400)
    const state = listenerApi.getState() as RootState
    // Gate: skip if still dragging (rapid pointer-move commits should not flood history).
    if (state.drag.active) return
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
