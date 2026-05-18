/**
 * Bug 2 regression — snapToSiblings must exclude transitively-carried entities.
 *
 * Scenario: dragging clipin of a default-linked region that has a conformed
 * beat anchor at the clipout.in edge.
 *   - defaultlink pair: regionInId → regionOutId (Translate)  [installed by middleware]
 *   - carry pair:        regionOutId → anchorOutId  (MirrorEdge, fromEdge=in)
 * Both pairs together form a chain  regionInId → regionOutId → anchorOutId.
 *
 * When the user drags the clipin, both clipout AND the carried anchor move
 * along with it via the resolver. If `snapToSiblings(clipinId, …)` lists the
 * anchor as a snap target, the resolver creates oscillation/feedback because
 * the anchor's position is itself being driven by the same drag.
 *
 * The fix is to compute the transitive closure of DirectedPair `from→to`
 * starting from the dragged entity and exclude every reachable entity from
 * the snap target set.
 */

import { describe, it, expect } from 'vitest'
import { reduce, emptyState } from '../../../src/constraints'
import type { State } from '../../../src/constraints/types'
import { ConstraintKind, OpKind, PairMode } from '../../../src/constraints/types'
import { snapToSiblings, carryStart } from '../../../src/constraints/recipes'
import { anchorOutId, regionInId, regionOutId } from '../../../src/constraints/ids'

function setup(): State {
  let state = emptyState()
  // Region r1: clipin and clipout entities both at [10, 20].
  state = reduce(state, { kind: OpKind.AddClip, id: regionInId('r1'),  in: 10, out: 20 })
  state = reduce(state, { kind: OpKind.AddClip, id: regionOutId('r1'), in: 10, out: 20 })
  // A beat anchor conformed to clipout.in at time=10.
  state = reduce(state, { kind: OpKind.AddAnchor, id: anchorOutId(42), time: 10 })

  // defaultlink: clipin → clipout (Translate).
  state = reduce(state, {
    kind: OpKind.AddConstraint,
    constraint: {
      kind: ConstraintKind.DirectedPair,
      from: regionInId('r1'),
      to:   regionOutId('r1'),
      mode: PairMode.Translate,
      tag:  `defaultlink:${regionInId('r1')}`,
    },
  })

  // carry: clipout → anchor-out (MirrorEdge, in edge).
  state = reduce(state, carryStart(regionOutId('r1'), 'in', anchorOutId(42)))

  // Install cohorts and rules so snapToSiblings has something to work with.
  // clipin drags target anchor-in (per SNAP_RULES): add those cohorts + rule.
  state = reduce(state, {
    kind: OpKind.AddConstraint,
    constraint: { kind: ConstraintKind.SnapCohort, tag: 'clipin', ids: [regionInId('r1')] },
  })
  state = reduce(state, {
    kind: OpKind.AddConstraint,
    constraint: { kind: ConstraintKind.SnapCohort, tag: 'anchor-out', ids: [anchorOutId(42)] },
  })
  // Add a rule that would include the anchor as a target (anchor-in cohort → anchor-out).
  // We use a custom rule here to intentionally try to include anchorOut(42) — so we can
  // prove the movement-closure exclusion overrides it.
  state = reduce(state, {
    kind: OpKind.AddConstraint,
    constraint: { kind: ConstraintKind.SnapRule, dragger: 'clipin', target: 'anchor-out' },
  })

  return state
}

describe('Bug 2 — snapToSiblings transitive exclusion', () => {
  it('excludes a marker that is carried indirectly via a chain of DirectedPairs', () => {
    const state = setup()

    // Install a snap on the clipin (drag start). With transitive exclusion,
    // anchorOutId(42) (reachable: clipin → clipout → anchor) should NOT be a target.
    const op = snapToSiblings(regionInId('r1'), 'in', state, 100, 8)
    if (op.kind !== OpKind.AddConstraint || op.constraint.kind !== ConstraintKind.SnapTarget) {
      throw new Error('expected SnapTarget op')
    }

    const targetIds = op.constraint.targets.map(t => `${t.entityId}:${t.field}`)
    // clipout-in is already excluded (direct DirectedPair).
    expect(targetIds).not.toContain(`${regionOutId('r1')}:in`)
    // Carried anchor-out: must ALSO be excluded — it is reachable through the chain.
    expect(targetIds).not.toContain(`${anchorOutId(42)}:time`)
  })
})
