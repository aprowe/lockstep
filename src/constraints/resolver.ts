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
    ConformRule,
    ConformTuple,
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
} from "./types";
import {
    ConformMode,
    ConstraintKind,
    EntityKind,
    Field,
    OpKind,
    PairMode,
    Phase,
    PreserveMode,
} from "./types";
import { edgeField, findWrite, findWriteIndex, hasWrite, txnValue } from "./txn";
import { activeConstraintsFor, constraintEntities, constraintsByKind } from "./derived-index";
import { movementClosure } from "./closure";
import { lowerBoundBy, lowerBoundNumber } from "./binary-search";
import { pushToBucket } from "./multimap";
import { mapValues } from "es-toolkit";

// ─── Top-level reducer ────────────────────────────────────────────────────

export function reduce(state: State, op: Op): State {
    const next = clone(state);

    switch (op.kind) {
        case OpKind.AddAnchor: {
            next.entities[op.id] = {
                kind: EntityKind.Anchor,
                id: op.id,
                time: op.time,
            };
            return next;
        }

        case OpKind.AddClip: {
            next.entities[op.id] = {
                kind: EntityKind.Clip,
                id: op.id,
                in: op.in,
                out: op.out,
            };
            return next;
        }

        case OpKind.AddConstraint: {
            next.constraints = [...next.constraints, op.constraint];
            return next;
        }

        case OpKind.RemoveConstraint: {
            next.constraints = next.constraints.filter((c, i) => !op.predicate(c, i));
            return next;
        }

        case OpKind.Delete: {
            return propagateDelete(next, op.id);
        }

        case OpKind.Move:
        case OpKind.SetEdge:
        case OpKind.SetValue: {
            return runPipeline(next, op);
        }
    }
}

// ─── Pipeline ─────────────────────────────────────────────────────────────

/** Max fixed-point iterations for the propose phase. Constraints can chain
 *  (translate_group writes A; directed_pair A→D writes D; etc.), so we
 *  iterate until the txn signature stops changing. The cap guards against
 *  pathological cycles. */
const PROPOSE_MAX_ITERATIONS = 16;

function runPipeline(state: State, op: Op): State {
    let txn = seedWrites(state, op);

    // Compute the active constraint subset once: the entities reachable from
    // the op's seed via write-propagating edges, plus one expansion through
    // the other endpoints of constraints they touch (so e.g. an anchor drag
    // also activates the conform bindings into its region clipouts). For
    // small drag closures this cuts the per-phase constraint count by 1-2
    // orders of magnitude vs. iterating `state.constraints`.
    const closure = seedClosure(state, op);
    const active = activeConstraintsFor(state, closure);

    // Propose: iterate to fixed point. Constraint propagations can chain —
    // a write spawned by handler N can be the seed for handler M, and we
    // need to keep cycling through all propose handlers until nothing new
    // appears.
    let previousSignature = txnSignature(txn);
    for (let i = 0; i < PROPOSE_MAX_ITERATIONS; i++) {
        txn = runPhase(active, txn, Phase.Propose, state);
        const currentSignature = txnSignature(txn);
        if (currentSignature === previousSignature) break;
        previousSignature = currentSignature;
    }

    // Restrict / finalize each run exactly once. They modify or remove
    // existing writes; they don't open new propagation paths.
    txn = runPhase(active, txn, Phase.Restrict, state);
    txn = runPhase(active, txn, Phase.Finalize, state);

    // Commit position writes BEFORE running derive — derived lambdas read
    // state.entities and need the post-commit values to compute their
    // outputs (e.g., the bpm-derived constraint reads the new clip length).
    applyWrites(state, txn);
    runPhase(active, txn, Phase.Derive, state);
    return state;
}

/** Seed entity set for the active-constraint computation. For Move/SetEdge/
 *  SetValue the seed is the op's target; movementClosure expands through
 *  write-propagating edges so transitive translates / scales / directed-pair
 *  cascades are covered. */
function seedClosure(state: State, op: Op): Set<EntityId> {
    if (op.kind === OpKind.Move || op.kind === OpKind.SetEdge || op.kind === OpKind.SetValue) {
        return movementClosure(state, op.id);
    }
    return new Set();
}

function runPhase(
    constraints: readonly Constraint[],
    txn: Txn,
    phase: Phase,
    state: State,
): Txn {
    let result = txn;
    const handlerMap = HANDLERS_BY_PHASE_KIND[phase];
    if (handlerMap.size === 0) return result;
    // Preserve original cross-kind iteration order (constraints in array
    // order) while dispatching via the kind table — this skips the inner
    // O(|HANDLERS|) scan that fired on every constraint.
    for (const constraint of constraints) {
        const handlers = handlerMap.get(constraint.kind);
        if (!handlers) continue;
        for (const apply of handlers) {
            result = apply(state, constraint as never, result);
        }
    }
    return result;
}

/** Canonical string representation of the txn for fixed-point detection.
 *  Two txns with the same writes (any order) produce the same signature. */
function txnSignature(txn: Txn): string {
    return txn
        .map((w) => `${w.entityId}.${w.field}=${w.from}->${w.to}`)
        .sort()
        .join("|");
}

