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

import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { Handle } from '../../constraints/profiles/types'

export interface GestureSnapInstall {
  entityId: string
  field:    'time' | 'in' | 'out'
  threshold: number
  grid?:    { interval: number; offset: number }
  mode?:    'edge' | 'body'
  targets?: Array<{ entityId: string; field: 'time' | 'in' | 'out' }>
}

export interface GestureState {
  activeHandle: Handle | null
  cumulativeDelta: number
  modifiers: { alt: boolean }
  /** Snap install for the active gesture. Populated by beginDrag /
   *  snapStart; cleared by endDrag / cancelDrag / snapEnd. Replaces
   *  dragCtxSlice.snapInstall. */
  snapInstall: GestureSnapInstall | null
}

const initialState: GestureState = {
  activeHandle: null,
  cumulativeDelta: 0,
  modifiers: { alt: false },
  snapInstall: null,
}

const gestureSlice = createSlice({
  name: 'gesture',
  initialState,
  reducers: {
    setActiveHandle(state, action: PayloadAction<Handle | null>) {
      state.activeHandle = action.payload
    },
    setCumulativeDelta(state, action: PayloadAction<number>) {
      state.cumulativeDelta = action.payload
    },
    setGestureModifiers(state, action: PayloadAction<{ alt: boolean }>) {
      state.modifiers = action.payload
    },
    setGestureSnapInstall(state, action: PayloadAction<GestureSnapInstall | null>) {
      state.snapInstall = action.payload
    },
    clearGesture(state) {
      state.activeHandle = null
      state.cumulativeDelta = 0
      state.modifiers = { alt: false }
      state.snapInstall = null
    },
  },
})

export const {
  setActiveHandle,
  setCumulativeDelta,
  setGestureModifiers,
  setGestureSnapInstall,
  clearGesture,
} = gestureSlice.actions

export default gestureSlice.reducer
