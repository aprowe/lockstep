import { describe, it, expect } from 'vitest'
import { projectClipoutRegions } from '../../../../src/timeline/model/clipoutProjection'
import type { ProjectClipoutInput } from '../../../../src/timeline/model/clipoutProjection'
import type { RegionBlock } from '../../../../src/timeline/types'

// ── helpers ─────────────────────────────────────────────────────────────────
const anchor = (id: number, time: number) => ({ id, time })
const region = (id: string, inPoint: number, outPoint: number, extra: Partial<RegionBlock> = {}): RegionBlock =>
  ({ id, inPoint, outPoint, ...extra })

const emptyLiveMap = new Map<string, { inPoint: number; outPoint: number }>()

function base(overrides: Partial<ProjectClipoutInput> = {}): ProjectClipoutInput {
  return {
    regions: [],
    regionsOutput: [],
    origAnchors: [],
    beatAnchors: [],
    liveInputAnchors: [],
    liveRegionMap: emptyLiveMap,
    anchorsDragging: false,
    ...overrides,
  }
}

// ── 1. regionsOutput undefined → returns undefined ──────────────────────────
describe('projectClipoutRegions — regionsOutput absent', () => {
  it('returns undefined when regionsOutput is undefined', () => {
    const result = projectClipoutRegions(base({ regionsOutput: undefined }))
    expect(result).toBeUndefined()
  })
})

// ── 2. default-linked region, no drag, no anchors on boundary ───────────────
describe('projectClipoutRegions — no conform, no drag', () => {
  it('returns regionsOutput verbatim when input and beat bounds match and no anchors are on the boundary', () => {
    // Regions whose inPoint/outPoint are the same as the beat-space bounds —
    // this is the "default-linked" case. No anchors sit on the boundaries, so
    // no conform fires, and the output should equal the input regionsOutput
    // element by element.
    const r1 = region('r1', 10, 20)
    const result = projectClipoutRegions(base({
      regions: [r1],
      regionsOutput: [r1],
      origAnchors: [],
      beatAnchors: [],
    }))
    expect(result).toEqual([r1])
  })
})

// ── 3. Beat-side conform: beat anchor on beat-space in-edge ─────────────────
describe('projectClipoutRegions — beat-side conform', () => {
  it('moves only the in-edge when a beat anchor sits exactly on the beat-space in boundary', () => {
    // The clipout's beat-space in is 5.0. A beat anchor sits at 5.0 in the
    // beat-space (same id, representing the live position). After conform the
    // in-edge should move to the anchor's current beat time (5.001 in the
    // "after-drag" scenario below).  The out-edge has no beat anchor so it
    // stays at the base value.
    //
    // For this test the beat anchor sits exactly ON the boundary so it has
    // already moved there — the conform result is the anchor's current time.
    const origBeatIn = 5.0
    const origBeatOut = 10.0
    const movedBeatTime = 5.001  // anchor dragged slightly

    // beat anchor is live at 5.001 but the clipout beat-space boundary is
    // still 5.0 (within TOL 1e-4). Conform fires → in-edge = 5.001.
    // NOTE: 5.001 - 5.0 = 0.001 > TOL (1e-4), so this won't match.
    // Use a difference < 1e-4 to trigger the conform.
    const movedBeatTimeWithinTol = 5.00005

    const rOut = region('r1', origBeatIn, origBeatOut)
    const rIn  = region('r1', 8, 15)  // input-space bounds, no anchor on them

    const result = projectClipoutRegions(base({
      regions: [rIn],
      regionsOutput: [rOut],
      origAnchors: [],  // no input anchors on boundary → input conform is a no-op
      beatAnchors: [anchor(1, movedBeatTimeWithinTol)],
      liveInputAnchors: [],
    }))
    // The beat anchor at 5.00005 is within TOL of the beat-space in = 5.0.
    // clipoutFor falls back to r.inPoint=5.0, r.outPoint=10.0 (beat-space from slice).
    // applyBeatConform: origBeatIn=5, origBeatOut=10; beat anchor at
    // 5.00005 matches in → inPoint = 5.00005; no match for out → outPoint = base.outPoint = 10.0.
    expect(result![0].inPoint).toBeCloseTo(movedBeatTimeWithinTol, 10)
    expect(result![0].outPoint).toBe(10.0)
  })

  it('does not move an edge when beat anchor is further than TOL from the boundary', () => {
    const rOut = region('r1', 5.0, 10.0)
    const rIn  = region('r1', 8, 15)

    const result = projectClipoutRegions(base({
      regions: [rIn],
      regionsOutput: [rOut],
      origAnchors: [],
      beatAnchors: [anchor(1, 5.001)],  // 0.001 > TOL → no match
      liveInputAnchors: [],
    }))
    // No beat conform fires; no input conform fires (no anchor on 8).
    // clipoutFor falls back to r.inPoint/outPoint (beat-space from slice).
    // Output = { inPoint: 5.0, outPoint: 10.0 }.
    expect(result![0].inPoint).toBe(5.0)
    expect(result![0].outPoint).toBe(10.0)
  })
})

