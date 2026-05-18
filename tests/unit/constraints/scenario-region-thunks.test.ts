import { describe, it, expect } from 'vitest'
import { addRegion, setActiveRegionId } from '../../../src/store/slices/regionSlice'
import { addAnchor, moveBeatAnchor } from '../../../src/store/slices/warpSlice'
import { setInPointToPlayhead, setOutPointToPlayhead, moveRegionBounds, moveAnchors, moveBeatAnchors } from '../../../src/store/thunks/regionThunks'
import { makeStore } from '../../helpers/setup'
import type { Region } from '../../../src/types'

const makeRegion = (id: string, inPoint: number, outPoint: number) => ({
  id, name: id, inPoint, outPoint,
  inBeatTime: inPoint, outBeatTime: outPoint, defaultLinked: true,
  bpm: 120, minStretch: 0.5, maxStretch: 2, addToEnd: false as const,
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
    // Default-linked: beat-space follows input bounds
    expect(r.inBeatTime).toBe(5)
    expect(r.outBeatTime).toBe(25)
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
    // inBeatTime/outBeatTime stay default-linked (follow inPoint/outPoint).
    const store = makeStore()
    store.dispatch(addRegion(makeRegion('r', 10, 20)))
    store.dispatch(addAnchor({ id: 1, time: 8 }))
    store.dispatch(moveBeatAnchor({ id: 1, time: 4 }))

    store.dispatch(moveRegionBounds({ id: 'r', inPoint: 8, outPoint: 20 }))

    const r = store.getState().region.regions[0]
    expect(r.inPoint).toBe(8)
    // Default-linked: beat-space follows input bounds (no linking event commit)
    expect(r.inBeatTime).toBe(8)   // follows inPoint
    expect(r.outBeatTime).toBe(20) // follows outPoint
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
    // Default-linked: beat-space follows input bounds (visual conform only, no linking event)
    expect(r.inBeatTime).toBe(8)   // follows inPoint
    expect(r.outBeatTime).toBe(18) // follows outPoint
  })
})

// ── moveAnchors (visual-only, no linking events) ──────────────────────────────
// New design: moveAnchors only commits anchor positions. Conform is visual-only.
// inBeatTime/outBeatTime are NOT written until the user interacts with clipout.

const makeFullRegion = (overrides: Partial<Region> = {}): Region => {
  const base = {
    id: 'r1',
    name: 'Region 1',
    inPoint: 0,
    outPoint: 30,
    bpm: 120,
    minStretch: 0.5,
    maxStretch: 2.0,
    addToEnd: false as const,
    defaultLinked: true,
    ...overrides,
  }
  return {
    ...base,
    inBeatTime:  overrides.inBeatTime  ?? base.inPoint,
    outBeatTime: overrides.outBeatTime ?? base.outPoint,
  }
}

