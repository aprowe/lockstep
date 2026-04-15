import { describe, it, expect } from 'vitest'
import regionReducer, {
  addRegion,
  deleteRegion,
  setActiveRegionId,
  updateRegionInOut,
  updateRegionBeatTimes,
  updateRegionLock,
  renameRegion,
  updateRegionBpm,
  updateRegionStretch,
} from '../../store/slices/regionSlice'
import type { Region } from '../../types'

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

// ── addRegion ─────────────────────────────────────────────────────────────────

describe('addRegion', () => {
  it('appends a region', () => {
    const state = regionReducer(undefined, addRegion(makeRegion()))
    expect(state.regions).toHaveLength(1)
    expect(state.regions[0].id).toBe('r1')
  })
})

// ── deleteRegion ──────────────────────────────────────────────────────────────

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

// ── setActiveRegionId ─────────────────────────────────────────────────────────

describe('setActiveRegionId', () => {
  it('sets the active region', () => {
    let state = regionReducer(undefined, addRegion(makeRegion()))
    state = regionReducer(state, setActiveRegionId('r1'))
    expect(state.activeRegionId).toBe('r1')
  })

  it('accepts null to clear selection', () => {
    let state = regionReducer(undefined, addRegion(makeRegion()))
    state = regionReducer(state, setActiveRegionId('r1'))
    state = regionReducer(state, setActiveRegionId(null))
    expect(state.activeRegionId).toBeNull()
  })
})

// ── updateRegionInOut ─────────────────────────────────────────────────────────

describe('updateRegionInOut', () => {
  it('updates in/out points', () => {
    let state = regionReducer(undefined, addRegion(makeRegion()))
    state = regionReducer(state, updateRegionInOut({ id: 'r1', inPoint: 5, outPoint: 25 }))
    const r = state.regions[0]
    expect(r.inPoint).toBe(5)
    expect(r.outPoint).toBe(25)
  })

  it('resets inBeatTime and outBeatTime when boundaries change', () => {
    let state = regionReducer(undefined, addRegion(makeRegion()))
    state = regionReducer(state, updateRegionBeatTimes({ id: 'r1', inBeatTime: 1, outBeatTime: 29 }))
    state = regionReducer(state, updateRegionInOut({ id: 'r1', inPoint: 5, outPoint: 25 }))
    const r = state.regions[0]
    expect(r.inBeatTime).toBeUndefined()
    expect(r.outBeatTime).toBeUndefined()
  })
})

// ── updateRegionBeatTimes ─────────────────────────────────────────────────────

describe('updateRegionBeatTimes', () => {
  it('sets beat boundary times', () => {
    let state = regionReducer(undefined, addRegion(makeRegion()))
    state = regionReducer(state, updateRegionBeatTimes({ id: 'r1', inBeatTime: 2, outBeatTime: 28 }))
    expect(state.regions[0].inBeatTime).toBe(2)
    expect(state.regions[0].outBeatTime).toBe(28)
  })
})

// ── updateRegionLock ──────────────────────────────────────────────────────────

describe('updateRegionLock', () => {
  it('sets the lock mode and lockedBeats', () => {
    let state = regionReducer(undefined, addRegion(makeRegion()))
    state = regionReducer(state, updateRegionLock({ id: 'r1', lock: 'beats', lockedBeats: 32 }))
    expect(state.regions[0].lock).toBe('beats')
    expect(state.regions[0].lockedBeats).toBe(32)
  })
})

// ── renameRegion ──────────────────────────────────────────────────────────────

describe('renameRegion', () => {
  it('updates the region name', () => {
    let state = regionReducer(undefined, addRegion(makeRegion()))
    state = regionReducer(state, renameRegion({ id: 'r1', name: 'Chorus' }))
    expect(state.regions[0].name).toBe('Chorus')
  })
})

// ── updateRegionBpm ───────────────────────────────────────────────────────────

describe('updateRegionBpm', () => {
  it('updates the bpm', () => {
    let state = regionReducer(undefined, addRegion(makeRegion()))
    state = regionReducer(state, updateRegionBpm({ id: 'r1', bpm: 140 }))
    expect(state.regions[0].bpm).toBe(140)
  })
})

// ── updateRegionStretch ───────────────────────────────────────────────────────

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
    expect(state.regions[0].maxStretch).toBe(2.0) // unchanged
  })
})