/** Build the seed txn — the op's direct effect, before any propagation. */
function seedWrites(state: State, op: Op): Txn {
    if (op.kind === OpKind.Move) {
        const entity = state.entities[op.id];
        if (!entity) return [];

        if (entity.kind === EntityKind.Anchor) {
            return [
                {
                    entityId: entity.id,
                    field: Field.Time,
                    from: entity.time,
                    to: entity.time + op.delta,
                },
            ];
        }

        return [
            {
                entityId: entity.id,
                field: Field.In,
                from: entity.in,
                to: entity.in + op.delta,
            },
            {
                entityId: entity.id,
                field: Field.Out,
                from: entity.out,
                to: entity.out + op.delta,
            },
        ];
    }

    if (op.kind === OpKind.SetEdge) {
        const entity = state.entities[op.id];
        if (!entity || entity.kind !== EntityKind.Clip) return [];
        const from = op.edge === "in" ? entity.in : entity.out;
        return [
            {
                entityId: entity.id,
                field: op.edge,
                from,
                to: op.value,
            },
        ];
    }

    if (op.kind === OpKind.SetValue) {
        if (op.field === "bpm" || op.field === "lockedBeats") {
            state.meta[op.id] = {
                ...(state.meta[op.id] ?? {}),
                [op.field]: op.value,
            };
            return [];
        }
        const entity = state.entities[op.id];
        if (!entity) return [];
        const from = readField(entity, op.field) ?? 0;
        return [
            {
                entityId: op.id,
                field: op.field,
                from,
                to: op.value,
            },
        ];
    }

    return [];
}

/** Apply all proposed writes to state. */
function applyWrites(state: State, txn: Txn): State {
    for (const write of txn) {
        const entity = state.entities[write.entityId];
        if (!entity) continue;
        writeField(entity, write.field, write.to);
    }
    return state;
}

// ─── Delete propagation (out-of-pipeline) ─────────────────────────────────

function propagateDelete(state: State, id: EntityId): State {
    const doomed = new Set([id]);
    const deleteGroups = constraintsByKind(state, ConstraintKind.DeleteGroup);

    let grew = true;
    while (grew) {
        grew = false;
        for (const constraint of deleteGroups) {
            if (constraint.kind !== ConstraintKind.DeleteGroup) continue;
            if (!constraint.ids.some((x) => doomed.has(x))) continue;
            for (const x of constraint.ids) {
                if (doomed.has(x)) continue;
                doomed.add(x);
                grew = true;
            }
        }
    }

    for (const x of doomed) {
        delete state.entities[x];
        delete state.meta[x];
    }

    state.constraints = state.constraints.filter((c) => {
        // Cohorts persist when their members die — the cohort tag is what
        // matters, not its current membership. Every other constraint kind
        // is dropped if any entity it references has been doomed.
        if (c.kind === ConstraintKind.SnapCohort) return true;
        return constraintEntities(c).every((x) => !doomed.has(x));
    });

    return state;
}

// ─── Handlers ─────────────────────────────────────────────────────────────

type Handler = (state: State, constraint: never, txn: Txn) => Txn;

