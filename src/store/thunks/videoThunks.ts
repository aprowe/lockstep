import { createAsyncThunk } from "@reduxjs/toolkit";
import type { RootState } from "../store";
import type { SavedVideoState, Region } from "../../types";
import { openVideo, openFolder, loadVideoFromPath, listFolderVideos } from "../../api/video";
import {
    checkVideoSidecar,
    deleteVideoSidecar,
    openJsonFile as openJsonFileApi,
    loadLlcProject,
} from "../../api/warp";
import {
    setVideo,
    clearVideo,
    setFolderVideos,
    setMarkerCount,
    setClipCount,
    setMarkersLoaded,
} from "../slices/videoSlice";
import {
    loadAnchors,
    clearAnchors,
    setBpm,
    setMinStretch,
    setMaxStretch,
    setGlobalMarkers,
    setPlayhead,
    bumpAnchorIdCounter,
} from "../slices/warpSlice";
import { setRegions, setActiveRegionId } from "../slices/regionSlice";
import { loadCached as loadCachedScenes, setMinGap as setSceneMinGap } from "../slices/sceneSlice";
import { resetHistory, pushSnapshot } from "../slices/historySlice";
import type { HistoryEntry } from "../slices/historySlice";
import { snapshotFromState } from "../middleware/historyMiddleware";
import { setView } from "../slices/uiSlice";

/** Read and parse the JSON sidecar for `videoPath`, or null when absent. */
async function loadMarkersForVideo(videoPath: string): Promise<SavedVideoState | null> {
    try {
        const content = await checkVideoSidecar(videoPath);
        if (content) return JSON.parse(content) as SavedVideoState;
    } catch {
        /* sidecar unreadable */
    }
    return null;
}

/**
 * Show the native file picker and load the chosen video. Clears any prior
 * folder state, resets anchors/regions/playhead, then applies the sidecar
 * (if one exists) and pushes a fresh history snapshot.
 */
export const openFileThunk = createAsyncThunk(
    "video/openFile",
    async (_, { dispatch, getState }) => {
        try {
            const info = await openVideo();
            if (!info) return;
            const preLoadEntry: HistoryEntry = snapshotFromState(getState() as RootState);
            dispatch(setFolderVideos([]));
            dispatch(setVideo(info));
            dispatch(setView({ start: 0, end: info.duration }));
            dispatch(clearAnchors());
            dispatch(setPlayhead(0));
            dispatch(setActiveRegionId(null));
            dispatch(setMarkersLoaded(false));

            const state = await loadMarkersForVideo(info.path);
            applyLoadedState(dispatch, getState, state, info.path, preLoadEntry);
        } catch (e: unknown) {
            console.error("Failed to open file:", e);
        }
    },
);

/**
 * Show the native folder picker, list the videos inside, and populate the
 * sidebar. Reads each video's sidecar to seed the marker/clip count badges.
 */
export const openFolderThunk = createAsyncThunk("video/openFolder", async (_, { dispatch }) => {
    try {
        const entries = await openFolder();
        if (entries === null) return;
        dispatch(setFolderVideos(entries));
        dispatch(clearVideo());
        dispatch(clearAnchors());
        dispatch(setPlayhead(0));
        dispatch(setActiveRegionId(null));
        dispatch(setRegions([]));
        dispatch(setMarkerCount({}));
        dispatch(setClipCount({}));
        // Load marker and clip counts for sidebar badges
        for (const entry of entries) {
            try {
                const content = await checkVideoSidecar(entry.path);
                const state: SavedVideoState | null = content ? JSON.parse(content) : null;
                const count = state?.defaultRegion?.origAnchors?.length ?? 0;
                dispatch({ type: "video/updateMarkerCount", payload: { path: entry.path, count } });
                const clipCount = state?.regions?.length ?? 0;
                dispatch({
                    type: "video/updateClipCount",
                    payload: { path: entry.path, count: clipCount },
                });
            } catch {
                // Per-entry sidecar read failure — leave count at 0, keep going.
            }
        }
    } catch (e: unknown) {
        console.error("Failed to open folder:", e);
    }
});

/** Same as `openFolderThunk` but takes an explicit folder path (e.g. from
 *  a drag-and-drop event) instead of showing a picker. */
