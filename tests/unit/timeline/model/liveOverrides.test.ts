import { describe, it, expect } from 'vitest'
import {
  liveRegionOverrides,
  liveAnchorOverrides,
  liveBeatAnchorOverrides,
} from '../../../../src/timeline/model/liveOverrides'
import type { DragState } from '../../../../src/timeline/types'

const baseAnchor = (id: number, time: number) => ({ id, time })

describe('liveRegionOverrides', () => {
  it('returns empty map when no drag is active', () => {
    expect(liveRegionOverrides(null).size).toBe(0)
  })

  it('returns single override from region-edge drag liveRegion', () => {
    const drag: DragState = {
      kind: 'region-edge', id: 'r1', edge: 'in', isOutput: false,
      origIn: 10, origOut: 20,
      liveRegion: { id: 'r1', inPoint: 12, outPoint: 20 },
      startClientX: 0, startClientY: 0, moved: true, pendingSelect: [],
      lastAltKey: false,
    }
    const m = liveRegionOverrides(drag)
    expect(m.get('r1')).toEqual({ inPoint: 12, outPoint: 20 })
    expect(m.size).toBe(1)
  })

  it('returns every captured region for region-move multi-select', () => {
    const drag: DragState = {
      kind: 'region-move', id: 'r1', isOutput: false,
      origIn: 10, origOut: 20, anchorX: 0,
      liveRegion: { id: 'r1', inPoint: 13, outPoint: 23 },
      liveBoundsList: [
        { id: 'r1', inPoint: 13, outPoint: 23 },
        { id: 'r2', inPoint: 33, outPoint: 43 },
      ],
      startClientX: 0, startClientY: 0, moved: true, pendingSelect: [],
      lastAltKey: false,
    }
    const m = liveRegionOverrides(drag)
    expect(m.get('r1')).toEqual({ inPoint: 13, outPoint: 23 })
    expect(m.get('r2')).toEqual({ inPoint: 33, outPoint: 43 })
    expect(m.size).toBe(2)
  })

  it('returns liveRegionBounds from combined anchor+region drag', () => {
    const drag: DragState = {
      kind: 'anchor', id: 1, space: 'input', origTime: 10,
      liveAnchors: [baseAnchor(1, 12)], liveBeatAnchors: [],
      startClientX: 0, startClientY: 0, moved: true, pendingSelect: [],
      isPair: false,
      liveRegionBounds: [{ id: 'r1', inPoint: 13, outPoint: 23 }],
    }
    const m = liveRegionOverrides(drag)
    expect(m.get('r1')).toEqual({ inPoint: 13, outPoint: 23 })
  })
})

describe('liveAnchorOverrides', () => {
  it('returns empty array when no drag is active', () => {
    expect(liveAnchorOverrides(null)).toEqual([])
  })

  it('returns liveAnchors from anchor drag', () => {
    const drag: DragState = {
      kind: 'anchor', id: 1, space: 'input', origTime: 10,
      liveAnchors: [baseAnchor(1, 12), baseAnchor(2, 30)],
      liveBeatAnchors: [],
      startClientX: 0, startClientY: 0, moved: true, pendingSelect: [],
      isPair: false,
    }
    expect(liveAnchorOverrides(drag)).toEqual([baseAnchor(1, 12), baseAnchor(2, 30)])
  })

  it('returns region-move liveAnchors when present (combined drag)', () => {
    const drag: DragState = {
      kind: 'region-move', id: 'r1', isOutput: false,
      origIn: 10, origOut: 20, anchorX: 0,
      liveRegion: null,
      startClientX: 0, startClientY: 0, moved: true, pendingSelect: [],
      lastAltKey: false,
      liveAnchors: [baseAnchor(1, 11)],
    }
    expect(liveAnchorOverrides(drag)).toEqual([baseAnchor(1, 11)])
  })
})

describe('liveBeatAnchorOverrides', () => {
  it('returns liveBeatAnchors from anchor drag', () => {
    const drag: DragState = {
      kind: 'anchor', id: 1, space: 'output', origTime: 5,
      liveAnchors: [],
      liveBeatAnchors: [baseAnchor(1, 6)],
      startClientX: 0, startClientY: 0, moved: true, pendingSelect: [],
      isPair: false,
    }
    expect(liveBeatAnchorOverrides(drag)).toEqual([baseAnchor(1, 6)])
  })
})