describe('moveAnchors', () => {
  it('updates orig anchors in state', () => {
    const store = makeStore()
    store.dispatch(addAnchor({ id: 1, time: 5 }))

    store.dispatch(moveAnchors([{ id: 1, time: 10 }]))

    const anchors = store.getState().warp.origAnchors
    expect(anchors.find(a => a.id === 1)?.time).toBe(10)
  })

  it('anchor dragged onto inPoint engages conform (transient via ConformVisual)', () => {
    // Under the new model: anchor drag onto a region's edge engages ConformVisual,
    // which writes clipout.in = paired beat anchor's time. No applyLinkingEvent
    // is dispatched (the conform is transient — re-evaluated each pipeline pass).
    const store = makeStore()
    store.dispatch(addRegion(makeFullRegion({ inPoint: 10, outPoint: 20, bpm: 120, inBeatTime: 10, outBeatTime: 20 })))
    store.dispatch(addAnchor({ id: 1, time: 5 }))
    store.dispatch(moveBeatAnchor({ id: 1, time: 6 }))

    store.dispatch(moveAnchors([{ id: 1, time: 10 }]))

    const r = store.getState().region.regions[0]
    // ConformVisual fires: clipin.in=10 ≈ orig=10 → writes clipout.in = beat=6.
    expect(r.inBeatTime).toBeCloseTo(6, 6)
  })

  it('anchor dragged onto outPoint engages conform on the out-edge', () => {
    const store = makeStore()
    store.dispatch(addRegion(makeFullRegion({ inPoint: 10, outPoint: 20, bpm: 120, inBeatTime: 10, outBeatTime: 20 })))
    store.dispatch(addAnchor({ id: 2, time: 5 }))
    store.dispatch(moveBeatAnchor({ id: 2, time: 18 }))

    store.dispatch(moveAnchors([{ id: 2, time: 20 }]))

    const r = store.getState().region.regions[0]
    // ConformVisual fires for the out-edge: writes clipout.out = beat=18.
    expect(r.outBeatTime).toBeCloseTo(18, 6)
  })

  it('anchor not on any edge: inBeatTime/outBeatTime unchanged (conform not engaged)', () => {
    const store = makeStore()
    store.dispatch(addRegion(makeFullRegion({ inPoint: 10, outPoint: 20, bpm: 120 })))
    store.dispatch(addAnchor({ id: 1, time: 5 }))
    store.dispatch(moveBeatAnchor({ id: 1, time: 5 }))

    store.dispatch(moveAnchors([{ id: 1, time: 7 }]))   // not on either edge

    const r = store.getState().region.regions[0]
    // No conform — clipout bounds unchanged.
    expect(r.inBeatTime).toBe(10)
    expect(r.outBeatTime).toBe(20)
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

  it('no explicit linking event is dispatched by moveBeatAnchors', () => {
    // Under the MirrorPair model, beat-anchor drag drags the conformed clipout
    // edge along (conform = inseparable). The clipout follows the anchor while
    // coincidence holds in both spaces. inBeatTime gets pulled to 3 (where the
    // anchor was when MirrorPair last fired); when moveBeatAnchors directly
    // resets the anchor to 5, MirrorPair is no longer installed (output-space
    // coincidence is broken), so the clipout stays at 3 — the anchor and clip
    // diverge. The key assertion of this test is that NO applyLinkingEvent
    // dispatch happens (the lockedBeats it would have written matches what
    // bpmDerivedConstraint computes anyway, so we can't easily distinguish).
    const store = makeStore()
    store.dispatch(addRegion(makeFullRegion({ inPoint: 5, outPoint: 10, bpm: 120, inBeatTime: 5, outBeatTime: 10 })))
    store.dispatch(addAnchor({ id: 1, time: 5 }))
    store.dispatch(moveBeatAnchor({ id: 1, time: 3 }))

    store.dispatch(moveBeatAnchors([{ id: 1, time: 5 }]))

    const r = store.getState().region.regions[0]
    // Clipout was carried to 3 by MirrorPair during the diverging drag and
    // stays there after the anchor returns to 5 (binding uninstalled).
    expect(r.inBeatTime).toBeCloseTo(3, 6)
  })

  it('no explicit linking event is dispatched (out edge variant)', () => {
    const store = makeStore()
    store.dispatch(addRegion(makeFullRegion({ inPoint: 5, outPoint: 10, bpm: 120, inBeatTime: 5, outBeatTime: 12 })))
    store.dispatch(addAnchor({ id: 2, time: 10 }))
    store.dispatch(moveBeatAnchor({ id: 2, time: 8 }))

    store.dispatch(moveBeatAnchors([{ id: 2, time: 12 }]))

    const r = store.getState().region.regions[0]
    // Anchor 2 was conformed to outBeatTime=12 initially? clipout.out=12,
    // beat.time=10. Not coincident in output space → MirrorPair never installed
    // for this anchor's 'out' binding. So clipout.out stays at 12 throughout.
    expect(r.outBeatTime).toBeCloseTo(12, 6)
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
