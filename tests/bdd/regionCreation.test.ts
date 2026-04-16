import { it, expect } from 'vitest'
import { calcNewRegionSpan, calcNewRegionBounds } from '../../src/utils/view'
import { behaviorTest } from '../helpers/runBehavior'

// region-creation::30fd066b
// Scenario Outline: New region size is the larger of 10% of view or 5 seconds

behaviorTest('region-creation::30fd066b', () => {
  it('returns 5 seconds when 10% of viewSpan is less than 5 seconds', () => {
    expect(calcNewRegionSpan(20)).toBe(5)
    expect(calcNewRegionSpan(40)).toBe(5)
  })

  it('returns 10% of viewSpan when that exceeds 5 seconds', () => {
    expect(calcNewRegionSpan(200)).toBeCloseTo(20)
    expect(calcNewRegionSpan(100)).toBeCloseTo(10)
  })

  it('returns exactly 5 seconds at the 50-second breakpoint', () => {
    expect(calcNewRegionSpan(50)).toBe(5)
  })
})

// region-creation::089f7025
// New region from the timeline is is aligned on the cursor position

behaviorTest('region-creation::089f7025', () => {
  it('starts the region at the cursor position', () => {
    const { inPoint, outPoint } = calcNewRegionBounds(10, 40, 120)
    expect(inPoint).toBeCloseTo(10)
    expect(outPoint).toBeCloseTo(15)
  })

  it('aligns correctly at a mid-timeline position', () => {
    const { inPoint, outPoint } = calcNewRegionBounds(60, 40, 120)
    expect(inPoint).toBeCloseTo(60)
    expect(outPoint).toBeCloseTo(65)
  })

  it('uses 10% of viewport when that exceeds 5 seconds', () => {
    const { inPoint, outPoint } = calcNewRegionBounds(50, 200, 300)
    expect(outPoint - inPoint).toBeCloseTo(20)
    expect(inPoint).toBeCloseTo(50)
    expect(outPoint).toBeCloseTo(70)
  })
})

// region-creation::622d79ba
// New region from the region list is aligned on the playhead

behaviorTest('region-creation::622d79ba', () => {
  it('starts the region at the playhead position', () => {
    const { inPoint, outPoint } = calcNewRegionBounds(60, 40, 120)
    expect(inPoint).toBeCloseTo(60)
    expect(outPoint).toBeCloseTo(65)
  })

  it('span is at least 5 seconds regardless of viewport width', () => {
    const { inPoint, outPoint } = calcNewRegionBounds(60, 30, 120)
    expect(outPoint - inPoint).toBeGreaterThanOrEqual(5)
  })
})

// region-creation::beaf3038
// Region is clamped to the start of the video

behaviorTest('region-creation::beaf3038', () => {
  it('inPoint is 0 when cursor is at the very start', () => {
    const { inPoint } = calcNewRegionBounds(0, 40, 120)
    expect(inPoint).toBe(0)
  })

  it('inPoint is 0 when cursor would be negative', () => {
    const { inPoint } = calcNewRegionBounds(-1, 40, 120)
    expect(inPoint).toBe(0)
  })
})

// region-creation::220bf2e0
// Region is clamped to the end of the video

behaviorTest('region-creation::220bf2e0', () => {
  it('outPoint is clamped to videoDuration when the center is near the end', () => {
    const { outPoint } = calcNewRegionBounds(119.5, 40, 120)
    expect(outPoint).toBe(120)
  })

  it('outPoint is clamped to duration when center equals duration', () => {
    const { outPoint } = calcNewRegionBounds(120, 40, 120)
    expect(outPoint).toBe(120)
  })
})
