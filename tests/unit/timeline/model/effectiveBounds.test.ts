import { describe, it, expect } from 'vitest'
import { effectiveBeatBounds } from '../../../../src/timeline/model/effectiveBounds'
import type { Anchor, Region } from '../../../../src/types'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRegion(overrides: Partial<Region> = {}): Region {
  return {
    id: 'r1',
    name: 'Test Region',
    inPoint: 10,
    outPoint: 20,
    bpm: 120,
    minStretch: 0.5,
    maxStretch: 2.0,
    addToEnd: false,
    ...overrides,
  }
}

// ── effectiveBeatBounds ────────────────────────────────────────────────────────

describe('effectiveBeatBounds', () => {
  it('default-linked region with no anchors → falls back to inPoint/outPoint', () => {
    const region = makeRegion({ inPoint: 10, outPoint: 20 })
    const result = effectiveBeatBounds(region, [], [])
    expect(result).toEqual({ inBeatTime: 10, outBeatTime: 20 })
  })

  it('default-linked region with anchors that do NOT coincide → falls back to inPoint/outPoint', () => {
    const region = makeRegion({ inPoint: 10, outPoint: 20 })
    const origAnchors: Anchor[] = [{ id: 1, time: 5 }, { id: 2, time: 15 }]
    const beatAnchors: Anchor[] = [{ id: 1, time: 3 }, { id: 2, time: 12 }]
    const result = effectiveBeatBounds(region, origAnchors, beatAnchors)
    expect(result).toEqual({ inBeatTime: 10, outBeatTime: 20 })
  })

  it('default-linked region with in-edge input-anchor conform → inBeatTime = paired beat anchor time; outBeatTime = outPoint', () => {
    const region = makeRegion({ inPoint: 10, outPoint: 20 })
    // input anchor at inPoint (10) with beat pair at 6 → effective inBeatTime = 6
    const origAnchors: Anchor[] = [{ id: 1, time: 10 }]
    const beatAnchors: Anchor[] = [{ id: 1, time: 6 }]
    const result = effectiveBeatBounds(region, origAnchors, beatAnchors)
    expect(result.inBeatTime).toBe(6)
    expect(result.outBeatTime).toBe(20)
  })

  it('default-linked region with out-edge input-anchor conform → inBeatTime = inPoint; outBeatTime = paired beat anchor time', () => {
    const region = makeRegion({ inPoint: 10, outPoint: 20 })
    // input anchor at outPoint (20) with beat pair at 18 → effective outBeatTime = 18
    const origAnchors: Anchor[] = [{ id: 2, time: 20 }]
    const beatAnchors: Anchor[] = [{ id: 2, time: 18 }]
    const result = effectiveBeatBounds(region, origAnchors, beatAnchors)
    expect(result.inBeatTime).toBe(10)
    expect(result.outBeatTime).toBe(18)
  })

  it('default-linked region with BOTH edges conformed → both bounds from paired beat anchors', () => {
    const region = makeRegion({ inPoint: 10, outPoint: 20 })
    const origAnchors: Anchor[] = [{ id: 1, time: 10 }, { id: 2, time: 20 }]
    const beatAnchors: Anchor[] = [{ id: 1, time: 6 }, { id: 2, time: 18 }]
    const result = effectiveBeatBounds(region, origAnchors, beatAnchors)
    expect(result.inBeatTime).toBe(6)
    expect(result.outBeatTime).toBe(18)
  })

  it('diverged region (both explicit) → explicit values win; anchors ignored', () => {
    const region = makeRegion({ inPoint: 10, outPoint: 20, inBeatTime: 8, outBeatTime: 22 })
    // Even with coincident input anchors, explicit beats win.
    const origAnchors: Anchor[] = [{ id: 1, time: 10 }, { id: 2, time: 20 }]
    const beatAnchors: Anchor[] = [{ id: 1, time: 6 }, { id: 2, time: 18 }]
    const result = effectiveBeatBounds(region, origAnchors, beatAnchors)
    expect(result).toEqual({ inBeatTime: 8, outBeatTime: 22 })
  })

  it('only inBeatTime explicit → inBeatTime wins for in edge; out edge uses anchor conform', () => {
    // Partial diverge: inBeatTime set but outBeatTime undefined.
    const region = makeRegion({ inPoint: 10, outPoint: 20, inBeatTime: 8 })
    const origAnchors: Anchor[] = [{ id: 2, time: 20 }]
    const beatAnchors: Anchor[] = [{ id: 2, time: 18 }]
    const result = effectiveBeatBounds(region, origAnchors, beatAnchors)
    expect(result.inBeatTime).toBe(8)
    expect(result.outBeatTime).toBe(18)
  })

  it('only outBeatTime explicit → out edge wins; in edge uses anchor conform', () => {
    const region = makeRegion({ inPoint: 10, outPoint: 20, outBeatTime: 22 })
    const origAnchors: Anchor[] = [{ id: 1, time: 10 }]
    const beatAnchors: Anchor[] = [{ id: 1, time: 6 }]
    const result = effectiveBeatBounds(region, origAnchors, beatAnchors)
    expect(result.inBeatTime).toBe(6)
    expect(result.outBeatTime).toBe(22)
  })

  it('torn pairing (input anchor present but beat partner absent) → falls back to inPoint', () => {
    const region = makeRegion({ inPoint: 10, outPoint: 20 })
    const origAnchors: Anchor[] = [{ id: 1, time: 10 }]
    const beatAnchors: Anchor[] = [] // torn — no beat partner for id 1
    const result = effectiveBeatBounds(region, origAnchors, beatAnchors)
    // beat partner absent → beat?.time is undefined → falls back to inPoint
    expect(result.inBeatTime).toBe(10)
    expect(result.outBeatTime).toBe(20)
  })

  it('both explicit set to same as inPoint/outPoint (identity) → returns explicit values', () => {
    const region = makeRegion({ inPoint: 10, outPoint: 20, inBeatTime: 10, outBeatTime: 20 })
    const result = effectiveBeatBounds(region, [], [])
    expect(result).toEqual({ inBeatTime: 10, outBeatTime: 20 })
  })
})
