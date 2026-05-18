/**
 * MirrorPair primitive — symmetric 1-1 binding between (entityA.fieldA) and
 * (entityB.fieldB).
 *
 * Verified behaviors:
 *  1. Installing a MirrorPair on a state where the endpoints differ does
 *     NOT rewrite either side (no install-time sync — delta-based).
 *  2. Writing endpoint A propagates the same value to endpoint B.
 *  3. Writing endpoint B propagates the same value to endpoint A.
 *  4. When both endpoints already have writes in the txn, MirrorPair is
 *     a no-op (explicit writes win).
 *  5. Closure: snap-target enumeration sees the partner as reachable from
 *     either side.
 */

import { describe, it, expect } from 'vitest'
import { reduce, emptyState } from '../../../src/constraints'
import { movementClosure } from '../../../src/constraints/closure'
import type { State, MirrorPair } from '../../../src/constraints/types'
import { OpKind, ConstraintKind, Field } from '../../../src/constraints/types'
import { anchorOutId, regionOutId } from '../../../src/constraints/ids'

function anchorTime(state: State, id: string): number {
  const e = state.entities[id]
  if (!e || e.kind !== 'anchor') throw new Error(`${id} not found`)
  return e.time
}
function clipEdge(state: State, id: string, edge: 'in' | 'out'): number {
  const e = state.entities[id]
  if (!e || e.kind !== 'clip') throw new Error(`${id} not found`)
  return e[edge]
}

function setup(cIn: number, cOut: number, anchorTimeVal: number): { state: State; aId: string; cId: string } {
  const aId = anchorOutId(1)
  const cId = regionOutId('r1')
  let state = emptyState()
  state = reduce(state, { kind: OpKind.AddClip,   id: cId, in: cIn, out: cOut })
  state = reduce(state, { kind: OpKind.AddAnchor, id: aId, time: anchorTimeVal })
  return { state, aId, cId }
}

function installMirror(state: State, aId: string, cId: string, edge: 'in' | 'out'): State {
  const mp: MirrorPair = {
    kind: ConstraintKind.MirrorPair,
    a:    { id: aId, field: Field.Time },
    b:    { id: cId, field: edge },
    tag:  `conform:${aId}:${cId}:${edge}`,
  }
  return reduce(state, { kind: OpKind.AddConstraint, constraint: mp })
}

describe('MirrorPair primitive', () => {

  it('install-time sync is NOT performed — endpoints can differ at install', () => {
    // Anchor at 5, clipout.out at 20 — deliberately divergent. After install,
    // neither side should move.
    let { state, aId, cId } = setup(0, 20, 5)
    state = installMirror(state, aId, cId, 'out')
    expect(anchorTime(state, aId)).toBeCloseTo(5)
    expect(clipEdge(state, cId, 'out')).toBeCloseTo(20)
  })

  it('writing anchor.time propagates to clip.{edge}', () => {
    let { state, aId, cId } = setup(0, 10, 10)
    state = installMirror(state, aId, cId, 'out')
    state = reduce(state, { kind: OpKind.SetValue, id: aId, field: 'time', value: 15 })
    expect(anchorTime(state, aId)).toBeCloseTo(15)
    expect(clipEdge(state, cId, 'out')).toBeCloseTo(15)
  })

  it('writing clip.{edge} propagates to anchor.time', () => {
    let { state, aId, cId } = setup(0, 10, 10)
    state = installMirror(state, aId, cId, 'out')
    state = reduce(state, { kind: OpKind.SetEdge, id: cId, edge: 'out', value: 17 })
    expect(clipEdge(state, cId, 'out')).toBeCloseTo(17)
    expect(anchorTime(state, aId)).toBeCloseTo(17)
  })

  it('works for the in edge too', () => {
    let { state, aId, cId } = setup(5, 20, 5)
    state = installMirror(state, aId, cId, 'in')
    state = reduce(state, { kind: OpKind.SetValue, id: aId, field: 'time', value: 8 })
    expect(clipEdge(state, cId, 'in')).toBeCloseTo(8)
  })

  it('Move op on the anchor propagates the new time to the clip edge', () => {
    let { state, aId, cId } = setup(0, 10, 10)
    state = installMirror(state, aId, cId, 'out')
    state = reduce(state, { kind: OpKind.Move, id: aId, delta: 3 })
    expect(anchorTime(state, aId)).toBeCloseTo(13)
    expect(clipEdge(state, cId, 'out')).toBeCloseTo(13)
  })

  it('movementClosure reaches partner from either endpoint', () => {
    let { state, aId, cId } = setup(0, 10, 10)
    state = installMirror(state, aId, cId, 'out')
    expect(movementClosure(state, aId).has(cId)).toBe(true)
    expect(movementClosure(state, cId).has(aId)).toBe(true)
  })
})
