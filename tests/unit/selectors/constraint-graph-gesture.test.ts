/**
 * selectConstraintGraph must include gestureSlice in its memoization
 * keys so gesture-scoped constraints (whileDragging) appear in the
 * snapshot graph the controller walks for snap hints.
 *
 * Regression: previously the selector watched only dragCtxSlice and
 * the static slices. When a profile-driven drag began, gesture.
 * activeHandle was set but the selector returned the cached pre-drag
 * graph, missing the SnapTarget from profile.whileDragging. The
 * controller's constraintSnapHints found no candidates and emitted no
 * snap-hint times — visually, snap hints didn't appear for any
 * profile-driven drag.
 */

import { describe, it, expect } from 'vitest'
import { makeStore } from '../../helpers/setup'
import { addAnchor } from '../../../src/store/slices/warpSlice'
import { beginDrag, endDrag } from '../../../src/store/thunks/dragThunks'
import { selectConstraintGraph } from '../../../src/store/selectors/constraintGraph'
import { ConstraintKind } from '../../../src/constraints/types'

describe('selectConstraintGraph: gesture-scoped constraints visible', () => {
  it('graph contains profile SnapTarget after beginDrag', () => {
    const store = makeStore()
    store.dispatch(addAnchor({ id: 1, time: 5 }))

    const before = selectConstraintGraph(store.getState() as never)
    const hadSnap = before.constraints.some(
      c => c.kind === ConstraintKind.SnapTarget && (c as { id: string }).id === 'a1-in',
    )
    expect(hadSnap, 'no SnapTarget before drag').toBe(false)

    store.dispatch(beginDrag({ handle: { kind: 'anchor-drag', anchorId: 1, space: 'input' } }))

    const during = selectConstraintGraph(store.getState() as never)
    const hasSnap = during.constraints.some(
      c => c.kind === ConstraintKind.SnapTarget && (c as { id: string }).id === 'a1-in',
    )
    expect(hasSnap, 'SnapTarget on a1-in present during drag').toBe(true)

    store.dispatch(endDrag())

    const after = selectConstraintGraph(store.getState() as never)
    const stillHasSnap = after.constraints.some(
      c => c.kind === ConstraintKind.SnapTarget && (c as { id: string }).id === 'a1-in',
    )
    expect(stillHasSnap, 'SnapTarget removed after endDrag').toBe(false)
  })

  it('graph contains profile SnapTarget for pair drag', () => {
    const store = makeStore()
    store.dispatch(addAnchor({ id: 1, time: 5 }))

    store.dispatch(beginDrag({ handle: { kind: 'pair-drag', pairId: 1 } }))

    const graph = selectConstraintGraph(store.getState() as never)
    const tg = graph.constraints.find(
      c => c.kind === ConstraintKind.TranslateGroup && (c as { tag?: string }).tag === 'gesture:pair:1',
    )
    expect(tg, 'pair gesture TranslateGroup present').toBeDefined()
  })

  it('snap hints: graph from selector → findSnapCandidates returns candidates within radius', async () => {
    // End-to-end of the production snap-hint path:
    //   WarpView reads selectConstraintGraph → passes graph on Snapshot
    //   → controller calls findSnapCandidates → emits pubSnapHints.
    // The graph the selector returns must contain the profile-installed
    // SnapTarget with targets populated by snapToSiblings (which the
    // profile's whileDragging calls internally — Task 11 snap
    // consolidation).
    const { findSnapCandidates } = await import('../../../src/constraints/resolver')
    const { addRegion } = await import('../../../src/store/slices/regionSlice')
    const { ConstraintKind, Field } = await import('../../../src/constraints/types')

    const store = makeStore()
    store.dispatch(addRegion({
      id: 'r', name: 'r', inPoint: 10, outPoint: 20,
      inBeatTime: 10, outBeatTime: 20, defaultLinked: true,
      bpm: 120, lockedBeats: 20, minStretch: 0.5, maxStretch: 2.0,
    }))
    store.dispatch(addAnchor({ id: 1, time: 5 }))

    // CLIP_BODY_DRAG.whileDragging computes the SnapTarget via
    // snapToSiblings — anchor-in cohort produces the anchor at 5 as a
    // target. No manual setGestureSnapInstall needed.
    store.dispatch(beginDrag({ handle: { kind: 'clip-body', clipId: 'r', space: 'input' } }))

    const graph = selectConstraintGraph(store.getState() as never)

    // The selector's graph must contain a SnapTarget on r-in with a
    // populated targets list (the gesture-scoped one from the profile).
    const populated = graph.constraints.find(
      c => c.kind === ConstraintKind.SnapTarget
        && (c as { id: string }).id === 'r-in'
        && (c as { targets: { entityId: string }[] }).targets.length > 0,
    )
    expect(populated, 'SnapTarget with populated targets is in the selector graph').toBeDefined()

    // findSnapCandidates against the selector's graph for various drag
    // positions. Anchor at 5, body length 10, snap radius 4 → in-edge
    // values [1, 9] should produce candidates.
    expect(findSnapCandidates(graph, 'r-in', Field.In, 10, 20), 'outside radius').toHaveLength(0)
    expect(findSnapCandidates(graph, 'r-in', Field.In, 8, 18).length, 'inside radius (in=8, d=3)').toBeGreaterThan(0)
    expect(findSnapCandidates(graph, 'r-in', Field.In, 6, 16).length, 'inside radius (in=6, d=1)').toBeGreaterThan(0)
    expect(findSnapCandidates(graph, 'r-in', Field.In, 5, 15)[0].distance, 'on target d=0').toBeCloseTo(0, 6)
  })
})
