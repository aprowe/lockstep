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
