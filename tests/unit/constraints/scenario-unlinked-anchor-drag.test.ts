/**
 * After explicitly unlinking an anchor pair (via dragging the beat side),
 * dragging the orig must NOT move the beat anymore.
 */

import { describe, it, expect } from "vitest";
import { makeStore } from "../../helpers/setup";
import { addAnchor, moveBeatAnchor } from "../../../src/store/slices/warpSlice";
import { applyAnchorEntityMove } from "../../../src/store/thunks/entityWriteThunks";
import { dragStart } from "../../../src/store/slices/dragSlice";
import { snapshotPreDragState } from "../../../src/store/thunks/dragThunks";

describe("Explicitly unlinked anchor: orig drag does not pull beat", () => {
    it("after moveBeatAnchor (programmatic unlink), dragging orig keeps beat in place", () => {
        const store = makeStore();
        store.dispatch(addAnchor({ id: 1, time: 5 }));
        store.dispatch(moveBeatAnchor({ id: 1, time: 10 }));

        const beat = store.getState().warp.beatAnchors.find((a) => a.id === 1);
        expect(beat?.linked).toBe(false);
        expect(beat?.time).toBeCloseTo(10, 6);

        store.dispatch(dragStart(snapshotPreDragState(store.getState())));
        store.dispatch(applyAnchorEntityMove({ entityId: "a1-in", time: 8 }));

        const s = store.getState();
        expect(s.warp.origAnchors.find((a) => a.id === 1)?.time, "orig moved to 8").toBeCloseTo(
            8,
            6,
        );
        expect(
            s.warp.beatAnchors.find((a) => a.id === 1)?.time,
            "beat must stay at 10",
        ).toBeCloseTo(10, 6);
    });

    it("after beat-anchor DRAG diverges the pair, dragging orig keeps beat in place", () => {
        // Production drag path: applyAnchorEntityMove on the beat side must mark
        // the pair unlinked so a subsequent orig drag does not pull it.
        const store = makeStore();
        store.dispatch(addAnchor({ id: 1, time: 5 }));

        // Drag the beat anchor from 5 → 10 (via the controller's entity-move path).
        store.dispatch(dragStart(snapshotPreDragState(store.getState())));
        store.dispatch(applyAnchorEntityMove({ entityId: "a1-out", time: 10 }));

        // After the beat drag, the slice must record linked=false.
        const beatAfterBeatDrag = store.getState().warp.beatAnchors.find((a) => a.id === 1);
        expect(beatAfterBeatDrag?.linked, "pair must be marked unlinked after beat drag").toBe(
            false,
        );
        expect(beatAfterBeatDrag?.time).toBeCloseTo(10, 6);

        // Now drag the orig — beat must NOT follow.
        store.dispatch(dragStart(snapshotPreDragState(store.getState())));
        store.dispatch(applyAnchorEntityMove({ entityId: "a1-in", time: 8 }));

        const s = store.getState();
        expect(s.warp.origAnchors.find((a) => a.id === 1)?.time, "orig moved to 8").toBeCloseTo(
            8,
            6,
        );
        expect(
            s.warp.beatAnchors.find((a) => a.id === 1)?.time,
            "beat must stay at 10",
        ).toBeCloseTo(10, 6);
    });
});
