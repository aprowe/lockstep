import { describe, it, expect } from 'vitest'
import {
  anchorDragInputTargets,
  anchorDragOutputGrid,
  regionDragTargets,
  smallestVisibleBeatGridSec,
} from '../../../../src/timeline/model/snapTarget'
import type { Anchor } from '../../../../src/types'

describe('anchorDragInputTargets', () => {
  it('returns scene times and region edges as targets', () => {
    const targets = anchorDragInputTargets(
      [12, 18],
      [{ inPoint: 10, outPoint: 20 } as any, { inPoint: 30, outPoint: 40 } as any],
    )
    expect(targets).toEqual([
      { time: 12, source: 'scene' },
      { time: 18, source: 'scene' },
      { time: 10, source: 'scene' },
      { time: 20, source: 'scene' },
      { time: 30, source: 'scene' },
      { time: 40, source: 'scene' },
    ])
  })

  it('returns empty when no scenes and no regions', () => {
    expect(anchorDragInputTargets([], [])).toEqual([])
  })
})

describe('anchorDragOutputGrid', () => {
  it('returns null when snapInterval is 0 or unset', () => {
    expect(anchorDragOutputGrid(undefined, 0, 120, 800, 60)).toBeNull()
    expect(anchorDragOutputGrid(0.5, 0, 120, 800, 0)).toBeNull()
  })

  it('returns a grid clamped to smallest-visible-tick spacing', () => {
    const grid = anchorDragOutputGrid(0.5, 0, 100, 800, 60)
    expect(grid).not.toBeNull()
    expect(grid!.interval).toBeGreaterThanOrEqual(0.5)
  })
})

describe('regionDragTargets', () => {
  const anchors: Anchor[] = [{ id: 1, time: 5 }]
  const beatAnchors: Anchor[] = [{ id: 1, time: 2.5 }]
  const regions = [
    { id: 'a', inPoint: 10, outPoint: 20 },
    { id: 'b', inPoint: 30, outPoint: 40 },
  ] as any[]

  it('input space includes anchors + scenes + other regions edges; excludes self', () => {
    const { targets, grid } = regionDragTargets({
      isOutput: false,
      anchors, beatAnchors,
      scenes: [50],
      regions, excludeId: 'a',
      viewSpan: 100, canvasWidth: 800, bpm: 60,
      snapInterval: 0.5, snapOffset: 0,
    })
    expect(targets).toEqual([
      { time: 5, source: 'anchor' },
      { time: 50, source: 'scene' },
      { time: 30, source: 'scene' },
      { time: 40, source: 'scene' },
    ])
    expect(grid).toBeUndefined()
  })

  it('output space uses beat anchors + other regions; excludes scenes; sets grid', () => {
    const { targets, grid } = regionDragTargets({
      isOutput: true,
      anchors, beatAnchors,
      scenes: [50],
      regions, excludeId: 'a',
      viewSpan: 100, canvasWidth: 800, bpm: 60,
      snapInterval: 0.5, snapOffset: 0,
    })
    expect(targets).toEqual([
      { time: 2.5, source: 'anchor' },
      { time: 30, source: 'scene' },
      { time: 40, source: 'scene' },
    ])
    expect(grid).not.toBeUndefined()
  })

  it('gridChanging: excludes beat anchors and grid', () => {
    const { targets, grid } = regionDragTargets({
      isOutput: true,
      anchors, beatAnchors,
      scenes: [50],
      regions, excludeId: 'a',
      viewSpan: 100, canvasWidth: 800, bpm: 60,
      snapInterval: 0.5, snapOffset: 0,
      gridChanging: true,
    })
    expect(targets).not.toContainEqual({ time: 2.5, source: 'anchor' })
    expect(grid).toBeUndefined()
    // other-clips edges still present
    expect(targets).toContainEqual({ time: 30, source: 'scene' })
    expect(targets).toContainEqual({ time: 40, source: 'scene' })
  })

  it('gridChanging with selfRegion: adds beat-space in/out as region-edge targets (no origToBeat projection)', () => {
    // selfRegion values are already in beat-space (captured from regionsOutput at drag start).
    // They must NOT be projected through origToBeat — that would create a feedback loop where
    // snapping to the target changes the target itself on the next frame.
    const { targets, grid } = regionDragTargets({
      isOutput: true,
      anchors, beatAnchors,
      scenes: [],
      regions: [],
      excludeId: 'self',
      viewSpan: 100, canvasWidth: 800, bpm: 60,
      snapInterval: 0.5, snapOffset: 0,
      gridChanging: true,
      selfRegion: { inPoint: 4, outPoint: 8 },
    })
    expect(targets).toContainEqual({ time: 4, source: 'region-edge' })
    expect(targets).toContainEqual({ time: 8, source: 'region-edge' })
    expect(grid).toBeUndefined()
  })

  it('gridChanging without selfRegion: no self-clip targets added', () => {
    const { targets } = regionDragTargets({
      isOutput: true,
      anchors, beatAnchors,
      scenes: [],
      regions: [],
      excludeId: 'self',
      viewSpan: 100, canvasWidth: 800, bpm: 60,
      gridChanging: true,
    })
    expect(targets).toHaveLength(0)
  })
})

describe('smallestVisibleBeatGridSec', () => {
  it('returns Infinity for invalid inputs', () => {
    expect(smallestVisibleBeatGridSec(0, 800, 60)).toBe(Number.POSITIVE_INFINITY)
    expect(smallestVisibleBeatGridSec(100, 0, 60)).toBe(Number.POSITIVE_INFINITY)
    expect(smallestVisibleBeatGridSec(100, 800, 0)).toBe(Number.POSITIVE_INFINITY)
  })

  it('returns sub-beat spacing at high zoom (large ppb)', () => {
    expect(smallestVisibleBeatGridSec(10, 1000, 60)).toBeCloseTo(0.25)
  })
})
