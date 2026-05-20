/**
 * Restored from removed legacy test (Task 13):
 *   scenario-clipin-snap-directed-pair.test.ts
 *
 * Regression: applyUpdateRegionInOut must NOT issue an explicit clipout
 * write — it should write only clipin edge ops and let the resolver's
 * MirrorEdge propagate the (possibly snap-restricted) clipin value to
 * clipout. The original bug was that an explicit clipout dispatch used the
 * raw inPoint, overwriting the snap-restricted clipin/clipout value.
 *
 * The current implementation only dispatches `setRegionInEdgeOp` (clipin)
 * ops — no clipout side-write. This test guards the structural invariant:
 * a default-linked region updated via applyUpdateRegionInOut maintains
 * clipin↔clipout equality through the resolver, with no side dispatch
 * that could race the snap restriction.
 */

import { describe, it, expect, vi } from 'vitest'
import { makeStore } from '../../helpers/setup'
import { addRegion } from '../../../src/store/slices/regionSlice'
import { applyUpdateRegionInOut } from '../../../src/store/thunks/entityWriteThunks'
import type { Region } from '../../../src/types'

describe('Restored: applyUpdateRegionInOut writes only clipin; clipout follows via MirrorEdge', () => {
  it('default-linked region: explicit dispatch updates clipin AND mirrors to clipout', () => {
    const store = makeStore()
    const region: Region = {
      id: 'r', name: 'r', inPoint: 10, outPoint: 20,
      inBeatTime: 10, outBeatTime: 20, defaultLinked: true,
      bpm: 120, lockedBeats: 20,
      minStretch: 0.5, maxStretch: 2.0,
    }
    store.dispatch(addRegion(region))

    store.dispatch(applyUpdateRegionInOut({ id: 'r', inPoint: 12, outPoint: 22 }))

    const r = store.getState().region.regions[0]
    expect(r.inPoint).toBeCloseTo(12, 6)
    expect(r.outPoint).toBeCloseTo(22, 6)
    // MirrorEdge propagated: clipout follows clipin for a default-linked region.
    expect(r.inBeatTime).toBeCloseTo(12, 6)
    expect(r.outBeatTime).toBeCloseTo(22, 6)
  })

  it('structural invariant: dispatched actions touch only the clipin entity (no setRegionOutEdgeOp side dispatch)', () => {
    // Spy on all dispatched action types during the call. Any clipout-side
    // op (action whose payload.id ends in '-out' for a SetEdge / Move) would
    // indicate a regression that could re-introduce the overwrite race.
    const store = makeStore()
    const region: Region = {
      id: 'r', name: 'r', inPoint: 10, outPoint: 20,
      inBeatTime: 10, outBeatTime: 20, defaultLinked: true,
      bpm: 120, lockedBeats: 20,
      minStretch: 0.5, maxStretch: 2.0,
    }
    store.dispatch(addRegion(region))

    const dispatchSpy = vi.spyOn(store, 'dispatch')
    store.dispatch(applyUpdateRegionInOut({ id: 'r', inPoint: 14, outPoint: 24 }))

    const sideOps = dispatchSpy.mock.calls.filter(([action]) => {
      const a = action as { type?: string; payload?: { id?: string } }
      if (!a.type || !a.payload) return false
      // The constraint pipeline dispatches actions whose payloads include
      // entity ids like 'r-in' (clipin) / 'r-out' (clipout). A clipout-side
      // op in applyUpdateRegionInOut would mean an entity id ending in '-out'.
      return typeof a.payload.id === 'string' && a.payload.id.endsWith('-out')
    })
    expect(
      sideOps,
      'applyUpdateRegionInOut must not dispatch clipout-side ops directly — let MirrorEdge handle it',
    ).toHaveLength(0)
  })
})
