/**
 * Repro: dragging a linked clip across an anchor-in should visually conform
 * the clipout onto the anchor's beat position WHEN the clip is on the anchor,
 * and restore to the user's intended drag position once the clip passes.
 *
 * This is the "I need to see conform mid-drag" requirement: as the user
 * drags a clip body past a marker, the clip should momentarily snap to the
 * marker (visual conform), then continue tracking the cursor past it.
 *
 * Today (after deleting the projection layer): conform visibility depends
 * entirely on (a) snap pulling the clip onto the anchor while in radius
 * and (b) MirrorPair / default-link cascading to keep slice values aligned.
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
  const len = regionOutPoint - regionInPoint
  return {
    warp: {
      origAnchors: [{ id: 1, time: 15 }],            // anchor sits AT input time 15
      beatAnchors: [{ id: 1, time: 15, linked: true }], // linked → beat = orig
    },
    region: {
      regions: [{
        id:            'r',
        inPoint:       regionInPoint,
        outPoint:      regionOutPoint,
        inBeatTime:    regionInPoint,
        outBeatTime:   regionOutPoint,
        bpm:           120,
        lockedBeats:   len * 2,
        defaultLinked: true,
      }],
    },
    ui: { anchorLock: false, anchorLockGestureOverride: null, lockMode: 'bpm', activeRegionId: 'r' },
    lists: { selection: { clipin: [], clipout: [] } },
  }
}

/** Snap installed on clipin body (matches what the controller installs at
 *  pointerDown for an input-space body drag). Target: anchor-in at time=15. */
function snapToAnchorIn(): DragCtx {
  return {
    lassoIds: [],
    snapInstall: {
      entityId:  regionInId('r'),
      field:     'in',
      threshold: 0.5,
      mode:      'body',
      targets:   [{ entityId: anchorInId(1), field: 'time' }],
    },
  }
}

function nudge(slice: PipelineSlice, dragCtx: DragCtx, targetInPoint: number): PipelineSlice {
  const residual = targetInPoint - slice.region.regions[0].inPoint
  if (Math.abs(residual) < 1e-12) return slice
  const out = runConstraintPipeline({
    slice,
    dragCtx,
    op: { kind: OpKind.Move, id: regionInId('r'), delta: residual },
  })
  const next = applyDiffsToSlice(slice, out)
  return {
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
}

describe('Drag linked clip across anchor-in: conform visible, then restore', () => {

  it('clip body drag through anchor-in: snap engages on anchor, releases past it', () => {
    // Start: region [10, 20], anchor at orig=beat=15.
    // Drag right by 1-unit nudges from inPoint 10 → 18.
    // At inPoint=14.6 the snap radius (0.5) starts reaching for anchor at 15.
    // Snap should pull clipin.in to 15. Cascade drives clipout to 15 too.
    // When drag exits the snap radius (past inPoint ~15.5), snap releases
    // and slice tracks the cursor freely.

    let slice = makeSlice(10, 20)
    const dragCtx = snapToAnchorIn()

    // Frame 1: drag to 13. Far from snap radius. No conform.
    slice = nudge(slice, dragCtx, 13)
    expect(slice.region.regions[0].inPoint).toBeCloseTo(13, 6)
    expect(slice.region.regions[0].inBeatTime).toBeCloseTo(13, 6)
    expect(slice.warp.beatAnchors[0].time).toBeCloseTo(15, 6)   // anchor stays

    // Frame 2: drag to 14.7 — INSIDE snap radius of anchor at 15.
    // Snap should pull clipin to 15; cascade brings clipout to 15.
    slice = nudge(slice, dragCtx, 14.7)
    expect(slice.region.regions[0].inPoint).toBeCloseTo(15, 1)        // snapped
    expect(slice.region.regions[0].inBeatTime).toBeCloseTo(15, 1)     // cascaded
    expect(slice.warp.beatAnchors[0].time).toBeCloseTo(15, 6)         // anchor still at 15

    // Frame 3: drag to 16 — OUTSIDE snap radius.
    // Snap releases; clipin = cursor (16). Cascade: clipout = 16.
    slice = nudge(slice, dragCtx, 16)
    expect(slice.region.regions[0].inPoint).toBeCloseTo(16, 6)        // restored
    expect(slice.region.regions[0].inBeatTime).toBeCloseTo(16, 6)
    expect(slice.warp.beatAnchors[0].time).toBeCloseTo(15, 6)         // anchor never moved
  })
})
