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
import { ConstraintKind, OpKind, PairMode } from './types'
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
import { lookupProfile } from './profiles'

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
  /** Selected anchor IDs per space, mirrored into the lasso TranslateGroup
   *  by buildGraphFromSlice. Read directly from warp slice — no separate
   *  mirror in dragCtxSlice. */
  selection?: {
    orig: number[]
    beat: number[]
  }
  /** Scene cut times for the active video, in seconds. Synthesized into
   *  anchor-like entities at build time so the snap engine can target them. */
  scenes?: number[]
}

export interface DragCtx {
  /** Active gesture handle — drives profile.whileDragging constraint injection. */
  activeHandle?: import('./profiles/types').Handle | null
  /** Modifier-key state for the active gesture (alt for anchor-lock XOR). */
  modifiers?: { alt: boolean }
  /** Pixel-to-time conversion at drag start (from controller's view info).
   *  Profiles use this to convert the pixel-space snap threshold (8 px)
   *  into entity-time units. */
  pxPerUnit?: number
  /** Optional beat-grid for snap (set when the active gesture should
   *  consider grid marks alongside entity targets). */
  grid?: { interval: number; offset: number }
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

  // 3. (SnapTarget install moved to step 11 — profile.whileDragging
  //     handles it now that all drag classes flow through profiles.)

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

  // 4. ConformVisual + ConformRedirect — INSTALLED AFTER STEP 11 below so
  //    they fire AFTER SnapTarget in each Propose fixed-point iteration.
  //    Insertion order matters: SnapTarget restricts the seed write first,
  //    ConformRedirect rewrites user clipout writes into anchor.beat writes,
  //    then ConformVisual asserts clipout = anchor.beat.
  //    See block after step 11 for the install loop.

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

  // 8. Lasso TranslateGroup — derived directly from slice selection state.
  //    No middleware mirror needed: the pipeline runs on every dispatch.
  let lassoIds: EntityId[] = []
  if (slice.selection) {
    for (const n of slice.selection.orig)  lassoIds.push(anchorInId(n))
    for (const n of slice.selection.beat)  lassoIds.push(anchorOutId(n))
    for (const s of slice.lists.selection.clipin)  lassoIds.push(regionInId(s))
    for (const s of slice.lists.selection.clipout) lassoIds.push(regionOutId(s))
    lassoIds = [...new Set(lassoIds)]
  }
  if (lassoIds.length > 0) {
    state = reduce(state, lasso('main', lassoIds))
  }

  // 9. (SnapTarget moved to step 3b above — must install before MirrorPair
  //    so snap restricts writes before MirrorPair propagates them.)

  // 10. Anchor-lock constraints — derived directly from slice state.
  //     The gesture-override (alt key during drag) is XOR'd with the static
  //     ui.anchorLock to get the effective lock state.
  {
    const gestureOverride = slice.ui.anchorLockGestureOverride ?? null
    const effectiveAnchorLock = gestureOverride !== null ? gestureOverride : (slice.ui.anchorLock ?? false)
    const activeRegionId = slice.ui.activeRegionId ?? null
    const activeRegion = activeRegionId
      ? slice.region.regions.find(r => r.id === activeRegionId)
      : undefined
    if (effectiveAnchorLock && activeRegion) {
      const clipoutIn = activeRegion.inBeatTime
      const clipoutOut = activeRegion.outBeatTime
      const EPSILON = 1e-9
      const innerAnchorOutIds: EntityId[] = []
      for (const a of slice.warp.beatAnchors) {
        if (a.time > clipoutIn + EPSILON && a.time < clipoutOut - EPSILON) {
          innerAnchorOutIds.push(anchorOutId(a.id))
        }
      }
      innerAnchorOutIds.sort()
      if (innerAnchorOutIds.length > 0) {
        const clipOutId = regionOutId(activeRegion.id)
        const lockMode = slice.ui.lockMode
        if (lockMode === 'beats') {
          for (const op of lockOn(clipOutId, innerAnchorOutIds)) {
            state = reduce(state, op)
          }
        } else {
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
    }
  }

  // 11. Gesture-scoped constraints — declared by the active drag handle's
  //     GestureProfile.whileDragging. These exist exactly for the
  //     pipeline-cycles where state.gesture.activeHandle points at them.
  //     Profiles receive the partial graph state so they can use
  //     `snapToSiblings` (and friends) to compute SnapTarget targets
  //     dynamically.
  if (dragCtx.activeHandle) {
    const profile = lookupProfile(dragCtx.activeHandle)
    if (profile) {
      const ctx = {
        preDrag: {
          origAnchors: slice.warp.origAnchors,
          beatAnchors: slice.warp.beatAnchors,
          regions:     slice.region.regions,
        },
        ui: { anchorLock: slice.ui.anchorLock ?? false, lockMode: slice.ui.lockMode },
        modifiers: dragCtx.modifiers ?? { alt: false },
        pxPerUnit: dragCtx.pxPerUnit ?? 0,
        grid:      dragCtx.grid ?? undefined,
      }
      for (const constraint of profile.whileDragging(dragCtx.activeHandle, ctx, state)) {
        state = reduce(state, { kind: OpKind.AddConstraint, constraint })
      }
    }
  }

  // 12. ConformRedirect + ConformVisual — installed LAST so that within
  //     each Propose fixed-point iteration, the rule order is:
  //       (a) Default-link (step 3b)         — clipin → clipout cascade
  //       (b) ... other Propose rules ...
  //       (c) SnapTarget (step 11, gesture)  — restricts seed write
  //       (d) ConformRedirect (this step)    — rewrites user clipout
  //                                            writes as anchor.beat writes
  //       (e) ConformVisual (this step)      — asserts clipout = anchor.beat
  //
  //     Order matters because state.constraints iterates by insertion order
  //     within each Propose pass. ConformRedirect must see the snapped
  //     value (so the anchor.beat write carries the snapped value, not the
  //     raw cursor). ConformVisual must run after ConformRedirect so the
  //     clipout it writes reflects the redirected anchor.beat.
  //
  //     Both rules fan out per (region × anchor × edge). MirrorPair was
  //     deleted — the conform coupling is now strictly directed (anchor →
  //     clipout), with redirect handling user clipout drags.
  //
  //     See: docs/superpowers/specs/2026-05-20-conform-invariant-restructure-design.md
  for (const r of slice.region.regions) {
    for (const orig of slice.warp.origAnchors) {
      const beat = beatById.get(orig.id)
      if (!beat) continue
      for (const edge of ['in', 'out'] as const) {
        state = reduce(state, {
          kind: OpKind.AddConstraint,
          constraint: {
            kind:        ConstraintKind.ConformRedirect,
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
 * Derive a DragCtx from the gestureSlice state subtree.
 *
 * dragCtxSlice was dissolved: lasso TranslateGroup, anchor-lock constraints,
 * and SnapTargets are all derived in buildGraphFromSlice directly from
 * slice/gesture state. Only the active gesture handle + modifiers + pixel
 * scaling remain in DragCtx.
 */
export function extractDragCtxFromSlice(state: {
  gesture?: {
    activeHandle: import('./profiles/types').Handle | null
    modifiers:    { alt: boolean }
    pxPerUnit?: number
    grid?: { interval: number; offset: number } | null
  }
}): DragCtx {
  const g = state.gesture
  return {
    activeHandle: g?.activeHandle ?? null,
    modifiers:    g?.modifiers    ?? { alt: false },
    pxPerUnit:    g?.pxPerUnit ?? 0,
    grid:         g?.grid ?? undefined,
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
