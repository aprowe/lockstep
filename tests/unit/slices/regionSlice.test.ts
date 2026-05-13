import { describe, it, expect } from 'vitest'
import regionReducer, {
  addRegion,
  deleteRegion,
  setActiveRegionId,
  updateRegionInOut,
  updateRegionBeatTimes,
  updateRegionLock,
  updateRegionStretch,
  applyConformedClipout,
  applyLinkingEvent,
  applyBpmEdit,
  applyBeatsEdit,
} from '../../../src/store/slices/regionSlice'
import type { Region } from '../../../src/types'

function makeRegion(overrides: Partial<Region> = {}): Region {
  return {
    id: 'r1',
    name: 'Region 1',
    inPoint: 0,
    outPoint: 30,
    bpm: 120,
    minStretch: 0.5,
    maxStretch: 2.0,
    addToEnd: false,
    ...overrides,
  }
}

describe('addRegion', () => {
  it('appends a region', () => {
    const state = regionReducer(undefined, addRegion(makeRegion()))
    expect(state.regions).toHaveLength(1)
    expect(state.regions[0].id).toBe('r1')
  })
})

describe('deleteRegion', () => {
  it('removes the region by id', () => {
    let state = regionReducer(undefined, addRegion(makeRegion({ id: 'r1' })))
    state = regionReducer(state, addRegion(makeRegion({ id: 'r2' })))
    state = regionReducer(state, deleteRegion('r1'))
    expect(state.regions.find(r => r.id === 'r1')).toBeUndefined()
    expect(state.regions).toHaveLength(1)
  })

  it('clears activeRegionId when the active region is deleted', () => {
    let state = regionReducer(undefined, addRegion(makeRegion({ id: 'r1' })))
    state = regionReducer(state, setActiveRegionId('r1'))
    state = regionReducer(state, deleteRegion('r1'))
    expect(state.activeRegionId).toBeNull()
  })

  it('does not clear activeRegionId when a different region is deleted', () => {
    let state = regionReducer(undefined, addRegion(makeRegion({ id: 'r1' })))
    state = regionReducer(state, addRegion(makeRegion({ id: 'r2' })))
    state = regionReducer(state, setActiveRegionId('r1'))
    state = regionReducer(state, deleteRegion('r2'))
    expect(state.activeRegionId).toBe('r1')
  })
})


describe('updateRegionInOut', () => {
  it('updates in/out points', () => {
    let state = regionReducer(undefined, addRegion(makeRegion()))
    state = regionReducer(state, updateRegionInOut({ id: 'r1', inPoint: 5, outPoint: 25 }))
    const r = state.regions[0]
    expect(r.inPoint).toBe(5)
    expect(r.outPoint).toBe(25)
  })

  it('preserves diverged inBeatTime/outBeatTime when boundaries change', () => {
    // Once the user has explicitly set beat-space bounds (diverging clipout
    // from clipin), dragging the input bounds must NOT reset that divergence.
    // The clipout track is independently positioned in beat space.
    let state = regionReducer(undefined, addRegion(makeRegion()))
    state = regionReducer(state, updateRegionBeatTimes({ id: 'r1', inBeatTime: 1, outBeatTime: 29 }))
    state = regionReducer(state, updateRegionInOut({ id: 'r1', inPoint: 5, outPoint: 25 }))
    const r = state.regions[0]
    expect(r.inBeatTime).toBe(1)
    expect(r.outBeatTime).toBe(29)
  })

  it('leaves linked (undefined) beat-time bounds undefined when boundaries change', () => {
    // Default-linked state — inBeatTime and outBeatTime stay undefined and the
    // clipout follows the new input bounds.
    let state = regionReducer(undefined, addRegion(makeRegion()))
    state = regionReducer(state, updateRegionInOut({ id: 'r1', inPoint: 5, outPoint: 25 }))
    const r = state.regions[0]
    expect(r.inBeatTime).toBeUndefined()
    expect(r.outBeatTime).toBeUndefined()
  })
})


describe('updateRegionLock', () => {
  it('sets the lock mode and lockedBeats', () => {
    let state = regionReducer(undefined, addRegion(makeRegion()))
    state = regionReducer(state, updateRegionLock({ id: 'r1', lock: 'beats', lockedBeats: 32 }))
    expect(state.regions[0].lock).toBe('beats')
    expect(state.regions[0].lockedBeats).toBe(32)
  })
})



