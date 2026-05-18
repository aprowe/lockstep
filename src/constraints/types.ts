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
  Anchor: 'anchor',
  Clip:   'clip',
} as const
export type EntityKind = typeof EntityKind[keyof typeof EntityKind]

export const Field = {
  Time: 'time',
  In:   'in',
  Out:  'out',
} as const
export type Field = typeof Field[keyof typeof Field]

export const LockMode = {
  Bpm:   'bpm',
  Beats: 'beats',
} as const
export type LockMode = typeof LockMode[keyof typeof LockMode]

export const PairMode = {
  /** to's position += delta_of_from. */
  Translate:  'translate',
  /** to's matching edge tracks from's matching edge value. */
  MirrorEdge: 'mirror_edge',
} as const
export type PairMode = typeof PairMode[keyof typeof PairMode]

export const PreserveMode = {
  /** Stop the moving edge `min` away from the opposite edge. */
  Clamp: 'clamp',
  /** Translate the whole clip to preserve length. */
  Shift: 'shift',
} as const
export type PreserveMode = typeof PreserveMode[keyof typeof PreserveMode]

export const Role = {
  Active:   'active',
  BeatZero: 'beat_zero',
} as const
export type Role = typeof Role[keyof typeof Role]

export const ConstraintKind = {
  TranslateGroup: 'translate_group',
  ScaleGroup:     'scale_group',
  DirectedPair:   'directed_pair',
  Derived:        'derived',
  Clamp:          'clamp',
  PreserveLength: 'preserve_length',
  SnapTarget:     'snap_target',
  SingleOfKind:   'single_of_kind',
  DeleteGroup:    'delete_group',
  HighlightGroup: 'highlight_group',
  MirrorPair:     'mirror_pair',
  SnapCohort:     'snap_cohort',
  SnapRule:       'snap_rule',
} as const
export type ConstraintKind = typeof ConstraintKind[keyof typeof ConstraintKind]

export const Phase = {
  /** Constraints SPAWN writes from a seeded op. */
  Propose:  'propose',
  /** Constraints CLIP/MODIFY writes to satisfy individual limits. */
  Restrict: 'restrict',
  /** Constraints ENFORCE GROUP INVARIANTS after restrictions. */
  Finalize: 'finalize',
  /** Constraints RECOMPUTE non-position quantities. */
  Derive:   'derive',
} as const
export type Phase = typeof Phase[keyof typeof Phase]

export const OpKind = {
  AddAnchor:        'add_anchor',
  AddClip:          'add_clip',
  Move:             'move',
  SetEdge:          'set_edge',
  SetValue:         'set_value',
  Delete:           'delete',
  AddConstraint:    'add_constraint',
  RemoveConstraint: 'remove_constraint',
} as const
export type OpKind = typeof OpKind[keyof typeof OpKind]

// ─── Entities ─────────────────────────────────────────────────────────────

export type EntityId = string

export interface Anchor {
  kind: typeof EntityKind.Anchor
  id:   EntityId
  time: number
}

export interface Clip {
  kind: typeof EntityKind.Clip
  id:   EntityId
  in:   number
  out:  number
}

export type Entity = Anchor | Clip

// ─── Per-entity non-position meta ─────────────────────────────────────────

export interface EntityMeta {
  bpm?:         number
  lockedBeats?: number
}

// ─── State ────────────────────────────────────────────────────────────────

/** Global scalars that live alongside the constraint graph (not per-entity). */
export interface GraphGlobals {
  lockMode: LockMode
}

/** Derived index for O(1) cohort lookup at snap install.
 *  Built on demand by `buildSnapIndex(state)` in the snap recipe. */
export interface SnapIndex {
  /** cohort tag → entity IDs that belong to it */
  idsByCohort:     Map<string, EntityId[]>
  /** entity ID → cohort tags it belongs to */
  cohortsByEntity: Map<EntityId, string[]>
  /** installed SnapRule constraints */
  rules:           SnapRule[]
}

export interface State {
  entities:    Record<EntityId, Entity>
  constraints: Constraint[]
  meta:        Record<EntityId, EntityMeta>
  globals:     GraphGlobals
}

// ─── Operations ───────────────────────────────────────────────────────────

export interface AddAnchorOp {
  kind: typeof OpKind.AddAnchor
  id:   EntityId
  time: number
}

export interface AddClipOp {
  kind: typeof OpKind.AddClip
  id:   EntityId
  in:   number
  out:  number
}

export interface MoveOp {
  kind:  typeof OpKind.Move
  id:    EntityId
  delta: number
}

export interface SetEdgeOp {
  kind:  typeof OpKind.SetEdge
  id:    EntityId
  edge:  'in' | 'out'
  value: number
}

export interface SetValueOp {
  kind:  typeof OpKind.SetValue
  id:    EntityId
  field: 'time' | 'in' | 'out' | 'bpm' | 'lockedBeats'
  value: number
}

export interface DeleteOp {
  kind: typeof OpKind.Delete
  id:   EntityId
}

export interface AddConstraintOp {
  kind:       typeof OpKind.AddConstraint
  constraint: Constraint
}

export interface RemoveConstraintOp {
  kind:      typeof OpKind.RemoveConstraint
  predicate: (constraint: Constraint, index: number) => boolean
}

export type Op =
  | AddAnchorOp
  | AddClipOp
  | MoveOp
  | SetEdgeOp
  | SetValueOp
  | DeleteOp
  | AddConstraintOp
  | RemoveConstraintOp

// ─── Constraints ──────────────────────────────────────────────────────────

/** Translate-coupling. Moving a member propagates the same delta to the
 *  rest of the group.
 *    - `driver` undefined → BIDIRECTIONAL: any member can drive the
 *      group (lasso selection, warp-line pair drag).
 *    - `driver` set        → ONE-WAY: only writes on `driver` propagate;
 *      moves on other members do nothing to the group (anchor-lock pan). */
