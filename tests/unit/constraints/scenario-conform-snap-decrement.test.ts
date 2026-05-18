/**
 * Decrement clipout in small steps past the snap radius and observe how
 * anchor-in, anchor-out, clipin, and clipout evolve at each frame.
 *
 * Setup: default-linked region [10, 20], default anchor (linked) at 10.
 * Snap radius = 4. Step = SR/4 = 1. Total decrement = SR*1.5 = 6.
 * Six frames at cum = -1, -2, ..., -6.
 *
 * Expected behavior (with current model):
 *   Steps 1–4 (cum −1…−4, |cum| ≤ SR): snap holds clipout at [10,20].
 *     Anchors stay at orig=10, beat=10. Clipin unchanged.
 *   Steps 5–6 (cum ≤ −SR exclusive): snap releases. clipout follows the
 *     cursor. MirrorPair stays installed (clipout still coincides with the
 *     beat anchor that's following along), so the beat anchor follows the
 *     clipout. Orig anchor stays at 10 (clipout drag doesn't affect orig).
 *     Clipin stays at [10, 20].
 */

import { describe, it, expect } from 'vitest'
import { makeStore } from '../../helpers/setup'
import { addRegion } from '../../../src/store/slices/regionSlice'
import { addAnchor } from '../../../src/store/slices/warpSlice'
import { commitClipoutPan } from '../../../src/store/thunks/clipoutThunks'
import { dragStart } from '../../../src/store/slices/dragSlice'
import { snapshotPreDragState } from '../../../src/store/thunks/dragThunks'
import { setSnapInstall } from '../../../src/store/slices/dragCtxSlice'
import { regionInId, regionOutId } from '../../../src/constraints/ids'
import type { Region } from '../../../src/types'

describe('Clipout body decrement past snap radius — per-frame position trace', () => {

  it('region [10,20] + anchor at 10: decrement by SR/4 to SR*1.5', () => {
    const SR = 4              // snap radius
    const STEP = SR / 4       // 1
    const STEPS = Math.ceil(SR * 1.5 / STEP)  // 6 frames

    const store = makeStore()
    const region: Region = {
      id: 'r', name: 'r', inPoint: 10, outPoint: 20,
      inBeatTime: 10, outBeatTime: 20, defaultLinked: true,
      bpm: 120, lockedBeats: 20,
      minStretch: 0.5, maxStretch: 2.0, addToEnd: false,
    }
    store.dispatch(addRegion(region))
    store.dispatch(addAnchor({ id: 1, time: 10 }))    // linked, orig=beat=10

    // Body snap on clipout with clipin edges as targets.
    store.dispatch(setSnapInstall({
      entityId:  regionOutId('r'),
      field:     'in',
      threshold: SR,
      mode:      'body',
      targets: [
        { entityId: regionInId('r'), field: 'in'  },
        { entityId: regionInId('r'), field: 'out' },
      ],
    }))
    store.dispatch(dragStart(snapshotPreDragState(store.getState())))

    // Per-frame expectations under CURRENT body-snap behavior:
    //   • Steps 1–4 (|cum| ≤ SR): snap holds clipout at clipin → no change.
    //   • Step 5 (|cum| = 5 > SR): snap releases (in-edge distance 5 > 4).
    //     Clipout follows cursor to [5,15]. Beat anchor follows via MirrorPair.
    //   • Step 6 (|cum| = 6): CROSS-EDGE body snap engages — clipout.out=14
    //     is within SR=4 of clipin.in=10 (distance 4). Body snap shifts
    //     clipout by −4 → clipout=[0,10] (abut: clipout.out meets clipin.in).
    //     Beat anchor follows clipout to 0.
    const expectedByStep: Array<{
      cum: number
      orig: number
      beat: number
      clipin: [number, number]
      clipout: [number, number]
    }> = [
      { cum: -1, orig: 10, beat: 10, clipin: [10, 20], clipout: [10, 20] },
      { cum: -2, orig: 10, beat: 10, clipin: [10, 20], clipout: [10, 20] },
      { cum: -3, orig: 10, beat: 10, clipin: [10, 20], clipout: [10, 20] },
      { cum: -4, orig: 10, beat: 10, clipin: [10, 20], clipout: [10, 20] },
      { cum: -5, orig: 10, beat: 5,  clipin: [10, 20], clipout: [5, 15]  },
      { cum: -6, orig: 10, beat: 0,  clipin: [10, 20], clipout: [0, 10]  },
    ]

    for (let i = 0; i < STEPS; i++) {
      const cum = -(i + 1) * STEP
      store.dispatch(commitClipoutPan({ id: 'r', delta: cum, altKey: false }))

      const s = store.getState()
      const r = s.region.regions[0]
      const orig = s.warp.origAnchors.find(a => a.id === 1)!.time
      const beat = s.warp.beatAnchors.find(a => a.id === 1)!.time
      const exp = expectedByStep[i]
      const label = `step ${i + 1} (cum=${cum})`

      expect(orig,         `${label} orig`).toBeCloseTo(exp.orig, 6)
      expect(beat,         `${label} beat`).toBeCloseTo(exp.beat, 6)
      expect(r.inPoint,    `${label} clipin.in`).toBeCloseTo(exp.clipin[0], 6)
      expect(r.outPoint,   `${label} clipin.out`).toBeCloseTo(exp.clipin[1], 6)
      expect(r.inBeatTime, `${label} clipout.in`).toBeCloseTo(exp.clipout[0], 6)
      expect(r.outBeatTime,`${label} clipout.out`).toBeCloseTo(exp.clipout[1], 6)
    }
  })
})
