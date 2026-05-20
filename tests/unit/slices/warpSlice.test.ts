import { describe, it, expect } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import type { AppDispatch } from "../../../src/store/store";
import warpReducer, {
    addAnchor,
    removeAnchors,
    moveOrigAnchor,
    moveBeatAnchor,
    resetBeatLinks,
    clearAnchors,
    loadAnchors,
    setOrigAnchorsFromTimeline,
    setBeatAnchorsFromTimeline,
    selectAll,
    deselectAll,
    setSelectedOrigIds,
    setSelectedBeatIds,
    setBeatZeroId,
    newAnchorId,
    bumpAnchorIdCounter,
} from "../../../src/store/slices/warpSlice";
import type { Anchor } from "../../../src/types";
import {
    selectSortedOrig,
    selectSortedBeat,
    selectLinkedAnchorIds,
} from "../../../src/store/selectors";

/**
 * Minimal real store with the warp slice.
 */
function makeStore() {
    const store = configureStore({
        reducer: {
            warp: warpReducer,
        },
    });
    return store as typeof store & { dispatch: AppDispatch };
}

/** Add an anchor. If beatTime differs from origTime, diverge the beat side. */
function seedAnchor(
    store: ReturnType<typeof makeStore>,
    payload: { id: number; origTime: number; beatTime?: number },
) {
    store.dispatch(addAnchor({ id: payload.id, time: payload.origTime }));
    if (payload.beatTime !== undefined && payload.beatTime !== payload.origTime) {
        store.dispatch(moveBeatAnchor({ id: payload.id, time: payload.beatTime }));
    }
}

function origAnchors(store: ReturnType<typeof makeStore>): Anchor[] {
    return selectSortedOrig(store.getState() as never);
}
function beatAnchors(store: ReturnType<typeof makeStore>): Anchor[] {
    return selectSortedBeat(store.getState() as never);
}
/** Returns whether an anchor is linked (defaultlink pair present in graph). */
function isLinked(store: ReturnType<typeof makeStore>, id: number): boolean {
    return selectLinkedAnchorIds(store.getState() as never).has(id);
}

describe("addAnchor", () => {
    it("appends to both orig and beat arrays", () => {
        const state = warpReducer(undefined, addAnchor({ id: 1, time: 5 }));
        expect(state.origAnchors).toHaveLength(1);
        expect(state.beatAnchors).toHaveLength(1);
        expect(state.origAnchors[0].id).toBe(1);
        expect(state.beatAnchors[0].id).toBe(1);
    });

    it("marks new anchors as linked (defaultlink pair in graph)", () => {
        const store = makeStore();
        store.dispatch(addAnchor({ id: 1, time: 5 }));
        expect(isLinked(store, 1)).toBe(true);
    });
});

describe("removeAnchors", () => {
    it("removes from both arrays and removes defaultlink pair from graph", () => {
        const store = makeStore();
        store.dispatch(addAnchor({ id: 1, time: 5 }));
        store.dispatch(addAnchor({ id: 2, time: 10 }));
        store.dispatch(removeAnchors([1]));
        expect(store.getState().warp.origAnchors.find((a) => a.id === 1)).toBeUndefined();
        expect(store.getState().warp.beatAnchors.find((a) => a.id === 1)).toBeUndefined();
        expect(isLinked(store, 1)).toBe(false);
        expect(store.getState().warp.origAnchors).toHaveLength(1);
    });

    it("clears beatZeroId when that anchor is removed", () => {
        let state = warpReducer(undefined, addAnchor({ id: 1, time: 5 }));
        state = warpReducer(state, setBeatZeroId(1));
        state = warpReducer(state, removeAnchors([1]));
        expect(state.beatZeroId).toBeNull();
    });

    it("removes the ID from selectedOrigIds and selectedBeatIds", () => {
        let state = warpReducer(undefined, addAnchor({ id: 1, time: 5 }));
        state = warpReducer(state, setSelectedOrigIds([1]));
        state = warpReducer(state, setSelectedBeatIds([1]));
        state = warpReducer(state, removeAnchors([1]));
        expect(state.selectedOrigIds).not.toContain(1);
        expect(state.selectedBeatIds).not.toContain(1);
    });
});

