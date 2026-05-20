/**
 * Behavioral regression: when a clipout edge is conformed to a beat anchor
 * (orig sits on clipin edge AND beat sits on clipout edge → MirrorPair
 * active), a clipout edge drag that snaps to grid MUST keep the beat
 * anchor in lockstep with the snapped clipout edge — across every
 * incremental frame of the drag, not just at the end.
 *
 * Symptom of the bug: clipout edge snaps to grid mark, beat anchor follows
 * the raw cursor → they desync by the snap correction.
 */

import { describe, it, expect } from 'vitest'
import { makeStore } from '../../helpers/setup'
import { addRegion, setActiveRegionId } from '../../../src/store/slices/regionSlice'
import { addAnchor } from '../../../src/store/slices/warpSlice'
import { beginDrag, drag, endDrag } from '../../../src/store/thunks/dragThunks'
import type { Region } from '../../../src/types'

function setup(): ReturnType<typeof makeStore> {
  const store = makeStore()
  // Default-linked clip [10, 30] — clipin = clipout = [10, 30].
  const region: Region = {
    id: 'r', name: 'r',
    inPoint: 10, outPoint: 30,
    inBeatTime: 10, outBeatTime: 30, defaultLinked: true,
    bpm: 120, lockedBeats: 40,
    minStretch: 0.5, maxStretch: 2.0,
  }
  store.dispatch(addRegion(region))
  store.dispatch(setActiveRegionId('r'))
  // Conformed anchor at the OUT edge: orig=30, beat=30. Both coincidences
  // hold → buildGraphFromSlice installs MirrorPair on (anchor-out ↔ clipout.out).
  store.dispatch(addAnchor({ id: 1, time: 30 }))
  return store
}

describe('Conformed clipout out-edge drag: beat anchor stays aligned with snapped edge', () => {
  it('drag the out-edge in 0.1 increments through the grid: anchor === edge at every frame', () => {
    const store = setup()

    // Begin a CLIP_EDGE_DRAG profile drag on the clipout out-edge.
    // pxPerUnit=16 → buildGestureSnapTarget threshold = 8/16 = 0.5.
    // grid interval=1 (integer marks). For each cursor position X, the
    // snap pulls the edge to round(X) when |X - round(X)| ≤ 0.5.
    store.dispatch(beginDrag({
      handle: { kind: 'clip-out-edge', clipId: 'r', space: 'beat' },
      pxPerUnit: 16,
      grid: { interval: 1, offset: 0 },
    }))

    // Drag in 0.1 increments from cursor delta +0.1 up to +2.0 (out-edge
    // sweeps from 30.1 → 32.0). The pre-drag baseline is out-edge=30; the
    // profile's onDrag emits SetEdge with value = preDrag + delta.
    const NUM_STEPS = 20
    for (let i = 1; i <= NUM_STEPS; i++) {
      const delta = i * 0.1
      store.dispatch(drag({ delta, modifiers: { alt: false } }))
      const s = store.getState()
      const r = s.region.regions[0]
      const beat = s.warp.beatAnchors.find(a => a.id === 1)!.time
      // INVARIANT: the conformed beat anchor must equal the clipout edge
      // at every frame of the drag, regardless of how the edge moved
      // (snap-restricted or free).
      expect(beat, `frame ${i} (delta=${delta}): beat anchor must equal clipout out-edge`)
        .toBeCloseTo(r.outBeatTime, 6)
    }

    store.dispatch(endDrag())

    // Final sanity: end state matches at last frame.
    const end = store.getState()
    expect(end.warp.beatAnchors.find(a => a.id === 1)!.time)
      .toBeCloseTo(end.region.regions[0].outBeatTime, 6)
  })

  it('drag reverses: anchor still tracks the snapped edge on the way back', () => {
    const store = setup()
    store.dispatch(beginDrag({
      handle: { kind: 'clip-out-edge', clipId: 'r', space: 'beat' },
      pxPerUnit: 16,
      grid: { interval: 1, offset: 0 },
    }))

    // Forward then back. Cumulative delta goes +0.1 … +2.0 … +1.9 … 0.
    const positions: number[] = []
    for (let i = 1; i <= 20; i++) positions.push(i * 0.1)
    for (let i = 19; i >= 0; i--) positions.push(i * 0.1)

    for (const delta of positions) {
      store.dispatch(drag({ delta, modifiers: { alt: false } }))
      const s = store.getState()
      const r = s.region.regions[0]
      const beat = s.warp.beatAnchors.find(a => a.id === 1)!.time
      expect(beat, `delta=${delta}: beat tracks edge`)
        .toBeCloseTo(r.outBeatTime, 6)
    }

    store.dispatch(endDrag())
  })
})
