/**
 * Pipeline-driven dispatch helper.
 *
 * `dispatchPipelined` is the authoritative function for applying constraint ops
 * to the Redux store. It runs the pure constraint pipeline to compute slice
 * diffs, then dispatches them directly via _syncRegionPositions /
 * _syncAnchorPositions / _syncRegionMeta.
 */

import {
  runConstraintPipeline,
  extractDragCtxFromSlice,
  type PipelineSlice,
} from './pipeline'
import type { Op } from './types'
import type { RootState } from '../store/store'
import type { AppDispatch } from '../store/store'
import { _syncAnchorPositions } from '../store/slices/warpSlice'
import { _syncRegionPositions, _syncRegionMeta } from '../store/slices/regionSlice'

// ─── Slice extraction ─────────────────────────────────────────────────────────

/**
 * Extract a PipelineSlice from a RootState snapshot.
 *
 * Guards against minimal test stores that may omit `ui`, `region`, or `lists`
 * slices — falls back to safe empty/default values in those cases.
 */
export function extractSliceForPipeline(state: RootState): PipelineSlice {
  // `state` is typed as RootState but test stores may be narrower objects.
  // Use optional chaining + nullish fallbacks for resilience.
  const s = state as unknown as {
    warp?:       { origAnchors?: Array<{ id: number; time: number }>; beatAnchors?: Array<{ id: number; time: number; linked?: boolean }> }
    region?:     { regions?: Array<{ id: string; inPoint: number; outPoint: number; inBeatTime: number; outBeatTime: number; bpm?: number; lockedBeats?: number; defaultLinked: boolean }>; activeRegionId?: string | null }
    ui?:         { anchorLock?: boolean; anchorLockGestureOverride?: boolean | null; lockMode?: 'bpm' | 'beats' }
    lists?:      { selection?: { clipin?: string[]; clipout?: string[] } }
    video?:      { video?: { path?: string } | null }
    scene?:      { cutsByPath?: Record<string, number[]>; userCutsByPath?: Record<string, number[]> }
  }

  // Scenes for the active video. Combine detected + user-placed cuts.
  let scenes: number[] | undefined
  const path = s.video?.video?.path
  if (path) {
    const detected = s.scene?.cutsByPath?.[path] ?? []
    const user     = s.scene?.userCutsByPath?.[path] ?? []
    if (detected.length > 0 || user.length > 0) {
      scenes = [...detected, ...user].sort((a, b) => a - b)
    }
  }

  return {
    warp: {
      origAnchors: (s.warp?.origAnchors ?? []).map(a => ({ id: a.id, time: a.time })),
      beatAnchors: (s.warp?.beatAnchors ?? []).map(a => ({ id: a.id, time: a.time, linked: a.linked !== false })),
    },
    region: {
      regions: (s.region?.regions ?? []).map(r => ({
        id:            r.id,
        inPoint:       r.inPoint,
        outPoint:      r.outPoint,
        inBeatTime:    r.inBeatTime,
        outBeatTime:   r.outBeatTime,
        bpm:           r.bpm,
        lockedBeats:   r.lockedBeats,
        defaultLinked: r.defaultLinked,
      })),
    },
    ui: {
      anchorLock:                s.ui?.anchorLock                ?? false,
      anchorLockGestureOverride: s.ui?.anchorLockGestureOverride ?? null,
      lockMode:                  s.ui?.lockMode                  ?? 'bpm',
      activeRegionId:            s.region?.activeRegionId        ?? null,
    },
    lists: {
      selection: {
        clipin:  s.lists?.selection?.clipin  ?? [],
        clipout: s.lists?.selection?.clipout ?? [],
      },
    },
    scenes,
  }
}

// ─── dispatchPipelined ────────────────────────────────────────────────────────

