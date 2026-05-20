/**
 * Restored from removed legacy test (Task 13):
 *   scenario-conform-clipout-drag-both-edges.test.ts > "snap-loop"
 *
 * Regression: dragging clipout body across the clipin snap radius pixel-by-
 * pixel must NOT lose anchors at intermediate positions when the body-mode
 * snap re-engages mid-drag. Conformed anchors (sitting on each clipout edge)
 * follow the clipout via MirrorPair throughout the sweep.
 *
 * Ported to the new architecture: snap install is owned by CLIP_BODY_DRAG's
 * whileDragging, not setSnapInstall. The drag is driven via beginDrag/drag/
 * endDrag thunks — no commitClipoutPan, no dragCtxSlice.
 */

import { describe, it, expect } from "vitest";
import { makeStore } from "../../helpers/setup";
import { addRegion } from "../../../src/store/slices/regionSlice";
import { addAnchor } from "../../../src/store/slices/warpSlice";
import { beginDrag, drag, endDrag } from "../../../src/store/thunks/dragThunks";
import type { Region } from "../../../src/types";

describe("Restored: clipout body drag across snap radius — anchors follow", () => {
    it("pixel-by-pixel +2R then −2R sweep: both edge-conformed anchors end at the final position (not lost mid-snap)", () => {
        const SNAP_RADIUS = 2;
        const store = makeStore();

        // Default-linked region [10, 30]: clipin = clipout = [10, 30]. Anchors
        // conformed on both clipout edges (orig=beat for each).
        const region: Region = {
            id: "r",
            name: "r",
            inPoint: 10,
            outPoint: 30,
            inBeatTime: 10,
            outBeatTime: 30,
            defaultLinked: true,
            bpm: 120,
            lockedBeats: 40,
            minStretch: 0.5,
            maxStretch: 2.0,
        };
        store.dispatch(addRegion(region));
        store.dispatch(addAnchor({ id: 1, time: 10 })); // on 'in' edge
        store.dispatch(addAnchor({ id: 2, time: 30 })); // on 'out' edge

        // Begin a CLIP_BODY_DRAG profile drag on the clipout (beat-space).
        // pxPerUnit is large enough that the profile's whileDragging installs a
        // SnapTarget with a threshold ≥ SNAP_RADIUS (snap.ts uses 8 px / pxPerUnit;
        // pxPerUnit=4 → threshold=2). The body-mode SnapTarget targets clipin's
        // edges via snapToSiblings.
        store.dispatch(
            beginDrag({
                handle: { kind: "clip-body", clipId: "r", space: "beat" },
                pxPerUnit: 8 / SNAP_RADIUS,
            }),
        );

        // Forward sweep: cumulative delta 0 → +2*R (clipout walks well past the
        // snap radius on the right side).
        for (let cum = 1; cum <= 2 * SNAP_RADIUS; cum++) {
            store.dispatch(drag({ delta: cum, modifiers: { alt: false } }));
        }
        {
            const peak = store.getState();
            expect(peak.region.regions[0].inBeatTime).toBeCloseTo(10 + 2 * SNAP_RADIUS, 6);
            expect(peak.region.regions[0].outBeatTime).toBeCloseTo(30 + 2 * SNAP_RADIUS, 6);
            expect(peak.warp.beatAnchors.find((a) => a.id === 1)?.time).toBeCloseTo(
                10 + 2 * SNAP_RADIUS,
                6,
            );
            expect(peak.warp.beatAnchors.find((a) => a.id === 2)?.time).toBeCloseTo(
                30 + 2 * SNAP_RADIUS,
                6,
            );
        }

        // Backward sweep: +2R−1 down to −2R. Crosses snap radius of clipin in
        // the middle. The snap-loop bug would leave anchors stranded at some
        // intermediate cum where snap engaged; the new architecture's MirrorPair
        // keeps anchors locked to clipout edges throughout.
        for (let cum = 2 * SNAP_RADIUS - 1; cum >= -2 * SNAP_RADIUS; cum--) {
            store.dispatch(drag({ delta: cum, modifiers: { alt: false } }));
        }

        store.dispatch(endDrag());

        // End: cumulative −2R → clipout = [6, 26]. Anchors must have followed
        // all the way; not been left at any intermediate snap position.
        const end = store.getState();
        expect(end.region.regions[0].inBeatTime).toBeCloseTo(10 - 2 * SNAP_RADIUS, 6);
        expect(end.region.regions[0].outBeatTime).toBeCloseTo(30 - 2 * SNAP_RADIUS, 6);
        expect(end.warp.beatAnchors.find((a) => a.id === 1)?.time).toBeCloseTo(
            10 - 2 * SNAP_RADIUS,
            6,
        );
        expect(end.warp.beatAnchors.find((a) => a.id === 2)?.time).toBeCloseTo(
            30 - 2 * SNAP_RADIUS,
            6,
        );
    });
});