// ── 4. Input-side conform: input anchor on region.inPoint ───────────────────
describe('projectClipoutRegions — input-side conform', () => {
  it('moves clipout in-edge to paired beat anchor time when input anchor sits on region.inPoint', () => {
    // Anchor id=1 sits on the region's inPoint (10). Its paired beat anchor
    // (same id) is at 4.0. Expected: clipout.in = 4.0.
    const rIn  = region('r1', 10, 20)
    const rOut = region('r1', 10, 20)  // default-linked

    const result = projectClipoutRegions(base({
      regions: [rIn],
      regionsOutput: [rOut],
      origAnchors: [anchor(1, 10)],
      beatAnchors: [anchor(1, 4.0)],
      liveInputAnchors: [anchor(1, 10)],
    }))
    // conformClipoutToAnchors(10, 20, [a(1,10)], [a(1,4)], [a(1,10)])
    //   → inBeat = 4 (anchor id=1 on inPoint), outBeat = lookup(20) → no match → 20
    //   → { inPoint: 4, outPoint: 20 }
    // applyBeatConform: beat anchors = [a(1,4)]; origBeatIn=10, origBeatOut=20.
    //   beatConformed.inPoint = 10 (no beat anchor at 10 within TOL) → stays at base.inPoint=4
    //   beatConformed.outPoint = 20 (no beat anchor at 20) → stays at base.outPoint=20
    expect(result![0].inPoint).toBe(4.0)
    expect(result![0].outPoint).toBe(20)
  })

  it('moves both edges when input anchors sit on both in and out', () => {
    const rIn  = region('r1', 10, 20)
    const rOut = region('r1', 10, 20)

    const result = projectClipoutRegions(base({
      regions: [rIn],
      regionsOutput: [rOut],
      origAnchors: [anchor(1, 10), anchor(2, 20)],
      beatAnchors: [anchor(1, 4.0), anchor(2, 8.0)],
      liveInputAnchors: [anchor(1, 10), anchor(2, 20)],
    }))
    expect(result![0].inPoint).toBe(4.0)
    expect(result![0].outPoint).toBe(8.0)
  })
})

