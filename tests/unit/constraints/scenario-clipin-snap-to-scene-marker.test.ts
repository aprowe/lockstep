/**
 * Drag the clipin in-edge toward a scene marker in 0.5-unit steps inside the
 * snap radius, using the full replay model (beginReplayFrame + dispatchPipelinedReplay).
 *
 * Setup: scene marker at t=10. Default-linked region [10,20]. SR=4.
 * Six frames stepping from 9.5 down to 7.0 (step -0.5). Every proposed
 * value is within SR=4 of the scene marker at 10, so the edge snap fires
 * each frame and holds clipin.in at 10. clipout stays at [10,20] throughout.
 */

import { describe, it, expect } from 'vitest'
import { makeStore, makeVideoInfo } from '../../helpers/setup'
import { addRegion } from '../../../src/store/slices/regionSlice'
import { addAnchor } from '../../../src/store/slices/warpSlice'
import { setVideo } from '../../../src/store/slices/videoSlice'
import { setCuts } from '../../../src/store/slices/sceneSlice'
import {
  dispatchPipelinedReplay,
  beginReplayFrame,
} from '../../../src/constraints/pipelineDispatch'
import { dragStart } from '../../../src/store/slices/dragSlice'
import { snapshotPreDragState } from '../../../src/store/thunks/dragThunks'
import { setSnapInstall } from '../../../src/store/slices/dragCtxSlice'
import { regionInId } from '../../../src/constraints/ids'
import { OpKind } from '../../../src/constraints'
import type { Region } from '../../../src/types'

describe('Drag clipin in-edge inside snap radius of scene marker: snap holds at every step', () => {

  it('scene marker at 10, region [10,20], step in-edge 9.5→7.0 by -0.5 (SR=4): holds at [10,20]', () => {
    const SR   = 4
    const VIDEO_PATH = '/test/video.mp4'

    const store = makeStore()

    store.dispatch(setVideo(makeVideoInfo({ path: VIDEO_PATH })))
    store.dispatch(setCuts({ path: VIDEO_PATH, cuts: [10], threshold: 0.4 }))

    const region: Region = {
      id: 'r', name: 'r', inPoint: 10, outPoint: 20,
      inBeatTime: 10, outBeatTime: 20, defaultLinked: true,
      bpm: 120, lockedBeats: 20,
      minStretch: 0.5, maxStretch: 2.0,
    }
    store.dispatch(addRegion(region))
    store.dispatch(addAnchor({ id: 1, time: 10 }))

    store.dispatch(setSnapInstall({
      entityId:  regionInId('r'),
      field:     'in',
      threshold: SR,
      mode:      'edge',
      targets:   [{ entityId: 'scene:0', field: 'time' }],
    }))
    store.dispatch(dragStart(snapshotPreDragState(store.getState())))

    // Step from 9.5 down to 7.0 — all within SR=4 of the scene marker at 10.
    const targets = [9.5, 9.0, 8.5, 8.0, 7.5, 7.0]

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

      expect(r.inPoint,     `${label} clipin.in`).toBeCloseTo(10, 6)
      expect(r.outPoint,    `${label} clipin.out`).toBeCloseTo(20, 6)
      expect(r.inBeatTime,  `${label} clipout.in`).toBeCloseTo(10, 6)
      expect(r.outBeatTime, `${label} clipout.out`).toBeCloseTo(20, 6)

      // Snap target (scene marker) must not be tugged by the snap restriction.
      expect(s.scene.cutsByPath[VIDEO_PATH], `${label} scene marker`).toEqual([10])
      // Anchor at id=1 (orig=10, beat=10) must remain unchanged.
      expect(s.warp.origAnchors[0].time, `${label} orig anchor`).toBeCloseTo(10, 6)
      expect(s.warp.beatAnchors[0].time, `${label} beat anchor`).toBeCloseTo(10, 6)
    }
  })
})
