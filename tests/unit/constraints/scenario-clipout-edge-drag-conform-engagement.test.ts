/**
 * Scenario: clipout out-edge drag carries a conformed beat anchor.
 *
 *   Region: clipin=[10, 20], clipout=[10, 25] (diverged).
 *   Anchor: orig=20 (on clipin.out), beat=25 (on clipout.out).
 *     → input coincidence  (clipin.out  === orig)
 *     → output coincidence (clipout.out === beat)
 *     → MirrorPair (step 4b) installs at preDrag.
 *
 *   Drag clipout out-edge from 25 → 27 in +0.5 increments. At every step
 *   anchor-out must equal clipout.out (MirrorPair propagates the SetEdge).
 */

import { describe, it, expect } from "vitest";
import { makeStore } from "../../helpers/setup";
import { addRegion } from "../../../src/store/slices/regionSlice";
import { loadAnchors } from "../../../src/store/slices/warpSlice";
import { beginDrag, drag, endDrag } from "../../../src/store/thunks/dragThunks";
import type { Region } from "../../../src/types";

describe("Clipout out-edge drag carries conformed beat anchor (orig=20, beat=25)", () => {
    it("+0.5 increments from 25 → 27: anchor-out equals clipout.out at every step", () => {
        const store = makeStore();

        // clipin [10, 20], clipout [10, 25] — diverged. Anchor (orig=20, beat=25)
        // sits on both edges in their respective spaces → MirrorPair conform.
        const region: Region = {
            id: "r",
            name: "r",
            inPoint: 10,
            outPoint: 20,
            inBeatTime: 10,
            outBeatTime: 25,
            defaultLinked: false,
            bpm: 120,
            lockedBeats: 30,
            minStretch: 0.5,
            maxStretch: 2.0,
        };
        store.dispatch(addRegion(region));
        store.dispatch(
            loadAnchors({
                origAnchors: [{ id: 1, time: 20 }],
                beatAnchors: [{ id: 1, time: 25, linked: false }],
            }),
        );

        store.dispatch(
            beginDrag({
                handle: { kind: "clip-out-edge", clipId: "r", space: "beat" },
                pxPerUnit: 100,
            }),
        );

        const results: Array<{ cum: number; outBeat: number; anchorOut: number }> = [];
        for (let cumX2 = 1; cumX2 <= 4; cumX2++) {
            const cum = cumX2 / 2; // 0.5, 1.0, 1.5, 2.0
            store.dispatch(drag({ delta: cum, modifiers: { alt: false } }));
            const s = store.getState();
            results.push({
                cum,
                outBeat: s.region.regions[0].outBeatTime,
                anchorOut: s.warp.beatAnchors.find((a) => a.id === 1)!.time,
            });
        }

        store.dispatch(endDrag());

        // At every step: clipout.out advances by `cum` from baseline 25, and
        // anchor-out follows it via the conform MirrorPair.
        for (const r of results) {
            expect(r.outBeat, `cum=${r.cum} clipout.out`).toBeCloseTo(25 + r.cum, 6);
            expect(r.anchorOut, `cum=${r.cum} anchor-out`).toBeCloseTo(25 + r.cum, 6);
        }

        const end = store.getState();
        expect(end.region.regions[0].outBeatTime).toBeCloseTo(27, 6);
        expect(end.warp.beatAnchors.find((a) => a.id === 1)!.time).toBeCloseTo(27, 6);
    });
});
