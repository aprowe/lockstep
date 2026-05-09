import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { View } from '../../types'

const TIMELINE_PREFS_KEY = 'lockstep.timeline-prefs.v1'

interface TimelinePrefs {
  warpCollapsed: boolean
  gridDiv: number
  thumbShow: boolean
  followDrag: boolean
  alwaysAnchors: boolean
  alwaysRegions: boolean
  alwaysScenes: boolean
}

const DEFAULT_TIMELINE_PREFS: TimelinePrefs = {
  warpCollapsed: false,
  gridDiv: 1,
  thumbShow: false,
  followDrag: true,
  alwaysAnchors: true,
  alwaysRegions: false,
  alwaysScenes: false,
}

function loadTimelinePrefs(): TimelinePrefs {
  try {
    const raw = localStorage.getItem(TIMELINE_PREFS_KEY)
    if (!raw) return DEFAULT_TIMELINE_PREFS
    const p = JSON.parse(raw)
    return {
      warpCollapsed: typeof p.warpCollapsed === 'boolean' ? p.warpCollapsed : DEFAULT_TIMELINE_PREFS.warpCollapsed,
      gridDiv: typeof p.gridDiv === 'number' ? p.gridDiv : DEFAULT_TIMELINE_PREFS.gridDiv,
      thumbShow: typeof p.thumbShow === 'boolean' ? p.thumbShow : DEFAULT_TIMELINE_PREFS.thumbShow,
      followDrag: typeof p.followDrag === 'boolean' ? p.followDrag : DEFAULT_TIMELINE_PREFS.followDrag,
      alwaysAnchors: typeof p.alwaysAnchors === 'boolean' ? p.alwaysAnchors : DEFAULT_TIMELINE_PREFS.alwaysAnchors,
      alwaysRegions: typeof p.alwaysRegions === 'boolean' ? p.alwaysRegions : DEFAULT_TIMELINE_PREFS.alwaysRegions,
      alwaysScenes: typeof p.alwaysScenes === 'boolean' ? p.alwaysScenes : DEFAULT_TIMELINE_PREFS.alwaysScenes,
    }
  } catch {
    return DEFAULT_TIMELINE_PREFS
  }
}

function saveTimelinePrefs(state: UiState) {
  try {
    const prefs: TimelinePrefs = {
      warpCollapsed: state.warpCollapsed,
      gridDiv: state.gridDiv,
      thumbShow: state.timelineThumbShow,
      followDrag: state.timelineFollowDrag,
      alwaysAnchors: state.timelineAlwaysAnchors,
      alwaysRegions: state.timelineAlwaysRegions,
      alwaysScenes: state.timelineAlwaysScenes,
    }
    localStorage.setItem(TIMELINE_PREFS_KEY, JSON.stringify(prefs))
  } catch { /* storage full or unavailable — best effort */ }
}

/** What happens when the playhead reaches the end of the active region (or the
 *  full video, when no region is active) during playback:
 *  - `continue` — roll past the boundary (default; matches the prior behavior)
 *  - `stop`     — pause at the boundary
 *  - `loop`     — seek back to the in-point and keep playing
 *
 *  This is a *playback* setting; export-time loop behavior lives in
 *  `warp.trimToLoop` / `warp.loopBeats`. */
export type PlaybackLoopMode = 'continue' | 'stop' | 'loop'

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
  timelineThumbShow: boolean
  timelineFollowDrag: boolean
  timelineAlwaysAnchors: boolean
  timelineAlwaysRegions: boolean
  timelineAlwaysScenes: boolean
  playing: boolean
  /** What playback does at the end of the active clip / video. */
  playbackLoopMode: PlaybackLoopMode
  exportOpen: boolean
  /** Source-of-truth view. WarpView keeps a local copy for high-frequency
   *  gesture updates and syncs back on gesture end. */
  view: View
  /** Last-used export folder (persists across dialog open/close) */
  lastExportFolder: string | null
}

const _prefs = loadTimelinePrefs()

const initialState: UiState = {
  timelineHeight: 372,
  sidebarWidth: 170,
  clipSidebarWidth: 210,
  rightWidth: 280,
  filmstripHeight: 90,
  sidebarCollapsed: false,
  warpCollapsed: _prefs.warpCollapsed,
  gridDiv: _prefs.gridDiv,
  timelineThumbShow: _prefs.thumbShow,
  timelineFollowDrag: _prefs.followDrag,
  timelineAlwaysAnchors: _prefs.alwaysAnchors,
  timelineAlwaysRegions: _prefs.alwaysRegions,
  timelineAlwaysScenes: _prefs.alwaysScenes,
  playing: false,
  playbackLoopMode: 'continue',
  exportOpen: false,
  view: { start: 0, end: 60 },
  lastExportFolder: null,
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
      saveTimelinePrefs(state)
    },
    setGridDiv(state, action: PayloadAction<number>) {
      state.gridDiv = action.payload
      saveTimelinePrefs(state)
    },
    setTimelineThumbShow(state, action: PayloadAction<boolean>) {
      state.timelineThumbShow = action.payload
      saveTimelinePrefs(state)
    },
    setTimelineFollowDrag(state, action: PayloadAction<boolean>) {
      state.timelineFollowDrag = action.payload
      saveTimelinePrefs(state)
    },
    setTimelineAlwaysAnchors(state, action: PayloadAction<boolean>) {
      state.timelineAlwaysAnchors = action.payload
      saveTimelinePrefs(state)
    },
    setTimelineAlwaysRegions(state, action: PayloadAction<boolean>) {
      state.timelineAlwaysRegions = action.payload
      saveTimelinePrefs(state)
    },
    setTimelineAlwaysScenes(state, action: PayloadAction<boolean>) {
      state.timelineAlwaysScenes = action.payload
      saveTimelinePrefs(state)
    },
    setPlaying(state, action: PayloadAction<boolean>) {
      state.playing = action.payload
    },
    setPlaybackLoopMode(state, action: PayloadAction<PlaybackLoopMode>) {
      state.playbackLoopMode = action.payload
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
  setTimelineThumbShow,
  setTimelineFollowDrag,
  setTimelineAlwaysAnchors,
  setTimelineAlwaysRegions,
  setTimelineAlwaysScenes,
  setPlaying,
  setPlaybackLoopMode,
  setExportOpen,
  setView,
  setLastExportFolder,
} = uiSlice.actions

export default uiSlice.reducer
