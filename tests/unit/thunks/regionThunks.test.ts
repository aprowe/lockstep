import { describe, it, expect } from 'vitest'
import { addRegion, setActiveRegionId } from '../../../src/store/slices/regionSlice'
import { addAnchor, moveBeatAnchor } from '../../../src/store/slices/warpSlice'
import { setInPointToPlayhead, setOutPointToPlayhead, moveRegionBounds, moveAnchors, moveBeatAnchors } from '../../../src/store/thunks/regionThunks'
import { makeStore } from '../../helpers/setup'
import type { Region } from '../../../src/types'

const makeRegion = (id: string, inPoint: number, outPoint: number) => ({
  id, name: id, inPoint, outPoint, bpm: 120, minStretch: 0.5, maxStretch: 2, addToEnd: false as const,
})

// ── setInPointToPlayhead ──────────────────────────────────────────────────────

describe('setInPointToPlayhead', () => {
  it('no active region + playhead 50 → addRegion dispatched, region starts at 50', () => {
    const store = makeStore()
    expect(store.getState().region.activeRegionId).toBeNull()

    store.dispatch(setInPointToPlayhead({ playhead: 50, viewSpan: 100, duration: 120 }))

    const regions = store.getState().region.regions
    expect(regions).toHaveLength(1)
    expect(regions[0].inPoint).toBe(50)
    expect(regions[0].outPoint).toBe(120) // duration
  })

  it('active region (10–20) + playhead 5 (inside) → updateRegionInOut with inPoint=5', () => {
    const store = makeStore()
    store.dispatch(addRegion(makeRegion('r', 10, 20)))
    store.dispatch(setActiveRegionId('r'))

    store.dispatch(setInPointToPlayhead({ playhead: 5, viewSpan: 100, duration: 120 }))

    const regions = store.getState().region.regions
    expect(regions).toHaveLength(1)
    const r = regions[0]
    expect(r.id).toBe('r')
    expect(r.inPoint).toBe(5)
    expect(r.outPoint).toBe(20) // unchanged
  })

  it('active region (10–20) + playhead 15 (inside) → resize in-edge, not spawn', () => {
    const store = makeStore()
    store.dispatch(addRegion(makeRegion('r', 10, 20)))
    store.dispatch(setActiveRegionId('r'))

    store.dispatch(setInPointToPlayhead({ playhead: 15, viewSpan: 100, duration: 120 }))

    const regions = store.getState().region.regions
    expect(regions).toHaveLength(1)
    expect(regions[0].inPoint).toBe(15)
    expect(regions[0].outPoint).toBe(20)
  })

  it('active region (10–20) + playhead 30 (past outPoint) → spawn branch fires (addRegion)', () => {
    const store = makeStore()
    store.dispatch(addRegion(makeRegion('r', 10, 20)))
    store.dispatch(setActiveRegionId('r'))

    store.dispatch(setInPointToPlayhead({ playhead: 30, viewSpan: 100, duration: 120 }))

    const regions = store.getState().region.regions
    expect(regions).toHaveLength(2)
    // Original untouched
    const original = regions.find(r => r.id === 'r')!
    expect(original.inPoint).toBe(10)
    expect(original.outPoint).toBe(20)
    // New region starts at playhead
    const spawned = regions.find(r => r.id !== 'r')!
    expect(spawned.inPoint).toBe(30)
    // viewSpan=100 → calcNewRegionSpan=max(10, 5)=10 → outPoint=30+10=40
    expect(spawned.outPoint).toBe(40)
  })

  it('active region (10–20) + playhead 30 + next region at 35 → spawned region clamps at 35', () => {
    const store = makeStore()
    store.dispatch(addRegion(makeRegion('r', 10, 20)))
    store.dispatch(addRegion(makeRegion('r2', 35, 50)))
    store.dispatch(setActiveRegionId('r'))

    store.dispatch(setInPointToPlayhead({ playhead: 30, viewSpan: 100, duration: 120 }))

    const regions = store.getState().region.regions
    expect(regions).toHaveLength(3)
    const spawned = regions.find(r => r.id !== 'r' && r.id !== 'r2')!
    expect(spawned.inPoint).toBe(30)
    expect(spawned.outPoint).toBe(35) // clamped to next region's inPoint
  })

  it('spawn branch: new region becomes the active region', () => {
    const store = makeStore()
    store.dispatch(addRegion(makeRegion('r', 10, 20)))
    store.dispatch(setActiveRegionId('r'))

    store.dispatch(setInPointToPlayhead({ playhead: 30, viewSpan: 100, duration: 120 }))

    const activeId = store.getState().region.activeRegionId
    const spawned = store.getState().region.regions.find(r => r.id !== 'r')!
    expect(activeId).toBe(spawned.id)
  })
})

