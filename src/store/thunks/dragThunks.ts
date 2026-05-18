import type { AppDispatch, RootState } from '../store'
import { dragEnd } from '../slices/dragSlice'
import { loadAnchors } from '../slices/warpSlice'
import { setRegions } from '../slices/regionSlice'
import { clearLasso, clearSnapInstall, clearAllCarry, clearAnchorLock } from '../slices/dragCtxSlice'

/**
 * Restore pre-drag state by restoring the slice snapshot captured at drag start
 * (pointercancel / Escape rollback). Dispatching loadAnchors + setRegions
 * atomically reverts all position changes. dragCtxSlice transient state
 * (lasso, snap, carry, anchorLock) is cleared.
 *
 * If no drag is active (preDrag is null), this is a no-op.
 * After restore, clears drag.active so middleware resumes normal operation.
 */
export const cancelDrag =
  () =>
  (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState()
    const { preDrag } = state.drag
    if (!preDrag) return

    // Restore the slice state captured at drag start. This reverts:
    //  - all position changes that happened during the drag (origAnchors, beatAnchors)
    //  - all region position/bounds changes (inPoint, outPoint, inBeatTime, outBeatTime)
    // The graph is derived from the slice, so restoring the slice restores the graph view.
    dispatch(loadAnchors({
      origAnchors: preDrag.origAnchors,
      beatAnchors: preDrag.beatAnchors,
    }))
    dispatch(setRegions(preDrag.regions))

    // Clear ephemeral dragCtx state (lasso stays since it reflects current selection,
    // but snap/carry/lock were installed for this drag and must be cleared).
    dispatch(clearSnapInstall())
    dispatch(clearAllCarry())
    dispatch(clearAnchorLock())

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
