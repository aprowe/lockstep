import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

interface ThumbnailsState {
  /** Absolute disk paths keyed by file hash then frame number. */
  pathsByHashAndFrame: Record<string, Record<number, string>>
  /** Frames the thumbnail strip track wants rendered. Filmstrip reads this
   *  and threads it into its priority push so one unified context reaches
   *  the backend. */
  stripFramesByHash: Record<string, number[]>
  /** Frames the user is hovering over on the timeline. Lowest-priority tier
   *  — workers only pick these when nothing else is pending. */
  hoverFramesByHash: Record<string, number[]>
}

const initialState: ThumbnailsState = {
  pathsByHashAndFrame: {},
  stripFramesByHash: {},
  hoverFramesByHash: {},
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
      delete state.hoverFramesByHash[action.payload]
    },
    setStripFrames(state, action: PayloadAction<{ fileHash: string; frames: number[] }>) {
      const { fileHash, frames } = action.payload
      if (frames.length === 0) delete state.stripFramesByHash[fileHash]
      else state.stripFramesByHash[fileHash] = frames
    },
    setHoverFrames(state, action: PayloadAction<{ fileHash: string; frames: number[] }>) {
      const { fileHash, frames } = action.payload
      if (frames.length === 0) delete state.hoverFramesByHash[fileHash]
      else state.hoverFramesByHash[fileHash] = frames
    },
  },
})

export const { setThumbnail, clearForHash, setStripFrames, setHoverFrames } = thumbnailsSlice.actions
export default thumbnailsSlice.reducer

/**
 * Stable empty-paths reference. Selectors that fall back to `{}` inline
 * create a fresh object on every call, which defeats the `useSelector`
 * reference-equality check and re-renders subscribers on every store
 * update. Share this sentinel instead.
 */
export const EMPTY_FRAME_PATHS: Readonly<Record<number, string>> = Object.freeze({})

/** Thumbnails map for a given file hash, or a stable empty object. */
export function selectThumbnailPathsFor(
  hash: string | null | undefined,
): (state: { thumbnails: ThumbnailsState }) => Record<number, string> {
  return state => {
    if (!hash) return EMPTY_FRAME_PATHS as Record<number, string>
    return state.thumbnails.pathsByHashAndFrame[hash] ?? (EMPTY_FRAME_PATHS as Record<number, string>)
  }
}
