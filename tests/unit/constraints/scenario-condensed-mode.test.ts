import { describe, it, expect } from "vitest";
import { makeStore } from "../../helpers/setup";
import { setTimelineMode } from "../../../src/store/slices/uiSlice";
import { setPlayhead } from "../../../src/store/slices/warpSlice";

/**
 * Scenario: condensed timeline mode structural invariants.
 *
 * 1. Toggling `timelineMode` is a pure UI concern — it must not mutate
 *    `warp.anchors` or `region.regions`.
 * 2. Writing `state.warp.playhead` (the action Task 8's SetPlayhead intent
 *    handler will dispatch) must not push a history snapshot — scrubbing is
 *    not an undoable operation.
 */
describe("scenario: condensed timeline mode", () => {
    it("toggling timelineMode does not mutate anchors or regions", () => {
        const store = makeStore();

        const origAnchorsBefore = store.getState().warp.origAnchors;
        const beatAnchorsBefore = store.getState().warp.beatAnchors;
        const regionsBefore = store.getState().region.regions;

        store.dispatch(setTimelineMode("condensed"));

        // Mode actually changed.
        expect(store.getState().ui.timelineMode).toBe("condensed");

        // Reference equality — slices are untouched (immer would produce a
        // new array on any write).
        expect(store.getState().warp.origAnchors).toBe(origAnchorsBefore);
        expect(store.getState().warp.beatAnchors).toBe(beatAnchorsBefore);
        expect(store.getState().region.regions).toBe(regionsBefore);

        // Toggle back too, for symmetry.
        store.dispatch(setTimelineMode("warp"));
        expect(store.getState().ui.timelineMode).toBe("warp");
        expect(store.getState().warp.origAnchors).toBe(origAnchorsBefore);
        expect(store.getState().warp.beatAnchors).toBe(beatAnchorsBefore);
        expect(store.getState().region.regions).toBe(regionsBefore);
    });

    it("setPlayhead does not push a history snapshot", () => {
        const store = makeStore();

        const stackLenBefore = store.getState().history.stack.length;
        const indexBefore = store.getState().history.index;

        store.dispatch(setPlayhead(3.5));

        // Playhead actually moved.
        expect(store.getState().warp.playhead).toBe(3.5);

        // History stack untouched.
        expect(store.getState().history.stack.length).toBe(stackLenBefore);
        expect(store.getState().history.index).toBe(indexBefore);
    });
});
