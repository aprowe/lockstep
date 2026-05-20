import { describe, it, expect } from "vitest";
import { addRegion } from "../../../src/store/slices/regionSlice";
import { setAnchorLock, setLockMode } from "../../../src/store/slices/uiSlice";
import {
    addAnchor,
    moveBeatAnchor,
    setBeatAnchorsFromTimeline,
} from "../../../src/store/slices/warpSlice";
import { commitClipoutResize, commitClipoutPan } from "../../../src/store/thunks/clipoutThunks";
import { makeStore } from "../../helpers/setup";

/** Build a region with clipout from 10..20 (length 10) and a lock mode. */
function makeRegion(_lock?: "beats" | "bpm") {
    return {
        id: "r",
        name: "r",
        inPoint: 10,
        outPoint: 20,
        inBeatTime: 10,
        outBeatTime: 20,
        defaultLinked: true,
        bpm: 120,
        lockedBeats: 20,
        minStretch: 0.5,
        maxStretch: 2,
    };
}

/** Seed two beat anchors at times 12 and 16 — both inside [10, 20]. */
function seedAnchors(store: ReturnType<typeof makeStore>) {
    store.dispatch(
        setBeatAnchorsFromTimeline([
            { id: 1, time: 12 },
            { id: 2, time: 16 },
        ]),
    );
}

// ── commitClipoutResize ────────────────────────────────────────────────────

describe("commitClipoutResize", () => {
    it("anchorLock=true, altKey=false, lock=beats → anchors RESCALE proportionally", () => {
        const store = makeStore();
        store.dispatch(setAnchorLock(true));
        store.dispatch(setLockMode("beats"));
        store.dispatch(addRegion(makeRegion("beats")));
        seedAnchors(store);

        // Resize from 10..20 → 10..18 (new length 8, scale factor = 8/10 = 0.8)
        store.dispatch(
            commitClipoutResize({ id: "r", inBeatTime: 10, outBeatTime: 18, altKey: false }),
        );

        const anchors = store.getState().warp.beatAnchors;
        // anchor 1: 10 + (12-10)*0.8 = 11.6
        // anchor 2: 10 + (16-10)*0.8 = 14.8
        expect(anchors.find((a) => a.id === 1)!.time).toBeCloseTo(11.6, 9);
        expect(anchors.find((a) => a.id === 2)!.time).toBeCloseTo(14.8, 9);
    });

    it("anchorLock=false, altKey=false, lock=beats → anchors STAY (no rescale)", () => {
        const store = makeStore();
        store.dispatch(setLockMode("beats"));
        store.dispatch(addRegion(makeRegion("beats")));
        seedAnchors(store);

        store.dispatch(
            commitClipoutResize({ id: "r", inBeatTime: 10, outBeatTime: 18, altKey: false }),
        );

        const anchors = store.getState().warp.beatAnchors;
        expect(anchors.find((a) => a.id === 1)!.time).toBeCloseTo(12, 9);
        expect(anchors.find((a) => a.id === 2)!.time).toBeCloseTo(16, 9);
    });

    it("anchorLock=false, altKey=true, lock=beats → Alt flips effectiveAnchorLock to true; anchors RESCALE", () => {
        const store = makeStore();
        store.dispatch(setLockMode("beats"));
        store.dispatch(addRegion(makeRegion("beats")));
        seedAnchors(store);

        store.dispatch(
            commitClipoutResize({ id: "r", inBeatTime: 10, outBeatTime: 18, altKey: true }),
        );

        const anchors = store.getState().warp.beatAnchors;
        expect(anchors.find((a) => a.id === 1)!.time).toBeCloseTo(11.6, 9);
        expect(anchors.find((a) => a.id === 2)!.time).toBeCloseTo(14.8, 9);
    });

    it("anchorLock=false, altKey=false, lock=bpm → anchors STAY regardless (only beats lock rescales)", () => {
        const store = makeStore();
        store.dispatch(addRegion(makeRegion("bpm")));
        seedAnchors(store);

        store.dispatch(
            commitClipoutResize({ id: "r", inBeatTime: 10, outBeatTime: 18, altKey: false }),
        );

        const anchors = store.getState().warp.beatAnchors;
        expect(anchors.find((a) => a.id === 1)!.time).toBeCloseTo(12, 9);
        expect(anchors.find((a) => a.id === 2)!.time).toBeCloseTo(16, 9);
    });

    it("always dispatches applyConformedClipout (region clipout updates)", () => {
        const store = makeStore();
        store.dispatch(setAnchorLock(true));
        store.dispatch(setLockMode("beats"));
        store.dispatch(addRegion(makeRegion("beats")));
        seedAnchors(store);

        store.dispatch(
            commitClipoutResize({ id: "r", inBeatTime: 10, outBeatTime: 18, altKey: false }),
        );

        const region = store.getState().region.regions[0];
        expect(region.inBeatTime).toBeCloseTo(10, 9);
        expect(region.outBeatTime).toBeCloseTo(18, 9);
    });

    it("unknown id → no dispatch, state unchanged", () => {
        const store = makeStore();
        store.dispatch(setLockMode("beats"));
        store.dispatch(addRegion(makeRegion("beats")));
        seedAnchors(store);
        const before = store.getState();

        store.dispatch(
            commitClipoutResize({
                id: "no-such-id",
                inBeatTime: 10,
                outBeatTime: 18,
                altKey: false,
            }),
        );

        // Anchors unchanged
        const anchors = store.getState().warp.beatAnchors;
        expect(anchors.find((a) => a.id === 1)!.time).toBeCloseTo(12, 9);
        expect(anchors.find((a) => a.id === 2)!.time).toBeCloseTo(16, 9);
        // Region unchanged
        expect(store.getState().region.regions).toEqual(before.region.regions);
    });
});

