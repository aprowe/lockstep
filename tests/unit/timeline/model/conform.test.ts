import { describe, it, expect } from 'vitest'
import {
  conformClipoutToAnchors,
  conformClipoutToBeatAnchors,
  mergeConformWithLive,
} from '../../../../src/timeline/model/conform'
import type { Anchor } from '../../../../src/types'

describe('conformClipoutToAnchors', () => {
  it('returns vertical (inputs unchanged) when no anchor sits on the in edge', () => {
    const anchors: Anchor[] = [{ id: 1, time: 5 }]
    const beatAnchors: Anchor[] = [{ id: 1, time: 2.5 }]
    expect(conformClipoutToAnchors(10, 20, anchors, beatAnchors))
      .toEqual({ inPoint: 10, outPoint: 20 })
  })

  it('conforms inPoint to anchor beat when input-in lands on an anchor; outPoint stays vertical', () => {
    const anchors: Anchor[] = [{ id: 1, time: 10 }]
    const beatAnchors: Anchor[] = [{ id: 1, time: 5 }]
    expect(conformClipoutToAnchors(10, 20, anchors, beatAnchors))
      .toEqual({ inPoint: 5, outPoint: 20 })
  })

  it('conforms both edges when anchors sit on both input-in and input-out', () => {
    const anchors: Anchor[] = [
      { id: 1, time: 10 },
      { id: 2, time: 20 },
    ]
    const beatAnchors: Anchor[] = [
      { id: 1, time: 5 },
      { id: 2, time: 12 },
    ]
    expect(conformClipoutToAnchors(10, 20, anchors, beatAnchors))
      .toEqual({ inPoint: 5, outPoint: 12 })
  })

  it('uses 1e-4 tolerance for boundary matching', () => {
    const anchors: Anchor[] = [{ id: 1, time: 10.00005 }]
    const beatAnchors: Anchor[] = [{ id: 1, time: 5 }]
    expect(conformClipoutToAnchors(10, 20, anchors, beatAnchors))
      .toEqual({ inPoint: 5, outPoint: 20 })
  })

  it('ignores anchors that miss the tolerance', () => {
    const anchors: Anchor[] = [{ id: 1, time: 10.001 }]
    const beatAnchors: Anchor[] = [{ id: 1, time: 5 }]
    expect(conformClipoutToAnchors(10, 20, anchors, beatAnchors))
      .toEqual({ inPoint: 10, outPoint: 20 })
  })

  it('ignores anchors that have no beat pair', () => {
    const anchors: Anchor[] = [{ id: 1, time: 10 }]
    const beatAnchors: Anchor[] = [] // no pair for id 1
    expect(conformClipoutToAnchors(10, 20, anchors, beatAnchors))
      .toEqual({ inPoint: 10, outPoint: 20 })
  })

  // ── out-edge-only conform (symmetric with in-edge) ──────────────────────
  // Regression: anchor on outPoint (no anchor on inPoint) must conform the
  // out edge to the paired beat time. Previously the early-return guard on
  // inBeat === undefined prevented the out-edge branch from ever running.

  it('conforms outPoint to anchor beat when input-out lands on an anchor; inPoint stays vertical', () => {
    // Region 10→20, anchor at 20 (outPoint) paired to beat 18. No anchor at 10.
    const anchors: Anchor[] = [{ id: 2, time: 20 }]
    const beatAnchors: Anchor[] = [{ id: 2, time: 18 }]
    expect(conformClipoutToAnchors(10, 20, anchors, beatAnchors))
      .toEqual({ inPoint: 10, outPoint: 18 })
  })

  it('in-edge-only conform: anchor on inPoint, no anchor on outPoint', () => {
    // Symmetric counterpart — should already pass.
    const anchors: Anchor[] = [{ id: 1, time: 10 }]
    const beatAnchors: Anchor[] = [{ id: 1, time: 6 }]
    expect(conformClipoutToAnchors(10, 20, anchors, beatAnchors))
      .toEqual({ inPoint: 6, outPoint: 20 })
  })
})

describe('conformClipoutToAnchors — sticky during input-anchor drag', () => {
  // Regression: when the user drags an anchor that sat exactly on a region's
  // boundary, the conform should stay engaged through the drag. The boundary
  // anchor is identified by its ORIGINAL time (so a moving live time doesn't
  // break the match), and the LIVE beat time drives the clipout's edge.
  // A fallback live-anchors arg covers the symmetric "drag onto boundary"
  // case where the anchor wasn't there originally.

  it('keeps conform when anchor drags off boundary (input drag, beat unchanged)', () => {
    const origInputs: Anchor[] = [{ id: 1, time: 10 }]
    const liveBeats: Anchor[] = [{ id: 1, time: 5 }]       // beat unchanged
    const liveInputs: Anchor[] = [{ id: 1, time: 12 }]     // input dragged off boundary
    expect(conformClipoutToAnchors(10, 20, origInputs, liveBeats, liveInputs))
      .toEqual({ inPoint: 5, outPoint: 20 })
  })

  it('updates beat live when warp drag moves both partners', () => {
    const origInputs: Anchor[] = [{ id: 1, time: 10 }]
    const liveBeats: Anchor[] = [{ id: 1, time: 7 }]       // beat moved
    const liveInputs: Anchor[] = [{ id: 1, time: 12 }]
    expect(conformClipoutToAnchors(10, 20, origInputs, liveBeats, liveInputs))
      .toEqual({ inPoint: 7, outPoint: 20 })
  })

  it('falls back to live anchors when drag puts anchor onto boundary (no original match)', () => {
    const origInputs: Anchor[] = [{ id: 1, time: 5 }]      // wasnt at boundary
    const liveBeats: Anchor[] = [{ id: 1, time: 5 }]
    const liveInputs: Anchor[] = [{ id: 1, time: 10 }]     // dragged onto boundary
    expect(conformClipoutToAnchors(10, 20, origInputs, liveBeats, liveInputs))
      .toEqual({ inPoint: 5, outPoint: 20 })
  })

  it('returns vertical when neither original nor live has anchor at boundary', () => {
    const origInputs: Anchor[] = [{ id: 1, time: 5 }]
    const liveBeats: Anchor[] = [{ id: 1, time: 5 }]
    const liveInputs: Anchor[] = [{ id: 1, time: 7 }]
    expect(conformClipoutToAnchors(10, 20, origInputs, liveBeats, liveInputs))
      .toEqual({ inPoint: 10, outPoint: 20 })
  })

  it('without liveAnchors arg behaves as before (backward compat)', () => {
    const anchors: Anchor[] = [{ id: 1, time: 10 }]
    const beats: Anchor[] = [{ id: 1, time: 5 }]
    expect(conformClipoutToAnchors(10, 20, anchors, beats))
      .toEqual({ inPoint: 5, outPoint: 20 })
  })
})

