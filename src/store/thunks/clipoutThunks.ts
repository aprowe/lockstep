import type { RootState, AppDispatch } from '../store'
import { applyConformedClipout } from '../slices/regionSlice'
import { setAnchorLockGestureOverride } from '../slices/uiSlice'
import { regionOutId } from '../../constraints/ids'
import { OpKind } from '../../constraints/types'
import { dispatchPipelined } from '../../constraints/pipelineDispatch'

/**
 * Commit a clipout RESIZE — edge dragged.
 *
 * - Always: applyConformedClipout({ id, inBeatTime, outBeatTime }).
 *
 * Inner-anchor rescale (when anchor-lock + lock='beats') is now handled by the
 * ScaleGroup constraint emitted by anchorLockMirrorMiddleware — the resolver
 * propagates it automatically when the clipout entity edges move.
 *
 * Conformed-marker carry is now handled structurally: the controller installs
 * an ephemeral DirectedPair(MirrorEdge) at pointerDown via recipes.carryStart,
 * so the resolver propagates the carry on every pointerMove automatically.
 * No per-frame carry logic needed here.
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
 * Conformed-marker carry is now handled structurally: the controller installs
 * ephemeral DirectedPair(MirrorEdge) constraints at pointerDown via
 * recipes.carryStart, so the resolver propagates the carry on every pointerMove
 * automatically. No per-frame carry logic needed here.
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

    // Emit a translate-shaped Move op on the clipout entity so the resolver's
    // TranslateGroup (emitted by anchorLockMirrorMiddleware when anchorLock=true
    // or when gesture override is active) propagates the pan delta to inner
    // anchors automatically. Also goes through SnapTarget (body-mode) so the
    // body may snap rigidly to twin/grid targets.
    const delta = inBeatTime - region.inBeatTime
    if (Math.abs(delta) > 1e-9) {
      dispatchPipelined(dispatch, getState, { kind: OpKind.Move, id: regionOutId(payload.id), delta })
    }

    // Re-read post-Move values from the slice so applyConformedClipout's
    // SetEdge ops use the SNAPPED positions (if snap engaged), not the
    // pre-snap target. Without this, those SetEdge ops would overwrite the
    // snap and the body would visibly "pop back" off the snap target.
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