interface HandlerEntry {
    kind: Constraint["kind"];
    phase: Phase;
    apply: Handler;
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
        kind: ConstraintKind.TranslateGroup,
        phase: Phase.Propose,
        apply: (state, c: never, txn) => {
            const group = c as TranslateGroup;
            const seedIds = group.driver !== undefined ? [group.driver] : group.ids;
            const delta = findTranslateDelta(state, seedIds, txn, group.driver);
            if (delta === null) return txn;
            // Followers = group ids minus the driver (if set) AND minus any
            // entity that ALREADY has a seed write in this txn. Tagging the
            // seed entity with our 'translategroup' tag would clobber the seed
            // status and break the next Propose iteration's delta computation.
            const hasSeedWrite = (id: EntityId): boolean =>
                txn.some((w) => w.entityId === id && !w.seedTag);
            const followers = group.ids.filter((id) => id !== group.driver && !hasSeedWrite(id));
            return mergeWrites(txn, makeTranslateWrites(state, followers, delta, "translategroup"));
        },
    },

    /** directed_pair (translate): translate-shaped seed on `from` propagates
     *  to `to`. Skips the merge when `to` already carries a write reflecting
     *  the same delta — the common case during a lasso group-pan where the
     *  TranslateGroup over both endpoints has already produced the target
     *  write, so the DP would just re-emit it. Without this gate, every
     *  anchor-pair DP fires its own `mergeWrites` call per Propose iter,
     *  and the O(W) array copy each call makes turns into O(A·W) per
     *  iter — quadratic in anchor count for the lasso case. */
    {
        kind: ConstraintKind.DirectedPair,
        phase: Phase.Propose,
        apply: (state, c: never, txn) => {
            const pair = c as DirectedPair;
            if (pair.mode !== PairMode.Translate) return txn;
            const delta = findTranslateDelta(state, [pair.from], txn, pair.from);
            if (delta === null) return txn;
            const to = state.entities[pair.to];
            if (to !== undefined) {
                if (to.kind === EntityKind.Anchor) {
                    const existing = findWrite(txn, pair.to, Field.Time);
                    if (
                        existing !== undefined &&
                        Math.abs(existing.to - existing.from - delta) < REDUNDANT_EPSILON
                    ) {
                        return txn;
                    }
                } else {
                    const inWrite = findWrite(txn, pair.to, Field.In);
                    const outWrite = findWrite(txn, pair.to, Field.Out);
                    if (
                        inWrite !== undefined &&
                        outWrite !== undefined &&
                        Math.abs(inWrite.to - inWrite.from - delta) < REDUNDANT_EPSILON &&
                        Math.abs(outWrite.to - outWrite.from - delta) < REDUNDANT_EPSILON
                    ) {
                        return txn;
                    }
                }
            }
            return mergeWrites(
                txn,
                makeTranslateWrites(state, [pair.to], delta, "directedpair-translate"),
            );
        },
    },

    /** directed_pair (mirror_edge): a clip-edge write on `from` copies the
     *  same value to `to`'s matching field. When `fromEdge` is set, only the
     *  specified edge write triggers propagation (needed for body-pan where both
     *  edges move and two separate pairs exist — one per edge). */
    {
        kind: ConstraintKind.DirectedPair,
        phase: Phase.Propose,
        apply: (state, c: never, txn) => {
            const pair = c as DirectedPair;
            if (pair.mode !== PairMode.MirrorEdge) return txn;

            const driver = txn.find(
                (w) =>
                    w.entityId === pair.from &&
                    (pair.fromEdge !== undefined
                        ? w.field === (pair.fromEdge === "in" ? Field.In : Field.Out)
                        : w.field === Field.In || w.field === Field.Out),
            );
            if (!driver) return txn;

            const target = state.entities[pair.to];
            if (!target) return txn;

            const targetField = target.kind === EntityKind.Anchor ? Field.Time : driver.field;
            const from = readField(target, targetField) ?? 0;

            // Tag default-link MirrorEdge cascade writes so ConformRedirect can
            // distinguish them from user-seeded clipout writes. Any non-empty
            // seedTag marks "this is a derived cascade, not user intent."
            const isDefaultLink = pair.tag?.startsWith("defaultlink:") ?? false;

            return mergeWrites(txn, [
                {
                    entityId: pair.to,
                    field: targetField,
                    from,
                    to: driver.to,
                    ...(isDefaultLink ? { seedTag: "defaultlink" } : {}),
                },
            ]);
        },
    },

    /** conform_rule: a single batched constraint covering every
     *  (region × anchor × edge) binding. The handler walks `rule.tuples`
     *  internally and gates each tuple on a per-entity write check — one
     *  rule instance per mode dispatched per Propose iter, regardless of
     *  project size.
     *
     *  `mode === "visual"` asserts the invariant "when anchor.orig
     *  coincides with clipin.edge, clipout.edge = anchor.beat" — one-way
     *  (anchor → clip). `mode === "redirect"` routes user-seeded clipout
     *  writes into anchor.beat writes while input coincidence holds, so
     *  drag-clipout is interpreted as drag-anchor.beat.
     *
     *  Within each Propose iter the redirect rule runs before the visual
     *  rule (install order in `pipeline.buildGraphFromSlice`), preserving
     *  the snap → redirect → visual ordering invariant. */
    {
        kind: ConstraintKind.ConformRule,
        phase: Phase.Propose,
        apply: (state, c: never, txn) => {
            const rule = c as ConformRule;
            if (rule.tuples.length === 0) return txn;
            return rule.mode === ConformMode.Visual
                ? applyConformVisualRule(state, rule, txn)
                : applyConformRedirectRule(state, rule, txn);
        },
    },

    /** scale_group: a seeded resize on a clip member rescales the rest of
     *  the group around the driver's untouched edge.
     *    - bidirectional (no driver): first member with writes drives.
     *    - directed (driver set):     only that member can drive. */
    {
        kind: ConstraintKind.ScaleGroup,
        phase: Phase.Propose,
        apply: (state, c: never, txn) => {
            const group = c as ScaleGroup;

            let driverId: EntityId | undefined;
            if (group.driver !== undefined) {
                if (!hasWrite(txn, group.driver)) return txn;
                driverId = group.driver;
            } else {
                driverId = group.ids.find((id) => hasWrite(txn, id));
                if (!driverId) return txn;
            }

            const driver = state.entities[driverId];
            if (!driver || driver.kind !== EntityKind.Clip) return txn;

            const inWrite = findWrite(txn, driverId, Field.In);
            const outWrite = findWrite(txn, driverId, Field.Out);
            if (inWrite && outWrite) return txn; // both edges moved → pan, not scale
            if (!inWrite && !outWrite) return txn; // neither edge moved

            const movingField = inWrite ? Field.In : Field.Out;
            const pivot = movingField === Field.In ? driver.out : driver.in;
            const newEdge = (inWrite ?? outWrite)!.to;
            const oldLength = driver.out - driver.in;
            const newLength = movingField === Field.In ? driver.out - newEdge : newEdge - driver.in;

            if (Math.abs(oldLength) < EPSILON) return txn;
            if (Math.abs(newLength) < EPSILON) return txn;

            const scaleFactor = newLength / oldLength;
            const propagated: Write[] = [];

            for (const memberId of group.ids) {
                if (memberId === driverId) continue;
                const member = state.entities[memberId];
                if (!member) continue;

                if (member.kind === EntityKind.Anchor) {
                    propagated.push({
                        entityId: member.id,
                        field: Field.Time,
                        from: member.time,
                        to: pivot + (member.time - pivot) * scaleFactor,
                    });
                } else {
                    propagated.push({
                        entityId: member.id,
                        field: Field.In,
                        from: member.in,
                        to: pivot + (member.in - pivot) * scaleFactor,
                    });
                    propagated.push({
                        entityId: member.id,
                        field: Field.Out,
                        from: member.out,
                        to: pivot + (member.out - pivot) * scaleFactor,
                    });
                }
            }

            return mergeWrites(txn, propagated);
        },
    },

    // ── RESTRICT ─────────────────────────────────────────────────────────

    /** clamp: clip a single field's proposed value into [min, max]. */
    {
        kind: ConstraintKind.Clamp,
        phase: Phase.Restrict,
        apply: (_state, c: never, txn) => {
            const clamp = c as Clamp;
            return txn.map((write) => {
                if (write.entityId !== clamp.entityId) return write;
                if (write.field !== clamp.field) return write;
                return {
                    ...write,
                    to: clampValue(write.to, clamp.min, clamp.max),
                };
            });
        },
    },

    /** preserve_length: re-shape clip-edge writes that would shrink the clip
     *  below its minimum length. */
    {
        kind: ConstraintKind.PreserveLength,
        phase: Phase.Restrict,
        apply: (state, c: never, txn) => {
            const preserve = c as PreserveLength;

            const inWrite = findWrite(txn, preserve.clipId, Field.In);
            const outWrite = findWrite(txn, preserve.clipId, Field.Out);
            if (!inWrite && !outWrite) return txn;

            const clip = state.entities[preserve.clipId];
            if (!clip || clip.kind !== EntityKind.Clip) return txn;

            const proposedIn = inWrite?.to ?? clip.in;
            const proposedOut = outWrite?.to ?? clip.out;
            if (proposedOut - proposedIn >= preserve.min) return txn;

            // Whichever edge moved farther is the moving one.
            const inDelta = inWrite ? Math.abs(inWrite.to - inWrite.from) : 0;
            const outDelta = outWrite ? Math.abs(outWrite.to - outWrite.from) : 0;
            const movingEdge: "in" | "out" =
                inWrite && (!outWrite || inDelta >= outDelta) ? "in" : "out";

            if (preserve.mode === PreserveMode.Clamp) {
                if (movingEdge === "in") {
                    return upsertWrite(txn, preserve.clipId, Field.In, proposedOut - preserve.min);
                }
                return upsertWrite(txn, preserve.clipId, Field.Out, proposedIn + preserve.min);
            }

            // shift mode: preserve original length by translating the partner edge.
            const oldLength = clip.out - clip.in;
            if (movingEdge === "in") {
                return upsertWrite(txn, preserve.clipId, Field.Out, proposedIn + oldLength);
            }
            return upsertWrite(txn, preserve.clipId, Field.In, proposedOut - oldLength);
        },
    },

    /** snap_target: snap the dragged value(s) to the nearest target within
     *  threshold. Uses evaluateSnap() — the SAME function the hint renderer
     *  uses — so propose and hint can never diverge. */
    {
        kind: ConstraintKind.SnapTarget,
        phase: Phase.Propose,
        apply: (state, c: never, txn) => {
            const snap = c as SnapTarget;

            if (snap.mode === "body") {
                const inIdx = findWriteIndex(txn, snap.id, Field.In);
                const outIdx = findWriteIndex(txn, snap.id, Field.Out);
                if (inIdx < 0 || outIdx < 0) return txn;
                const inWrite = txn[inIdx];
                const outWrite = txn[outIdx];

                const candidates = evaluateSnap(state, snap, {
                    kind: "body",
                    inValue: inWrite.to,
                    outValue: outWrite.to,
                });
                if (candidates.length === 0) return txn;
                const shift = candidates[0].shift;
                // Skip only when shift is true floating-point noise. EPSILON (1e-3)
                // creates a visible dead zone around the target — within 1e-3 of the
                // target the snap wouldn't fire and the raw cursor value would be
                // kept, causing a sub-unit wiggle at high zoom.
                if (Math.abs(shift) < SNAP_NOOP_EPSILON) return txn;

                const result = [...txn];
                result[inIdx] = { ...inWrite, to: inWrite.to + shift };
                result[outIdx] = { ...outWrite, to: outWrite.to + shift };
                return result;
            }

            // Edge mode: snap only the dragged field.
            const writeIdx = findWriteIndex(txn, snap.id, snap.field);
            if (writeIdx < 0) return txn;
            const write = txn[writeIdx];

            const candidates = evaluateSnap(state, snap, { kind: "edge", value: write.to });
            if (candidates.length === 0) return txn;
            const best = candidates[0];
            // Same precision-tight no-op check as body mode above.
            if (Math.abs(best.shift) < SNAP_NOOP_EPSILON) return txn;

            const result = [...txn];
            result[writeIdx] = { ...write, to: best.value };
            return result;
        },
    },

    // ── FINALIZE ─────────────────────────────────────────────────────────

    /** translate_group: after restrictions, member deltas may have diverged.
     *  Reduce them all to the smallest delta in the original sign — keeping
     *  the group rigid. Refuses any sign-flip (cancels the move). Skipped
     *  for resize-shaped txns, and (in directed mode) when the driver has
     *  no writes — a non-driving member moves alone, no group rigidity. */
    {
        kind: ConstraintKind.TranslateGroup,
        phase: Phase.Finalize,
        apply: (state, c: never, txn) => {
            const group = c as TranslateGroup;
            if (group.driver !== undefined && !txn.some((w) => w.entityId === group.driver))
                return txn;
            if (!wasTranslateOp(state, group.ids, txn)) return txn;

            const deltas: number[] = [];
            for (const id of group.ids) {
                for (const write of txn) {
                    if (write.entityId !== id) continue;
                    deltas.push(write.to - write.from);
                }
            }
            if (deltas.length === 0) return txn;

            const signs = new Set(deltas.map((d) => (d === 0 ? 0 : Math.sign(d))));
            if (signs.has(1) && signs.has(-1)) {
                // Restrictions pushed members in opposite directions — cancel.
                return txn.filter((w) => !group.ids.includes(w.entityId));
            }

            const targetDelta = deltas.reduce(
                (smallest, d) => (Math.abs(d) < Math.abs(smallest) ? d : smallest),
                deltas[0],
            );

            return mergeWrites(
                txn.filter((w) => !group.ids.includes(w.entityId)),
                makeTranslateWrites(state, group.ids, targetDelta),
            );
        },
    },

    // ── DERIVE ───────────────────────────────────────────────────────────

    /** derived: re-run the lambda if any watched entity was written. */
    {
        kind: ConstraintKind.Derived,
        phase: Phase.Derive,
        apply: (state, c: never, txn) => {
            const derived = c as Derived;
            const touched = txn.some((w) => derived.watches.includes(w.entityId));
            if (!touched) return txn;
            derived.apply(state);
            return txn;
        },
    },

    // ── No-write-propagation kinds: ──────────────────────────────────────
    //   single_of_kind, delete_group, highlight_group, conform_visual.
    // These live in state.constraints but have no resolver handlers.
];

