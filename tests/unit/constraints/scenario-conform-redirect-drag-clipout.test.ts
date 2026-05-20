/**
 * ConformRedirect: when the user drags a clipout edge while the clip is
 * conformed (input coincidence holds), the drag is structurally redirected
 * to anchor.beat. ConformVisual then writes clipout = anchor.beat each
 * pass, so visually clipout moves; under the hood the anchor's beat side
 * is what actually shifted.
 *
 * Setup: clip [10, 30] default-linked, anchor (orig=10, beat=10) on the
 * clipin in-edge → conformed. clipout.in = 10 pre-drag.
 *
 * Action: drag clipout.in by +0.5 via the CLIP_EDGE_DRAG profile.
 *
 * Expected:
 *   - clipout.in → 10.5 (clipout visually moved)
 *   - anchor.beat → 10.5 (redirect carried the delta)
 *   - clipin.in → 10 (unchanged)
 *   - anchor.orig → 10 (unchanged — coincidence preserved)
 */

import { describe, it, expect } from "vitest";
import { makeStore } from "../../helpers/setup";
import { addRegion, setActiveRegionId } from "../../../src/store/slices/regionSlice";
import { addAnchor } from "../../../src/store/slices/warpSlice";
import { beginDrag, drag, endDrag } from "../../../src/store/thunks/dragThunks";
import type { Region } from "../../../src/types";

describe("ConformRedirect: clipout edge drag while conformed", () => {
    it("drag clipout.in by +0.5: clipout AND anchor.beat both move by 0.5; orig unchanged", () => {
        const store = makeStore();
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
        store.dispatch(setActiveRegionId("r"));
        store.dispatch(addAnchor({ id: 1, time: 10 }));

        // Grab the IN edge of the beat-space (clipout) clip. Without a snap
        // target nearby (no other clipout edges close to 10), the drag lands clean.
        store.dispatch(
            beginDrag({
                handle: { kind: "clip-in-edge", clipId: "r", space: "beat" },
                pxPerUnit: 16,
            }),
        );
        store.dispatch(drag({ delta: 0.5, modifiers: { alt: false } }));
        store.dispatch(endDrag());

        const s = store.getState();
        const r = s.region.regions[0];
        expect(r.inPoint, "clipin.in unchanged").toBeCloseTo(10, 6);
        expect(r.outPoint, "clipin.out unchanged").toBeCloseTo(30, 6);
        expect(r.inBeatTime, "clipout.in followed anchor.beat").toBeCloseTo(10.5, 6);
        expect(r.outBeatTime, "clipout.out unchanged").toBeCloseTo(30, 6);
        expect(s.warp.origAnchors.find((a) => a.id === 1)!.time, "orig unchanged").toBeCloseTo(
            10,
            6,
        );
        expect(
            s.warp.beatAnchors.find((a) => a.id === 1)!.time,
            "anchor.beat absorbed the redirect",
        ).toBeCloseTo(10.5, 6);
    });

    it("lasso clipin + clipout (no anchor), drag clipin while conformed: clipout = anchor.beat (override)", () => {
        // The lasso TranslateGroup wants to translate clipin AND clipout by
        // the same delta. But conform holds at clipin.in=10/orig=10, and the
        // strict derivation says clipout.in MUST equal anchor.beat (which the
        // lasso doesn't move). So clipout gets overridden — only clipin moves
        // off the anchor, breaking coincidence; then default-link restores
        // clipout = clipin. Within snap, snap pulls clipin back, coincidence
        // holds, clipout stays at anchor.beat.
        //
        // Use a tiny drag (0.1) that's well within snap radius (8/16 = 0.5).
        const store = makeStore();
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
        store.dispatch(setActiveRegionId("r"));
        store.dispatch(addAnchor({ id: 1, time: 10 }));

        store.dispatch({ type: "lists/setListSelection", payload: { list: "clipin", ids: ["r"] } });
        store.dispatch({
            type: "lists/setListSelection",
            payload: { list: "clipout", ids: ["r"] },
        });

        store.dispatch(
            beginDrag({
                handle: { kind: "clip-in-edge", clipId: "r", space: "input" },
                pxPerUnit: 16,
            }),
        );
        store.dispatch(drag({ delta: 0.1, modifiers: { alt: false } }));
        store.dispatch(endDrag());

        const s = store.getState();
        const r = s.region.regions[0];
        // Snap holds clipin at 10. Coincidence still holds. clipout = anchor.beat = 10.
        expect(r.inPoint, "clipin.in held by snap").toBeCloseTo(10, 6);
        expect(r.inBeatTime, "clipout.in = anchor.beat (conform asserted)").toBeCloseTo(10, 6);
        expect(
            s.warp.beatAnchors.find((a) => a.id === 1)!.time,
            "anchor.beat untouched",
        ).toBeCloseTo(10, 6);
    });
});
