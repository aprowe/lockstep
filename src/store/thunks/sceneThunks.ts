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
import { addJob as addJobAction, updateJob as updateJobAction } from '../slices/jobsSlice'

/** Strip a directory path down to its filename so the Tasks panel doesn't
 *  show full paths on rows that are already context-poor. */
function basename(path: string): string {
  const norm = path.replace(/\\/g, '/')
  const idx = norm.lastIndexOf('/')
  return idx >= 0 ? norm.slice(idx + 1) : norm
}

let unlisten: (() => void) | null = null

/** Attach a single global listener to scene-detection-progress events. */
export const ensureSceneListener = createAsyncThunk<void, void>(
  'scene/ensureListener',
  async (_, { dispatch, getState }) => {
    if (unlisten) return
    unlisten = await listenSceneProgress(payload => {
      const { path, job_id, status, cut, cuts, window, error } = payload
      if (!path) return
      const state = getState() as RootState
      // Drop events from stale jobs (user re-triggered detection for this path).
      const current = state.scene.jobByPath[path]
      if (current && current !== job_id) return
      if (status === 'running') {
        if (typeof cut === 'number') {
          dispatch(appendCut({ path, cut }))
          // Backend's percent is unreliable; derive progress from the latest
          // cut time vs. the scan span (window length when one is set,
          // otherwise the full video duration).
          const video = state.video.video
          if (video && video.path === path) {
            const span = window ? Math.max(0, window.end - window.start) : video.duration
            const offset = window?.start ?? 0
            if (span > 0) {
              const p = Math.min(1, Math.max(0, (cut - offset) / span))
              dispatch(setProgress({ path, progress: p }))
              dispatch(updateJobAction({ id: job_id, progress: p, status: 'running' }))
            }
          }
        }
      } else if (status === 'done' && Array.isArray(cuts)) {
        // Mark the actually-scanned span so the scene track can show a
        // "scanned" indicator. With no window, fall back to the loaded
        // video's duration so a full scan covers [0, duration]; if we
        // somehow don't know the duration yet, Infinity acts as an
        // open-ended sentinel that the renderer clamps to view.
        const video = (getState() as RootState).video.video
        const duration = video?.path === path ? video.duration : 0
        const scannedRange = window
          ? { start: window.start, end: window.end }
          : { start: 0, end: duration > 0 ? duration : Number.POSITIVE_INFINITY }
        dispatch(setCuts({
          path,
          cuts,
          window: window ?? undefined,
          scannedRange,
        }))
        dispatch(updateJobAction({ id: job_id, status: 'done', progress: 1 }))
      } else if (status === 'cancelled') {
        dispatch(setCancelled({ path }))
        dispatch(updateJobAction({ id: job_id, status: 'cancelled' }))
      } else if (status === 'error') {
        dispatch(setError({ path, error: error ?? 'Scene detection failed' }))
        dispatch(updateJobAction({
          id: job_id,
          status: 'error',
          error: error ?? 'Scene detection failed',
        }))
      }
    })
  },
)

/** Kick off scene detection for a video, registering the listener if needed.
 *  When a window is supplied, ffmpeg only scans that range and the slice
 *  replaces the cuts inside the window without disturbing cuts outside it. */
export const detectScenesThunk = createAsyncThunk<
  void,
  { path: string; threshold?: number; window?: { start: number; end: number } }
>(
  'scene/detect',
  async ({ path, threshold, window }, { dispatch, getState }) => {
    await dispatch(ensureSceneListener())
    const state = getState() as RootState
    const effectiveThreshold =
      threshold ?? state.scene.thresholdByPath[path] ?? 10
    const validWindow = window && window.end > window.start ? window : undefined
    try {
      const jobId = await startSceneDetection({
        path,
        threshold: effectiveThreshold,
        start: validWindow?.start,
        end: validWindow?.end,
      })
      dispatch(startDetection({
        path,
        jobId,
        threshold: effectiveThreshold,
        window: validWindow,
      }))
      dispatch(addJobAction({
        id: jobId,
        kind: 'scene',
        label: validWindow
          ? `${basename(path)} (view)`
          : basename(path),
      }))
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