// ── setOutPointToPlayhead ─────────────────────────────────────────────────────

describe('setOutPointToPlayhead', () => {
  it('no active region + playhead 50 → addRegion dispatched, region ends at 50', () => {
    const store = makeStore()
    expect(store.getState().region.activeRegionId).toBeNull()

    store.dispatch(setOutPointToPlayhead({ playhead: 50, viewSpan: 100, duration: 120 }))

    const regions = store.getState().region.regions
    expect(regions).toHaveLength(1)
    expect(regions[0].inPoint).toBe(0)
    expect(regions[0].outPoint).toBe(50)
  })

  it('no active region + playhead 0 → outPoint is clamped to 0.1', () => {
    const store = makeStore()

    store.dispatch(setOutPointToPlayhead({ playhead: 0, viewSpan: 100, duration: 120 }))

    const regions = store.getState().region.regions
    expect(regions).toHaveLength(1)
    expect(regions[0].outPoint).toBe(0.1)
  })

  it('active region (10–20) + playhead 15 (inside) → updateRegionInOut with outPoint=15', () => {
    const store = makeStore()
    store.dispatch(addRegion(makeRegion('r', 10, 20)))
    store.dispatch(setActiveRegionId('r'))

    store.dispatch(setOutPointToPlayhead({ playhead: 15, viewSpan: 100, duration: 120 }))

    const regions = store.getState().region.regions
    expect(regions).toHaveLength(1)
    const r = regions[0]
    expect(r.id).toBe('r')
    expect(r.inPoint).toBe(10) // unchanged
    expect(r.outPoint).toBe(15)
  })

  it('active region (10–20) + playhead 5 (before inPoint) → spawn branch fires (addRegion)', () => {
    const store = makeStore()
    store.dispatch(addRegion(makeRegion('r', 10, 20)))
    store.dispatch(setActiveRegionId('r'))

    store.dispatch(setOutPointToPlayhead({ playhead: 5, viewSpan: 100, duration: 120 }))

    const regions = store.getState().region.regions
    expect(regions).toHaveLength(2)
    // Original untouched
    const original = regions.find(r => r.id === 'r')!
    expect(original.inPoint).toBe(10)
    expect(original.outPoint).toBe(20)
    // New region starts at playhead
    const spawned = regions.find(r => r.id !== 'r')!
    expect(spawned.inPoint).toBe(5)
    // Clamped to next region's inPoint (10)
    expect(spawned.outPoint).toBe(10)
  })

  it('active region (30–40) + playhead 20 (before inPoint) + no prior region → spans calcNewRegionSpan', () => {
    const store = makeStore()
    store.dispatch(addRegion(makeRegion('r', 30, 40)))
    store.dispatch(setActiveRegionId('r'))

    store.dispatch(setOutPointToPlayhead({ playhead: 20, viewSpan: 100, duration: 120 }))

    const regions = store.getState().region.regions
    expect(regions).toHaveLength(2)
    const spawned = regions.find(r => r.id !== 'r')!
    expect(spawned.inPoint).toBe(20)
    expect(spawned.outPoint).toBe(30) // clamped to next region's inPoint
  })

  it('spawn branch: new region becomes the active region', () => {
    const store = makeStore()
    store.dispatch(addRegion(makeRegion('r', 10, 20)))
    store.dispatch(setActiveRegionId('r'))

    store.dispatch(setOutPointToPlayhead({ playhead: 5, viewSpan: 100, duration: 120 }))

    const activeId = store.getState().region.activeRegionId
    const spawned = store.getState().region.regions.find(r => r.id !== 'r')!
    expect(activeId).toBe(spawned.id)
  })
})

// ── moveRegionBounds ──────────────────────────────────────────────────────────

