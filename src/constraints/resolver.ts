/**
 * Constraint resolver — phase pipeline.
 *
 *   op → seedWrites → propose → restrict → finalize → derive → applyWrites
 *
 * Each constraint kind is handled by one (or more) entries in HANDLERS. Every
 * handler is single-purpose: it knows ONLY about its own constraint kind and
 * mutates the in-flight Txn. The translate handler doesn't know about
 * clamps; the clamp handler doesn't know about translates. They communicate
 * via the Txn.
 */

import type {
  Clamp,
  ConformRedirect,
  ConformVisual,
  Constraint,
  DirectedPair,
  Derived,
  Entity,
  EntityId,
  Op,
  PreserveLength,
  ScaleGroup,
  SnapTarget,
  State,
  Txn,
  TranslateGroup,
  Write,
} from './types'
import {
  ConstraintKind,
  EntityKind,
  Field,
  OpKind,
  PairMode,
  Phase,
  PreserveMode,
} from './types'

// ─── Top-level reducer ────────────────────────────────────────────────────

export function reduce(state: State, op: Op): State {
  const next = clone(state)

  switch (op.kind) {

    case OpKind.AddAnchor: {
      next.entities[op.id] = {
        kind: EntityKind.Anchor,
        id:   op.id,
        time: op.time,
      }
      return next
    }

    case OpKind.AddClip: {
      next.entities[op.id] = {
        kind: EntityKind.Clip,
        id:   op.id,
        in:   op.in,
        out:  op.out,
      }
      return next
    }

    case OpKind.AddConstraint: {
      next.constraints = [...next.constraints, op.constraint]
      return next
    }

    case OpKind.RemoveConstraint: {
      next.constraints = next.constraints.filter((c, i) => !op.predicate(c, i))
      return next
    }

    case OpKind.Delete: {
      return propagateDelete(next, op.id)
    }

    case OpKind.Move:
    case OpKind.SetEdge:
    case OpKind.SetValue: {
      return runPipeline(next, op)
    }
  }
}

// ─── Pipeline ─────────────────────────────────────────────────────────────

/** Max fixed-point iterations for the propose phase. Constraints can chain
 *  (translate_group writes A; directed_pair A→D writes D; etc.), so we
 *  iterate until the txn signature stops changing. The cap guards against
 *  pathological cycles. */
const PROPOSE_MAX_ITERATIONS = 16

function runPipeline(state: State, op: Op): State {
  let txn = seedWrites(state, op)

  // Propose: iterate to fixed point. Constraint propagations can chain —
  // a write spawned by handler N can be the seed for handler M, and we
  // need to keep cycling through all propose handlers until nothing new
  // appears.
  let previousSignature = txnSignature(txn)
  for (let i = 0; i < PROPOSE_MAX_ITERATIONS; i++) {
    txn = runPhase(state, txn, Phase.Propose)
    const currentSignature = txnSignature(txn)
    if (currentSignature === previousSignature) break
    previousSignature = currentSignature
  }

  // Restrict / finalize each run exactly once. They modify or remove
  // existing writes; they don't open new propagation paths.
  txn = runPhase(state, txn, Phase.Restrict)
  txn = runPhase(state, txn, Phase.Finalize)

  // Commit position writes BEFORE running derive — derived lambdas read
  // state.entities and need the post-commit values to compute their
  // outputs (e.g., the bpm-derived constraint reads the new clip length).
  applyWrites(state, txn)
  runPhase(state, txn, Phase.Derive)
  return state
}

function runPhase(state: State, txn: Txn, phase: Phase): Txn {
  let result = txn
  for (const constraint of state.constraints) {
    for (const handler of HANDLERS) {
      if (handler.kind !== constraint.kind) continue
      if (handler.phase !== phase) continue
      result = handler.apply(state, constraint as never, result)
    }
  }
  return result
}

/** Canonical string representation of the txn for fixed-point detection.
 *  Two txns with the same writes (any order) produce the same signature. */
function txnSignature(txn: Txn): string {
  return txn
    .map(w => `${w.entityId}.${w.field}=${w.from}->${w.to}`)
    .sort()
    .join('|')
}

/** Build the seed txn — the op's direct effect, before any propagation. */
function seedWrites(state: State, op: Op): Txn {

  if (op.kind === OpKind.Move) {
    const entity = state.entities[op.id]
    if (!entity) return []

    if (entity.kind === EntityKind.Anchor) {
      return [
        {
          entityId: entity.id,
          field:    Field.Time,
          from:     entity.time,
          to:       entity.time + op.delta,
        },
      ]
    }

    return [
      {
        entityId: entity.id,
        field:    Field.In,
        from:     entity.in,
        to:       entity.in + op.delta,
      },
      {
        entityId: entity.id,
        field:    Field.Out,
        from:     entity.out,
        to:       entity.out + op.delta,
      },
    ]
  }

  if (op.kind === OpKind.SetEdge) {
    const entity = state.entities[op.id]
    if (!entity || entity.kind !== EntityKind.Clip) return []
    const from = op.edge === 'in' ? entity.in : entity.out
    return [
      {
        entityId: entity.id,
        field:    op.edge,
        from,
        to:       op.value,
      },
    ]
  }

  if (op.kind === OpKind.SetValue) {
    if (op.field === 'bpm' || op.field === 'lockedBeats') {
      state.meta[op.id] = {
        ...(state.meta[op.id] ?? {}),
        [op.field]: op.value,
      }
      return []
    }
    const entity = state.entities[op.id]
    if (!entity) return []
    const from = readField(entity, op.field) ?? 0
    return [
      {
        entityId: op.id,
        field:    op.field,
        from,
        to:       op.value,
      },
    ]
  }

  return []
}

