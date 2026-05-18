import { describe, it, expect } from 'vitest'
import {
  clampView,
  timeToViewPct,
  beatGridOpacity,
  initialView,
  MIN_VISIBLE,
  scrollViewToTime,
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

describe('scrollViewToTime', () => {
  it('returns the same view when time is inside', () => {
    const v: View = { start: 10, end: 20 }
    expect(scrollViewToTime(v, 15, 60)).toBe(v)
  })

  it('preserves the span when scrolling right', () => {
    const v: View = { start: 0, end: 10 }
    const next = scrollViewToTime(v, 40, 60)
    expect(next.end - next.start).toBeCloseTo(10)
  })

  it('preserves the span when scrolling left', () => {
    const v: View = { start: 30, end: 40 }
    const next = scrollViewToTime(v, 20, 60)
    expect(next.end - next.start).toBeCloseTo(10)
  })

  it('places time near the right edge (with margin) when scrolling right', () => {
    // span=10, margin=1.0 (10%). time=40 sits 1s inside the right edge
    // → next.end = 41, next.start = 31.
    const v: View = { start: 0, end: 10 }
    const next = scrollViewToTime(v, 40, 60)
    expect(next.start).toBeCloseTo(31)
    expect(next.end).toBeCloseTo(41)
  })

  it('places time near the left edge (with margin) when scrolling left', () => {
    // time=20 sits 1s inside the left edge → next.start = 19, next.end = 29.
    const v: View = { start: 30, end: 40 }
    const next = scrollViewToTime(v, 20, 60)
    expect(next.start).toBeCloseTo(19)
    expect(next.end).toBeCloseTo(29)
  })

  it('does not recenter — leaves target near the edge, not the middle', () => {
    const v: View = { start: 0, end: 10 }
    const next = scrollViewToTime(v, 40, 60)
    const mid = (next.start + next.end) / 2
    // If it recentered, mid would be ~40. Scroll-to-edge keeps target ~1s inside.
    expect(mid).toBeLessThan(38)
  })

  it('clamps to 0 when scrolling close to the start', () => {
    // span=10, margin=1. time=0.5 would put start=-0.5 → clamps to 0.
    const v: View = { start: 30, end: 40 }
    const next = scrollViewToTime(v, 0.5, 60)
    expect(next.start).toBe(0)
    expect(next.end).toBeCloseTo(10)
  })

  it('clamps to duration when scrolling close to the end', () => {
    // span=10, margin=1. time=59.5 would put end=60.5 → clamps to 60.
    const v: View = { start: 0, end: 10 }
    const next = scrollViewToTime(v, 59.5, 60)
    expect(next.end).toBe(60)
    expect(next.start).toBeCloseTo(50)
  })

  it('uses a minimum 0.25s margin when the span is very small', () => {
    // span=1, 10% = 0.1 — below floor, so margin = 0.25.
    // time=5 lands at view.end - 0.25 = 5 → next.end = 5.25, next.start = 4.25.
    const v: View = { start: 0, end: 1 }
    const next = scrollViewToTime(v, 5, 60)
    expect(next.start).toBeCloseTo(4.25)
    expect(next.end).toBeCloseTo(5.25)
  })
})
