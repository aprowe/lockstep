/**
 * Constraint-based timeline model — types only.
 *
 * Vocabulary:
 *   Entity     — a single addressable thing (anchor, clip).
 *   Operation  — a typed user/system intent (move, set_edge, add_constraint…).
 *   Constraint — a typed coupling/restriction/derivation written to state.
 *   Txn        — a pipeline-internal list of proposed field writes.
 *   State      — entities × constraints × per-entity meta scalars.
 *
 * Nothing in this file knows how to USE these types — the resolver handles
 * propagation, recipes compose ops, and the lambda escape hatch (Derived) is
 * the only place where code lives inside a constraint.
 */

// ─── Named string constants (used like enums) ─────────────────────────────
//
// We use `as const` objects rather than `enum` keyword so the resulting types
// are plain string-literal unions — friendly to JSON, easy to discriminate.

export const EntityKind = {
    Anchor: "anchor",
    Clip: "clip",
} as const;
export type EntityKind = (typeof EntityKind)[keyof typeof EntityKind];

export const Field = {
    Time: "time",
    In: "in",
    Out: "out",
} as const;
export type Field = (typeof Field)[keyof typeof Field];

export const LockMode = {
    Bpm: "bpm",
    Beats: "beats",
} as const;
export type LockMode = (typeof LockMode)[keyof typeof LockMode];

export const PairMode = {
    /** to's position += delta_of_from. */
    Translate: "translate",
    /** to's matching edge tracks from's matching edge value. */
    MirrorEdge: "mirror_edge",
} as const;
export type PairMode = (typeof PairMode)[keyof typeof PairMode];

export const PreserveMode = {
    /** Stop the moving edge `min` away from the opposite edge. */
    Clamp: "clamp",
    /** Translate the whole clip to preserve length. */
    Shift: "shift",
} as const;
export type PreserveMode = (typeof PreserveMode)[keyof typeof PreserveMode];

