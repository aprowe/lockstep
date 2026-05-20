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
  resetBeatLinks,
  clearAnchors,
  setBeatZeroId,
  setBpm,
  setMinStretch,
  setMaxStretch,
} from '../slices/warpSlice'
import {
  setRegions,
  addRegion,
  deleteRegion,
  renameRegion,
  updateRegionBpm,
  updateRegionLockedBeats,
  updateRegionStretch,
} from '../slices/regionSlice'
import { setLockMode } from '../slices/uiSlice'
import { _syncAnchorPositions } from '../slices/warpSlice'
import { _syncRegionPositions, _syncRegionMeta } from '../slices/regionSlice'

export const historyMiddleware = createListenerMiddleware()

/**
 * Every action that mutates undo-worthy state via the debounced path.
 * `loadAnchors`, `loadWarpSettings` and `setRegions` are intentionally
 * excluded — they're the bulk-restore actions used BY undo/redo and must not
 * trigger a fresh snapshot. `dragEnd` is excluded here because it has its own
 * immediate (non-debounced) listener below. Selection, playhead,
 * active-region-id, view and UI layout are excluded because they don't belong
 * in undo history.
 *
 * applyOp is removed — the pipeline now writes slice diffs directly via
 * _syncAnchorPositions / _syncRegionPositions / _syncRegionMeta. We capture
 * snapshots on those slice-write actions instead.
 */
const snapshotTriggers = isAnyOf(
  // Warp anchors (slice ID-list / metadata mutations)
  setOrigAnchors, setBeatAnchors, addAnchor, removeAnchors,
  resetBeatLinks, clearAnchors,
  setBeatZeroId,
  // Warp settings
  setBpm, setMinStretch, setMaxStretch,
  // Regions (slice metadata mutations)
  addRegion, deleteRegion,
  updateRegionLockedBeats,
  renameRegion, updateRegionBpm,
  updateRegionStretch,
  // Global lock mode
  setLockMode,
  // Pipeline slice writes — position mutations.
  _syncAnchorPositions,
  _syncRegionPositions,
  _syncRegionMeta,
)

export function snapshotFromState(state: RootState): HistoryEntry {
  // Slice is now the source of truth for positions (the pipeline keeps it in sync).
  return {
    origAnchors: state.warp.origAnchors,
    beatAnchors: state.warp.beatAnchors,
    beatZeroId: state.warp.beatZeroId,
    bpm: state.warp.bpm,
    minStretch: state.warp.minStretch,
    maxStretch: state.warp.maxStretch,
    regions: state.region.regions,
  }
}

// ── Snapshot on drag end: fires immediately, no debounce ────────────────────

historyMiddleware.startListening({
  actionCreator: dragEnd,
  effect: (_action, listenerApi) => {
    const state = listenerApi.getState() as RootState
    listenerApi.dispatch(pushSnapshot(snapshotFromState(state)))
  },
})

// ── Snapshot recording: debounced 400ms after any undo-worthy mutation ─────

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
    beatZeroId: entry.beatZeroId,
  }))
  dispatch(loadWarpSettings({
    bpm: entry.bpm,
    minStretch: entry.minStretch,
    maxStretch: entry.maxStretch,
  }))
  dispatch(setRegions(entry.regions))
  // No setGraph needed — the graph is derived from the slice by the pipeline.
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
