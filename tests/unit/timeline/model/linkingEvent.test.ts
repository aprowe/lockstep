import { describe, it, expect } from 'vitest'
import { commitLinkingEvent } from '../../../../src/timeline/model/linkingEvent'
import type { Anchor, Region } from '../../../../src/types'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRegion(overrides: Partial<Region> = {}): Region {
  const base = {
    id: 'r1',
    name: 'Test Region',
    inPoint: 5,
    outPoint: 10,
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

function makeAnchor(time: number, id = 1): Anchor {
  return { id, time }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('commitLinkingEvent', () => {
  it('in-edge linking on a default-linked region (inBeatTime=inPoint, outBeatTime=outPoint)', () => {
    // Default-linked region: inBeatTime=inPoint=5, outBeatTime=outPoint=10
    // beatAnchor at 4 (shifted beat-space in-edge)
    // Expected: inBeatTime=4, outBeatTime=10, lockedBeats=(10-4)*120/60=12
    const region = makeRegion({ inPoint: 5, outPoint: 10, bpm: 120 })
    const result = commitLinkingEvent({
      region,
      edge: 'in',
      side: 'input',
      beatAnchor: makeAnchor(4),
    })
    expect(result.inBeatTime).toBeCloseTo(4, 6)
    expect(result.outBeatTime).toBeCloseTo(10, 6)
    expect(result.lockedBeats).toBeCloseTo(12, 6)
    expect(result.bpm).toBe(120)
  })

  it('out-edge linking: lockedBeats is derived from new length (lock-bypass always)', () => {
    // Linking event always uses lock='bpm' math — lockedBeats is derived from new length
    // beatAnchor at 11; outBeatTime becomes 11
    // Expected: inBeatTime=5 (from inPoint), outBeatTime=11, lockedBeats=(11-5)*120/60=12
    const region = makeRegion({
      inPoint: 5,
      outPoint: 10,
      bpm: 120,
      lockedBeats: 10,
    })
    const result = commitLinkingEvent({
      region,
      edge: 'out',
      side: 'input',
      beatAnchor: makeAnchor(11),
    })
    expect(result.inBeatTime).toBeCloseTo(5, 6)
    expect(result.outBeatTime).toBeCloseTo(11, 6)
    expect(result.lockedBeats).toBeCloseTo(12, 6)
    expect(result.bpm).toBe(120)
  })

  it('diverged region, in-edge linking: preserves existing outBeatTime', () => {
    // region has explicit beat times that diverge from input-space bounds
    // beatAnchor at 4 moves in-edge; outBeatTime=8 is preserved
    // Expected: inBeatTime=4, outBeatTime=8, lockedBeats=(8-4)*120/60=8
    const region = makeRegion({
      inPoint: 5,
      outPoint: 10,
      inBeatTime: 3,
      outBeatTime: 8,
      bpm: 120,
    })
    const result = commitLinkingEvent({
      region,
      edge: 'in',
      side: 'input',
      beatAnchor: makeAnchor(4),
    })
    expect(result.inBeatTime).toBeCloseTo(4, 6)
    expect(result.outBeatTime).toBeCloseTo(8, 6)
    expect(result.lockedBeats).toBeCloseTo(8, 6)
    expect(result.bpm).toBe(120)
  })

  it('lock-bypass: lockedBeats is derived from new length, NOT preserved from region', () => {
    // Linking event always uses lock='bpm' math — lockedBeats is overwritten
    const region = makeRegion({
      inPoint: 5,
      outPoint: 10,
      bpm: 120,
      lockedBeats: 7,
    })
    const result = commitLinkingEvent({
      region,
      edge: 'out',
      side: 'output',
      beatAnchor: makeAnchor(11),
    })
    // (11-5) * 120/60 = 12, not 7
    expect(result.lockedBeats).toBeCloseTo(12, 6)
    expect(result.lockedBeats).not.toBe(7)
  })

  it('output-side behaves identically to input-side — side is informational only', () => {
    // Same inputs, same math — only the `side` field differs
    const region = makeRegion({ inPoint: 5, outPoint: 10, bpm: 120 })
    const beatAnchor = makeAnchor(4)

    const inputSide = commitLinkingEvent({ region, edge: 'in', side: 'input', beatAnchor })
    const outputSide = commitLinkingEvent({ region, edge: 'in', side: 'output', beatAnchor })

    expect(inputSide).toEqual(outputSide)
  })

  it('result always includes bpm and lockedBeats (lock-bypass: always lock-bpm semantics)', () => {
    // lock is global (ui.lockMode) — linkingEvent doesn't echo it
    const region = makeRegion({ bpm: 120 })
    const result = commitLinkingEvent({ region, edge: 'in', side: 'input', beatAnchor: makeAnchor(4) })
    expect(result.bpm).toBe(120)
    expect(typeof result.lockedBeats).toBe('number')
  })
})