/** Precomputed dispatch table: phase → kind → handler[]. Built once at module
 *  load. Replaces the inner `for (const handler of HANDLERS)` scan in
 *  `runPhase` — at N=5000 markers with 30k+ constraints, that scan was the
 *  hottest loop in the system. */
const HANDLERS_BY_PHASE_KIND: Record<Phase, Map<ConstraintKind, Handler[]>> = (() => {
    const out = {} as Record<Phase, Map<ConstraintKind, Handler[]>>;
    for (const phase of Object.values(Phase)) {
        out[phase] = new Map();
    }
    for (const entry of HANDLERS) {
        const m = out[entry.phase];
        let arr = m.get(entry.kind);
        if (!arr) {
            arr = [];
            m.set(entry.kind, arr);
        }
        arr.push(entry.apply);
    }
    return out;
})();

// ─── Conform rule batched handlers ────────────────────────────────────────

/** Collect the tuple indices that could be affected by writes in `txn`,
 *  using the rule's precomputed `byEntity` map. Falls back to a lazy build
 *  if a rule was constructed without one. */
const LAZY_TUPLE_INDEX_CACHE = new WeakMap<
    readonly ConformTuple[],
    Map<EntityId, number[]>
>();

function getTupleIndex(rule: ConformRule): ReadonlyMap<EntityId, readonly number[]> {
    if (rule.byEntity) return rule.byEntity;
    let idx = LAZY_TUPLE_INDEX_CACHE.get(rule.tuples);
    if (idx) return idx;
    idx = new Map();
    for (let i = 0; i < rule.tuples.length; i++) {
        const t = rule.tuples[i];
        pushToBucket(idx, t.anchorInId, i);
        pushToBucket(idx, t.anchorOutId, i);
        pushToBucket(idx, t.clipId, i);
        pushToBucket(idx, t.clipOutId, i);
    }
    LAZY_TUPLE_INDEX_CACHE.set(rule.tuples, idx);
    return idx;
}

