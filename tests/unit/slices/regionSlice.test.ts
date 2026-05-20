import { describe, it, expect } from 'vitest'
import { configureStore } from '@reduxjs/toolkit'
import regionReducer, {
  addRegion,
  deleteRegion,
  setActiveRegionId,
  updateRegionInOut,
  updateRegionBeatTimes,
  updateRegionStretch,
  applyConformedClipout,
  applyLinkingEvent,
  applyBpmEdit,
  applyBeatsEdit,
} from '../../../src/store/slices/regionSlice'
import uiReducer, { setLockMode } from '../../../src/store/slices/uiSlice'
import type { Region } from '../../../src/types'
import { selectActiveRegion } from '../../../src/store/selectors'
import type { AppDispatch } from '../../../src/store/store'

function makeRegion(overrides: Partial<Region> = {}): Region {
  const base = {
    id: 'r1',
    name: 'Region 1',
    inPoint: 0,
    outPoint: 30,
    bpm: 120,
    minStretch: 0.5,
    maxStretch: 2.0,

    defaultLinked: true,
    ...overrides,
  }
  return {
    ...base,
    inBeatTime:  overrides.inBeatTime  ?? base.inPoint,
    outBeatTime: overrides.outBeatTime ?? base.outPoint,
  }
}

/**
 * A minimal real store with the region + ui slices.
 */
function makeStore() {
  const store = configureStore({
    reducer: {
      ui: uiReducer,
      region: regionReducer,
    },
  })
  return store as typeof store & { dispatch: AppDispatch }
}

/** Add a region and activate it so the selector returns it. */
function seedRegion(store: ReturnType<typeof makeStore>, region: Region) {
  store.dispatch(addRegion(region))
  store.dispatch(setActiveRegionId(region.id))
}

function activeRegion(store: ReturnType<typeof makeStore>): Region | null {
  return selectActiveRegion(store.getState() as never)
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
    const store = makeStore()
    seedRegion(store, makeRegion())
    store.dispatch(updateRegionInOut({ id: 'r1', inPoint: 5, outPoint: 25 }))
    const r = activeRegion(store)!
    expect(r.inPoint).toBe(5)
    expect(r.outPoint).toBe(25)
  })

  it('preserves diverged inBeatTime/outBeatTime when boundaries change', () => {
    // Once the user has explicitly set beat-space bounds (diverging clipout
    // from clipin), dragging the input bounds must NOT reset that divergence.
    const store = makeStore()
    seedRegion(store, makeRegion())
    store.dispatch(updateRegionBeatTimes({ id: 'r1', inBeatTime: 1, outBeatTime: 29 }))
    store.dispatch(updateRegionInOut({ id: 'r1', inPoint: 5, outPoint: 25 }))
    const r = activeRegion(store)!
    expect(r.inBeatTime).toBe(1)
    expect(r.outBeatTime).toBe(29)
  })

  it('default-linked: beat-space bounds follow input bounds when boundaries change', () => {
    // Default-linked state — clipout follows clipin via DirectedPair.
    // inBeatTime/outBeatTime are required numbers; they update to match
    // the new inPoint/outPoint for default-linked regions.
    const store = makeStore()
    seedRegion(store, makeRegion())
    store.dispatch(updateRegionInOut({ id: 'r1', inPoint: 5, outPoint: 25 }))
    const r = activeRegion(store)!
    expect(r.inBeatTime).toBe(5)
    expect(r.outBeatTime).toBe(25)
  })
})


// updateRegionLock removed in Phase 6 — lock mode is now global (ui.lockMode / setLockMode).



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
    const store = makeStore()
    // lockMode defaults to 'bpm'
    seedRegion(store, makeRegion({ bpm: 120 }))
    store.dispatch(applyConformedClipout({ id: 'r1', inBeatTime: 5, outBeatTime: 13 }))
    const r = activeRegion(store)!
    expect(r.inPoint).toBe(0)
    expect(r.outPoint).toBe(30)
    expect(r.inBeatTime).toBe(5)
    expect(r.outBeatTime).toBe(13)
    expect(r.bpm).toBe(120)
    expect(r.lockedBeats).toBeCloseTo(16, 6)
  })

  it("lock='beats': stores diverged beat-space bounds and updates BPM; lockedBeats unchanged; clipin bounds untouched", () => {
    const store = makeStore()
    store.dispatch(setLockMode('beats'))
    seedRegion(store, makeRegion({ bpm: 120, lockedBeats: 20 }))
    store.dispatch(applyConformedClipout({ id: 'r1', inBeatTime: 0, outBeatTime: 8 }))
    const r = activeRegion(store)!
    expect(r.inPoint).toBe(0)
    expect(r.outPoint).toBe(30)
    expect(r.inBeatTime).toBe(0)
    expect(r.outBeatTime).toBe(8)
    expect(r.lockedBeats).toBe(20)
    expect(r.bpm).toBeCloseTo(150, 6)
  })

  it('no-ops when the new beat-space length is degenerate', () => {
    const store = makeStore()
    seedRegion(store, makeRegion({ bpm: 120 }))
    const before = activeRegion(store)!
    store.dispatch(applyConformedClipout({ id: 'r1', inBeatTime: 5, outBeatTime: 5 }))
    const after = activeRegion(store)!
    expect(after.bpm).toBe(before.bpm)
    expect(after.lockedBeats).toBe(before.lockedBeats)
    expect(after.inBeatTime).toBe(before.inBeatTime)
    expect(after.outBeatTime).toBe(before.outBeatTime)
  })
})

