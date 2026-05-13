/**
 * Timeline relationships sandbox — exhaustive constraint catalog.
 *
 * Every cross-entity behavior in the timeline expressed as a typed constraint
 * in `state.constraints`. The resolver is generic: walks the list, dispatches
 * by `kind`. Recipes (at the bottom) map user-level gestures to constraint
 * mutations.
 *
 * Reading order: entities → ops → CONSTRAINT KINDS → resolver → recipes → demo.
 */

// ─── Entities ─────────────────────────────────────────────────────────────

export type EntityId = string

export interface Anchor { kind: 'anchor'; id: EntityId; time: number }
export interface Clip   { kind: 'clip';   id: EntityId; in: number; out: number }
export type Entity = Anchor | Clip

// ─── Operations (data only) ───────────────────────────────────────────────

export type Op =
  | { kind: 'add_anchor';        id: EntityId; time: number }
  | { kind: 'add_clip';          id: EntityId; in: number; out: number }
  | { kind: 'move';              id: EntityId; delta: number }
  | { kind: 'set_edge';          id: EntityId; edge: 'in' | 'out'; value: number }
  | { kind: 'set_value';         id: EntityId; field: 'time' | 'in' | 'out' | 'bpm' | 'lockedBeats'; value: number }
  | { kind: 'delete';            id: EntityId }
  | { kind: 'add_constraint';    c: Constraint }
  | { kind: 'remove_constraint'; predicate: (c: Constraint, i: number) => boolean }

// ─── CONSTRAINT CATALOG ───────────────────────────────────────────────────
//
// Every kind of coupling the timeline can express, as pure data. A `tag`
// field (optional everywhere) lets recipes identify constraints they own
// for later removal — without it, removing "the anchor-lock constraints"
// would be a structural search.

/** Movement coupling: moving any member by delta translates all members.
 *  Bidirectional. Used for: selection groups (lasso), warp-line pair drags,
 *  anchor-lock translate behavior. */
export interface TranslateGroup { kind: 'translate_group'; ids: EntityId[]; tag?: string }

/** Resize coupling: resizing any clip member (`set_edge`) rescales every
 *  other member's positions proportionally around `pivot`. Used for:
 *  anchor-lock resize behavior (lock=beats). */
export interface ScaleGroup { kind: 'scale_group'; ids: EntityId[]; pivot: number; tag?: string }

/** One-way coupling: writes to `from` propagate to `to`, never the reverse.
 *  Used for: default-linked clipin → clipout (clipin moves drag clipout
 *  along; clipout moves do NOT drag clipin). `mode` chooses propagation
 *  semantics. */
export interface DirectedPair {
  kind: 'directed_pair'
  from: EntityId
  to: EntityId
  /** 'translate' — to.position = to.position + delta_of_from.
   *  'mirror_edge' — to's matching edge tracks from's matching edge (used for
   *    conformed clip-edge ↔ anchor: when the clip edge moves to X, the
   *    anchor also moves to X). */
  mode: 'translate' | 'mirror_edge'
  tag?: string
}

/** Derived (lambda) constraint — the ONLY constraint kind that carries
 *  code. Used for relationships whose math is too specific to model as
 *  generic translate/scale/clamp — chiefly the BPM × lockedBeats × length
 *  tradeoff. Resolver re-runs `apply` whenever any of `watches` is
 *  touched. `apply` mutates state directly (write-through) or returns
 *  void if no change needed. */
export interface Derived {
  kind: 'derived'
  /** Triggers: ids whose `move`, `set_edge`, or `set_value` re-runs apply. */
  watches: EntityId[]
  /** Re-compute and write. Should be idempotent and pure (no I/O). */
  apply: (state: State) => void
  tag?: string
}

/** Bounded value: clamps a field of an entity into [min, max] on every write.
 *  Used for: regions can't extend past output bounds, anchors can't be
 *  negative, region min-length (paired with a partner edge — see
 *  `preserve_length`). */
