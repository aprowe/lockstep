import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

/**
 * Cross-list UI state for the Clips / Markers / Scenes panels.
 *
 * Selection here is purely a presentation/multi-select concept — the
 * "active region" (single, drives the timeline) lives in regionSlice and is
 * orthogonal to selection. Clicking a single clip sets BOTH active and
 * selected to that one item; shift/ctrl variants only touch selection.
 */

export type ListId = 'clips' | 'markers' | 'scenes'
export type ListThumbnailMode = 'none' | 'hover' | 'always'
/** Visibility filter applied to each list's items.
 *   global   — every item, no filter
 *   viewport — items inside the current timeline view window
 *   clip     — items inside the active region (markers + scenes only;
 *              clips list ignores this mode)
 */
export type ListFilterMode = 'global' | 'viewport' | 'clip'

/** Selection ids are typed differently per list (string for clip ids,
 *  number for anchor ids, etc.) but Redux can't carry generics. We store as
 *  string and let callers parse if they need to. */
type SelectionState = Record<ListId, string[]>
type ThumbnailModeState = Record<ListId, ListThumbnailMode>
type FilterModeState = Record<ListId, ListFilterMode>

interface ListsState {
  selection: SelectionState
  thumbnailMode: ThumbnailModeState
  filterMode: FilterModeState
  /** The most-recently-clicked single item, used to drive the Inspector
   *  panel that shows the focused item's details. Null = nothing focused. */
  lastSelected: { list: ListId; id: string } | null
}

const initialState: ListsState = {
  selection: { clips: [], markers: [], scenes: [] },
  thumbnailMode: { clips: 'none', markers: 'none', scenes: 'none' },
  filterMode: { clips: 'global', markers: 'global', scenes: 'global' },
  lastSelected: null,
}

const listsSlice = createSlice({
  name: 'lists',
  initialState,
  reducers: {
    setListSelection(state, action: PayloadAction<{ list: ListId; ids: string[] }>) {
      const { list, ids } = action.payload
      state.selection[list] = ids
    },
    clearListSelection(state, action: PayloadAction<ListId>) {
      state.selection[action.payload] = []
    },
    setListThumbnailMode(state, action: PayloadAction<{ list: ListId; mode: ListThumbnailMode }>) {
      const { list, mode } = action.payload
      state.thumbnailMode[list] = mode
    },
    setListFilterMode(state, action: PayloadAction<{ list: ListId; mode: ListFilterMode }>) {
      const { list, mode } = action.payload
      state.filterMode[list] = mode
    },
    setLastSelected(state, action: PayloadAction<{ list: ListId; id: string } | null>) {
      state.lastSelected = action.payload
    },
  },
})

export const {
  setListSelection,
  clearListSelection,
  setListThumbnailMode,
  setListFilterMode,
  setLastSelected,
} = listsSlice.actions

export default listsSlice.reducer
