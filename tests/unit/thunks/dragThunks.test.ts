import { describe, it, expect } from 'vitest'
import { makeStore } from '../../helpers/setup'
import { addRegion } from '../../../src/store/slices/regionSlice'
import { addAnchor, moveBeatAnchor } from '../../../src/store/slices/warpSlice'
import { dragStart } from '../../../src/store/slices/dragSlice'
import { cancelDrag, snapshotPreDragState } from '../../../src/store/thunks/dragThunks'
import { moveRegionBounds } from '../../../src/store/thunks/regionThunks'
import type { Region } from '../../../src/types'

const makeRegion = (id: string, inPoint: number, outPoint: number): Region => ({
  id, name: id, inPoint, outPoint,
  inBeatTime: inPoint, outBeatTime: outPoint, defaultLinked: true,
  bpm: 120, minStretch: 0.5, maxStretch: 2, addToEnd: false,
})

describe('cancelDrag rollback', () => {
  it('restores regions to pre-drag bounds', () => {
    const store = makeStore()

    // Set up initial state
    store.dispatch(addRegion(makeRegion('r1', 10, 20)))
    store.dispatch(addAnchor({ id: 1, time: 5 }))

    // Snapshot pre-drag state and arm the drag
    const preDrag = snapshotPreDragState(store.getState())
    store.dispatch(dragStart(preDrag))
    expect(store.getState().drag.active).toBe(true)

    // Mutate regions during drag (middleware passes through while active)
    // Move to 12–22 (small shift that preserves span, so no clamping)
    store.dispatch(moveRegionBounds({ id: 'r1', inPoint: 12, outPoint: 22 }))

    // Verify state has changed
    const duringDrag = store.getState().region.regions.find(r => r.id === 'r1')
    expect(duringDrag?.inPoint).toBe(12)
    expect(duringDrag?.outPoint).toBe(22)

    // Cancel the drag — should restore pre-drag snapshot
    store.dispatch(cancelDrag())

    // Drag should be cleared
    expect(store.getState().drag.active).toBe(false)
    expect(store.getState().drag.preDrag).toBeNull()

    // Regions should be restored to pre-drag values
    const afterCancel = store.getState().region.regions.find(r => r.id === 'r1')
    expect(afterCancel?.inPoint).toBe(10)
    expect(afterCancel?.outPoint).toBe(20)
  })

  it('restores anchors to pre-drag positions', () => {
    const store = makeStore()
    // addAnchor creates both origAnchor and beatAnchor at same position
    store.dispatch(addAnchor({ id: 1, time: 10 }))
    store.dispatch(addAnchor({ id: 2, time: 20 }))

    const origTimes = store.getState().warp.origAnchors.map(a => ({ id: a.id, time: a.time }))
    const beatTimes = store.getState().warp.beatAnchors.map(a => ({ id: a.id, time: a.time }))

    const preDrag = snapshotPreDragState(store.getState())
    store.dispatch(dragStart(preDrag))

    // Move a beat anchor during drag
    store.dispatch(moveBeatAnchor({ id: 1, time: 99 }))
    expect(store.getState().warp.beatAnchors.find(a => a.id === 1)?.time).toBe(99)

    // Cancel restores both anchor arrays
    store.dispatch(cancelDrag())

    const restoredOrig = store.getState().warp.origAnchors.map(a => ({ id: a.id, time: a.time }))
    const restoredBeat = store.getState().warp.beatAnchors.map(a => ({ id: a.id, time: a.time }))
    expect(restoredOrig).toEqual(origTimes)
    expect(restoredBeat).toEqual(beatTimes)
  })

  it('is a no-op when no drag is active (preDrag is null)', () => {
    const store = makeStore()
    store.dispatch(addRegion(makeRegion('r1', 10, 20)))

    // cancelDrag with no active drag should not throw or change state
    const regionsBefore = store.getState().region.regions
    store.dispatch(cancelDrag())

    expect(store.getState().region.regions).toEqual(regionsBefore)
    expect(store.getState().drag.active).toBe(false)
  })
})