describe('updateRegionStretch', () => {
  it('updates minStretch and maxStretch', () => {
    let state = regionReducer(undefined, addRegion(makeRegion()))
    state = regionReducer(state, updateRegionStretch({ id: 'r1', minStretch: 0.75, maxStretch: 1.5 }))
    expect(state.regions[0].minStretch).toBe(0.75)
    expect(state.regions[0].maxStretch).toBe(1.5)
  })

  it('updates only minStretch when maxStretch is omitted', () => {
    let state = regionReducer(undefined, addRegion(makeRegion()))
    state = regionReducer(state, updateRegionStretch({ id: 'r1', minStretch: 0.6 }))
    expect(state.regions[0].minStretch).toBe(0.6)
    expect(state.regions[0].maxStretch).toBe(2.0)
  })
})

describe('applyConformedClipout', () => {
  it("lock='bpm': stores diverged beat-space bounds and updates lockedBeats; BPM unchanged; clipin bounds untouched", () => {
    // Region 10..20s @ 120 BPM, lock='bpm'.
    // New clipout 5..13 (length 8) → lockedBeats = 8 * 120 / 60 = 16.
    let state = regionReducer(undefined, addRegion(makeRegion({ bpm: 120, lock: 'bpm' })))
    state = regionReducer(state, applyConformedClipout({ id: 'r1', inBeatTime: 5, outBeatTime: 13 }))
    const r = state.regions[0]
    expect(r.inPoint).toBe(0)
    expect(r.outPoint).toBe(30)
    expect(r.inBeatTime).toBe(5)
    expect(r.outBeatTime).toBe(13)
    expect(r.bpm).toBe(120)
    expect(r.lockedBeats).toBeCloseTo(16, 6)
  })

  it("lock='beats': stores diverged beat-space bounds and updates BPM; lockedBeats unchanged; clipin bounds untouched", () => {
    // lockedBeats=20, clipin 0..30. New clipout 0..8 (length 8s) → BPM = 60*20/8 = 150.
    let state = regionReducer(undefined, addRegion(makeRegion({ bpm: 120, lock: 'beats', lockedBeats: 20 })))
    state = regionReducer(state, applyConformedClipout({ id: 'r1', inBeatTime: 0, outBeatTime: 8 }))
    const r = state.regions[0]
    expect(r.inPoint).toBe(0)
    expect(r.outPoint).toBe(30)
    expect(r.inBeatTime).toBe(0)
    expect(r.outBeatTime).toBe(8)
    expect(r.lockedBeats).toBe(20)
    expect(r.bpm).toBeCloseTo(150, 6)
  })

  it('no-ops when the new beat-space length is degenerate', () => {
    let state = regionReducer(undefined, addRegion(makeRegion({ bpm: 120, lock: 'bpm' })))
    const before = state.regions[0]
    state = regionReducer(state, applyConformedClipout({ id: 'r1', inBeatTime: 5, outBeatTime: 5 }))
    const after = state.regions[0]
    expect(after).toEqual(before)
  })
})

