/**
 * Snap-hint pipeline test for clip-body drag (body-mode snap).
 *
 * Setup: anchor at time=5, region [10, 20]. Snap radius = 4. Drag
 * clip body leftward; the body's in-edge passes through the snap
 * radius around the anchor (radius covers in-edge values in [1, 9])
 * and aligns exactly when in-edge = 5.
 *
 * This is a *pipeline-layer* test. It verifies:
 *   (a) The graph built by buildGraphFromSlice contains a SnapTarget
 *       on the dragged entity once a gesture is active.
 *   (b) findSnapCandidates returns hints (distance > 0) for clip
 *       positions inside the snap radius, no hints outside it, and a
 *       confirmed snap (distance ≈ 0) when the clip aligns exactly
 *       with the target.
 *
 * It does NOT go through the controller or React selector — the bug
 * fixed in the previous commit (selectConstraintGraph not depending
 * on gesture state) is a different layer. This test would catch a
 * profile that declares the wrong SnapTarget shape, or an
 * evaluateSnap math regression.
 */

import { describe, it, expect } from 'vitest'
import { makeStore } from '../../helpers/setup'
import { addAnchor } from '../../../src/store/slices/warpSlice'
import { addRegion } from '../../../src/store/slices/regionSlice'
import { beginDrag, endDrag } from '../../../src/store/thunks/dragThunks'
import {
  buildGraphFromSlice,
  extractDragCtxFromSlice,
} from '../../../src/constraints/pipeline'
import { extractSliceForPipeline } from '../../../src/constraints/pipelineDispatch'
import { findSnapCandidates } from '../../../src/constraints/resolver'
import { ConstraintKind, Field } from '../../../src/constraints/types'
import type { Region } from '../../../src/types'

const SNAP_RADIUS = 4

function setup() {
  const store = makeStore()
  const region: Region = {
    id: 'r', name: 'r', inPoint: 10, outPoint: 20,
    inBeatTime: 10, outBeatTime: 20, defaultLinked: true,
    bpm: 120, lockedBeats: 20,
    minStretch: 0.5, maxStretch: 2.0,
  }
  store.dispatch(addRegion(region))
  store.dispatch(addAnchor({ id: 1, time: 5 }))
  // CLIP_BODY_DRAG.whileDragging calls snapToSiblings internally to
  // compute SnapTarget targets from the graph's snap-rules cohorts
  // ('clipin → anchor-in'). No manual setGestureSnapInstall needed —
  // the profile owns the snap install. pxPerUnit=0 → buildGestureSnapTarget
  // falls back to threshold=4.
  store.dispatch(beginDrag({ handle: { kind: 'clip-body', clipId: 'r', space: 'input' } }))
  return store
}

function graphFor(store: ReturnType<typeof setup>) {
  const state = store.getState()
  return buildGraphFromSlice(
    extractSliceForPipeline(state),
    extractDragCtxFromSlice(state as never),
  )
}

describe('Snap hints: clip body drag into anchor snap radius', () => {

  it('graph contains a body-mode SnapTarget on the dragged clip while drag is active', () => {
    const store = setup()
    const graph = graphFor(store)
    const snapTargets = graph.constraints.filter(
      c => c.kind === ConstraintKind.SnapTarget && (c as { id: string }).id === 'r-in',
    )
    expect(snapTargets.length).toBeGreaterThan(0)
    // At least one SnapTarget on r-in includes the anchor as a target
    // and has body mode (the gesture.snapInstall-derived one).
    const withTargets = snapTargets.find(
      c => (c as { targets: { entityId: string }[] }).targets.some(t => t.entityId === 'a1-in'),
    )
    expect(withTargets).toBeDefined()
    store.dispatch(endDrag())
  })

  it('no candidates when the dragged clip is outside the snap radius', () => {
    const store = setup()
    const graph = graphFor(store)
    // Clip at (10, 20). In-edge=10 → distance to anchor=5 (> 4).
    // Out-edge=20 → distance=15. Neither within radius.
    const candidates = findSnapCandidates(graph, 'r-in', Field.In, 10, 20)
    expect(candidates).toHaveLength(0)
  })

  it('candidate present (distance > 0) when in-edge is within the snap radius', () => {
    const store = setup()
    const graph = graphFor(store)
    // Pretend the clip body has been dragged so in=7, out=17.
    // In-edge=7 → distance to anchor=2 (< 4) → hint.
    const candidates = findSnapCandidates(graph, 'r-in', Field.In, 7, 17)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].distance).toBeCloseTo(2, 6)
    expect(candidates[0].value).toBeCloseTo(5, 6)   // target value is the anchor's time
  })

  it('confirmed snap (distance ≈ 0) when the in-edge exactly aligns with the anchor', () => {
    const store = setup()
    const graph = graphFor(store)
    // Drag puts in=5, out=15. In-edge sits exactly on the anchor.
    const candidates = findSnapCandidates(graph, 'r-in', Field.In, 5, 15)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].distance).toBeCloseTo(0, 6)
  })

  it('sweeps cleanly: a 0.5-step pass from outside → inside → on → past produces the expected hint pattern', () => {
    const store = setup()
    const graph = graphFor(store)
    // Sweep in-edge from 11 down to -1 in 0.5 steps. Out-edge is 10
    // greater (the body keeps its length). Anchor at 5; radius 4 covers
    // in-edge values in [1, 9] (anchor.time ± radius).
    for (let inVal = 11; inVal >= -1; inVal -= 0.5) {
      const outVal = inVal + 10
      const candidates = findSnapCandidates(graph, 'r-in', Field.In, inVal, outVal)
      const label = `in=${inVal.toFixed(1)}`

      const inDistance = Math.abs(inVal - 5)
      const inWithinRadius = inDistance <= SNAP_RADIUS
      const outDistance = Math.abs(outVal - 5)
      const outWithinRadius = outDistance <= SNAP_RADIUS
      const anyWithin = inWithinRadius || outWithinRadius

      if (anyWithin) {
        expect(candidates.length, `${label} expected ≥1 candidate`).toBeGreaterThan(0)
        const best = candidates[0]
        // body-mode picks the closer edge.
        const expectedDistance = Math.min(inDistance, outDistance)
        expect(best.distance, `${label} closest-edge distance`).toBeCloseTo(expectedDistance, 6)
      } else {
        expect(candidates.length, `${label} expected 0 candidates`).toBe(0)
      }
    }
  })
})
