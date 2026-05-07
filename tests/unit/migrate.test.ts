import { describe, it, expect } from 'vitest'
import { migrateSavedVideoState } from '../../src/store/migrate'
import type { SavedVideoState } from '../../src/types'

function emptyDefaultRegion(): SavedVideoState['defaultRegion'] {
  return {
    origAnchors: [],
    beatAnchors: [],
    bpm: 120,
    minStretch: 0.5,
    maxStretch: 2.0,
    beatZeroAnchorTime: null,
  }
}

function baseState(over: Partial<SavedVideoState> = {}): SavedVideoState {
  return {
    version: 3,
    defaultRegion: emptyDefaultRegion(),
    regions: [],
    ...over,
  }
}

describe('migrateSavedVideoState', () => {
  it('passes null through unchanged', () => {
    const r = migrateSavedVideoState(null, 60)
    expect(r.state).toBeNull()
    expect(r.migratedRegionId).toBeNull()
  })

  it('returns state unchanged when there are already user regions', () => {
    const state = baseState({
      regions: [{
        id: 'r1', name: 'Verse',
        inPoint: 0, outPoint: 10,
        bpm: 130, minStretch: 0.5, maxStretch: 2.0, addToEnd: false,
      }],
      defaultRegion: { ...emptyDefaultRegion(), bpm: 90 },
    })
    const r = migrateSavedVideoState(state, 60)
    expect(r.state).toBe(state)
    expect(r.migratedRegionId).toBeNull()
  })

  it('returns state unchanged when defaultRegion has no warp content (default BPM, no anchors)', () => {
    const state = baseState()
    const r = migrateSavedVideoState(state, 60)
    expect(r.state).toBe(state)
    expect(r.migratedRegionId).toBeNull()
  })

  it('returns state unchanged when duration is 0 (no synthesis)', () => {
    const state = baseState({
      defaultRegion: {
        ...emptyDefaultRegion(),
        bpm: 130,
        origAnchors: [{ id: 1, time: 1.5 }, { id: 2, time: 3.0 }],
      },
    })
    const r = migrateSavedVideoState(state, 0)
    expect(r.state).toBe(state)
    expect(r.migratedRegionId).toBeNull()
  })

  it('synthesizes a full-span region when defaultRegion has anchors but no user regions', () => {
    const state = baseState({
      defaultRegion: {
        ...emptyDefaultRegion(),
        bpm: 128,
        minStretch: 0.4,
        maxStretch: 2.5,
        addToEnd: true,
        origAnchors: [{ id: 1, time: 1.0 }, { id: 2, time: 2.0 }],
        beatAnchors: [{ id: 1, time: 1.0 }, { id: 2, time: 2.0 }],
      },
    })
    const r = migrateSavedVideoState(state, 60)
    expect(r.migratedRegionId).toBeTruthy()
    expect(r.state).not.toBeNull()
    expect(r.state!.regions).toHaveLength(1)
    const region = r.state!.regions[0]
    expect(region.name).toBe('Full clip')
    expect(region.inPoint).toBe(0)
    expect(region.outPoint).toBe(60)
    expect(region.bpm).toBe(128)
    expect(region.minStretch).toBe(0.4)
    expect(region.maxStretch).toBe(2.5)
    expect(region.addToEnd).toBe(true)
    expect(region.id).toBe(r.migratedRegionId)
    // Original defaultRegion left untouched for now (later phase retires it).
    expect(r.state!.defaultRegion).toEqual(state.defaultRegion)
  })

  it('synthesizes when only the BPM is non-default (no anchors yet)', () => {
    const state = baseState({
      defaultRegion: { ...emptyDefaultRegion(), bpm: 90 },
    })
    const r = migrateSavedVideoState(state, 30)
    expect(r.state!.regions).toHaveLength(1)
    expect(r.state!.regions[0].bpm).toBe(90)
    expect(r.state!.regions[0].outPoint).toBe(30)
  })

  it('is idempotent — running twice produces the same shape as running once', () => {
    const state = baseState({
      defaultRegion: {
        ...emptyDefaultRegion(),
        bpm: 100,
        origAnchors: [{ id: 1, time: 0.5 }],
        beatAnchors: [{ id: 1, time: 0.5 }],
      },
    })
    const first = migrateSavedVideoState(state, 45)
    expect(first.state!.regions).toHaveLength(1)
    const second = migrateSavedVideoState(first.state, 45)
    // Second run is a no-op because regions are already populated.
    expect(second.state).toBe(first.state)
    expect(second.migratedRegionId).toBeNull()
  })
})
