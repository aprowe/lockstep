import { describe, it, expect, beforeEach } from "vitest";
import { configureStore, type EnhancedStore } from "@reduxjs/toolkit";
import videoReducer, { setVideo } from "../../../src/store/slices/videoSlice";
import uiReducer, {
    setView,
    setPlaying,
    setTimelineFollowPlayhead,
} from "../../../src/store/slices/uiSlice";
import warpReducer, { setPlayhead } from "../../../src/store/slices/warpSlice";
import regionReducer from "../../../src/store/slices/regionSlice";
import historyReducer from "../../../src/store/slices/historySlice";
import sceneReducer from "../../../src/store/slices/sceneSlice";
import thumbnailsReducer from "../../../src/store/slices/thumbnailsSlice";
import settingsReducer from "../../../src/store/slices/settingsSlice";
import listsReducer from "../../../src/store/slices/listsSlice";
import { revealPlayheadMiddleware } from "../../../src/store/middleware/revealPlayheadMiddleware";

function makeStore(): EnhancedStore {
    return configureStore({
        reducer: {
            video: videoReducer,
            ui: uiReducer,
            warp: warpReducer,
            region: regionReducer,
            history: historyReducer,
            scene: sceneReducer,
            thumbnails: thumbnailsReducer,
            settings: settingsReducer,
            lists: listsReducer,
        },
        middleware: (getDefault) => getDefault().prepend(revealPlayheadMiddleware.middleware),
    });
}

describe("revealPlayheadMiddleware", () => {
    let store: EnhancedStore;

    beforeEach(() => {
        store = makeStore();
        store.dispatch(
            setVideo({
                path: "/v.mp4",
                originalName: "v.mp4",
                videoUrl: "",
                duration: 100,
                fps: 30,
                fileHash: "h",
            }),
        );
        store.dispatch(setView({ start: 10, end: 20 }));
        store.dispatch(setTimelineFollowPlayhead(true));
    });

    it("leaves the view alone when the playhead is inside it", () => {
        store.dispatch(setPlayhead(15));
        const view = (store.getState() as any).ui.view;
        expect(view).toEqual({ start: 10, end: 20 });
    });

    it("scrolls the view when the playhead lands outside while paused", () => {
        store.dispatch(setPlayhead(50));
        const view = (store.getState() as any).ui.view;
        // Span preserved (10), playhead just inside the right edge with 1s margin.
        expect(view.end - view.start).toBeCloseTo(10);
        expect(view.end).toBeCloseTo(51);
        expect(view.start).toBeCloseTo(41);
    });

    it("scrolls left when the playhead lands behind the view", () => {
        store.dispatch(setView({ start: 50, end: 60 }));
        store.dispatch(setPlayhead(30));
        const view = (store.getState() as any).ui.view;
        expect(view.start).toBeCloseTo(29);
        expect(view.end).toBeCloseTo(39);
    });

    it("is a no-op during playback", () => {
        store.dispatch(setPlaying(true));
        store.dispatch(setPlayhead(80));
        const view = (store.getState() as any).ui.view;
        expect(view).toEqual({ start: 10, end: 20 });
    });

    it("is a no-op before a video has loaded", () => {
        const bare = configureStore({
            reducer: {
                video: videoReducer,
                ui: uiReducer,
                warp: warpReducer,
                region: regionReducer,
                history: historyReducer,
                scene: sceneReducer,
                thumbnails: thumbnailsReducer,
                settings: settingsReducer,
                lists: listsReducer,
            },
            middleware: (getDefault) => getDefault().prepend(revealPlayheadMiddleware.middleware),
        });
        bare.dispatch(setView({ start: 10, end: 20 }));
        bare.dispatch(setTimelineFollowPlayhead(true));
        bare.dispatch(setPlayhead(50));
        const view = (bare.getState() as any).ui.view;
        expect(view).toEqual({ start: 10, end: 20 });
    });

    it("is a no-op when the follow-playhead toggle is off", () => {
        store.dispatch(setTimelineFollowPlayhead(false));
        store.dispatch(setPlayhead(50));
        const view = (store.getState() as any).ui.view;
        expect(view).toEqual({ start: 10, end: 20 });
    });

    it("clamps the revealed view to the video bounds", () => {
        store.dispatch(setPlayhead(99.9));
        const view = (store.getState() as any).ui.view;
        expect(view.end).toBe(100);
        expect(view.end - view.start).toBeCloseTo(10);
    });
});
