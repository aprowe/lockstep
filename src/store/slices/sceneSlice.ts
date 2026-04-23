import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

export type SceneStatus = 'idle' | 'analyzing' | 'done' | 'cancelled' | 'error'

interface SceneState {
  /** Detected cut times (seconds) per video path — what ffmpeg's scdet
   *  produced. Subject to the user's min-gap filter at display time. */
  cutsByPath: Record<string, number[]>
  /** User-placed cut times per video path. These bypass the min-gap
   *  filter — if the user explicitly dropped a cut there, the UI must
   *  honor it regardless of how dense the surrounding detected cuts are.
   *  Persisted alongside `cutsByPath`. */
  userCutsByPath: Record<string, number[]>
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
  /** Per-video min seconds between consecutive cuts. 0 disables. Collapses dense clusters in the UI. */
  minGapByPath: Record<string, number>
  /** Currently-selected scene cut times (seconds). Identified by exact time
   *  rather than index because cuts can be added/removed underneath the
   *  selection — matching by time keeps the survivors stable. */
  selectedCutTimes: number[]
}

const initialState: SceneState = {
  cutsByPath: {},
  userCutsByPath: {},
  statusByPath: {},
  progressByPath: {},
  errorByPath: {},
  jobByPath: {},
  thresholdByPath: {},
  minGapByPath: {},
  selectedCutTimes: [],
}

/** Insert `t` into a sorted number[] in place (Immer-safe), deduped within
 *  1ms to absorb float drift. Returns true when the array changed. */
function insertSorted(list: number[], t: number): boolean {
  if (list.some(existing => Math.abs(existing - t) < 1e-3)) return false
  let i = 0
  while (i < list.length && list[i] < t) i += 1
  list.splice(i, 0, t)
  return true
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
      // Clear stale cuts so streaming results don't mingle with a previous run.
      state.cutsByPath[path] = []
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
    /** Append a single streaming cut as ffmpeg discovers it. Keeps the list sorted. */
    appendCut(state, action: PayloadAction<{ path: string; cut: number }>) {
      const { path, cut } = action.payload
      const list = state.cutsByPath[path] ?? []
      // Dedup within 1ms of an existing cut.
      if (list.some(t => Math.abs(t - cut) < 1e-3)) return
      // Insert in sorted position.
      let i = 0
      while (i < list.length && list[i] < cut) i += 1
      state.cutsByPath[path] = [...list.slice(0, i), cut, ...list.slice(i)]
      const s = state.statusByPath[path]
      if (s !== 'done' && s !== 'error') state.statusByPath[path] = 'analyzing'
    },
    setError(state, action: PayloadAction<{ path: string; error: string }>) {
      state.statusByPath[action.payload.path] = 'error'
      state.errorByPath[action.payload.path] = action.payload.error
    },
    /** Flagged when the user aborts an in-flight detection. Keeps whatever
     *  cuts were streamed so far so the user doesn't lose partial progress. */
    setCancelled(state, action: PayloadAction<{ path: string }>) {
      const { path } = action.payload
      state.statusByPath[path] = 'cancelled'
      state.progressByPath[path] = 0
      delete state.errorByPath[path]
    },
    loadCached(
      state,
      action: PayloadAction<{ path: string; cuts: number[]; threshold: number; userCuts?: number[] }>,
    ) {
      const { path, cuts, threshold, userCuts } = action.payload
      state.cutsByPath[path] = cuts
      if (userCuts && userCuts.length > 0) state.userCutsByPath[path] = userCuts
      state.statusByPath[path] = 'done'
      state.progressByPath[path] = 1
      state.thresholdByPath[path] = threshold
      delete state.errorByPath[path]
      delete state.jobByPath[path]
    },
    clearForPath(state, action: PayloadAction<string>) {
      const path = action.payload
      delete state.cutsByPath[path]
      delete state.userCutsByPath[path]
      delete state.statusByPath[path]
      delete state.progressByPath[path]
      delete state.errorByPath[path]
      delete state.jobByPath[path]
    },
    setMinGap(state, action: PayloadAction<{ path: string; minGap: number }>) {
      const { path, minGap } = action.payload
      state.minGapByPath[path] = Math.max(0, minGap)
    },
    /** User-added cut — written to `userCutsByPath` so it bypasses the
     *  min-gap filter that detected cuts are subject to. Skipped if the
     *  same time is already a detected cut (no point shadowing it). */
    addCut(state, action: PayloadAction<{ path: string; cut: number }>) {
      const { path, cut } = action.payload
      const detected = state.cutsByPath[path] ?? []
      if (detected.some(t => Math.abs(t - cut) < 1e-3)) return
      if (!state.userCutsByPath[path]) state.userCutsByPath[path] = []
      insertSorted(state.userCutsByPath[path], cut)
    },
    /** User-removed cut — matches within 1ms in BOTH detected and user
     *  pools so the same path works whether the cut was detected or
     *  manually placed. */
    deleteCut(state, action: PayloadAction<{ path: string; cut: number }>) {
      const { path, cut } = action.payload
      if (state.cutsByPath[path]) {
        state.cutsByPath[path] = state.cutsByPath[path].filter(t => Math.abs(t - cut) >= 1e-3)
      }
      if (state.userCutsByPath[path]) {
        state.userCutsByPath[path] = state.userCutsByPath[path].filter(t => Math.abs(t - cut) >= 1e-3)
      }
      // Drop the matching entry from selection too — orphaned times would
      // visually do nothing but pollute every selection-driven action.
      state.selectedCutTimes = state.selectedCutTimes.filter(
        t => Math.abs(t - cut) >= 1e-3,
      )
    },
    /** Replace the timeline-side scene cut selection. Times are matched by
     *  exact value when reading; lasso/Delete callers always pass canonical
     *  times sourced from cutsByPath. */
    setSelectedCutTimes(state, action: PayloadAction<number[]>) {
      state.selectedCutTimes = action.payload
    },
  },
})

export const {
  startDetection,
  setProgress,
  setCuts,
  appendCut,
  setError,
  setCancelled,
  loadCached,
  clearForPath,
  setMinGap,
  addCut,
  deleteCut,
  setSelectedCutTimes,
} = sceneSlice.actions

export default sceneSlice.reducer
