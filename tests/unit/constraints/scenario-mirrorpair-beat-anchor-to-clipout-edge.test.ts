/**
 * MirrorPair (step 4b in buildGraphFromSlice) is the constraint that
 * couples a beat anchor's time to a coincident clipout edge — but only
 * when conform holds in BOTH spaces:
 *   - orig anchor coincides with clipin edge (input-space gate)
 *   - beat anchor coincides with clipout edge (output-space gate)
 *
 * These tests assert the correct behavior at the constraint-system
 * level, independent of the controller's `linkedOutputEdges` capture
 * (which is being deleted — it incorrectly emitted regionResize even
 * when only beat-space coincidence held).
 */

import { describe, it, expect } from "vitest";
import { makeStore } from "../../helpers/setup";
import { addRegion } from "../../../src/store/slices/regionSlice";
import { addAnchor, moveBeatAnchor } from "../../../src/store/slices/warpSlice";
import { applyAnchorEntityMove } from "../../../src/store/thunks/entityWriteThunks";
import { dragStart } from "../../../src/store/slices/dragSlice";
import { snapshotPreDragState } from "../../../src/store/thunks/dragThunks";
import type { Region } from "../../../src/types";

describe("MirrorPair: beat-anchor drag ↔ clipout edge coupling", () => {
    it("LINKED pair, full conform: beat-anchor drag pulls coincident clipout edge", () => {
        // orig anchor at 5, beat anchor at 5 (linked). Region [5, 25] with
        // inBeatTime=5, outBeatTime=25 — both edges coincide with the pair
        // in both spaces. MirrorPair (orig=5/in-edge=5, beat=5/clipout.in=5)
        // installs at build time; dragging the beat anchor pulls clipout.in.
        const store = makeStore();
        const region: Region = {
            id: "r",
            name: "r",
            inPoint: 5,
            outPoint: 25,
            inBeatTime: 5,
            outBeatTime: 25,
            defaultLinked: true,
            bpm: 120,
            lockedBeats: 20,
            minStretch: 0.5,
            maxStretch: 2.0,
        };
        store.dispatch(addRegion(region));
        store.dispatch(addAnchor({ id: 1, time: 5 }));

        store.dispatch(dragStart(snapshotPreDragState(store.getState())));
        store.dispatch(applyAnchorEntityMove({ entityId: "a1-out", time: 7 }));

        const s = store.getState();
        expect(s.warp.beatAnchors.find((a) => a.id === 1)?.time, "beat moved to 7").toBeCloseTo(
            7,
            6,
        );
        expect(
            s.region.regions[0].inBeatTime,
            "clipout.in followed beat via MirrorPair",
        ).toBeCloseTo(7, 6);
        expect(
            s.region.regions[0].outBeatTime,
            "clipout.out unchanged (not coincident with this anchor)",
        ).toBeCloseTo(25, 6);
    });

    it("DIVERGED pair (only beat coincides): solo beat-anchor drag does NOT pull clipout edge", () => {
        // Diverged pair: orig=5, beat=10. Region (7, 25) with inBeatTime=10,
        // outBeatTime=25. clipin.in=7 ≠ orig.time=5 (input-space NOT coincident).
        // clipout.in=10 = beat.time=10 (output-space coincident only).
        // MirrorPair install requires BOTH coincidences → not installed.
        // Beat-anchor drag must NOT pull clipout edge.
        const store = makeStore();
        const region: Region = {
            id: "r",
            name: "r",
            inPoint: 7,
            outPoint: 25,
            inBeatTime: 10,
            outBeatTime: 25,
            defaultLinked: false,
            bpm: 120,
            lockedBeats: 20,
            minStretch: 0.5,
            maxStretch: 2.0,
        };
        store.dispatch(addRegion(region));
        store.dispatch(addAnchor({ id: 1, time: 5 }));
        store.dispatch(moveBeatAnchor({ id: 1, time: 10 }));

        store.dispatch(dragStart(snapshotPreDragState(store.getState())));
        store.dispatch(applyAnchorEntityMove({ entityId: "a1-out", time: 12 }));

        const s = store.getState();
        expect(s.warp.beatAnchors.find((a) => a.id === 1)?.time, "beat moved").toBeCloseTo(12, 6);
        expect(
            s.region.regions[0].inBeatTime,
            "clipout.in MUST stay put — guard rejects",
        ).toBeCloseTo(10, 6);
        expect(s.region.regions[0].outBeatTime, "clipout.out unchanged").toBeCloseTo(25, 6);
    });

    it("LINKED pair, beat-anchor drag away from clipout edge does NOT also drag it (anchor was not on the edge)", () => {
        // Pair at orig=15/beat=15. Region [5, 25] in both spaces. clipin
        // edges (5, 25), clipout edges (5, 25). Neither clipin edge equals
        // anchor.time=15 → no MirrorPair install for any edge. Dragging the
        // beat anchor moves only the anchor.
        const store = makeStore();
        const region: Region = {
            id: "r",
            name: "r",
            inPoint: 5,
            outPoint: 25,
            inBeatTime: 5,
            outBeatTime: 25,
            defaultLinked: true,
            bpm: 120,
            lockedBeats: 20,
            minStretch: 0.5,
            maxStretch: 2.0,
        };
        store.dispatch(addRegion(region));
        store.dispatch(addAnchor({ id: 1, time: 15 }));

        store.dispatch(dragStart(snapshotPreDragState(store.getState())));
        store.dispatch(applyAnchorEntityMove({ entityId: "a1-out", time: 18 }));

        const s = store.getState();
        expect(s.warp.beatAnchors.find((a) => a.id === 1)?.time).toBeCloseTo(18, 6);
        expect(s.region.regions[0].inBeatTime, "clipout.in unchanged").toBeCloseTo(5, 6);
        expect(s.region.regions[0].outBeatTime, "clipout.out unchanged").toBeCloseTo(25, 6);
    });
});