describe('applyLinkingEvent', () => {
  it("in-edge linking on default-linked region with lock='bpm': inBeatTime snaps to beatAnchorTime, outBeatTime defaults from outPoint, lockedBeats recomputed, bpm and lock unchanged", () => {
    // Region inPoint=5, outPoint=10, bpm=120, lock='bpm', lockedBeats=10
    // Dispatch: edge='in', beatAnchorTime=4
    // currentInBeatTime = 4 (snapped), currentOutBeatTime = outPoint = 10 (default-linked)
    // clipoutLength = 10 - 4 = 6; lockedBeats = 6 * 120 / 60 = 12
    let state = regionReducer(undefined, addRegion(makeRegion({ inPoint: 5, outPoint: 10, bpm: 120, lock: 'bpm', lockedBeats: 10 })))
    state = regionReducer(state, applyLinkingEvent({ id: 'r1', edge: 'in', side: 'input', beatAnchorTime: 4 }))
    const r = state.regions[0]
    expect(r.inBeatTime).toBe(4)
    expect(r.outBeatTime).toBe(10)
    expect(r.lockedBeats).toBeCloseTo(12, 6)
    expect(r.bpm).toBe(120)
    expect(r.lock).toBe('bpm')
  })

  it("out-edge linking with lock='beats' (lock-bypass): lockedBeats recomputed, NOT preserved at 10; bpm and lock unchanged", () => {
    // Region inPoint=5, outPoint=10, bpm=120, lock='beats', lockedBeats=10
    // Dispatch: edge='out', beatAnchorTime=11
    // currentInBeatTime = inPoint = 5 (default-linked), newOutBeatTime = 11
    // clipoutLength = 11 - 5 = 6; lockedBeats = 6 * 120 / 60 = 12 (lock-bypass: bpm stays, lockedBeats absorbs)
    let state = regionReducer(undefined, addRegion(makeRegion({ inPoint: 5, outPoint: 10, bpm: 120, lock: 'beats', lockedBeats: 10 })))
    state = regionReducer(state, applyLinkingEvent({ id: 'r1', edge: 'out', side: 'input', beatAnchorTime: 11 }))
    const r = state.regions[0]
    expect(r.inBeatTime).toBe(5)
    expect(r.outBeatTime).toBe(11)
    expect(r.lockedBeats).toBeCloseTo(12, 6)
    expect(r.bpm).toBe(120)
    expect(r.lock).toBe('beats')
  })

  it('no-op when region id not found: state unchanged', () => {
    let state = regionReducer(undefined, addRegion(makeRegion({ inPoint: 5, outPoint: 10, bpm: 120 })))
    const before = state.regions[0]
    state = regionReducer(state, applyLinkingEvent({ id: 'unknown', edge: 'in', side: 'input', beatAnchorTime: 4 }))
    expect(state.regions[0]).toEqual(before)
  })

  it('output-side linking (side=output): same math as input-side, inBeatTime snaps, outBeatTime preserved, lockedBeats recomputed', () => {
    // side='output' is informational only — math is identical
    // Region inPoint=5, outPoint=10, bpm=120, lock='bpm', lockedBeats=10
    // edge='in', beatAnchorTime=3 → inBeatTime=3, outBeatTime=10, lockedBeats = 7 * 120/60 = 14
    let state = regionReducer(undefined, addRegion(makeRegion({ inPoint: 5, outPoint: 10, bpm: 120, lock: 'bpm', lockedBeats: 10 })))
    state = regionReducer(state, applyLinkingEvent({ id: 'r1', edge: 'in', side: 'output', beatAnchorTime: 3 }))
    const r = state.regions[0]
    expect(r.inBeatTime).toBe(3)
    expect(r.outBeatTime).toBe(10)
    expect(r.lockedBeats).toBeCloseTo(14, 6)
    expect(r.bpm).toBe(120)
    expect(r.lock).toBe('bpm')
  })
})

// ── applyBpmEdit ─────────────────────────────────────────────────────────────

describe('applyBpmEdit', () => {
  // Fixture: inBeatTime=0, outBeatTime=10, bpm=120, lockedBeats=20 (explicit)

  it('grid mode: length stays, lockedBeats recomputes from new bpm', () => {
    // newBpm=60, length=10: lockedBeats = 10 × 60 / 60 = 10
    let state = regionReducer(undefined, addRegion(makeRegion({
      inBeatTime: 0, outBeatTime: 10, bpm: 120, lockedBeats: 20,
    })))
    state = regionReducer(state, applyBpmEdit({ id: 'r1', newBpm: 60, stretch: false }))
    const r = state.regions[0]
    expect(r.bpm).toBe(60)
    expect(r.lockedBeats).toBeCloseTo(10, 6)
    expect(r.outBeatTime).toBe(10) // length unchanged
  })

  it('stretch mode: length rescales, lockedBeats stays', () => {
    // newBpm=60, lockedBeats=20: newLength = 60 × 20 / 60 = 20, outBeatTime = 0 + 20 = 20
    let state = regionReducer(undefined, addRegion(makeRegion({
      inBeatTime: 0, outBeatTime: 10, bpm: 120, lockedBeats: 20,
    })))
    state = regionReducer(state, applyBpmEdit({ id: 'r1', newBpm: 60, stretch: true }))
    const r = state.regions[0]
    expect(r.bpm).toBe(60)
    expect(r.lockedBeats).toBe(20) // unchanged
    expect(r.inBeatTime).toBe(0)
    expect(r.outBeatTime).toBeCloseTo(20, 6) // 60 × 20 / 60 = 20
  })

  it('no-op when region id not found', () => {
    let state = regionReducer(undefined, addRegion(makeRegion({
      inBeatTime: 0, outBeatTime: 10, bpm: 120, lockedBeats: 20,
    })))
    const before = state.regions[0]
    state = regionReducer(state, applyBpmEdit({ id: 'unknown', newBpm: 60, stretch: false }))
    expect(state.regions[0]).toEqual(before)
  })

  it('default-linked region (no explicit inBeatTime/outBeatTime) falls back to inPoint/outPoint', () => {
    // inPoint=0, outPoint=10 used as fallback — grid mode
    let state = regionReducer(undefined, addRegion(makeRegion({
      inPoint: 0, outPoint: 10, bpm: 120, lockedBeats: 20,
    })))
    state = regionReducer(state, applyBpmEdit({ id: 'r1', newBpm: 60, stretch: false }))
    const r = state.regions[0]
    expect(r.bpm).toBe(60)
    expect(r.lockedBeats).toBeCloseTo(10, 6) // 10 × 60 / 60 = 10
    // inBeatTime not explicitly set by grid edit (length stays, no beat-space bound written)
  })

  it('stretch mode: inBeatTime defaults to inPoint when not set', () => {
    // Default-linked: inPoint=5, outPoint=15 → inBeatTime fallback=5, outBeatTime fallback=15
    // lockedBeats=20; newBpm=60: newLength=20, outBeatTime = 5 + 20 = 25
    let state = regionReducer(undefined, addRegion(makeRegion({
      inPoint: 5, outPoint: 15, bpm: 120, lockedBeats: 20,
    })))
    state = regionReducer(state, applyBpmEdit({ id: 'r1', newBpm: 60, stretch: true }))
    const r = state.regions[0]
    expect(r.bpm).toBe(60)
    expect(r.lockedBeats).toBe(20)
    expect(r.inBeatTime).toBe(5) // committed from inPoint fallback
    expect(r.outBeatTime).toBeCloseTo(25, 6) // 5 + 20
  })
})