describe('moveRegionBounds', () => {
  it('region (10–20), no anchors → bounds change, no linking event fired', () => {
    const store = makeStore()
    store.dispatch(addRegion(makeRegion('r', 10, 20)))

    store.dispatch(moveRegionBounds({ id: 'r', inPoint: 5, outPoint: 25 }))

    const r = store.getState().region.regions[0]
    expect(r.inPoint).toBe(5)
    expect(r.outPoint).toBe(25)
    expect(r.inBeatTime).toBeUndefined()
    expect(r.outBeatTime).toBeUndefined()
  })

  it('unknown id → no-op', () => {
    const store = makeStore()
    store.dispatch(addRegion(makeRegion('r', 10, 20)))

    store.dispatch(moveRegionBounds({ id: 'nope', inPoint: 5, outPoint: 25 }))

    const r = store.getState().region.regions[0]
    expect(r.inPoint).toBe(10)
    expect(r.outPoint).toBe(20)
  })

  it('region moved so in-edge lands on an input anchor → NO linking event (conform is visual-only)', () => {
    // New design: moveRegionBounds never fires applyLinkingEvent.
    // inBeatTime/outBeatTime remain undefined until the user interacts with clipout.
    const store = makeStore()
    store.dispatch(addRegion(makeRegion('r', 10, 20)))
    store.dispatch(addAnchor({ id: 1, time: 8 }))
    store.dispatch(moveBeatAnchor({ id: 1, time: 4 }))

    store.dispatch(moveRegionBounds({ id: 'r', inPoint: 8, outPoint: 20 }))

    const r = store.getState().region.regions[0]
    expect(r.inPoint).toBe(8)
    expect(r.inBeatTime).toBeUndefined()  // NOT committed by linking event
    expect(r.outBeatTime).toBeUndefined() // NOT committed by linking event
  })

  it('region moved so both edges land on input anchors → still NO linking event', () => {
    const store = makeStore()
    store.dispatch(addRegion(makeRegion('r', 10, 20)))
    store.dispatch(addAnchor({ id: 1, time: 8 }))
    store.dispatch(moveBeatAnchor({ id: 1, time: 3 }))
    store.dispatch(addAnchor({ id: 2, time: 18 }))
    store.dispatch(moveBeatAnchor({ id: 2, time: 14 }))

    store.dispatch(moveRegionBounds({ id: 'r', inPoint: 8, outPoint: 18 }))

    const r = store.getState().region.regions[0]
    expect(r.inPoint).toBe(8)
    expect(r.outPoint).toBe(18)
    expect(r.inBeatTime).toBeUndefined()  // visual conform only
    expect(r.outBeatTime).toBeUndefined() // visual conform only
  })
})

// ── moveAnchors (visual-only, no linking events) ──────────────────────────────
// New design: moveAnchors only commits anchor positions. Conform is visual-only.
// inBeatTime/outBeatTime are NOT written until the user interacts with clipout.

const makeFullRegion = (overrides: Partial<Region> = {}): Region => ({
  id: 'r1',
  name: 'Region 1',
  inPoint: 0,
  outPoint: 30,
  bpm: 120,
  minStretch: 0.5,
  maxStretch: 2.0,
  addToEnd: false,
  ...overrides,
})