// ── 5. Multi-region drag ─────────────────────────────────────────────────────
//
// Key invariant: during a clipin drag the Redux slice commits `updateRegionInOut`
// live on every pointerMove frame. This means `regionsOutput` (thinRegionsOut in
// WarpView) already reflects the LIVE position before `draw()` runs — for a
// default-linked region `r.inPoint = origToBeat(live.inPoint)`, and for an
// explicitly-diverged region `r.inPoint = inBeatTime` (unchanged because only
// clipin moved). Tests must model `regionsOutput` at the live-committed state.
describe('projectClipoutRegions — multi-region drag (liveRegionMap)', () => {
  it('captured regions follow live bounds; non-captured preserve original semantics', () => {
    const r1In  = region('r1', 10, 20)
    const r2In  = region('r2', 30, 40)
    // r1Out already reflects the live-committed Redux state (origToBeat(13)=13
    // for no-warp). The projection falls back to r.inPoint/r.outPoint when
    // conform is a no-op — which equals the live-projected beat bounds.
    const r1Out = region('r1', 13, 23)
    const r2Out = region('r2', 30, 40)

    const liveMap = new Map([['r1', { inPoint: 13, outPoint: 23 }]])

    const result = projectClipoutRegions(base({
      regions: [r1In, r2In],
      regionsOutput: [r1Out, r2Out],
      origAnchors: [],    // no anchors → conform is a no-op
      beatAnchors: [],
      liveInputAnchors: [],
      liveRegionMap: liveMap,
      anchorsDragging: false,
    }))
    // r1 is captured: conform is no-op (no anchors); fallback to r1Out.{in,out}Point = {13,23}
    // applyBeatConform: no beat anchors → stays at {13, 23}
    expect(result![0].inPoint).toBe(13)
    expect(result![0].outPoint).toBe(23)
    // r2 is not captured, not active → applyBeatConform with verbatim r2Out bounds {30,40}
    expect(result![1].inPoint).toBe(30)
    expect(result![1].outPoint).toBe(40)
  })

  it('explicitly-diverged region: clipout stays at committed beat bounds during clipin drag', () => {
    // Region had inBeatTime=4.0 (previously conformed to anchor at 10).
    // User now drags clipin to 13. The clipout should NOT follow — it stays at 4.0.
    // r1Out.inPoint = 4.0 (explicit inBeatTime, unchanged by updateRegionInOut).
    const r1In  = region('r1', 10, 20)
    const r1Out = region('r1', 4.0, 20)   // inBeatTime=4.0, outBeatTime still 20

    const liveMap = new Map([['r1', { inPoint: 13, outPoint: 23 }]])

    const result = projectClipoutRegions(base({
      regions: [r1In],
      regionsOutput: [r1Out],
      origAnchors: [anchor(1, 10)],
      beatAnchors: [anchor(1, 4.0)],
      liveInputAnchors: [anchor(1, 10)],
      liveRegionMap: liveMap,
    }))
    // conformClipoutToAnchors(live.in=13, live.out=23, [a(1,10)], [a(1,4)], [a(1,10)])
    //   → no anchor at 13 or 23 → no conform
    // Fallback to r1Out.inPoint=4.0, r1Out.outPoint=20 (beat-space preserved)
    // applyBeatConform: beat anchor at 4.0; origBeatIn(r1Out)=4.0 → matches → stays 4.0
    expect(result![0].inPoint).toBe(4.0)
    expect(result![0].outPoint).toBe(20)
  })

  it('captured region dragged onto anchor: clipout snaps to that anchor beat', () => {
    // Anchor id=1 is at position 13 (beat=4.0). r1 originally at inPoint=10.
    // r1 is dragged live to { inPoint: 13, outPoint: 23 } — exactly onto the anchor.
    // r1Out already reflects the live-committed Redux state: origToBeat(13)=13, outPoint=23.
    // Expected: inPoint=4.0 (conformed to anchor beat), outPoint=23 (no anchor, stays).
    const r1In  = region('r1', 10, 20)
    const r1Out = region('r1', 13, 23)   // live-committed: origToBeat(13)=13, origToBeat(23)=23

    const liveMap = new Map([['r1', { inPoint: 13, outPoint: 23 }]])

    const result = projectClipoutRegions(base({
      regions: [r1In],
      regionsOutput: [r1Out],
      origAnchors: [anchor(1, 13)],
      beatAnchors: [anchor(1, 4.0)],
      liveInputAnchors: [anchor(1, 13)],
      liveRegionMap: liveMap,
    }))
    // conformClipoutToAnchors(live.in=13, live.out=23, [a(1,13)], [a(1,4)], [a(1,13)])
    //   → anchor at 13 → inBeat=4.0; no anchor at 23 → no conform for out
    // Fallback for out: r1Out.outPoint=23 (beat-space = live = no change)
    // applyBeatConform: beat anchor at 4.0; origBeatIn(r1Out)=13 → no match → stays
    //   → { 4.0, 23 }
    expect(result![0].inPoint).toBe(4.0)
    expect(result![0].outPoint).toBe(23)
  })
})

