/**
 * dragCtxSlice — canonical home for transient gesture state.
 *
 * Phase 4a (Option B): introduces dragCtxSlice mounted at state.dragCtx as the
 * authoritative store for the four pieces of transient state the constraint
 * pipeline needs:
 *
 *   - lassoIds:    entity IDs in the current lasso/selection TranslateGroup
 *   - snapInstall: active SnapTarget constraint parameters
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
  setAnchorLock,
  clearAnchorLock,
} = dragCtxSlice.actions

export default dragCtxSlice.reducer
