import { describe, it, expect } from 'vitest'
import { computeSnap, pixelsToSeconds, type SnapSource, type SnapTarget } from '../../../src/utils/snap'

const target = (time: number, source: SnapSource = 'anchor', id?: string | number): SnapTarget => ({ time, source, id })

describe('computeSnap — contract', () => {
  it('returns no snap when subjects is empty', () => {
    expect(computeSnap({ subjects: [], targets: [target(0)], thresholdSec: 1 }))
      .toEqual({ delta: 0, hit: null })
  })

  it('returns no snap when there are no targets and no grid', () => {
    expect(computeSnap({ subjects: [1], thresholdSec: 1 }))
      .toEqual({ delta: 0, hit: null })
  })

  it('returns no snap when threshold is zero or negative', () => {
    expect(computeSnap({ subjects: [1], targets: [target(1)], thresholdSec: 0 }))
      .toEqual({ delta: 0, hit: null })
    expect(computeSnap({ subjects: [1], targets: [target(1)], thresholdSec: -0.5 }))
      .toEqual({ delta: 0, hit: null })
  })

  it('does not snap when the nearest target is outside the threshold', () => {
    const res = computeSnap({ subjects: [1.0], targets: [target(1.5)], thresholdSec: 0.2 })
    expect(res.delta).toBe(0)
    expect(res.hit).toBeNull()
  })
})

describe('computeSnap — single subject', () => {
  it('snaps to the nearest target within threshold', () => {
    const res = computeSnap({
      subjects: [1.03],
      targets: [target(0.5), target(1.0), target(2.0)],
      thresholdSec: 0.1,
    })
    expect(res.delta).toBeCloseTo(-0.03)
    expect(res.hit?.target.time).toBe(1.0)
    expect(res.hit?.subjectIndex).toBe(0)
  })

  it('prefers the closer of two in-threshold targets', () => {
    const res = computeSnap({
      subjects: [1.0],
      targets: [target(0.95), target(1.03)],
      thresholdSec: 0.1,
    })
    expect(res.hit?.target.time).toBe(1.03)
  })

  it('preserves the matching target id on the hit', () => {
    const res = computeSnap({
      subjects: [1.0],
      targets: [target(1.02, 'anchor', 42)],
      thresholdSec: 0.1,
    })
    expect(res.hit?.target.id).toBe(42)
  })
})

describe('computeSnap — multi-subject rigid body (e.g. region in/out)', () => {
  it('picks whichever subject lands closest to a target and deltas both', () => {
    // Region [1.0, 3.0] with an anchor just past the out edge:
    // the out edge (subject 1) is closer, so both edges shift right by 0.05.
    const res = computeSnap({
      subjects: [1.0, 3.0],
      targets: [target(0.7), target(3.05)],
      thresholdSec: 0.2,
    })
    expect(res.delta).toBeCloseTo(0.05)
    expect(res.hit?.subjectIndex).toBe(1)
    expect(res.hit?.target.time).toBe(3.05)
  })

  it('lets the in-edge win when it is closer than the out-edge', () => {
    const res = computeSnap({
      subjects: [1.0, 3.0],
      targets: [target(0.98), target(3.1)],
      thresholdSec: 0.2,
    })
    expect(res.delta).toBeCloseTo(-0.02)
    expect(res.hit?.subjectIndex).toBe(0)
    expect(res.hit?.target.time).toBe(0.98)
  })

  it('applies the same delta to every subject so rigid spacing is preserved', () => {
    const subjects = [1.0, 3.0, 5.0]
    const res = computeSnap({
      subjects,
      targets: [target(3.05)],
      thresholdSec: 0.1,
    })
    const moved = subjects.map(s => s + res.delta)
    expect(moved[1] - moved[0]).toBeCloseTo(2.0)
    expect(moved[2] - moved[1]).toBeCloseTo(2.0)
    expect(moved[1]).toBeCloseTo(3.05)
  })
})

