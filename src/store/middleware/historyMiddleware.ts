import { createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit'
import type { RootState } from '../store'
import { pushSnapshot, undo, redo } from '../slices/historySlice'
import { loadAnchors } from '../slices/warpSlice'
import {
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
} from '../slices/warpSlice'

export const historyMiddleware = createListenerMiddleware()

// ── Snapshot recording: debounced 400ms after warp-modifying actions ────────

const modifiesWarp = isAnyOf(
  setOrigAnchors, setBeatAnchors, addAnchor, removeAnchors,
  moveOrigAnchor, setOrigAnchorsFromTimeline,
  moveBeatAnchor, setBeatAnchorsFromTimeline,
  resetBeatLinks, clearAnchors,
  setBeatZeroId,
  // loadAnchors is excluded — it's used BY undo/redo to restore state
)

historyMiddleware.startListening({
  matcher: modifiesWarp,
  effect: async (_action, listenerApi) => {
    listenerApi.cancelActiveListeners()
    await listenerApi.delay(400)

    const state = listenerApi.getState() as RootState
    listenerApi.dispatch(pushSnapshot({
      origAnchors: state.warp.origAnchors,
      beatAnchors: state.warp.beatAnchors,
      linkedBeatIds: state.warp.linkedBeatIds,
      beatZeroId: state.warp.beatZeroId,
    }))
  },
})

// ── Undo: restore warp state from history stack ────────────────────────────

historyMiddleware.startListening({
  actionCreator: undo,
  effect: (_action, listenerApi) => {
    const state = listenerApi.getState() as RootState
    const entry = state.history.stack[state.history.index]
    if (!entry) return
    listenerApi.dispatch(loadAnchors({
      origAnchors: entry.origAnchors,
      beatAnchors: entry.beatAnchors,
      linkedBeatIds: entry.linkedBeatIds,
      beatZeroId: entry.beatZeroId,
    }))
  },
})

// ── Redo: restore warp state from history stack ────────────────────────────

historyMiddleware.startListening({
  actionCreator: redo,
  effect: (_action, listenerApi) => {
    const state = listenerApi.getState() as RootState
    const entry = state.history.stack[state.history.index]
    if (!entry) return
    listenerApi.dispatch(loadAnchors({
      origAnchors: entry.origAnchors,
      beatAnchors: entry.beatAnchors,
      linkedBeatIds: entry.linkedBeatIds,
      beatZeroId: entry.beatZeroId,
    }))
  },
})
