import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import videoReducer, { setVideo } from "../../../src/store/slices/videoSlice";
import warpReducer, { addAnchor, setPlayhead } from "../../../src/store/slices/warpSlice";
import regionReducer, { addRegion } from "../../../src/store/slices/regionSlice";
import sceneReducer from "../../../src/store/slices/sceneSlice";
import dragReducer from "../../../src/store/slices/dragSlice";
import uiReducer from "../../../src/store/slices/uiSlice";
import settingsReducer from "../../../src/store/slices/settingsSlice";
import thumbnailsReducer from "../../../src/store/slices/thumbnailsSlice";
import type { VideoInfo, Region } from "../../../src/types";
import {
    thumbnailMiddleware,
    __testing,
} from "../../../src/store/middleware/thumbnailMiddleware";

vi.mock("../../../src/api/thumbnails", () => ({
    setThumbnailWants: vi.fn().mockResolvedValue(undefined),
    listenThumbnailReady: vi.fn().mockResolvedValue(() => {}),
    clearThumbnails: vi.fn().mockResolvedValue(undefined),
}));

import { setThumbnailWants } from "../../../src/api/thumbnails";

function makeVideo(overrides: Partial<VideoInfo> = {}): VideoInfo {
    return {
        path: "/v.mp4",
        originalName: "v.mp4",
        videoUrl: "tauri://localhost//v.mp4",
        fps: 30,
        duration: 100,
        fileHash: "h",
        ...overrides,
    };
}

function makeRegion(overrides: Partial<Region> = {}): Region {
    return {
        id: "r1",
        name: "r",
        inPoint: 1,
        outPoint: 2,
        bpm: 120,
        minStretch: 0.5,
        maxStretch: 2,
        inBeatTime: 0,
        outBeatTime: 1,
        defaultLinked: true,
        ...overrides,
    };
}

function makeStore() {
    return configureStore({
        reducer: {
            video: videoReducer, warp: warpReducer, region: regionReducer,
            scene: sceneReducer, drag: dragReducer, ui: uiReducer,
            settings: settingsReducer, thumbnails: thumbnailsReducer,
        },
        middleware: (g) => g().prepend(thumbnailMiddleware.middleware),
    });
}

import { dragStart, dragEnd } from "../../../src/store/slices/dragSlice";

describe("thumbnailMiddleware — drag gating", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        (setThumbnailWants as ReturnType<typeof vi.fn>).mockClear();
        __testing.reset();
    });
    afterEach(() => vi.useRealTimers());

    it("suppresses IPC while drag.active, fires once on dragEnd", async () => {
        const store = makeStore();
        store.dispatch(setVideo(makeVideo()));
        store.dispatch(addAnchor({ id: 1, time: 1.0 }));
        await vi.advanceTimersByTimeAsync(200);
        const baseline = (setThumbnailWants as ReturnType<typeof vi.fn>).mock.calls.length;

        store.dispatch(dragStart({ regions: [], origAnchors: [], beatAnchors: [] }));
        for (let i = 0; i < 50; i++) {
            store.dispatch(setPlayhead(i / 30));
        }
        await vi.advanceTimersByTimeAsync(500);
        expect((setThumbnailWants as ReturnType<typeof vi.fn>).mock.calls.length).toBe(baseline);

        store.dispatch(dragEnd());
        await vi.advanceTimersByTimeAsync(200);
        expect((setThumbnailWants as ReturnType<typeof vi.fn>).mock.calls.length).toBe(baseline + 1);
    });
});

describe("thumbnailMiddleware — steady-state derivation", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        (setThumbnailWants as ReturnType<typeof vi.fn>).mockClear();
        __testing.reset();
    });
    afterEach(() => vi.useRealTimers());

    it("coalesces multi-source changes into one IPC call", async () => {
        const store = makeStore();
        store.dispatch(setVideo(makeVideo()));
        store.dispatch(addRegion(makeRegion()));
        store.dispatch(addAnchor({ id: 1, time: 1.5 }));
        await vi.advanceTimersByTimeAsync(200);
        expect(setThumbnailWants).toHaveBeenCalledTimes(1);
        const arg = (setThumbnailWants as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(arg.fileHash).toBe("h");
        expect(arg.byReason.clips).toContain(30); // r1.inPoint=1s @ 30fps
        expect(arg.byReason.anchors).toContain(45); // 1.5s @ 30fps
    });

    it("skips IPC when payload deep-equals lastSent", async () => {
        const store = makeStore();
        store.dispatch(setVideo(makeVideo()));
        store.dispatch(setPlayhead(5));
        await vi.advanceTimersByTimeAsync(200);
        const callsAfterFirst = (setThumbnailWants as ReturnType<typeof vi.fn>).mock.calls.length;
        // Re-dispatch the same playhead — same filmstrip frames → no IPC.
        store.dispatch(setPlayhead(5));
        await vi.advanceTimersByTimeAsync(200);
        expect((setThumbnailWants as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterFirst);
    });
});
