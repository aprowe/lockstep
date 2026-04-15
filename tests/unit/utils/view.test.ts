import { describe, it, expect } from 'vitest'
import { clampView, timeToViewPct, beatGridOpacity, initialView, MIN_VISIBLE } from '../../../src/utils/view'
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