export const loadFolderFromPathThunk = createAsyncThunk(
    "video/loadFolderFromPath",
    async (path: string, { dispatch }) => {
        try {
            const entries = await listFolderVideos(path);
            dispatch(setFolderVideos(entries));
            dispatch(clearVideo());
            dispatch(clearAnchors());
            dispatch(setPlayhead(0));
            dispatch(setActiveRegionId(null));
            dispatch(setRegions([]));
            dispatch(setMarkerCount({}));
            dispatch(setClipCount({}));
            for (const entry of entries) {
                try {
                    const content = await checkVideoSidecar(entry.path);
                    const state: SavedVideoState | null = content ? JSON.parse(content) : null;
                    const count = state?.defaultRegion?.origAnchors?.length ?? 0;
                    dispatch({
                        type: "video/updateMarkerCount",
                        payload: { path: entry.path, count },
                    });
                    const clipCount = state?.regions?.length ?? 0;
                    dispatch({
                        type: "video/updateClipCount",
                        payload: { path: entry.path, count: clipCount },
                    });
                } catch {
                    // Per-entry sidecar read failure — leave counts at 0, keep going.
                }
            }
        } catch (e: unknown) {
            console.error("Failed to load folder from path:", e);
        }
    },
);

/** Load the video at `path` (used when the user clicks a row in the folder
 *  sidebar). Resets anchors/regions/playhead, then applies the sidecar. */
export const selectVideoThunk = createAsyncThunk(
    "video/selectVideo",
    async (path: string, { dispatch, getState }) => {
        try {
            const preLoadEntry: HistoryEntry = snapshotFromState(getState() as RootState);
            const info = await loadVideoFromPath(path);
            dispatch(setVideo(info));
            dispatch(setView({ start: 0, end: info.duration }));
            dispatch(clearAnchors());
            dispatch(setPlayhead(0));
            dispatch(setActiveRegionId(null));
            dispatch(setMarkersLoaded(false));

            const state = await loadMarkersForVideo(info.path);
            applyLoadedState(dispatch, getState, state, info.path, preLoadEntry);
        } catch (e: unknown) {
            console.error("Failed to select video:", e);
        }
    },
);

/** Tear down the loaded video and clear all derived state. */
export const closeVideoThunk = createAsyncThunk("video/closeVideo", async (_, { dispatch }) => {
    dispatch(clearVideo());
    dispatch(clearAnchors());
    dispatch(setPlayhead(0));
    dispatch(setActiveRegionId(null));
    dispatch(setRegions([]));
    dispatch(setGlobalMarkers(null));
});

/** Wipe all anchors and regions for the active video and delete its sidecar. */
export const resetVideoDataThunk = createAsyncThunk(
    "video/resetVideoData",
    async (_, { dispatch, getState }) => {
        const state = getState() as RootState;
        const vid = state.video.video;
        if (!vid) return;

        dispatch(clearAnchors());
        dispatch(setRegions([]));
        dispatch(setActiveRegionId(null));
        dispatch(setGlobalMarkers(null));

        const _emptyState: SavedVideoState = {
            version: 1,
            defaultRegion: {
                origAnchors: [],
                beatAnchors: [],
                bpm: 120,
                minStretch: 0.5,
                maxStretch: 2.0,
            },
            regions: [],
        };
        try {
            await deleteVideoSidecar(vid.path);
        } catch {
            // No sidecar to delete (already gone or never existed) — fine.
        }
    },
);

/** Open a standalone sidecar JSON file and apply its markers to the currently
 *  loaded video. The backend owns the file picker and parsing; no video switch. */
export const openJsonFileThunk = createAsyncThunk(
    "video/openJsonFile",
    async (_, { dispatch, getState }) => {
        try {
            const vid = (getState() as RootState).video.video;
            if (!vid) return;
            const preLoadEntry: HistoryEntry = snapshotFromState(getState() as RootState);
            const savedState = await openJsonFileApi();
            dispatch(clearAnchors());
            dispatch(setPlayhead(0));
            dispatch(setActiveRegionId(null));
            dispatch(setMarkersLoaded(false));
            applyLoadedState(dispatch, getState, savedState, vid.path, preLoadEntry);
        } catch (e: unknown) {
            console.error("Failed to open JSON file:", e);
        }
    },
);

/**
 * Load a LosslessCut (.llc) project — parse it, load the referenced video,
 * then overwrite the region list with the file's cutSegments. No .llc state
 * is persisted on our side; the regions flow into the normal sidecar on
 * subsequent edits.
 */