describe('applyLinkingEvent', () => {
  it("in-edge linking on default-linked region with lock='bpm': inBeatTime snaps to beatAnchorTime, outBeatTime defaults from outPoint, lockedBeats recomputed, bpm and lock unchanged", () => {
    const store = makeStore()
    seedRegion(store, makeRegion({ inPoint: 5, outPoint: 10, bpm: 120, lockedBeats: 10 }))
    store.dispatch(applyLinkingEvent({ id: 'r1', edge: 'in', side: 'input', beatAnchorTime: 4 }))
    const r = activeRegion(store)!
    expect(r.inBeatTime).toBe(4)
    expect(r.outBeatTime).toBe(10)
    expect(r.lockedBeats).toBeCloseTo(12, 6)
    expect(r.bpm).toBe(120)
    expect(store.getState().ui.lockMode).toBe('bpm')
  })

  it("out-edge linking with lock='beats' (lock-bypass): lockedBeats recomputed, NOT preserved at 10; bpm and lock unchanged", () => {
    const store = makeStore()
    store.dispatch(setLockMode('beats'))
    seedRegion(store, makeRegion({ inPoint: 5, outPoint: 10, bpm: 120, lockedBeats: 10 }))
    store.dispatch(applyLinkingEvent({ id: 'r1', edge: 'out', side: 'input', beatAnchorTime: 11 }))
    const r = activeRegion(store)!
    expect(r.inBeatTime).toBe(5)
    expect(r.outBeatTime).toBe(11)
    expect(r.lockedBeats).toBeCloseTo(12, 6)
    expect(r.bpm).toBe(120)
    expect(store.getState().ui.lockMode).toBe('beats')
  })

  it('no-op when region id not found: state unchanged', () => {
    const store = makeStore()
    seedRegion(store, makeRegion({ inPoint: 5, outPoint: 10, bpm: 120 }))
    const before = activeRegion(store)!
    store.dispatch(applyLinkingEvent({ id: 'unknown', edge: 'in', side: 'input', beatAnchorTime: 4 }))
    const after = activeRegion(store)!
    expect(after.bpm).toBe(before.bpm)
    expect(after.lockedBeats).toBe(before.lockedBeats)
  })

  it('output-side linking (side=output): same math as input-side, inBeatTime snaps, outBeatTime preserved, lockedBeats recomputed', () => {
    const store = makeStore()
    seedRegion(store, makeRegion({ inPoint: 5, outPoint: 10, bpm: 120, lockedBeats: 10 }))
    store.dispatch(applyLinkingEvent({ id: 'r1', edge: 'in', side: 'output', beatAnchorTime: 3 }))
    const r = activeRegion(store)!
    expect(r.inBeatTime).toBe(3)
    expect(r.outBeatTime).toBe(10)
    expect(r.lockedBeats).toBeCloseTo(14, 6)
    expect(r.bpm).toBe(120)
    expect(store.getState().ui.lockMode).toBe('bpm')
  })
})

// ── applyBpmEdit ─────────────────────────────────────────────────────────────

describe('applyBpmEdit', () => {
  it('grid mode: length stays, lockedBeats recomputes from new bpm', () => {
    const store = makeStore()
    seedRegion(store, makeRegion({
      inBeatTime: 0, outBeatTime: 10, bpm: 120, lockedBeats: 20,
    }))
    store.dispatch(applyBpmEdit({ id: 'r1', newBpm: 60, stretch: false }))
    const r = activeRegion(store)!
    expect(r.bpm).toBe(60)
    expect(r.lockedBeats).toBeCloseTo(10, 6)
    expect(r.outBeatTime).toBe(10)
  })

  it('stretch mode: length rescales, lockedBeats stays', () => {
    const store = makeStore()
    seedRegion(store, makeRegion({
      inBeatTime: 0, outBeatTime: 10, bpm: 120, lockedBeats: 20,
    }))
    store.dispatch(applyBpmEdit({ id: 'r1', newBpm: 60, stretch: true }))
    const r = activeRegion(store)!
    expect(r.bpm).toBe(60)
    expect(r.lockedBeats).toBe(20)
    expect(r.inBeatTime).toBe(0)
    expect(r.outBeatTime).toBeCloseTo(20, 6)
  })

  it('no-op when region id not found', () => {
    const store = makeStore()
    seedRegion(store, makeRegion({
      inBeatTime: 0, outBeatTime: 10, bpm: 120, lockedBeats: 20,
    }))
    const before = activeRegion(store)!
    store.dispatch(applyBpmEdit({ id: 'unknown', newBpm: 60, stretch: false }))
    const after = activeRegion(store)!
    expect(after.bpm).toBe(before.bpm)
    expect(after.lockedBeats).toBe(before.lockedBeats)
  })

  it('default-linked region (no explicit inBeatTime/outBeatTime) falls back to inPoint/outPoint', () => {
    const store = makeStore()
    seedRegion(store, makeRegion({
      inPoint: 0, outPoint: 10, bpm: 120, lockedBeats: 20,
    }))
    store.dispatch(applyBpmEdit({ id: 'r1', newBpm: 60, stretch: false }))
    const r = activeRegion(store)!
    expect(r.bpm).toBe(60)
    expect(r.lockedBeats).toBeCloseTo(10, 6)
  })

  it('stretch mode: inBeatTime defaults to inPoint when not set', () => {
    const store = makeStore()
    seedRegion(store, makeRegion({
      inPoint: 5, outPoint: 15, bpm: 120, lockedBeats: 20,
    }))
    store.dispatch(applyBpmEdit({ id: 'r1', newBpm: 60, stretch: true }))
    const r = activeRegion(store)!
    expect(r.bpm).toBe(60)
    expect(r.lockedBeats).toBe(20)
    expect(r.inBeatTime).toBe(5)
    expect(r.outBeatTime).toBeCloseTo(25, 6)
  })
})

