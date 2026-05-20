import { describe, it, expect } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import warpReducer, { addAnchor, loadAnchors } from "../../src/store/slices/warpSlice";
import regionReducer, { addRegion } from "../../src/store/slices/regionSlice";
import uiReducer from "../../src/store/slices/uiSlice";
import listsReducer from "../../src/store/slices/listsSlice";
import { selectConstraintGraph } from "../../src/store/selectors/constraintGraph";
import type { RootState } from "../../src/store/store";

/**
 * Sanity-check: the derived constraint graph (selectConstraintGraph /
 * buildGraphFromSlice) populates entities whenever anchors / regions
 * are in the slice. Phase 4c verification gate.
 */

function makeStore() {
    return configureStore({
        reducer: {
            warp: warpReducer,
            ui: uiReducer,
            region: regionReducer,
            lists: listsReducer,
        },
    });
}

describe("graph bootstrap", () => {
    it("addRegion populates clipin + clipout entities", () => {
        const store = makeStore();
        store.dispatch(
            addRegion({
                id: "r1",
                name: "R",
                inPoint: 10,
                outPoint: 20,
                inBeatTime: 10,
                outBeatTime: 20,
                defaultLinked: true,
                bpm: 120,
                minStretch: 0.5,
                maxStretch: 2.0,
            }),
        );
        const ents = selectConstraintGraph(store.getState() as RootState).entities;
        expect(ents["r1-in"]).toEqual({ kind: "clip", id: "r1-in", in: 10, out: 20 });
        expect(ents["r1-out"]).toEqual({ kind: "clip", id: "r1-out", in: 10, out: 20 });
    });

    it("addAnchor populates a{id}-in and a{id}-out entities", () => {
        const store = makeStore();
        store.dispatch(addAnchor({ id: 42, time: 7.5 }));
        const ents = selectConstraintGraph(store.getState() as RootState).entities;
        expect(ents["a42-in"]).toEqual({ kind: "anchor", id: "a42-in", time: 7.5 });
        expect(ents["a42-out"]).toEqual({ kind: "anchor", id: "a42-out", time: 7.5 });
    });

    it("loadAnchors rebuilds the graph from the loaded slice state", () => {
        const store = makeStore();
        store.dispatch(
            loadAnchors({
                origAnchors: [
                    { id: 1, time: 3 },
                    { id: 2, time: 9 },
                ],
                beatAnchors: [
                    { id: 1, time: 3 },
                    { id: 2, time: 11, linked: false },
                ],
                beatZeroId: null,
            }),
        );
        const ents = selectConstraintGraph(store.getState() as RootState).entities;
        expect(ents["a1-in"]).toEqual({ kind: "anchor", id: "a1-in", time: 3 });
        expect(ents["a1-out"]).toEqual({ kind: "anchor", id: "a1-out", time: 3 });
        expect(ents["a2-in"]).toEqual({ kind: "anchor", id: "a2-in", time: 9 });
        expect(ents["a2-out"]).toEqual({ kind: "anchor", id: "a2-out", time: 11 });
    });
});