describe('moveAnchors', () => {
  it('updates orig anchors in state', () => {
    const store = makeStore()
    store.dispatch(addAnchor({ id: 1, time: 5 }))

    store.dispatch(moveAnchors([{ id: 1, time: 10 }]))

    const anchors = store.getState().warp.origAnchors
    expect(anchors.find(a => a.id === 1)?.time).toBe(10)
  })

  it('does NOT fire linking event even when anchor coincides with inPoint', () => {
    // New design: anchor dragged onto boundary → visual conform only, no commit.
    const store = makeStore()
    store.dispatch(addRegion(makeFullRegion({ inPoint: 10, outPoint: 20, bpm: 120, lock: 'bpm', inBeatTime: 10, outBeatTime: 20 })))
    store.dispatch(addAnchor({ id: 1, time: 5 }))
    store.dispatch(moveBeatAnchor({ id: 1, time: 6 }))

    store.dispatch(moveAnchors([{ id: 1, time: 10 }]))

    const r = store.getState().region.regions[0]
    // inBeatTime stays at original value — no commit from moveAnchors
    expect(r.inBeatTime).toBe(10) // unchanged from initial value
    expect(r.lockedBeats).toBeUndefined() // no linking event fired
  })

  it('does NOT fire linking event when anchor coincides with outPoint', () => {
    const store = makeStore()
    store.dispatch(addRegion(makeFullRegion({ inPoint: 10, outPoint: 20, bpm: 120, lock: 'bpm', inBeatTime: 10, outBeatTime: 20 })))
    store.dispatch(addAnchor({ id: 2, time: 5 }))
    store.dispatch(moveBeatAnchor({ id: 2, time: 18 }))

    store.dispatch(moveAnchors([{ id: 2, time: 20 }]))

    const r = store.getState().region.regions[0]
    // outBeatTime stays at original value — no commit
    expect(r.outBeatTime).toBe(20) // unchanged
    expect(r.lockedBeats).toBeUndefined()
  })

  it('does not change inBeatTime/outBeatTime regardless of anchor position', () => {
    const store = makeStore()
    store.dispatch(addRegion(makeFullRegion({ inPoint: 10, outPoint: 20, bpm: 120 })))
    store.dispatch(addAnchor({ id: 1, time: 5 }))
    store.dispatch(moveBeatAnchor({ id: 1, time: 5 }))

    store.dispatch(moveAnchors([{ id: 1, time: 10 }]))

    const r = store.getState().region.regions[0]
    expect(r.inBeatTime).toBeUndefined()
    expect(r.outBeatTime).toBeUndefined()
  })
})

// ── moveBeatAnchors (visual-only, no linking events) ─────────────────────────
// New design: moveBeatAnchors only commits beat anchor positions. Conform is visual-only.

describe('moveBeatAnchors', () => {
  it('updates beat anchors in state', () => {
    const store = makeStore()
    store.dispatch(addAnchor({ id: 1, time: 5 }))
    store.dispatch(moveBeatAnchor({ id: 1, time: 5 }))

    store.dispatch(moveBeatAnchors([{ id: 1, time: 8 }]))

    const anchors = store.getState().warp.beatAnchors
    expect(anchors.find(a => a.id === 1)?.time).toBe(8)
  })

  it('does NOT fire linking event even when beat anchor coincides with inBeatTime', () => {
    const store = makeStore()
    store.dispatch(addRegion(makeFullRegion({ inPoint: 5, outPoint: 10, bpm: 120, lock: 'bpm', inBeatTime: 5, outBeatTime: 10 })))
    store.dispatch(addAnchor({ id: 1, time: 5 }))
    store.dispatch(moveBeatAnchor({ id: 1, time: 3 }))

    store.dispatch(moveBeatAnchors([{ id: 1, time: 5 }]))

    const r = store.getState().region.regions[0]
    // inBeatTime stays at 5 — unchanged, no linking event (no lockedBeats recomputed)
    expect(r.inBeatTime).toBe(5) // unchanged from initial
    expect(r.lockedBeats).toBeUndefined()
  })

  it('does NOT fire linking event even when beat anchor coincides with outBeatTime', () => {
    const store = makeStore()
    store.dispatch(addRegion(makeFullRegion({ inPoint: 5, outPoint: 10, bpm: 120, lock: 'bpm', inBeatTime: 5, outBeatTime: 12 })))
    store.dispatch(addAnchor({ id: 2, time: 10 }))
    store.dispatch(moveBeatAnchor({ id: 2, time: 8 }))

    store.dispatch(moveBeatAnchors([{ id: 2, time: 12 }]))

    const r = store.getState().region.regions[0]
    expect(r.outBeatTime).toBe(12) // unchanged
    expect(r.lockedBeats).toBeUndefined()
  })

  it('does not change inBeatTime/outBeatTime regardless of beat anchor position', () => {
    const store = makeStore()
    store.dispatch(addRegion(makeFullRegion({ inPoint: 5, outPoint: 10, bpm: 120, inBeatTime: 3, outBeatTime: 8 })))
    store.dispatch(addAnchor({ id: 1, time: 20 }))
    store.dispatch(moveBeatAnchor({ id: 1, time: 20 }))

    store.dispatch(moveBeatAnchors([{ id: 1, time: 20 }]))

    const r = store.getState().region.regions[0]
    expect(r.inBeatTime).toBe(3)  // unchanged
    expect(r.outBeatTime).toBe(8) // unchanged
  })
})
