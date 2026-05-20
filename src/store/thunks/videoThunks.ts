import { createAsyncThunk } from "@reduxjs/toolkit";
import type { RootState } from "../store";
import type { SavedVideoState, Region } from "../../types";
import { openVideo, openFolder, loadVideoFromPath, listFolderVideos } from "../../api/video";
import {
    checkVideoSidecar,
    deleteVideoSidecar,
    openJsonFile as openJsonFileApi,
    readJsonSidecarForVideo,
    loadLlcProject,
} from "../../api/warp";
import {
    setVideo,
    clearVideo,
    setFolderVideos,
    setMarkerCount,
    setClipCount,
    setMarkersLoaded,
    setDetectingBpm,
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

async function loadMarkersForVideo(videoPath: string): Promise<SavedVideoState | null> {
    try {
        const content = await checkVideoSidecar(videoPath);
        if (content) return JSON.parse(content) as SavedVideoState;
    } catch {
        /* sidecar unreadable */
    }
    return null;
}

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
        } catch (e: any) {
            console.error("Failed to open file:", e);
        }
    },
);

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
            } catch {}
        }
    } catch (e: any) {
        console.error("Failed to open folder:", e);
    }
});

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
                } catch {}
            }
        } catch (e: any) {
            console.error("Failed to load folder from path:", e);
        }
    },
);

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
        } catch (e: any) {
            console.error("Failed to select video:", e);
        }
    },
);

export const closeVideoThunk = createAsyncThunk("video/closeVideo", async (_, { dispatch }) => {
    dispatch(clearVideo());
    dispatch(clearAnchors());
    dispatch(setPlayhead(0));
    dispatch(setActiveRegionId(null));
    dispatch(setRegions([]));
    dispatch(setGlobalMarkers(null));
});

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

        const emptyState: SavedVideoState = {
            version: 2,
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
        } catch {}
    },
);

/** Open a standalone sidecar JSON file. Backend handles the file picker,
 *  video resolution, and parsing — the thunk receives structured data only. */
export const openJsonFileThunk = createAsyncThunk(
    "video/openJsonFile",
    async (_, { dispatch, getState }) => {
        try {
            const preLoadEntry: HistoryEntry = snapshotFromState(getState() as RootState);
            const { videoInfo: info, savedState } = await openJsonFileApi();
            dispatch(setVideo(info));
            dispatch(setView({ start: 0, end: info.duration }));
            dispatch(clearAnchors());
            dispatch(setPlayhead(0));
            dispatch(setActiveRegionId(null));
            dispatch(setMarkersLoaded(false));
            applyLoadedState(dispatch, getState, savedState, info.path, preLoadEntry);
        } catch (e: any) {
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
        } catch (e: any) {
            console.error("Failed to open .llc project:", e);
        }
    },
);

/** Apply loaded SavedVideoState to Redux */
function applyLoadedState(
    dispatch: any,
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

    // Migrate regions — setRegions backfills missing defaultLinked/inBeatTime/outBeatTime
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
