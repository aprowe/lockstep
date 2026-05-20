/**
 * Phase 7 — Drag cancel via slice snapshot restore.
 *
 * Phase 4c rewrite: the constraint graph is now derived from the slice.
 * Canceling a drag restores the slice snapshot (origAnchors + beatAnchors +
 * regions) captured at drag start. The derived graph view then reflects the
 * restored slice values automatically.
 *
 * Verifies that:
 *  1. cancelDrag reverts slice positions to pre-drag values.
 *  2. cancelDrag clears ephemeral dragCtx snap state.
 *  3. snapEnd (clearSnapInstall) removes snap without affecting entity position.
 */

import { describe, it, expect } from 'vitest'
import { configureStore } from '@reduxjs/toolkit'
import warpReducer, { addAnchor } from '../../../src/store/slices/warpSlice'
import regionReducer from '../../../src/store/slices/regionSlice'
import listsReducer from '../../../src/store/slices/listsSlice'
import uiReducer from '../../../src/store/slices/uiSlice'
import dragReducer, { dragStart, dragEnd } from '../../../src/store/slices/dragSlice'
import dragCtxReducer, { setSnapInstall, clearSnapInstall } from '../../../src/store/slices/dragCtxSlice'
import { cancelDrag, snapshotPreDragState } from '../../../src/store/thunks/dragThunks'
import { applyAnchorEntityMove } from '../../../src/store/thunks/entityWriteThunks'
import { anchorInId } from '../../../src/constraints/ids'
import { selectConstraintGraph } from '../../../src/store/selectors/constraintGraph'
import type { RootState, AppDispatch } from '../../../src/store/store'

function makeStore() {
  const s = configureStore({
    reducer: {
      warp:    warpReducer,
      region:  regionReducer,
      lists:   listsReducer,
      ui:      uiReducer,
      drag:    dragReducer,
      dragCtx: dragCtxReducer,
    },
  })
  return s as typeof s & { dispatch: AppDispatch }
}

type Store = ReturnType<typeof makeStore>

function graphEntityTime(store: Store, entityId: string): number {
  const g = selectConstraintGraph(store.getState() as RootState)
  const e = g.entities[entityId]
  if (!e || e.kind !== 'anchor') throw new Error(`${entityId} not anchor`)
  return e.time
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Phase 7 — drag cancel via graph snapshot', () => {

  it('restores entity positions to pre-drag values on cancel', () => {
    const store = makeStore()

    store.dispatch(addAnchor({ id: 1, time: 10 }))
    store.dispatch(addAnchor({ id: 2, time: 20 }))

    const preDragPositionA1 = graphEntityTime(store, anchorInId(1))
    expect(preDragPositionA1).toBeCloseTo(10)

    // Snapshot pre-drag state and arm the drag.
    const preDrag = snapshotPreDragState(store.getState() as RootState)
    store.dispatch(dragStart(preDrag))

    // Simulate a position change during the drag (as if via anchorEntityMove).
    store.dispatch(applyAnchorEntityMove({ entityId: anchorInId(1), time: 15 }))
    expect(graphEntityTime(store, anchorInId(1))).toBeCloseTo(15)

    // Also verify warp slice mirror reflects the change.
    const duringDragSlice = store.getState().warp.origAnchors.find(a => a.id === 1)
    expect(duringDragSlice?.time).toBeCloseTo(15)

    // Cancel — should restore slice to pre-drag snapshot.
    store.dispatch(cancelDrag())

    // Derived graph position restored.
    expect(graphEntityTime(store, anchorInId(1))).toBeCloseTo(10)

    // Slice also restored.
    const afterCancel = store.getState().warp.origAnchors.find(a => a.id === 1)
    expect(afterCancel?.time).toBeCloseTo(10)

    // Drag state cleared.
    expect(store.getState().drag.active).toBe(false)
    expect(store.getState().drag.preDrag).toBeNull()
  })

  it('removes ephemeral snap constraints on cancel', () => {
    const store = makeStore()

    store.dispatch(addAnchor({ id: 1, time: 10 }))
    store.dispatch(addAnchor({ id: 2, time: 20 }))

    // Arm drag.
    const preDrag = snapshotPreDragState(store.getState() as RootState)
    store.dispatch(dragStart(preDrag))

    // Install snap constraint mid-drag (via dragCtx.setSnapInstall,
    // as the controller would do via snapStart intent in Phase 4c).
    store.dispatch(setSnapInstall({
      entityId: anchorInId(1),
      field: 'time',
      threshold: 10,
    }))

    // Verify snap install is set.
    expect(store.getState().dragCtx.snapInstall).not.toBeNull()

    // Cancel drag — snap cleared.
    store.dispatch(cancelDrag())

    // Snap install cleared.
    expect(store.getState().dragCtx.snapInstall).toBeNull()
  })

  it('snapEnd removes snap constraint but leaves entity position intact', () => {
    const store = makeStore()

    store.dispatch(addAnchor({ id: 1, time: 10 }))
    store.dispatch(addAnchor({ id: 2, time: 20 }))

    // Install and then explicitly remove snap (as pointerUp would do).
    store.dispatch(setSnapInstall({
      entityId: anchorInId(1),
      field: 'time',
      threshold: 10,
    }))
    store.dispatch(clearSnapInstall())

    // Snap install cleared.
    expect(store.getState().dragCtx.snapInstall).toBeNull()

    // Position still intact (slice is the source of truth).
    expect(graphEntityTime(store, anchorInId(1))).toBeCloseTo(10)
  })

})
