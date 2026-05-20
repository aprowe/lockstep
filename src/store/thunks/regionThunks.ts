import type { RootState, AppDispatch } from "../store";
import {
    addRegion as addRegionAction,
    deleteRegion as deleteRegionAction,
    setActiveRegionId as setActiveRegionIdAction,
    updateRegionInOut as updateRegionInOutAction,
    updateRegionBeatTimes as updateRegionBeatTimesAction,
} from "../slices/regionSlice";
import {
    setOrigAnchorsFromTimeline,
    setBeatAnchorsFromTimeline,
    removeAnchors as removeAnchorsAction,
    setSelectedOrigIds as setSelectedOrigIdsAction,
    setSelectedBeatIds as setSelectedBeatIdsAction,
} from "../slices/warpSlice";
import {
    deleteCut as deleteSceneCutAction,
    setSelectedCutTimes as setSelectedSceneCutTimesAction,
} from "../slices/sceneSlice";
import { setListSelection } from "../slices/listsSlice";
import { calcNewRegionBoundsUpToNext } from "../../timeline/model/newRegionBounds";
import type { Anchor } from "../../types";

// ── moveAnchors ───────────────────────────────────────────────────────────────

/** Commit an input-anchor change. Conform is purely visual — no linking-event
 *  commits fire here. Coincidence detection still runs in the projector for
 *  rendering; no inBeatTime/outBeatTime is written until the user directly
 *  interacts with the clipout (resize or pan). */
export const moveAnchors = (nextOrigAnchors: Anchor[]) => (dispatch: AppDispatch) => {
    dispatch(setOrigAnchorsFromTimeline(nextOrigAnchors));
};

// ── moveBeatAnchors ───────────────────────────────────────────────────────────

/** Commit a beat-anchor change. Conform is purely visual — no linking-event
 *  commits fire here. Coincidence detection still runs in the projector for
 *  rendering; no inBeatTime/outBeatTime is written until the user directly
 *  interacts with the clipout (resize or pan). */
export const moveBeatAnchors = (nextBeatAnchors: Anchor[]) => (dispatch: AppDispatch) => {
    dispatch(setBeatAnchorsFromTimeline(nextBeatAnchors));
};

// ── moveRegionBounds ──────────────────────────────────────────────────────────

interface MoveRegionBoundsPayload {
    id: string;
    inPoint: number;
    outPoint: number;
    /** Optional — retained for call-site compatibility. */
    altKey?: boolean;
}

/**
 * Move a region's input-space bounds. Conform is purely visual — no
 * linking-event commits fire here. inBeatTime/outBeatTime are only written
 * when the user directly interacts with the clipout (resize or pan via
 * commitClipoutResize / commitClipoutPan).
 *
 * Used by: clipin EDGE (resize) drags and toolbar set-in/out actions.
 * For clipin BODY (pan) drags use `panClipinBounds` so the clipout follows.
 */
export const moveRegionBounds =
    (payload: MoveRegionBoundsPayload) => (dispatch: AppDispatch, getState: () => RootState) => {
        const state = getState();
        const region = state.region.regions.find((r) => r.id === payload.id);
        if (!region) return;
        dispatch(updateRegionInOutAction(payload));
    };

/**
 * Pan a region's input-space bounds (body drag — length preserved).
 *
 * Unlike `moveRegionBounds` (used for edge resize), this also translates
 * inBeatTime/outBeatTime by the same delta so the clipout follows the
 * clipin when the user body-drags the clipin. When the region is
 * default-linked (no explicit beat bounds), they stay undefined — the
 * clipout renders linked to the new input bounds automatically.
 *
 * Inner-anchor translation (when anchor-lock is on) is now handled by the
 * TranslateGroup constraint emitted by anchorLockMirrorMiddleware — the resolver
 * propagates it automatically when the clipout entity moves.
 */
