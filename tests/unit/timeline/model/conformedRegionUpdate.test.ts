import { describe, it, expect } from 'vitest'
import { conformedRegionUpdate } from '../../../../src/timeline/model/conformedRegionUpdate'
import type { Region } from '../../../../src/types'

function makeRegion(overrides: Partial<Region> = {}): Region {
  return {
    id: 'r1',
    name: 'R1',
    inPoint: 10,
    outPoint: 20,
    bpm: 120,
    minStretch: 0.5,
    maxStretch: 2.0,
    addToEnd: false,
    ...overrides,
  }
}

describe('conformedRegionUpdate', () => {
  it("lock='bpm': BPM stays fixed, lockedBeats derives from new beat-space length", () => {
    // Region BPM=120, original beat-space length 10s = 20 beats. After
    // conform the clipout is 8s long → expected lockedBeats = 8 * 120 / 60 = 16.
    const region = makeRegion({ bpm: 120, lock: 'bpm' })
    const result = conformedRegionUpdate(region, 5, 13) // new beat-space [5..13] (length 8)
    expect(result.bpm).toBeUndefined()
    expect(result.lockedBeats).toBeCloseTo(16, 6)
  })

  it("lock='beats': lockedBeats stays fixed, BPM derives from new beat-space length", () => {
    // Region with lockedBeats=20, new clipout length 8s → BPM = 60 * 20 / 8 = 150.
    const region = makeRegion({
      lock: 'beats',
      lockedBeats: 20,
    })
    const result = conformedRegionUpdate(region, 0, 8)
    expect(result.lockedBeats).toBeUndefined()
    expect(result.bpm).toBeCloseTo(150, 6)
  })

  it("lock undefined defaults to 'bpm' semantics", () => {
    const region = makeRegion({ bpm: 120 })
    const result = conformedRegionUpdate(region, 0, 4) // length 4 → beats = 4*120/60 = 8
    expect(result.lockedBeats).toBeCloseTo(8, 6)
    expect(result.bpm).toBeUndefined()
  })

  it("lock='beats' with no lockedBeats falls back to deriving beats from current region length", () => {
    // Region beat-space defaults to inPoint..outPoint (10..20 = 10s). With BPM=120,
    // that's 20 beats. After conform to length 5s with that retained beat count,
    // BPM = 60 * 20 / 5 = 240.
    const region = makeRegion({ inPoint: 10, outPoint: 20, bpm: 120, lock: 'beats' })
    const result = conformedRegionUpdate(region, 0, 5)
    expect(result.bpm).toBeCloseTo(240, 6)
  })

  it('returns empty update when the new beat-space length is 0 or negative', () => {
    const region = makeRegion({ bpm: 120, lock: 'bpm' })
    const result = conformedRegionUpdate(region, 5, 5)
    expect(result).toEqual({})
  })
})
