/**
 * Phase 7 — SnapTarget constraint propagation tests.
 *
 * Verifies that:
 *  1. snapToSiblings installs a SnapTarget that causes the resolver to snap
 *     an entity to the nearest sibling within threshold.
 *  2. When outside threshold, the entity moves freely.
 *  3. snapEnd removes the SnapTarget cleanly.
 */

import { describe, it, expect } from 'vitest'
import { reduce, emptyState } from '../../../src/constraints'
import type { State } from '../../../src/constraints/types'
import { OpKind, ConstraintKind } from '../../../src/constraints/types'
import { snapToSiblings, snapEnd } from '../../../src/constraints/recipes'
import { anchorInId, anchorOutId } from '../../../src/constraints/ids'

// ── Helpers ──────────────────────────────────────────────────────────────────

function anchorTime(state: State, numericId: number): number {
  const id = anchorInId(numericId)
  const e = state.entities[id]
  if (!e || e.kind !== 'anchor') throw new Error(`${id} not found`)
  return (e as Extract<typeof e, { kind: 'anchor' }>).time
}

function anchorOutTime(state: State, numericId: number): number {
  const id = anchorOutId(numericId)
  const e = state.entities[id]
  if (!e || e.kind !== 'anchor') throw new Error(`${id} not found`)
  return (e as Extract<typeof e, { kind: 'anchor' }>).time
}

/** Seed input-space and output-space anchors and install cohorts + anchor-in → anchor-out rule. */
function setupAnchorPairs(...times: number[]): State {
  let state = emptyState()
  const inIds: string[] = []
  const outIds: string[] = []
  for (let i = 0; i < times.length; i++) {
    state = reduce(state, { kind: OpKind.AddAnchor, id: anchorInId(i + 1),  time: times[i] })
    state = reduce(state, { kind: OpKind.AddAnchor, id: anchorOutId(i + 1), time: times[i] })
    inIds.push(anchorInId(i + 1))
    outIds.push(anchorOutId(i + 1))
  }
  // Install cohorts.
  state = reduce(state, { kind: OpKind.AddConstraint, constraint: { kind: ConstraintKind.SnapCohort, tag: 'anchor-in',  ids: inIds  } })
  state = reduce(state, { kind: OpKind.AddConstraint, constraint: { kind: ConstraintKind.SnapCohort, tag: 'anchor-out', ids: outIds } })
  // anchor-in drags snap to anchor-out targets (per SNAP_RULES table).
  state = reduce(state, { kind: OpKind.AddConstraint, constraint: { kind: ConstraintKind.SnapRule, dragger: 'anchor-in', target: 'anchor-out' } })
  return state
}

/** Seed only input-space anchors with no cohorts — for testing that exclusion still works. */
function setupAnchorsNoCohorts(...times: number[]): State {
  let state = emptyState()
  for (let i = 0; i < times.length; i++) {
    state = reduce(state, { kind: OpKind.AddAnchor, id: anchorInId(i + 1), time: times[i] })
  }
  return state
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Phase 7 — SnapTarget constraint propagation', () => {

  it('anchor-in snaps to anchor-out when within threshold', () => {
    // A1-in@10, A1-out@10; A2-in@10, A2-out@20; A3-out@30
    // Drag A1-in; per SNAP_RULES: anchor-in snaps to anchor-out.
    // pxPerUnit=10, pixelThreshold=8 → threshold=0.8 units.
    let state = setupAnchorPairs(10, 20, 30)
    state = reduce(state, snapToSiblings(anchorInId(1), 'time', state, 10, 8))

    // Move A1-in to 19.5 — within 0.8 units of A2-out@20 → should snap to 20.
    state = reduce(state, { kind: OpKind.SetValue, id: anchorInId(1), field: 'time', value: 19.5 })

    expect(anchorTime(state, 1)).toBeCloseTo(20)
    // Snap targets (anchor-out entities) unaffected by the drag.
    expect(anchorOutTime(state, 2)).toBeCloseTo(20)
    expect(anchorOutTime(state, 3)).toBeCloseTo(30)
  })

  it('does not snap A1-in when outside threshold', () => {
    let state = setupAnchorPairs(10, 20, 30)
    state = reduce(state, snapToSiblings(anchorInId(1), 'time', state, 10, 8))

    // Move A1-in to 25 — not within 0.8 units of any anchor-out → no snap.
    state = reduce(state, { kind: OpKind.SetValue, id: anchorInId(1), field: 'time', value: 25 })

    expect(anchorTime(state, 1)).toBeCloseTo(25)
  })

  it('snapEnd removes the SnapTarget — subsequent move is free', () => {
    let state = setupAnchorPairs(10, 20, 30)
    state = reduce(state, snapToSiblings(anchorInId(1), 'time', state, 10, 8))

    // Verify snap is installed: move within threshold → snaps.
    state = reduce(state, { kind: OpKind.SetValue, id: anchorInId(1), field: 'time', value: 19.5 })
    expect(anchorTime(state, 1)).toBeCloseTo(20)

    // Remove snap.
    state = reduce(state, snapEnd(anchorInId(1), 'time'))

    // Verify SnapTarget is gone.
    const snapConstraints = state.constraints.filter(
      c => c.kind === 'snap_target' && (c as { id?: string }).id === anchorInId(1)
    )
    expect(snapConstraints).toHaveLength(0)

    // Move within threshold again — no snap this time.
    state = reduce(state, { kind: OpKind.SetValue, id: anchorInId(1), field: 'time', value: 19.5 })
    expect(anchorTime(state, 1)).toBeCloseTo(19.5)
  })

  it('snapToSiblings excludes the dragged entity from targets', () => {
    // A1-in should not snap to itself.  Targets are anchor-out entities only.
    let state = setupAnchorPairs(10, 20)
    state = reduce(state, snapToSiblings(anchorInId(1), 'time', state, 10, 8))

    const snapC = state.constraints.find(
      c => c.kind === 'snap_target' && (c as { id?: string }).id === anchorInId(1)
    ) as { targets?: Array<{ entityId: string }> } | undefined

    expect(snapC).toBeDefined()
    const targetIds = (snapC?.targets ?? []).map(t => t.entityId)
    // The dragged entity should not be a target.
    expect(targetIds).not.toContain(anchorInId(1))
    // anchor-out entities are valid targets per the rule.
    expect(targetIds).toContain(anchorOutId(2))
  })

  it('snaps to the closest target when multiple are within threshold', () => {
    // A1-in@10, A2-out@19.6, A3-out@19.2.
    // Both A2-out and A3-out within 0.8 of 19.5 → snap to A2-out (distance 0.1, closer).
    let state = setupAnchorPairs(10, 19.6, 19.2)
    state = reduce(state, snapToSiblings(anchorInId(1), 'time', state, 10, 8))

    state = reduce(state, { kind: OpKind.SetValue, id: anchorInId(1), field: 'time', value: 19.5 })

    // A2-out@19.6: distance=0.1; A3-out@19.2: distance=0.3 → A2-out wins.
    expect(anchorTime(state, 1)).toBeCloseTo(19.6)
  })

  it('no cohorts → no snap targets (empty index)', () => {
    // Without cohort constraints, snapToSiblings installs an empty target set.
    let state = setupAnchorsNoCohorts(10, 20)
    state = reduce(state, snapToSiblings(anchorInId(1), 'time', state, 10, 8))

    const snapC = state.constraints.find(
      c => c.kind === 'snap_target' && (c as { id?: string }).id === anchorInId(1)
    ) as { targets?: Array<unknown> } | undefined

    expect(snapC).toBeDefined()
    expect(snapC?.targets).toHaveLength(0)
  })

})