/** True iff the txn is a pure uniform translation across every entity the
 *  rule cares about — same delta on every write AND every conform-mentioned
 *  entity is in the txn. Under that condition the rule's input-space
 *  coincidence relations are guaranteed to be preserved (every endpoint
 *  shifts by the same amount), so the entire rule body can be skipped.
 *
 *  This is the common case for lasso group-pan: the TranslateGroup handler
 *  propagates a single delta to every member before the conform handler
 *  runs, leaving the txn uniform and saturating the conform entity set.
 *  Without this skip, the handler walks every tuple to confirm "nothing
 *  changed."
 *
 *  Cheap check: O(|txn| + |conform entities|). Conform entities is the
 *  byEntity map's key count (≈ 4·N for a project with N regions+anchors,
 *  i.e. linear), so this is a small constant fraction of the work we'd
 *  otherwise do per-tuple. */
function isUniformAcrossRuleEntities(rule: ConformRule, txn: Txn): boolean {
    if (txn.length === 0) return true;
    // Saturation prefilter: if there are fewer writes than there are conform-
    // mentioned entities, the txn can't possibly cover them — bail out before
    // walking the entity set. This catches every non-lasso gesture in O(1)
    // and keeps the check from adding overhead to anchor/region drags.
    const idx = getTupleIndex(rule);
    if (txn.length < idx.size) return false;

    const d = txn[0].to - txn[0].from;
    const written = new Set<EntityId>();
    written.add(txn[0].entityId);
    for (let i = 1; i < txn.length; i++) {
        if (Math.abs(txn[i].to - txn[i].from - d) > 1e-9) return false;
        written.add(txn[i].entityId);
    }
    for (const id of idx.keys()) {
        if (!written.has(id)) return false;
    }
    return true;
}

/** Collect candidate tuple indices touched by any txn write. Each writer
 *  entity may map to a list of tuples; we union them into a Set so each
 *  candidate is evaluated once regardless of how many of its endpoints
 *  share writes. */
function candidateTuples(rule: ConformRule, txn: Txn): Set<number> {
    const out = new Set<number>();
    if (txn.length === 0) return out;
    const idx = getTupleIndex(rule);
    for (let i = 0; i < txn.length; i++) {
        const matches = idx.get(txn[i].entityId);
        if (!matches) continue;
        for (const m of matches) out.add(m);
    }
    return out;
}

/**
 * Apply the per-tuple ConformVisual body: when input coincidence holds,
 * write anchorOut.time to the matching clipout edge. Iterates only the
 * tuples whose endpoints have writes in the current txn — for an anchor
 * drag at N=100 this collapses ~40k tuples to ~400.
 */
function applyConformVisualRule(state: State, rule: ConformRule, txn: Txn): Txn {
    // Fast path: uniform translation across every conform entity preserves
    // every coincidence relation (every endpoint shifts by the same amount),
    // so the rule body would be a guaranteed no-op. This catches lasso
    // group-pan in particular, where the TranslateGroup handler has just
    // produced a uniform-delta txn covering every selected entity.
    if (isUniformAcrossRuleEntities(rule, txn)) return txn;

    const candidates = candidateTuples(rule, txn);
    if (candidates.size === 0) return txn;

    let result = txn;
    const tuples = rule.tuples;
    for (const i of candidates) {
        const t = tuples[i];
        const anchorIn = state.entities[t.anchorInId];
        const anchorOut = state.entities[t.anchorOutId];
        const clipIn = state.entities[t.clipId];
        const clipOut = state.entities[t.clipOutId];
        if (!anchorIn || anchorIn.kind !== EntityKind.Anchor) continue;
        if (!anchorOut || anchorOut.kind !== EntityKind.Anchor) continue;
        if (!clipIn || clipIn.kind !== EntityKind.Clip) continue;
        if (!clipOut || clipOut.kind !== EntityKind.Clip) continue;

        const edge = edgeField(t.edge);
        const clipInCurrent = t.edge === "in" ? clipIn.in : clipIn.out;
        const clipOutCurrent = t.edge === "in" ? clipOut.in : clipOut.out;

        const clipInEdge = txnValue(result, t.clipId, edge, clipInCurrent);
        const anchorInTime = txnValue(result, t.anchorInId, Field.Time, anchorIn.time);

        // Coincidence (input-space, txn-aware).
        if (Math.abs(clipInEdge - anchorInTime) > CONFORM_EPSILON) continue;

        const anchorOutTime = txnValue(result, t.anchorOutId, Field.Time, anchorOut.time);
        const clipOutEffective = txnValue(result, t.clipOutId, edge, clipOutCurrent);
        if (Math.abs(clipOutEffective - anchorOutTime) < EPSILON) continue;

        result = mergeWrites(result, [
            {
                entityId: t.clipOutId,
                field: edge,
                from: clipOutCurrent,
                to: anchorOutTime,
                seedTag: "conform",
            },
        ]);
    }
    return result;
}