describe('conformClipoutToBeatAnchors', () => {
  // Symmetric counterpart to conformClipoutToAnchors. When a BEAT anchor sits
  // on the clipout's beat-space boundary (within 1e-4), the clipout edge
  // displays at the anchor's beat time. Drives live conform while the user
  // drags a beat anchor onto a clipout boundary (the clipout follows the
  // anchor through the drag).
  it('returns inputs unchanged when no beat anchor sits on either boundary', () => {
    const beatAnchors: Anchor[] = [{ id: 1, time: 100 }]
    expect(conformClipoutToBeatAnchors(5, 25, beatAnchors))
      .toEqual({ inPoint: 5, outPoint: 25 })
  })

  it('conforms in edge when a beat anchor lands exactly on beatIn', () => {
    const beatAnchors: Anchor[] = [{ id: 1, time: 5 }]
    expect(conformClipoutToBeatAnchors(5, 25, beatAnchors))
      .toEqual({ inPoint: 5, outPoint: 25 })
  })

  it('conforms both edges when separate beat anchors sit on both boundaries', () => {
    const beatAnchors: Anchor[] = [
      { id: 1, time: 5 },
      { id: 2, time: 25 },
    ]
    expect(conformClipoutToBeatAnchors(5, 25, beatAnchors))
      .toEqual({ inPoint: 5, outPoint: 25 })
  })

  it('uses 1e-4 tolerance for boundary matching', () => {
    const beatAnchors: Anchor[] = [{ id: 1, time: 5.00005 }]
    expect(conformClipoutToBeatAnchors(5, 25, beatAnchors))
      .toEqual({ inPoint: 5.00005, outPoint: 25 })
  })

  it('ignores beat anchors that miss the tolerance', () => {
    const beatAnchors: Anchor[] = [{ id: 1, time: 5.01 }]
    expect(conformClipoutToBeatAnchors(5, 25, beatAnchors))
      .toEqual({ inPoint: 5, outPoint: 25 })
  })

  // Live conform: when a beat anchor is dragged onto the boundary, its current
  // beat time is the value that drives the clipout. Dragged-off → vertical.
  it('drives live conform: dragged beat anchor at 5.0001 within tolerance pulls inPoint', () => {
    const beatAnchors: Anchor[] = [{ id: 1, time: 5.00001 }]
    const r = conformClipoutToBeatAnchors(5, 25, beatAnchors)
    expect(r.inPoint).toBeCloseTo(5.00001, 5)
    expect(r.outPoint).toBe(25)
  })

  it('drives live conform: dragged off the boundary returns to inputs', () => {
    const beatAnchors: Anchor[] = [{ id: 1, time: 7 }]
    expect(conformClipoutToBeatAnchors(5, 25, beatAnchors))
      .toEqual({ inPoint: 5, outPoint: 25 })
  })
})

describe('mergeConformWithLive', () => {
  // During a CLIP drag, the boundary anchor lookup runs against the ORIGINAL
  // (pre-drag) bounds because anchors don't follow the clip. If conform
  // engages (anchor was on the original boundary), the conformed beat
  // position drives the clipout edge so it stays anchor-bound. If conform
  // doesn't engage on a given edge, that edge falls back to the LIVE input
  // bound so the clipout tracks the drag (vertical case).
  it('keeps conformed value when conform engaged on edge', () => {
    const result = mergeConformWithLive(
      { inPoint: 10, outPoint: 20 },
      { inPoint: 5, outPoint: 20 },     // conform moved in but not out
      { inPoint: 12, outPoint: 22 },
    )
    expect(result).toEqual({ inPoint: 5, outPoint: 22 })
  })

  it('falls back to live when conform did not engage', () => {
    const result = mergeConformWithLive(
      { inPoint: 10, outPoint: 20 },
      { inPoint: 10, outPoint: 20 },    // unchanged
      { inPoint: 12, outPoint: 22 },
    )
    expect(result).toEqual({ inPoint: 12, outPoint: 22 })
  })

  it('mixes conformed in with live out', () => {
    const result = mergeConformWithLive(
      { inPoint: 10, outPoint: 20 },
      { inPoint: 5, outPoint: 20 },
      { inPoint: 12, outPoint: 22 },
    )
    expect(result).toEqual({ inPoint: 5, outPoint: 22 })
  })
})
