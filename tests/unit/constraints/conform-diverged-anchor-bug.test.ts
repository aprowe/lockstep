/**
 * Regression — dragging a default-linked region across a DIVERGED anchor
 * pair must NOT move the beat anchor.
 *
 * Bug shape:
 *   - Diverged anchor: orig.time=10, beat.time=15, linked=false.
 *   - Default-linked region spanning across the anchor's input-space position.
 *   - User nudges the region body 1 frame at a time across orig.time.
 *   - When the region's clipin.in lands on 10 (matches orig.time), the
 *     existing install predicate ("clipin.{edge} ≈ orig.time") fires and
 *     installs MirrorPair(anchor-out.time ↔ clipout.{edge}) — even though
 *     the OUTPUT-space values are wildly divergent (anchor-out=15 vs
 *     clipout.in=10). Subsequent cascade writes through clipout.in (or
 *     snap-cancel writes whose to==from) trigger MirrorPair and propagate
 *     clipout.in's value into anchor-out, collapsing the marker onto
 *     anchor-in's value.
 *
 * Fix: install predicate must require coincidence in BOTH spaces:
 *   clipin.{edge} ≈ orig.time AND clipout.{edge} ≈ beat.time.
 * In the diverged case the second clause fails → MirrorPair never installs
 * → no spurious propagation.
 */

import { describe, it, expect } from 'vitest'
import {
  runConstraintPipeline,
  applyDiffsToSlice,
  type PipelineSlice,
  type DragCtx,
} from '../../../src/constraints/pipeline'
import { OpKind } from '../../../src/constraints/types'
import { regionInId, anchorInId } from '../../../src/constraints/ids'

function makeSlice(regionInPoint: number, regionOutPoint: number): PipelineSlice {
  return {
    warp: {
      origAnchors: [{ id: 1, time: 10 }],
      // Diverged: beat.time != orig.time, linked=false.
      beatAnchors: [{ id: 1, time: 15, linked: false }],
    },
    region: {
      regions: [{
        id:           'r',
        inPoint:      regionInPoint,
        outPoint:     regionOutPoint,
        inBeatTime:   regionInPoint,
        outBeatTime:  regionOutPoint,
        bpm:          120,
        lockedBeats:  (regionOutPoint - regionInPoint) * 120 / 60,
        defaultLinked: true,
      }],
    },
    ui: { anchorLock: false, anchorLockGestureOverride: null, lockMode: 'bpm', activeRegionId: 'r' },
    lists: { selection: { clipin: [], clipout: [] } },
  }
}

/** dragCtx with a body-mode snap target installed on the region's clipin.in,
 *  matching what the controller installs at pointerDown for a clipin body drag.
 *  Snap target is anchor-in.time (the diverged orig anchor at 10). Generous
 *  threshold so even sub-unit nudges land inside the snap radius. */
function makeDragCtxWithSnap(): DragCtx {
  return {
    lassoIds: [],
    snapInstall: {
      entityId:  regionInId('r'),
      field:     'in',
      threshold: 2.0,           // 2-unit radius → 0.3 nudges always inside
      mode:      'body',
      targets:   [{ entityId: anchorInId(1), field: 'time' }],
    },
  }
}