/**
 * Apply the per-tuple ConformRedirect body: when a user-seeded clipout
 * write is in the txn AND input coincidence holds, rewrite it as an
 * anchor.beat write of the same delta. Iterates only tuples whose
 * endpoints have writes; the per-tuple gate then checks whether the
 * write specifically is on the clipout edge.
 */
function applyConformRedirectRule(state: State, rule: ConformRule, txn: Txn): Txn {
    // Same fast path as the visual rule — uniform translation can't produce
    // a user-seeded clipout write that wasn't already cascaded, so the
    // redirect body would short-circuit anyway. Skipping the candidate scan
    // saves the per-tuple loop entirely.
    if (isUniformAcrossRuleEntities(rule, txn)) return txn;

    const candidates = candidateTuples(rule, txn);
    if (candidates.size === 0) return txn;

    let result = txn;
    const tuples = rule.tuples;
    for (const i of candidates) {
        const t = tuples[i];
        const edge = edgeField(t.edge);

        // Fast gate: redirect requires an existing clipout write.
        const clipOutIdx = findWriteIndex(result, t.clipOutId, edge);
        if (clipOutIdx < 0) continue;
        const clipOutWrite = result[clipOutIdx];

        // Skip cascade writes — only user intent gets redirected.
        if (clipOutWrite.seedTag) continue;

        // Don't double-write anchor.beat if user is already moving it.
        if (hasWrite(result, t.anchorOutId, Field.Time)) continue;

        const anchorIn = state.entities[t.anchorInId];
        const anchorOut = state.entities[t.anchorOutId];
        const clipIn = state.entities[t.clipId];
        const clipOut = state.entities[t.clipOutId];
        if (!anchorIn || anchorIn.kind !== EntityKind.Anchor) continue;
        if (!anchorOut || anchorOut.kind !== EntityKind.Anchor) continue;
        if (!clipIn || clipIn.kind !== EntityKind.Clip) continue;
        if (!clipOut || clipOut.kind !== EntityKind.Clip) continue;

        const clipInCurrent = t.edge === "in" ? clipIn.in : clipIn.out;
        const clipInEdge = txnValue(result, t.clipId, edge, clipInCurrent);
        const anchorInTime = txnValue(result, t.anchorInId, Field.Time, anchorIn.time);
        if (Math.abs(clipInEdge - anchorInTime) > CONFORM_EPSILON) continue;

        // Rewrite clipout write → anchor.beat write, preserving delta.
        const delta = clipOutWrite.to - clipOutWrite.from;
        const newAnchorTo = anchorOut.time + delta;
        const filtered = result.filter((_, idx) => idx !== clipOutIdx);
        result = mergeWrites(filtered, [
            {
                entityId: t.anchorOutId,
                field: Field.Time,
                from: anchorOut.time,
                to: newAnchorTo,
            },
        ]);
    }
    return result;
}

// ─── Built-in derived constraint factories ────────────────────────────────

/** BPM × lockedBeats × length tradeoff. The lambda escape hatch — this
 *  math doesn't fit any generic constraint kind. */
