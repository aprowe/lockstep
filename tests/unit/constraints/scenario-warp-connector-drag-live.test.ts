/**
 * Warp-connector drag (pair drag) must update BOTH orig and beat anchors per
 * pointer-event frame — same live behavior as a lassoed orig-anchor drag,
 * not deferred to pointerUp.
 *
 * Controller (after the recent change) emits only the orig anchorEntityMove
 * each frame; the orig→beat DirectedPair installed by initAnchorPair carries
 * the same delta to the beat partner inside the resolver. Slice should
 * reflect both positions after each frame's dispatch.
 */

import { describe, it, expect } from 'vitest'
import { makeStore } from '../../helpers/setup'
import { addAnchor, moveBeatAnchor } from '../../../src/store/slices/warpSlice'
import { applyAnchorEntityMove } from '../../../src/store/thunks/entityWriteThunks'
import { dragStart } from '../../../src/store/slices/dragSlice'
import { snapshotPreDragState } from '../../../src/store/thunks/dragThunks'
import { setSnapInstall, setLassoIds } from '../../../src/store/slices/dragCtxSlice'
import { anchorInId, anchorOutId } from '../../../src/constraints/ids'
import {
  beginReplayFrame,
} from '../../../src/constraints/pipelineDispatch'

describe('Warp-connector drag: live per-frame propagation to beat partner', () => {

  it('linked anchor [orig=10, beat=10] → 6 frames of orig=11..16 carries beat to 11..16 live', () => {
    const store = makeStore()
    store.dispatch(addAnchor({ id: 1, time: 10 }))

    store.dispatch(dragStart(snapshotPreDragState(store.getState())))

    const targets = [11, 12, 13, 14, 15, 16]
    for (const target of targets) {
      store.dispatch((dispatch, getState) => beginReplayFrame(dispatch, getState))
      store.dispatch(applyAnchorEntityMove({ entityId: 'a1-in', time: target }))

      const s = store.getState()
      expect(s.warp.origAnchors.find(a => a.id === 1)?.time).toBeCloseTo(target, 6)
      expect(s.warp.beatAnchors.find(a => a.id === 1)?.time).toBeCloseTo(target, 6)
    }
  })

  it('UNLINKED pair: warp-line drag must still carry beat live (via pair TranslateGroup)', () => {
    // Repro of the production bug: dragging a warp connector for an unlinked
    // pair only updated at pointerUp. The fix is to install a pair-wide
    // TranslateGroup at dragStart (via dragCtx.lassoIds) so the beat partner
    // tracks orig regardless of link state — same path the lassoed pair
    // drag uses.
    const store = makeStore()
    store.dispatch(addAnchor({ id: 1, time: 10 }))
    // Unlink the pair by moving beat to a diverged time.
    store.dispatch(moveBeatAnchor({ id: 1, time: 30 }))
    expect(store.getState().warp.beatAnchors[0].linked).toBe(false)

    store.dispatch(dragStart(snapshotPreDragState(store.getState())))
    // Simulate the CanvasTimeline dragStart handler installing the pair
    // TranslateGroup (lasso:main) for isPair drags.
    store.dispatch(setLassoIds([anchorInId(1), anchorOutId(1)]))

    for (const target of [11, 12, 13, 14]) {
      store.dispatch((dispatch, getState) => beginReplayFrame(dispatch, getState))
      store.dispatch(applyAnchorEntityMove({ entityId: 'a1-in', time: target }))

      const s = store.getState()
      const expectedBeat = 30 + (target - 10)
      expect(s.warp.origAnchors.find(a => a.id === 1)?.time, `orig target=${target}`).toBeCloseTo(target, 6)
      expect(s.warp.beatAnchors.find(a => a.id === 1)?.time, `beat target=${target}`).toBeCloseTo(expectedBeat, 6)
    }
  })

  it('with SnapTarget installed on orig (warp-line gesture): beat still updates live', () => {
    const store = makeStore()
    store.dispatch(addAnchor({ id: 1, time: 10 }))
    store.dispatch(addAnchor({ id: 2, time: 30 })) // a snap target

    // Mirror what the warp-line pointerDown installs:
    store.dispatch(setSnapInstall({
      entityId:  anchorInId(1),
      field:     'time',
      threshold: 4,
      mode:      'edge',
      targets:   [{ entityId: anchorInId(2), field: 'time' }],
    }))
    store.dispatch(dragStart(snapshotPreDragState(store.getState())))

    // Drag orig toward 14 (outside snap radius of 30): expect both orig and
    // beat at 14 each frame.
    for (const target of [11, 12, 13, 14]) {
      store.dispatch((dispatch, getState) => beginReplayFrame(dispatch, getState))
      store.dispatch(applyAnchorEntityMove({ entityId: 'a1-in', time: target }))

      const s = store.getState()
      const label = `target=${target}`
      expect(s.warp.origAnchors.find(a => a.id === 1)?.time, `${label} orig`).toBeCloseTo(target, 6)
      expect(s.warp.beatAnchors.find(a => a.id === 1)?.time, `${label} beat`).toBeCloseTo(target, 6)
    }
  })
})
