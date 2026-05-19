/**
 * Drag a region's in-edge onto a DIVERGED anchor (orig != beat).
 *
 * Setup: anchor orig=5, beat=4. Default-linked region [10, 20].
 * Action: edge-resize in-edge to 5 (lands exactly on orig anchor).
 * Expected: clipout = (4, 20) — inBeatTime conforms to the beat anchor's
 *           time (4), outBeatTime stays at 20.
 */

import { describe, it, expect } from 'vitest'
import { makeStore } from '../../helpers/setup'
import { addRegion } from '../../../src/store/slices/regionSlice'
import { addAnchor, moveBeatAnchor } from '../../../src/store/slices/warpSlice'
import { moveRegionBounds } from '../../../src/store/thunks/regionThunks'
import type { Region } from '../../../src/types'

describe('Edge-resize clipin in-edge onto diverged anchor', () => {

  it('anchor [orig=5, beat=4], region [10,20] → in-edge to 5: clipout = (4, 20)', () => {
    const store = makeStore()

    const region: Region = {
      id: 'r', name: 'r', inPoint: 10, outPoint: 20,
      inBeatTime: 10, outBeatTime: 20, defaultLinked: true,
      bpm: 120, lockedBeats: 20,
      minStretch: 0.5, maxStretch: 2.0,
    }
    store.dispatch(addRegion(region))
    store.dispatch(addAnchor({ id: 1, time: 5 }))
    store.dispatch(moveBeatAnchor({ id: 1, time: 4 }))

    store.dispatch(moveRegionBounds({ id: 'r', inPoint: 5, outPoint: 20 }))

    const s = store.getState()
    const r = s.region.regions[0]

    expect(r.inPoint,     'clipin.in').toBeCloseTo(5, 6)
    expect(r.outPoint,    'clipin.out').toBeCloseTo(20, 6)
    expect(r.inBeatTime,  'clipout.in').toBeCloseTo(4, 6)
    expect(r.outBeatTime, 'clipout.out').toBeCloseTo(20, 6)

    // Anchor must not be tugged — conform binding is one-way (anchor → clipout).
    expect(s.warp.origAnchors[0].time, 'orig anchor').toBeCloseTo(5, 6)
    expect(s.warp.beatAnchors[0].time, 'beat anchor').toBeCloseTo(4, 6)
  })
})
