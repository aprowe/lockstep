import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { VideoInfo } from '../../types'
import type { VideoEntry } from '../../api/video'

interface VideoState {
  video: VideoInfo | null
  folderVideos: VideoEntry[]
  markerCountByPath: Record<string, number>
  markersLoaded: boolean
  detectingBpm: boolean
}

const initialState: VideoState = {
  video: null,
  folderVideos: [],
  markerCountByPath: {},
  markersLoaded: false,
  detectingBpm: false,
}

const videoSlice = createSlice({
  name: 'video',
  initialState,
  reducers: {
    setVideo(state, action: PayloadAction<VideoInfo | null>) {
      state.video = action.payload
    },
    clearVideo(state) {
      state.video = null
      state.markersLoaded = false
    },
    setFolderVideos(state, action: PayloadAction<VideoEntry[]>) {
      state.folderVideos = action.payload
    },
    setMarkerCount(state, action: PayloadAction<Record<string, number>>) {
      state.markerCountByPath = action.payload
    },
    updateMarkerCount(state, action: PayloadAction<{ path: string; count: number }>) {
      state.markerCountByPath[action.payload.path] = action.payload.count
    },
    setMarkersLoaded(state, action: PayloadAction<boolean>) {
      state.markersLoaded = action.payload
    },
    setDetectingBpm(state, action: PayloadAction<boolean>) {
      state.detectingBpm = action.payload
    },
  },
})

export const {
  setVideo,
  clearVideo,
  setFolderVideos,
  setMarkerCount,
  updateMarkerCount,
  setMarkersLoaded,
  setDetectingBpm,
} = videoSlice.actions

export default videoSlice.reducer