// ── commitClipoutPan ───────────────────────────────────────────────────────

describe("commitClipoutPan", () => {
    /** Region with clipout 10..30, two anchors at 15 and 22 (both inside). */
    function makePanRegion() {
        return {
            id: "r",
            name: "r",
            inPoint: 0,
            outPoint: 20,
            inBeatTime: 10,
            outBeatTime: 30,
            defaultLinked: false,
            bpm: 120,
            lockedBeats: 20,
            minStretch: 0.5,
            maxStretch: 2,
        };
    }

    function seedPanAnchors(store: ReturnType<typeof makeStore>) {
        store.dispatch(
            setBeatAnchorsFromTimeline([
                { id: 1, time: 15 },
                { id: 2, time: 22 },
            ]),
        );
    }

    it("anchorLock=true, altKey=false → anchors TRANSLATE by delta", () => {
        const store = makeStore();
        store.dispatch(setAnchorLock(true));
        store.dispatch(addRegion(makePanRegion()));
        seedPanAnchors(store);

        // Pan from 10..30 → 15..35 (+5 delta)
        store.dispatch(
            commitClipoutPan({ id: "r", inBeatTime: 15, outBeatTime: 35, altKey: false }),
        );

        const anchors = store.getState().warp.beatAnchors;
        expect(anchors.find((a) => a.id === 1)!.time).toBeCloseTo(20, 9);
        expect(anchors.find((a) => a.id === 2)!.time).toBeCloseTo(27, 9);
    });

    it("anchorLock=false, altKey=false → anchors STAY in place", () => {
        const store = makeStore();
        store.dispatch(addRegion(makePanRegion()));
        seedPanAnchors(store);

        store.dispatch(
            commitClipoutPan({ id: "r", inBeatTime: 15, outBeatTime: 35, altKey: false }),
        );

        const anchors = store.getState().warp.beatAnchors;
        expect(anchors.find((a) => a.id === 1)!.time).toBeCloseTo(15, 9);
        expect(anchors.find((a) => a.id === 2)!.time).toBeCloseTo(22, 9);
    });

    it("anchorLock=false, altKey=true → Alt flips effectiveAnchorLock to true; anchors TRANSLATE", () => {
        const store = makeStore();
        store.dispatch(addRegion(makePanRegion()));
        seedPanAnchors(store);

        store.dispatch(
            commitClipoutPan({ id: "r", inBeatTime: 15, outBeatTime: 35, altKey: true }),
        );

        const anchors = store.getState().warp.beatAnchors;
        expect(anchors.find((a) => a.id === 1)!.time).toBeCloseTo(20, 9);
        expect(anchors.find((a) => a.id === 2)!.time).toBeCloseTo(27, 9);
    });

    it("delta < 1e-9 → no anchor translate dispatch even when anchorLock=true", () => {
        const store = makeStore();
        store.dispatch(setAnchorLock(true));
        store.dispatch(addRegion(makePanRegion()));
        seedPanAnchors(store);
        const beforeAnchors = store.getState().warp.beatAnchors.map((a) => ({ ...a }));

        // Pan that lands at the same inBeatTime (delta = 0)
        store.dispatch(
            commitClipoutPan({ id: "r", inBeatTime: 10, outBeatTime: 30, altKey: false }),
        );

        const anchors = store.getState().warp.beatAnchors;
        for (const before of beforeAnchors) {
            expect(anchors.find((a) => a.id === before.id)!.time).toBeCloseTo(before.time, 9);
        }
    });

    it("always dispatches applyConformedClipout (region clipout updates)", () => {
        const store = makeStore();
        store.dispatch(addRegion(makePanRegion()));
        seedPanAnchors(store);

        store.dispatch(
            commitClipoutPan({ id: "r", inBeatTime: 15, outBeatTime: 35, altKey: false }),
        );

        const region = store.getState().region.regions[0];
        expect(region.inBeatTime).toBeCloseTo(15, 9);
        expect(region.outBeatTime).toBeCloseTo(35, 9);
    });

    it("ui.anchorLock is not mutated by the gesture", () => {
        const store = makeStore();
        store.dispatch(addRegion(makePanRegion()));
        seedPanAnchors(store);

        store.dispatch(
            commitClipoutPan({ id: "r", inBeatTime: 15, outBeatTime: 35, altKey: true }),
        );

        expect(store.getState().ui.anchorLock).toBe(false);
    });
});