export function bpmDerivedConstraint(clipId: EntityId, fixed: "bpm" | "beats"): Derived {
    return {
        kind: ConstraintKind.Derived,
        watches: [clipId],
        tag: `bpm:${clipId}`,
        meta: { kind: "bpm", fixed },
        apply: (state) => {
            const clip = state.entities[clipId];
            if (!clip || clip.kind !== EntityKind.Clip) return;

            const length = clip.out - clip.in;
            if (length < EPSILON) return;

            const meta = state.meta[clipId] ?? {};
            // Only maintain the invariant when the *derived* field was already
            // tracked in meta — a region added without lockedBeats should not
            // suddenly acquire it just because a SetEdge changed the clip length.
            if (fixed === "bpm" && meta.bpm !== undefined && meta.lockedBeats !== undefined) {
                meta.lockedBeats = (length * meta.bpm) / 60;
            } else if (fixed === "beats" && meta.lockedBeats !== undefined) {
                meta.bpm = (60 * meta.lockedBeats) / length;
            }
            state.meta[clipId] = meta;
        },
    };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const EPSILON = 1e-3;
/** Tolerance for "coincident" in the ConformVisual propose handler. Tighter
 *  than EPSILON: coincidence is a meaningful position relationship, not
 *  floating-point slop. */
const CONFORM_EPSILON = 1e-6;
/** Tolerance for "shift is true floating-point noise" in SnapTarget. Must be
 *  tighter than CONFORM_EPSILON, because skipping a snap leaves the cursor
 *  value in place — and that value still needs to pass CONFORM_EPSILON for
 *  ConformVisual to engage. With EPSILON (1e-3) this created a visible dead
 *  zone where snap wouldn't fire but conform would also miss. */
const SNAP_NOOP_EPSILON = 1e-9;
/** Tolerance for "this DP write would be a no-op against the existing
 *  txn entry" in the DirectedPair-Translate handler. Tight — we only skip
 *  when the values literally match, never coalesce semantically distinct
 *  writes. */
const REDUNDANT_EPSILON = 1e-9;

export function emptyState(): State {
    return {
        entities: {},
        constraints: [],
        meta: {},
        globals: { lockMode: "bpm" },
    };
}

// ─── Public queries ───────────────────────────────────────────────────────

/** Read a position field off an entity. Returns undefined if the entity/field
 *  combination is invalid. */
export function readEntityField(entity: Entity, field: Field): number | undefined {
    return readField(entity, field);
}

/** Result of `evaluateSnap`. Both the resolver's propose handler and the
 *  hint renderer consume this. `shift` is the delta that snap would apply
 *  to the dragged write(s); `value` is the target value the dragged edge
 *  would land on. */
export interface SnapCandidate {
    entityId: EntityId;
    field: Field;
    value: number;
    distance: number;
    shift: number;
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
    snap: SnapTarget,
    drag: { kind: "edge"; value: number } | { kind: "body"; inValue: number; outValue: number },
    /** Multiplier on snap.threshold for the inclusion radius. Default 1 (the
     *  snap distance — used by the Propose-phase handler). Hint rendering
     *  passes a larger value to surface "approaching a snap" indicators
     *  before the cursor enters the actual snap zone. */
    thresholdMultiplier = 1,
): SnapCandidate[] {
    const out: SnapCandidate[] = [];
    const effectiveThreshold = snap.threshold * thresholdMultiplier;

    // Pull a value-sorted index of the targets so we can binary-search the
    // snap-radius window. The cache is keyed on `snap.targets` (a fresh
    // array per Move op), so first call in a Move pays O(N log N) to build
    // and every subsequent call inside the Propose loop is O(log N + k).
    const sorted = sortedTargets(state, snap.targets);

    let lo: number;
    let hi: number;
    if (drag.kind === "edge") {
        lo = drag.value - effectiveThreshold;
        hi = drag.value + effectiveThreshold;
    } else {
        lo = Math.min(drag.inValue, drag.outValue) - effectiveThreshold;
        hi = Math.max(drag.inValue, drag.outValue) + effectiveThreshold;
    }

    const start = lowerBoundBy(sorted, lo, (t) => t.value);
    for (let i = start; i < sorted.length; i++) {
        const item = sorted[i];
        if (item.value > hi) break;
        let bestShift: number;
        if (drag.kind === "edge") {
            bestShift = item.value - drag.value;
        } else {
            const dIn = item.value - drag.inValue;
            const dOut = item.value - drag.outValue;
            bestShift = Math.abs(dIn) <= Math.abs(dOut) ? dIn : dOut;
        }
        const distance = Math.abs(bestShift);
        if (distance > effectiveThreshold) continue;
        out.push({
            entityId: item.entityId,
            field: item.field,
            value: item.value,
            distance,
            shift: bestShift,
        });
    }

    // Scenes sidecar — pre-sorted, no per-Move sort, no entity lookup.
    // The whole point of holding scenes outside `state.entities` is so this
    // path is independent of scene count beyond the binary-search window.
    if (snap.sceneTimes !== undefined && snap.sceneTimes.length > 0) {
        const times = snap.sceneTimes;
        const startScene = lowerBoundNumber(times, lo);
        for (let i = startScene; i < times.length; i++) {
            const v = times[i];
            if (v > hi) break;
            let bestShift: number;
            if (drag.kind === "edge") {
                bestShift = v - drag.value;
            } else {
                const dIn = v - drag.inValue;
                const dOut = v - drag.outValue;
                bestShift = Math.abs(dIn) <= Math.abs(dOut) ? dIn : dOut;
            }
            const distance = Math.abs(bestShift);
            if (distance > effectiveThreshold) continue;
            out.push({
                entityId: `scene:${i}`,
                field: Field.Time,
                value: v,
                distance,
                shift: bestShift,
            });
        }
    }

    if (snap.grid && snap.grid.interval > 0) {
        const { interval, offset } = snap.grid;
        const edges = drag.kind === "edge" ? [drag.value] : [drag.inValue, drag.outValue];
        for (const v of edges) {
            const mark = offset + Math.round((v - offset) / interval) * interval;
            const distance = Math.abs(mark - v);
            if (distance <= effectiveThreshold) {
                out.push({
                    entityId: "grid",
                    field: Field.Time,
                    value: mark,
                    distance,
                    shift: mark - v,
                });
            }
        }
    }

    return out.sort((a, b) => a.distance - b.distance);
}

interface SortedSnapTarget {
    entityId: EntityId;
    field: Field;
    value: number;
}

const SORTED_TARGETS_CACHE = new WeakMap<
    readonly { entityId: EntityId; field: Field }[],
    SortedSnapTarget[]
>();

/** Build (and memoize) a value-sorted copy of `targets`. Target positions
 *  are read from `state.entities` and remain stable across the Propose
 *  fixed-point loop within a single Move op (handlers only mutate the
 *  in-flight txn, not committed entity positions), so caching by the
 *  `targets` array reference is safe — a new SnapTarget per Move gets a
 *  fresh cache miss; subsequent calls reuse. */
function sortedTargets(
    state: State,
    targets: readonly { entityId: EntityId; field: Field }[],
): SortedSnapTarget[] {
    let cached = SORTED_TARGETS_CACHE.get(targets);
    if (cached) return cached;
    cached = [];
    for (const target of targets) {
        const e = state.entities[target.entityId];
        if (!e) continue;
        const value = readField(e, target.field);
        if (value === undefined) continue;
        cached.push({ entityId: target.entityId, field: target.field, value });
    }
    cached.sort((a, b) => a.value - b.value);
    SORTED_TARGETS_CACHE.set(targets, cached);
    return cached;
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
    const result: SnapCandidate[] = [];
    for (const constraint of constraintsByKind(state, ConstraintKind.SnapTarget)) {
        if (constraint.kind !== ConstraintKind.SnapTarget) continue;
        if (constraint.id !== draggedId) continue;

        const isBody = constraint.mode === "body";
        if (!isBody && constraint.field !== field) continue;
        if (isBody && field !== Field.In && field !== Field.Out) continue;

        const drag =
            isBody && bodyOtherEdge !== undefined
                ? {
                      kind: "body" as const,
                      inValue: field === Field.In ? currentValue : bodyOtherEdge,
                      outValue: field === Field.Out ? currentValue : bodyOtherEdge,
                  }
                : { kind: "edge" as const, value: currentValue };

        result.push(...evaluateSnap(state, constraint, drag, thresholdMultiplier));
    }
    return result.sort((a, b) => a.distance - b.distance);
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
        !w.seedTag || (driver !== undefined && id === driver);
    let candidate: number | null = null;

    for (const id of ids) {
        const entity = state.entities[id];
        if (!entity) continue;

        if (entity.kind === EntityKind.Anchor) {
            const write = findWrite(txn, id, Field.Time);
            if (!write || !isEligible(write, id)) continue;
            const delta = write.to - write.from;
            if (candidate === null) {
                candidate = delta;
            } else if (Math.abs(delta - candidate) > EPSILON) {
                return null;
            }
            continue;
        }

        const inMaybe = findWrite(txn, id, Field.In);
        const outMaybe = findWrite(txn, id, Field.Out);
        const inWrite = inMaybe && isEligible(inMaybe, id) ? inMaybe : undefined;
        const outWrite = outMaybe && isEligible(outMaybe, id) ? outMaybe : undefined;
        if (!inWrite && !outWrite) continue;
        if (!inWrite || !outWrite) return null; // partial = resize

        const inDelta = inWrite.to - inWrite.from;
        const outDelta = outWrite.to - outWrite.from;
        if (Math.abs(inDelta - outDelta) > EPSILON) return null; // scaled clip

        if (candidate === null) {
            candidate = inDelta;
        } else if (Math.abs(inDelta - candidate) > EPSILON) {
            return null;
        }
    }

    return candidate;
}

/** True if the txn's writes describe a TRANSLATE OP (vs a resize). A
 *  translate is signaled by: every clip member with writes has BOTH edges
 *  written. Anchors are always atomic, so they don't contribute to this
 *  test. A clip with only ONE edge written → resize → return false.
 *
 *  Member deltas don't need to be uniform — clamps and other restrictions
 *  can leave them mismatched, and that's exactly when finalize's group-
 *  rigidity logic needs to fire (re-uniform to the most restrictive). */
function wasTranslateOp(state: State, ids: EntityId[], txn: Txn): boolean {
    for (const id of ids) {
        const entity = state.entities[id];
        if (!entity) continue;
        if (entity.kind === EntityKind.Anchor) continue;

        const inWrite = findWrite(txn, id, Field.In);
        const outWrite = findWrite(txn, id, Field.Out);
        if (!inWrite && !outWrite) continue; // unaffected — skip
        if (!inWrite || !outWrite) return false; // partial edge = resize
    }
    return true;
}

function makeTranslateWrites(
    state: State,
    ids: EntityId[],
    delta: number,
    seedTag?: string,
): Write[] {
    const writes: Write[] = [];

    for (const id of ids) {
        const entity = state.entities[id];
        if (!entity) continue;

        if (entity.kind === EntityKind.Anchor) {
            writes.push({
                entityId: id,
                field: Field.Time,
                from: entity.time,
                to: entity.time + delta,
                ...(seedTag ? { seedTag } : {}),
            });
        } else {
            writes.push({
                entityId: id,
                field: Field.In,
                from: entity.in,
                to: entity.in + delta,
                ...(seedTag ? { seedTag } : {}),
            });
            writes.push({
                entityId: id,
                field: Field.Out,
                from: entity.out,
                to: entity.out + delta,
                ...(seedTag ? { seedTag } : {}),
            });
        }
    }

    return writes;
}

function mergeWrites(txn: Txn, additions: Write[]): Txn {
    if (additions.length === 0) return txn;
    const merged = [...txn];
    // Local index — the WeakMap-cached findWriteIndex can't track our
    // mid-mutation pushes, so we maintain our own.
    const localIdx = new Map<string, number>();
    for (let i = 0; i < merged.length; i++) {
        localIdx.set(`${merged[i].entityId} ${merged[i].field}`, i);
    }
    for (const addition of additions) {
        const key = `${addition.entityId} ${addition.field}`;
        const existing = localIdx.get(key);
        if (existing !== undefined) {
            merged[existing] = addition;
        } else {
            localIdx.set(key, merged.length);
            merged.push(addition);
        }
    }
    return merged;
}

function upsertWrite(txn: Txn, entityId: EntityId, field: Field, to: number): Txn {
    const existing = findWriteIndex(txn, entityId, field);
    if (existing < 0) return txn;
    return txn.map((write, i) => (i === existing ? { ...write, to } : write));
}

function readField(entity: Entity, field: Field): number | undefined {
    if (entity.kind === EntityKind.Anchor && field === Field.Time) return entity.time;
    if (entity.kind === EntityKind.Clip && field === Field.In) return entity.in;
    if (entity.kind === EntityKind.Clip && field === Field.Out) return entity.out;
    return undefined;
}

function writeField(entity: Entity, field: Field, value: number): void {
    if (entity.kind === EntityKind.Anchor && field === Field.Time) {
        entity.time = value;
        return;
    }
    if (entity.kind === EntityKind.Clip && field === Field.In) {
        entity.in = value;
        return;
    }
    if (entity.kind === EntityKind.Clip && field === Field.Out) {
        entity.out = value;
        return;
    }
}

function clampValue(value: number, min?: number, max?: number): number {
    if (min !== undefined && value < min) return min;
    if (max !== undefined && value > max) return max;
    return value;
}

function clone(state: State): State {
    return {
        entities: mapValues(state.entities, (e) => ({ ...e }) as Entity),
        constraints: state.constraints.map(
            (c) =>
                ({
                    ...c,
                    ...("ids" in c ? { ids: [...c.ids] } : {}),
                }) as Constraint,
        ),
        meta: mapValues(state.meta, (m) => ({ ...m })),
        globals: { ...state.globals },
        // scenes is immutable; share by reference — the whole point of the
        // sidecar is that it never gets copied per-Move.
        scenes: state.scenes,
    };
}
