/**
 * runConstraintPipeline — pure function that applies a constraint op to slice state.
 *
 * Builds a constraint State from (slice, dragCtx), runs the resolver, then
 * extracts slice diffs from the resulting state.
 * Returns { regionDiffs, anchorDiffs, metaDiffs } — no Redux dispatch, no mutation
 * of external state.
 */

import { reduce, emptyState, bpmDerivedConstraint } from './resolver'
import type { State, Op, EntityId } from './types'
import { ConstraintKind, Field, OpKind, PairMode } from './types'
import {
  anchorInId,
  anchorOutId,
  regionInId,
  regionOutId,
} from './ids'
import {
  initAnchorPair,
  lasso,
  lockOn,
} from './recipes'
import { SNAP_RULES } from './snap-rules'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface PipelineSlice {
  warp: {
    origAnchors: Array<{ id: number; time: number; linked?: boolean }>
    beatAnchors: Array<{ id: number; time: number; linked?: boolean }>
  }
  region: {
    regions: Array<{
      id: string
      inPoint: number
      outPoint: number
      inBeatTime: number
      outBeatTime: number
      bpm?: number
      lockedBeats?: number
      defaultLinked: boolean
    }>
  }
  ui: {
    anchorLock: boolean
    anchorLockGestureOverride: boolean | null
    lockMode: 'bpm' | 'beats'
    activeRegionId?: string | null
  }
  lists: {
    selection: {
      clipin: string[]
      clipout: string[]
    }
  }
  /** Scene cut times for the active video, in seconds. Synthesized into
   *  anchor-like entities at build time so the snap engine can target them. */
  scenes?: number[]
}

export interface DragCtx {
  /** Lasso TranslateGroup members (entity IDs). Empty when no selection. */
  lassoIds: EntityId[]
  /** Snap installed for a drag — null when not snapping. */
  snapInstall?: {
    entityId: EntityId
    field: 'time' | 'in' | 'out'
    threshold: number
    grid?: { interval: number; offset: number }
    mode?: 'edge' | 'body'
    targets?: Array<{ entityId: EntityId; field: 'time' | 'in' | 'out' }>
  }
  /** Anchor-lock state — null/false means inactive. */
  anchorLock?: {
    clipOutId: EntityId
    innerAnchorOutIds: EntityId[]
    lockMode: 'bpm' | 'beats'
  }
}

export interface PipelineInput {
  slice: PipelineSlice
  dragCtx: DragCtx
  op: Op
}

export interface PipelineOutput {
  /** Per-region position diffs to write to slice.region. */
  regionDiffs: Record<string, Partial<{
    inPoint: number
    outPoint: number
    inBeatTime: number
    outBeatTime: number
    bpm: number
    lockedBeats: number
    defaultLinked: boolean
  }>>
  /** Per-anchor position diffs (by numeric anchor id). */
  anchorDiffs: {
    orig: Record<number, number>
    beat: Record<number, number>
  }
  /** Per-region meta diffs. */
  metaDiffs: Record<string, Partial<{ bpm: number; lockedBeats: number }>>
}

// ─── Graph build ──────────────────────────────────────────────────────────────

/**
 * Build a constraint State from (slice, dragCtx).
 *
 * Derives all constraints from slice state: anchor pairs, default-link
 * DirectedPairs, ConformVisual bindings, SnapRules, space cohorts,
 * twin cohorts, lasso TranslateGroup, anchorLock TranslateGroup/ScaleGroup,
 * ConformVisual + MirrorPair conform bindings.
 */