describe("moveOrigAnchor", () => {
    it("moves a linked beat anchor in sync with orig", () => {
        const store = makeStore();
        seedAnchor(store, { id: 1, origTime: 5 });
        expect(isLinked(store, 1)).toBe(true);
        store.dispatch(moveOrigAnchor({ id: 1, time: 8 }));
        expect(origAnchors(store)[0].time).toBe(8);
        expect(beatAnchors(store)[0].time).toBe(8);
    });

    it("does NOT move an unlinked beat anchor", () => {
        const store = makeStore();
        seedAnchor(store, { id: 1, origTime: 5 });
        store.dispatch(moveBeatAnchor({ id: 1, time: 9 }));
        expect(isLinked(store, 1)).toBe(false);
        store.dispatch(moveOrigAnchor({ id: 1, time: 12 }));
        expect(origAnchors(store)[0].time).toBe(12);
        expect(beatAnchors(store)[0].time).toBe(9);
    });
});

describe("moveBeatAnchor", () => {
    it("unlinks the beat anchor when moved independently (removes defaultlink pair)", () => {
        const store = makeStore();
        seedAnchor(store, { id: 1, origTime: 5 });
        expect(isLinked(store, 1)).toBe(true);
        store.dispatch(moveBeatAnchor({ id: 1, time: 8 }));
        expect(isLinked(store, 1)).toBe(false);
    });

    it("leaves orig anchor time unchanged", () => {
        const store = makeStore();
        seedAnchor(store, { id: 1, origTime: 5 });
        store.dispatch(moveBeatAnchor({ id: 1, time: 7 }));
        expect(origAnchors(store)[0].time).toBe(5);
    });
});

describe("resetBeatLinks", () => {
    it("restores beat anchor to orig position and re-links (re-installs defaultlink pair)", () => {
        const store = makeStore();
        seedAnchor(store, { id: 1, origTime: 5 });
        store.dispatch(moveBeatAnchor({ id: 1, time: 9 }));
        expect(isLinked(store, 1)).toBe(false);
        store.dispatch(resetBeatLinks([1]));
        expect(beatAnchors(store)[0].time).toBe(5);
        expect(isLinked(store, 1)).toBe(true);
    });

    it("is idempotent when anchor is already linked", () => {
        const store = makeStore();
        seedAnchor(store, { id: 1, origTime: 5 });
        store.dispatch(resetBeatLinks([1]));
        expect(beatAnchors(store)[0].time).toBe(5);
        expect(isLinked(store, 1)).toBe(true);
    });
});

describe("clearAnchors", () => {
    it("empties all anchor arrays and selection", () => {
        const store = makeStore();
        store.dispatch(addAnchor({ id: 1, time: 5 }));
        store.dispatch(addAnchor({ id: 2, time: 10 }));
        store.dispatch(setSelectedOrigIds([1]));
        store.dispatch(setSelectedBeatIds([1]));
        store.dispatch(setBeatZeroId(1));
        store.dispatch(clearAnchors());
        const state = store.getState().warp;
        expect(state.origAnchors).toHaveLength(0);
        expect(state.beatAnchors).toHaveLength(0);
        expect(state.selectedOrigIds).toHaveLength(0);
        expect(state.selectedBeatIds).toHaveLength(0);
        expect(state.beatZeroId).toBeNull();
    });
});

