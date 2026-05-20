import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Anchor, Region } from "../../types";

export interface PreDragSnapshot {
    regions: Region[];
    origAnchors: Anchor[];
    beatAnchors: Anchor[];
}

export interface DragSliceState {
    /** True while a pointer-driven drag is in flight. History and persistence
     *  middleware skip their normal processing while this is true. */
    active: boolean;
    /** Snapshot of slice state captured at drag start. Used to restore on
     *  pointercancel / Escape rollback via the cancelDrag thunk. null when idle. */
    preDrag: PreDragSnapshot | null;
}

const initialState: DragSliceState = {
    active: false,
    preDrag: null,
};

const dragSlice = createSlice({
    name: "drag",
    initialState,
    reducers: {
        dragStart(state, action: PayloadAction<PreDragSnapshot>) {
            state.active = true;
            state.preDrag = action.payload;
        },
        dragEnd(state) {
            state.active = false;
            state.preDrag = null;
        },
    },
});

export const { dragStart, dragEnd } = dragSlice.actions;
export default dragSlice.reducer;
