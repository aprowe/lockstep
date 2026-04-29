import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { View } from '../../types'

export type ExportStatus = 'idle' | 'processing' | 'done' | 'error'

export interface ExportProgressState {
  status: ExportStatus
  progress: number
  label: string
  jobIdx: number
  totalJobs: number
  message: string
  error: string | null
}

interface UiState {
  timelineHeight: number
  sidebarWidth: number
  clipSidebarWidth: number
  rightWidth: number
  filmstripHeight: number
  sidebarCollapsed: boolean
  /** Hide the warp connector + beats/bars/speed timeline so the source timeline fills the pane. */
  warpCollapsed: boolean
  gridDiv: number
  playing: boolean
  exportOpen: boolean
  /** Source-of-truth view. WarpView keeps a local copy for high-frequency
   *  gesture updates and syncs back on gesture end. */
  view: View
  /** Last-used export folder (persists across dialog open/close) */
  lastExportFolder: string | null
  /** Export progress — survives dialog close so the background export can be
   *  monitored from the top-right progress bar. */
  exportProgress: ExportProgressState
}

const initialExportProgress: ExportProgressState = {
  status: 'idle',
  progress: 0,
  label: '',
  jobIdx: 0,
  totalJobs: 0,
  message: '',
  error: null,
}

const initialState: UiState = {
  timelineHeight: 372,
  sidebarWidth: 170,
  clipSidebarWidth: 210,
  rightWidth: 280,
  filmstripHeight: 90,
  sidebarCollapsed: false,
  warpCollapsed: false,
  gridDiv: 1,
  playing: false,
  exportOpen: false,
  view: { start: 0, end: 60 },
  lastExportFolder: null,
  exportProgress: initialExportProgress,
}

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setTimelineHeight(state, action: PayloadAction<number>) {
      state.timelineHeight = Math.max(275, action.payload)
    },
    setSidebarWidth(state, action: PayloadAction<number>) {
      state.sidebarWidth = Math.max(120, Math.min(320, action.payload))
    },
    setClipSidebarWidth(state, action: PayloadAction<number>) {
      state.clipSidebarWidth = Math.max(120, Math.min(280, action.payload))
    },
    setRightWidth(state, action: PayloadAction<number>) {
      state.rightWidth = Math.max(200, Math.min(480, action.payload))
    },
    setFilmstripHeight(state, action: PayloadAction<number>) {
      state.filmstripHeight = Math.max(50, Math.min(220, action.payload))
    },
    setSidebarCollapsed(state, action: PayloadAction<boolean>) {
      state.sidebarCollapsed = action.payload
    },
    setWarpCollapsed(state, action: PayloadAction<boolean>) {
      state.warpCollapsed = action.payload
    },
    setGridDiv(state, action: PayloadAction<number>) {
      state.gridDiv = action.payload
    },
    setPlaying(state, action: PayloadAction<boolean>) {
      state.playing = action.payload
    },
    setExportOpen(state, action: PayloadAction<boolean>) {
      state.exportOpen = action.payload
    },
    setView(state, action: PayloadAction<View>) {
      state.view = action.payload
    },
    setLastExportFolder(state, action: PayloadAction<string | null>) {
      state.lastExportFolder = action.payload
    },
    setExportProgress(state, action: PayloadAction<Partial<ExportProgressState>>) {
      state.exportProgress = { ...state.exportProgress, ...action.payload }
    },
    resetExportProgress(state) {
      state.exportProgress = { ...initialExportProgress }
    },
  },
})

export const {
  setTimelineHeight,
  setSidebarWidth,
  setClipSidebarWidth,
  setRightWidth,
  setFilmstripHeight,
  setSidebarCollapsed,
  setWarpCollapsed,
  setGridDiv,
  setPlaying,
  setExportOpen,
  setView,
  setLastExportFolder,
  setExportProgress,
  resetExportProgress,
} = uiSlice.actions

export default uiSlice.reducer
