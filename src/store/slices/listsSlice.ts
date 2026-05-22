import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

/**
 * Cross-list UI state for the Clips / Markers / Scenes panels.
 *
 * Selection here is purely a presentation/multi-select concept — the
 * "active region" (single, drives the timeline) lives in regionSlice and is
 * orthogonal to selection. Clicking a single clip sets BOTH active and
 * selected to that one item; shift/ctrl variants only touch selection.
 */

export type ListId = "clips" | "markers" | "scenes" | "clipin" | "clipout";
/** Three-state view toggle on each panel header:
 *   none — no thumbnails, single-line list rows
 *   list — thumbnails inline on list rows
 *   grid — thumbnails in a grid layout (size driven by `thumbnailSize`) */
export type ListViewMode = "none" | "list" | "grid";
/** Visibility filter applied to each list's items.
 *   global   — every item, no filter
 *   viewport — items inside the current timeline view window
 *   clip     — items inside the active region (markers + scenes only;
 *              clips list ignores this mode)
 */
export type ListFilterMode = "global" | "viewport" | "clip";

/** Selection ids are typed differently per list (string for clip ids,
 *  number for anchor ids, etc.) but Redux can't carry generics. We store as
 *  string and let callers parse if they need to. */
type SelectionState = Record<ListId, string[]>;
type ViewModeState = Record<ListId, ListViewMode>;
type ThumbnailSizeState = Record<ListId, number>;
type FilterModeState = Record<ListId, ListFilterMode>;

interface ListsState {
    selection: SelectionState;
    viewMode: ViewModeState;
    /** Per-panel thumbnail display width in px. Drives CSS sizing for both
     *  the inline list-mode thumb and the grid-mode tile. */
    thumbnailSize: ThumbnailSizeState;
    filterMode: FilterModeState;
    /** The row currently being inline-renamed, if any. Lifted out of
     *  DockBridge so any list can drive its own rename UI without growing
     *  a per-type field on the bridge. */
    pendingEdit: { list: ListId; id: string } | null;
}

export const THUMB_SIZE_MIN = 48;
export const THUMB_SIZE_MAX = 240;
const DEFAULT_THUMB_SIZE = 96;

const STORAGE_KEY = "lockstep.lists-view.v1";

const ALL_LIST_IDS: ListId[] = ["clips", "markers", "scenes", "clipin", "clipout"];

function defaultViewMode(): ViewModeState {
    return { clips: "none", markers: "none", scenes: "none", clipin: "none", clipout: "none" };
}

function defaultThumbnailSize(): ThumbnailSizeState {
    return {
        clips: DEFAULT_THUMB_SIZE,
        markers: DEFAULT_THUMB_SIZE,
        scenes: DEFAULT_THUMB_SIZE,
        clipin: DEFAULT_THUMB_SIZE,
        clipout: DEFAULT_THUMB_SIZE,
    };
}

function defaultFilterMode(): FilterModeState {
    return {
        clips: "global",
        markers: "global",
        scenes: "global",
        clipin: "global",
        clipout: "global",
    };
}

function isViewMode(v: unknown): v is ListViewMode {
    return v === "none" || v === "list" || v === "grid";
}

function clampSize(v: unknown): number {
    if (typeof v !== "number" || !Number.isFinite(v)) return DEFAULT_THUMB_SIZE;
    return Math.max(THUMB_SIZE_MIN, Math.min(THUMB_SIZE_MAX, Math.round(v)));
}

interface PersistedShape {
    viewMode: ViewModeState;
    thumbnailSize: ThumbnailSizeState;
}

function loadPersisted(): PersistedShape {
    const viewMode = defaultViewMode();
    const thumbnailSize = defaultThumbnailSize();
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { viewMode, thumbnailSize };
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
            for (const id of ALL_LIST_IDS) {
                const vm = parsed.viewMode?.[id];
                if (isViewMode(vm)) viewMode[id] = vm;
                if (typeof parsed.thumbnailSize?.[id] === "number") {
                    thumbnailSize[id] = clampSize(parsed.thumbnailSize[id]);
                }
            }
        }
    } catch {
        /* corrupted or unavailable — fall through to defaults */
    }
    return { viewMode, thumbnailSize };
}

function savePersisted(state: ListsState) {
    try {
        const payload: PersistedShape = {
            viewMode: state.viewMode,
            thumbnailSize: state.thumbnailSize,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
        /* storage full or unavailable — best effort */
    }
}

const persisted = loadPersisted();

const initialState: ListsState = {
    selection: { clips: [], markers: [], scenes: [], clipin: [], clipout: [] },
    viewMode: persisted.viewMode,
    thumbnailSize: persisted.thumbnailSize,
    filterMode: defaultFilterMode(),
    pendingEdit: null,
};

const listsSlice = createSlice({
    name: "lists",
    initialState,
    reducers: {
        setListSelection(state, action: PayloadAction<{ list: ListId; ids: string[] }>) {
            const { list, ids } = action.payload;
            state.selection[list] = ids;
        },
        clearListSelection(state, action: PayloadAction<{ list: ListId }>) {
            state.selection[action.payload.list] = [];
        },
        setListViewMode(state, action: PayloadAction<{ list: ListId; mode: ListViewMode }>) {
            const { list, mode } = action.payload;
            state.viewMode[list] = mode;
            savePersisted(state);
        },
        setListThumbnailSize(state, action: PayloadAction<{ list: ListId; size: number }>) {
            const { list, size } = action.payload;
            state.thumbnailSize[list] = clampSize(size);
            savePersisted(state);
        },
        setListFilterMode(state, action: PayloadAction<{ list: ListId; mode: ListFilterMode }>) {
            const { list, mode } = action.payload;
            state.filterMode[list] = mode;
        },
        setPendingEdit(state, action: PayloadAction<{ list: ListId; id: string } | null>) {
            state.pendingEdit = action.payload;
        },
        /** Remove a specific id from clipin and clipout selections.
         *  Used after region deletion to prune stale IDs. */
        removeFromSelection(state, action: PayloadAction<string>) {
            const id = action.payload;
            state.selection.clipin = state.selection.clipin.filter((x) => x !== id);
            state.selection.clipout = state.selection.clipout.filter((x) => x !== id);
        },
    },
});

export const {
    setListSelection,
    clearListSelection,
    setListViewMode,
    setListThumbnailSize,
    setListFilterMode,
    setPendingEdit,
    removeFromSelection,
} = listsSlice.actions;

export default listsSlice.reducer;