describe('Conform install — diverged anchor must not be re-aligned by adjacent clip drag', () => {

  it('snap-canceled nudge (clipin held at orig coincidence) does NOT nudge anchor-out', () => {
    // Setup the exact bad frame:
    //   - Region default-linked at inPoint=10 (slice committed at the snap position).
    //   - Diverged anchor pair: orig=10, beat=15, linked=false.
    //   - User continues dragging by +0.3 (still inside snap radius of 2.0).
    //   - Snap will body-cancel the nudge: both clipin edges restricted back by -0.3.
    //   - DefaultLink cascades the canceled translate to clipout (delta 0).
    //   - The txn has clipout.in with from=10, to=10 (delta 0).
    //
    // Without the fix, MirrorPair fires on that 0-delta write: src.to=10,
    // dst=anchor-out current=15, |15-10|=5 > EPSILON → writes anchor-out=10.
    // Bug: marker collapses onto anchor-in's value.
    let slice = makeSlice(10, 20)
    const dragCtx = makeDragCtxWithSnap()

    const out = runConstraintPipeline({
      slice,
      dragCtx,
      op: { kind: OpKind.Move, id: regionInId('r'), delta: 0.3 },
    })
    const next = applyDiffsToSlice(slice, out)
    slice = {
      ...slice,
      warp: {
        origAnchors: next.origAnchors,
        beatAnchors: next.beatAnchors.map(a => ({
          ...a,
          linked: slice.warp.beatAnchors.find(b => b.id === a.id)?.linked,
        })),
      },
      region: {
        regions: next.regions.map(r => ({
          ...r,
          defaultLinked: slice.region.regions.find(rr => rr.id === r.id)!.defaultLinked,
        })),
      },
    }

    // The beat anchor MUST NOT have moved. The diverged anchor's output-space
    // position is independent of where a clip happens to be dragged in input space.
    const beat = slice.warp.beatAnchors.find(a => a.id === 1)!
    expect(beat.time).toBeCloseTo(15, 6)
  })

  it('clipout body drag (linked region, conformed) — clipout AND anchor both move', () => {
    // User reported regression: "can't drag clipout edge or body when its conformed".
    // Setup: linked region default-linked at [10,20], linked anchor at 10.
    // Both spaces coincide → MirrorPair installed.
    // User drags clipout body by +5.
    // Expected: clipout becomes [15,25], anchor-out follows to 15. Region visibly moves.
    const slice: PipelineSlice = {
      warp: {
        origAnchors: [{ id: 1, time: 10 }],
        beatAnchors: [{ id: 1, time: 10, linked: true }],
      },
      region: {
        regions: [{
          id: 'r', inPoint: 10, outPoint: 20, inBeatTime: 10, outBeatTime: 20,
          bpm: 120, lockedBeats: 20, defaultLinked: true,
        }],
      },
      ui: { anchorLock: false, anchorLockGestureOverride: null, lockMode: 'bpm', activeRegionId: 'r' },
      lists: { selection: { clipin: [], clipout: [] } },
    }
    const out = runConstraintPipeline({
      slice,
      dragCtx: { lassoIds: [] },
      op: { kind: OpKind.Move, id: 'r-out', delta: 5 },
    })
    const next = applyDiffsToSlice(slice, out)
    // Clipout body MUST move with the drag — this is the regression check.
    expect(next.regions[0].inBeatTime).toBeCloseTo(15, 6)
    expect(next.regions[0].outBeatTime).toBeCloseTo(25, 6)
    // Anchor follows because they're conformed.
    expect(next.beatAnchors[0].time).toBeCloseTo(15, 6)
  })

  it('clipout edge drag (linked region, conformed) — clipout edge moves, anchor follows', () => {
    const slice: PipelineSlice = {
      warp: {
        origAnchors: [{ id: 1, time: 10 }],
        beatAnchors: [{ id: 1, time: 10, linked: true }],
      },
      region: {
        regions: [{
          id: 'r', inPoint: 10, outPoint: 20, inBeatTime: 10, outBeatTime: 20,
          bpm: 120, lockedBeats: 20, defaultLinked: true,
        }],
      },
      ui: { anchorLock: false, anchorLockGestureOverride: null, lockMode: 'bpm', activeRegionId: 'r' },
      lists: { selection: { clipin: [], clipout: [] } },
    }
    const out = runConstraintPipeline({
      slice,
      dragCtx: { lassoIds: [] },
      op: { kind: OpKind.SetEdge, id: 'r-out', edge: 'in', value: 12 },
    })
    const next = applyDiffsToSlice(slice, out)
    expect(next.regions[0].inBeatTime).toBeCloseTo(12, 6)
    expect(next.beatAnchors[0].time).toBeCloseTo(12, 6)
  })

  it('linked anchor (not diverged): conform behavior unchanged — anchor-out follows clipout edge drag', () => {
    // Sanity check the fix doesn't break the legitimate conform case:
    // Linked anchor (orig=beat=10), region's clipout.in aligned at 10.
    // Drag clipout edge alone → anchor-out should follow.
    const slice: PipelineSlice = {
      warp: {
        origAnchors: [{ id: 1, time: 10 }],
        beatAnchors: [{ id: 1, time: 10, linked: true }],
      },
      region: {
        regions: [{
          id: 'r', inPoint: 10, outPoint: 20, inBeatTime: 10, outBeatTime: 20,
          bpm: 120, lockedBeats: 20, defaultLinked: true,
        }],
      },
      ui: { anchorLock: false, anchorLockGestureOverride: null, lockMode: 'bpm', activeRegionId: 'r' },
      lists: { selection: { clipin: [], clipout: [] } },
    }
    // Both spaces coincide (input: 10≈10, output: 10≈10) → MirrorPair installed.
    // Drag clipout.in to 12.
    const out = runConstraintPipeline({
      slice,
      dragCtx: { lassoIds: [] },
      op: { kind: OpKind.SetEdge, id: 'r-out', edge: 'in', value: 12 },
    })
    const next = applyDiffsToSlice(slice, out)
    const beat = next.beatAnchors.find(a => a.id === 1)!
    // Linked + conform binding → anchor follows the dragged clipout edge.
    expect(beat.time).toBeCloseTo(12, 6)
  })
})