export interface Clamp {
  kind: 'clamp'
  entityId: EntityId
  field: 'time' | 'in' | 'out'
  min?: number
  max?: number
  tag?: string
}

/** Minimum length: if `set_edge` would make the clip's span < `min`,
 *  the moving edge stops `min` away from the opposite edge OR the whole
 *  clip translates to preserve length (mode: 'clamp' vs 'shift'). The
 *  controller's existing "drag inPoint past outPoint shifts region"
 *  behavior is the 'shift' mode. */
export interface PreserveLength {
  kind: 'preserve_length'
  clipId: EntityId
  min: number
  mode: 'clamp' | 'shift'
  tag?: string
}

/** Snap-on-drag: while an entity is being moved/resized, snap its primary
 *  position to the nearest target within `threshold`. Targets are entity
 *  ids whose positions are read at snap time. Resolver only fires for
 *  ops on `id`. */
export interface SnapTarget {
  kind: 'snap_target'
  id: EntityId
  field: 'time' | 'in' | 'out'
  targets: { entityId: EntityId; field: 'time' | 'in' | 'out' }[]
  threshold: number
  tag?: string
}

/** Cardinality: at most one entity matching `filterKind` is "active." When a
 *  new entity is made active, the previous one becomes inactive. Stored as
 *  data because the active id can be undone/redone with state. */
export interface SingleOfKind {
  kind: 'single_of_kind'
  /** Which entity kind this constraint governs (e.g. 'clip', 'anchor'). */
  filterKind: 'clip' | 'anchor'
  /** Role tag — 'active' is the obvious one, but 'beat_zero' would apply
   *  to anchors (only one anchor can be beat zero). */
  role: 'active' | 'beat_zero'
  activeId: EntityId | null
}

/** Delete propagation: deleting any member deletes all members. Used for:
 *  paired anchor (deleting an anchor-in also deletes its paired anchor-out
 *  — they're one logical entity). */
export interface DeleteGroup { kind: 'delete_group'; ids: EntityId[]; tag?: string }

/** Visual coupling: members are rendered as visually related (highlight
 *  outline, color band). Resolver doesn't propagate writes — render-time
 *  query only. Used for: hover groups, multi-select highlight. */
export interface HighlightGroup { kind: 'highlight_group'; ids: EntityId[]; tag?: string }

/** Conform (derived render rule, NOT a write-propagating constraint).
 *  Says: "while anchor.time == clip.{in|out}, the paired anchor's time
 *  visually defines clip.{in_beat|out_beat}." The resolver records this
 *  for the renderer; no entity writes propagate. Carry behavior (anchor
 *  follows clip edge on commit) is a SEPARATE `directed_pair` added by
 *  the carry recipe at drag start, not this constraint. */
