/**
 * @behavior region-creation::1166f
 *   Given a video is loaded and selected
 *   When a new region is created from the timeline
 *   Then it is created near the mouse with the smaller of: 10% of the current view's time or 5 seconds
 *
 * @behavior region-creation::da6c4
 *   Given a video is loaded and selected
 *   When a new region is created from the region list
 *   Then it is created near the playhead with the smaller of: 10% of the current view's time or 5 seconds
 *
 * Both behaviors share the same sizing formula and differ only in center point
 * (mouse cursor time vs playhead time). Tests cover the formula via the pure
 * utilities in src/utils/view.ts, which App.tsx and WarpView.tsx must use.
 *
 * NOTE: App.tsx (onNewRegion) and WarpView.tsx (context menu "New region here")
 * currently use a beat-based formula (Math.max(beat * 4, 2) / 2) instead of
 * calcNewRegionSpan/calcNewRegionBounds. Those call-sites must be updated to
 * make the integration pass the spec.
 */

import { describe, it, expect } from 'vitest'
import { calcNewRegionSpan, calcNewRegionBounds } from '../../utils/view'

// ── S3.1 + S3.2 shared: region size formula ───────────────────────────────────

describe('calcNewRegionSpan — size = min(10% of viewSpan, 5s)', () => {
  it('returns 10% of viewSpan when that is less than 5 seconds', () => {
    expect(calcNewRegionSpan(20)).toBeCloseTo(2)   // 10% of 20s = 2s
    expect(calcNewRegionSpan(40)).toBeCloseTo(4)   // 10% of 40s = 4s
  })

  it('caps at 5 seconds when 10% of viewSpan would exceed it', () => {
    expect(calcNewRegionSpan(60)).toBe(5)           // 10% of 60s = 6s → capped at 5
    expect(calcNewRegionSpan(120)).toBe(5)          // 10% of 120s = 12s → capped at 5
    expect(calcNewRegionSpan(1000)).toBe(5)
  })

  it('returns exactly 5 seconds at the 50-second breakpoint', () => {
    expect(calcNewRegionSpan(50)).toBe(5)           // 10% of 50s = 5s exactly
  })

  it('returns a very small span for a tightly zoomed view', () => {
    expect(calcNewRegionSpan(2)).toBeCloseTo(0.2)   // 10% of 2s = 0.2s
  })
})

// ── S3.1: region from timeline — centered on mouse cursor ────────────────────

describe('calcNewRegionBounds — S3.1 from timeline (near mouse)', () => {
  it('centers the region on the given time', () => {
    // viewSpan=40 → span=4 → half=2; center=10 → [8, 12]
    const { inPoint, outPoint } = calcNewRegionBounds(10, 40, 120)
    expect(inPoint).toBeCloseTo(8)
    expect(outPoint).toBeCloseTo(12)
  })

  it('clamps inPoint to 0 when the center is near the start', () => {
    // viewSpan=40 → span=4 → half=2; center=1 → unclamped [-1, 3] → clamped [0, 3]
    const { inPoint, outPoint } = calcNewRegionBounds(1, 40, 120)
    expect(inPoint).toBe(0)
    expect(outPoint).toBeCloseTo(3)
  })

  it('clamps outPoint to videoDuration when the center is near the end', () => {
    // viewSpan=40 → span=4 → half=2; center=119 → unclamped [117, 121] → clamped [117, 120]
    const { inPoint, outPoint } = calcNewRegionBounds(119, 40, 120)
    expect(inPoint).toBeCloseTo(117)
    expect(outPoint).toBe(120)
  })

  it('caps region size at 5s regardless of how wide the viewport is', () => {
    // viewSpan=200 → span=5 → half=2.5; center=50 → [47.5, 52.5]
    const { inPoint, outPoint } = calcNewRegionBounds(50, 200, 300)
    expect(outPoint - inPoint).toBeCloseTo(5)
    expect(inPoint).toBeCloseTo(47.5)
    expect(outPoint).toBeCloseTo(52.5)
  })
})

// ── S3.2: region from region list — centered on playhead ─────────────────────
//
// Same formula, different caller (playhead instead of mouse cursor time).
// The math is identical so these tests verify the contract with the playhead
// as the center argument.

describe('calcNewRegionBounds — S3.2 from region list (near playhead)', () => {
  it('centers the region on the playhead position', () => {
    // viewSpan=30 → span=3 → half=1.5; playhead=60 → [58.5, 61.5]
    const { inPoint, outPoint } = calcNewRegionBounds(60, 30, 120)
    expect(inPoint).toBeCloseTo(58.5)
    expect(outPoint).toBeCloseTo(61.5)
  })

  it('clamps inPoint to 0 when playhead is near the start', () => {
    const { inPoint } = calcNewRegionBounds(0.5, 30, 120)
    expect(inPoint).toBe(0)
  })

  it('clamps outPoint to videoDuration when playhead is near the end', () => {
    const { outPoint } = calcNewRegionBounds(119.5, 30, 120)
    expect(outPoint).toBe(120)
  })

  it('the total span never exceeds 5 seconds', () => {
    const { inPoint, outPoint } = calcNewRegionBounds(60, 500, 1000)
    expect(outPoint - inPoint).toBeLessThanOrEqual(5)
  })
})