/**
 * The authoritative function for applying a constraint op to the store.
 *
 * The pipeline is the SOURCE OF TRUTH for slice writes:
 *   1. Snapshot pre-state.
 *   2. Run `runConstraintPipeline(slice, dragCtx, op)`.
 *   3. Dispatch the resulting diffs via _syncAnchorPositions /
 *      _syncRegionPositions / _syncRegionMeta (synchronously).
 */
export function dispatchPipelined(
  dispatch: AppDispatch,
  getState: () => RootState,
  op: Op,
): void {
  const preState = getState()
  const preSlice = extractSliceForPipeline(preState)
  const dragCtx = extractDragCtxFromSlice(preState as Parameters<typeof extractDragCtxFromSlice>[0])

  const output = runConstraintPipeline({ slice: preSlice, dragCtx, op })

  // ── Dispatch pipeline diffs to the slice ──────────────────────────────────
  // Anchor diffs
  const hasOrigDiffs = Object.keys(output.anchorDiffs.orig).length > 0
  const hasBeatDiffs = Object.keys(output.anchorDiffs.beat).length > 0
  if (hasOrigDiffs || hasBeatDiffs) {
    dispatch(_syncAnchorPositions(output.anchorDiffs) as never)
  }

  // Region position diffs
  if (Object.keys(output.regionDiffs).length > 0) {
    dispatch(_syncRegionPositions(output.regionDiffs) as never)
  }

  // Region meta diffs
  if (Object.keys(output.metaDiffs).length > 0) {
    dispatch(_syncRegionMeta(output.metaDiffs) as never)
  }
}

// ─── dispatchPipelinedReplay ─────────────────────────────────────────────────

/**
 * Drag-aware dispatch that recomputes the slice state from the PRE-DRAG
 * baseline on every call. Each frame is a pure function of (preDrag, op):
 * no state carries forward from previous frames. Solves the "stale slice
 * state contaminates this frame" class of bugs — e.g., a transient conform
 * write on frame N persisting through subsequent frames where conform no
 * longer engages.
 *
 * When no drag is active (no preDrag), falls back to `dispatchPipelined`.
 *
 * Callers should pass an ABSOLUTE op relative to preDrag:
 *   - Move: delta = cumulative target − preDrag value (NOT current slice
 *           value).
 *   - SetEdge / SetValue: target as the user intends it from drag start.
 *
 * The resulting slice = preDrag + computed pipeline effects. Region and
 * anchor fields are dispatched as FULL post-state values (not incremental
 * diffs) so any stale-from-previous-frame values are overwritten.
 */
export function dispatchPipelinedReplay(
  dispatch: AppDispatch,
  getState: () => RootState,
  op: Op,
): void {
  const state = getState()
  const preDrag = state.drag?.preDrag
  if (!preDrag) {
    // No drag active — fall back to incremental dispatch against current slice.
    dispatchPipelined(dispatch, getState, op)
    return
  }

  // Build pipeline slice using PRE-DRAG region/anchor values. Everything else
  // (ui, lists, scenes, region meta) comes from the current state.
  const currentSlice = extractSliceForPipeline(state)
  const baselineSlice: PipelineSlice = {
    ...currentSlice,
    warp: {
      origAnchors: preDrag.origAnchors.map(a => ({ id: a.id, time: a.time })),
      beatAnchors: preDrag.beatAnchors.map(a => ({
        id: a.id,
        time: a.time,
        linked: (a as { linked?: boolean }).linked !== false,
      })),
    },
    region: {
      regions: preDrag.regions.map(r => ({
        id:            r.id,
        inPoint:       r.inPoint,
        outPoint:      r.outPoint,
        inBeatTime:    r.inBeatTime,
        outBeatTime:   r.outBeatTime,
        bpm:           r.bpm,
        lockedBeats:   r.lockedBeats,
        defaultLinked: r.defaultLinked,
      })),
    },
  }

  const dragCtx = extractDragCtxFromSlice(state as Parameters<typeof extractDragCtxFromSlice>[0])
  const output  = runConstraintPipeline({ slice: baselineSlice, dragCtx, op })

  // Dispatch the diffs (vs preDrag) computed by extractDiffs. Sequential ops
  // within a single pointer event each replay against the same preDrag
  // baseline, but the dispatched diffs only touch the fields the op
  // actually wrote — so op N's writes aren't clobbered by op N+1's
  // (different fields) dispatch.
  const hasOrigDiffs = Object.keys(output.anchorDiffs.orig).length > 0
  const hasBeatDiffs = Object.keys(output.anchorDiffs.beat).length > 0
  if (hasOrigDiffs || hasBeatDiffs) {
    dispatch(_syncAnchorPositions(output.anchorDiffs) as never)
  }
  if (Object.keys(output.regionDiffs).length > 0) {
    dispatch(_syncRegionPositions(output.regionDiffs) as never)
  }
  if (Object.keys(output.metaDiffs).length > 0) {
    dispatch(_syncRegionMeta(output.metaDiffs) as never)
  }
}

