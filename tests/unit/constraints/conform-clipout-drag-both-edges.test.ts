/**
 * Drag clipout body of a default-linked region whose BOTH edges sit on
 * linked anchors. Both anchors should follow the drag (each via its own
 * MirrorPair binding installed by buildGraphFromSlice).
 */

import { describe, it, expect } from 'vitest'
import { makeStore } from '../../helpers/setup'
import { addRegion } from '../../../src/store/slices/regionSlice'
import { addAnchor } from '../../../src/store/slices/warpSlice'
import { commitClipoutPan, commitClipoutResize } from '../../../src/store/thunks/clipoutThunks'
import type { Region } from '../../../src/types'

function setupBothEdgesConformed() {
  const store = makeStore()
  // Default-linked region [10, 30]: clipin = clipout = [10, 30].
  const region: Region = {
    id: 'r', name: 'r', inPoint: 10, outPoint: 30,
    inBeatTime: 10, outBeatTime: 30, defaultLinked: true,
    bpm: 120, lockedBeats: 40,
    minStretch: 0.5, maxStretch: 2.0, addToEnd: false,
  }
  store.dispatch(addRegion(region))
  // Linked anchors at both edges (orig = beat for each).
  store.dispatch(addAnchor({ id: 1, time: 10 }))  // on 'in' edge
  store.dispatch(addAnchor({ id: 2, time: 30 }))  // on 'out' edge
  return store
}

describe('Default-linked region with anchors on both edges: clipout drag carries both anchors', () => {

  it('body pan +5: clipout becomes [15, 35], both anchors follow to 15 and 35', () => {
    const store = setupBothEdgesConformed()

    store.dispatch(commitClipoutPan({
      id: 'r', inBeatTime: 15, outBeatTime: 35, altKey: false,
    }))

    const post = store.getState()
    expect(post.region.regions[0].inBeatTime).toBeCloseTo(15, 6)
    expect(post.region.regions[0].outBeatTime).toBeCloseTo(35, 6)
    // Both anchors carried by their respective MirrorPair conform bindings.
    expect(post.warp.beatAnchors.find(a => a.id === 1)?.time).toBeCloseTo(15, 6)
    expect(post.warp.beatAnchors.find(a => a.id === 2)?.time).toBeCloseTo(35, 6)
  })

  it('body pan via delta (+5): both anchors follow by the same delta', () => {
    const store = setupBothEdgesConformed()

    store.dispatch(commitClipoutPan({ id: 'r', delta: 5, altKey: false }))

    const post = store.getState()
    expect(post.region.regions[0].inBeatTime).toBeCloseTo(15, 6)
    expect(post.region.regions[0].outBeatTime).toBeCloseTo(35, 6)
    expect(post.warp.beatAnchors.find(a => a.id === 1)?.time).toBeCloseTo(15, 6)
    expect(post.warp.beatAnchors.find(a => a.id === 2)?.time).toBeCloseTo(35, 6)
  })

  it('edge resize (out-edge 30 → 32): only the out anchor follows; in anchor stays', () => {
    const store = setupBothEdgesConformed()

    store.dispatch(commitClipoutResize({
      id: 'r', inBeatTime: 10, outBeatTime: 32, altKey: false,
    }))

    const post = store.getState()
    expect(post.region.regions[0].inBeatTime).toBeCloseTo(10, 6)
    expect(post.region.regions[0].outBeatTime).toBeCloseTo(32, 6)
    // The 'in' anchor doesn't move (its edge wasn't resized).
    expect(post.warp.beatAnchors.find(a => a.id === 1)?.time).toBeCloseTo(10, 6)
    // The 'out' anchor follows the resized edge.
    expect(post.warp.beatAnchors.find(a => a.id === 2)?.time).toBeCloseTo(32, 6)
  })
})
