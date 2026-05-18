/**
 * Repro: dragging a clipin (region-in) across a DIVERGED anchor should make
 * the clipout edge jump to the paired BEAT anchor's beat-time when the
 * clipin lands on the orig anchor. This is the "linking event" — committed
 * via applyRegionEntityMove's post-move detection in entityWriteThunks.
 *
 * For a LINKED anchor (orig = beat), there's no visible jump because the
 * clipout cascades to clipin via defaultlink and beat = orig anyway.
 *
 * For a DIVERGED anchor (orig != beat), clipout should jump from the
 * cascaded value to the beat anchor's time when conform engages.
 */

import { describe, it, expect } from 'vitest'
import { makeStore } from '../../helpers/setup'
import { addRegion } from '../../../src/store/slices/regionSlice'
import { addAnchor, moveBeatAnchor } from '../../../src/store/slices/warpSlice'
import { applyRegionEntityMove } from '../../../src/store/thunks/entityWriteThunks'
import { dragStart } from '../../../src/store/slices/dragSlice'
import { snapshotPreDragState } from '../../../src/store/thunks/dragThunks'
import { beginReplayFrame } from '../../../src/constraints/pipelineDispatch'
import type { Region } from '../../../src/types'

function setup() {
  const store = makeStore()
  const region: Region = {
    id: 'r', name: 'r', inPoint: 10, outPoint: 30,
    inBeatTime: 10, outBeatTime: 30, defaultLinked: true,
    bpm: 120, lockedBeats: 40,
    minStretch: 0.5, maxStretch: 2.0, addToEnd: false,
  }
  store.dispatch(addRegion(region))
  // Diverged anchor: orig=20, beat=25, linked=false.
  store.dispatch(addAnchor({ id: 1, time: 20 }))
  store.dispatch(moveBeatAnchor({ id: 1, time: 25 }))
  return store
}

describe('Clipin drag onto diverged anchor: clipout conforms to beat anchor', () => {

  it('inPoint lands exactly on orig=20: clipout.in jumps to beat=25', () => {
    const store = setup()
    // Pre: region [10, 30], inBeatTime=10. Anchor diverged.
    const pre = store.getState().region.regions[0]
    expect(pre.inPoint).toBe(10)
    expect(pre.inBeatTime).toBe(10)

    // Drag clipin body so inPoint lands on 20 (orig anchor's time).
    // applyRegionEntityMove dispatches a Move with the cumulative delta from
    // drag start (delta = 20 - 10 = 10 here).
    store.dispatch(applyRegionEntityMove({ id: 'r', delta: 10 }))

    const post = store.getState().region.regions[0]
    expect(post.inPoint).toBeCloseTo(20, 6)   // clipin moved to 20
    // Conform via linking event: clipout.in should jump to beat=25.
    expect(post.inBeatTime).toBeCloseTo(25, 6)
  })

  it('inPoint passes the anchor: inPoint=22 → no conform (no coincidence)', () => {
    const store = setup()
    // Drag past the anchor (delta=12 → inPoint=22).
    store.dispatch(applyRegionEntityMove({ id: 'r', delta: 12 }))

    const post = store.getState().region.regions[0]
    expect(post.inPoint).toBeCloseTo(22, 6)
    // No conform: inBeatTime cascades to inPoint via defaultlink → 22.
    expect(post.inBeatTime).toBeCloseTo(22, 6)
  })

  it('sequential drag (default-linked): pre-anchor → on-anchor → past-anchor', () => {
    const store = setup()
    // Set preDrag so cumulative deltas resolve against the drag-start baseline,
    // matching what the controller does at pointerDown.
    store.dispatch(dragStart(snapshotPreDragState(store.getState())))

    // Frame 1: drag to inPoint=15 (before anchor at 20). No conform.
    store.dispatch(applyRegionEntityMove({ id: 'r', delta: 5 }))
    let r = store.getState().region.regions[0]
    expect(r.inPoint).toBeCloseTo(15, 6)
    expect(r.inBeatTime).toBeCloseTo(15, 6)        // cascade, no conform

    // Frame 2: drag onto anchor at orig=20. Conform fires.
    store.dispatch(applyRegionEntityMove({ id: 'r', delta: 10 }))
    r = store.getState().region.regions[0]
    expect(r.inPoint).toBeCloseTo(20, 6)
    expect(r.inBeatTime).toBeCloseTo(25, 6)        // ConformVisual → beat anchor's time

    // Frame 3: drag past the anchor to inPoint=22. Conform releases.
    store.dispatch(applyRegionEntityMove({ id: 'r', delta: 12 }))
    r = store.getState().region.regions[0]
    expect(r.inPoint).toBeCloseTo(22, 6)
    // Conform releases → defaultlink MirrorEdge cascade restores clipout to clipin.
    expect(r.inBeatTime).toBeCloseTo(22, 6)
  })

  // Fixed by beginReplayFrame: at the start of each pointer-event frame,
  // slice is reset to preDrag values. The conform-released frame sees a
  // clean baseline (clipout=preDrag), the pipeline doesn't write clipout
  // (no coincidence), so slice clipout stays at preDrag.
  it('sequential drag (DIVERGED region, no default-link): conform must also release', () => {
    // Same anchor (orig=20, beat=25), but the region is NOT default-linked.
    // Its clipout has its own independent inBeatTime/outBeatTime.
    const store = makeStore()
    const divergedRegion: Region = {
      id: 'r', name: 'r', inPoint: 10, outPoint: 30,
      // Explicit beat bounds different from input bounds → diverged.
      inBeatTime: 100, outBeatTime: 120, defaultLinked: false,
      bpm: 120, lockedBeats: 40,
      minStretch: 0.5, maxStretch: 2.0, addToEnd: false,
    }
    store.dispatch(addRegion(divergedRegion))
    store.dispatch(addAnchor({ id: 1, time: 20 }))
    store.dispatch(moveBeatAnchor({ id: 1, time: 25 }))

    store.dispatch(dragStart(snapshotPreDragState(store.getState())))

    // Helper: simulate one pointer-event frame — reset slice to preDrag
    // (the replay-frame boundary that applyIntents/CanvasTimeline does in
    // production), then dispatch the frame's thunks.
    const frame = (cumulativeDelta: number) => {
      store.dispatch((d: never, g: never) => beginReplayFrame(d, g) as never)
      store.dispatch(applyRegionEntityMove({ id: 'r', delta: cumulativeDelta }))
    }

    // Frame 1: drag to inPoint=15. No conform. clipout (diverged) unchanged.
    frame(5)
    let r = store.getState().region.regions[0]
    expect(r.inPoint).toBeCloseTo(15, 6)
    expect(r.inBeatTime).toBeCloseTo(100, 6)       // diverged — clipout independent

    // Frame 2: drag onto anchor at orig=20. ConformVisual fires (clipin write
    // coincides with orig) → writes clipout.in = beat anchor's time = 25.
    frame(10)
    r = store.getState().region.regions[0]
    expect(r.inPoint).toBeCloseTo(20, 6)
    expect(r.inBeatTime).toBeCloseTo(25, 6)        // conform engaged

    // Frame 3: drag past the anchor. beginReplayFrame resets slice clipout
    // back to preDrag (100). ConformVisual doesn't fire (clipin past orig)
    // → slice clipout stays at preDrag value.
    frame(12)
    r = store.getState().region.regions[0]
    expect(r.inPoint).toBeCloseTo(22, 6)
    expect(r.inBeatTime).toBeCloseTo(100, 6)       // restored to pre-conform diverged value
  })
})
