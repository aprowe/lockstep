import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

interface ThumbnailsState {
  /** Absolute disk paths keyed by file hash then frame number. */
  pathsByHashAndFrame: Record<string, Record<number, string>>
}

const initialState: ThumbnailsState = {
  pathsByHashAndFrame: {},
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
    },
  },
})

export const { setThumbnail, clearForHash } = thumbnailsSlice.actions
export default thumbnailsSlice.reducer
