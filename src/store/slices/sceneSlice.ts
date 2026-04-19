import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

export type SceneStatus = 'idle' | 'analyzing' | 'done' | 'error'

interface SceneState {
  /** Detected cut times (seconds) per video path. */
  cutsByPath: Record<string, number[]>
  /** Per-path detection status. */
  statusByPath: Record<string, SceneStatus>
  /** Per-path progress fraction 0..1. */
  progressByPath: Record<string, number>
  /** Per-path error message. */
  errorByPath: Record<string, string>
  /** Active detection job id per path (used to ignore stale events). */
  jobByPath: Record<string, string>
  /** Per-video scdet threshold override. Higher = fewer cuts. */
  thresholdByPath: Record<string, number>
}

const initialState: SceneState = {
  cutsByPath: {},
  statusByPath: {},
  progressByPath: {},
  errorByPath: {},
  jobByPath: {},
  thresholdByPath: {},
}

const sceneSlice = createSlice({
  name: 'scene',
  initialState,
  reducers: {
    startDetection(
      state,
      action: PayloadAction<{ path: string; jobId: string; threshold: number }>,
    ) {
      const { path, jobId, threshold } = action.payload
      state.statusByPath[path] = 'analyzing'
      state.progressByPath[path] = 0
      state.jobByPath[path] = jobId
      state.thresholdByPath[path] = threshold
      delete state.errorByPath[path]
    },
    setProgress(state, action: PayloadAction<{ path: string; progress: number }>) {
      const { path, progress } = action.payload
      state.progressByPath[path] = progress
      // Flip to 'analyzing' in case a progress event arrives before startDetection.
      const s = state.statusByPath[path]
      if (s !== 'done' && s !== 'error') state.statusByPath[path] = 'analyzing'
    },
    setCuts(state, action: PayloadAction<{ path: string; cuts: number[] }>) {
      state.cutsByPath[action.payload.path] = action.payload.cuts
      state.statusByPath[action.payload.path] = 'done'
      state.progressByPath[action.payload.path] = 1
    },
    setError(state, action: PayloadAction<{ path: string; error: string }>) {
      state.statusByPath[action.payload.path] = 'error'
      state.errorByPath[action.payload.path] = action.payload.error
    },
    loadCached(
      state,
      action: PayloadAction<{ path: string; cuts: number[]; threshold: number }>,
    ) {
      const { path, cuts, threshold } = action.payload
      state.cutsByPath[path] = cuts
      state.statusByPath[path] = 'done'
      state.progressByPath[path] = 1
      state.thresholdByPath[path] = threshold
      delete state.errorByPath[path]
      delete state.jobByPath[path]
    },
    clearForPath(state, action: PayloadAction<string>) {
      const path = action.payload
      delete state.cutsByPath[path]
      delete state.statusByPath[path]
      delete state.progressByPath[path]
      delete state.errorByPath[path]
      delete state.jobByPath[path]
    },
  },
})

export const {
  startDetection,
  setProgress,
  setCuts,
  setError,
  loadCached,
  clearForPath,
} = sceneSlice.actions

export default sceneSlice.reducer
