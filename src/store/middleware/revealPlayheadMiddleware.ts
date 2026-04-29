import { createListenerMiddleware } from '@reduxjs/toolkit'
import type { RootState } from '../store'
import { setPlayhead } from '../slices/warpSlice'
import { setView } from '../slices/uiSlice'
import { scrollViewToTime } from '../../utils/view'

export const revealPlayheadMiddleware = createListenerMiddleware()

/** Last seen playhead value — used to distinguish deliberate seeks from
 *  small timeupdate drift. A continuous-playback timeupdate fires every
 *  ~50–250ms so the delta stays sub-second; deliberate seeks (list-row
 *  activation, toolbar nav, region zoom) jump by much more. */
let prevPlayhead = 0

/**
 * When the playhead moves to a position outside the current timeline view,
 * shift the view just enough to bring the playhead back on screen. Skipped
 * during playback — otherwise the view would scroll continuously with the
 * playhead instead of staying put.
 *
 * Skipped for small deltas (< 0.5s). That covers two annoyances:
 *  - The first timeupdate after pause sometimes lands the playhead slightly
 *    outside the view (because it drifted off during playback). Without the
 *    threshold, pause would yank the view to the playhead.
 *  - After a region zoom, the video element frame-snaps the seek by a few
 *    ms, so the new playhead lands just outside the freshly zoomed view —
 *    the threshold avoids the resulting cosmetic re-shift.
 *
 * Deliberate seeks (panel activations, toolbar buttons, keyboard shortcuts,
 * "seek to region start when active region changes") all jump by far more
 * than the threshold, so the reveal still kicks in for the cases that need
 * it.
 */
revealPlayheadMiddleware.startListening({
  actionCreator: setPlayhead,
  effect: (action, { getState, dispatch }) => {
    const state = getState() as RootState
    const time = action.payload
    const delta = Math.abs(time - prevPlayhead)
    prevPlayhead = time
    if (state.ui.playing) return
    if (delta < 0.5) return
    const duration = state.video.video?.duration ?? 0
    if (duration <= 0) return
    const next = scrollViewToTime(state.ui.view, time, duration)
    if (next !== state.ui.view) dispatch(setView(next))
  },
})
