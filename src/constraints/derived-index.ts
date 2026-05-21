/**
 * Derived lookup indexes over a State's constraint list.
 *
 * Three derived structures are built from `state.constraints`:
 *   - `byKind`        — Map<Kind, Constraint[]>: constraints bucketed by kind
 *   - `entityEdges`   — Map<EntityId, Constraint[]>: every constraint that
 *                       mentions the given entity (any role).
 *   - `snapIndex`     — cached output of `buildSnapIndex(state)`, populated
 *                       lazily on first request.
 *
 * Caches are keyed on the `state.constraints` array REFERENCE via a WeakMap.
 * Because `reduce()` and `pipeline.buildGraphFromSlice()` produce a new
 * constraint array whenever the set changes, a fresh constraint set
 * automatically gets a fresh index — no manual invalidation needed. Pipeline
 * passes that mutate only `entities`/`meta` (the resolver phases) reuse the
 * cached structures for free.
 *
 * Each index is built in a single linear scan and only constructed on first
 * read; callers that never need an index pay nothing.
 */

import type { Constraint, EntityId, SnapIndex, State } from "./types";
import { ConstraintKind } from "./types";
import { buildSnapIndex as buildSnapIndexFresh } from "./snap-index";
import { pushToBucket } from "./multimap";

interface IndexBundle {
    byKind: Map<ConstraintKind, Constraint[]>;
    entityEdges: Map<EntityId, Constraint[]>;
    snapIndex?: SnapIndex;
}

const BUNDLE_CACHE = new WeakMap<readonly Constraint[], IndexBundle>();
const EMPTY: readonly Constraint[] = Object.freeze([]);

function getBundle(state: State): IndexBundle {
    let bundle = BUNDLE_CACHE.get(state.constraints);
    if (bundle) return bundle;
    bundle = buildBundle(state.constraints);
    BUNDLE_CACHE.set(state.constraints, bundle);
    return bundle;
}

function buildBundle(constraints: readonly Constraint[]): IndexBundle {
    const byKind = new Map<ConstraintKind, Constraint[]>();
    const entityEdges = new Map<EntityId, Constraint[]>();

    for (const c of constraints) {
        pushToBucket(byKind, c.kind, c);
        for (const id of constraintEntities(c)) {
            pushToBucket(entityEdges, id, c);
        }
    }

    return { byKind, entityEdges };
}

/** All entity ids referenced by `c` (any role). Used both for the reverse
 *  entity-edge index here and for delete-cascade filtering in the resolver
 *  — the resolver special-cases `SnapCohort` (a cohort isn't deleted just
 *  because one of its members is), but the entity set itself is the same. */
export function constraintEntities(c: Constraint): EntityId[] {
    switch (c.kind) {
        case ConstraintKind.TranslateGroup:
        case ConstraintKind.ScaleGroup:
        case ConstraintKind.DeleteGroup:
        case ConstraintKind.HighlightGroup:
        case ConstraintKind.SnapCohort:
            return c.ids;
        case ConstraintKind.DirectedPair:
            return [c.from, c.to];
        case ConstraintKind.Derived:
            return c.watches;
        case ConstraintKind.Clamp:
            return [c.entityId];
        case ConstraintKind.PreserveLength:
            return [c.clipId];
        case ConstraintKind.SnapTarget:
            return [c.id, ...c.targets.map((t) => t.entityId)];
        case ConstraintKind.SingleOfKind:
            return c.activeId ? [c.activeId] : [];
        case ConstraintKind.ConformRule: {
            // Distinct endpoints across every tuple — closure-scoped
            // iteration only needs to know which entities mention this
            // rule, not how many tuples each appears in. Deduping here
            // keeps the reverse entity index from holding O(tuples)
            // duplicate references to the rule.
            const seen = new Set<EntityId>();
            for (const t of c.tuples) {
                seen.add(t.anchorInId);
                seen.add(t.anchorOutId);
                seen.add(t.clipId);
                seen.add(t.clipOutId);
            }
            return [...seen];
        }
        case ConstraintKind.SnapRule:
            return [];
    }
}

/** Constraints of a single kind, in original insertion order.
 *  Returned array is shared — DO NOT mutate. */
export function constraintsByKind(state: State, kind: ConstraintKind): readonly Constraint[] {
    return getBundle(state).byKind.get(kind) ?? EMPTY;
}

/** Constraints that mention `id` in any role. Order is insertion order.
 *  Returned array is shared — DO NOT mutate. */
export function constraintsTouchingEntity(state: State, id: EntityId): readonly Constraint[] {
    return getBundle(state).entityEdges.get(id) ?? EMPTY;
}

/** Cached SnapIndex for `state`. Built on first call, reused as long as
 *  `state.constraints` (the array reference) stays stable. */
export function snapIndexFor(state: State): SnapIndex {
    const bundle = getBundle(state);
    if (!bundle.snapIndex) {
        bundle.snapIndex = buildSnapIndexFresh(state);
    }
    return bundle.snapIndex;
}

/** Constraint kinds that must always be considered "active" regardless of
 *  the seed closure, because their fire conditions involve writes to
 *  entities that may only join the closure transitively through other
 *  constraints' writes — they're cheap to keep on (a handful of instances
 *  in any project) and skipping them risks missing cascades like:
 *  anchor → ConformVisual writes clipout → anchor-lock TranslateGroup
 *  rescales inner anchors. */
const ALWAYS_ACTIVE_KINDS: ReadonlySet<ConstraintKind> = new Set([
    ConstraintKind.TranslateGroup,
    ConstraintKind.ScaleGroup,
    ConstraintKind.Derived,
]);

/**
 * The set of constraints that could possibly produce or consume writes
 * during a pipeline run seeded at the given closure.
 *
 * Definition:
 *   active(closure) = {c | c touches any entity in closure}
 *                   ∪ {c | c.kind ∈ ALWAYS_ACTIVE_KINDS}
 *
 * The first half catches all constraints whose fire conditions could be
 * affected by writes to closure entities. The second half catches kinds
 * that propagate writes that other constraints might re-emit into entities
 * outside the closure (a single anchor drag's `ConformVisual` write to
 * `clipOutId` activating the anchor-lock TranslateGroup, for example).
 *
 * Returns the full constraint array unchanged when the subset would be
 * too large to be worth filtering (e.g. group-pan with everything
 * selected). The subset itself preserves original insertion order so
 * handler dispatch semantics match the legacy whole-list scan.
 */
export function activeConstraintsFor(
    state: State,
    closure: ReadonlySet<EntityId>,
): readonly Constraint[] {
    const bundle = getBundle(state);
    if (closure.size === 0) return EMPTY;

    const seen = new Set<Constraint>();
    for (const id of closure) {
        const edges = bundle.entityEdges.get(id);
        if (!edges) continue;
        for (const c of edges) seen.add(c);
    }
    for (const kind of ALWAYS_ACTIVE_KINDS) {
        const bucket = bundle.byKind.get(kind);
        if (!bucket) continue;
        for (const c of bucket) seen.add(c);
    }

    // If we ended up with most of the graph, fall back to the full array —
    // building the subset costs O(|constraints|) and isn't a win once we're
    // past half.
    if (seen.size * 2 >= state.constraints.length) return state.constraints;

    const out: Constraint[] = [];
    for (const c of state.constraints) {
        if (seen.has(c)) out.push(c);
    }
    return out;
}