describe("setOrigAnchorsFromTimeline", () => {
    it("adds a new anchor as linked (defaultlink pair installed)", () => {
        const store = makeStore();
        store.dispatch(setOrigAnchorsFromTimeline([{ id: 10, time: 5 }]));
        expect(store.getState().warp.origAnchors).toHaveLength(1);
        expect(store.getState().warp.beatAnchors).toHaveLength(1);
        expect(isLinked(store, 10)).toBe(true);
    });

    it("removes anchors not in the next array", () => {
        const store = makeStore();
        seedAnchor(store, { id: 1, origTime: 5 });
        seedAnchor(store, { id: 2, origTime: 10 });
        store.dispatch(setOrigAnchorsFromTimeline([{ id: 1, time: 5 }]));
        expect(store.getState().warp.origAnchors).toHaveLength(1);
        expect(store.getState().warp.beatAnchors.find((a) => a.id === 2)).toBeUndefined();
    });

    it("clears beatZeroId when that anchor is removed via timeline update", () => {
        const store = makeStore();
        seedAnchor(store, { id: 1, origTime: 5 });
        store.dispatch(setBeatZeroId(1));
        store.dispatch(setOrigAnchorsFromTimeline([]));
        expect(store.getState().warp.beatZeroId).toBeNull();
    });

    it("moves a linked beat anchor when orig anchor moves", () => {
        const store = makeStore();
        seedAnchor(store, { id: 1, origTime: 5 });
        expect(isLinked(store, 1)).toBe(true);
        store.dispatch(setOrigAnchorsFromTimeline([{ id: 1, time: 8 }]));
        expect(beatAnchors(store)[0].time).toBe(8);
    });

    it("does NOT move an unlinked beat anchor when orig anchor moves", () => {
        const store = makeStore();
        seedAnchor(store, { id: 1, origTime: 5, beatTime: 9 });
        expect(isLinked(store, 1)).toBe(false);
        store.dispatch(setOrigAnchorsFromTimeline([{ id: 1, time: 12 }]));
        expect(beatAnchors(store)[0].time).toBe(9);
    });
});

describe("setBeatAnchorsFromTimeline", () => {
    it("unlinks anchors whose beat time changes (removes defaultlink pair)", () => {
        const store = makeStore();
        seedAnchor(store, { id: 1, origTime: 5 });
        expect(isLinked(store, 1)).toBe(true);
        store.dispatch(setBeatAnchorsFromTimeline([{ id: 1, time: 7 }]));
        expect(isLinked(store, 1)).toBe(false);
    });

    it("keeps the link when beat time is unchanged", () => {
        const store = makeStore();
        seedAnchor(store, { id: 1, origTime: 5 });
        store.dispatch(setBeatAnchorsFromTimeline([{ id: 1, time: 5 }]));
        expect(isLinked(store, 1)).toBe(true);
    });
});

describe("loadAnchors", () => {
    it("replaces all anchors and metadata", () => {
        const store = makeStore();
        store.dispatch(addAnchor({ id: 1, time: 5 }));
        const payload = {
            origAnchors: [{ id: 7, time: 20 }] as Anchor[],
            beatAnchors: [{ id: 7, time: 22, linked: false }] as Anchor[],
            beatZeroId: 7,
        };
        store.dispatch(loadAnchors(payload));
        const state = store.getState().warp;
        expect(state.origAnchors).toEqual(payload.origAnchors);
        expect(state.beatAnchors).toEqual(payload.beatAnchors);
        // linked: false on the beat anchor → no defaultlink pair installed
        expect(isLinked(store, 7)).toBe(false);
        expect(state.beatZeroId).toBe(7);
    });
});

describe("selection", () => {
    it("selectAll selects all orig anchor IDs in both spaces", () => {
        let state = warpReducer(undefined, addAnchor({ id: 1, time: 5 }));
        state = warpReducer(state, addAnchor({ id: 2, time: 10 }));
        state = warpReducer(state, selectAll());
        expect(state.selectedOrigIds).toEqual(expect.arrayContaining([1, 2]));
        expect(state.selectedOrigIds).toHaveLength(2);
        expect(state.selectedBeatIds).toEqual(expect.arrayContaining([1, 2]));
        expect(state.selectedBeatIds).toHaveLength(2);
    });

    it("deselectAll clears both selection arrays", () => {
        let state = warpReducer(undefined, addAnchor({ id: 1, time: 5 }));
        state = warpReducer(state, selectAll());
        state = warpReducer(state, deselectAll());
        expect(state.selectedOrigIds).toHaveLength(0);
        expect(state.selectedBeatIds).toHaveLength(0);
    });
});

describe("newAnchorId", () => {
    it("returns a positive integer and increments on each call", () => {
        const a = newAnchorId();
        const b = newAnchorId();
        expect(typeof a).toBe("number");
        expect(b).toBe(a + 1);
    });
});

describe("bumpAnchorIdCounter", () => {
    it("ensures subsequent newAnchorId calls do not collide with provided anchors", () => {
        bumpAnchorIdCounter([{ id: 9999 }]);
        const next = newAnchorId();
        expect(next).toBeGreaterThan(9999);
    });
});