// ─── beginReplayFrame ────────────────────────────────────────────────────────

/**
 * Reset slice's regions and anchors back to their PRE-DRAG values. Call
 * this at the start of each pointer-event frame (before processing any
 * intents) so each frame's constraint replay starts from a clean baseline.
 * Without it, fields written by a prior frame's constraint cascade (e.g.,
 * inner anchors moved by an anchor-lock TranslateGroup that's no longer
 * installed this frame because alt was released) would persist into the
 * current frame's slice, defeating the "each frame is f(preDrag, ops)"
 * invariant the replay model relies on.
 *
 * No-op when no drag is active (no preDrag).
 */
export function beginReplayFrame(
  dispatch: AppDispatch,
  getState: () => RootState,
): void {
  const state = getState()
  const preDrag = state.drag?.preDrag
  if (!preDrag) return

  // Region position resets — restore any drifted field to its preDrag value.
  const regionDiffs: Record<string, Partial<{
    inPoint:       number
    outPoint:      number
    inBeatTime:    number
    outBeatTime:   number
    defaultLinked: boolean
  }>> = {}
  for (const r of preDrag.regions) {
    const current = state.region.regions.find(c => c.id === r.id)
    if (!current) continue
    const diff: Partial<{
      inPoint:       number
      outPoint:      number
      inBeatTime:    number
      outBeatTime:   number
      defaultLinked: boolean
    }> = {}
    if (current.inPoint       !== r.inPoint)       diff.inPoint       = r.inPoint
    if (current.outPoint      !== r.outPoint)      diff.outPoint      = r.outPoint
    if (current.inBeatTime    !== r.inBeatTime)    diff.inBeatTime    = r.inBeatTime
    if (current.outBeatTime   !== r.outBeatTime)   diff.outBeatTime   = r.outBeatTime
    if (current.defaultLinked !== r.defaultLinked) diff.defaultLinked = r.defaultLinked
    if (Object.keys(diff).length > 0) regionDiffs[r.id] = diff
  }
  if (Object.keys(regionDiffs).length > 0) {
    dispatch(_syncRegionPositions(regionDiffs) as never)
  }

  // Anchor position resets.
  const anchorDiffs: { orig: Record<number, number>; beat: Record<number, number> } = {
    orig: {}, beat: {},
  }
  for (const a of preDrag.origAnchors) {
    const current = state.warp.origAnchors.find(c => c.id === a.id)
    if (current && current.time !== a.time) anchorDiffs.orig[a.id] = a.time
  }
  for (const a of preDrag.beatAnchors) {
    const current = state.warp.beatAnchors.find(c => c.id === a.id)
    if (current && current.time !== a.time) anchorDiffs.beat[a.id] = a.time
  }
  if (Object.keys(anchorDiffs.orig).length > 0 || Object.keys(anchorDiffs.beat).length > 0) {
    dispatch(_syncAnchorPositions(anchorDiffs) as never)
  }
}
