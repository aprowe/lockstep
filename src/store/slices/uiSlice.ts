import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { View } from "../../types";

export type ExportStatus = "idle" | "processing" | "done" | "error";

const TIMELINE_PREFS_KEY = "lockstep.timeline-prefs.v1";

interface TimelinePrefs {
    warpCollapsed: boolean;
    gridDiv: number;
    thumbShow: boolean;
    followDrag: boolean;
    alwaysAnchors: boolean;
    alwaysRegions: boolean;
    alwaysScenes: boolean;
    hiddenTracks: string[];
    /** Per-track height overrides keyed by track id (matching `ALL_TRACKS` in
     *  `timeline/layout.ts`). The sentinel `__minimap__` key carries the
     *  overview band's height. Absent ids fall back to the layout default. */
    rowHeights: Record<string, number>;
}

const DEFAULT_TIMELINE_PREFS: TimelinePrefs = {
    warpCollapsed: false,
    gridDiv: 1,
    thumbShow: false,
    followDrag: true,
    alwaysAnchors: true,
    alwaysRegions: false,
    alwaysScenes: false,
    hiddenTracks: [],
    rowHeights: {},
};

function loadTimelinePrefs(): TimelinePrefs {
    try {
        const raw = localStorage.getItem(TIMELINE_PREFS_KEY);
        if (!raw) return DEFAULT_TIMELINE_PREFS;
        const p = JSON.parse(raw);
        return {
            warpCollapsed:
                typeof p.warpCollapsed === "boolean"
                    ? p.warpCollapsed
                    : DEFAULT_TIMELINE_PREFS.warpCollapsed,
            gridDiv: typeof p.gridDiv === "number" ? p.gridDiv : DEFAULT_TIMELINE_PREFS.gridDiv,
            thumbShow:
                typeof p.thumbShow === "boolean" ? p.thumbShow : DEFAULT_TIMELINE_PREFS.thumbShow,
            followDrag:
                typeof p.followDrag === "boolean"
                    ? p.followDrag
                    : DEFAULT_TIMELINE_PREFS.followDrag,
            alwaysAnchors:
                typeof p.alwaysAnchors === "boolean"
                    ? p.alwaysAnchors
                    : DEFAULT_TIMELINE_PREFS.alwaysAnchors,
            alwaysRegions:
                typeof p.alwaysRegions === "boolean"
                    ? p.alwaysRegions
                    : DEFAULT_TIMELINE_PREFS.alwaysRegions,
            alwaysScenes:
                typeof p.alwaysScenes === "boolean"
                    ? p.alwaysScenes
                    : DEFAULT_TIMELINE_PREFS.alwaysScenes,
            hiddenTracks:
                Array.isArray(p.hiddenTracks) && p.hiddenTracks.every((x: unknown) => typeof x === "string")
                    ? p.hiddenTracks
                    : DEFAULT_TIMELINE_PREFS.hiddenTracks,
            rowHeights:
                p.rowHeights && typeof p.rowHeights === "object" && !Array.isArray(p.rowHeights)
                    ? (Object.fromEntries(
                          Object.entries(p.rowHeights as Record<string, unknown>).filter(
                              (e): e is [string, number] =>
                                  typeof e[1] === "number" && Number.isFinite(e[1]),
                          ),
                      ) as Record<string, number>)
                    : DEFAULT_TIMELINE_PREFS.rowHeights,
        };
    } catch {
        return DEFAULT_TIMELINE_PREFS;
    }
}

function saveTimelinePrefs(state: UiState) {
    try {
        const prefs: TimelinePrefs = {
            warpCollapsed: state.warpCollapsed,
            gridDiv: state.gridDiv,
            thumbShow: state.timelineThumbShow,
            followDrag: state.timelineFollowDrag,
            alwaysAnchors: state.timelineAlwaysAnchors,
            alwaysRegions: state.timelineAlwaysRegions,
            alwaysScenes: state.timelineAlwaysScenes,
            hiddenTracks: state.timelineHiddenTracks,
            rowHeights: state.timelineRowHeights,
        };
        localStorage.setItem(TIMELINE_PREFS_KEY, JSON.stringify(prefs));
    } catch {
        /* storage full or unavailable — best effort */
    }
}

/** What happens when the playhead reaches the end of the active region (or the
 *  full video, when no region is active) during playback:
 *  - `continue` — roll past the boundary (default; matches the prior behavior)
 *  - `stop`     — pause at the boundary
 *  - `loop`     — seek back to the in-point and keep playing
 *
 *  This is a *playback* setting. */
export type PlaybackLoopMode = "continue" | "stop" | "loop";

/** Controls how the video player's playback rate is set during playback:
 *  - `orig`  — native 1× speed (default)
 *  - `beat`  — dynamic rate computed from the current warp segment so that
 *              beat-time progresses at 1× (previews the warped export) */
export type PlaybackMode = "orig" | "beat";

export interface ExportProgressState {
    status: ExportStatus;
    progress: number;
    label: string;
    jobIdx: number;
    totalJobs: number;
    message: string;
    error: string | null;
}

