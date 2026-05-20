import { describe, it, expect } from "vitest";
import {
    selectQuantAnchors,
    selectSnapTargetsInput,
    selectSnapTargetsOutput,
    selectBeatOffset,
    selectSegmentAnchors,
    selectLinkedBoundaries,
    selectSelectedBoundaries,
} from "../../../../src/store/selectors/timeline";
import { setSelectedOrigIds } from "../../../../src/store/slices/warpSlice";
import { makeStore } from "../../../helpers/setup";
import { addAnchor, setBeatZeroId } from "../../../../src/store/slices/warpSlice";
import { addRegion, setActiveRegionId } from "../../../../src/store/slices/regionSlice";
import type { RootState } from "../../../../src/store/store";

function selectorState(store: ReturnType<typeof makeStore>): RootState {
    return store.getState() as RootState;
}

const REGION_DEFAULTS = {
    bpm: 120,
    minStretch: 0.5,
    maxStretch: 2.0,

    defaultLinked: true,
};

describe("selectQuantAnchors", () => {
    it("returns beat anchors as { id, time }[], sorted by orig time", () => {
        const store = makeStore();
        store.dispatch(addAnchor({ id: 1, time: 5 }));
        store.dispatch(addAnchor({ id: 2, time: 3 }));
        const result = selectQuantAnchors(selectorState(store));
        // selectSortedBeat sorts by orig.time → id 2 first (time 3), then id 1 (time 5).
        expect(result.map((a) => a.id)).toEqual([2, 1]);
    });

    it("returns the same reference when called twice on the same state (memoisation)", () => {
        const store = makeStore();
        store.dispatch(addAnchor({ id: 1, time: 5 }));
        const r1 = selectQuantAnchors(selectorState(store));
        const r2 = selectQuantAnchors(selectorState(store));
        expect(r1).toBe(r2);
    });
});

describe("selectSnapTargetsInput", () => {
    it("returns orig anchor times", () => {
        const store = makeStore();
        store.dispatch(addAnchor({ id: 1, time: 5 }));
        store.dispatch(addAnchor({ id: 2, time: 9 }));
        const targets = selectSnapTargetsInput(selectorState(store));
        expect(targets).toContain(5);
        expect(targets).toContain(9);
    });
});

describe("selectSnapTargetsOutput", () => {
    it("includes beat anchor times", () => {
        const store = makeStore();
        store.dispatch(addAnchor({ id: 1, time: 5 }));
        const targets = selectSnapTargetsOutput(selectorState(store));
        expect(targets).toContain(5);
    });

    it("falls back to bare beat times when no region active", () => {
        const store = makeStore();
        store.dispatch(addAnchor({ id: 1, time: 5 }));
        const targets = selectSnapTargetsOutput(selectorState(store));
        expect(targets).toEqual([5]);
    });

    it("includes the active region inBeatTime/outBeatTime when set", () => {
        const store = makeStore();
        store.dispatch(addAnchor({ id: 1, time: 5 }));
        store.dispatch(
            addRegion({
                id: "r",
                name: "r",
                inPoint: 2,
                outPoint: 12,
                inBeatTime: 7,
                outBeatTime: 17,
                colorIndex: 0,
                ...REGION_DEFAULTS,
            }),
        );
        store.dispatch(setActiveRegionId("r"));
        const targets = selectSnapTargetsOutput(selectorState(store));
        expect(targets).toContain(7);
        expect(targets).toContain(17);
    });
});

describe("selectSegmentAnchors", () => {
    it("returns sorted orig anchors when no clip is active", () => {
        const store = makeStore();
        store.dispatch(addAnchor({ id: 1, time: 5 }));
        store.dispatch(addAnchor({ id: 2, time: 3 }));
        const result = selectSegmentAnchors(selectorState(store));
        expect(result.map((a) => a.id)).toEqual([2, 1]);
    });

    it("prepends a synthetic boundary anchor at clipIn when clip active", () => {
        const store = makeStore();
        store.dispatch(addAnchor({ id: 1, time: 5 }));
        store.dispatch(
            addRegion({
                id: "r",
                name: "r",
                inPoint: 1,
                outPoint: 8,
                inBeatTime: 1,
                outBeatTime: 8,
                colorIndex: 0,
                ...REGION_DEFAULTS,
            }),
        );
        store.dispatch(setActiveRegionId("r"));
        const result = selectSegmentAnchors(selectorState(store));
        expect(result[0].id).toBeLessThan(0);
        expect(result[0].time).toBe(1);
    });
});

describe("selectLinkedBoundaries", () => {
    it("marks synthetic boundary anchors (id < 0) as linked", () => {
        const store = makeStore();
        store.dispatch(addAnchor({ id: 1, time: 5 }));
        store.dispatch(
            addRegion({
                id: "r",
                name: "r",
                inPoint: 1,
                outPoint: 8,
                inBeatTime: 1,
                outBeatTime: 8,
                colorIndex: 0,
                ...REGION_DEFAULTS,
            }),
        );
        store.dispatch(setActiveRegionId("r"));
        const flags = selectLinkedBoundaries(selectorState(store));
        expect(flags[0]).toBe(true); // synthetic boundary at clipIn
    });
});

describe("selectSelectedBoundaries", () => {
    it("marks anchors whose id is in the selection set", () => {
        const store = makeStore();
        store.dispatch(addAnchor({ id: 1, time: 5 }));
        store.dispatch(addAnchor({ id: 2, time: 9 }));
        store.dispatch(setSelectedOrigIds([1]));
        const flags = selectSelectedBoundaries(selectorState(store));
        // sortedOrig: [1@5, 2@9] → flags[0]=true, flags[1]=false
        expect(flags).toEqual([true, false]);
    });
});

describe("selectBeatOffset", () => {
    it("returns the first beat anchor time when no clip is selected", () => {
        const store = makeStore();
        store.dispatch(addAnchor({ id: 1, time: 5 }));
        // addAnchor mirrors orig to beat → beat anchor 1 at t=5
        const offset = selectBeatOffset(selectorState(store));
        expect(offset).toBe(5);
    });

    it("returns the beatZeroId anchor time when set, with a clip active", () => {
        const store = makeStore();
        store.dispatch(addAnchor({ id: 1, time: 5 }));
        store.dispatch(
            addRegion({
                id: "r",
                name: "r",
                inPoint: 0,
                outPoint: 10,
                inBeatTime: 0,
                outBeatTime: 10,
                colorIndex: 0,
                ...REGION_DEFAULTS,
            }),
        );
        store.dispatch(setActiveRegionId("r"));
        store.dispatch(setBeatZeroId(1));
        expect(selectBeatOffset(selectorState(store))).toBe(5);
    });

    it("returns active region inBeatTime when beatZero is null and clip is active", () => {
        const store = makeStore();
        store.dispatch(
            addRegion({
                id: "r",
                name: "r",
                inPoint: 2,
                outPoint: 12,
                inBeatTime: 3,
                outBeatTime: 13,
                colorIndex: 0,
                ...REGION_DEFAULTS,
            }),
        );
        store.dispatch(setActiveRegionId("r"));
        expect(selectBeatOffset(selectorState(store))).toBe(3);
    });
});
