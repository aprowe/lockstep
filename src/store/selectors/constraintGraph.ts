import { createSelector } from '@reduxjs/toolkit'
import type { RootState } from '../store'
import { buildGraphFromSlice } from '../../constraints/pipeline'
import type { State as ConstraintState } from '../../constraints/types'
import { extractDragCtxFromSlice } from '../../constraints/pipeline'

/**
 * Memoized derived view of the constraint graph, rebuilt from slice + dragCtx
 * on demand. Replaces the deleted `state.constraint.graph` for reads.
 *
 * Cache invalidates whenever any contributing slice changes reference, which
 * Immer guarantees per dispatch. The build cost is microseconds per call.
 */
export const selectConstraintGraph = createSelector(
  (s: RootState) => s.warp.origAnchors,
  (s: RootState) => s.warp.beatAnchors,
  (s: RootState) => s.warp.selectedOrigIds,
  (s: RootState) => s.warp.selectedBeatIds,
  (s: RootState) => s.region.regions,
  (s: RootState) => s.ui.lockMode,
  (s: RootState) => s.ui.anchorLock,
  (s: RootState) => s.ui.anchorLockGestureOverride,
  (s: RootState) => s.region.activeRegionId,
  (s: RootState) => s.lists,
  // gestureSlice — profile.whileDragging constraints depend on activeHandle.
  // Without this dependency the selector wouldn't invalidate when a drag
  // starts, and gesture-scoped constraints wouldn't appear in the snapshot.
  (s: RootState) => s.gesture,
  // Defensive: test stores may omit video/scene slices.
  (s: RootState) => (s as { video?: { video?: { path?: string } | null } }).video?.video?.path,
  (s: RootState) => (s as { scene?: { cutsByPath?: Record<string, number[]> } }).scene?.cutsByPath,
  (s: RootState) => (s as { scene?: { userCutsByPath?: Record<string, number[]> } }).scene?.userCutsByPath,
  (origAnchors, beatAnchors, selectedOrigIds, selectedBeatIds, regions, lockMode, anchorLock, anchorLockGestureOverride, activeRegionId, lists, gesture, videoPath, cutsByPath, userCutsByPath): ConstraintState => {
    let scenes: number[] | undefined
    if (videoPath) {
      const detected = cutsByPath?.[videoPath] ?? []
      const user     = userCutsByPath?.[videoPath] ?? []
      if (detected.length > 0 || user.length > 0) {
        scenes = [...detected, ...user].sort((a, b) => a - b)
      }
    }
    return buildGraphFromSlice(
      {
        warp:   { origAnchors, beatAnchors },
        region: { regions },
        ui:     { lockMode, anchorLock, anchorLockGestureOverride, activeRegionId },
        lists:  { selection: { clipin: lists.selection.clipin, clipout: lists.selection.clipout } },
        selection: { orig: selectedOrigIds, beat: selectedBeatIds },
        scenes,
      },
      extractDragCtxFromSlice({ gesture }),
    )
  },
)