interface UiState {
    timelineHeight: number;
    sidebarWidth: number;
    clipSidebarWidth: number;
    rightWidth: number;
    filmstripHeight: number;
    sidebarCollapsed: boolean;
    /** Hide the warp connector + beats/bars/speed timeline so the source timeline fills the pane. */
    warpCollapsed: boolean;
    gridDiv: number;
    timelineThumbShow: boolean;
    timelineFollowDrag: boolean;
    timelineAlwaysAnchors: boolean;
    timelineAlwaysRegions: boolean;
    timelineAlwaysScenes: boolean;
    /** Track IDs (matching `ALL_TRACKS` in `timeline/layout.ts`) that the user
     *  has hidden from the timeline. Visible = `ALL_TRACKS` minus this set
     *  (after the warp-collapsed filter). */
    timelineHiddenTracks: string[];
    /** Per-row height overrides keyed by track id (and `MINIMAP_KEY` for the
     *  overview band). Absent ids fall back to the layout's preferred height. */
    timelineRowHeights: Record<string, number>;
    /** Global anchor-lock toggle (§13). When true, beat anchors inside the active
     *  clipout window are position-locked: resize (lock='beats') keeps them in
     *  beat-space; body-pan carries them with the clip. Alt inverts this for a
     *  single gesture. */
    anchorLock: boolean;
    /** Transient gesture-scoped override for anchorLock. null = no override (use
     *  anchorLock directly). A boolean value overrides anchorLock for the duration
     *  of the active clipout resize/body-pan gesture — Alt XOR anchorLock.
     *  Cleared to null on pointerUp/cancel. Never persisted. */
    anchorLockGestureOverride: boolean | null;
    playing: boolean;
    /** What playback does at the end of the active clip / video. */
    playbackLoopMode: PlaybackLoopMode;
    /** Whether the video plays at native speed or at the warp-adjusted rate
     *  that previews beat-time playback. */
    playbackMode: PlaybackMode;
    exportOpen: boolean;
    /** Source-of-truth view. WarpView keeps a local copy for high-frequency
     *  gesture updates and syncs back on gesture end. */
    view: View;
    /** Last-used export folder (persists across dialog open/close) */
    lastExportFolder: string | null;
    /** Export progress — survives dialog close so the background export can be
     *  monitored from the top-right progress bar. */
    exportProgress: ExportProgressState;
    /** Global lock mode: whether resizing a clip holds BPM constant ('bpm') or
     *  holds the beat count constant ('beats'). Replaces per-region Region.lock. */
    lockMode: "bpm" | "beats";
}

const initialExportProgress: ExportProgressState = {
    status: "idle",
    progress: 0,
    label: "",
    jobIdx: 0,
    totalJobs: 0,
    message: "",
    error: null,
};

const _prefs = loadTimelinePrefs();

const initialState: UiState = {
    timelineHeight: 372,
    sidebarWidth: 170,
    clipSidebarWidth: 210,
    rightWidth: 280,
    filmstripHeight: 90,
    sidebarCollapsed: false,
    warpCollapsed: _prefs.warpCollapsed,
    gridDiv: _prefs.gridDiv,
    timelineThumbShow: _prefs.thumbShow,
    timelineFollowDrag: _prefs.followDrag,
    timelineAlwaysAnchors: _prefs.alwaysAnchors,
    timelineAlwaysRegions: _prefs.alwaysRegions,
    timelineAlwaysScenes: _prefs.alwaysScenes,
    timelineHiddenTracks: _prefs.hiddenTracks,
    timelineRowHeights: _prefs.rowHeights,
    anchorLock: false,
    anchorLockGestureOverride: null,
    playing: false,
    playbackLoopMode: "continue",
    playbackMode: "orig",
    exportOpen: false,
    view: { start: 0, end: 60 },
    lastExportFolder: null,
    exportProgress: initialExportProgress,
    lockMode: "bpm",
};

