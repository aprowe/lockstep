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
import { dragStart } from '../../../src/store/slices/dragSlice'
import { snapshotPreDragState } from '../../../src/store/thunks/dragThunks'
import { setSnapInstall } from '../../../src/store/slices/dragCtxSlice'
import { regionInId, regionOutId } from '../../../src/constraints/ids'
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

  it('snap-loop: pixel-by-pixel +2 snap radii then −2 snap radii — anchors must NOT be lost when clipout re-snaps to clipin', () => {
    // Bug repro: drag clipout body away from clipin, then back. When the
    // body re-enters snap radius of clipin and the snap engages (clipout
    // snapped back to clipin), the anchors should still follow — they
    // shouldn't be "lost" / left behind at the peak-drag position.
    const store = setupBothEdgesConformed()

    // Install body-mode snap on clipout with the region's clipin edges as
    // targets — matches what the controller installs at pointerDown for a
    // clipout body drag. Snap radius (threshold) = 2 in these units.
    const SNAP_RADIUS = 2
    store.dispatch(setSnapInstall({
      entityId:  regionOutId('r'),
      field:     'in',
      threshold: SNAP_RADIUS,
      mode:      'body',
      targets: [
        { entityId: regionInId('r'), field: 'in'  },
        { entityId: regionInId('r'), field: 'out' },
      ],
    }))

    // Capture drag-start snapshot so commitClipoutPan's cumulative deltas
    // resolve against the original positions.
    store.dispatch(dragStart(snapshotPreDragState(store.getState())))

    // Pixel-by-pixel forward: 0 → +2*SNAP_RADIUS (4 frames each +1).
    for (let cum = 1; cum <= 2 * SNAP_RADIUS; cum++) {
      store.dispatch(commitClipoutPan({ id: 'r', delta: cum, altKey: false }))
    }
    // At peak, clipout = [10 + 2*R, 30 + 2*R] = [14, 34]; anchors should
    // have followed to 14 and 34 (well outside snap radius of clipin's [10,30]).
    {
      const peak = store.getState()
      expect(peak.region.regions[0].inBeatTime).toBeCloseTo(10 + 2 * SNAP_RADIUS, 6)
      expect(peak.region.regions[0].outBeatTime).toBeCloseTo(30 + 2 * SNAP_RADIUS, 6)
      expect(peak.warp.beatAnchors.find(a => a.id === 1)?.time).toBeCloseTo(10 + 2 * SNAP_RADIUS, 6)
      expect(peak.warp.beatAnchors.find(a => a.id === 2)?.time).toBeCloseTo(30 + 2 * SNAP_RADIUS, 6)
    }

    // Pixel-by-pixel backward: +2R → −2R (so 4*R frames at −1 cumulative).
    // Crosses snap radius of clipin (origin) around the middle frames.
    for (let cum = 2 * SNAP_RADIUS - 1; cum >= -2 * SNAP_RADIUS; cum--) {
      store.dispatch(commitClipoutPan({ id: 'r', delta: cum, altKey: false }))
    }

    // End: cumulative delta = −2*SNAP_RADIUS → clipout = [6, 26] (well past
    // snap radius of clipin on the other side, so snap should NOT be holding).
    const end = store.getState()
    expect(end.region.regions[0].inBeatTime).toBeCloseTo(10 - 2 * SNAP_RADIUS, 6)
    expect(end.region.regions[0].outBeatTime).toBeCloseTo(30 - 2 * SNAP_RADIUS, 6)
    // Both anchors must have followed all the way — NOT been left at any
    // intermediate position when snap engaged mid-drag.
    expect(end.warp.beatAnchors.find(a => a.id === 1)?.time).toBeCloseTo(10 - 2 * SNAP_RADIUS, 6)
    expect(end.warp.beatAnchors.find(a => a.id === 2)?.time).toBeCloseTo(30 - 2 * SNAP_RADIUS, 6)
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