export interface TranslateGroup {
  kind:    typeof ConstraintKind.TranslateGroup
  ids:     EntityId[]
  driver?: EntityId
  tag?:    string
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
  kind:    typeof ConstraintKind.ScaleGroup
  ids:     EntityId[]
  driver?: EntityId
  tag?:    string
}

/** One-way coupling. Writes on `from` propagate to `to`, never the reverse.
 *  Used for: default-linked clipin → clipout, and edge-mirror behaviors.
 *
 *  `fromEdge` (optional): for MirrorEdge mode, constrains which edge write
 *  triggers the carry. When omitted, the first matching write drives.
 *  Required for body-pan carry so 'in' and 'out' carries each track their
 *  respective edge. */
export interface DirectedPair {
  kind:      typeof ConstraintKind.DirectedPair
  from:      EntityId
  to:        EntityId
  mode:      PairMode
  fromEdge?: 'in' | 'out'
  tag?:      string
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
  kind:    typeof ConstraintKind.Derived
  watches: EntityId[]
  apply:   (state: State) => void
  meta?:   Record<string, unknown>
  tag?:    string
}

/** Range-clamp a single field of a single entity to [min, max]. */
export interface Clamp {
  kind:     typeof ConstraintKind.Clamp
  entityId: EntityId
  field:    Field
  min?:     number
  max?:     number
  tag?:     string
}

/** Minimum length for a clip. `clamp` mode stops the moving edge `min` away
 *  from the opposite edge; `shift` mode translates the whole clip to
 *  preserve length (matches "drag inPoint past outPoint shifts region"). */
export interface PreserveLength {
  kind:   typeof ConstraintKind.PreserveLength
  clipId: EntityId
  min:    number
  mode:   PreserveMode
  tag?:   string
}

/** Snap-on-drag. While `id`.`field` is being written, snap to the nearest
 *  target within `threshold`.
 *
 *  When `grid` is set, the resolver also snaps to grid marks at
 *  `offset + N * interval` within `threshold` of the current value,
 *  alongside entity targets. Whichever (entity or grid mark) is closer wins. */
export interface SnapTarget {
  kind:      typeof ConstraintKind.SnapTarget
  id:        EntityId
  field:     Field
  targets:   { entityId: EntityId; field: Field }[]
  threshold: number
  grid?:     { interval: number; offset: number }
  /** 'edge' (default): when snap fires, write only `field`. For resize.
   *  'body': when snap fires on EITHER edge, apply the same delta to BOTH
   *  `in` and `out` of the dragged clip so the body translates rigidly.
   *  Only meaningful for Clip entities. */
  mode?:     'edge' | 'body'
  tag?:      string
}

/** At most one entity matching `filterKind` plays `role`. Used for: one
 *  active clip at a time, one anchor flagged as beat zero. */
export interface SingleOfKind {
  kind:       typeof ConstraintKind.SingleOfKind
  filterKind: EntityKind
  role:       Role
  activeId:   EntityId | null
}

/** Delete propagation. Deleting any member deletes all members. Used for
 *  paired anchors (deleting anchor-in also deletes anchor-out). */
export interface DeleteGroup {
  kind: typeof ConstraintKind.DeleteGroup
  ids:  EntityId[]
  tag?: string
}

/** Visual coupling (render-time query, no write propagation). */
export interface HighlightGroup {
  kind: typeof ConstraintKind.HighlightGroup
  ids:  EntityId[]
  tag?: string
}

/** Declares membership of a set of entities in a named snap cohort.
 *  Mirrors maintain these from slice state; they are ephemeral (not on disk). */
export interface SnapCohort {
  kind: typeof ConstraintKind.SnapCohort
  tag:  string        // e.g. 'anchor-in', 'clipout', 'twin:region_123'
  ids:  EntityId[]
}

/** Declares a directed snap relationship: anything in `dragger` cohort can
 *  snap to anything in `target` cohort. `'grid'` as target means include
 *  the beat-grid synthetic snap.  `condition` is a key into SNAP_CONDITIONS. */
export interface SnapRule {
  kind:       typeof ConstraintKind.SnapRule
  dragger:    string   // cohort tag or role-qualified tag (e.g. 'clipout:edge')
  target:     string   // cohort tag, or 'grid' (synthetic)
  condition?: string   // key into SNAP_CONDITIONS; absent = unconditional
  tag?:       string
}

/** Symmetric 1-1 binding between two specific (entity, field) endpoints.
 *  When either endpoint's field is written in the txn, write the same value
 *  to the partner endpoint. No driver — symmetric. No re-sync on install:
 *  the binding only fires on writes that are already in flight (delta-based
 *  by way of mergeWrites short-circuiting), so adding a MirrorPair to a
 *  graph where the two endpoints differ is a no-op until something moves.
 *
 *  Use case: a conformed marker. While the input-space coincidence
 *  `clipin.edge ≈ anchor-in.time` holds, anchor-out.time and
 *  clipout.{edge} represent the same point in beat space — moving either
 *  one moves the other. */
export interface MirrorPair {
  kind: typeof ConstraintKind.MirrorPair
  a:    { id: EntityId; field: Field }
  b:    { id: EntityId; field: Field }
  tag?: string
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
  | MirrorPair
  | SnapCohort
  | SnapRule

// ─── Txn (pipeline-internal) ──────────────────────────────────────────────

/** A proposed write to an entity's field. Carries both the pre-op value
 *  (`from`) and the post-op value (`to`) so handlers can derive a delta
 *  without re-reading state. */
export interface Write {
  entityId: EntityId
  field:    Field
  from:     number
  to:       number
}

export type Txn = Write[]