// ── applyBeatsEdit ───────────────────────────────────────────────────────────

describe('applyBeatsEdit', () => {
  // Fixture: inBeatTime=0, outBeatTime=10, bpm=120, lockedBeats=20 (explicit)

  it('grid mode: length stays, bpm recomputes from new lockedBeats', () => {
    // newLockedBeats=10, length=10: bpm = 60 × 10 / 10 = 60
    let state = regionReducer(undefined, addRegion(makeRegion({
      inBeatTime: 0, outBeatTime: 10, bpm: 120, lockedBeats: 20,
    })))
    state = regionReducer(state, applyBeatsEdit({ id: 'r1', newLockedBeats: 10, stretch: false }))
    const r = state.regions[0]
    expect(r.lockedBeats).toBe(10)
    expect(r.bpm).toBeCloseTo(60, 6) // 60 × 10 / 10 = 60
    expect(r.outBeatTime).toBe(10) // length unchanged
  })

  it('stretch mode: length rescales, bpm stays', () => {
    // newLockedBeats=10, bpm=120: newLength = 60 × 10 / 120 = 5, outBeatTime = 0 + 5 = 5
    let state = regionReducer(undefined, addRegion(makeRegion({
      inBeatTime: 0, outBeatTime: 10, bpm: 120, lockedBeats: 20,
    })))
    state = regionReducer(state, applyBeatsEdit({ id: 'r1', newLockedBeats: 10, stretch: true }))
    const r = state.regions[0]
    expect(r.lockedBeats).toBe(10)
    expect(r.bpm).toBe(120) // unchanged
    expect(r.inBeatTime).toBe(0)
    expect(r.outBeatTime).toBeCloseTo(5, 6) // 60 × 10 / 120 = 5
  })

  it('no-op when region id not found', () => {
    let state = regionReducer(undefined, addRegion(makeRegion({
      inBeatTime: 0, outBeatTime: 10, bpm: 120, lockedBeats: 20,
    })))
    const before = state.regions[0]
    state = regionReducer(state, applyBeatsEdit({ id: 'unknown', newLockedBeats: 10, stretch: false }))
    expect(state.regions[0]).toEqual(before)
  })

  it('default-linked region (no explicit inBeatTime/outBeatTime) falls back to inPoint/outPoint', () => {
    // inPoint=0, outPoint=10 used as fallback — grid mode
    let state = regionReducer(undefined, addRegion(makeRegion({
      inPoint: 0, outPoint: 10, bpm: 120, lockedBeats: 20,
    })))
    state = regionReducer(state, applyBeatsEdit({ id: 'r1', newLockedBeats: 10, stretch: false }))
    const r = state.regions[0]
    expect(r.lockedBeats).toBe(10)
    expect(r.bpm).toBeCloseTo(60, 6) // 60 × 10 / 10 = 60
  })

  it('stretch mode: inBeatTime defaults to inPoint when not set', () => {
    // Default-linked: inPoint=5, outPoint=15 → inBeatTime fallback=5
    // bpm=120, newLockedBeats=10: newLength=5, outBeatTime = 5 + 5 = 10
    let state = regionReducer(undefined, addRegion(makeRegion({
      inPoint: 5, outPoint: 15, bpm: 120, lockedBeats: 20,
    })))
    state = regionReducer(state, applyBeatsEdit({ id: 'r1', newLockedBeats: 10, stretch: true }))
    const r = state.regions[0]
    expect(r.lockedBeats).toBe(10)
    expect(r.bpm).toBe(120)
    expect(r.inBeatTime).toBe(5) // committed from inPoint fallback
    expect(r.outBeatTime).toBeCloseTo(10, 6) // 5 + 5
  })
})

