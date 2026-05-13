import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

/**
 * Cross-list UI state for the Clips / Markers / Scenes panels.
 *
 * Selection here is purely a presentation/multi-select concept — the
 * "active region" (single, drives the timeline) lives in regionSlice and is
 * orthogonal to selection. Clicking a single clip sets BOTH active and
 * selected to that one item; shift/ctrl variants only touch selection.
 */

export type ListId = 'clips' | 'markers' | 'scenes' | 'clipin' | 'clipout'
export type ListThumbnailMode = 'none' | 'small' | 'large'
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
  /** The row currently being inline-renamed, if any. Lifted out of
   *  DockBridge so any list can drive its own rename UI without growing
   *  a per-type field on the bridge. */
  pendingEdit: { list: ListId; id: string } | null
}

const initialState: ListsState = {
  selection: { clips: [], markers: [], scenes: [], clipin: [], clipout: [] },
  thumbnailMode: { clips: 'none', markers: 'none', scenes: 'none', clipin: 'none', clipout: 'none' },
  filterMode: { clips: 'global', markers: 'global', scenes: 'global', clipin: 'global', clipout: 'global' },
  pendingEdit: null,
}

const listsSlice = createSlice({
  name: 'lists',
  initialState,
  reducers: {
    setListSelection(state, action: PayloadAction<{ list: ListId; ids: string[] }>) {
      const { list, ids } = action.payload
      state.selection[list] = ids
    },
    clearListSelection(state, action: PayloadAction<{ list: ListId }>) {
      state.selection[action.payload.list] = []
    },
    setListThumbnailMode(state, action: PayloadAction<{ list: ListId; mode: ListThumbnailMode }>) {
      const { list, mode } = action.payload
      state.thumbnailMode[list] = mode
    },
    setListFilterMode(state, action: PayloadAction<{ list: ListId; mode: ListFilterMode }>) {
      const { list, mode } = action.payload
      state.filterMode[list] = mode
    },
    setPendingEdit(state, action: PayloadAction<{ list: ListId; id: string } | null>) {
      state.pendingEdit = action.payload
    },
  },
})

export const {
  setListSelection,
  clearListSelection,
  setListThumbnailMode,
  setListFilterMode,
  setPendingEdit,
} = listsSlice.actions

export default listsSlice.reducer
