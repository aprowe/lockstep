import { it, expect } from 'vitest'
import { calcNewRegionSpan, calcNewRegionBounds } from '../../src/utils/view'
import { behaviorTest } from '../helpers/runBehavior'

// region-creation::3855ff5e
// Scenario Outline: New region size is the smaller of 10% of view or 5 seconds

behaviorTest('region-creation::3855ff5e', () => {
  it('returns 10% of viewSpan when that is less than 5 seconds', () => {
    expect(calcNewRegionSpan(20)).toBeCloseTo(2)
    expect(calcNewRegionSpan(40)).toBeCloseTo(4)
  })

  it('caps at 5 seconds when 10% of viewSpan exceeds it', () => {
    expect(calcNewRegionSpan(60)).toBe(5)
    expect(calcNewRegionSpan(120)).toBe(5)
    expect(calcNewRegionSpan(1000)).toBe(5)
  })

  it('returns exactly 5 seconds at the 50-second breakpoint', () => {
    expect(calcNewRegionSpan(50)).toBe(5)
  })

  it('returns a very small span for a tightly zoomed view', () => {
    expect(calcNewRegionSpan(2)).toBeCloseTo(0.2)
  })
})

// region-creation::50730318
// New region from the timeline is is aligned on the cursor position

behaviorTest('region-creation::50730318', () => {
  it('starts the region at the cursor position', () => {
    const { inPoint, outPoint } = calcNewRegionBounds(10, 40, 120)
    expect(inPoint).toBeCloseTo(10)
    expect(outPoint).toBeCloseTo(14)
  })

  it('aligns correctly at a mid-timeline position', () => {
    const { inPoint, outPoint } = calcNewRegionBounds(60, 40, 120)
    expect(inPoint).toBeCloseTo(60)
    expect(outPoint).toBeCloseTo(64)
  })

  it('caps region size at 5s regardless of viewport width', () => {
    const { inPoint, outPoint } = calcNewRegionBounds(50, 200, 300)
    expect(outPoint - inPoint).toBeCloseTo(5)
    expect(inPoint).toBeCloseTo(50)
    expect(outPoint).toBeCloseTo(55)
  })
})

// region-creation::7c76059f
// New region from the region list is aligned on the playhead

behaviorTest('region-creation::7c76059f', () => {
  it('starts the region at the playhead position', () => {
    const { inPoint, outPoint } = calcNewRegionBounds(60, 30, 120)
    expect(inPoint).toBeCloseTo(60)
    expect(outPoint).toBeCloseTo(63)
  })

  it('total span never exceeds 5 seconds', () => {
    const { inPoint, outPoint } = calcNewRegionBounds(60, 500, 1000)
    expect(outPoint - inPoint).toBeLessThanOrEqual(5)
  })
})

// region-creation::1cd7c8b4
// Region is clamped to the start of the video

behaviorTest('region-creation::1cd7c8b4', () => {
  it('inPoint is 0 when cursor is at the very start', () => {
    const { inPoint } = calcNewRegionBounds(0, 40, 120)
    expect(inPoint).toBe(0)
  })

  it('inPoint is 0 when cursor would be negative', () => {
    const { inPoint } = calcNewRegionBounds(-1, 40, 120)
    expect(inPoint).toBe(0)
  })
})

// region-creation::9e815d8d
// Region is clamped to the end of the video

behaviorTest('region-creation::9e815d8d', () => {
  it('outPoint is clamped to videoDuration when the center is near the end', () => {
    const { outPoint } = calcNewRegionBounds(119.5, 40, 120)
    expect(outPoint).toBe(120)
  })

  it('outPoint is clamped to duration when center equals duration', () => {
    const { outPoint } = calcNewRegionBounds(120, 40, 120)
    expect(outPoint).toBe(120)
  })
})
