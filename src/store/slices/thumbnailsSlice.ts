import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

interface ThumbnailsState {
  /** Absolute disk paths keyed by file hash then frame number. */
  pathsByHashAndFrame: Record<string, Record<number, string>>
  /** Frames the thumbnail strip track wants rendered. Filmstrip reads this
   *  and threads it into its priority push so one unified context reaches
   *  the backend. */
  stripFramesByHash: Record<string, number[]>
}

const initialState: ThumbnailsState = {
  pathsByHashAndFrame: {},
  stripFramesByHash: {},
}

const thumbnailsSlice = createSlice({
  name: 'thumbnails',
  initialState,
  reducers: {
    setThumbnail(state, action: PayloadAction<{ fileHash: string; frame: number; path: string }>) {
      const { fileHash, frame, path } = action.payload
      const existing = state.pathsByHashAndFrame[fileHash] ?? {}
      existing[frame] = path
      state.pathsByHashAndFrame[fileHash] = existing
    },
    clearForHash(state, action: PayloadAction<string>) {
      delete state.pathsByHashAndFrame[action.payload]
      delete state.stripFramesByHash[action.payload]
    },
    setStripFrames(state, action: PayloadAction<{ fileHash: string; frames: number[] }>) {
      const { fileHash, frames } = action.payload
      if (frames.length === 0) delete state.stripFramesByHash[fileHash]
      else state.stripFramesByHash[fileHash] = frames
    },
  },
})

export const { setThumbnail, clearForHash, setStripFrames } = thumbnailsSlice.actions
export default thumbnailsSlice.reducer
