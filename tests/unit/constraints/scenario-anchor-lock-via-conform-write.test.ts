/**
 * Regression: when anchor-lock is ON and the user moves anchor.out (= the
 * beat side of an edge-conformed anchor), ConformVisual writes the
 * matching clipout edge. The lock TranslateGroup / ScaleGroup that
 * watches the clipout (with driver=clipOutId) must propagate the
 * resulting clipout change to inner anchors — locking should be a
 * property of "clipout moved," not "the user grabbed clipout."
 *
 * Bug: findTranslateDelta filtered out ConformVisual's tagged writes,
 * so the lock group saw no driver delta and didn't propagate.
 *
 * Fix: the driver's write counts regardless of seedTag.
 */

import { describe, it, expect } from "vitest";
import { makeStore } from "../../helpers/setup";
import { addRegion, setActiveRegionId } from "../../../src/store/slices/regionSlice";
import { addAnchor } from "../../../src/store/slices/warpSlice";
import { setAnchorLock, setLockMode } from "../../../src/store/slices/uiSlice";
import { beginDrag, drag, endDrag } from "../../../src/store/thunks/dragThunks";
import type { Region } from "../../../src/types";

function setupLockedTranslate(): ReturnType<typeof makeStore> {
    // Region [10, 30] default-linked. Three anchors:
    //   A1 (10, 10) — on clipout.in edge (conformed)
    //   A2 (20, 20) — inside the region (inner anchor)
    //   A3 (30, 30) — on clipout.out edge (conformed)
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
    store.dispatch(addAnchor({ id: 2, time: 20 }));
    store.dispatch(addAnchor({ id: 3, time: 30 }));
    // Turn anchor-lock ON, lockMode='beats' (the case the user reported).
    // 'beats' installs lockOn(clipOut, innerAnchors) → both TranslateGroup
    // AND ScaleGroup with driver=clipOut. A single-edge clipout write
    // (from ConformVisual) triggers ScaleGroup which rescales inner
    // anchors around the un-written edge.
    store.dispatch(setAnchorLock(true));
    store.dispatch(setLockMode("beats"));
    return store;
}

function setupLockedTranslateMode(mode: "bpm" | "beats"): ReturnType<typeof makeStore> {
    const store = setupLockedTranslate();
    store.dispatch(setLockMode(mode));
    return store;
}