// ── Conformed-marker carry ────────────────────────────────────────────────
// The conform binding (MirrorPair anchor-out.time ↔ clipout.{edge}) is
// auto-installed by buildGraphFromSlice whenever clipin.edge ≈ orig anchor.time.
// commitClipoutResize dispatches SetEdge ops that trigger MirrorPair
// propagation automatically — no setup needed beyond positional coincidence.

describe("commitClipoutResize — conformed-marker carry", () => {
    it("input-linked in-edge: paired beat anchor moves to new inBeatTime", () => {
        // Region: inPoint=10, outPoint=20, inBeatTime=10, outBeatTime=20
        // Input anchor id=5 at time=10 → input-linked to in-edge.
        // Paired beat anchor id=5 at time=6 → conformed display at in-edge.
        // Resize in-edge: inBeatTime 10 → 8.
        // Expected: beat anchor id=5 moves from 6 → 8 (via MirrorEdge carry).
        const store = makeStore();
        store.dispatch(
            addRegion({
                id: "r",
                name: "r",
                inPoint: 10,
                outPoint: 20,
                bpm: 120,
                lockedBeats: 20,
                inBeatTime: 10,
                outBeatTime: 20,
                defaultLinked: true,
                minStretch: 0.5,
                maxStretch: 2,
            }),
        );
        store.dispatch(addAnchor({ id: 5, time: 10 }));
        store.dispatch(moveBeatAnchor({ id: 5, time: 6 }));
        // Non-conformed anchor inside the region
        store.dispatch(
            setBeatAnchorsFromTimeline([
                { id: 5, time: 6 },
                { id: 9, time: 15 },
            ]),
        );

        store.dispatch(
            commitClipoutResize({ id: "r", inBeatTime: 8, outBeatTime: 20, altKey: false }),
        );

        const anchors = store.getState().warp.beatAnchors;
        // MirrorPair auto-install: clipin.in=10 ≈ orig.time=10 → binding present.
        // SetEdge clipout.in=8 propagates to anchor-out.time=8.
        expect(anchors.find((a) => a.id === 5)!.time).toBeCloseTo(8, 9);
        // Other anchor unaffected (no rescale because lock='bpm')
        expect(anchors.find((a) => a.id === 9)!.time).toBeCloseTo(15, 9);
    });

    it("input-linked out-edge: paired beat anchor moves to new outBeatTime", () => {
        // Region: inPoint=10, outPoint=20. Input anchor id=7 at 20 → linked to out-edge.
        // Beat anchor id=7 at 18 → conformed at out-edge.
        // Resize out-edge: outBeatTime 20 → 22.
        // Expected: beat anchor id=7 moves from 18 → 22 (via MirrorEdge carry).
        const store = makeStore();
        store.dispatch(
            addRegion({
                id: "r",
                name: "r",
                inPoint: 10,
                outPoint: 20,
                bpm: 120,
                inBeatTime: 10,
                outBeatTime: 20,
                defaultLinked: true,
                minStretch: 0.5,
                maxStretch: 2,
            }),
        );
        store.dispatch(addAnchor({ id: 7, time: 20 }));
        store.dispatch(moveBeatAnchor({ id: 7, time: 18 }));
        store.dispatch(
            setBeatAnchorsFromTimeline([
                { id: 7, time: 18 },
                { id: 3, time: 14 },
            ]),
        );

        store.dispatch(
            commitClipoutResize({ id: "r", inBeatTime: 10, outBeatTime: 22, altKey: false }),
        );

        const anchors = store.getState().warp.beatAnchors;
        expect(anchors.find((a) => a.id === 7)!.time).toBeCloseTo(22, 9);
        expect(anchors.find((a) => a.id === 3)!.time).toBeCloseTo(14, 9);
    });

    it("no conformed markers → existing rescale/stay behavior preserved", () => {
        // No anchors at boundaries → no carry; Slice B rescale still applies normally.
        const store = makeStore();
        store.dispatch(setAnchorLock(true));
        store.dispatch(setLockMode("beats"));
        store.dispatch(
            addRegion({
                id: "r",
                name: "r",
                inPoint: 10,
                outPoint: 20,
                bpm: 120,
                lockedBeats: 20,
                inBeatTime: 10,
                outBeatTime: 20,
                defaultLinked: true,
                minStretch: 0.5,
                maxStretch: 2,
            }),
        );
        // Anchors inside but not at boundaries
        store.dispatch(
            setBeatAnchorsFromTimeline([
                { id: 1, time: 12 },
                { id: 2, time: 16 },
            ]),
        );

        // Resize from 10..20 → 10..18 (scale factor 0.8), anchorLock=ON + lock='beats' → rescale
        store.dispatch(
            commitClipoutResize({ id: "r", inBeatTime: 10, outBeatTime: 18, altKey: false }),
        );

        const anchors = store.getState().warp.beatAnchors;
        expect(anchors.find((a) => a.id === 1)!.time).toBeCloseTo(11.6, 9);
        expect(anchors.find((a) => a.id === 2)!.time).toBeCloseTo(14.8, 9);
    });
});

describe("commitClipoutPan — conformed-marker carry", () => {
    it("no conformed markers → anchorLock translate behavior preserved", () => {
        // No anchors at boundaries → no carry; anchorLock translate applies normally.
        const store = makeStore();
        store.dispatch(setAnchorLock(true));
        store.dispatch(
            addRegion({
                id: "r",
                name: "r",
                inPoint: 0,
                outPoint: 20,
                bpm: 120,
                lockedBeats: 40,
                inBeatTime: 10,
                outBeatTime: 30,
                defaultLinked: false,
                minStretch: 0.5,
                maxStretch: 2,
            }),
        );
        store.dispatch(
            setBeatAnchorsFromTimeline([
                { id: 1, time: 15 },
                { id: 2, time: 22 },
            ]),
        );

        // Pan +5
        store.dispatch(
            commitClipoutPan({ id: "r", inBeatTime: 15, outBeatTime: 35, altKey: false }),
        );

        const anchors = store.getState().warp.beatAnchors;
        // anchorLock=true, delta=+5 → translate both anchors inside [10,30]
        expect(anchors.find((a) => a.id === 1)!.time).toBeCloseTo(20, 9);
        expect(anchors.find((a) => a.id === 2)!.time).toBeCloseTo(27, 9);
    });
});
