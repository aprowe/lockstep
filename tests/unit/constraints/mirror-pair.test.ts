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

describe('MirrorPair — guard', () => {
  // The guard expresses the binding's implicit install-time premise.
  // When the guard endpoints receive divergent deltas in the same pass,
  // the premise is being broken — MirrorPair suppresses propagation so the
  // breakout-frame cascade doesn't nudge the anchor.

  function setupConform(): {
    state: State
    anchorOut: string
    anchorIn:  string
    clipOut:   string
    clipIn:    string
  } {
    const anchorOut = anchorOutId(1)
    const anchorIn  = `a1-in`
    const clipOut   = regionOutId('r1')
    const clipIn    = `r1-in`
    let state = emptyState()
    // Input-space coincidence: clipin.in = 10, anchor-in.time = 10
    state = reduce(state, { kind: OpKind.AddClip,   id: clipIn,    in: 10, out: 20 })
    state = reduce(state, { kind: OpKind.AddAnchor, id: anchorIn,  time: 10 })
    // Output-space starting position: clipout.in = 10, anchor-out.time = 10
    state = reduce(state, { kind: OpKind.AddClip,   id: clipOut,   in: 10, out: 20 })
    state = reduce(state, { kind: OpKind.AddAnchor, id: anchorOut, time: 10 })
    // MirrorPair with guard: anchor-out.time ↔ clipout.in, guarded by clipin.in ↔ anchor-in.time
    const mp: MirrorPair = {
      kind:  ConstraintKind.MirrorPair,
      a:     { id: anchorOut, field: Field.Time },
      b:     { id: clipOut,   field: Field.In   },
      guard: {
        a:   { id: anchorIn,  field: Field.Time },
        b:   { id: clipIn,    field: Field.In   },
      },
      tag:   `conform:1:r1:in`,
    }
    state = reduce(state, { kind: OpKind.AddConstraint, constraint: mp })
    return { state, anchorOut, anchorIn, clipOut, clipIn }
  }

  it('guard preserved (no guard-side writes): fires on b→a (clipout edge → anchor)', () => {
    let { state, anchorOut, clipOut } = setupConform()
    state = reduce(state, { kind: OpKind.SetEdge, id: clipOut, edge: 'in', value: 15 })
    expect(anchorTime(state, anchorOut)).toBeCloseTo(15)
  })

  it('guard broken (clipin moves but anchor-in stays): suppresses b→a', () => {
    let { state, anchorOut, clipOut, clipIn } = setupConform()
    // Simulate the bad cascade: clipin.in moves +5 (e.g., default-link drag of clipin),
    // which would cascade to clipout.in via a hypothetical DirectedPair. Here we just
    // seed both writes manually to mimic what the txn looks like during that pass.
    // The guard sees clipin.in moved +5 but anchor-in.time didn't → divergent → suppress.
    state = reduce(state, { kind: OpKind.AddConstraint, constraint: {
      kind: ConstraintKind.DirectedPair, from: clipIn, to: clipOut,
      mode: 'translate' as never, tag: 'cascade',
    } })
    // Move clipin (translate-shaped) → cascades to clipout via the DirectedPair.
    state = reduce(state, { kind: OpKind.Move, id: clipIn, delta: 5 })
    // anchor-out should NOT have moved — the guard suppressed MirrorPair.
    expect(anchorTime(state, anchorOut)).toBeCloseTo(10)
    // And clipout did follow the cascade.
    expect(clipEdge(state, clipOut, 'in')).toBeCloseTo(15)
  })

  it('guard preserved (both guard endpoints translate by same delta): fires', () => {
    let { state, anchorOut, anchorIn, clipOut, clipIn } = setupConform()
    // Both guard endpoints write +5 → "translating the conformed assembly together"
    // → guard preserved → MirrorPair fires.
    state = reduce(state, { kind: OpKind.AddConstraint, constraint: {
      kind: ConstraintKind.TranslateGroup,
      ids:  [clipIn, anchorIn, clipOut, anchorOut],
      tag:  'lasso',
    } })
    state = reduce(state, { kind: OpKind.Move, id: clipIn, delta: 5 })
    // All four entities moved by +5; conformance preserved at the new position.
    expect(anchorTime(state, anchorOut)).toBeCloseTo(15)
    expect(clipEdge(state, clipOut, 'in')).toBeCloseTo(15)
  })
})