describe("Anchor-lock follows clipout writes regardless of source", () => {
    it("lockMode=bpm: dragging A1.beat translates inner A2 via the lock TranslateGroup (driver accepts tagged write)", () => {
        // lockMode='bpm' installs a single TranslateGroup [clipOut, ...inner]
        // with driver=clipOut. It needs both clipout edges to move (translate-
        // shape). When user drags BOTH A1.beat AND A3.beat in a pair-like
        // motion, ConformVisual writes both clipout edges. findTranslateDelta
        // must accept driver writes regardless of seedTag for the lock to fire.
        const store = setupLockedTranslateMode("bpm");
        // Lasso the two edge anchors' beat sides so a single anchor-drag on A1
        // propagates to A3 via the lasso TranslateGroup.
        store.dispatch({ type: "warp/setSelectedBeatIds", payload: [1, 3] });
        store.dispatch(
            beginDrag({
                handle: { kind: "anchor-drag", anchorId: 1, space: "beat" },
                pxPerUnit: 100,
            }),
        );
        store.dispatch(drag({ delta: 2, modifiers: { alt: false } }));
        store.dispatch(endDrag());

        const s = store.getState();
        const r = s.region.regions[0];
        expect(s.warp.beatAnchors.find((a) => a.id === 1)!.time, "A1.beat at 12").toBeCloseTo(
            12,
            6,
        );
        expect(s.warp.beatAnchors.find((a) => a.id === 3)!.time, "A3.beat at 32").toBeCloseTo(
            32,
            6,
        );
        expect(r.inBeatTime, "clipout.in followed via conform").toBeCloseTo(12, 6);
        expect(r.outBeatTime, "clipout.out followed via conform").toBeCloseTo(32, 6);
        // Lock translate carries A2 by +2.
        expect(
            s.warp.beatAnchors.find((a) => a.id === 2)!.time,
            "A2 translated by +2 via lock",
        ).toBeCloseTo(22, 6);
    });

    it("symmetric: dragging clipout.in directly OR dragging A1.beat both rescale A2", () => {
        // Symmetry check: both drag paths should produce identical effects on
        // the inner anchor under lockMode='beats'.

        // Path 1: drag clipout.in directly. With ConformRedirect, this becomes
        // a write on A1.beat → ConformVisual writes clipout.in → ScaleGroup
        // rescales inner anchors.
        const store1 = setupLockedTranslate();
        store1.dispatch(
            beginDrag({
                handle: { kind: "clip-in-edge", clipId: "r", space: "beat" },
                pxPerUnit: 100,
            }),
        );
        store1.dispatch(drag({ delta: 2, modifiers: { alt: false } }));
        store1.dispatch(endDrag());
        const after1 = store1.getState();

        // Path 2: drag A1.beat (output-space anchor handle). ConformVisual
        // writes clipout.in.
        const store2 = setupLockedTranslate();
        store2.dispatch(
            beginDrag({
                handle: { kind: "anchor-drag", anchorId: 1, space: "beat" },
                pxPerUnit: 100,
            }),
        );
        store2.dispatch(drag({ delta: 2, modifiers: { alt: false } }));
        store2.dispatch(endDrag());
        const after2 = store2.getState();

        // Both paths must reach the same final A2 position.
        expect(
            after1.warp.beatAnchors.find((a) => a.id === 2)!.time,
            "path 1 — A2 after clipout drag",
        ).toBeCloseTo(21, 6);
        expect(
            after2.warp.beatAnchors.find((a) => a.id === 2)!.time,
            "path 2 — A2 after anchor.beat drag",
        ).toBeCloseTo(21, 6);
        expect(after1.warp.beatAnchors.find((a) => a.id === 2)!.time).toBeCloseTo(
            after2.warp.beatAnchors.find((a) => a.id === 2)!.time,
            6,
        );
    });

    it("dragging anchor.out (the beat side of edge-conformed A1) carries the inner anchor", () => {
        const store = setupLockedTranslate();
        // Baseline inner anchor.beat (A2) should be 20.
        expect(store.getState().warp.beatAnchors.find((a) => a.id === 2)!.time).toBeCloseTo(20, 6);

        // Drag the beat side of A1 by +2. Pre-drag: anchor.beat (A1) = 10,
        // clipout.in = 10. ConformVisual will write clipout.in = anchor.beat
        // each pass.
        //   - Without the fix: clipout.in moves to 12 (conform-tagged), but
        //     the lock TranslateGroup with driver=clipout ignores tagged
        //     writes → inner anchor A2 stays at 20.
        //   - With the fix: the lock group accepts the tagged driver write →
        //     A2 translates with clipout → 22.
        store.dispatch(
            beginDrag({
                handle: { kind: "anchor-drag", anchorId: 1, space: "beat" },
                pxPerUnit: 100,
            }),
        );
        store.dispatch(drag({ delta: 2, modifiers: { alt: false } }));
        store.dispatch(endDrag());

        const s = store.getState();
        const r = s.region.regions[0];
        expect(s.warp.beatAnchors.find((a) => a.id === 1)!.time, "A1.beat moved to 12").toBeCloseTo(
            12,
            6,
        );
        expect(r.inBeatTime, "clipout.in followed A1.beat via conform").toBeCloseTo(12, 6);
        // The key assertion: A2 (inner anchor) was rescaled around clipout.out
        // (the un-moved edge, pivot=30). Pre-drag clipout=[10,30], length=20,
        // A2 at 20 (10 + half of 20). After drag clipout=[12,30], length=18.
        // A2's relative position (0.5) → 12 + 0.5*18 = 21.
        expect(
            s.warp.beatAnchors.find((a) => a.id === 2)!.time,
            "A2 rescaled via lock ScaleGroup",
        ).toBeCloseTo(21, 6);
    });
});
