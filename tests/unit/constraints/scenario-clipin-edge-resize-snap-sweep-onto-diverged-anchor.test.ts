/**
 * Sweep clipin in-edge across the snap radius of a DIVERGED anchor in 0.1
 * increments, using the full replay model. At every step within SR of the
 * orig anchor, the edge snaps to the anchor's orig time and clipout conforms
 * to the beat anchor's time.
 *
 * Setup: anchor orig=5, beat=4 (diverged). Default-linked region [10, 20].
 * Snap: regionInId('r').in → anchor:in:1, threshold SR=4.
 * Sweep: in-edge target from (5 - SR) to (5 + SR) in steps of 0.1.
 * Expected at every frame: clipin = (5, 20), clipout = (4, 20). Anchors stay.
 */

import { describe, it, expect } from 'vitest'
import { makeStore, makeVideoInfo } from '../../helpers/setup'
import { addRegion } from '../../../src/store/slices/regionSlice'
import { addAnchor, moveBeatAnchor } from '../../../src/store/slices/warpSlice'
import { setVideo } from '../../../src/store/slices/videoSlice'
import {
  dispatchPipelinedReplay,
  beginReplayFrame,
} from '../../../src/constraints/pipelineDispatch'
import { dragStart } from '../../../src/store/slices/dragSlice'
import { snapshotPreDragState } from '../../../src/store/thunks/dragThunks'
import { setSnapInstall } from '../../../src/store/slices/dragCtxSlice'
import { regionInId, anchorInId } from '../../../src/constraints/ids'
import { OpKind } from '../../../src/constraints'
import type { Region } from '../../../src/types'

describe('Sweep clipin in-edge across snap radius of diverged anchor', () => {

  it('anchor [orig=5, beat=4], region [10,20], SR=4: every step in [1, 9] snaps to 5 and clipout conforms to (4, 20)', () => {
    const SR = 4
    const VIDEO_PATH = '/test/video.mp4'

    const store = makeStore()
    store.dispatch(setVideo(makeVideoInfo({ path: VIDEO_PATH })))

    const region: Region = {
      id: 'r', name: 'r', inPoint: 10, outPoint: 20,
      inBeatTime: 10, outBeatTime: 20, defaultLinked: true,
      bpm: 120, lockedBeats: 20,
      minStretch: 0.5, maxStretch: 2.0,
    }
    store.dispatch(addRegion(region))
    store.dispatch(addAnchor({ id: 1, time: 5 }))
    store.dispatch(moveBeatAnchor({ id: 1, time: 4 }))

    store.dispatch(setSnapInstall({
      entityId:  regionInId('r'),
      field:     'in',
      threshold: SR,
      mode:      'edge',
      targets:   [{ entityId: anchorInId(1), field: 'time' }],
    }))
    store.dispatch(dragStart(snapshotPreDragState(store.getState())))

    // Build targets: 5 - SR through 5 + SR in 0.1 increments.
    const targets: number[] = []
    for (let i = 0; i <= 80; i++) {
      targets.push(Number(((5 - SR) + i * 0.1).toFixed(2)))
    }

    for (const target of targets) {
      store.dispatch((dispatch, getState) => beginReplayFrame(dispatch, getState))
      store.dispatch((dispatch, getState) => {
        dispatchPipelinedReplay(dispatch, getState, {
          kind:  OpKind.SetEdge,
          id:    regionInId('r'),
          edge:  'in',
          value: target,
        })
      })

      const s = store.getState()
      const r = s.region.regions[0]
      const label = `in-edge target=${target}`

      // Within SR of 5 → snap holds. clipin.in = 5 every frame.
      expect(r.inPoint,     `${label} clipin.in`).toBeCloseTo(5, 6)
      expect(r.outPoint,    `${label} clipin.out`).toBeCloseTo(20, 6)
      // Conform fires (clipin.in lands on orig=5) → clipout.in = beat=4.
      expect(r.inBeatTime,  `${label} clipout.in`).toBeCloseTo(4, 6)
      expect(r.outBeatTime, `${label} clipout.out`).toBeCloseTo(20, 6)

      // Anchors must not be tugged — neither by snap nor by conform.
      expect(s.warp.origAnchors[0].time, `${label} orig anchor`).toBeCloseTo(5, 6)
      expect(s.warp.beatAnchors[0].time, `${label} beat anchor`).toBeCloseTo(4, 6)
    }
  })
})
