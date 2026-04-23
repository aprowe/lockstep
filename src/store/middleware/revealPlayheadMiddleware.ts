import { createListenerMiddleware } from '@reduxjs/toolkit'
import type { RootState } from '../store'
import { setPlayhead } from '../slices/warpSlice'
import { setView } from '../slices/uiSlice'
import { scrollViewToTime } from '../../utils/view'

export const revealPlayheadMiddleware = createListenerMiddleware()

/**
 * When the playhead moves to a position outside the current timeline view,
 * shift the view just enough to bring the playhead back on screen. Skipped
 * during playback — otherwise the view would scroll continuously with the
 * playhead instead of staying put.
 *
 * Covers every jump vector uniformly: panel activations (markers / scenes /
 * clips lists), toolbar buttons, keyboard shortcuts, and programmatic seeks
 * like the "seek to region start when active region changes" effect. Each
 * of those seeks triggers `setPlayhead` via the video element's timeupdate,
 * so pinning the behavior here means no per-call-site wiring to maintain.
 */
revealPlayheadMiddleware.startListening({
  actionCreator: setPlayhead,
  effect: (action, { getState, dispatch }) => {
    const state = getState() as RootState
    if (state.ui.playing) return
    const duration = state.video.video?.duration ?? 0
    if (duration <= 0) return
    const time = action.payload
    const next = scrollViewToTime(state.ui.view, time, duration)
    if (next !== state.ui.view) dispatch(setView(next))
  },
})