// ── 5b. Bug A regression: out-edge conform with explicit inBeatTime/outBeatTime ─
//
//   Root cause: in WarpView, beatClipOverlays was always built as
//     { inPoint: origToBeat(c.inPoint), outPoint: origToBeat(c.outPoint) }
//   regardless of whether the region had explicit inBeatTime/outBeatTime set.
//   When inBeatTime differed from origToBeat(inPoint), the beat anchor placed at
//   inBeatTime would NOT match because regionsOutput[i].inPoint was still the
//   origToBeat value.
//
//   After the fix, beatClipOverlays uses
//     { inPoint: c.inBeatTime ?? origToBeat(c.inPoint), ... }
//   and regionsOutput[i].inPoint = inBeatTime. The test below models the state
//   AFTER the fix: regionsOutput uses the explicit beat-space boundary.
describe('projectClipoutRegions — explicit inBeatTime/outBeatTime (Bug A)', () => {
  it('out-edge conforms when a beat anchor coincides with explicit outBeatTime (default-linked input)', () => {
    // Region: inPoint=10, outPoint=20 (input-space). A non-1:1 warp would
    // make origToBeat(20) = 9 (not 20). But the region's outBeatTime was
    // explicitly set to 7.0. A beat anchor sits at 7.0.
    // Old code: regionsOutput.outPoint = origToBeat(20) = 9 → no match at 7.0 → no conform
    // New code: regionsOutput.outPoint = outBeatTime = 7.0 → beat anchor matches → conform fires
    const rIn  = region('r1', 10, 20)
    // regionsOutput reflects explicit outBeatTime=7.0 (post-fix path: WarpView uses outBeatTime)
    const rOut = region('r1', 5.0, 7.0)  // inBeatTime=5.0, outBeatTime=7.0

    const beatAnchorAtOut = 7.00005  // within TOL of 7.0

    const result = projectClipoutRegions(base({
      regions: [rIn],
      regionsOutput: [rOut],
      origAnchors: [],
      beatAnchors: [{ id: 1, time: beatAnchorAtOut }],
      liveInputAnchors: [],
    }))
    // conformClipoutToAnchors(10, 20, [], beatAnchors, []) → no input anchor at 10 → { inPoint: 10, outPoint: 20 }
    // clipoutFor falls back to r.inPoint=5.0, r.outPoint=7.0 (beat-space from slice)
    // applyBeatConform: origBeatIn=5.0, origBeatOut=7.0
    //   beat anchor at 7.00005 is within TOL of 7.0 → outPoint = 7.00005
    //   no beat anchor within TOL of 5.0 → inPoint = base.inPoint = 5.0
    expect(result![0].outPoint).toBeCloseTo(beatAnchorAtOut, 10)
    expect(result![0].inPoint).toBe(5.0)
  })

  it('in-edge conforms when a beat anchor coincides with explicit inBeatTime alone', () => {
    // Only inBeatTime is explicit. Out edge has no beat anchor.
    const rIn  = region('r1', 10, 20)
    const rOut = region('r1', 6.0, 9.0)  // inBeatTime=6.0, outBeatTime=9.0

    const beatAnchorAtIn = 6.00003  // within TOL of 6.0

    const result = projectClipoutRegions(base({
      regions: [rIn],
      regionsOutput: [rOut],
      origAnchors: [],
      beatAnchors: [{ id: 2, time: beatAnchorAtIn }],
      liveInputAnchors: [],
    }))
    // clipoutFor falls back to r.inPoint=6.0, r.outPoint=9.0 (beat-space from slice)
    // applyBeatConform: origBeatIn=6.0, origBeatOut=9.0
    //   beat anchor at 6.00003 matches in → inPoint = 6.00003
    //   no match for 9.0 → outPoint = base.outPoint = 9.0
    expect(result![0].inPoint).toBeCloseTo(beatAnchorAtIn, 10)
    expect(result![0].outPoint).toBe(9.0)
  })

  it('neither edge conforms when beat anchors do not coincide with explicit beat boundaries', () => {
    const rIn  = region('r1', 10, 20)
    const rOut = region('r1', 6.0, 9.0)

    const result = projectClipoutRegions(base({
      regions: [rIn],
      regionsOutput: [rOut],
      origAnchors: [],
      beatAnchors: [{ id: 3, time: 3.0 }],  // neither 6.0 nor 9.0
      liveInputAnchors: [],
    }))
    // No conform fires → fallback to r.inPoint/r.outPoint (beat-space from slice)
    // = { inPoint: 6.0, outPoint: 9.0 }
    expect(result![0].inPoint).toBe(6.0)
    expect(result![0].outPoint).toBe(9.0)
  })
})