export const panClipinBounds =
    (payload: MoveRegionBoundsPayload) => (dispatch: AppDispatch, getState: () => RootState) => {
        const state = getState();
        const region = state.region.regions.find((r) => r.id === payload.id);
        if (!region) return;

        // Frame-to-frame delta for the region + beat-time updates (incremental).
        const frameDelta = payload.inPoint - region.inPoint;

        dispatch(updateRegionInOutAction(payload));

        // Only translate explicit beat-space bounds (diverged state).
        // Default-linked regions stay linked and automatically track the new
        // input position via the DirectedPair constraint.
        if (!region.defaultLinked) {
            dispatch(
                updateRegionBeatTimesAction({
                    id: payload.id,
                    inBeatTime: region.inBeatTime + frameDelta,
                    outBeatTime: region.outBeatTime + frameDelta,
                }),
            );
        }
    };

/** Build a fresh Region payload — mirrors the inline construction in CenterColumn.addRegion(). */
function makeFreshRegion(inPoint: number, outPoint: number, bpm: number, regionCount: number) {
    const id = `region_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    return {
        id,
        name: `Clip ${regionCount + 1}`,
        inPoint,
        outPoint,
        inBeatTime: inPoint,
        outBeatTime: outPoint,
        defaultLinked: true,
        bpm,
        minStretch: 0.5,
        maxStretch: 2.0,
    };
}

export interface PlayheadBoundsPayload {
    playhead: number;
    viewSpan: number;
    duration: number;
}

/**
 * Toolbar "Set In Point" action.
 *
 * Three-way decision (mirrors CenterColumn.onSetIn):
 * 1. No active region → create new region from playhead to duration.
 * 2. Active region AND playhead > activeRegion.outPoint → spawn a new region
 *    (would invert in/out — make a fresh one instead).
 * 3. Otherwise → updateRegionInOut on the active region with inPoint=playhead.
 *    Also fires input-side linking-event detection (§5a / §3.2).
 */
export const setInPointToPlayhead =
    ({ playhead, viewSpan, duration }: PlayheadBoundsPayload) =>
    (dispatch: AppDispatch, getState: () => RootState) => {
        const state = getState();
        const activeRegion = state.region.activeRegionId
            ? state.region.regions.find((r) => r.id === state.region.activeRegionId)
            : undefined;

        if (!activeRegion) {
            const region = makeFreshRegion(
                playhead,
                duration,
                state.warp.bpm ?? 120,
                state.region.regions.length,
            );
            dispatch(addRegionAction(region));
            // addRegion slice action sets activeRegionId automatically
            return;
        }

        if (playhead > activeRegion.outPoint) {
            const { inPoint, outPoint } = calcNewRegionBoundsUpToNext(
                playhead,
                viewSpan,
                state.region.regions,
                duration,
            );
            const region = makeFreshRegion(
                inPoint,
                outPoint,
                state.warp.bpm ?? 120,
                state.region.regions.length,
            );
            dispatch(addRegionAction(region));
            dispatch(setActiveRegionIdAction(region.id));
            return;
        }

        // Resize active region's in-edge to playhead, then detect input-side links.
        dispatch(
            moveRegionBounds({
                id: activeRegion.id,
                inPoint: playhead,
                outPoint: activeRegion.outPoint,
            }),
        );
    };

/**
 * Toolbar "Set Out Point" action.
 *
 * Three-way decision (mirrors CenterColumn.onSetOut):
 * 1. No active region → create new region from 0 to max(playhead, 0.1).
 * 2. Active region AND playhead < activeRegion.inPoint → spawn a new region
 *    (would invert out/in — make a fresh one instead).
 * 3. Otherwise → updateRegionInOut on the active region with outPoint=playhead.
 *    Also fires input-side linking-event detection (§5a / §3.2).
 */
export const setOutPointToPlayhead =
    ({ playhead, viewSpan, duration }: PlayheadBoundsPayload) =>
    (dispatch: AppDispatch, getState: () => RootState) => {
        const state = getState();
        const activeRegion = state.region.activeRegionId
            ? state.region.regions.find((r) => r.id === state.region.activeRegionId)
            : undefined;

        if (!activeRegion) {
            const region = makeFreshRegion(
                0,
                Math.max(playhead, 0.1),
                state.warp.bpm ?? 120,
                state.region.regions.length,
            );
            dispatch(addRegionAction(region));
            // addRegion slice action sets activeRegionId automatically
            return;
        }

        if (playhead < activeRegion.inPoint) {
            const { inPoint, outPoint } = calcNewRegionBoundsUpToNext(
                playhead,
                viewSpan,
                state.region.regions,
                duration,
            );
            const region = makeFreshRegion(
                inPoint,
                outPoint,
                state.warp.bpm ?? 120,
                state.region.regions.length,
            );
            dispatch(addRegionAction(region));
            dispatch(setActiveRegionIdAction(region.id));
            return;
        }

        // Resize active region's out-edge to playhead, then detect input-side links.
        dispatch(
            moveRegionBounds({
                id: activeRegion.id,
                inPoint: activeRegion.inPoint,
                outPoint: playhead,
            }),
        );
    };

// ── deleteTimelineSelection ───────────────────────────────────────────────────

/**
 * Delete every selected entity on the timeline: clips, anchors, scene cuts.
 * Single dispatch surface so component handlers and test harnesses converge.
 */
export const deleteTimelineSelection = () => (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState();
    // Delete uses the union of both clip spaces (any region selected in either space).
    const clipIds = [
        ...new Set([...state.lists.selection.clipin, ...state.lists.selection.clipout]),
    ];
    // Delete uses the union of both spaces (any selected anchor in either space).
    const anchorIds = [...new Set([...state.warp.selectedOrigIds, ...state.warp.selectedBeatIds])];
    const sceneCutTimes = state.scene.selectedCutTimes;
    const videoPath = state.video.video?.path ?? null;

    if (clipIds.length > 0) {
        for (const id of clipIds) dispatch(deleteRegionAction(id));
        dispatch(setListSelection({ list: "clipin", ids: [] }));
        dispatch(setListSelection({ list: "clipout", ids: [] }));
    }
    if (anchorIds.length > 0) {
        dispatch(removeAnchorsAction([...anchorIds]));
        dispatch(setSelectedOrigIdsAction([]));
        dispatch(setSelectedBeatIdsAction([]));
    }
    if (sceneCutTimes.length > 0 && videoPath) {
        for (const t of sceneCutTimes) {
            dispatch(deleteSceneCutAction({ path: videoPath, cut: t }));
        }
        // deleteCut already drops matching entries from selectedCutTimes,
        // but call setSelectedCutTimes([]) to be explicit and clear in one go.
        dispatch(setSelectedSceneCutTimesAction([]));
    }
};

// ── deselectTimelineSelection ─────────────────────────────────────────────────

/**
 * Clear every selection set on the timeline (clips, anchors, scene cuts).
 * Corresponds to Cmd+D and empty-area click (Policy B).
 */
export const deselectTimelineSelection =
    () => (dispatch: AppDispatch, getState: () => RootState) => {
        const state = getState();
        if (state.lists.selection.clipin.length > 0) {
            dispatch(setListSelection({ list: "clipin", ids: [] }));
        }
        if (state.lists.selection.clipout.length > 0) {
            dispatch(setListSelection({ list: "clipout", ids: [] }));
        }
        if (state.warp.selectedOrigIds.length > 0 || state.warp.selectedBeatIds.length > 0) {
            dispatch(setSelectedOrigIdsAction([]));
            dispatch(setSelectedBeatIdsAction([]));
        }
        if (state.scene.selectedCutTimes.length > 0) {
            dispatch(setSelectedSceneCutTimesAction([]));
        }
    };
