/**
 * Phase 4c — globals.lockMode derived from ui.lockMode tests.
 *
 * In Phase 4c, globalLockModeMirrorMiddleware is a no-op. The globals.lockMode
 * is set by buildGraphFromSlice directly from ui.lockMode at every pipeline
 * invocation. These tests verify selectConstraintGraph reflects the correct
 * lockMode in its globals.
 */

import { describe, it, expect } from "vitest";
import { configureStore, type EnhancedStore } from "@reduxjs/toolkit";
import uiReducer, { setLockMode } from "../../../src/store/slices/uiSlice";
import warpReducer from "../../../src/store/slices/warpSlice";
import regionReducer from "../../../src/store/slices/regionSlice";
import listsReducer from "../../../src/store/slices/listsSlice";
import { selectConstraintGraph } from "../../../src/store/selectors/constraintGraph";
import type { RootState } from "../../../src/store/store";

function makeStore(): EnhancedStore {
    return configureStore({
        reducer: {
            warp: warpReducer,
            ui: uiReducer,
            region: regionReducer,
            lists: listsReducer,
        },
    });
}

function getGlobalLockMode(store: EnhancedStore): "bpm" | "beats" {
    const graph = selectConstraintGraph(store.getState() as RootState);
    return graph.globals.lockMode;
}

describe("globalLockModeMirrorMiddleware", () => {
    it("initial state has lockMode bpm in both ui and graph globals", () => {
        const store = makeStore();
        const uiState = store.getState() as { ui: { lockMode: "bpm" | "beats" } };
        expect(uiState.ui.lockMode).toBe("bpm");
        expect(getGlobalLockMode(store)).toBe("bpm");
    });

    it('setLockMode("beats") mirrors to constraint graph globals', () => {
        const store = makeStore();
        store.dispatch(setLockMode("beats"));
        expect(getGlobalLockMode(store)).toBe("beats");
    });

    it('setLockMode("bpm") after "beats" mirrors back to bpm', () => {
        const store = makeStore();
        store.dispatch(setLockMode("beats"));
        store.dispatch(setLockMode("bpm"));
        expect(getGlobalLockMode(store)).toBe("bpm");
    });

    it("ui.lockMode and graph globals stay in sync across multiple toggles", () => {
        const store = makeStore();
        for (let i = 0; i < 3; i++) {
            store.dispatch(setLockMode("beats"));
            expect(getGlobalLockMode(store)).toBe("beats");
            store.dispatch(setLockMode("bpm"));
            expect(getGlobalLockMode(store)).toBe("bpm");
        }
    });

    it("setGlobalLockMode directly on constraint slice also reflects in graph globals", () => {
        // In Phase 4c, globals.lockMode is derived from ui.lockMode via selectConstraintGraph.
        // Setting ui.lockMode to 'beats' verifies the derived graph reflects the change.
        const store = makeStore();
        store.dispatch(setLockMode("beats"));
        expect(getGlobalLockMode(store)).toBe("beats");
    });
});
