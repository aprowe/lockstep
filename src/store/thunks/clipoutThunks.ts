import type { RootState, AppDispatch } from "../store";
import { applyConformedClipout } from "../slices/regionSlice";
import { setAnchorLockGestureOverride } from "../slices/uiSlice";
import { regionOutId } from "../../constraints/ids";
import { OpKind } from "../../constraints/types";
import { dispatchPipelinedReplay } from "../../constraints/pipelineDispatch";

/**
 * Commit a clipout edge resize.
 *
 * Always dispatches `applyConformedClipout` with the new beat-space bounds.
 * Anchor-lock + lock='beats' rescaling of inner anchors is handled by the
 * ScaleGroup constraint emitted by `buildGraphFromSlice` — the resolver
 * propagates it as the clipout edge moves. Conformed-marker carry is
 * handled structurally by the MirrorPair binding auto-installed when a
 * clipout edge coincides with a beat anchor.
 */
export const commitClipoutResize =
    (payload: { id: string; inBeatTime: number; outBeatTime: number; altKey: boolean }) =>
    (dispatch: AppDispatch, getState: () => RootState) => {
        const state = getState();
        const region = state.region.regions.find((r) => r.id === payload.id);
        if (!region) return;

        const inputAnchors = state.warp.origAnchors;
        const beatAnchors = state.warp.beatAnchors;

        // Alt inverts `ui.anchorLock` for this gesture only (XOR override).
        // Dispatch the override BEFORE the resize ops so the next pipeline
        // build sees the effective lock when it emits anchor-lock constraints.
        if (payload.altKey) {
            dispatch(setAnchorLockGestureOverride(!state.ui.anchorLock));
        }

        dispatch(
            applyConformedClipout({
                id: payload.id,
                inBeatTime: payload.inBeatTime,
                outBeatTime: payload.outBeatTime,
                origAnchors: inputAnchors,
                beatAnchors,
            }),
        );

        // Clear the gesture override after the operation completes.
        if (payload.altKey) {
            dispatch(setAnchorLockGestureOverride(null));
        }
    };

/**
 * Commit a clipout body pan (region translated, length unchanged).
 *
 * Always dispatches `applyConformedClipout` with the new beat-space bounds.
 * Inner-anchor translation (when anchor-lock is on) is handled by the
 * TranslateGroup constraint emitted by `buildGraphFromSlice` — the
 * resolver propagates it as the clipout entity moves. Conformed-marker
 * carry is handled structurally by the MirrorPair binding auto-installed
 * when a clipout edge coincides with a beat anchor.
 *
 * Accepts either absolute (`inBeatTime` / `outBeatTime`) or delta-based
 * payloads. Delta payloads compute against the PRE-DRAG region bounds so
 * repeated dispatches during a single drag converge instead of compounding.
 */
export const commitClipoutPan =
    (
        payload:
            | { id: string; inBeatTime: number; outBeatTime: number; altKey: boolean }
            | { id: string; delta: number; altKey: boolean },
    ) =>
    (dispatch: AppDispatch, getState: () => RootState) => {
        const state = getState();
        const region = state.region.regions.find((r) => r.id === payload.id);
        if (!region) return;

        const inputAnchors = state.warp.origAnchors;
        const beatAnchors = state.warp.beatAnchors;

        // Pre-drag snapshot for delta-based resolution only.
        const preDragRegion =
            state.drag.preDrag?.regions.find((r) => r.id === payload.id) ?? region;

        // Resolve the absolute target. Delta payloads compute against the
        // PRE-DRAG region bounds (see header comment); absolute payloads are
        // used as-is.
        let inBeatTime: number;
        let outBeatTime: number;
        if ("delta" in payload) {
            inBeatTime = preDragRegion.inBeatTime + payload.delta;
            outBeatTime = preDragRegion.outBeatTime + payload.delta;
        } else {
            inBeatTime = payload.inBeatTime;
            outBeatTime = payload.outBeatTime;
        }

        // Alt inverts `ui.anchorLock` for this gesture only (XOR override).
        // Dispatch the override BEFORE the pan ops so the next pipeline build
        // sees the effective lock when it emits anchor-lock constraints.
        if (payload.altKey) {
            dispatch(setAnchorLockGestureOverride(!state.ui.anchorLock));
        }

        // Replay-drag invariant: Move clipout by the cumulative delta vs the
        // preDrag baseline. `dispatchPipelinedReplay` rebuilds the pipeline
        // slice from preDrag and runs the Move against it, so each frame is
        // a pure function of (preDrag, cumulativeDelta).
        const cumulativeDelta = inBeatTime - preDragRegion.inBeatTime;
        if (Math.abs(cumulativeDelta) > 1e-9) {
            dispatchPipelinedReplay(dispatch, getState, {
                kind: OpKind.Move,
                id: regionOutId(payload.id),
                delta: cumulativeDelta,
            });
        }

        // Re-read post-Move values from the slice so applyConformedClipout's
        // SetEdge ops use the (snap-restricted) result of the Move, not the
        // raw target.
        const postMoveState = getState();
        const postMoveRegion = postMoveState.region.regions.find((r) => r.id === payload.id);
        const finalInBeatTime = postMoveRegion?.inBeatTime ?? inBeatTime;
        const finalOutBeatTime = postMoveRegion?.outBeatTime ?? outBeatTime;

        dispatch(
            applyConformedClipout({
                id: payload.id,
                inBeatTime: finalInBeatTime,
                outBeatTime: finalOutBeatTime,
                origAnchors: inputAnchors,
                beatAnchors,
            }),
        );

        // Clear the gesture override after the operation completes.
        if (payload.altKey) {
            dispatch(setAnchorLockGestureOverride(null));
        }
    };
