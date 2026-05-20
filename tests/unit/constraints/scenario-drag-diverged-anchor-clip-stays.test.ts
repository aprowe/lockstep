/**
 * Regression: dragging the WARP CONNECTOR of a diverged anchor by less than
 * the snap radius — when the orig is sitting on a clip edge — must leave
 * EVERYTHING unchanged. The snap holds the anchor pair in place and the
 * clip is not dragged with it.
 *
 * Setup:
 *   - Default-linked clip [10, 20]  (clipin = clipout = [10, 20])
 *   - Anchor pair: orig=10 (on clipin.in), beat=15 (NOT on clipout.in=10)
 *
 * Action: drag the warp connector by +0.3 (< snap radius 0.5 at pxPerUnit=16).
 *
 * Expected: nothing changes — clip unchanged, anchor unchanged.
 */

import { describe, it, expect } from 'vitest'
import { makeStore } from '../../helpers/setup'
import { addRegion, setActiveRegionId } from '../../../src/store/slices/regionSlice'
import { addAnchor, moveBeatAnchor, setSelectedOrigIds, setSelectedBeatIds } from '../../../src/store/slices/warpSlice'
import { beginDrag, drag, endDrag } from '../../../src/store/thunks/dragThunks'
import type { Region } from '../../../src/types'

function setup(): ReturnType<typeof makeStore> {
  const store = makeStore()
  const region: Region = {
    id: 'r', name: 'r',
    inPoint: 10, outPoint: 20,
    inBeatTime: 10, outBeatTime: 20, defaultLinked: true,
    bpm: 120, lockedBeats: 20,
    minStretch: 0.5, maxStretch: 2.0,
  }
  store.dispatch(addRegion(region))
  store.dispatch(setActiveRegionId('r'))
  // Diverged anchor: orig=10 (on clipin.in), beat=15 (NOT on clipout.in=10).
  store.dispatch(addAnchor({ id: 1, time: 10 }))
  store.dispatch(moveBeatAnchor({ id: 1, time: 15 }))
  return store
}

describe('Dragging a warp connector for a diverged anchor within snap radius: nothing changes', () => {
  it('drag connector by +0.3 (< snap radius): clip and anchor pair both stay put', () => {
    const store = setup()

    // Snapshot EVERYTHING before the drag.
    const before = store.getState().region.regions[0]
    const beforeOrig = store.getState().warp.origAnchors.find(a => a.id === 1)!.time
    const beforeBeat = store.getState().warp.beatAnchors.find(a => a.id === 1)!.time

    store.dispatch(beginDrag({
      handle: { kind: 'pair-drag', pairId: 1 },
      pxPerUnit: 16,
    }))
    store.dispatch(drag({ delta: 0.3, modifiers: { alt: false } }))
    store.dispatch(endDrag())

    const s = store.getState()
    const r = s.region.regions[0]
    expect(r.inPoint,     'clipin.in unchanged').toBeCloseTo(before.inPoint, 6)
    expect(r.outPoint,    'clipin.out unchanged').toBeCloseTo(before.outPoint, 6)
    expect(r.inBeatTime,  'clipout.in unchanged').toBeCloseTo(before.inBeatTime, 6)
    expect(r.outBeatTime, 'clipout.out unchanged').toBeCloseTo(before.outBeatTime, 6)

    const orig = s.warp.origAnchors.find(a => a.id === 1)!
    const beat = s.warp.beatAnchors.find(a => a.id === 1)!
    expect(orig.time, 'orig anchor unchanged (snap held it)').toBeCloseTo(beforeOrig, 6)
    expect(beat.time, 'beat anchor unchanged').toBeCloseTo(beforeBeat, 6)
  })

  it('lasso anchor-in + anchor-out, drag the ORIG anchor by +0.3: still a no-op', () => {
    const store = setup()
    // Lasso both spaces of the pair → lasso TranslateGroup `lasso:main`
    // installs over [anchor-in:1, anchor-out:1]. Now dragging anchor-in
    // (input-space anchor handle) should pull anchor-out along via the
    // lasso group — the same way the warp connector pair-drag does.
    store.dispatch(setSelectedOrigIds([1]))
    store.dispatch(setSelectedBeatIds([1]))

    const before = store.getState().region.regions[0]
    const beforeOrig = store.getState().warp.origAnchors.find(a => a.id === 1)!.time
    const beforeBeat = store.getState().warp.beatAnchors.find(a => a.id === 1)!.time

    store.dispatch(beginDrag({
      handle: { kind: 'anchor-drag', anchorId: 1, space: 'input' },
      pxPerUnit: 16,
    }))
    store.dispatch(drag({ delta: 0.3, modifiers: { alt: false } }))
    store.dispatch(endDrag())

    const s = store.getState()
    const r = s.region.regions[0]
    expect(r.inPoint,     'clipin.in unchanged').toBeCloseTo(before.inPoint, 6)
    expect(r.outPoint,    'clipin.out unchanged').toBeCloseTo(before.outPoint, 6)
    expect(r.inBeatTime,  'clipout.in unchanged').toBeCloseTo(before.inBeatTime, 6)
    expect(r.outBeatTime, 'clipout.out unchanged').toBeCloseTo(before.outBeatTime, 6)

    const orig = s.warp.origAnchors.find(a => a.id === 1)!
    const beat = s.warp.beatAnchors.find(a => a.id === 1)!
    expect(orig.time, 'orig anchor unchanged (snap held it)').toBeCloseTo(beforeOrig, 6)
    expect(beat.time, 'beat anchor unchanged').toBeCloseTo(beforeBeat, 6)
  })
})
