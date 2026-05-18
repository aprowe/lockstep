/**
 * Phase 2.5 — TranslateGroup propagation via single-entity Move op.
 *
 * Verifies that dispatching `applyAnchorEntityMove` on the PRIMARY grabbed
 * entity propagates the implied delta to all other entities in the
 * lasso:main TranslateGroup, without any manual follower iteration.
 *
 * Phase 4c: reads from selectConstraintGraph (derived) instead of
 * state.constraint.graph (deleted persistent store).
 */

import { describe, it, expect } from 'vitest'
import { configureStore, type EnhancedStore } from '@reduxjs/toolkit'
import warpReducer, {
  addAnchor,
  setSelectedOrigIds,
  setSelectedBeatIds,
  setSelectedBothIds,
} from '../../../src/store/slices/warpSlice'
import listsReducer, { setListSelection } from '../../../src/store/slices/listsSlice'
import regionReducer, { addRegion } from '../../../src/store/slices/regionSlice'
import uiReducer from '../../../src/store/slices/uiSlice'
import dragCtxReducer from '../../../src/store/slices/dragCtxSlice'
import { selectionGraphMirrorMiddleware } from '../../../src/store/middleware/selectionGraphMirrorMiddleware'
import {
  applyAnchorEntityMove,
  applyRegionEntityMove,
} from '../../../src/store/thunks/entityWriteThunks'
import { selectConstraintGraph } from '../../../src/store/selectors/constraintGraph'
import type { RootState } from '../../../src/store/store'

function makeStore() {
  return configureStore({
    reducer: {
      warp: warpReducer,
      lists: listsReducer,
      region: regionReducer,
      ui: uiReducer,
      dragCtx: dragCtxReducer,
    },
    middleware: (getDefault) =>
      getDefault()
        .concat(selectionGraphMirrorMiddleware),
  })
}

function anchorTime(store: EnhancedStore, entityId: string): number {
  const graph = selectConstraintGraph(store.getState() as RootState)
  const e = graph.entities[entityId]
  if (!e || e.kind !== 'anchor' || e.time === undefined) throw new Error(`Entity ${entityId} not found or not an anchor`)
  return e.time
}

function clipBounds(store: EnhancedStore, entityId: string): { in: number; out: number } {
  const graph = selectConstraintGraph(store.getState() as RootState)
  const e = graph.entities[entityId]
  if (!e || e.kind !== 'clip' || e.in === undefined || e.out === undefined) throw new Error(`Entity ${entityId} not found or not a clip`)
  return { in: e.in, out: e.out }
}

