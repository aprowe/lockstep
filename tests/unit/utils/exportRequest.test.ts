import { describe, it, expect } from 'vitest'
import { buildWarpRequest } from '../../../src/utils/exportRequest'
import type { WarpData } from '../../../src/types'

const warpDataWithMarkers: WarpData = {
  origAnchors: [{ id: 1, time: 4 }, { id: 2, time: 12 }],
  beatAnchors: [{ id: 1, time: 4 }, { id: 2, time: 13 }],
  bpm: 120,
  minStretch: 0.5,
  maxStretch: 2.0,
  beatZeroTime: 4,
  addToEnd: false,
}

const baseInput = {
  videoPath: '/videos/song.mp4',
  loopBeats: null,
  trimToLoop: false,
  fadeAtLoop: false,
  normalizeBpm: false,
  interpolateFrames: true,
  interpFps: 60,
  sceneCuts: [],
}

describe('buildWarpRequest — RIFE skip on unwarped clips', () => {
  it('passes RIFE through when the clip window contains markers', () => {
    const req = buildWarpRequest({
      ...baseInput,
      warpData: warpDataWithMarkers,
      interpMethod: 'rife',
      job: { label: 'in-range', clipIn: 0, clipOut: 20, bpm: 120, addToEnd: false },
    })
    expect(req.interp_method).toBe('rife')
    expect(req.interp_fps).toBe(60)
    expect(req.orig_times.length).toBeGreaterThan(0)
  })

  it('drops RIFE entirely when the clip window has no markers', () => {
    // Window is [20, 30]; markers are at 4 and 12 — none survive the filter.
    const req = buildWarpRequest({
      ...baseInput,
      warpData: warpDataWithMarkers,
      interpMethod: 'rife',
      job: { label: 'out-of-range', clipIn: 20, clipOut: 30, bpm: 120, addToEnd: false },
    })
    expect(req.orig_times).toEqual([])
    expect(req.interp_method).toBeNull()
    expect(req.interp_fps).toBeNull()
  })

  it('drops RIFE on a video with no warpData at all', () => {
    const req = buildWarpRequest({
      ...baseInput,
      warpData: null,
      interpMethod: 'rife',
      job: { label: 'raw', clipIn: null, clipOut: null, bpm: 120, addToEnd: false },
    })
    expect(req.orig_times).toEqual([])
    expect(req.interp_method).toBeNull()
    expect(req.interp_fps).toBeNull()
  })

  it('keeps minterpolate on an unwarped clip (gate is RIFE-only)', () => {
    const req = buildWarpRequest({
      ...baseInput,
      warpData: warpDataWithMarkers,
      interpMethod: 'minterpolate',
      job: { label: 'out-of-range', clipIn: 20, clipOut: 30, bpm: 120, addToEnd: false },
    })
    expect(req.orig_times).toEqual([])
    expect(req.interp_method).toBe('minterpolate')
    expect(req.interp_fps).toBe(60)
  })

  it('does not interpolate when the user left the checkbox off', () => {
    const req = buildWarpRequest({
      ...baseInput,
      warpData: warpDataWithMarkers,
      interpolateFrames: false,
      interpMethod: 'rife',
      job: { label: 'in-range', clipIn: 0, clipOut: 20, bpm: 120, addToEnd: false },
    })
    expect(req.interp_method).toBeNull()
    expect(req.interp_fps).toBeNull()
  })
})
