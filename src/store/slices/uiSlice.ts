import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { View } from '../../types'

interface UiState {
  timelineHeight: number
  sidebarWidth: number
  clipSidebarWidth: number
  rightWidth: number
  sidebarCollapsed: boolean
  gridDiv: number
  playing: boolean
  exportOpen: boolean
  /** Source-of-truth view. WarpView keeps a local copy for high-frequency
   *  gesture updates and syncs back on gesture end. */
  view: View
}

const initialState: UiState = {
  timelineHeight: 280,
  sidebarWidth: 170,
  clipSidebarWidth: 170,
  rightWidth: 280,
  sidebarCollapsed: false,
  gridDiv: 1,
  playing: false,
  exportOpen: false,
  view: { start: 0, end: 60 },
}

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setTimelineHeight(state, action: PayloadAction<number>) {
      state.timelineHeight = Math.max(100, Math.min(500, action.payload))
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
    setSidebarCollapsed(state, action: PayloadAction<boolean>) {
      state.sidebarCollapsed = action.payload
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
  },
})

export const {
  setTimelineHeight,
  setSidebarWidth,
  setClipSidebarWidth,
  setRightWidth,
  setSidebarCollapsed,
  setGridDiv,
  setPlaying,
  setExportOpen,
  setView,
} = uiSlice.actions

export default uiSlice.reducer
