import { describe, it, expect } from 'vitest'
import {
  clampView,
  timeToViewPct,
  beatGridOpacity,
  initialView,
  MIN_VISIBLE,
  findSurroundingScenes,
  calcNewRegionBoundsFromScenes,
  ensureTimeInView,
} from '../../../src/utils/view'
import type { View } from '../../../src/types'

describe('clampView', () => {
  it('returns a normal view unchanged', () => {
    const v = clampView(0, 10, 60)
    expect(v).toEqual({ start: 0, end: 10 })
  })

  it('clamps start below 0', () => {
    const v = clampView(-5, 10, 60)
    expect(v.start).toBeGreaterThanOrEqual(0)
  })

  it('clamps end beyond maxDuration', () => {
    const v = clampView(50, 70, 60)
    expect(v.end).toBeLessThanOrEqual(60)
  })

  it('enforces MIN_VISIBLE minimum span', () => {
    const v = clampView(5, 5, 60)
    expect(v.end - v.start).toBeGreaterThanOrEqual(MIN_VISIBLE)
  })

  it('adjusts start when end hits maxDuration', () => {
    const v = clampView(55, 75, 60)
    expect(v.end).toBeCloseTo(60)
    expect(v.start).toBeCloseTo(40)
  })
})

describe('timeToViewPct', () => {
  const view: View = { start: 10, end: 30 }

  it('maps view.start to 0%', () => {
    expect(timeToViewPct(10, view)).toBeCloseTo(0)
  })

  it('maps view.end to 100%', () => {
    expect(timeToViewPct(30, view)).toBeCloseTo(100)
  })

  it('maps the midpoint to 50%', () => {
    expect(timeToViewPct(20, view)).toBeCloseTo(50)
  })

  it('returns negative for times before view.start', () => {
    expect(timeToViewPct(0, view)).toBeLessThan(0)
  })

  it('returns > 100 for times past view.end', () => {
    expect(timeToViewPct(40, view)).toBeGreaterThan(100)
  })
})

describe('beatGridOpacity', () => {
  it('returns 0 for invalid bpm', () => {
    expect(beatGridOpacity({ start: 0, end: 10 }, 0)).toBe(0)
  })

  it('returns 1 when fewer than 80 beats are visible', () => {
    expect(beatGridOpacity({ start: 0, end: 30 }, 120)).toBe(1)
  })

  it('returns 0 when more than 120 beats are visible', () => {
    expect(beatGridOpacity({ start: 0, end: 120 }, 120)).toBe(0)
  })

  it('returns a value in (0, 1) in the fade zone (80–120 beats)', () => {
    const opacity = beatGridOpacity({ start: 0, end: 50 }, 120)
    expect(opacity).toBeGreaterThan(0)
    expect(opacity).toBeLessThan(1)
  })
})

describe('initialView', () => {
  it('shows full duration when no bpm given', () => {
    const v = initialView(60)
    expect(v).toEqual({ start: 0, end: 60 })
  })

  it('shows full duration for short clips (≤32 beats)', () => {
    const v = initialView(16, 120)
    expect(v).toEqual({ start: 0, end: 16 })
  })

  it('caps to ~24 beats for long clips', () => {
    const v = initialView(300, 120)
    expect(v.start).toBe(0)
    expect(v.end).toBeCloseTo(12)
  })
})

describe('findSurroundingScenes', () => {
  it('brackets cursor between two cuts', () => {
    expect(findSurroundingScenes(7, [3, 10, 18], 20)).toEqual({ prev: 3, next: 10 })
  })

  it('uses 0 as the prev boundary when cursor is before the first cut', () => {
    expect(findSurroundingScenes(1, [5, 10], 20)).toEqual({ prev: 0, next: 5 })
  })

  it('uses duration as the next boundary when cursor is past the last cut', () => {
    expect(findSurroundingScenes(15, [5, 10], 20)).toEqual({ prev: 10, next: 20 })
  })

  it('returns null for zero-duration videos', () => {
    expect(findSurroundingScenes(0, [], 0)).toBeNull()
  })

  it('ignores cuts at or outside the video bounds', () => {
    expect(findSurroundingScenes(5, [-1, 0, 15, 20, 25], 20)).toEqual({ prev: 0, next: 15 })
  })
})

describe('calcNewRegionBoundsFromScenes', () => {
  const view: View = { start: 0, end: 20 }

  it('returns prev/next scene bounds when both are in view', () => {
    expect(calcNewRegionBoundsFromScenes(7, view, [3, 10, 18], 30))
      .toEqual({ inPoint: 3, outPoint: 10 })
  })

  it('falls back to calcNewRegionBounds when the next scene is past view.end', () => {
    const narrow: View = { start: 0, end: 8 }
    const result = calcNewRegionBoundsFromScenes(7, narrow, [3, 10, 18], 30)
    // Fallback: inPoint = cursor, span = max(viewSpan*0.1, 5)
    expect(result.inPoint).toBe(7)
    expect(result.outPoint).toBeCloseTo(12)
  })

  it('falls back when there are no scene cuts', () => {
    const result = calcNewRegionBoundsFromScenes(5, view, [], 30)
    expect(result.inPoint).toBe(5)
    expect(result.outPoint).toBeCloseTo(10)
  })

  it('falls back when surrounding scenes are too close together', () => {
    // Cuts at 6.9 and 7.1 — span 0.2 < MIN_VISIBLE
    const result = calcNewRegionBoundsFromScenes(7, view, [6.9, 7.1], 30)
    expect(result.inPoint).toBe(7)
  })
})

describe('ensureTimeInView', () => {
  it('returns the same view when time is inside', () => {
    const v: View = { start: 10, end: 20 }
    expect(ensureTimeInView(v, 15, 60)).toBe(v)
  })

  it('centers view on time when time is left of view', () => {
    const v: View = { start: 30, end: 40 }
    const next = ensureTimeInView(v, 20, 60)
    expect(next.end - next.start).toBeCloseTo(10)
    expect((next.start + next.end) / 2).toBeCloseTo(20)
  })

  it('centers view on time when time is right of view', () => {
    const v: View = { start: 0, end: 10 }
    const next = ensureTimeInView(v, 40, 60)
    expect(next.end - next.start).toBeCloseTo(10)
    expect((next.start + next.end) / 2).toBeCloseTo(40)
  })

  it('clamps to video bounds when time is near the start', () => {
    const v: View = { start: 30, end: 40 }
    const next = ensureTimeInView(v, 2, 60)
    expect(next.start).toBe(0)
  })
})