describe('Phase 2.5 — TranslateGroup propagation via single-entity Move op', () => {
  // ── Anchor drag propagation ───────────────────────────────────────────────

  it('moving primary orig anchor propagates delta to all selected orig anchors', () => {
    const store = makeStore()
    // Seed three anchors
    store.dispatch(addAnchor({ id: 1, time: 1.0 }))
    store.dispatch(addAnchor({ id: 2, time: 2.0 }))
    store.dispatch(addAnchor({ id: 3, time: 3.0 }))
    // Select all three in orig space → lasso:main gets [a1-in, a2-in, a3-in]
    store.dispatch(setSelectedOrigIds([1, 2, 3]))

    // Move primary (a1-in) by +10s
    store.dispatch(applyAnchorEntityMove({ entityId: 'a1-in', time: 11.0 }))

    // All three should have advanced by 10s
    expect(anchorTime(store, 'a1-in')).toBeCloseTo(11.0)
    expect(anchorTime(store, 'a2-in')).toBeCloseTo(12.0)
    expect(anchorTime(store, 'a3-in')).toBeCloseTo(13.0)
    // Linked pairs: each orig drag propagates to its beat partner via the
    // pairlink:* DirectedPair installed by initAnchorPair. Default link
    // semantics — anchor pairs added by addAnchor are linked.
    expect(anchorTime(store, 'a1-out')).toBeCloseTo(11.0)
    expect(anchorTime(store, 'a2-out')).toBeCloseTo(12.0)
    expect(anchorTime(store, 'a3-out')).toBeCloseTo(13.0)
  })

  it('moving primary beat anchor propagates delta to all selected beat anchors', () => {
    const store = makeStore()
    store.dispatch(addAnchor({ id: 4, time: 0.5 }))
    store.dispatch(addAnchor({ id: 5, time: 1.5 }))
    // Select both in beat space → lasso:main gets [a4-out, a5-out]
    store.dispatch(setSelectedBeatIds([4, 5]))

    // Move primary (a4-out) by +5s
    store.dispatch(applyAnchorEntityMove({ entityId: 'a4-out', time: 5.5 }))

    expect(anchorTime(store, 'a4-out')).toBeCloseTo(5.5)
    expect(anchorTime(store, 'a5-out')).toBeCloseTo(6.5)
    // Orig anchors NOT in the group — unchanged
    expect(anchorTime(store, 'a4-in')).toBeCloseTo(0.5)
    expect(anchorTime(store, 'a5-in')).toBeCloseTo(1.5)
  })

  it('pair drag (both spaces selected) propagates from one entity to all group members', () => {
    const store = makeStore()
    store.dispatch(addAnchor({ id: 7, time: 2.0 }))
    store.dispatch(addAnchor({ id: 8, time: 4.0 }))
    // Select both anchors in BOTH spaces → lasso has a7-in, a7-out, a8-in, a8-out
    store.dispatch(setSelectedBothIds([7, 8]))

    // Move primary (a7-in) by +3s
    store.dispatch(applyAnchorEntityMove({ entityId: 'a7-in', time: 5.0 }))

    expect(anchorTime(store, 'a7-in')).toBeCloseTo(5.0)
    expect(anchorTime(store, 'a8-in')).toBeCloseTo(7.0)
    expect(anchorTime(store, 'a7-out')).toBeCloseTo(5.0)
    expect(anchorTime(store, 'a8-out')).toBeCloseTo(7.0)
  })

  it('single selected anchor — no propagation, only primary moves', () => {
    const store = makeStore()
    store.dispatch(addAnchor({ id: 10, time: 1.0 }))
    store.dispatch(addAnchor({ id: 11, time: 5.0 }))
    // Only anchor 10 is selected
    store.dispatch(setSelectedOrigIds([10]))

    store.dispatch(applyAnchorEntityMove({ entityId: 'a10-in', time: 3.0 }))

    expect(anchorTime(store, 'a10-in')).toBeCloseTo(3.0)
    // Anchor 11 not in lasso — should not move
    expect(anchorTime(store, 'a11-in')).toBeCloseTo(5.0)
  })

  // ── Region body drag propagation ──────────────────────────────────────────

  it('moving primary clipin region propagates delta to all selected clipin regions', () => {
    const store = makeStore()
    store.dispatch(addRegion({
      id: 'r1', name: 'R1', inPoint: 0, outPoint: 10,
      inBeatTime: 0, outBeatTime: 10, defaultLinked: true,
      bpm: 120, minStretch: 0.5, maxStretch: 2.0, addToEnd: false,
    }))
    store.dispatch(addRegion({
      id: 'r2', name: 'R2', inPoint: 20, outPoint: 30,
      inBeatTime: 20, outBeatTime: 30, defaultLinked: true,
      bpm: 120, minStretch: 0.5, maxStretch: 2.0, addToEnd: false,
    }))
    // Select both clipins → lasso:main has [r1-in, r2-in]
    store.dispatch(setListSelection({ list: 'clipin', ids: ['r1', 'r2'] }))

    // Move primary (r1) by +5s (delta = new_in - orig_in = 5 - 0 = +5)
    store.dispatch(applyRegionEntityMove({ id: 'r1', delta: 5 }))

    // r1 moved to [5, 15]
    expect(clipBounds(store, 'r1-in')).toEqual({ in: 5, out: 15 })
    // r2 should also shift by +5: [25, 35]
    expect(clipBounds(store, 'r2-in')).toEqual({ in: 25, out: 35 })
  })

  // ── Slice mirror sync ─────────────────────────────────────────────────────

  it('graphMirrorMiddleware syncs propagated positions back to slice after anchorEntityMove', () => {
    const store = makeStore()
    store.dispatch(addAnchor({ id: 20, time: 1.0 }))
    store.dispatch(addAnchor({ id: 21, time: 2.0 }))
    store.dispatch(setSelectedOrigIds([20, 21]))

    store.dispatch(applyAnchorEntityMove({ entityId: 'a20-in', time: 3.0 }))

    const warp = (store.getState() as { warp: { origAnchors: Array<{ id: number; time: number }> } }).warp
    const a20 = warp.origAnchors.find(a => a.id === 20)
    const a21 = warp.origAnchors.find(a => a.id === 21)
    expect(a20?.time).toBeCloseTo(3.0)
    expect(a21?.time).toBeCloseTo(4.0)
  })

  // ── Double-translate hazard regression ────────────────────────────────────

  it('double-translate guard: both clipin and clipout in lasso — each entity moves exactly once (not 2×)', () => {
    // Regression for Phase 2.5 review Critical #2:
    // When BOTH clipin and clipout of a default-linked region are lasso members,
    // the explicit clipout Move in applyRegionEntityMove must be skipped — the
    // first Move on clipin propagates to clipout via TranslateGroup. Without the
    // guard, clipout would be moved +delta twice (2× translate).
    const store = makeStore()
    store.dispatch(addRegion({
      id: 'r1', name: 'R1', inPoint: 10, outPoint: 20,
      inBeatTime: 10, outBeatTime: 20, defaultLinked: true,
      bpm: 120, minStretch: 0.5, maxStretch: 2.0, addToEnd: false,
    }))
    store.dispatch(addRegion({
      id: 'r2', name: 'R2', inPoint: 30, outPoint: 40,
      inBeatTime: 30, outBeatTime: 40, defaultLinked: true,
      bpm: 120, minStretch: 0.5, maxStretch: 2.0, addToEnd: false,
    }))
    // Select ALL four entities: clipin and clipout of both r1 and r2.
    // lasso:main will contain [r1-in, r2-in, r1-out, r2-out].
    store.dispatch(setListSelection({ list: 'clipin',  ids: ['r1', 'r2'] }))
    store.dispatch(setListSelection({ list: 'clipout', ids: ['r1', 'r2'] }))

    // Move primary (r1) by +5s (delta = 15 - 10 = +5).
    store.dispatch(applyRegionEntityMove({ id: 'r1', delta: 5 }))

    // All four entities should shift by exactly +5 (not +10 from double-translate).
    expect(clipBounds(store, 'r1-in')).toEqual({ in: 15, out: 25 })
    expect(clipBounds(store, 'r2-in')).toEqual({ in: 35, out: 45 })
    expect(clipBounds(store, 'r1-out')).toEqual({ in: 15, out: 25 })
    expect(clipBounds(store, 'r2-out')).toEqual({ in: 35, out: 45 })
  })

  // ── pointerUp single-entity commit propagates through lasso ───────────────

  it('pointerUp commit: anchorEntityMove on primary propagates to all lasso members', () => {
    // Regression for Phase 2.5 review Critical #1:
    // The pointerUp anchor-drag path now emits anchorEntityMove (single-entity)
    // instead of the whole-array anchorsChanged. Verify the graph AND slice
    // mirror are both updated correctly for all lasso members.
    const store = makeStore()
    store.dispatch(addAnchor({ id: 30, time: 2.0 }))
    store.dispatch(addAnchor({ id: 31, time: 4.0 }))
    // Select both in orig (input) space → lasso:main: [a30-in, a31-in]
    store.dispatch(setSelectedOrigIds([30, 31]))

    // Simulate pointerUp emitting anchorEntityMove on the primary (a30-in).
    // Final time = 5.0 → delta = +3.0.
    store.dispatch(applyAnchorEntityMove({ entityId: 'a30-in', time: 5.0 }))

    // Both graph entities should reflect the propagated delta.
    expect(anchorTime(store, 'a30-in')).toBeCloseTo(5.0)
    expect(anchorTime(store, 'a31-in')).toBeCloseTo(7.0)
    // Linked pairs: beat partners follow via the pairlink:* DirectedPair.
    expect(anchorTime(store, 'a30-out')).toBeCloseTo(5.0)
    expect(anchorTime(store, 'a31-out')).toBeCloseTo(7.0)

    // Slice mirror should also reflect the propagated positions.
    const warp = (store.getState() as { warp: { origAnchors: Array<{ id: number; time: number }>; beatAnchors: Array<{ id: number; time: number }> } }).warp
    const a30 = warp.origAnchors.find(a => a.id === 30)
    const a31 = warp.origAnchors.find(a => a.id === 31)
    expect(a30?.time).toBeCloseTo(5.0)
    expect(a31?.time).toBeCloseTo(7.0)
    // Beat partners on slice too.
    expect(warp.beatAnchors.find(a => a.id === 30)?.time).toBeCloseTo(5.0)
    expect(warp.beatAnchors.find(a => a.id === 31)?.time).toBeCloseTo(7.0)
  })
})
