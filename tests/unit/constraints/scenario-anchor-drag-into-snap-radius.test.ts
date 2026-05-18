/**
 * Drag the orig anchor toward clipin.in while inside the snap radius.
 *
 * Setup: region [10, 40] (default-linked, both spaces coincide at the
 * 'in' edge). Linked anchor at orig=beat=10 (sits on clipin.in).
 * SR=4, step=1. Move orig from 10 → 9 → 8 (cumulative −1, then −2).
 *
 * Snap target for anchor-in drag: clipin.in (per the snap rules:
 * `anchor-in → clipin`). Both proposed positions (9, 8) are within
 * radius of clipin.in=10, so snap should hold the orig anchor at 10.
 *
 * Expected per frame: orig stays at 10, beat stays at 10, clipin stays
 * at [10, 40], clipout stays at [10, 40].
 */

import { describe, it, expect } from 'vitest'
import { makeStore } from '../../helpers/setup'
import { addRegion } from '../../../src/store/slices/regionSlice'
import { addAnchor } from '../../../src/store/slices/warpSlice'
import { applyAnchorEntityMove } from '../../../src/store/thunks/entityWriteThunks'
import { dragStart } from '../../../src/store/slices/dragSlice'
import { snapshotPreDragState } from '../../../src/store/thunks/dragThunks'
import { setSnapInstall } from '../../../src/store/slices/dragCtxSlice'
import { anchorInId, regionInId } from '../../../src/constraints/ids'
import type { Region } from '../../../src/types'

describe('Drag orig anchor inside snap radius of clipin.in: snap holds, nothing changes', () => {

  it('region [10,40], anchor at 10, drag orig from 10 to 8 (steps of 1)', () => {
    const SR = 4
    const store = makeStore()
    const region: Region = {
      id: 'r', name: 'r', inPoint: 10, outPoint: 40,
      inBeatTime: 10, outBeatTime: 40, defaultLinked: true,
      bpm: 120, lockedBeats: 60,
      minStretch: 0.5, maxStretch: 2.0, addToEnd: false,
    }
    store.dispatch(addRegion(region))
    store.dispatch(addAnchor({ id: 1, time: 10 }))    // linked, orig=beat=10

    // Snap on orig anchor; target = clipin.in (per the snap rule `anchor-in → clipin`).
    store.dispatch(setSnapInstall({
      entityId:  anchorInId(1),
      field:     'time',
      threshold: SR,
      targets:   [{ entityId: regionInId('r'), field: 'in' }],
    }))
    store.dispatch(dragStart(snapshotPreDragState(store.getState())))

    type Expected = { label: string; orig: number; beat: number; clipin: [number, number]; clipout: [number, number] }
    const expectedByStep: Expected[] = [
      // Frame 1: cursor at orig=9. Within SR=4 of clipin.in=10 → snap holds.
      { label: 'frame 1 (cursor 9)', orig: 10, beat: 10, clipin: [10, 40], clipout: [10, 40] },
      // Frame 2: cursor at orig=8. Within SR=4 of clipin.in=10 → snap holds.
      { label: 'frame 2 (cursor 8)', orig: 10, beat: 10, clipin: [10, 40], clipout: [10, 40] },
    ]
    const cursorTargets = [9, 8]

    for (let i = 0; i < cursorTargets.length; i++) {
      store.dispatch(applyAnchorEntityMove({ entityId: anchorInId(1), time: cursorTargets[i] }))

      const s = store.getState()
      const r = s.region.regions[0]
      const orig = s.warp.origAnchors.find(a => a.id === 1)!.time
      const beat = s.warp.beatAnchors.find(a => a.id === 1)!.time
      const exp = expectedByStep[i]

      expect(orig,          `${exp.label} orig`).toBeCloseTo(exp.orig, 6)
      expect(beat,          `${exp.label} beat`).toBeCloseTo(exp.beat, 6)
      expect(r.inPoint,     `${exp.label} clipin.in`).toBeCloseTo(exp.clipin[0], 6)
      expect(r.outPoint,    `${exp.label} clipin.out`).toBeCloseTo(exp.clipin[1], 6)
      expect(r.inBeatTime,  `${exp.label} clipout.in`).toBeCloseTo(exp.clipout[0], 6)
      expect(r.outBeatTime, `${exp.label} clipout.out`).toBeCloseTo(exp.clipout[1], 6)
    }
  })
})