export function buildGraphFromSlice(slice: PipelineSlice, dragCtx: DragCtx): State {
  let state = emptyState()

  state.globals.lockMode = slice.ui.lockMode

  // ── Entities ──────────────────────────────────────────────────────────────

  // Anchor pairs
  for (const a of slice.warp.origAnchors) {
    state.entities[anchorInId(a.id)] = {
      kind: 'anchor',
      id:   anchorInId(a.id),
      time: a.time,
    }
  }
  for (const a of slice.warp.beatAnchors) {
    state.entities[anchorOutId(a.id)] = {
      kind: 'anchor',
      id:   anchorOutId(a.id),
      time: a.time,
    }
  }

  // Region clip pairs
  for (const r of slice.region.regions) {
    state.entities[regionInId(r.id)] = {
      kind: 'clip',
      id:   regionInId(r.id),
      in:   r.inPoint,
      out:  r.outPoint,
    }
    state.entities[regionOutId(r.id)] = {
      kind: 'clip',
      id:   regionOutId(r.id),
      in:   r.inBeatTime,
      out:  r.outBeatTime,
    }
    // Seed meta for bpmDerivedConstraint
    if (r.bpm !== undefined || r.lockedBeats !== undefined) {
      state.meta[regionOutId(r.id)] = {
        ...(r.bpm         !== undefined ? { bpm:         r.bpm }         : {}),
        ...(r.lockedBeats !== undefined ? { lockedBeats: r.lockedBeats } : {}),
      }
    }
  }

  // ── Structural constraints ─────────────────────────────────────────────────

  // 1. Anchor pair markers (DeleteGroup + linked sentinel).
  //    A beat anchor with linked !== false is considered linked.
  const beatById = new Map(slice.warp.beatAnchors.map(a => [a.id, a]))
  for (const a of slice.warp.origAnchors) {
    const beat = beatById.get(a.id)
    const isLinked = !beat || beat.linked !== false
    if (isLinked) {
      for (const op of initAnchorPair(anchorInId(a.id), anchorOutId(a.id))) {
        state = reduce(state, op)
      }
    }
  }

  // 2. BPM derived constraint — one per region clipout.
  for (const r of slice.region.regions) {
    const outId = regionOutId(r.id)
    state = reduce(state, {
      kind: OpKind.AddConstraint,
      constraint: bpmDerivedConstraint(outId, slice.ui.lockMode),
    })
  }

  // 3. Snap SnapTarget — installed BEFORE MirrorEdge / ConformVisual /
  //    MirrorPair so the snap correction happens FIRST in each Propose pass.
  //    Subsequent cascading constraints (MirrorEdge clipin→clipout,
  //    MirrorPair clipout→anchor) then see the already-snapped value and
  //    propagate it. Without this ordering, MirrorEdge would propagate the
  //    pre-snap value to clipout, MirrorPair would propagate that stale
  //    clipout to the anchor, and the anchor would be left at the pre-snap
  //    value (the "anchors get lost during snap" bug).
  if (dragCtx.snapInstall) {
    const { entityId, field, threshold, grid, mode, targets } = dragCtx.snapInstall
    state = reduce(state, {
      kind: OpKind.AddConstraint,
      constraint: {
        kind:      ConstraintKind.SnapTarget,
        id:        entityId,
        field,
        targets:   targets ?? [],
        threshold,
        grid,
        mode,
        tag:       `snap:${entityId}:${field}`,
      },
    })
  }

  // 3b. Default-link (clipin → clipout): two MirrorEdges (per-edge value
  //    mirror). For each clipin edge write, clipout's matching edge gets the
  //    same value. Chosen over Translate (delta cascade) so the linked
  //    invariant `clipout = clipin` is re-asserted every pipeline pass —
  //    important for the conform "restore" behavior: when ConformVisual
  //    transiently writes clipout to a beat anchor's time and the user then
  //    drags clipin past coincidence, the next pass's MirrorEdge cascade
  //    snaps clipout back to clipin's new value (not clipout's stale
  //    conformed value + delta, which is what Translate would yield).
  for (const r of slice.region.regions) {
    if (r.defaultLinked) {
      state = reduce(state, {
        kind: OpKind.AddConstraint,
        constraint: {
          kind:     ConstraintKind.DirectedPair,
          from:     regionInId(r.id),
          to:       regionOutId(r.id),
          mode:     PairMode.MirrorEdge,
          fromEdge: 'in',
          tag:      `defaultlink:${regionInId(r.id)}:in`,
        },
      })
      state = reduce(state, {
        kind: OpKind.AddConstraint,
        constraint: {
          kind:     ConstraintKind.DirectedPair,
          from:     regionInId(r.id),
          to:       regionOutId(r.id),
          mode:     PairMode.MirrorEdge,
          fromEdge: 'out',
          tag:      `defaultlink:${regionInId(r.id)}:out`,
        },
      })
    }
  }

  // 4a. ConformVisual — auto-installed for every (region × anchor × edge)
  //    combination. The handler checks coincidence DYNAMICALLY each pipeline
  //    pass using txn-aware values: if `clipin.{edge}` (post-write) coincides
  //    with `orig.time`, write `anchor-out.time` to clipout's matching edge.
  //    One-way (anchor → clip). Re-evaluating per pass means the binding
  //    naturally engages and releases as clipin moves into and out of
  //    coincidence during a drag — no permanent commit, no stale install.
  //
  //    Handles: visual conform during clipin drag (clipout snaps to the
  //    paired beat anchor when clipin lands on its orig).
  for (const r of slice.region.regions) {
    for (const orig of slice.warp.origAnchors) {
      const beat = beatById.get(orig.id)
      if (!beat) continue
      for (const edge of ['in', 'out'] as const) {
        state = reduce(state, {
          kind: OpKind.AddConstraint,
          constraint: {
            kind:        ConstraintKind.ConformVisual,
            anchorInId:  anchorInId(orig.id),
            anchorOutId: anchorOutId(orig.id),
            clipId:      regionInId(r.id),
            clipOutId:   regionOutId(r.id),
            edge,
          },
        })
      }
    }
  }

  // 4b. MirrorPair (symmetric, dual-space install + guard) — installed wherever
  //    conform is fully engaged in BOTH input and output spaces. This handles
  //    the OTHER direction: drag clipout → anchor follows. ConformVisual only
  //    handles anchor→clip; this is the symmetric clip→anchor.
  //
  //    Dual-space install + guard together prevent the diverged-anchor nudge
  //    bug: it only installs when output coincidence ALSO holds (linked anchor
  //    on a default-linked clip, or post-linking-event conformance), so a
  //    default-link clip drag across a diverged anchor (input coincides but
  //    output doesn't) never triggers the symmetric write.
  {
    const LINK_EPSILON = 1e-4
    for (const r of slice.region.regions) {
      const clipinEntity  = state.entities[regionInId(r.id)]
      const clipoutEntity = state.entities[regionOutId(r.id)]
      if (!clipinEntity  || clipinEntity.kind  !== 'clip') continue
      if (!clipoutEntity || clipoutEntity.kind !== 'clip') continue
      for (const orig of slice.warp.origAnchors) {
        const beat = beatById.get(orig.id)
        if (!beat) continue
        for (const edge of ['in', 'out'] as const) {
          const clipInEdgeValue  = edge === 'in' ? clipinEntity.in  : clipinEntity.out
          const clipOutEdgeValue = edge === 'in' ? clipoutEntity.in : clipoutEntity.out
          if (Math.abs(clipInEdgeValue  - orig.time) > LINK_EPSILON) continue
          if (Math.abs(clipOutEdgeValue - beat.time) > LINK_EPSILON) continue
          state = reduce(state, {
            kind: OpKind.AddConstraint,
            constraint: {
              kind: ConstraintKind.MirrorPair,
              a:    { id: anchorOutId(orig.id), field: Field.Time },
              b:    { id: regionOutId(r.id),    field: edge },
              guard: {
                a: { id: anchorInId(orig.id), field: Field.Time },
                b: { id: regionInId(r.id),    field: edge },
              },
              tag:  `conform:${orig.id}:${r.id}:${edge}`,
            },
          })
        }
      }
    }
  }

  // 5. SnapRule constraints — derived from SNAP_RULES table.
  for (const spec of SNAP_RULES) {
    const tag = spec.condition
      ? `rule:${spec.dragger}->${spec.target}:${spec.condition}`
      : `rule:${spec.dragger}->${spec.target}`
    state = reduce(state, {
      kind: OpKind.AddConstraint,
      constraint: {
        kind:      ConstraintKind.SnapRule,
        dragger:   spec.dragger,
        target:    spec.target,
        condition: spec.condition,
        tag,
      },
    })
  }

  // 6. Space cohorts (anchor-in / anchor-out / clipin / clipout) — derived from slice.
  const cohorts: Record<string, EntityId[]> = {
    'anchor-in':  slice.warp.origAnchors.map(a => anchorInId(a.id)),
    'anchor-out': slice.warp.beatAnchors.map(a => anchorOutId(a.id)),
    'clipin':     slice.region.regions.map(r => regionInId(r.id)),
    'clipout':    slice.region.regions.map(r => regionOutId(r.id)),
  }
  for (const [tag, ids] of Object.entries(cohorts)) {
    // Remove any existing cohort with this tag, then add fresh.
    state = reduce(state, {
      kind: OpKind.RemoveConstraint,
      predicate: (c) => c.kind === ConstraintKind.SnapCohort && (c as { tag?: string }).tag === tag,
    })
    state = reduce(state, {
      kind: OpKind.AddConstraint,
      constraint: { kind: ConstraintKind.SnapCohort, tag, ids },
    })
  }

  // 6b. Scenes — synthesize anchor-like entities, populate `scenes` cohort.
  //     Scenes aren't real anchor pairs (no beat side, no DeleteGroup), so
  //     they're conjured purely for snap-target purposes at build time.
  if (slice.scenes && slice.scenes.length > 0) {
    const sceneIds: EntityId[] = []
    for (let i = 0; i < slice.scenes.length; i++) {
      const id: EntityId = `scene:${i}`
      state = reduce(state, { kind: OpKind.AddAnchor, id, time: slice.scenes[i] })
      sceneIds.push(id)
    }
    state = reduce(state, {
      kind: OpKind.RemoveConstraint,
      predicate: (c) => c.kind === ConstraintKind.SnapCohort && (c as { tag?: string }).tag === 'scenes',
    })
    state = reduce(state, {
      kind: OpKind.AddConstraint,
      constraint: { kind: ConstraintKind.SnapCohort, tag: 'scenes', ids: sceneIds },
    })
  }

  // 7. Twin cohorts (twin:{regionId}) — derived for diverged (defaultLinked === false) regions.
  for (const r of slice.region.regions) {
    if (r.defaultLinked === false) {
      state = reduce(state, {
        kind: OpKind.AddConstraint,
        constraint: {
          kind: ConstraintKind.SnapCohort,
          tag:  `twin:${r.id}`,
          ids:  [regionInId(r.id), regionOutId(r.id)],
        },
      })
    }
  }

  // ── Transient (dragCtx) constraints ──────────────────────────────────────

  // 8. Lasso TranslateGroup — from dragCtx.lassoIds (written by selectionGraphMirrorMiddleware).
  if (dragCtx.lassoIds.length > 0) {
    state = reduce(state, lasso('main', dragCtx.lassoIds))
  }

  // 9. (SnapTarget moved to step 3b above — must install before MirrorPair
  //    so snap restricts writes before MirrorPair propagates them.)

  // 10. Anchor-lock constraints — from dragCtx.anchorLock (written by anchorLockMirrorMiddleware).
  if (dragCtx.anchorLock) {
    const { clipOutId, innerAnchorOutIds, lockMode } = dragCtx.anchorLock
    if (lockMode === 'beats') {
      for (const op of lockOn(clipOutId, innerAnchorOutIds)) {
        state = reduce(state, op)
      }
    } else {
      // 'bpm' mode: TranslateGroup only (no ScaleGroup).
      state = reduce(state, {
        kind: OpKind.AddConstraint,
        constraint: {
          kind:   ConstraintKind.TranslateGroup,
          ids:    [clipOutId, ...innerAnchorOutIds],
          driver: clipOutId,
          tag:    `lock:${clipOutId}`,
        },
      })
    }
  }

  return state
}

