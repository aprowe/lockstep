import { createAsyncThunk } from '@reduxjs/toolkit'
import type { RootState } from '../store'
import { startSceneDetection, listenSceneProgress, cancelSceneDetection } from '../../api/scene'
import {
  startDetection,
  setProgress,
  setCuts,
  appendCut,
  setError,
  setCancelled,
} from '../slices/sceneSlice'

let unlisten: (() => void) | null = null

/** Attach a single global listener to scene-detection-progress events. */
export const ensureSceneListener = createAsyncThunk<void, void>(
  'scene/ensureListener',
  async (_, { dispatch, getState }) => {
    if (unlisten) return
    unlisten = await listenSceneProgress(payload => {
      const { path, job_id, status, cut, cuts, error } = payload
      if (!path) return
      const state = getState() as RootState
      // Drop events from stale jobs (user re-triggered detection for this path).
      const current = state.scene.jobByPath[path]
      if (current && current !== job_id) return
      if (status === 'running') {
        if (typeof cut === 'number') {
          dispatch(appendCut({ path, cut }))
          // Backend's percent is unreliable; derive progress from the latest
          // cut time vs. the loaded video's duration.
          const video = state.video.video
          if (video && video.path === path && video.duration > 0) {
            dispatch(setProgress({ path, progress: Math.min(1, cut / video.duration) }))
          }
        }
      } else if (status === 'done' && Array.isArray(cuts)) {
        dispatch(setCuts({ path, cuts }))
      } else if (status === 'cancelled') {
        dispatch(setCancelled({ path }))
      } else if (status === 'error') {
        dispatch(setError({ path, error: error ?? 'Scene detection failed' }))
      }
    })
  },
)

/** Kick off scene detection for a video, registering the listener if needed. */
export const detectScenesThunk = createAsyncThunk<
  void,
  { path: string; threshold?: number }
>(
  'scene/detect',
  async ({ path, threshold }, { dispatch, getState }) => {
    await dispatch(ensureSceneListener())
    const state = getState() as RootState
    const effectiveThreshold =
      threshold ?? state.scene.thresholdByPath[path] ?? 10
    try {
      const jobId = await startSceneDetection({ path, threshold: effectiveThreshold })
      dispatch(startDetection({ path, jobId, threshold: effectiveThreshold }))
    } catch (e: any) {
      dispatch(setError({ path, error: String(e?.message ?? e) }))
    }
  },
)

/** Abort the currently running scene detection. Only one runs at a time on the
 *  backend, so no path argument — the cancel flag just flips globally and the
 *  in-flight worker emits `status: 'cancelled'`. */
export const cancelSceneDetectionThunk = createAsyncThunk<void, void>(
  'scene/cancel',
  async () => {
    await cancelSceneDetection()
  },
)