describe('computeSnap — periodic grid', () => {
  it('snaps a single subject to the nearest grid line', () => {
    const res = computeSnap({
      subjects: [1.03],
      grid: { interval: 0.5, offset: 0 },
      thresholdSec: 0.1,
    })
    expect(res.delta).toBeCloseTo(-0.03)
    expect(res.hit?.target.time).toBeCloseTo(1.0)
    expect(res.hit?.target.source).toBe('beat-grid')
  })

  it('honours the grid offset', () => {
    // Grid hits at 0.1, 0.6, 1.1, 1.6 …
    const res = computeSnap({
      subjects: [1.08],
      grid: { interval: 0.5, offset: 0.1 },
      thresholdSec: 0.1,
    })
    expect(res.hit?.target.time).toBeCloseTo(1.1)
  })

  it('ignores grids with non-positive interval', () => {
    const res = computeSnap({
      subjects: [1.03],
      grid: { interval: 0 },
      thresholdSec: 0.1,
    })
    expect(res.hit).toBeNull()
  })

  it('each subject picks its own nearest grid line when snapping rigidly', () => {
    // Grid interval 1.0. Subjects at 1.02 and 4.95.
    // Subject 0 → 1.00 (Δ=0.02), subject 1 → 5.00 (Δ=0.05).
    // Subject 0 wins, both shift by −0.02.
    const res = computeSnap({
      subjects: [1.02, 4.95],
      grid: { interval: 1.0 },
      thresholdSec: 0.1,
    })
    expect(res.hit?.subjectIndex).toBe(0)
    expect(res.delta).toBeCloseTo(-0.02)
  })
})

describe('computeSnap — enabledSources toggle', () => {
  it('skips targets whose source is not enabled', () => {
    const res = computeSnap({
      subjects: [1.0],
      targets: [target(1.02, 'playhead')],
      thresholdSec: 0.1,
      enabledSources: new Set<SnapSource>(['anchor']),
    })
    expect(res.hit).toBeNull()
  })

  it('skips the grid when beat-grid is disabled', () => {
    const res = computeSnap({
      subjects: [1.02],
      grid: { interval: 0.5 },
      thresholdSec: 0.1,
      enabledSources: new Set<SnapSource>(['anchor']),
    })
    expect(res.hit).toBeNull()
  })

  it('falls through to a still-enabled source when the preferred one is off', () => {
    // Grid at 1.0 (Δ=0.01), playhead at 1.03 (Δ=0.02).
    // Without filtering the grid would win; disable it and the playhead wins.
    const res = computeSnap({
      subjects: [1.01],
      targets: [target(1.03, 'playhead')],
      grid: { interval: 1.0 },
      thresholdSec: 0.1,
      enabledSources: new Set<SnapSource>(['playhead']),
    })
    expect(res.hit?.target.source).toBe('playhead')
    expect(res.delta).toBeCloseTo(0.02)
  })

  it('uses a custom grid source label when filtering', () => {
    const res = computeSnap({
      subjects: [1.01],
      grid: { interval: 1.0, source: 'scene' },
      thresholdSec: 0.1,
      enabledSources: new Set<SnapSource>(['scene']),
    })
    expect(res.hit?.target.source).toBe('scene')
  })
})

describe('computeSnap — mixed targets + grid', () => {
  it('picks the globally closest match across both', () => {
    // Grid 1.0 → nearest 1.0 (Δ=0.02). Anchor at 1.01 (Δ=0.01). Anchor wins.
    const res = computeSnap({
      subjects: [1.02],
      targets: [target(1.01, 'anchor', 'A')],
      grid: { interval: 1.0 },
      thresholdSec: 0.1,
    })
    expect(res.hit?.target.source).toBe('anchor')
    expect(res.hit?.target.id).toBe('A')
  })
})

describe('pixelsToSeconds', () => {
  it('scales pixel threshold into view-space seconds', () => {
    expect(pixelsToSeconds(8, 800, 10)).toBeCloseTo(0.1)
  })

  it('returns 0 when pixel width is zero (not a real rect yet)', () => {
    expect(pixelsToSeconds(8, 0, 10)).toBe(0)
  })
})
