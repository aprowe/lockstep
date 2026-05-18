import type { RootState, AppDispatch } from '../store'
import { applyConformedClipout } from '../slices/regionSlice'
import { setAnchorLockGestureOverride } from '../slices/uiSlice'
import { regionOutId } from '../../constraints/ids'
import { OpKind } from '../../constraints/types'
import { dispatchPipelinedReplay } from '../../constraints/pipelineDispatch'

/**
 * Commit a clipout RESIZE — edge dragged.
 *
 * - Always: applyConformedClipout({ id, inBeatTime, outBeatTime }).
 *
 * Inner-anchor rescale (when anchor-lock + lock='beats') is now handled by the
 * ScaleGroup constraint emitted by anchorLockMirrorMiddleware — the resolver
 * propagates it automatically when the clipout entity edges move.
 *
 * Conformed-marker carry is handled structurally: the MirrorPair binding
 * auto-installed by buildGraphFromSlice on positional coincidence propagates
 * clipout-edge writes to the paired beat anchor automatically.
 */
export const commitClipoutResize =
  (payload: { id: string; inBeatTime: number; outBeatTime: number; altKey: boolean }) =>
  (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState()
    const region = state.region.regions.find(r => r.id === payload.id)
    if (!region) return

    const inputAnchors = state.warp.origAnchors
    const beatAnchors = state.warp.beatAnchors

    // Alt key inverts ui.anchorLock for this gesture only (XOR-style override).
    // Dispatch the override BEFORE the resize ops so anchorLockMirrorMiddleware
    // sees the effective lock when it re-emits graph constraints.
    if (payload.altKey) {
      dispatch(setAnchorLockGestureOverride(!state.ui.anchorLock))
    }

    dispatch(applyConformedClipout({
      id: payload.id,
      inBeatTime: payload.inBeatTime,
      outBeatTime: payload.outBeatTime,
      origAnchors: inputAnchors,
      beatAnchors,
    }))

    // Clear the gesture override after the operation completes.
    if (payload.altKey) {
      dispatch(setAnchorLockGestureOverride(null))
    }
  }

/**
 * Commit a clipout BODY PAN — region body translated. Length unchanged.
 *
 * - Always: applyConformedClipout({ id, inBeatTime, outBeatTime }).
 *
 * Inner-anchor translation (when anchor-lock is on) is now handled by the
 * TranslateGroup constraint emitted by anchorLockMirrorMiddleware — the resolver
 * propagates it automatically when the clipout entity moves.
 *
 * Conformed-marker carry is handled structurally: the MirrorPair binding
 * auto-installed by buildGraphFromSlice on positional coincidence propagates
 * clipout-edge writes (and body translates) to paired beat anchors.
 */
export const commitClipoutPan =
  (payload:
    | { id: string; inBeatTime: number; outBeatTime: number; altKey: boolean }
    | { id: string; delta: number; altKey: boolean }
  ) =>
  (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState()
    const region = state.region.regions.find(r => r.id === payload.id)
    if (!region) return

    const inputAnchors = state.warp.origAnchors
    const beatAnchors = state.warp.beatAnchors

    // Pre-drag snapshot for delta-based resolution only.
    const preDragRegion = state.drag.preDrag?.regions.find(r => r.id === payload.id) ?? region

    // Resolve the absolute target. Delta-based payloads compute against the
    // PRE-DRAG region bounds — repeated dispatches during a single drag
    // (live pointerMove + pointerUp commit) converge to the same final
    // position instead of compounding. Absolute payloads are used as-is.
    let inBeatTime: number
    let outBeatTime: number
    if ('delta' in payload) {
      inBeatTime  = preDragRegion.inBeatTime  + payload.delta
      outBeatTime = preDragRegion.outBeatTime + payload.delta
    } else {
      inBeatTime  = payload.inBeatTime
      outBeatTime = payload.outBeatTime
    }

    // Alt key inverts ui.anchorLock for this gesture only (XOR-style override).
    // Dispatch the override BEFORE the pan ops so anchorLockMirrorMiddleware
    // sees the effective lock when it re-emits graph constraints.
    if (payload.altKey) {
      dispatch(setAnchorLockGestureOverride(!state.ui.anchorLock))
    }

    // Absolute-replay drag: Move clipout by the absolute delta vs preDrag.
    // dispatchPipelinedReplay rebuilds the pipeline slice from preDrag and
    // runs the Move against that baseline — so each frame is a pure function
    // of (preDrag, cumulativeDelta), no state carrying from prior frames.
    const cumulativeDelta = inBeatTime - preDragRegion.inBeatTime
    if (Math.abs(cumulativeDelta) > 1e-9) {
      dispatchPipelinedReplay(dispatch, getState,
        { kind: OpKind.Move, id: regionOutId(payload.id), delta: cumulativeDelta })
    }

    // Re-read post-Move values from the slice so applyConformedClipout's
    // SetEdge ops use the (snap-restricted) result of the Move, not the
    // raw target.
    const postMoveState = getState()
    const postMoveRegion = postMoveState.region.regions.find(r => r.id === payload.id)
    const finalInBeatTime  = postMoveRegion?.inBeatTime  ?? inBeatTime
    const finalOutBeatTime = postMoveRegion?.outBeatTime ?? outBeatTime

    dispatch(applyConformedClipout({
      id: payload.id,
      inBeatTime:  finalInBeatTime,
      outBeatTime: finalOutBeatTime,
      origAnchors: inputAnchors,
      beatAnchors,
    }))

    // Clear the gesture override after the operation completes.
    if (payload.altKey) {
      dispatch(setAnchorLockGestureOverride(null))
    }
  }
