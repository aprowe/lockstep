import { createSelector, createSlice, type PayloadAction } from '@reduxjs/toolkit'

interface ThumbnailsState {
  /** Absolute disk paths keyed by file hash then frame number. */
  pathsByHashAndFrame: Record<string, Record<number, string>>
  /** Frames various UI surfaces want rendered, partitioned by source so
   *  multiple sources can contribute without trampling each other. The
   *  selector unions them before the Filmstrip pushes to the backend. */
  stripFramesBySource: Record<string, Record<string, number[]>>
  /** Frames the user is hovering over on the timeline. Lowest-priority tier
   *  — workers only pick these when nothing else is pending. */
  hoverFramesByHash: Record<string, number[]>
}

const initialState: ThumbnailsState = {
  pathsByHashAndFrame: {},
  stripFramesBySource: {},
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
      delete state.stripFramesBySource[action.payload]
      delete state.hoverFramesByHash[action.payload]
    },
    /** Replace the frames *for one source*. Other sources contributing to
     *  the same file hash are left untouched; the selector merges them. */
    setStripFrames(
      state,
      action: PayloadAction<{ fileHash: string; source: string; frames: number[] }>,
    ) {
      const { fileHash, source, frames } = action.payload
      const bucket = state.stripFramesBySource[fileHash] ?? {}
      if (frames.length === 0) delete bucket[source]
      else bucket[source] = frames
      if (Object.keys(bucket).length === 0) delete state.stripFramesBySource[fileHash]
      else state.stripFramesBySource[fileHash] = bucket
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

/** Union of every source's strip frames for a given file hash, deduped.
 *  Memoized per hash so subscribers see a stable array reference until a
 *  source mutates — otherwise every store change forces a re-render. */
const EMPTY_FRAMES: readonly number[] = Object.freeze([]) as readonly number[]
const selectorCache: Map<string, (state: { thumbnails: ThumbnailsState }) => number[]> = new Map()

export function selectStripFramesFor(
  hash: string | null | undefined,
): (state: { thumbnails: ThumbnailsState }) => number[] {
  const key = hash ?? ''
  let selector = selectorCache.get(key)
  if (selector) return selector
  selector = createSelector(
    [(s: { thumbnails: ThumbnailsState }) => hash ? s.thumbnails.stripFramesBySource[hash] : undefined],
    bySource => {
      if (!bySource) return EMPTY_FRAMES as number[]
      const set = new Set<number>()
      for (const frames of Object.values(bySource)) {
        for (const f of frames) set.add(f)
      }
      return [...set]
    },
  )
  selectorCache.set(key, selector)
  return selector
}

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
