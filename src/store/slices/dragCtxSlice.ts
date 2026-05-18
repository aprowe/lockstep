/**
 * dragCtxSlice — canonical home for transient gesture state.
 *
 * Phase 4a (Option B): introduces dragCtxSlice mounted at state.dragCtx as the
 * authoritative store for the four pieces of transient state the constraint
 * pipeline needs:
 *
 *   - lassoIds:    entity IDs in the current lasso/selection TranslateGroup
 *   - snapInstall: active SnapTarget constraint parameters
 *   - carry:       active carry pairs (clipout-edge → beat-anchor)
 *   - anchorLock:  active anchor-lock state
 *
 * The mirror middlewares that maintain these fields in the constraint graph
 * (selectionGraphMirrorMiddleware, anchorLockMirrorMiddleware) now also
 * shadow-write to this slice. Similarly, the snap and carry dispatch sites in
 * WarpView / CanvasTimeline dispatch to this slice in parallel.
 *
 * This slice is the source of truth for all drag transient state.
 *
 * NOTE: There is an existing `dragSlice` at state.drag for pre-drag snapshots
 * (active flag + preDrag data). This slice is SEPARATE and lives at state.dragCtx.
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { EntityId, Field } from '../../constraints/types'

export interface DragCtxSliceState {
  /** Lasso TranslateGroup members (entity IDs). Empty when no selection. */
  lassoIds: EntityId[]

  /** Snap installed for a drag — null when not snapping. */
  snapInstall: {
    entityId: EntityId
    field: Field
    threshold: number
    grid?: { interval: number; offset: number }
    mode?: 'edge' | 'body'
    targets?: { entityId: EntityId; field: Field }[]
  } | null

  /** Active carry pairs (clipout edge → beat anchor). */
  carry: Array<{ clipOutId: EntityId; edge: 'in' | 'out'; anchorOutId: EntityId }>

  /** Anchor-lock state — null when inactive. */
  anchorLock: {
    clipOutId: EntityId
    innerAnchorOutIds: EntityId[]
    lockMode: 'bpm' | 'beats'
  } | null
}

const initialState: DragCtxSliceState = {
  lassoIds: [],
  snapInstall: null,
  carry: [],
  anchorLock: null,
}

const dragCtxSlice = createSlice({
  name: 'dragCtx',
  initialState,
  reducers: {
    setLassoIds(state, action: PayloadAction<EntityId[]>) {
      state.lassoIds = action.payload
    },
    clearLasso(state) {
      state.lassoIds = []
    },
    setSnapInstall(state, action: PayloadAction<DragCtxSliceState['snapInstall']>) {
      state.snapInstall = action.payload
    },
    clearSnapInstall(state) {
      state.snapInstall = null
    },
    addCarryPair(state, action: PayloadAction<DragCtxSliceState['carry'][number]>) {
      state.carry.push(action.payload)
    },
    clearCarry(state, action: PayloadAction<EntityId>) {
      state.carry = state.carry.filter(c => c.clipOutId !== action.payload)
    },
    clearAllCarry(state) {
      state.carry = []
    },
    setAnchorLock(state, action: PayloadAction<DragCtxSliceState['anchorLock']>) {
      state.anchorLock = action.payload
    },
    clearAnchorLock(state) {
      state.anchorLock = null
    },
  },
})

export const {
  setLassoIds,
  clearLasso,
  setSnapInstall,
  clearSnapInstall,
  addCarryPair,
  clearCarry,
  clearAllCarry,
  setAnchorLock,
  clearAnchorLock,
} = dragCtxSlice.actions

export default dragCtxSlice.reducer