// ── 5c. Regression: clipout body-pan commit persists after pointerUp ────────
//
//   Bug: after commitClipoutPan writes inBeatTime=5/outBeatTime=15 to the
//   slice, WarpView builds thinRegionsOut with inPoint=5/outPoint=15. But
//   projectClipoutRegions was passing inputR.inPoint/outPoint (0/10, the
//   input-space bounds) to conformClipoutToAnchors, which returned {0,10}
//   when no anchor matched. applyBeatConform then used {0,10} as base, so
//   the committed beat position was discarded and the bar snapped back.
//   Fix: clipoutFor now falls back to r.inPoint/r.outPoint (beat-space from
//   thinRegionsOut) when the anchor conform doesn't fire on an edge.
describe('projectClipoutRegions — clipout pan commit persists (regression)', () => {
  it('preserves committed inBeatTime/outBeatTime after a clipout body pan', () => {
    // After commitClipoutPan: inBeatTime=5, outBeatTime=15. Input bounds unchanged: 0..10.
    // thinRegionsOut has inPoint=5, outPoint=15 (from beatClipOverlays using inBeatTime).
    // No anchor on input edge (0 or 10) → conform is a no-op.
    // No beat anchor on beat edge (5 or 15) → beat-conform is a no-op.
    // Expected: inPoint=5, outPoint=15 (the committed beat position).
    const rIn  = region('r1', 0, 10)   // input-space bounds (unchanged by clipout pan)
    const rOut = region('r1', 5, 15)   // beat-space bounds reflecting committed inBeatTime

    const result = projectClipoutRegions(base({
      regions: [rIn],
      regionsOutput: [rOut],
      origAnchors: [],
      beatAnchors: [],
      liveInputAnchors: [],
    }))
    expect(result![0].inPoint).toBe(5)
    expect(result![0].outPoint).toBe(15)
  })

  it('anchor-conform overrides committed beat position when input anchor is on the input edge', () => {
    // Even after a prior clipout pan (inBeatTime=5), if an anchor now sits on
    // the input inPoint, the anchor's beat time wins over the committed value.
    const rIn  = region('r1', 0, 10)
    const rOut = region('r1', 5, 15)   // committed beat position

    const result = projectClipoutRegions(base({
      regions: [rIn],
      regionsOutput: [rOut],
      origAnchors: [anchor(1, 0)],     // anchor sits on inPoint=0
      beatAnchors: [anchor(1, 3.0)],   // anchor beat time = 3.0
      liveInputAnchors: [anchor(1, 0)],
    }))
    // conformClipoutToAnchors(0, 10, [a(1,0)], [a(1,3)], ...) → inBeat=3.0, outBeat=10
    // conformedIn(3.0) !== inputIn(0) → use conformedIn=3.0 (anchor wins over committed 5)
    // conformedOut(10) === inputOut(10) → use r.outPoint=15 (committed out)
    expect(result![0].inPoint).toBe(3.0)
    expect(result![0].outPoint).toBe(15)
  })
})

// ── 6. anchorsDragging true, no liveRegionMap ────────────────────────────────
describe('projectClipoutRegions — anchorsDragging, no live region map', () => {
  it('active region gets input conform; non-active region gets verbatim input bounds', () => {
    const rActiveIn  = region('r1', 10, 20, { active: true })
    const rOtherIn   = region('r2', 30, 40, { active: false })
    const rActiveOut = region('r1', 10, 20, { active: true })
    const rOtherOut  = region('r2', 30, 40, { active: false })

    // Anchor on r1.inPoint only
    const result = projectClipoutRegions(base({
      regions: [rActiveIn, rOtherIn],
      regionsOutput: [rActiveOut, rOtherOut],
      origAnchors: [anchor(1, 10)],
      beatAnchors: [anchor(1, 4.0)],
      liveInputAnchors: [anchor(1, 10)],
      liveRegionMap: emptyLiveMap,
      anchorsDragging: true,
    }))
    // r1 (active): clipoutFor(10, 20) → conform → { inPoint: 4, outPoint: 20 }
    // applyBeatConform: beat anchor at 4.0; origBeatIn(rActiveOut)=10 → no match for 10 near 4.0
    //   → stays at { 4, 20 }
    expect(result![0].inPoint).toBe(4.0)
    expect(result![0].outPoint).toBe(20)
    // r2 (non-active): applyBeatConform(rOtherOut, { inPoint: 30, outPoint: 40 })
    //   no beat anchors at 30 or 40 → { 30, 40 }
    expect(result![1].inPoint).toBe(30)
    expect(result![1].outPoint).toBe(40)
  })
})