/** Apply all proposed writes to state. */
function applyWrites(state: State, txn: Txn): State {
  for (const write of txn) {
    const entity = state.entities[write.entityId]
    if (!entity) continue
    writeField(entity, write.field, write.to)
  }
  return state
}

// ─── Delete propagation (out-of-pipeline) ─────────────────────────────────

function propagateDelete(state: State, id: EntityId): State {
  const doomed = new Set([id])

  let grew = true
  while (grew) {
    grew = false
    for (const constraint of state.constraints) {
      if (constraint.kind !== ConstraintKind.DeleteGroup) continue
      if (!constraint.ids.some(x => doomed.has(x))) continue
      for (const x of constraint.ids) {
        if (doomed.has(x)) continue
        doomed.add(x)
        grew = true
      }
    }
  }

  for (const x of doomed) {
    delete state.entities[x]
    delete state.meta[x]
  }

  state.constraints = state.constraints.filter(c =>
    constraintEntities(c).every(x => !doomed.has(x)),
  )

  return state
}

// ─── Handlers ─────────────────────────────────────────────────────────────

type Handler = (state: State, constraint: never, txn: Txn) => Txn

interface HandlerEntry {
  kind:  Constraint['kind']
  phase: Phase
  apply: Handler
}

const HANDLERS: HandlerEntry[] = [

  // ── PROPOSE ──────────────────────────────────────────────────────────

  /** translate_group: a translate-shaped seed translates the rest of the
   *  group by the same delta. Resize-shaped seeds (single clip edge) pass
   *  through untouched — scale_group will handle them.
   *    - bidirectional (no driver): any member with writes can be the seed.
   *    - directed (driver set):      only the driver's writes seed; if the
   *      driver has no writes, the constraint is inert. */
  {
    kind:  ConstraintKind.TranslateGroup,
    phase: Phase.Propose,
    apply: (state, c: never, txn) => {
      const group    = c as TranslateGroup
      const seedIds  = group.driver !== undefined ? [group.driver] : group.ids
      const delta    = findTranslateDelta(state, seedIds, txn, group.driver)
      if (delta === null) return txn
      // Followers = group ids minus the driver (if set) AND minus any
      // entity that ALREADY has a seed write in this txn. Tagging the
      // seed entity with our 'translategroup' tag would clobber the seed
      // status and break the next Propose iteration's delta computation.
      const hasSeedWrite = (id: EntityId): boolean =>
        txn.some(w => w.entityId === id && !w.seedTag)
      const followers = group.ids.filter(id =>
        id !== group.driver && !hasSeedWrite(id),
      )
      return mergeWrites(txn, makeTranslateWrites(state, followers, delta, 'translategroup'))
    },
  },

  /** directed_pair (translate): translate-shaped seed on `from` propagates
   *  to `to`. */
  {
    kind:  ConstraintKind.DirectedPair,
    phase: Phase.Propose,
    apply: (state, c: never, txn) => {
      const pair = c as DirectedPair
      if (pair.mode !== PairMode.Translate) return txn
      const delta = findTranslateDelta(state, [pair.from], txn, pair.from)
      if (delta === null) return txn
      return mergeWrites(txn, makeTranslateWrites(state, [pair.to], delta, 'directedpair-translate'))
    },
  },

  /** directed_pair (mirror_edge): a clip-edge write on `from` copies the
   *  same value to `to`'s matching field. When `fromEdge` is set, only the
   *  specified edge write triggers propagation (needed for body-pan where both
   *  edges move and two separate pairs exist — one per edge). */
  {
    kind:  ConstraintKind.DirectedPair,
    phase: Phase.Propose,
    apply: (state, c: never, txn) => {
      const pair = c as DirectedPair
      if (pair.mode !== PairMode.MirrorEdge) return txn

      const driver = txn.find(w =>
        w.entityId === pair.from &&
        (pair.fromEdge !== undefined
          ? w.field === (pair.fromEdge === 'in' ? Field.In : Field.Out)
          : (w.field === Field.In || w.field === Field.Out)),
      )
      if (!driver) return txn

      const target = state.entities[pair.to]
      if (!target) return txn

      const targetField = target.kind === EntityKind.Anchor
        ? Field.Time
        : driver.field
      const from = readField(target, targetField) ?? 0

      // Tag default-link MirrorEdge cascade writes so ConformRedirect can
      // distinguish them from user-seeded clipout writes. Any non-empty
      // seedTag marks "this is a derived cascade, not user intent."
      const isDefaultLink = pair.tag?.startsWith('defaultlink:') ?? false

      return mergeWrites(txn, [
        {
          entityId: pair.to,
          field:    targetField,
          from,
          to:       driver.to,
          ...(isDefaultLink ? { seedTag: 'defaultlink' } : {}),
        },
      ])
    },
  },

  /** conform_visual: one-way coincidence-triggered conform asserting the
   *  invariant "when anchor.orig coincides with clipin.edge, clipout.edge =
   *  anchor.beat". Fires on ANY relevant write — clipin.edge, anchor.orig,
   *  anchor.beat, or clipout.edge — so the invariant holds at every fixed-
   *  point pass regardless of which entity the user is dragging. The output
   *  is one-way: anchor-side endpoints are never written here. User clipout
   *  drags are redirected to anchor.beat by ConformRedirect (which runs
   *  before this rule), so by the time this fires, the only clipout write
   *  it might override is a default-link cascade. */
  {
    kind:  ConstraintKind.ConformVisual,
    phase: Phase.Propose,
    apply: (state, c: never, txn) => {
      const cv = c as ConformVisual
      const anchorIn  = state.entities[cv.anchorInId]
      const anchorOut = state.entities[cv.anchorOutId]
      const clipOut   = state.entities[cv.clipOutId]
      if (!anchorIn  || anchorIn.kind  !== EntityKind.Anchor) return txn
      if (!anchorOut || anchorOut.kind !== EntityKind.Anchor) return txn
      if (!clipOut   || clipOut.kind   !== EntityKind.Clip)   return txn

      const clipInEdgeField = cv.edge === 'in' ? Field.In : Field.Out
      const clipOutField    = cv.edge === 'in' ? Field.In : Field.Out
      const clipInWrite     = txn.find(w => w.entityId === cv.clipId && w.field === clipInEdgeField)
      const anchorInWrite   = txn.find(w => w.entityId === cv.anchorInId && w.field === Field.Time)
      const anchorOutWrite  = txn.find(w => w.entityId === cv.anchorOutId && w.field === Field.Time)
      const clipOutWrite    = txn.find(w => w.entityId === cv.clipOutId && w.field === clipOutField)

      // Gate: fire whenever ANY input that could affect the answer has a
      // write this txn. Without this gate, ConformVisual would fire on
      // every empty-txn pass and clamp clipout to anchor.beat even when
      // no relevant write occurred.
      if (!clipInWrite && !anchorInWrite && !anchorOutWrite && !clipOutWrite) return txn

      const anchorInTime = anchorInWrite?.to ?? anchorIn.time
      const clipInEdge   = clipInWrite?.to   ?? (cv.edge === 'in'
                            ? (state.entities[cv.clipId] as { in: number } | undefined)?.in
                            : (state.entities[cv.clipId] as { out: number } | undefined)?.out)
      if (clipInEdge === undefined) return txn

      // Coincidence check (input space, txn-aware).
      if (Math.abs(clipInEdge - anchorInTime) > CONFORM_EPSILON) return txn

      // Coincident — write anchor-out.time to the clipout's matching edge.
      const anchorOutTime   = anchorOutWrite?.to ?? anchorOut.time
      const clipOutCurrent  = cv.edge === 'in' ? clipOut.in : clipOut.out
      const clipOutEffective = clipOutWrite?.to ?? clipOutCurrent
      if (Math.abs(clipOutEffective - anchorOutTime) < EPSILON) return txn

      return mergeWrites(txn, [{
        entityId: cv.clipOutId,
        field:    clipOutField,
        from:     clipOutCurrent,
        to:       anchorOutTime,
        seedTag:  'conform',
      }])
    },
  },

  /** conform_redirect: when a user gesture has written clipout.edge
   *  directly AND input coincidence (clipin.edge ≈ anchor.orig) holds,
   *  rewrite the clipout write as an anchor.beat write with the same
   *  delta. ConformVisual then asserts clipout = anchor.beat on a later
   *  pass.
   *
   *  This implements "drag clipout = drag anchor.beat" while keeping the
   *  conform invariant strictly directed (anchor → clipout, never the
   *  reverse). Replaces the symmetric MirrorPair that previously coupled
   *  these endpoints — symmetric coupling let raw cursor values leak
   *  through the default-link cascade into the anchor.
   *
   *  Skipped when:
   *   - clipout write is tagged (seedTag set) — it's a cascade, not user
   *     intent. ConformVisual handles overriding cascades.
   *   - anchor.beat already has a write — user is moving anchor directly. */
  {
    kind:  ConstraintKind.ConformRedirect,
    phase: Phase.Propose,
    apply: (state, c: never, txn) => {
      const cr = c as ConformRedirect
      const anchorIn  = state.entities[cr.anchorInId]
      const anchorOut = state.entities[cr.anchorOutId]
      const clipIn    = state.entities[cr.clipId]
      const clipOut   = state.entities[cr.clipOutId]
      if (!anchorIn  || anchorIn.kind  !== EntityKind.Anchor) return txn
      if (!anchorOut || anchorOut.kind !== EntityKind.Anchor) return txn
      if (!clipIn    || clipIn.kind    !== EntityKind.Clip)   return txn
      if (!clipOut   || clipOut.kind   !== EntityKind.Clip)   return txn

      const clipOutField = cr.edge === 'in' ? Field.In : Field.Out
      const clipOutIdx   = txn.findIndex(w =>
        w.entityId === cr.clipOutId && w.field === clipOutField,
      )
      if (clipOutIdx < 0) return txn
      const clipOutWrite = txn[clipOutIdx]

      // Skip cascade writes (only redirect user intent).
      if (clipOutWrite.seedTag) return txn

      // Don't double-write anchor.beat if user is already moving it.
      if (txn.some(w => w.entityId === cr.anchorOutId && w.field === Field.Time)) return txn

      // Coincidence check (input space, txn-aware).
      const clipInEdgeField = cr.edge === 'in' ? Field.In : Field.Out
      const clipInWrite     = txn.find(w => w.entityId === cr.clipId && w.field === clipInEdgeField)
      const anchorInWrite   = txn.find(w => w.entityId === cr.anchorInId && w.field === Field.Time)
      const clipInEdge      = clipInWrite?.to ?? (cr.edge === 'in' ? clipIn.in : clipIn.out)
      const anchorInTime    = anchorInWrite?.to ?? anchorIn.time
      if (Math.abs(clipInEdge - anchorInTime) > CONFORM_EPSILON) return txn

      // Coincidence holds. Rewrite clipout write → anchor.beat write,
      // preserving delta. Drop the clipout write (ConformVisual will
      // re-add it from the new anchor.beat value on the next pass).
      const delta       = clipOutWrite.to - clipOutWrite.from
      const newAnchorTo = anchorOut.time + delta
      const filtered    = txn.filter((_, i) => i !== clipOutIdx)
      return mergeWrites(filtered, [{
        entityId: cr.anchorOutId,
        field:    Field.Time,
        from:     anchorOut.time,
        to:       newAnchorTo,
      }])
    },
  },

  /** scale_group: a seeded resize on a clip member rescales the rest of
   *  the group around the driver's untouched edge.
   *    - bidirectional (no driver): first member with writes drives.
   *    - directed (driver set):     only that member can drive. */
  {
    kind:  ConstraintKind.ScaleGroup,
    phase: Phase.Propose,
    apply: (state, c: never, txn) => {
      const group = c as ScaleGroup

      let driverId: EntityId | undefined
      if (group.driver !== undefined) {
        if (!txn.some(w => w.entityId === group.driver)) return txn
        driverId = group.driver
      } else {
        driverId = group.ids.find(id => txn.some(w => w.entityId === id))
        if (!driverId) return txn
      }

      const driver = state.entities[driverId]
      if (!driver || driver.kind !== EntityKind.Clip) return txn

      const inWrite  = txn.find(w => w.entityId === driverId && w.field === Field.In)
      const outWrite = txn.find(w => w.entityId === driverId && w.field === Field.Out)
      if (inWrite && outWrite)   return txn   // both edges moved → pan, not scale
      if (!inWrite && !outWrite) return txn   // neither edge moved

      const movingField = inWrite ? Field.In : Field.Out
      const pivot       = movingField === Field.In ? driver.out : driver.in
      const newEdge     = (inWrite ?? outWrite)!.to
      const oldLength   = driver.out - driver.in
      const newLength   = movingField === Field.In
        ? driver.out - newEdge
        : newEdge - driver.in

      if (Math.abs(oldLength) < EPSILON) return txn
      if (Math.abs(newLength) < EPSILON) return txn

      const scaleFactor = newLength / oldLength
      const propagated: Write[] = []

      for (const memberId of group.ids) {
        if (memberId === driverId) continue
        const member = state.entities[memberId]
        if (!member) continue

        if (member.kind === EntityKind.Anchor) {
          propagated.push({
            entityId: member.id,
            field:    Field.Time,
            from:     member.time,
            to:       pivot + (member.time - pivot) * scaleFactor,
          })
        } else {
          propagated.push({
            entityId: member.id,
            field:    Field.In,
            from:     member.in,
            to:       pivot + (member.in - pivot) * scaleFactor,
          })
          propagated.push({
            entityId: member.id,
            field:    Field.Out,
            from:     member.out,
            to:       pivot + (member.out - pivot) * scaleFactor,
          })
        }
      }

      return mergeWrites(txn, propagated)
    },
  },

  // ── RESTRICT ─────────────────────────────────────────────────────────

  /** clamp: clip a single field's proposed value into [min, max]. */
  {
    kind:  ConstraintKind.Clamp,
    phase: Phase.Restrict,
    apply: (_state, c: never, txn) => {
      const clamp = c as Clamp
      return txn.map(write => {
        if (write.entityId !== clamp.entityId) return write
        if (write.field    !== clamp.field)    return write
        return {
          ...write,
          to: clampValue(write.to, clamp.min, clamp.max),
        }
      })
    },
  },

  /** preserve_length: re-shape clip-edge writes that would shrink the clip
   *  below its minimum length. */
  {
    kind:  ConstraintKind.PreserveLength,
    phase: Phase.Restrict,
    apply: (state, c: never, txn) => {
      const preserve = c as PreserveLength

      const inWrite  = txn.find(w => w.entityId === preserve.clipId && w.field === Field.In)
      const outWrite = txn.find(w => w.entityId === preserve.clipId && w.field === Field.Out)
      if (!inWrite && !outWrite) return txn

      const clip = state.entities[preserve.clipId]
      if (!clip || clip.kind !== EntityKind.Clip) return txn

      const proposedIn  = inWrite?.to  ?? clip.in
      const proposedOut = outWrite?.to ?? clip.out
      if (proposedOut - proposedIn >= preserve.min) return txn

      // Whichever edge moved farther is the moving one.
      const inDelta  = inWrite  ? Math.abs(inWrite.to  - inWrite.from)  : 0
      const outDelta = outWrite ? Math.abs(outWrite.to - outWrite.from) : 0
      const movingEdge: 'in' | 'out' =
        inWrite && (!outWrite || inDelta >= outDelta)
          ? 'in'
          : 'out'

      if (preserve.mode === PreserveMode.Clamp) {
        if (movingEdge === 'in') {
          return upsertWrite(txn, preserve.clipId, Field.In, proposedOut - preserve.min)
        }
        return upsertWrite(txn, preserve.clipId, Field.Out, proposedIn + preserve.min)
      }

      // shift mode: preserve original length by translating the partner edge.
      const oldLength = clip.out - clip.in
      if (movingEdge === 'in') {
        return upsertWrite(txn, preserve.clipId, Field.Out, proposedIn + oldLength)
      }
      return upsertWrite(txn, preserve.clipId, Field.In, proposedOut - oldLength)
    },
  },

  /** snap_target: snap the dragged value(s) to the nearest target within
   *  threshold. Uses evaluateSnap() — the SAME function the hint renderer
   *  uses — so propose and hint can never diverge. */
  {
    kind:  ConstraintKind.SnapTarget,
    phase: Phase.Propose,
    apply: (state, c: never, txn) => {
      const snap = c as SnapTarget

      if (snap.mode === 'body') {
        const inIdx  = txn.findIndex(w => w.entityId === snap.id && w.field === Field.In)
        const outIdx = txn.findIndex(w => w.entityId === snap.id && w.field === Field.Out)
        if (inIdx < 0 || outIdx < 0) return txn
        const inWrite  = txn[inIdx]
        const outWrite = txn[outIdx]

        const candidates = evaluateSnap(state, snap, {
          kind: 'body', inValue: inWrite.to, outValue: outWrite.to,
        })
        if (candidates.length === 0) return txn
        const shift = candidates[0].shift
        // Skip only when shift is true floating-point noise. EPSILON (1e-3)
        // creates a visible dead zone around the target — within 1e-3 of the
        // target the snap wouldn't fire and the raw cursor value would be
        // kept, causing a sub-unit wiggle at high zoom.
        if (Math.abs(shift) < SNAP_NOOP_EPSILON) return txn

        const result = [...txn]
        result[inIdx]  = { ...inWrite,  to: inWrite.to  + shift }
        result[outIdx] = { ...outWrite, to: outWrite.to + shift }
        return result
      }

      // Edge mode: snap only the dragged field.
      const writeIdx = txn.findIndex(w =>
        w.entityId === snap.id && w.field === snap.field,
      )
      if (writeIdx < 0) return txn
      const write = txn[writeIdx]

      const candidates = evaluateSnap(state, snap, { kind: 'edge', value: write.to })
      if (candidates.length === 0) return txn
      const best = candidates[0]
      // Same precision-tight no-op check as body mode above.
      if (Math.abs(best.shift) < SNAP_NOOP_EPSILON) return txn

      const result = [...txn]
      result[writeIdx] = { ...write, to: best.value }
      return result
    },
  },

  // ── FINALIZE ─────────────────────────────────────────────────────────

  /** translate_group: after restrictions, member deltas may have diverged.
   *  Reduce them all to the smallest delta in the original sign — keeping
   *  the group rigid. Refuses any sign-flip (cancels the move). Skipped
   *  for resize-shaped txns, and (in directed mode) when the driver has
   *  no writes — a non-driving member moves alone, no group rigidity. */
  {
    kind:  ConstraintKind.TranslateGroup,
    phase: Phase.Finalize,
    apply: (state, c: never, txn) => {
      const group = c as TranslateGroup
      if (group.driver !== undefined &&
          !txn.some(w => w.entityId === group.driver)) return txn
      if (!wasTranslateOp(state, group.ids, txn)) return txn

      const deltas: number[] = []
      for (const id of group.ids) {
        for (const write of txn) {
          if (write.entityId !== id) continue
          deltas.push(write.to - write.from)
        }
      }
      if (deltas.length === 0) return txn

      const signs = new Set(
        deltas.map(d => (d === 0 ? 0 : Math.sign(d))),
      )
      if (signs.has(1) && signs.has(-1)) {
        // Restrictions pushed members in opposite directions — cancel.
        return txn.filter(w => !group.ids.includes(w.entityId))
      }

      const targetDelta = deltas.reduce(
        (smallest, d) => (Math.abs(d) < Math.abs(smallest) ? d : smallest),
        deltas[0],
      )

      return mergeWrites(
        txn.filter(w => !group.ids.includes(w.entityId)),
        makeTranslateWrites(state, group.ids, targetDelta),
      )
    },
  },

  // ── DERIVE ───────────────────────────────────────────────────────────

  /** derived: re-run the lambda if any watched entity was written. */
  {
    kind:  ConstraintKind.Derived,
    phase: Phase.Derive,
    apply: (state, c: never, txn) => {
      const derived = c as Derived
      const touched = txn.some(w => derived.watches.includes(w.entityId))
      if (!touched) return txn
      derived.apply(state)
      return txn
    },
  },

  // ── No-write-propagation kinds: ──────────────────────────────────────
  //   single_of_kind, delete_group, highlight_group, conform_visual.
  // These live in state.constraints but have no resolver handlers.
]

