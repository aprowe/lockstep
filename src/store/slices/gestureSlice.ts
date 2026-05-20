/**
 * Gesture slice — transient live state for drag interactions.
 *
 *   activeHandle:    what the user grabbed (entity + handle kind)
 *   cumulativeDelta: signed delta from drag start in the dragged-space units
 *   modifiers:       transient modifier-key state (alt for anchor-lock XOR;
 *                    others can be added)
 *
 * Cleared on `endDrag` / `cancelDrag` (via `clearGesture`). The pipeline
 * reads this slice in `buildGraphFromSlice` to inject gesture-scoped
 * constraints declared by each handle's GestureProfile.whileDragging.
 */

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Handle } from "../../constraints/profiles/types";

export interface GestureState {
    activeHandle: Handle | null;
    cumulativeDelta: number;
    modifiers: { alt: boolean };
    /** Pixel-to-time conversion at drag start. Used by profiles to convert
     *  the pixel-space snap threshold (8 px) into entity-time units.
     *  0 means "not set" (no drag active or controller didn't provide).
     */
    pxPerUnit: number;
    /** Optional beat-grid for snap (set when the active gesture should
     *  consider grid marks alongside entity targets). */
    grid: { interval: number; offset: number } | null;
}

const initialState: GestureState = {
    activeHandle: null,
    cumulativeDelta: 0,
    modifiers: { alt: false },
    pxPerUnit: 0,
    grid: null,
};

const gestureSlice = createSlice({
    name: "gesture",
    initialState,
    reducers: {
        setActiveHandle(state, action: PayloadAction<Handle | null>) {
            state.activeHandle = action.payload;
        },
        setCumulativeDelta(state, action: PayloadAction<number>) {
            state.cumulativeDelta = action.payload;
        },
        setGestureModifiers(state, action: PayloadAction<{ alt: boolean }>) {
            state.modifiers = action.payload;
        },
        setGesturePxPerUnit(
            state,
            action: PayloadAction<{
                pxPerUnit: number;
                grid?: { interval: number; offset: number } | null;
            }>,
        ) {
            state.pxPerUnit = action.payload.pxPerUnit;
            state.grid = action.payload.grid ?? null;
        },
        clearGesture(state) {
            state.activeHandle = null;
            state.cumulativeDelta = 0;
            state.modifiers = { alt: false };
            state.pxPerUnit = 0;
            state.grid = null;
        },
    },
});

export const {
    setActiveHandle,
    setCumulativeDelta,
    setGestureModifiers,
    setGesturePxPerUnit,
    clearGesture,
} = gestureSlice.actions;

export default gestureSlice.reducer;
