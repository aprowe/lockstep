/**
 * Phase 5 — DirectedPair(MirrorEdge) carry propagation tests.
 *
 * Verifies that an ephemeral carry constraint (carryStart recipe) makes a
 * beat anchor follow a clipout edge whenever the edge is written, and that
 * carryEnd removes the constraint cleanly.
 *
 * Test layout:
 *  1. Edge carry — clipout.in  moves → conformed anchor follows (edge drag).
 *  2. Edge carry — clipout.out moves → conformed anchor follows.
 *  3. Body pan   — Move on clipout moves both edges → both conformed anchors carry.
 *  4. carryEnd   — constraint removed; subsequent edge move does NOT carry.
 *  5. One-way    — writing the anchor does NOT move the clipout edge.
 */

import { describe, it, expect } from 'vitest'
import { reduce, emptyState } from '../../../src/constraints'
import type { State } from '../../../src/constraints/types'
import { OpKind, ConstraintKind, PairMode } from '../../../src/constraints/types'
import { carryStart, carryEnd } from '../../../src/constraints/recipes'
import { anchorOutId, regionOutId } from '../../../src/constraints/ids'

// ── Helpers ─────────────────────────────────────────────────────────────────

function anchorTime(state: State, anchorNumId: number): number {
  const e = state.entities[anchorOutId(anchorNumId)]
  if (!e || e.kind !== 'anchor') throw new Error(`a${anchorNumId}-out not found`)
  return (e as Extract<typeof e, { kind: 'anchor' }>).time
}

function clipEdge(state: State, regionId: string, edge: 'in' | 'out'): number {
  const e = state.entities[regionOutId(regionId)]
  if (!e || e.kind !== 'clip') throw new Error(`${regionId}-out not found`)
  return (e as Extract<typeof e, { kind: 'clip' }>)[edge]
}

/** Seed a minimal state: clipout [cIn, cOut] + two beat anchors (at cIn and cOut). */
function setup(cIn: number, cOut: number, anchorInId: number, anchorOutId_: number): State {
  let state = emptyState()
  const rId = regionOutId('r1')

  // Add the clipout clip entity
  state = reduce(state, { kind: OpKind.AddClip, id: rId, in: cIn, out: cOut })

  // Add two beat-space anchor entities
  state = reduce(state, { kind: OpKind.AddAnchor, id: anchorOutId(anchorInId), time: cIn })
  state = reduce(state, { kind: OpKind.AddAnchor, id: anchorOutId(anchorOutId_), time: cOut })

  return state
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Phase 5 — DirectedPair(MirrorEdge) carry propagation', () => {

  it('clipout.in SetEdge carries the conformed anchor-out (edge drag, in edge)', () => {
    let state = setup(10, 20, 1, 2)
    const rId = regionOutId('r1')

    // Install carry for the 'in' edge
    state = reduce(state, carryStart(rId, 'in', anchorOutId(1)))

    // Move clipout.in to 12
    state = reduce(state, { kind: OpKind.SetEdge, id: rId, edge: 'in', value: 12 })

    expect(clipEdge(state, 'r1', 'in')).toBeCloseTo(12)
    expect(anchorTime(state, 1)).toBeCloseTo(12)     // carried
    expect(anchorTime(state, 2)).toBeCloseTo(20)     // unaffected
  })

  it('clipout.out SetEdge carries the conformed anchor-out (edge drag, out edge)', () => {
    let state = setup(10, 20, 1, 2)
    const rId = regionOutId('r1')

    // Install carry for the 'out' edge
    state = reduce(state, carryStart(rId, 'out', anchorOutId(2)))

    // Move clipout.out to 25
    state = reduce(state, { kind: OpKind.SetEdge, id: rId, edge: 'out', value: 25 })

    expect(clipEdge(state, 'r1', 'out')).toBeCloseTo(25)
    expect(anchorTime(state, 2)).toBeCloseTo(25)     // carried
    expect(anchorTime(state, 1)).toBeCloseTo(10)     // unaffected
  })

  it('body pan (Move on clipout) carries both conformed anchor-outs', () => {
    let state = setup(10, 20, 1, 2)
    const rId = regionOutId('r1')

    // Install carry for BOTH edges (body pan)
    state = reduce(state, carryStart(rId, 'in',  anchorOutId(1)))
    state = reduce(state, carryStart(rId, 'out', anchorOutId(2)))

    // Pan clipout by +5
    state = reduce(state, { kind: OpKind.Move, id: rId, delta: 5 })

    expect(clipEdge(state, 'r1', 'in')).toBeCloseTo(15)
    expect(clipEdge(state, 'r1', 'out')).toBeCloseTo(25)
    expect(anchorTime(state, 1)).toBeCloseTo(15)     // carried with in edge
    expect(anchorTime(state, 2)).toBeCloseTo(25)     // carried with out edge
  })

  it('carryEnd removes carry constraint — subsequent edge move does not carry anchor', () => {
    let state = setup(10, 20, 1, 2)
    const rId = regionOutId('r1')

    // Install then remove carry for the 'in' edge
    state = reduce(state, carryStart(rId, 'in', anchorOutId(1)))
    state = reduce(state, carryEnd(rId))

    // Verify the carry constraint is gone
    const carryConstraints = state.constraints.filter(
      c => c.kind === ConstraintKind.DirectedPair &&
           (c as { tag?: string }).tag?.startsWith('carry:')
    )
    expect(carryConstraints).toHaveLength(0)

    // Move clipout.in — anchor should NOT follow
    state = reduce(state, { kind: OpKind.SetEdge, id: rId, edge: 'in', value: 15 })

    expect(clipEdge(state, 'r1', 'in')).toBeCloseTo(15)
    expect(anchorTime(state, 1)).toBeCloseTo(10)     // NOT carried
  })

  it('carry is one-way — writing the anchor does NOT move the clipout edge', () => {
    let state = setup(10, 20, 1, 2)
    const rId = regionOutId('r1')

    // Install carry from clipout.in → anchor 1
    state = reduce(state, carryStart(rId, 'in', anchorOutId(1)))

    // Write the anchor directly (e.g. an anchor drag)
    state = reduce(state, { kind: OpKind.SetValue, id: anchorOutId(1), field: 'time', value: 8 })

    expect(anchorTime(state, 1)).toBeCloseTo(8)      // anchor updated
    expect(clipEdge(state, 'r1', 'in')).toBeCloseTo(10)  // clipout unchanged (one-way)
  })

  it('carryEnd with tag prefix removes all carry constraints for the clipout', () => {
    let state = setup(10, 20, 1, 2)
    const rId = regionOutId('r1')

    // Install carry for both edges
    state = reduce(state, carryStart(rId, 'in',  anchorOutId(1)))
    state = reduce(state, carryStart(rId, 'out', anchorOutId(2)))

    // Both carry constraints should exist
    const before = state.constraints.filter(
      c => c.kind === ConstraintKind.DirectedPair &&
           (c as { tag?: string }).tag?.startsWith(`carry:${rId}:`)
    )
    expect(before).toHaveLength(2)

    // Remove all
    state = reduce(state, carryEnd(rId))

    const after = state.constraints.filter(
      c => c.kind === ConstraintKind.DirectedPair &&
           (c as { tag?: string }).tag?.startsWith(`carry:${rId}:`)
    )
    expect(after).toHaveLength(0)
  })
})