// ─── Built-in derived constraint factories ────────────────────────────────

/** BPM × lockedBeats × length tradeoff. The lambda escape hatch — this
 *  math doesn't fit any generic constraint kind. */
export function bpmDerivedConstraint(
  clipId: EntityId,
  fixed: 'bpm' | 'beats',
): Derived {
  return {
    kind:    ConstraintKind.Derived,
    watches: [clipId],
    tag:     `bpm:${clipId}`,
    meta:    { kind: 'bpm', fixed },
    apply:   (state) => {
      const clip = state.entities[clipId]
      if (!clip || clip.kind !== EntityKind.Clip) return

      const length = clip.out - clip.in
      if (length < EPSILON) return

      const meta = state.meta[clipId] ?? {}
      // Only maintain the invariant when the *derived* field was already
      // tracked in meta — a region added without lockedBeats should not
      // suddenly acquire it just because a SetEdge changed the clip length.
      if (fixed === 'bpm' && meta.bpm !== undefined && meta.lockedBeats !== undefined) {
        meta.lockedBeats = (length * meta.bpm) / 60
      } else if (fixed === 'beats' && meta.lockedBeats !== undefined) {
        meta.bpm = (60 * meta.lockedBeats) / length
      }
      state.meta[clipId] = meta
    },
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const EPSILON = 1e-3
/** Tolerance for "coincident" in the ConformVisual propose handler. Tighter
 *  than EPSILON: coincidence is a meaningful position relationship, not
 *  floating-point slop. */
const CONFORM_EPSILON = 1e-6
/** Tolerance for "shift is true floating-point noise" in SnapTarget. Must be
 *  tighter than CONFORM_EPSILON, because skipping a snap leaves the cursor
 *  value in place — and that value still needs to pass CONFORM_EPSILON for
 *  ConformVisual to engage. With EPSILON (1e-3) this created a visible dead
 *  zone where snap wouldn't fire but conform would also miss. */
const SNAP_NOOP_EPSILON = 1e-9

export function emptyState(): State {
  return {
    entities:    {},
    constraints: [],
    meta:        {},
    globals:     { lockMode: 'bpm' },
  }
}

// ─── Public queries ───────────────────────────────────────────────────────

/** Read a position field off an entity. Returns undefined if the entity/field
 *  combination is invalid. */
export function readEntityField(
  entity: Entity,
  field: Field,
): number | undefined {
  return readField(entity, field)
}

/** Result of `evaluateSnap`. Both the resolver's propose handler and the
 *  hint renderer consume this. `shift` is the delta that snap would apply
 *  to the dragged write(s); `value` is the target value the dragged edge
 *  would land on. */
export interface SnapCandidate {
  entityId: EntityId
  field:    Field
  value:    number
  distance: number
  shift:    number
}

/** Unified snap evaluator. Walks the given SnapTarget's `targets` (plus its
 *  optional grid) and returns ALL candidates within threshold, sorted by
 *  distance ascending.
 *
 *  This is the SINGLE source of truth for snap math — used by both the
 *  resolver's SnapTarget propose handler (which takes candidates[0]) AND
 *  the hint renderer (which takes all values). Eliminates the bug class
 *  where the two diverge (e.g. propose snaps cross-edge but hint doesn't).
 *
 *  `drag.kind === 'edge'`: snap a single field value against each target's
 *  value. One alignment per target.
 *  `drag.kind === 'body'`: snap a clip BODY (both edges). For each target,
 *  pick whichever of (inValue, outValue) is closer — supports cross-edge
 *  alignment ("abut" gestures). One alignment per target (the closest). */
export function evaluateSnap(
  state: State,
  snap:  SnapTarget,
  drag:  { kind: 'edge'; value: number }
       | { kind: 'body'; inValue: number; outValue: number },
  /** Multiplier on snap.threshold for the inclusion radius. Default 1 (the
   *  snap distance — used by the Propose-phase handler). Hint rendering
   *  passes a larger value to surface "approaching a snap" indicators
   *  before the cursor enters the actual snap zone. */
  thresholdMultiplier = 1,
): SnapCandidate[] {
  const out: SnapCandidate[] = []
  const effectiveThreshold = snap.threshold * thresholdMultiplier

  for (const target of snap.targets) {
    const e = state.entities[target.entityId]
    if (!e) continue
    const targetValue = readField(e, target.field)
    if (targetValue === undefined) continue

    let bestShift: number
    if (drag.kind === 'edge') {
      bestShift = targetValue - drag.value
    } else {
      const dIn  = targetValue - drag.inValue
      const dOut = targetValue - drag.outValue
      bestShift = Math.abs(dIn) <= Math.abs(dOut) ? dIn : dOut
    }
    const distance = Math.abs(bestShift)
    if (distance > effectiveThreshold) continue
    out.push({
      entityId: target.entityId,
      field:    target.field,
      value:    targetValue,
      distance,
      shift:    bestShift,
    })
  }

  if (snap.grid && snap.grid.interval > 0) {
    const { interval, offset } = snap.grid
    const edges = drag.kind === 'edge' ? [drag.value] : [drag.inValue, drag.outValue]
    for (const v of edges) {
      const mark = offset + Math.round((v - offset) / interval) * interval
      const distance = Math.abs(mark - v)
      if (distance <= effectiveThreshold) {
        out.push({
          entityId: 'grid',
          field:    Field.Time,
          value:    mark,
          distance,
          shift:    mark - v,
        })
      }
    }
  }

  return out.sort((a, b) => a.distance - b.distance)
}

/** Find snap candidates for an entity that's currently being dragged.
 *  Walks every `snap_target` constraint for `draggedId` and returns the
 *  candidates within threshold for the given `field`/`currentValue`.
 *
 *  Implemented as a thin wrapper around `evaluateSnap` so hint rendering
 *  and propose-phase snap can never diverge.
 *
 *  `bodyOtherEdge` is the OTHER edge of the dragged body when the
 *  constraint is in body mode — required for cross-edge alignment. Hint
 *  callers passing only `currentValue` get edge-mode evaluation (which is
 *  correct for edge-mode constraints; for body-mode constraints, the
 *  caller should pass both edges via the second helper below).
 */
export function findSnapCandidates(
  state: State,
  draggedId: EntityId,
  field: Field,
  currentValue: number,
  bodyOtherEdge?: number,
  /** Multiplier on each SnapTarget's threshold. Default 1 matches the
   *  resolver's snap zone. Hint callers pass a larger value (e.g. 3) so
   *  the indicator appears as the cursor approaches a target — not only
   *  once it's already inside the snap radius. */
  thresholdMultiplier = 1,
): SnapCandidate[] {
  const result: SnapCandidate[] = []
  for (const constraint of state.constraints) {
    if (constraint.kind !== ConstraintKind.SnapTarget) continue
    if (constraint.id   !== draggedId)                 continue

    const isBody = constraint.mode === 'body'
    if (!isBody && constraint.field !== field) continue
    if (isBody && field !== Field.In && field !== Field.Out) continue

    const drag = isBody && bodyOtherEdge !== undefined
      ? { kind: 'body' as const,
          inValue:  field === Field.In  ? currentValue : bodyOtherEdge,
          outValue: field === Field.Out ? currentValue : bodyOtherEdge }
      : { kind: 'edge' as const, value: currentValue }

    result.push(...evaluateSnap(state, constraint, drag, thresholdMultiplier))
  }
  return result.sort((a, b) => a.distance - b.distance)
}

function constraintEntities(constraint: Constraint): EntityId[] {
  switch (constraint.kind) {

    case ConstraintKind.TranslateGroup:
    case ConstraintKind.ScaleGroup:
    case ConstraintKind.DeleteGroup:
    case ConstraintKind.HighlightGroup:
      return constraint.ids

    case ConstraintKind.DirectedPair:
      return [constraint.from, constraint.to]

    case ConstraintKind.Derived:
      return constraint.watches

    case ConstraintKind.Clamp:
      return [constraint.entityId]

    case ConstraintKind.PreserveLength:
      return [constraint.clipId]

    case ConstraintKind.SnapTarget:
      return [
        constraint.id,
        ...constraint.targets.map(t => t.entityId),
      ]

    case ConstraintKind.SingleOfKind:
      return constraint.activeId ? [constraint.activeId] : []

    case ConstraintKind.ConformVisual:
    case ConstraintKind.ConformRedirect:
      return [
        constraint.anchorInId,
        constraint.anchorOutId,
        constraint.clipId,
        constraint.clipOutId,
      ]

    // SnapCohort and SnapRule are metadata constraints — they don't bind to
    // specific entities for dependency-tracking purposes; the dependency tracker
    // skips them by returning an empty list.
    case ConstraintKind.SnapCohort:
    case ConstraintKind.SnapRule:
      return []
  }
}

/** Returns the txn's delta IFF every member with writes looks like a
 *  translate seed AND they're all at the same delta. Catches:
 *    - clips with both edges at the same delta (translate-shaped)
 *    - anchors with a time write
 *  Returns null when ANY member has:
 *    - a clip with only one edge written (resize, not translate)
 *    - a clip with both edges at different deltas (scale, not translate)
 *    - an anchor whose delta differs from previously-seen members
 *      (e.g. scale_group propagation produced non-uniform anchor writes —
 *      treating those as a translate would clobber the scale). */
function findTranslateDelta(
  state: State,
  ids: EntityId[],
  txn: Txn,
  driver?: EntityId,
): number | null {

  // SEED writes (no seedTag) are the user-originated writes. Cascade
  // writes (default-link, prior TranslateGroup passes, ConformVisual, etc.)
  // are tagged. We normally only consider seed writes for delta — cascade
  // writes can carry stale values during a Propose iteration (e.g., after
  // SnapTarget restricts the driver, the prior cascade's follower writes
  // are still in the txn but need re-derivation).
  //
  // EXCEPTION: when this group has a `driver`, the driver's write counts
  // even if it's tagged. A "lock" group with driver=clipout needs to fire
  // when clipout was written by ConformVisual (user dragged the anchor and
  // conform wrote clipout = anchor.beat). The driver is by definition the
  // single source of truth for the group's delta, so accepting any write
  // on it doesn't admit the stale-write hazard the seed filter exists to
  // prevent.
  const isEligible = (w: Write, id: EntityId): boolean =>
    !w.seedTag || (driver !== undefined && id === driver)
  let candidate: number | null = null

  for (const id of ids) {
    const entity = state.entities[id]
    if (!entity) continue

    if (entity.kind === EntityKind.Anchor) {
      const write = txn.find(w => w.entityId === id && w.field === Field.Time && isEligible(w, id))
      if (!write) continue
      const delta = write.to - write.from
      if (candidate === null) {
        candidate = delta
      } else if (Math.abs(delta - candidate) > EPSILON) {
        return null
      }
      continue
    }

    const inWrite  = txn.find(w => w.entityId === id && w.field === Field.In  && isEligible(w, id))
    const outWrite = txn.find(w => w.entityId === id && w.field === Field.Out && isEligible(w, id))
    if (!inWrite && !outWrite) continue
    if (!inWrite || !outWrite)  return null   // partial = resize

    const inDelta  = inWrite.to  - inWrite.from
    const outDelta = outWrite.to - outWrite.from
    if (Math.abs(inDelta - outDelta) > EPSILON) return null   // scaled clip

    if (candidate === null) {
      candidate = inDelta
    } else if (Math.abs(inDelta - candidate) > EPSILON) {
      return null
    }
  }

  return candidate
}

/** True if the txn's writes describe a TRANSLATE OP (vs a resize). A
 *  translate is signaled by: every clip member with writes has BOTH edges
 *  written. Anchors are always atomic, so they don't contribute to this
 *  test. A clip with only ONE edge written → resize → return false.
 *
 *  Member deltas don't need to be uniform — clamps and other restrictions
 *  can leave them mismatched, and that's exactly when finalize's group-
 *  rigidity logic needs to fire (re-uniform to the most restrictive). */
function wasTranslateOp(
  state: State,
  ids: EntityId[],
  txn: Txn,
): boolean {
  for (const id of ids) {
    const entity = state.entities[id]
    if (!entity) continue
    if (entity.kind === EntityKind.Anchor) continue

    const inWrite  = txn.find(w => w.entityId === id && w.field === Field.In)
    const outWrite = txn.find(w => w.entityId === id && w.field === Field.Out)
    if (!inWrite && !outWrite) continue          // unaffected — skip
    if (!inWrite || !outWrite)  return false     // partial edge = resize
  }
  return true
}

function makeTranslateWrites(
  state: State,
  ids: EntityId[],
  delta: number,
  seedTag?: string,
): Write[] {

  const writes: Write[] = []

  for (const id of ids) {
    const entity = state.entities[id]
    if (!entity) continue

    if (entity.kind === EntityKind.Anchor) {
      writes.push({
        entityId: id,
        field:    Field.Time,
        from:     entity.time,
        to:       entity.time + delta,
        ...(seedTag ? { seedTag } : {}),
      })
    } else {
      writes.push({
        entityId: id,
        field:    Field.In,
        from:     entity.in,
        to:       entity.in + delta,
        ...(seedTag ? { seedTag } : {}),
      })
      writes.push({
        entityId: id,
        field:    Field.Out,
        from:     entity.out,
        to:       entity.out + delta,
        ...(seedTag ? { seedTag } : {}),
      })
    }
  }

  return writes
}

function mergeWrites(txn: Txn, additions: Write[]): Txn {
  const merged = [...txn]
  for (const addition of additions) {
    const existing = merged.findIndex(w =>
      w.entityId === addition.entityId &&
      w.field    === addition.field,
    )
    if (existing >= 0) {
      merged[existing] = addition
    } else {
      merged.push(addition)
    }
  }
  return merged
}

function upsertWrite(
  txn: Txn,
  entityId: EntityId,
  field: Field,
  to: number,
): Txn {
  const existing = txn.findIndex(w =>
    w.entityId === entityId &&
    w.field    === field,
  )
  if (existing < 0) return txn
  return txn.map((write, i) => {
    if (i !== existing) return write
    return { ...write, to }
  })
}

function readField(entity: Entity, field: Field): number | undefined {
  if (entity.kind === EntityKind.Anchor && field === Field.Time) return entity.time
  if (entity.kind === EntityKind.Clip   && field === Field.In)   return entity.in
  if (entity.kind === EntityKind.Clip   && field === Field.Out)  return entity.out
  return undefined
}

function writeField(entity: Entity, field: Field, value: number): void {
  if (entity.kind === EntityKind.Anchor && field === Field.Time) {
    entity.time = value
    return
  }
  if (entity.kind === EntityKind.Clip && field === Field.In) {
    entity.in = value
    return
  }
  if (entity.kind === EntityKind.Clip && field === Field.Out) {
    entity.out = value
    return
  }
}

function clampValue(value: number, min?: number, max?: number): number {
  if (min !== undefined && value < min) return min
  if (max !== undefined && value > max) return max
  return value
}

function clone(state: State): State {
  return {
    entities: Object.fromEntries(
      Object.entries(state.entities).map(([id, entity]) => [
        id,
        { ...entity } as Entity,
      ]),
    ),
    constraints: state.constraints.map(constraint => ({
      ...constraint,
      ...('ids' in constraint ? { ids: [...constraint.ids] } : {}),
    } as Constraint)),
    meta: Object.fromEntries(
      Object.entries(state.meta).map(([id, meta]) => [
        id,
        { ...meta },
      ]),
    ),
    globals: { ...state.globals },
  }
}