export interface ConformVisual {
  kind: 'conform_visual'
  anchorInId: EntityId
  anchorOutId: EntityId
  clipId: EntityId
  edge: 'in' | 'out'
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
  | ConformVisual

// ─── State ────────────────────────────────────────────────────────────────

export interface State {
  entities: Record<EntityId, Entity>
  constraints: Constraint[]
  /** Extra non-position scalars per clip (bpm, lockedBeats, lock-mode pointer).
   *  Anchors don't have any. Kept separate from `entities` to keep the
   *  entity types simple — could be folded in if preferred. */
  meta: Record<EntityId, { bpm?: number; lockedBeats?: number }>
}

const emptyState = (): State => ({ entities: {}, constraints: [], meta: {} })

// ─── Resolver ─────────────────────────────────────────────────────────────

export function reduce(state: State, op: Op): State {
  const s = clone(state)
  switch (op.kind) {
    case 'add_anchor':        s.entities[op.id] = { kind: 'anchor', id: op.id, time: op.time }; return s
    case 'add_clip':          s.entities[op.id] = { kind: 'clip',   id: op.id, in: op.in, out: op.out }; return s
    case 'add_constraint':    s.constraints = [...s.constraints, op.c]; afterConstraintAdded(s, op.c); return s
    case 'remove_constraint': s.constraints = s.constraints.filter((c, i) => !op.predicate(c, i)); return s
    case 'delete':            return propagateDelete(s, op.id)
    case 'move':              return propagateTranslate(s, op.id, op.delta, new Set([op.id]))
    case 'set_edge':          return propagateResize(s, op.id, op.edge, op.value, new Set([op.id]))
    case 'set_value':         return propagateSetValue(s, op.id, op.field, op.value)
  }
}

function propagateTranslate(s: State, id: EntityId, delta: number, visited: Set<EntityId>): State {
  translateEntity(s, id, delta)
  for (const c of s.constraints) {
    const neighbors = getTranslateNeighbors(c, id)
    for (const other of neighbors) {
      if (visited.has(other)) continue
      visited.add(other)
      propagateTranslate(s, other, delta, visited)
    }
  }
  applyClamps(s, id)
  return s
}

function propagateResize(s: State, id: EntityId, edge: 'in' | 'out', value: number, visited: Set<EntityId>): State {
  const clip = s.entities[id]
  if (!clip || clip.kind !== 'clip') return s
  const oldIn = clip.in, oldOut = clip.out

  // Apply snap-on-drag for the moving edge.
  value = applySnap(s, id, edge, value)

  // Apply preserve_length (clamp or shift) before scaling.
  let newIn  = edge === 'in'  ? value : oldIn
  let newOut = edge === 'out' ? value : oldOut
  for (const c of s.constraints) {
    if (c.kind !== 'preserve_length' || c.clipId !== id) continue
    const len = newOut - newIn
    if (len < c.min) {
      if (c.mode === 'shift') {
        const oldLen = oldOut - oldIn
        if (edge === 'in')  { newIn = value;             newOut = value + oldLen }
        else                { newOut = value;            newIn  = value - oldLen }
      } else {
        if (edge === 'in')  newIn  = newOut - c.min
        else                newOut = newIn  + c.min
      }
    }
  }
  ;(s.entities[id] as Clip).in  = newIn
  ;(s.entities[id] as Clip).out = newOut

  // Propagate scale_group constraints (this clip is the driver).
  for (const c of s.constraints) {
    if (c.kind !== 'scale_group' || !c.ids.includes(id)) continue
    const oldLen = oldOut - oldIn
    const newLen = newOut - newIn
    if (Math.abs(oldLen) < 1e-9 || Math.abs(newLen) < 1e-9) continue
    const scale = newLen / oldLen
    for (const otherId of c.ids) {
      if (otherId === id || visited.has(otherId)) continue
      visited.add(otherId)
      scaleEntityAround(s, otherId, c.pivot, scale)
    }
  }

  // Propagate directed_pair (mirror_edge mode): the to-entity's matching
  // field tracks the from-entity's edge.
  for (const c of s.constraints) {
    if (c.kind !== 'directed_pair' || c.mode !== 'mirror_edge' || c.from !== id) continue
    const e = s.entities[c.to]
    if (!e) continue
    if (e.kind === 'anchor') e.time = edge === 'in' ? newIn : newOut
    else if (e.kind === 'clip') {
      if (edge === 'in')  e.in  = newIn
      else                e.out = newOut
    }
  }

  // Recompute derived quantities.
  applyDerivedQuantities(s, id)
  applyClamps(s, id)
  return s
}

function propagateSetValue(s: State, id: EntityId, field: 'time' | 'in' | 'out' | 'bpm' | 'lockedBeats', value: number): State {
  const e = s.entities[id]
  if (field === 'bpm' || field === 'lockedBeats') {
    s.meta[id] = { ...(s.meta[id] ?? {}), [field]: value }
    applyDerivedQuantities(s, id)
    return s
  }
  if (!e) return s
  if (e.kind === 'anchor' && field === 'time') { e.time = value; applyClamps(s, id); return s }
  if (e.kind === 'clip' && (field === 'in' || field === 'out')) {
    if (field === 'in')  e.in  = value
    else                 e.out = value
    applyClamps(s, id)
  }
  return s
}

function propagateDelete(s: State, id: EntityId): State {
  const toDelete = new Set([id])
  let changed = true
  while (changed) {
    changed = false
    for (const c of s.constraints) {
      if (c.kind !== 'delete_group') continue
      if (c.ids.some(x => toDelete.has(x))) {
        for (const x of c.ids) if (!toDelete.has(x)) { toDelete.add(x); changed = true }
      }
    }
  }
  for (const x of toDelete) { delete s.entities[x]; delete s.meta[x] }
  s.constraints = s.constraints.filter(c => constraintEntities(c).every(x => !toDelete.has(x)))
  return s
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function getTranslateNeighbors(c: Constraint, id: EntityId): EntityId[] {
  if (c.kind === 'translate_group' && c.ids.includes(id)) return c.ids.filter(x => x !== id)
  if (c.kind === 'directed_pair' && c.mode === 'translate' && c.from === id) return [c.to]
  return []
}

function constraintEntities(c: Constraint): EntityId[] {
  switch (c.kind) {
    case 'translate_group':
    case 'scale_group':
    case 'delete_group':
    case 'highlight_group':
      return c.ids
    case 'directed_pair':
      return [c.from, c.to]
    case 'derived':
      return c.watches
    case 'clamp':
      return [c.entityId]
    case 'preserve_length':
      return [c.clipId]
    case 'snap_target':
      return [c.id, ...c.targets.map(t => t.entityId)]
    case 'single_of_kind':
      return c.activeId ? [c.activeId] : []
    case 'conform_visual':
      return [c.anchorInId, c.anchorOutId, c.clipId]
  }
}

function applyClamps(s: State, id: EntityId) {
  const e = s.entities[id]
  if (!e) return
  for (const c of s.constraints) {
    if (c.kind !== 'clamp' || c.entityId !== id) continue
    const v = readField(e, c.field)
    if (v === undefined) continue
    const clamped = clampValue(v, c.min, c.max)
    writeField(e, c.field, clamped)
  }
}

function applyDerivedQuantities(s: State, id: EntityId) {
  for (const c of s.constraints) {
    if (c.kind !== 'derived' || !c.watches.includes(id)) continue
    c.apply(s)
  }
}

function applySnap(s: State, id: EntityId, field: 'in' | 'out', value: number): number {
  for (const c of s.constraints) {
    if (c.kind !== 'snap_target' || c.id !== id || c.field !== field) continue
    let best: { dist: number; v: number } | null = null
    for (const t of c.targets) {
      const target = s.entities[t.entityId]
      if (!target) continue
      const tv = readField(target, t.field)
      if (tv === undefined) continue
      const dist = Math.abs(tv - value)
      if (dist <= c.threshold && (!best || dist < best.dist)) best = { dist, v: tv }
    }
    if (best) value = best.v
  }
  return value
}

function afterConstraintAdded(s: State, c: Constraint) {
  // single_of_kind: when a new active is set, prior active is implicitly demoted
  // (the constraint's `activeId` field IS the source of truth — nothing else
  // to do). Future kinds that need initialization on add can hook here.
  void s; void c
}

function translateEntity(s: State, id: EntityId, delta: number) {
  const e = s.entities[id]
  if (!e) return
  if (e.kind === 'anchor') e.time += delta
  else { e.in += delta; e.out += delta }
}

function scaleEntityAround(s: State, id: EntityId, pivot: number, scale: number) {
  const e = s.entities[id]
  if (!e) return
  if (e.kind === 'anchor') e.time = pivot + (e.time - pivot) * scale
  else { e.in = pivot + (e.in - pivot) * scale; e.out = pivot + (e.out - pivot) * scale }
}

function readField(e: Entity, field: 'time' | 'in' | 'out'): number | undefined {
  if (e.kind === 'anchor' && field === 'time') return e.time
  if (e.kind === 'clip'   && field === 'in')   return e.in
  if (e.kind === 'clip'   && field === 'out')  return e.out
  return undefined
}
function writeField(e: Entity, field: 'time' | 'in' | 'out', v: number) {
  if (e.kind === 'anchor' && field === 'time') e.time = v
  else if (e.kind === 'clip' && field === 'in') e.in = v
  else if (e.kind === 'clip' && field === 'out') e.out = v
}
function clampValue(v: number, min?: number, max?: number): number {
  if (min !== undefined && v < min) return min
  if (max !== undefined && v > max) return max
  return v
}

function clone(s: State): State {
  return {
    entities: Object.fromEntries(Object.entries(s.entities).map(([k, v]) => [k, { ...v } as Entity])),
    constraints: s.constraints.map(c => ({ ...c, ...('ids' in c ? { ids: [...c.ids] } : {}) } as Constraint)),
    meta: Object.fromEntries(Object.entries(s.meta).map(([k, v]) => [k, { ...v }])),
  }
}

// ─── Recipes ──────────────────────────────────────────────────────────────
//
// User-level gestures expressed purely as constraint mutations. Every behavior
// in the production timeline reduces to a recipe + the generic resolver.

/** BPM × lockedBeats × length tradeoff. The one place where a lambda
 *  escape hatch is used — the math doesn't fit generic translate/scale.
 *  `fixed` chooses which quantity stays put when length changes. */
function bpmDerivedConstraint(clipId: EntityId, fixed: 'bpm' | 'beats'): Derived {
  return {
    kind: 'derived',
    watches: [clipId],
    tag: `bpm:${clipId}`,
    apply: (s) => {
      const clip = s.entities[clipId]
      if (!clip || clip.kind !== 'clip') return
      const length = clip.out - clip.in
      if (length < 1e-9) return
      const m = s.meta[clipId] ?? {}
      if (fixed === 'bpm'  && m.bpm         !== undefined) m.lockedBeats = length * m.bpm / 60
      if (fixed === 'beats' && m.lockedBeats !== undefined) m.bpm         = 60 * m.lockedBeats / length
      s.meta[clipId] = m
    },
  }
}

export const recipes = {

  /** Initial setup for a freshly-added clip pair: default-linked, derived
   *  BPM-vs-beats tradeoff in 'bpm' mode (default), and minimum length. */
  initClip(clipInId: EntityId, clipOutId: EntityId): Op[] {
    return [
      // Clipin → clipout follows on pan (one-way). Clipout doesn't drag clipin.
      { kind: 'add_constraint', c: { kind: 'directed_pair', from: clipInId, to: clipOutId, mode: 'translate', tag: `defaultlink:${clipInId}` } },
      // BPM × lockedBeats × length tradeoff. Lambda is the escape hatch
      // for math too specific for generic constraint kinds.
      { kind: 'add_constraint', c: bpmDerivedConstraint(clipOutId, 'bpm') },
      // Min length 0.1 — moving an edge past the opposite edge SHIFTS the clip.
      { kind: 'add_constraint', c: { kind: 'preserve_length', clipId: clipInId, min: 0.1, mode: 'shift' } },
      // Clamp to non-negative.
      { kind: 'add_constraint', c: { kind: 'clamp', entityId: clipInId, field: 'in',  min: 0 } },
      { kind: 'add_constraint', c: { kind: 'clamp', entityId: clipInId, field: 'out', min: 0 } },
    ]
  },

  /** Adding a paired anchor (anchor-in + anchor-out). Pairs them for delete
   *  propagation (deleting either deletes both). */
  initAnchorPair(anchorInId: EntityId, anchorOutId: EntityId): Op[] {
    return [
      { kind: 'add_constraint', c: { kind: 'delete_group', ids: [anchorInId, anchorOutId], tag: `pair:${anchorInId}` } },
    ]
  },

  /** User lassos N entities in one space → translate_group binds them. */
  lasso(spaceTag: string, ids: EntityId[]): Op {
    return { kind: 'add_constraint', c: { kind: 'translate_group', ids, tag: `lasso:${spaceTag}` } }
  },
  /** Clear lasso for a space. */
  clearLasso(spaceTag: string): Op {
    return { kind: 'remove_constraint', predicate: c => c.kind === 'translate_group' && c.tag === `lasso:${spaceTag}` }
  },

  /** Lock ON for a clipout + its inner anchor set: translate_group makes
   *  pan move them together; scale_group makes resize-with-lock=beats
   *  rescale anchors around the clipout's in-edge. */
  lockOn(clipOutId: EntityId, innerAnchorOutIds: EntityId[], pivot: number): Op[] {
    const ids = [clipOutId, ...innerAnchorOutIds]
    return [
      { kind: 'add_constraint', c: { kind: 'translate_group', ids, tag: `lock:${clipOutId}` } },
      { kind: 'add_constraint', c: { kind: 'scale_group',     ids, pivot, tag: `lock:${clipOutId}` } },
    ]
  },
  lockOff(clipOutId: EntityId): Op {
    return { kind: 'remove_constraint', predicate: c =>
      (c.kind === 'translate_group' || c.kind === 'scale_group') && c.tag === `lock:${clipOutId}` }
  },

  /** Carry: at pointerDown of a clipout edge drag, if the edge was on a
   *  conformed anchor, add a mirror_edge directed_pair so the anchor follows
   *  the edge during the drag (and commit on pointerUp). Ephemeral — recipe
   *  removes on pointerUp. */
  carryStart(clipOutId: EntityId, edge: 'in' | 'out', pairedAnchorOutId: EntityId): Op {
    return { kind: 'add_constraint', c: {
      kind: 'directed_pair',
      from: clipOutId, to: pairedAnchorOutId, mode: 'mirror_edge',
      tag: `carry:${clipOutId}:${edge}`,
    } }
  },
  carryEnd(clipOutId: EntityId): Op {
    return { kind: 'remove_constraint', predicate: c =>
      c.kind === 'directed_pair' && (c.tag?.startsWith(`carry:${clipOutId}:`) ?? false) }
  },

  /** Setting region.lock = 'beats' (the lock-mode dropdown): replace the
   *  derived constraint with one that fixes the chosen quantity. */
  setLockMode(clipOutId: EntityId, fixed: 'bpm' | 'beats'): Op[] {
    return [
      { kind: 'remove_constraint', predicate: c => c.kind === 'derived' && c.tag === `bpm:${clipOutId}` },
      { kind: 'add_constraint', c: bpmDerivedConstraint(clipOutId, fixed) },
    ]
  },

  /** Diverging the clipout from clipin (any explicit clipout drag): remove
   *  the default-link directed_pair so clipin moves no longer drag clipout. */
  diverge(clipInId: EntityId): Op {
    return { kind: 'remove_constraint', predicate: c =>
      c.kind === 'directed_pair' && c.tag === `defaultlink:${clipInId}` }
  },

  /** Active region: set/clear the single_of_kind anchor for 'clip' role. */
  setActiveClip(activeId: EntityId | null): Op[] {
    return [
      { kind: 'remove_constraint', predicate: c => c.kind === 'single_of_kind' && c.filterKind === 'clip' && c.role === 'active' },
      { kind: 'add_constraint', c: { kind: 'single_of_kind', filterKind: 'clip', role: 'active', activeId } },
    ]
  },

  /** Beat-zero anchor: at most one anchor can be flagged beat-zero. */
  setBeatZero(anchorId: EntityId | null): Op[] {
    return [
      { kind: 'remove_constraint', predicate: c => c.kind === 'single_of_kind' && c.filterKind === 'anchor' && c.role === 'beat_zero' },
      { kind: 'add_constraint', c: { kind: 'single_of_kind', filterKind: 'anchor', role: 'beat_zero', activeId: anchorId } },
    ]
  },

  /** Warp-line drag: temporarily pair anchor-in + anchor-out so dragging the
   *  warp-line connector moves both in lockstep. Removed on pointerUp. */
  warpLineStart(anchorInId: EntityId, anchorOutId: EntityId): Op {
    return { kind: 'add_constraint', c: { kind: 'translate_group', ids: [anchorInId, anchorOutId], tag: `warpline:${anchorInId}` } }
  },
  warpLineEnd(anchorInId: EntityId): Op {
    return { kind: 'remove_constraint', predicate: c =>
      c.kind === 'translate_group' && c.tag === `warpline:${anchorInId}` }
  },

  /** Snap-on-drag: add snap targets while dragging. Recipe owns the lifecycle. */
  snapBegin(id: EntityId, field: 'time' | 'in' | 'out', targets: SnapTarget['targets'], threshold = 4): Op {
    return { kind: 'add_constraint', c: { kind: 'snap_target', id, field, targets, threshold, tag: `snap:${id}:${field}` } }
  },
  snapEnd(id: EntityId, field: 'time' | 'in' | 'out'): Op {
    return { kind: 'remove_constraint', predicate: c => c.kind === 'snap_target' && c.tag === `snap:${id}:${field}` }
  },

  /** Conform: while an input anchor sits on a clip boundary, record the
   *  visual link (renderer reads this; no write propagation). The carry
   *  behavior is a SEPARATE recipe (carryStart) added only at drag time. */
  conform(anchorInId: EntityId, anchorOutId: EntityId, clipId: EntityId, edge: 'in' | 'out'): Op {
    return { kind: 'add_constraint', c: { kind: 'conform_visual', anchorInId, anchorOutId, clipId, edge } }
  },
  unconform(anchorInId: EntityId, clipId: EntityId, edge: 'in' | 'out'): Op {
    return { kind: 'remove_constraint', predicate: c =>
      c.kind === 'conform_visual' && c.anchorInId === anchorInId && c.clipId === clipId && c.edge === edge }
  },

  /** Highlight: visual coupling for hover / multi-select indicator. */
  highlight(ids: EntityId[], tag: string): Op {
    return { kind: 'add_constraint', c: { kind: 'highlight_group', ids, tag } }
  },
}

// ─── Demo ─────────────────────────────────────────────────────────────────

function show(label: string, s: State) {
  console.log(`\n── ${label} ────────`)
  for (const e of Object.values(s.entities)) {
    const m = s.meta[e.id]
    const extras = m ? ` (bpm=${m.bpm?.toFixed(1)} beats=${m.lockedBeats?.toFixed(2)})` : ''
    if (e.kind === 'anchor') console.log(`  ${e.id}: t=${e.time}`)
    else                     console.log(`  ${e.id}: [${e.in}, ${e.out}]${extras}`)
  }
  console.log(`  constraints (${s.constraints.length}):`)
  s.constraints.forEach((c, i) => console.log(`    [${i}] ${formatConstraint(c)}`))
}

function formatConstraint(c: Constraint): string {
  const tag = 'tag' in c && c.tag ? ` #${c.tag}` : ''
  switch (c.kind) {
    case 'translate_group':   return `translate_group { ${c.ids.join(', ')} }${tag}`
    case 'scale_group':       return `scale_group { ${c.ids.join(', ')} } pivot=${c.pivot}${tag}`
    case 'directed_pair':     return `directed_pair ${c.from} → ${c.to} (${c.mode})${tag}`
    case 'derived':           return `derived watches=[${c.watches.join(', ')}] apply=<fn>${tag}`
    case 'clamp':             return `clamp ${c.entityId}.${c.field} ∈ [${c.min ?? '−∞'}, ${c.max ?? '+∞'}]${tag}`
    case 'preserve_length':   return `preserve_length ${c.clipId} min=${c.min} mode=${c.mode}${tag}`
    case 'snap_target':       return `snap_target ${c.id}.${c.field} ← ${c.targets.length} targets th=${c.threshold}${tag}`
    case 'single_of_kind':    return `single_of_kind ${c.filterKind} role=${c.role} active=${c.activeId ?? 'null'}`
    case 'delete_group':      return `delete_group { ${c.ids.join(', ')} }${tag}`
    case 'highlight_group':   return `highlight_group { ${c.ids.join(', ')} }${tag}`
    case 'conform_visual':    return `conform_visual ${c.anchorInId}/${c.anchorOutId} ↔ ${c.clipId}.${c.edge}`
  }
}

function demo() {
  let s = emptyState()

  // Setup: clip A (clipin + clipout), anchor pairs 1 (boundary) and 2 (inner).
  s = reduce(s, { kind: 'add_clip', id: 'clipinA',  in: 0, out: 10 })
  s = reduce(s, { kind: 'add_clip', id: 'clipoutA', in: 0, out: 10 })
  s.meta['clipoutA'] = { bpm: 120, lockedBeats: 20 }
  for (const op of recipes.initClip('clipinA', 'clipoutA')) s = reduce(s, op)

  s = reduce(s, { kind: 'add_anchor', id: 'a1in',  time: 0 })
  s = reduce(s, { kind: 'add_anchor', id: 'a1out', time: 0 })
  for (const op of recipes.initAnchorPair('a1in', 'a1out')) s = reduce(s, op)
  s = reduce(s, recipes.conform('a1in', 'a1out', 'clipinA', 'in'))

  s = reduce(s, { kind: 'add_anchor', id: 'a2in',  time: 5 })
  s = reduce(s, { kind: 'add_anchor', id: 'a2out', time: 5 })
  for (const op of recipes.initAnchorPair('a2in', 'a2out')) s = reduce(s, op)

  for (const op of recipes.setActiveClip('clipinA')) s = reduce(s, op)
  show('initial — default-linked, derived-bpm, min-length 0.1, conform on inPoint', s)

  // 1. Pan clipinA → clipoutA follows via directed_pair.
  s = reduce(s, { kind: 'move', id: 'clipinA', delta: 2 })
  show('pan clipinA +2 → clipoutA follows (directed_pair)', s)

  // 2. Resize clipoutA's out edge → derived_quantity recomputes beats.
  s = reduce(s, recipes.diverge('clipinA'))
  s = reduce(s, { kind: 'set_edge', id: 'clipoutA', edge: 'out', value: 16 })
  show('diverge + resize clipoutA.out→16 → lockedBeats recomputes', s)

  // 3. Lasso a2out only → translate group on a2out alone.
  s = reduce(s, recipes.lasso('beat', ['a2out']))
  s = reduce(s, { kind: 'move', id: 'a2out', delta: 1 })
  show('lasso {a2out} + move +1 → only a2out moves', s)

  // 4. Anchor lock ON for clipoutA + a2out (inner).
  s = reduce(s, recipes.clearLasso('beat'))
  for (const op of recipes.lockOn('clipoutA', ['a2out'], 2)) s = reduce(s, op)
  s = reduce(s, { kind: 'move', id: 'clipoutA', delta: 3 })
  show('lock ON; pan clipoutA +3 → a2out follows (translate_group)', s)

  // 5. Lock=beats + resize clipoutA → scale group rescales a2out.
  for (const op of recipes.setLockMode('clipoutA', 'beats')) s = reduce(s, op)
  s = reduce(s, { kind: 'set_edge', id: 'clipoutA', edge: 'out', value: 20 })
  show('lock=beats + resize.out→20 → scale_group rescales a2out around pivot=2', s)

  // 6. Conformed-edge drag: carry pair makes a1out follow the edge.
  s = reduce(s, recipes.carryStart('clipoutA', 'in', 'a1out'))
  s = reduce(s, { kind: 'set_edge', id: 'clipoutA', edge: 'in', value: 4 })
  show('carry { clipoutA.in → a1out (mirror_edge) }; resize.in→4 → a1out follows', s)

  // 7. Cleanup: drag end removes carry.
  s = reduce(s, recipes.carryEnd('clipoutA'))
  show('drag end — carry removed', s)

  // 8. Delete a1in → delete_group propagates to a1out.
  s = reduce(s, { kind: 'delete', id: 'a1in' })
  show('delete a1in → a1out goes too (delete_group)', s)
}

if (typeof require !== 'undefined' && require.main === module) demo()
