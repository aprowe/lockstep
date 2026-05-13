import type { AppDispatch, RootState } from '../store'
import { dragEnd } from '../slices/dragSlice'
import { setRegions } from '../slices/regionSlice'
import { loadAnchors } from '../slices/warpSlice'

/**
 * Restore pre-drag state from preDrag snapshot (pointercancel / Escape rollback).
 * If no drag is active (preDrag is null), this is a no-op.
 * After restore, clears drag.active so middleware resumes normal operation.
 */
export const cancelDrag =
  () =>
  (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState()
    const { preDrag } = state.drag
    if (!preDrag) return

    // Restore regions
    dispatch(setRegions(preDrag.regions))
    // Restore both anchor arrays
    dispatch(loadAnchors({
      origAnchors: preDrag.origAnchors,
      beatAnchors: preDrag.beatAnchors,
    }))
    // Clear drag state (this fires the history snapshot via dragEnd in the
    // history middleware's trigger list).
    dispatch(dragEnd())
  }

/**
 * Snapshot current slice state for use as preDrag. Called by applyIntents when
 * the controller emits a 'dragStart' intent.
 */
export function snapshotPreDragState(state: RootState) {
  return {
    regions: state.region.regions,
    origAnchors: state.warp.origAnchors,
    beatAnchors: state.warp.beatAnchors,
  }
}
