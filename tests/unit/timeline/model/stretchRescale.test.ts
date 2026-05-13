import { describe, it, expect } from 'vitest'
import { stretchRescale } from '../../../../src/timeline/model/stretchRescale'
import type { Region } from '../../../../src/types'

// ---------------------------------------------------------------------------
// Minimal region factory — only fills in fields stretchRescale cares about.
// ---------------------------------------------------------------------------
function makeRegion(overrides: Partial<Region>): Region {
  return {
    id: 'r1',
    name: 'Test',
    inPoint: 0,
    outPoint: 10,
    bpm: 120,
    minStretch: 0.5,
    maxStretch: 2,
    addToEnd: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 1. BPM edit — anchors inside scale proportionally, outside are untouched
// ---------------------------------------------------------------------------
describe('stretchRescale — BPM edit', () => {
  it('doubles clipout length when BPM halves; rescales inside anchors', () => {
    const region = makeRegion({ inPoint: 0, outPoint: 10, bpm: 120, lockedBeats: 20 })
    // beat-space window is [0, 10] (default-linked, 10 s at 120 bpm = 20 beats)
    const beatAnchors = [
      { id: 1, time: 2.5 },  // 25 % into 10 s window
      { id: 2, time: 5 },    // 50 % into 10 s window
      { id: 3, time: 12 },   // outside window
    ]

    const result = stretchRescale({ region, newBpm: 60, beatAnchors })

    expect(result.bpm).toBe(60)
    expect(result.lockedBeats).toBe(20)
    expect(result.newClipoutLength).toBeCloseTo(20)
    expect(result.newOutBeatTime).toBeCloseTo(20)

    // Anchor 1: 25 % of 10 s = 2.5 → 25 % of 20 s = 5
    expect(result.rescaledBeatAnchors.get(1)).toBeCloseTo(5)
    // Anchor 2: 50 % → 10
    expect(result.rescaledBeatAnchors.get(2)).toBeCloseTo(10)
    // Anchor 3 (outside): not in the map
    expect(result.rescaledBeatAnchors.has(3)).toBe(false)
    expect(result.rescaledBeatAnchors.size).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 2. lockedBeats edit — BPM unchanged, length scales
// ---------------------------------------------------------------------------
describe('stretchRescale — lockedBeats edit', () => {
  it('halves clipout length when beats halve at the same BPM', () => {
    const region = makeRegion({ inPoint: 0, outPoint: 10, bpm: 120, lockedBeats: 20 })
    const beatAnchors = [
      { id: 1, time: 2.5 },
      { id: 2, time: 5 },
      { id: 3, time: 12 },
    ]

    const result = stretchRescale({ region, newLockedBeats: 10, beatAnchors })

    expect(result.bpm).toBe(120)
    expect(result.lockedBeats).toBe(10)
    expect(result.newClipoutLength).toBeCloseTo(5)  // 60 × 10 / 120 = 5
    expect(result.newOutBeatTime).toBeCloseTo(5)

    // Anchor 1: 25 % of 10 s → 25 % of 5 s = 1.25
    expect(result.rescaledBeatAnchors.get(1)).toBeCloseTo(1.25)
    // Anchor 2: 50 % → 2.5
    expect(result.rescaledBeatAnchors.get(2)).toBeCloseTo(2.5)
    // Anchor 3 outside
    expect(result.rescaledBeatAnchors.has(3)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 3. Diverged region — inBeatTime / outBeatTime present
// ---------------------------------------------------------------------------
describe('stretchRescale — diverged region (explicit inBeatTime/outBeatTime)', () => {
  it('uses beat-space bounds, not input-space bounds', () => {
    const region = makeRegion({
      inPoint: 0,
      outPoint: 10,
      inBeatTime: 2,
      outBeatTime: 6,
      bpm: 120,
      lockedBeats: 8,  // 4 s × 120 / 60 = 8
    })
    // Old beat-space window: [2, 6] = 4 s
    const beatAnchors = [{ id: 5, time: 3 }]  // 25 % into 4 s window from 2

    const result = stretchRescale({ region, newBpm: 60, beatAnchors })

    expect(result.newClipoutLength).toBeCloseTo(8)   // 60 × 8 / 60 = 8
    expect(result.newOutBeatTime).toBeCloseTo(10)    // 2 + 8 = 10

    // Anchor 5: inBeatTime=2, time=3 → offset 1 → 25 % of 4 s
    //           new offset = 1 × (8/4) = 2 → new position = 2 + 2 = 4
    expect(result.rescaledBeatAnchors.get(5)).toBeCloseTo(4)
  })
})

// ---------------------------------------------------------------------------
// 4. No lockedBeats on region — derived from (outBeatTime - inBeatTime) × bpm / 60
// ---------------------------------------------------------------------------
describe('stretchRescale — derive lockedBeats when missing', () => {
  it('derives lockedBeats from the window and confirms math', () => {
    // outPoint - inPoint = 10, bpm = 60 → lockedBeats = 10 × 60 / 60 = 10
    const region = makeRegion({ inPoint: 0, outPoint: 10, bpm: 60 })
    // Note: lockedBeats is NOT set on the region

    const result = stretchRescale({ region, newBpm: 30, beatAnchors: [] })

    // lockedBeats derived = 10; newClipoutLength = 60 × 10 / 30 = 20
    expect(result.lockedBeats).toBeCloseTo(10)
    expect(result.newClipoutLength).toBeCloseTo(20)
    expect(result.newOutBeatTime).toBeCloseTo(20)
  })
})

// ---------------------------------------------------------------------------
// 5. Validation errors
// ---------------------------------------------------------------------------
describe('stretchRescale — input validation', () => {
  const region = makeRegion({})
  const beatAnchors: never[] = []

  it('throws when both newBpm and newLockedBeats are provided', () => {
    expect(() =>
      stretchRescale({ region, newBpm: 120, newLockedBeats: 20, beatAnchors }),
    ).toThrow(/exactly one/)
  })

  it('throws when neither newBpm nor newLockedBeats is provided', () => {
    expect(() =>
      stretchRescale({ region, beatAnchors }),
    ).toThrow(/exactly one/)
  })
})

// ---------------------------------------------------------------------------
// 6. Edge case: zero-length region
// ---------------------------------------------------------------------------
describe('stretchRescale — zero-length region', () => {
  it('handles oldLength === 0 without NaN (scaleFactor = 1, anchors unchanged)', () => {
    const region = makeRegion({ inPoint: 5, outPoint: 5, bpm: 120, lockedBeats: 0 })
    const beatAnchors = [{ id: 10, time: 5 }]  // at boundary

    const result = stretchRescale({ region, newBpm: 60, beatAnchors })

    // newClipoutLength = 60 × 0 / 60 = 0; boundary anchor is rescaled (0 offset stays 0)
    expect(result.newClipoutLength).toBeCloseTo(0)
    expect(isNaN(result.newClipoutLength)).toBe(false)
    // Anchor at time 5 is at inBeatTime (5), offset=0, stays 5 regardless of scale
    expect(result.rescaledBeatAnchors.get(10)).toBeCloseTo(5)
  })
})

// ---------------------------------------------------------------------------
// 7. Boundary inclusivity
// ---------------------------------------------------------------------------
describe('stretchRescale — boundary inclusivity', () => {
  const region = makeRegion({ inPoint: 0, outPoint: 10, bpm: 120, lockedBeats: 20 })

  it('includes anchor exactly at inBeatTime (position stays at inBeatTime)', () => {
    const result = stretchRescale({
      region,
      newBpm: 60,
      beatAnchors: [{ id: 1, time: 0 }],
    })
    expect(result.rescaledBeatAnchors.has(1)).toBe(true)
    // offset is 0, stays at inBeatTime = 0
    expect(result.rescaledBeatAnchors.get(1)).toBeCloseTo(0)
  })

  it('includes anchor exactly at outBeatTime, rescaled to new outBeatTime', () => {
    const result = stretchRescale({
      region,
      newBpm: 60,
      beatAnchors: [{ id: 2, time: 10 }],
    })
    expect(result.rescaledBeatAnchors.has(2)).toBe(true)
    // anchor was at old outBeatTime (10); new outBeatTime is 20
    expect(result.rescaledBeatAnchors.get(2)).toBeCloseTo(20)
  })

  it('excludes anchor just outside outBeatTime', () => {
    const result = stretchRescale({
      region,
      newBpm: 60,
      beatAnchors: [{ id: 3, time: 10.001 }],
    })
    expect(result.rescaledBeatAnchors.has(3)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 8. Empty beatAnchors
// ---------------------------------------------------------------------------
describe('stretchRescale — empty beatAnchors', () => {
  it('returns empty Map and still computes clipout length correctly', () => {
    const region = makeRegion({ inPoint: 0, outPoint: 10, bpm: 120, lockedBeats: 20 })

    const result = stretchRescale({ region, newBpm: 60, beatAnchors: [] })

    expect(result.rescaledBeatAnchors.size).toBe(0)
    expect(result.newClipoutLength).toBeCloseTo(20)
    expect(result.newOutBeatTime).toBeCloseTo(20)
  })
})
