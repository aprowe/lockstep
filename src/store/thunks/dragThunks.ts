import type { AppDispatch, RootState } from '../store'
import { dragStart, dragEnd } from '../slices/dragSlice'
import { loadAnchors } from '../slices/warpSlice'
import { setRegions } from '../slices/regionSlice'
import { clearLasso, clearSnapInstall, clearAnchorLock } from '../slices/dragCtxSlice'
import {
  setActiveHandle,
  setCumulativeDelta,
  setGestureModifiers,
  clearGesture,
} from '../slices/gestureSlice'
import type { Handle, ProfileContext } from '../../constraints/profiles/types'
import { lookupProfile } from '../../constraints/profiles'
import { dispatchPipelinedReplay } from '../../constraints/pipelineDispatch'

/**
 * Begin a drag gesture. Snapshots the slice's pre-drag state for the
 * replay model and records the active handle. The handle is consumed by
 * `buildGraphFromSlice` to inject the profile's `whileDragging`
 * constraints automatically — no install/teardown ops to leak.
 */
export const beginDrag =
  ({ handle }: { handle: Handle }) =>
  (dispatch: AppDispatch, getState: () => RootState) => {
    dispatch(dragStart(snapshotPreDragState(getState())))
    dispatch(setActiveHandle(handle))
    dispatch(setCumulativeDelta(0))
    dispatch(setGestureModifiers({ alt: false }))
  }

/**
 * Apply a cumulative drag delta. Looks up the active handle's profile,
 * translates delta → ops, and dispatches each through the replay
 * pipeline. Modifiers are piggy-backed on the intent and updated before
 * the profile is consulted (so whileDragging sees the current modifier
 * state on the next pipeline build).
 *
 * No-op when no handle is active (defensive — controller emits drag
 * only between beginDrag and endDrag).
 */
export const drag =
  ({ delta, modifiers }: { delta: number; modifiers: { alt: boolean } }) =>
  (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState()
    const handle = state.gesture.activeHandle
    if (!handle) return
    dispatch(setGestureModifiers(modifiers))
    dispatch(setCumulativeDelta(delta))
    const profile = lookupProfile(handle)
    if (!profile) return
    const ctx = profileContextFromState(getState())
    for (const op of profile.onDrag(handle, delta, ctx)) {
      dispatchPipelinedReplay(dispatch, getState, op)
    }
  }

/**
 * End a drag cleanly. Clears the active handle (so gesture-scoped
 * constraints vanish from the next graph build) and ends the drag
 * (clears preDrag). Idempotent.
 */
export const endDrag = () => (dispatch: AppDispatch) => {
  dispatch(clearGesture())
  dispatch(dragEnd())
}

/**
 * Restore pre-drag state by restoring the slice snapshot captured at drag start
 * (pointercancel / Escape rollback). Dispatching loadAnchors + setRegions
 * atomically reverts all position changes. dragCtxSlice transient state
 * (lasso, snap, anchorLock) is cleared.
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

    // Restore the slice state captured at drag start.
    dispatch(loadAnchors({
      origAnchors: preDrag.origAnchors,
      beatAnchors: preDrag.beatAnchors,
    }))
    dispatch(setRegions(preDrag.regions))

    // Clear ephemeral dragCtx state (legacy — gesture clears below).
    dispatch(clearSnapInstall())
    dispatch(clearAnchorLock())

    // Clear gesture state (active handle, delta, modifiers).
    dispatch(clearGesture())

    // Clear drag state (this fires the history snapshot via dragEnd in the
    // history middleware's trigger list).
    dispatch(dragEnd())
  }

/**
 * Snapshot current slice state for use as preDrag. Called by applyIntents when
 * the controller emits a 'dragStart' intent or beginDrag thunk runs.
 */
export function snapshotPreDragState(state: RootState) {
  return {
    regions: state.region.regions,
    origAnchors: state.warp.origAnchors,
    beatAnchors: state.warp.beatAnchors,
  }
}

/** Build a ProfileContext from the current store state. */
function profileContextFromState(state: RootState): ProfileContext {
  const preDrag = state.drag.preDrag
  return {
    preDrag: preDrag
      ? {
          origAnchors: preDrag.origAnchors,
          beatAnchors: preDrag.beatAnchors,
          regions: preDrag.regions,
        }
      : { origAnchors: [], beatAnchors: [], regions: [] },
    ui: {
      anchorLock: state.ui.anchorLock ?? false,
      lockMode: state.ui.lockMode ?? 'bpm',
    },
    modifiers: state.gesture.modifiers,
  }
}

// Quiet the unused-import warning for clearLasso (kept exported re-export
// path in case callers need it — historic API surface).
void clearLasso