const uiSlice = createSlice({
    name: "ui",
    initialState,
    reducers: {
        setTimelineHeight(state, action: PayloadAction<number>) {
            state.timelineHeight = Math.max(0, action.payload);
        },
        setSidebarWidth(state, action: PayloadAction<number>) {
            state.sidebarWidth = Math.max(120, Math.min(320, action.payload));
        },
        setClipSidebarWidth(state, action: PayloadAction<number>) {
            state.clipSidebarWidth = Math.max(120, Math.min(280, action.payload));
        },
        setRightWidth(state, action: PayloadAction<number>) {
            state.rightWidth = Math.max(200, Math.min(480, action.payload));
        },
        setFilmstripHeight(state, action: PayloadAction<number>) {
            state.filmstripHeight = Math.max(50, Math.min(220, action.payload));
        },
        setSidebarCollapsed(state, action: PayloadAction<boolean>) {
            state.sidebarCollapsed = action.payload;
        },
        setWarpCollapsed(state, action: PayloadAction<boolean>) {
            state.warpCollapsed = action.payload;
            saveTimelinePrefs(state);
        },
        setGridDiv(state, action: PayloadAction<number>) {
            state.gridDiv = action.payload;
            saveTimelinePrefs(state);
        },
        setTimelineThumbShow(state, action: PayloadAction<boolean>) {
            state.timelineThumbShow = action.payload;
            saveTimelinePrefs(state);
        },
        setTimelineFollowDrag(state, action: PayloadAction<boolean>) {
            state.timelineFollowDrag = action.payload;
            saveTimelinePrefs(state);
        },
        setTimelineAlwaysAnchors(state, action: PayloadAction<boolean>) {
            state.timelineAlwaysAnchors = action.payload;
            saveTimelinePrefs(state);
        },
        setTimelineAlwaysRegions(state, action: PayloadAction<boolean>) {
            state.timelineAlwaysRegions = action.payload;
            saveTimelinePrefs(state);
        },
        setTimelineAlwaysScenes(state, action: PayloadAction<boolean>) {
            state.timelineAlwaysScenes = action.payload;
            saveTimelinePrefs(state);
        },
        setTimelineHiddenTracks(state, action: PayloadAction<string[]>) {
            state.timelineHiddenTracks = action.payload;
            saveTimelinePrefs(state);
        },
        toggleTimelineTrackVisibility(state, action: PayloadAction<string>) {
            const id = action.payload;
            const set = new Set(state.timelineHiddenTracks);
            if (set.has(id)) set.delete(id);
            else set.add(id);
            state.timelineHiddenTracks = Array.from(set);
            saveTimelinePrefs(state);
        },
        /** Merge a set of row id → height entries into the override map.
         *  Used by the rail-grip drag, which writes two ids (above + below)
         *  in one move. Persists on every drag tick — heavy but bounded. */
        setTimelineRowHeights(state, action: PayloadAction<Record<string, number>>) {
            state.timelineRowHeights = {
                ...state.timelineRowHeights,
                ...action.payload,
            };
            saveTimelinePrefs(state);
        },
        /** Drop a single row's override (restores its layout default). */
        clearTimelineRowHeight(state, action: PayloadAction<string>) {
            if (action.payload in state.timelineRowHeights) {
                const next = { ...state.timelineRowHeights };
                delete next[action.payload];
                state.timelineRowHeights = next;
                saveTimelinePrefs(state);
            }
        },
        /** Drop every row override — restores all rows (including the
         *  overview band) to their layout defaults. */
        resetTimelineRowHeights(state) {
            if (Object.keys(state.timelineRowHeights).length > 0) {
                state.timelineRowHeights = {};
                saveTimelinePrefs(state);
            }
        },
        setAnchorLock(state, action: PayloadAction<boolean>) {
            state.anchorLock = action.payload;
        },
        setAnchorLockGestureOverride(state, action: PayloadAction<boolean | null>) {
            state.anchorLockGestureOverride = action.payload;
        },
        setPlaying(state, action: PayloadAction<boolean>) {
            state.playing = action.payload;
        },
        setPlaybackLoopMode(state, action: PayloadAction<PlaybackLoopMode>) {
            state.playbackLoopMode = action.payload;
        },
        setPlaybackMode(state, action: PayloadAction<PlaybackMode>) {
            state.playbackMode = action.payload;
        },
        setExportOpen(state, action: PayloadAction<boolean>) {
            state.exportOpen = action.payload;
        },
        setView(state, action: PayloadAction<View>) {
            state.view = action.payload;
        },
        setLastExportFolder(state, action: PayloadAction<string | null>) {
            state.lastExportFolder = action.payload;
        },
        setExportProgress(state, action: PayloadAction<Partial<ExportProgressState>>) {
            state.exportProgress = { ...state.exportProgress, ...action.payload };
        },
        resetExportProgress(state) {
            state.exportProgress = { ...initialExportProgress };
        },
        setLockMode(state, action: PayloadAction<"bpm" | "beats">) {
            state.lockMode = action.payload;
        },
    },
});

export const {
    setTimelineHeight,
    setSidebarWidth,
    setClipSidebarWidth,
    setRightWidth,
    setFilmstripHeight,
    setSidebarCollapsed,
    setWarpCollapsed,
    setGridDiv,
    setTimelineThumbShow,
    setTimelineFollowDrag,
    setTimelineAlwaysAnchors,
    setTimelineAlwaysRegions,
    setTimelineAlwaysScenes,
    setTimelineHiddenTracks,
    toggleTimelineTrackVisibility,
    setTimelineRowHeights,
    clearTimelineRowHeight,
    resetTimelineRowHeights,
    setAnchorLock,
    setAnchorLockGestureOverride,
    setPlaying,
    setPlaybackLoopMode,
    setPlaybackMode,
    setExportOpen,
    setView,
    setLastExportFolder,
    setExportProgress,
    resetExportProgress,
    setLockMode,
} = uiSlice.actions;

export default uiSlice.reducer;