// ── applyBeatsEdit ───────────────────────────────────────────────────────────

describe('applyBeatsEdit', () => {
  it('length changes to fit new beat count; bpm is preserved (diverged region: only clipout moves)', () => {
    const store = makeStore()
    seedRegion(store, makeRegion({
      inBeatTime: 0, outBeatTime: 10, bpm: 120, lockedBeats: 20,
      // Explicit beat-space bounds → diverged.
      defaultLinked: false,
    }))
    // New 10 beats at 120 bpm = 5s length. outBeatTime: 0 → 5.
    store.dispatch(applyBeatsEdit({ id: 'r1', newLockedBeats: 10, stretch: false }))
    const r = activeRegion(store)!
    expect(r.lockedBeats).toBe(10)
    expect(r.bpm).toBe(120)
    expect(r.outBeatTime).toBeCloseTo(5, 6)
  })

  it('stretch mode: length rescales, bpm stays', () => {
    const store = makeStore()
    seedRegion(store, makeRegion({
      inBeatTime: 0, outBeatTime: 10, bpm: 120, lockedBeats: 20,
    }))
    store.dispatch(applyBeatsEdit({ id: 'r1', newLockedBeats: 10, stretch: true }))
    const r = activeRegion(store)!
    expect(r.lockedBeats).toBe(10)
    expect(r.bpm).toBe(120)
    expect(r.inBeatTime).toBe(0)
    expect(r.outBeatTime).toBeCloseTo(5, 6)
  })

  it('no-op when region id not found', () => {
    const store = makeStore()
    seedRegion(store, makeRegion({
      inBeatTime: 0, outBeatTime: 10, bpm: 120, lockedBeats: 20,
    }))
    const before = activeRegion(store)!
    store.dispatch(applyBeatsEdit({ id: 'unknown', newLockedBeats: 10, stretch: false }))
    const after = activeRegion(store)!
    expect(after.bpm).toBe(before.bpm)
    expect(after.lockedBeats).toBe(before.lockedBeats)
  })

  it('default-linked region: BOTH clipin (outPoint) and clipout (outBeatTime) change to fit new beat count', () => {
    const store = makeStore()
    seedRegion(store, makeRegion({
      inPoint: 0, outPoint: 10, inBeatTime: 0, outBeatTime: 10,
      bpm: 120, lockedBeats: 20, defaultLinked: true,
    }))
    // 10 beats × 60 / 120 = 5s length. inPoint stays at 0; outPoint and
    // outBeatTime both move to 5.
    store.dispatch(applyBeatsEdit({ id: 'r1', newLockedBeats: 10, stretch: false }))
    const r = activeRegion(store)!
    expect(r.lockedBeats).toBe(10)
    expect(r.bpm).toBe(120)
    expect(r.outPoint).toBeCloseTo(5, 6)
    expect(r.outBeatTime).toBeCloseTo(5, 6)
    // defaultLinked preserved.
    expect(r.defaultLinked).toBe(true)
  })

  it('stretch mode: inBeatTime defaults to inPoint when not set', () => {
    const store = makeStore()
    seedRegion(store, makeRegion({
      inPoint: 5, outPoint: 15, bpm: 120, lockedBeats: 20,
    }))
    store.dispatch(applyBeatsEdit({ id: 'r1', newLockedBeats: 10, stretch: true }))
    const r = activeRegion(store)!
    expect(r.lockedBeats).toBe(10)
    expect(r.bpm).toBe(120)
    expect(r.inBeatTime).toBe(5)
    expect(r.outBeatTime).toBeCloseTo(10, 6)
  })
})

