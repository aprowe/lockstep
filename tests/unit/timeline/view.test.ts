import { describe, it, expect } from 'vitest'
import {
  wheelZoom,
  wheelPan,
  minimapRecenter,
  dragPan,
  clampView,
} from '../../../src/timeline/view'

const maxDur = 100

describe('clampView (re-exported)', () => {
  it('is the same function as utils/view#clampView', () => {
    const v = clampView(10, 20, maxDur)
    expect(v.start).toBe(10)
    expect(v.end).toBe(20)
  })
})

describe('wheelZoom', () => {
  it('zooms in when deltaY < 0', () => {
    const view = { start: 0, end: 100 }
    const next = wheelZoom(view, 200, 400, -100, maxDur)
    expect(next.end - next.start).toBeLessThan(100)
  })

  it('zooms out when deltaY > 0', () => {
    const view = { start: 30, end: 70 }
    const next = wheelZoom(view, 200, 400, 100, maxDur)
    expect(next.end - next.start).toBeGreaterThan(40)
  })

  it('keeps the unit under the cursor approximately fixed when zooming in', () => {
    const view = { start: 0, end: 100 }
    const cursorX = 200
    const canvasW = 400
    const before = view.start + (cursorX / canvasW) * (view.end - view.start)
    const next = wheelZoom(view, cursorX, canvasW, -50, maxDur)
    const after = next.start + (cursorX / canvasW) * (next.end - next.start)
    expect(Math.abs(after - before)).toBeLessThan(0.5)
  })

  it('clamps to the available duration', () => {
    const view = { start: 0, end: 100 }
    const next = wheelZoom(view, 0, 400, 10000, maxDur)
    expect(next.end - next.start).toBeLessThanOrEqual(maxDur)
  })
})

describe('wheelPan', () => {
  it('uses deltaX when nonzero', () => {
    const view = { start: 10, end: 30 }
    const next = wheelPan(view, 400, 20, 0, false, maxDur)
    // Positive delta shifts forward in time
    expect(next.start).toBeGreaterThan(view.start)
  })

  it('uses deltaY when deltaX is zero', () => {
    const view = { start: 10, end: 30 }
    const next = wheelPan(view, 400, 0, 20, false, maxDur)
    expect(next.start).toBeGreaterThan(view.start)
  })

  it('preserves the visible span', () => {
    const view = { start: 10, end: 30 }
    const next = wheelPan(view, 400, 50, 0, false, maxDur)
    expect(next.end - next.start).toBeCloseTo(view.end - view.start, 5)
  })

  it('treats shift+deltaY as horizontal pan when deltaX is zero', () => {
    const view = { start: 10, end: 30 }
    const withShift = wheelPan(view, 400, 0, 20, true, maxDur)
    const withoutShift = wheelPan(view, 400, 0, 20, false, maxDur)
    expect(withShift.start).toBeCloseTo(withoutShift.start, 5)
  })

  it('clamps at the start of the timeline', () => {
    const view = { start: 0, end: 20 }
    const next = wheelPan(view, 400, -200, 0, false, maxDur)
    expect(next.start).toBe(0)
  })
})

describe('minimapRecenter', () => {
  it('centers the view on the click position', () => {
    const view = { start: 40, end: 60 }
    const next = minimapRecenter(view, 200, 400, maxDur)
    // 200/400 * 100 = 50 → center stays at 50
    const center = (next.start + next.end) / 2
    expect(center).toBeCloseTo(50, 5)
  })

  it('preserves the visible span', () => {
    const view = { start: 40, end: 60 }
    const next = minimapRecenter(view, 100, 400, maxDur)
    expect(next.end - next.start).toBeCloseTo(20, 5)
  })

  it('clamps near the edges', () => {
    const view = { start: 10, end: 30 }
    const next = minimapRecenter(view, 0, 400, maxDur)
    expect(next.start).toBe(0)
  })
})

describe('dragPan', () => {
  it('moves view opposite to the cursor drag (positive pxDelta = view left)', () => {
    const startView = { start: 20, end: 40 }
    const next = dragPan(startView, 400, 20, maxDur)
    expect(next.start).toBeLessThan(startView.start)
  })

  it('preserves the span across the drag', () => {
    const startView = { start: 20, end: 40 }
    const next = dragPan(startView, 400, 200, maxDur)
    expect(next.end - next.start).toBeCloseTo(20, 5)
  })

  it('clamps to the available range', () => {
    const startView = { start: 0, end: 20 }
    const next = dragPan(startView, 400, 500, maxDur)
    expect(next.start).toBe(0)
  })
})
