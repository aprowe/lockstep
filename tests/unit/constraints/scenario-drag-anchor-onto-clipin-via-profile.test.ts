/**
 * Drag a DIVERGED anchor's orig onto a clipin in-edge via the profile flow.
 * The pair is unlinked (moveBeatAnchor diverged it), so only orig moves;
 * beat stays put. ConformVisual must still engage on release, writing the
 * preserved beat time to clipout.
 *
 * Setup:
 *   - Default-linked clip [15, 20]
 *   - Diverged anchor pair: orig=10, beat=5  (unlinked because beat was moved)
 *
 * Gesture: drag orig from 10 → 15 (lands on clipin.in).
 *
 * Expected after drag:
 *   - orig anchor → 15 (on clipin.in)
 *   - beat anchor → 5  (unchanged — pair is unlinked)
 *   - clipin = [15, 20] (unchanged)
 *   - clipout.in  → 5  (conform: written from anchor.beat)
 *   - clipout.out → 20 (unchanged)
 */

import { describe, it, expect } from "vitest";
import { makeStore } from "../../helpers/setup";
import { addRegion, setActiveRegionId } from "../../../src/store/slices/regionSlice";
import { addAnchor, moveBeatAnchor } from "../../../src/store/slices/warpSlice";
import { beginDrag, drag, endDrag } from "../../../src/store/thunks/dragThunks";
import type { Region } from "../../../src/types";

describe("Profile anchor drag of diverged anchor onto clipin: conform engages on release", () => {
    it("drag orig from 10 to 15 (lands on clipin.in): clipout diverges to [5, 20]", () => {
        const store = makeStore();
        const region: Region = {
            id: "r",
            name: "r",
            inPoint: 15,
            outPoint: 20,
            inBeatTime: 15,
            outBeatTime: 20,
            defaultLinked: true,
            bpm: 120,
            lockedBeats: 20,
            minStretch: 0.5,
            maxStretch: 2.0,
        };
        store.dispatch(addRegion(region));
        store.dispatch(setActiveRegionId("r"));
        // Diverged anchor: orig=10, beat=5.
        store.dispatch(addAnchor({ id: 1, time: 10 }));
        store.dispatch(moveBeatAnchor({ id: 1, time: 5 }));

        store.dispatch(
            beginDrag({
                handle: { kind: "anchor-drag", anchorId: 1, space: "input" },
                pxPerUnit: 16,
            }),
        );
        store.dispatch(drag({ delta: 5, modifiers: { alt: false } })); // orig: 10 → 15
        store.dispatch(endDrag());

        const s = store.getState();
        const r = s.region.regions[0];
        expect(s.warp.origAnchors.find((a) => a.id === 1)!.time, "orig at 15").toBeCloseTo(15, 6);
        expect(
            s.warp.beatAnchors.find((a) => a.id === 1)!.time,
            "beat at 5 (unlinked, unchanged)",
        ).toBeCloseTo(5, 6);
        expect(r.inPoint, "clipin.in unchanged").toBeCloseTo(15, 6);
        expect(r.outPoint, "clipin.out unchanged").toBeCloseTo(20, 6);
        expect(r.inBeatTime, "clipout.in = anchor.beat (conform)").toBeCloseTo(5, 6);
        expect(r.outBeatTime, "clipout.out unchanged").toBeCloseTo(20, 6);
    });
});
