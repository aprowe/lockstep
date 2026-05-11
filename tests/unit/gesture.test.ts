import { describe, it, expect, beforeEach } from 'vitest'
import { gesture, getSnapshot } from '../../src/store/gesture'

describe('gesture store', () => {
  beforeEach(() => { gesture.clearAll() })

  describe('setDragRegion', () => {
    it('stores the drag region', () => {
      gesture.setDragRegion('clip-1', 1.5, 3.0)
      expect(getSnapshot().dragRegion).toEqual({ id: 'clip-1', inPoint: 1.5, outPoint: 3.0 })
    })

    it('overwrites a previous value', () => {
      gesture.setDragRegion('clip-1', 1.0, 2.0)
      gesture.setDragRegion('clip-1', 1.5, 2.5)
      expect(getSnapshot().dragRegion).toEqual({ id: 'clip-1', inPoint: 1.5, outPoint: 2.5 })
    })

    it('is cleared by clearAll', () => {
      gesture.setDragRegion('clip-1', 1.5, 3.0)
      gesture.clearAll()
      expect(getSnapshot().dragRegion).toBeNull()
    })
  })

  describe('setScrubTime', () => {
    it('stores a scrub time', () => {
      gesture.setScrubTime(42.5)
      expect(getSnapshot().scrubTime).toBe(42.5)
    })

    it('can be set to null', () => {
      gesture.setScrubTime(42.5)
      gesture.setScrubTime(null)
      expect(getSnapshot().scrubTime).toBeNull()
    })

    it('is cleared by clearAll', () => {
      gesture.setScrubTime(42.5)
      gesture.clearAll()
      expect(getSnapshot().scrubTime).toBeNull()
    })
  })

  describe('setLassoSelection', () => {
    it('stores the lasso selection sets by reference', () => {
      const clipIds = new Set(['clip-1', 'clip-2'])
      const anchorIds = new Set([1, 2])
      const sceneTimes = new Set([1.0, 2.0])
      gesture.setLassoSelection(clipIds, anchorIds, sceneTimes)
      const s = getSnapshot().lassoSelection!
      expect(s.clipIds).toBe(clipIds)
      expect(s.anchorIds).toBe(anchorIds)
      expect(s.sceneTimes).toBe(sceneTimes)
    })

    it('is cleared by clearAll', () => {
      gesture.setLassoSelection(new Set(), new Set(), new Set())
      gesture.clearAll()
      expect(getSnapshot().lassoSelection).toBeNull()
    })
  })

  describe('selector isolation', () => {
    it('dragRegion reference is unchanged when scrubTime changes', () => {
      gesture.setDragRegion('clip-1', 1.0, 2.0)
      const before = getSnapshot().dragRegion
      gesture.setScrubTime(5.0)
      expect(getSnapshot().dragRegion).toBe(before)
    })

    it('lassoSelection reference is unchanged when dragRegion changes', () => {
      const clipIds = new Set<string>()
      gesture.setLassoSelection(clipIds, new Set(), new Set())
      const before = getSnapshot().lassoSelection
      gesture.setDragRegion('clip-1', 1.0, 2.0)
      expect(getSnapshot().lassoSelection).toBe(before)
    })
  })
})