export const Role = {
    Active: "active",
    BeatZero: "beat_zero",
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const ConstraintKind = {
    TranslateGroup: "translate_group",
    ScaleGroup: "scale_group",
    DirectedPair: "directed_pair",
    Derived: "derived",
    Clamp: "clamp",
    PreserveLength: "preserve_length",
    SnapTarget: "snap_target",
    SingleOfKind: "single_of_kind",
    DeleteGroup: "delete_group",
    HighlightGroup: "highlight_group",
    ConformRule: "conform_rule",
    SnapCohort: "snap_cohort",
    SnapRule: "snap_rule",
} as const;
export type ConstraintKind = (typeof ConstraintKind)[keyof typeof ConstraintKind];

/** Discriminator for ConformRule. */
export const ConformMode = {
    /** Anchor-coincidence → clipout assertion (formerly `conform_visual`). */
    Visual: "visual",
    /** User clipout write → anchor.beat rewrite (formerly `conform_redirect`). */
    Redirect: "redirect",
} as const;
export type ConformMode = (typeof ConformMode)[keyof typeof ConformMode];

export const Phase = {
    /** Constraints SPAWN writes from a seeded op. */
    Propose: "propose",
    /** Constraints CLIP/MODIFY writes to satisfy individual limits. */
    Restrict: "restrict",
    /** Constraints ENFORCE GROUP INVARIANTS after restrictions. */
    Finalize: "finalize",
    /** Constraints RECOMPUTE non-position quantities. */
    Derive: "derive",
} as const;
export type Phase = (typeof Phase)[keyof typeof Phase];

export const OpKind = {
    AddAnchor: "add_anchor",
    AddClip: "add_clip",
    Move: "move",
    SetEdge: "set_edge",
    SetValue: "set_value",
    Delete: "delete",
    AddConstraint: "add_constraint",
    RemoveConstraint: "remove_constraint",
} as const;
export type OpKind = (typeof OpKind)[keyof typeof OpKind];

// ─── Entities ─────────────────────────────────────────────────────────────

export type EntityId = string;

export interface Anchor {
    kind: typeof EntityKind.Anchor;
    id: EntityId;
    time: number;
}

export interface Clip {
    kind: typeof EntityKind.Clip;
    id: EntityId;
    in: number;
    out: number;
}

export type Entity = Anchor | Clip;

// ─── Per-entity non-position meta ─────────────────────────────────────────

export interface EntityMeta {
    bpm?: number;
    lockedBeats?: number;
}

// ─── State ────────────────────────────────────────────────────────────────

/** Global scalars that live alongside the constraint graph (not per-entity). */
export interface GraphGlobals {
    lockMode: LockMode;
}

/** Derived index for O(1) cohort lookup at snap install.
 *  Built on demand by `buildSnapIndex(state)` in the snap recipe. */
export interface SnapIndex {
    /** cohort tag → entity IDs that belong to it */
    idsByCohort: Map<string, EntityId[]>;
    /** entity ID → cohort tags it belongs to */
    cohortsByEntity: Map<EntityId, string[]>;
    /** installed SnapRule constraints */
    rules: SnapRule[];
}

export interface State {
    entities: Record<EntityId, Entity>;
    constraints: Constraint[];
    meta: Record<EntityId, EntityMeta>;
    globals: GraphGlobals;
    /** Sorted, read-only proximity targets that never move and don't
     *  participate in any constraint. Currently used for scene markers —
     *  kept out of `entities` so the per-Move state clone doesn't scale
     *  with scene count, and consulted directly by `evaluateSnap` via a
     *  binary search instead of materialized as `SnapCohort` entities. */
    scenes?: Float64Array;
}

// ─── Operations ───────────────────────────────────────────────────────────

export interface AddAnchorOp {
    kind: typeof OpKind.AddAnchor;
    id: EntityId;
    time: number;
}

export interface AddClipOp {
    kind: typeof OpKind.AddClip;
    id: EntityId;
    in: number;
    out: number;
}

export interface MoveOp {
    kind: typeof OpKind.Move;
    id: EntityId;
    delta: number;
}

export interface SetEdgeOp {
    kind: typeof OpKind.SetEdge;
    id: EntityId;
    edge: "in" | "out";
    value: number;
}

export interface SetValueOp {
    kind: typeof OpKind.SetValue;
    id: EntityId;
    field: "time" | "in" | "out" | "bpm" | "lockedBeats";
    value: number;
}

export interface DeleteOp {
    kind: typeof OpKind.Delete;
    id: EntityId;
}

export interface AddConstraintOp {
    kind: typeof OpKind.AddConstraint;
    constraint: Constraint;
}

export interface RemoveConstraintOp {
    kind: typeof OpKind.RemoveConstraint;
    predicate: (constraint: Constraint, index: number) => boolean;
}

export type Op =
    | AddAnchorOp
    | AddClipOp
    | MoveOp
    | SetEdgeOp
    | SetValueOp
    | DeleteOp
    | AddConstraintOp
    | RemoveConstraintOp;

// ─── Constraints ──────────────────────────────────────────────────────────

/** Translate-coupling. Moving a member propagates the same delta to the
 *  rest of the group.
 *    - `driver` undefined → BIDIRECTIONAL: any member can drive the
 *      group (lasso selection, warp-line pair drag).
 *    - `driver` set        → ONE-WAY: only writes on `driver` propagate;
 *      moves on other members do nothing to the group (anchor-lock pan). */
export interface TranslateGroup {
    kind: typeof ConstraintKind.TranslateGroup;
    ids: EntityId[];
    driver?: EntityId;
    tag?: string;
}

/** Resize-coupling. A clip-edge resize rescales the rest of the group
 *  around the driver's UNTOUCHED edge (drag in → out is pivot; drag out
 *  → in is pivot). No stored pivot — derived from the txn at resolve
 *  time.
 *    - `driver` undefined → any clip member with a single-edge write
 *      becomes the driver.
 *    - `driver` set        → only resizes on `driver` rescale the rest
 *      (anchor-lock resize). */
export interface ScaleGroup {
    kind: typeof ConstraintKind.ScaleGroup;
    ids: EntityId[];
    driver?: EntityId;
    tag?: string;
}

/** One-way coupling. Writes on `from` propagate to `to`, never the reverse.
 *  Used for: default-linked clipin → clipout, and edge-mirror behaviors.
 *
 *  `fromEdge` (optional): for MirrorEdge mode, constrains which edge write
 *  triggers propagation. When omitted, the first matching write drives.
 *  Required for body-pan so 'in' and 'out' edges each track their
 *  respective write. */
export interface DirectedPair {
    kind: typeof ConstraintKind.DirectedPair;
    from: EntityId;
    to: EntityId;
    mode: PairMode;
    fromEdge?: "in" | "out";
    tag?: string;
}

/** Derived (lambda) constraint — the ONLY constraint that carries code.
 *  Used for math too specific for generic translate/scale rules, primarily
 *  the BPM × lockedBeats × length tradeoff. Resolver re-runs `apply` when
 *  any of `watches` is touched. `apply` mutates state directly.
 *
 *  `meta` is a structured introspection bag — lets recipes / queries ask
 *  "what does this derived enforce?" without parsing the lambda source.
 *  Convention: bpm-derived sets `meta: { kind: 'bpm', fixed }`. */
export interface Derived {
    kind: typeof ConstraintKind.Derived;
    watches: EntityId[];
    apply: (state: State) => void;
    meta?: Record<string, unknown>;
    tag?: string;
}

/** Range-clamp a single field of a single entity to [min, max]. */
export interface Clamp {
    kind: typeof ConstraintKind.Clamp;
    entityId: EntityId;
    field: Field;
    min?: number;
    max?: number;
    tag?: string;
}

/** Minimum length for a clip. `clamp` mode stops the moving edge `min` away
 *  from the opposite edge; `shift` mode translates the whole clip to
 *  preserve length (matches "drag inPoint past outPoint shifts region"). */
export interface PreserveLength {
    kind: typeof ConstraintKind.PreserveLength;
    clipId: EntityId;
    min: number;
    mode: PreserveMode;
    tag?: string;
}

/** Snap-on-drag. While `id`.`field` is being written, snap to the nearest
 *  target within `threshold`.
 *
 *  When `grid` is set, the resolver also snaps to grid marks at
 *  `offset + N * interval` within `threshold` of the current value,
 *  alongside entity targets. Whichever (entity or grid mark) is closer wins. */
export interface SnapTarget {
    kind: typeof ConstraintKind.SnapTarget;
    id: EntityId;
    field: Field;
    targets: { entityId: EntityId; field: Field }[];
    threshold: number;
    grid?: { interval: number; offset: number };
    /** 'edge' (default): when snap fires, write only `field`. For resize.
     *  'body': when snap fires on EITHER edge, apply the same delta to BOTH
     *  `in` and `out` of the dragged clip so the body translates rigidly.
     *  Only meaningful for Clip entities. */
    mode?: "edge" | "body";
    /** Pre-sorted scene-marker times. Resolved by `snapToSiblings` when
     *  the SNAP_RULES table targets the synthetic `scenes` cohort. Held
     *  by reference to `state.scenes`, so `evaluateSnap` can binary-
     *  search it directly without a per-Move sort and without an entity
     *  lookup per candidate. */
    sceneTimes?: Float64Array;
    tag?: string;
}

/** At most one entity matching `filterKind` plays `role`. Used for: one
 *  active clip at a time, one anchor flagged as beat zero. */
export interface SingleOfKind {
    kind: typeof ConstraintKind.SingleOfKind;
    filterKind: EntityKind;
    role: Role;
    activeId: EntityId | null;
}

/** Delete propagation. Deleting any member deletes all members. Used for
 *  paired anchors (deleting anchor-in also deletes anchor-out). */
export interface DeleteGroup {
    kind: typeof ConstraintKind.DeleteGroup;
    ids: EntityId[];
    tag?: string;
}

/** Visual coupling (render-time query, no write propagation). */
export interface HighlightGroup {
    kind: typeof ConstraintKind.HighlightGroup;
    ids: EntityId[];
    tag?: string;
}

/** Declares membership of a set of entities in a named snap cohort.
 *  Mirrors maintain these from slice state; they are ephemeral (not on disk). */
export interface SnapCohort {
    kind: typeof ConstraintKind.SnapCohort;
    tag: string; // e.g. 'anchor-in', 'clipout', 'twin:region_123'
    ids: EntityId[];
}

/** Declares a directed snap relationship: anything in `dragger` cohort can
 *  snap to anything in `target` cohort. `'grid'` as target means include
 *  the beat-grid synthetic snap.  `condition` is a key into SNAP_CONDITIONS. */
export interface SnapRule {
    kind: typeof ConstraintKind.SnapRule;
    dragger: string; // cohort tag or role-qualified tag (e.g. 'clipout:edge')
    target: string; // cohort tag, or 'grid' (synthetic)
    condition?: string; // key into SNAP_CONDITIONS; absent = unconditional
    tag?: string;
}

/** A single (region, anchor, edge) binding inside a `ConformRule`. The rule
 *  iterates these tuples in a tight loop instead of materializing one
 *  constraint per binding, so the resolver pays one handler dispatch per
 *  Propose iter regardless of project size. */
export interface ConformTuple {
    anchorInId: EntityId;
    anchorOutId: EntityId;
    clipId: EntityId;
    clipOutId: EntityId;
    edge: "in" | "out";
}

/** Batched conform binding rule. Two variants share this shape via the
 *  `mode` discriminator:
 *
 *  - `visual`: when a tuple's clipin-edge value (txn-aware) coincides with
 *    its anchor-in.time, write `anchor-out.time` to the matching clipout
 *    edge. Purely transient and one-way (anchor → clip): the handler
 *    re-checks coincidence every pipeline pass, so it engages while the
 *    user is on the conform position and disengages when they move past —
 *    without ever writing back to the anchor side (symmetric coupling
 *    would let raw cursor values leak through the default-link cascade
 *    into the anchor).
 *
 *  - `redirect`: when a user gesture has written a tuple's clipout.edge
 *    directly (no seedTag = user intent, not a cascade), and the input-
 *    space coincidence `clipin.edge ≈ anchor.orig` still holds, the write
 *    is rewritten as an anchor.beat write with the same delta. On the next
 *    pass, the visual handler writes clipout = anchor.beat, asserting the
 *    invariant. Skipped when the clipout write is tagged (it's a cascade,
 *    not user intent), or when anchor.beat already has a write.
 *
 *  Insertion order requirements survive intact: install one `mode:
 *  "redirect"` rule before one `mode: "visual"` rule and the per-iter
 *  ordering invariant (redirect first, then visual) is preserved.
 *
 *  See: docs/superpowers/specs/2026-05-20-conform-invariant-restructure-design.md */
export interface ConformRule {
    kind: typeof ConstraintKind.ConformRule;
    mode: ConformMode;
    tuples: readonly ConformTuple[];
    /** Derived index built alongside `tuples`: entity ID → tuple indices
     *  that reference it. Lets the handler iterate only the tuples that
     *  could possibly fire given the current txn (those whose endpoints
     *  have writes), reducing the per-call cost from O(tuples) to
     *  O(touched · avgFanOut). When two rules (redirect + visual) share
     *  the same tuple table they share this Map by reference. Optional —
     *  rules constructed without an index get a lazy fallback inside the
     *  handler. */
    byEntity?: ReadonlyMap<EntityId, readonly number[]>;
    tag?: string;
}

export type Constraint =
    | TranslateGroup
    | ScaleGroup
    | DirectedPair
    | Derived
    | Clamp
    | PreserveLength
    | SnapTarget
    | SingleOfKind
    | DeleteGroup
    | HighlightGroup
    | ConformRule
    | SnapCohort
    | SnapRule;

// ─── Txn (pipeline-internal) ──────────────────────────────────────────────

/** A proposed write to an entity's field. Carries both the pre-op value
 *  (`from`) and the post-op value (`to`) so handlers can derive a delta
 *  without re-reading state. */
export interface Write {
    entityId: EntityId;
    field: Field;
    from: number;
    to: number;
    /** Provenance marker for writes produced by cascade rules. Seed writes
     *  (originating from a user gesture's op) have no tag. Cascade-rule
     *  writes (e.g., default-link MirrorEdge) stamp themselves so downstream
     *  rules — notably ConformRedirect — can distinguish user intent from
     *  derived propagation.
     *  See: docs/superpowers/specs/2026-05-20-conform-invariant-restructure-design.md */
    seedTag?: string;
}

export type Txn = Write[];
