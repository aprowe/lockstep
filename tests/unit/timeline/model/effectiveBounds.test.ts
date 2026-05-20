import { describe, it, expect } from 'vitest'
import { effectiveBeatBounds } from '../../../../src/timeline/model/effectiveBounds'

// ── effectiveBeatBounds ────────────────────────────────────────────────────────

describe('effectiveBeatBounds', () => {
  it('returns inBeatTime and outBeatTime from the region directly', () => {
    const region = { inBeatTime: 10, outBeatTime: 20 }
    expect(effectiveBeatBounds(region)).toEqual({ inBeatTime: 10, outBeatTime: 20 })
  })

  it('returns explicit values even when they differ from inPoint/outPoint (diverged)', () => {
    const region = { inBeatTime: 8, outBeatTime: 22 }
    expect(effectiveBeatBounds(region)).toEqual({ inBeatTime: 8, outBeatTime: 22 })
  })

  it('accepts (and ignores) anchor arguments for call-site compatibility', () => {
    const region = { inBeatTime: 5, outBeatTime: 15 }
    const anchors = [{ id: 1, time: 5 }]
    expect(effectiveBeatBounds(region, anchors, anchors)).toEqual({ inBeatTime: 5, outBeatTime: 15 })
  })

  it('anchors that coincide with boundaries do NOT override stored values', () => {
    const region = { inBeatTime: 10, outBeatTime: 20 }
    // Even with coincident input anchors + beat anchors, stored values win.
    const origAnchors = [{ id: 1, time: 10 }, { id: 2, time: 20 }]
    const beatAnchors = [{ id: 1, time: 6 }, { id: 2, time: 18 }]
    expect(effectiveBeatBounds(region, origAnchors, beatAnchors)).toEqual({ inBeatTime: 10, outBeatTime: 20 })
  })

  it('works with a full Region object', () => {
    const region = {
      id: 'r1', name: 'R', inPoint: 10, outPoint: 20,
      inBeatTime: 7, outBeatTime: 25,
      defaultLinked: false,
      bpm: 120, minStretch: 0.5, maxStretch: 2.0,
    }
    expect(effectiveBeatBounds(region)).toEqual({ inBeatTime: 7, outBeatTime: 25 })
  })
})
