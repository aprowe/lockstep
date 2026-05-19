/**
 * Regression: when dragging a default-linked clipin in-edge that is snapped to a
 * scene marker, clipout (beat-space) must mirror the SNAPPED value, not the raw
 * proposed value.
 *
 * Setup: scene marker at t=10. Region [10,20], defaultLinked. SR=4.
 * Op: applyUpdateRegionInOut({ id:'r', inPoint:7, outPoint:20 }).
 *
 * The snap restricts clipin.in to 10. MirrorEdge propagates 10 → clipout.in.
 * Bug (pre-fix): the explicit clipout dispatch in applyUpdateRegionInOut uses
 * next.inPoint=7 (pre-snap), overwriting clipout.in back to 7.
 */

import { describe, it, expect } from 'vitest'
import { makeStore, makeVideoInfo } from '../../helpers/setup'
import { addRegion } from '../../../src/store/slices/regionSlice'
import { addAnchor } from '../../../src/store/slices/warpSlice'
import { setVideo } from '../../../src/store/slices/videoSlice'
import { setCuts } from '../../../src/store/slices/sceneSlice'
import { dragStart } from '../../../src/store/slices/dragSlice'
import { snapshotPreDragState } from '../../../src/store/thunks/dragThunks'
import { setSnapInstall } from '../../../src/store/slices/dragCtxSlice'
import { regionInId } from '../../../src/constraints/ids'
import { applyUpdateRegionInOut } from '../../../src/store/thunks/entityWriteThunks'
import type { Region } from '../../../src/types'

describe('applyUpdateRegionInOut with snap: clipout must mirror snapped value', () => {

  it('default-linked region [10,20], marker at 10, SR=4: moving in-edge to 7 keeps clipout at [10,20]', () => {
    const SR = 4
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

    store.dispatch(applyUpdateRegionInOut({ id: 'r', inPoint: 7, outPoint: 20 }))

    const s = store.getState()
    const r = s.region.regions[0]

    expect(r.inPoint,     'clipin.in').toBeCloseTo(10, 6)
    expect(r.outPoint,    'clipin.out').toBeCloseTo(20, 6)
    expect(r.inBeatTime,  'clipout.in').toBeCloseTo(10, 6)
    expect(r.outBeatTime, 'clipout.out').toBeCloseTo(20, 6)

    // Snap target (scene marker) must not be tugged.
    expect(s.scene.cutsByPath[VIDEO_PATH]).toEqual([10])
    // Anchor at id=1 (orig=10, beat=10) must remain unchanged.
    expect(s.warp.origAnchors[0].time, 'orig anchor').toBeCloseTo(10, 6)
    expect(s.warp.beatAnchors[0].time, 'beat anchor').toBeCloseTo(10, 6)
  })
})
