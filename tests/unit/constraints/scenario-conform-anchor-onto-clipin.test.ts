/**
 * Conform engaged by dragging the ANCHOR onto the clipin edge.
 *
 * Setup: region [10, 20] (default-linked, so inBeatTime/outBeatTime mirror
 * inPoint/outPoint). Anchor pair at orig=5, beat=5 (linked).
 *
 * Gesture: drag the ORIG anchor from 5 → 10 (single-space drag — beat side
 * stays at 5 since the pair-link was reverted).
 *
 * Expected: ConformVisual engages (clipin.in = orig = 10), writing
 * anchor-out.time (= 5, beat-side unchanged) to clipout.in. Resulting
 * clipout = [5, 20].
 */

import { describe, it, expect } from 'vitest'
import { makeStore } from '../../helpers/setup'
import { addRegion } from '../../../src/store/slices/regionSlice'
import { addAnchor } from '../../../src/store/slices/warpSlice'
import { applyAnchorEntityMove } from '../../../src/store/thunks/entityWriteThunks'
import { anchorInId } from '../../../src/constraints/ids'
import type { Region } from '../../../src/types'

describe('Anchor drag onto clipin: conform engages, clipout becomes [beat, outPoint]', () => {

  it('drag orig anchor from 5 to 10 → clipout becomes [5, 20]', () => {
    const store = makeStore()
    // Region [10, 20], default-linked.
    const region: Region = {
      id: 'r', name: 'r', inPoint: 10, outPoint: 20,
      inBeatTime: 10, outBeatTime: 20, defaultLinked: true,
      bpm: 120, lockedBeats: 20,
      minStretch: 0.5, maxStretch: 2.0,
    }
    store.dispatch(addRegion(region))
    // Linked anchor at orig=beat=5.
    store.dispatch(addAnchor({ id: 1, time: 5 }))

    // Drag the ORIG anchor (input-space) from 5 to 10.
    store.dispatch(applyAnchorEntityMove({ entityId: anchorInId(1), time: 10 }))

    const post = store.getState()
    const r = post.region.regions[0]
    // clipin (input space) unchanged.
    expect(r.inPoint).toBe(10)
    expect(r.outPoint).toBe(20)
    // Anchor's orig moved.
    expect(post.warp.origAnchors.find(a => a.id === 1)?.time).toBeCloseTo(10, 6)
    // Anchor's beat stays at 5 (single-space drag, pair-link reverted).
    expect(post.warp.beatAnchors.find(a => a.id === 1)?.time).toBeCloseTo(5, 6)
    // Conform engaged: clipout.in = beat anchor's time = 5.
    expect(r.inBeatTime).toBeCloseTo(5, 6)
    // clipout.out unchanged (no anchor on out-edge).
    expect(r.outBeatTime).toBeCloseTo(20, 6)
  })
})
