import { describe, it, expect } from 'vitest'
import {
  buildLayout,
  ALL_TRACKS,
  MINIMAP_H,
} from '../../../src/timeline/layout'

describe('buildLayout', () => {
  it('renders all rows when warp is expanded', () => {
    const layout = buildLayout(false, 600)
    expect(layout.length).toBe(ALL_TRACKS.length)
    expect(layout.map(t => t.id)).toEqual(ALL_TRACKS.map(t => t.id))
  })

  it('renders only input-space rows when warp is collapsed', () => {
    const layout = buildLayout(true, 400)
    expect(layout.every(t => t.space === 'input')).toBe(true)
    const inputIds = ALL_TRACKS.filter(t => t.space === 'input').map(t => t.id)
    expect(layout.map(t => t.id)).toEqual(inputIds)
  })

  it('places the first row just below the minimap with a 1px gap', () => {
    const layout = buildLayout(false, 600)
    expect(layout[0].y).toBe(MINIMAP_H + 1)
  })

  it('stacks rows with 1px gaps in order', () => {
    const layout = buildLayout(false, 600)
    for (let i = 1; i < layout.length; i++) {
      const prev = layout[i - 1]
      expect(layout[i].y).toBeCloseTo(prev.y + prev.h + 1, 5)
    }
  })

  it('distributes leftover height across flex>0 rows', () => {
    // Pick a height that leaves clearly extra room
    const layout = buildLayout(false, 800)
    const flexed = layout.filter(t => {
      const def = ALL_TRACKS.find(d => d.id === t.id)!
      return def.flex > 0
    })
    const minH = flexed.reduce((sum, t) => {
      const def = ALL_TRACKS.find(d => d.id === t.id)!
      return sum + def.h
    }, 0)
    const actualH = flexed.reduce((sum, t) => sum + t.h, 0)
    expect(actualH).toBeGreaterThan(minH)
  })

  it('keeps flex-0 rows at their base height', () => {
    const layout = buildLayout(false, 800)
    for (const tr of layout) {
      const def = ALL_TRACKS.find(d => d.id === tr.id)!
      if (def.flex === 0) {
        expect(tr.h).toBe(def.h)
      }
    }
  })

  it('honors per-row overrides, locking the row at the override height', () => {
    const layout = buildLayout(false, 800, { time: 50 })
    const time = layout.find(t => t.id === 'time')!
    expect(time.h).toBe(50)
  })

  it('uses default height when no override is provided', () => {
    const layout = buildLayout(false, 200, { time: 50 })
    expect(layout.find(t => t.id === 'time')!.h).toBe(50)
    // Other flex-0 row should be at default height
    expect(layout.find(t => t.id === 'scenes')!.h).toBe(18)
  })

  it('returns rows whose y + h never exceeds the available area', () => {
    const totalH = 500
    const layout = buildLayout(false, totalH)
    const last = layout[layout.length - 1]
    expect(last.y + last.h).toBeLessThanOrEqual(totalH)
  })
})