export const openLlcProjectThunk = createAsyncThunk(
    "video/openLlcProject",
    async (llcPath: string, { dispatch, getState }) => {
        try {
            const { videoPath, cutSegments } = await loadLlcProject(llcPath);
            const preLoadEntry: HistoryEntry = snapshotFromState(getState() as RootState);
            const info = await loadVideoFromPath(videoPath);
            dispatch(setVideo(info));
            dispatch(setView({ start: 0, end: info.duration }));
            dispatch(clearAnchors());
            dispatch(setPlayhead(0));
            dispatch(setActiveRegionId(null));
            dispatch(setMarkersLoaded(false));

            // Apply any pre-existing sidecar state first (so the user keeps their
            // anchors / default-region settings), then override regions with the
            // .llc segments.
            const savedState = await loadMarkersForVideo(info.path);
            applyLoadedState(dispatch, getState, savedState, info.path, preLoadEntry);

            const bpm = (getState() as RootState).warp.bpm;
            const regions: Region[] = cutSegments.map((s, i) => ({
                id: `region_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 5)}`,
                name: s.name || `Clip ${i + 1}`,
                inPoint: s.start,
                outPoint: s.end,
                inBeatTime: s.start,
                outBeatTime: s.end,
                defaultLinked: true,
                bpm,
                minStretch: 0.5,
                maxStretch: 2.0,
            }));
            dispatch(setRegions(regions));
            dispatch(setActiveRegionId(null));
        } catch (e: unknown) {
            console.error("Failed to open .llc project:", e);
        }
    },
);

/**
 * Hydrate the store from a parsed `SavedVideoState`. Seeds warp settings,
 * anchors, regions, and cached scene cuts, then resets the history stack
 * so the loaded state is the new base entry.
 */
function applyLoadedState(
    dispatch: (action: unknown) => void,
    getState: () => unknown,
    state: SavedVideoState | null,
    videoPath: string,
    preLoadEntry: HistoryEntry,
) {
    const dr = state?.defaultRegion ?? null;
    dispatch(setGlobalMarkers(dr));

    if (dr) {
        const orig = dr.origAnchors ?? [];
        const beat = dr.beatAnchors ?? [];
        bumpAnchorIdCounter(orig);
        bumpAnchorIdCounter(beat);
        dispatch(loadAnchors({ origAnchors: orig, beatAnchors: beat }));
        dispatch(setBpm(dr.bpm ?? 120));
        dispatch(setMinStretch(dr.minStretch ?? 0.5));
        dispatch(setMaxStretch(dr.maxStretch ?? 2.0));
    }

    // Normalize incoming regions — `setRegions` backfills missing fields, but
    // we also coerce here so the `??` defaults below fill any holes the
    // sidecar JSON happens to have. The `any` cast tolerates partial payloads.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loadedRegions: Region[] = (state?.regions ?? []).map((r: any) => ({
        id: r.id,
        name: r.name,
        inPoint: r.inPoint,
        outPoint: r.outPoint,
        inBeatTime: r.inBeatTime ?? r.inPoint,
        outBeatTime: r.outBeatTime ?? r.outPoint,
        defaultLinked: r.defaultLinked ?? true,
        bpm: r.bpm ?? 120,
        minStretch: r.minStretch ?? 0.5,
        maxStretch: r.maxStretch ?? 2.0,
    }));
    dispatch(setRegions(loadedRegions));
    dispatch(setActiveRegionId(null));
    dispatch(setMarkersLoaded(true));

    // Restore cached scene cuts so we don't have to re-run ffmpeg scdet.
    if (state?.scenes && Array.isArray(state.scenes.cuts)) {
        dispatch(
            loadCachedScenes({
                path: videoPath,
                cuts: state.scenes.cuts,
                threshold: state.scenes.threshold,
                userCuts: Array.isArray(state.scenes.userCuts) ? state.scenes.userCuts : undefined,
            }),
        );
    }
    // minGap is independent of cuts — restore even when no cuts have been
    // detected yet, so a freshly opened video keeps the user's preferred gap.
    if (typeof state?.scenes?.minGap === "number") {
        dispatch(setSceneMinGap({ path: videoPath, minGap: state.scenes.minGap }));
    }

    // Set history: pre-load state as base so undo can revert the load,
    // then push the loaded state on top as the current entry
    dispatch(resetHistory(preLoadEntry));
    dispatch(pushSnapshot(snapshotFromState(getState() as RootState)));

    // Update marker count
    const count = dr?.origAnchors?.length ?? 0;
    dispatch({ type: "video/updateMarkerCount", payload: { path: videoPath, count } });
}
