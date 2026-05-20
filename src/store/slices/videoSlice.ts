import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { VideoInfo } from "../../types";
import type { VideoEntry } from "../../api/video";

interface VideoState {
    video: VideoInfo | null;
    folderVideos: VideoEntry[];
    markerCountByPath: Record<string, number>;
    clipCountByPath: Record<string, number>;
    markersLoaded: boolean;
    detectingBpm: boolean;
    recentFiles: string[];
}

const initialState: VideoState = {
    video: null,
    folderVideos: [],
    markerCountByPath: {},
    clipCountByPath: {},
    markersLoaded: false,
    detectingBpm: false,
    recentFiles: [],
};

const videoSlice = createSlice({
    name: "video",
    initialState,
    reducers: {
        setVideo(state, action: PayloadAction<VideoInfo | null>) {
            state.video = action.payload;
        },
        clearVideo(state) {
            state.video = null;
            state.markersLoaded = false;
        },
        setFolderVideos(state, action: PayloadAction<VideoEntry[]>) {
            state.folderVideos = action.payload;
        },
        setMarkerCount(state, action: PayloadAction<Record<string, number>>) {
            state.markerCountByPath = action.payload;
        },
        updateMarkerCount(state, action: PayloadAction<{ path: string; count: number }>) {
            state.markerCountByPath[action.payload.path] = action.payload.count;
        },
        setClipCount(state, action: PayloadAction<Record<string, number>>) {
            state.clipCountByPath = action.payload;
        },
        updateClipCount(state, action: PayloadAction<{ path: string; count: number }>) {
            state.clipCountByPath[action.payload.path] = action.payload.count;
        },
        setMarkersLoaded(state, action: PayloadAction<boolean>) {
            state.markersLoaded = action.payload;
        },
        setDetectingBpm(state, action: PayloadAction<boolean>) {
            state.detectingBpm = action.payload;
        },
        addRecentFile(state, action: PayloadAction<string>) {
            const path = action.payload;
            state.recentFiles = [path, ...state.recentFiles.filter((p) => p !== path)].slice(0, 10);
        },
        clearRecentFiles(state) {
            state.recentFiles = [];
        },
    },
});

export const {
    setVideo,
    clearVideo,
    setFolderVideos,
    setMarkerCount,
    updateMarkerCount,
    setClipCount,
    updateClipCount,
    setMarkersLoaded,
    setDetectingBpm,
    addRecentFile,
    clearRecentFiles,
} = videoSlice.actions;

export default videoSlice.reducer;