// ─── Extract diffs ────────────────────────────────────────────────────────────

/**
 * Compare post-resolver State against the pre-op slice values and emit diffs.
 * Only fields that CHANGED are emitted (undefined = no change).
 */
export function extractDiffs(
  postState: State,
  slice: PipelineSlice,
): Omit<PipelineOutput, never> {
  const regionDiffs: PipelineOutput['regionDiffs'] = {}
  const anchorDiffs: PipelineOutput['anchorDiffs'] = { orig: {}, beat: {} }
  const metaDiffs: PipelineOutput['metaDiffs'] = {}

  // Regions
  for (const r of slice.region.regions) {
    const cin  = postState.entities[regionInId(r.id)]
    const cout = postState.entities[regionOutId(r.id)]
    const meta = postState.meta[regionOutId(r.id)]
    const diff: PipelineOutput['regionDiffs'][string] = {}
    let hasDiff = false

    if (cin && cin.kind === 'clip') {
      if (cin.in !== r.inPoint)   { diff.inPoint  = cin.in;  hasDiff = true }
      if (cin.out !== r.outPoint) { diff.outPoint = cin.out; hasDiff = true }
    }
    if (cout && cout.kind === 'clip') {
      if (cout.in  !== r.inBeatTime)  { diff.inBeatTime  = cout.in;  hasDiff = true }
      if (cout.out !== r.outBeatTime) { diff.outBeatTime = cout.out; hasDiff = true }
    }

    // defaultLinked diff is not driven by position; skip it in the extract
    // (it's driven by constraint presence, not entity values). Phase 2 can add
    // it when the defaultlink removal is part of the op.

    if (hasDiff) regionDiffs[r.id] = diff

    // Meta diffs
    if (meta) {
      const metaDiff: PipelineOutput['metaDiffs'][string] = {}
      let hasMetaDiff = false
      if (meta.bpm !== undefined && meta.bpm !== r.bpm) {
        metaDiff.bpm = meta.bpm
        hasMetaDiff = true
      }
      if (meta.lockedBeats !== undefined && meta.lockedBeats !== r.lockedBeats) {
        metaDiff.lockedBeats = meta.lockedBeats
        hasMetaDiff = true
      }
      if (hasMetaDiff) metaDiffs[r.id] = metaDiff
    }
  }

  // Anchors
  for (const a of slice.warp.origAnchors) {
    const e = postState.entities[anchorInId(a.id)]
    if (e && e.kind === 'anchor' && e.time !== a.time) {
      anchorDiffs.orig[a.id] = e.time
    }
  }
  for (const a of slice.warp.beatAnchors) {
    const e = postState.entities[anchorOutId(a.id)]
    if (e && e.kind === 'anchor' && e.time !== a.time) {
      anchorDiffs.beat[a.id] = e.time
    }
  }

  return { regionDiffs, anchorDiffs, metaDiffs }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Pure pipeline: build graph, run resolver, extract diffs.
 *
 * Input: slice subtree + transient dragCtx + the op to apply.
 * Output: diffs to apply to a copy of the slice to reach the post-op state.
 *
 * No Redux dispatch. No mutation of external state. Safe to call from tests,
 * workers, or any context without a store.
 */
export function runConstraintPipeline(input: PipelineInput): PipelineOutput {
  const { slice, dragCtx, op } = input

  // Build the graph from slice + dragCtx (mirrors the middleware cascade).
  const preState = buildGraphFromSlice(slice, dragCtx)

  // Run the resolver pipeline.
  const postState = reduce(preState, op)

  // Extract diffs by comparing post-state against the original slice values.
  return extractDiffs(postState, slice)
}

// ─── DragCtx extraction ───────────────────────────────────────────────────────

/**
 * Derive a DragCtx from the dragCtxSlice state subtree.
 *
 * The shape of DragCtxSliceState mirrors DragCtx exactly (same fields, same
 * types — both are informed by the same DragCtx interface defined above).
 */
export function extractDragCtxFromSlice(state: {
  dragCtx?: {
    lassoIds:    string[]
    snapInstall: {
      entityId: string
      field: 'time' | 'in' | 'out'
      threshold: number
      grid?: { interval: number; offset: number }
      mode?: 'edge' | 'body'
      targets?: Array<{ entityId: string; field: 'time' | 'in' | 'out' }>
    } | null
    anchorLock:  {
      clipOutId:           string
      innerAnchorOutIds:   string[]
      lockMode:            'bpm' | 'beats'
    } | null
  }
}): DragCtx {
  const dc = state.dragCtx
  if (!dc) {
    return { lassoIds: [] }
  }
  return {
    lassoIds:    dc.lassoIds,
    snapInstall: dc.snapInstall ?? undefined,
    anchorLock:  dc.anchorLock ?? undefined,
  }
}

/**
 * Apply PipelineOutput diffs to a shallow copy of the slice state,
 * returning the new slice positions. Used by equivalence tests to build a
 * "canonical" final-state snapshot from the pipeline path.
 */
export function applyDiffsToSlice(
  slice: PipelineSlice,
  output: PipelineOutput,
): {
  origAnchors: Array<{ id: number; time: number }>
  beatAnchors: Array<{ id: number; time: number }>
  regions: Array<{
    id: string
    inPoint: number
    outPoint: number
    inBeatTime: number
    outBeatTime: number
    bpm?: number
    lockedBeats?: number
  }>
} {
  const origAnchors = slice.warp.origAnchors.map(a => ({
    id:   a.id,
    time: output.anchorDiffs.orig[a.id] ?? a.time,
  }))
  const beatAnchors = slice.warp.beatAnchors.map(a => ({
    id:   a.id,
    time: output.anchorDiffs.beat[a.id] ?? a.time,
  }))
  const regions = slice.region.regions.map(r => {
    const pos  = output.regionDiffs[r.id]
    const meta = output.metaDiffs[r.id]
    return {
      id:          r.id,
      inPoint:     pos?.inPoint     ?? r.inPoint,
      outPoint:    pos?.outPoint    ?? r.outPoint,
      inBeatTime:  pos?.inBeatTime  ?? r.inBeatTime,
      outBeatTime: pos?.outBeatTime ?? r.outBeatTime,
      bpm:         meta?.bpm         ?? r.bpm,
      lockedBeats: meta?.lockedBeats ?? r.lockedBeats,
    }
  })
  return { origAnchors, beatAnchors, regions }
}
