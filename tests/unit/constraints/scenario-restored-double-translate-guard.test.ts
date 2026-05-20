/**
 * Restored from removed legacy test (Task 13):
 *   unit-translate-group-propagation.test.ts > "double-translate guard"
 *
 * Regression: when BOTH clipin and clipout of the same default-linked region
 * are in the lasso TranslateGroup, each entity must move EXACTLY ONCE for a
 * given primary Move — not twice (once via lasso TranslateGroup and once
 * via the default-link DirectedPair).
 *
 * Ported to the new architecture: lasso TranslateGroup is now derived
 * directly from slice.selection (warp + lists) inside buildGraphFromSlice.
 * No setLassoIds, no selectionGraphMirrorMiddleware. The guard lives in the
 * resolver's TranslateGroup/DirectedPair coordination.
 */

import { describe, it, expect } from "vitest";
import { makeStore } from "../../helpers/setup";
import { addRegion } from "../../../src/store/slices/regionSlice";
import { setListSelection } from "../../../src/store/slices/listsSlice";
import { applyRegionEntityMove } from "../../../src/store/thunks/entityWriteThunks";
import { selectConstraintGraph } from "../../../src/store/selectors/constraintGraph";
import type { RootState } from "../../../src/store/store";

function clipBounds(
    store: ReturnType<typeof makeStore>,
    entityId: string,
): { in: number; out: number } {
    const graph = selectConstraintGraph(store.getState() as RootState);
    const e = graph.entities[entityId];
    if (!e || e.kind !== "clip" || e.in === undefined || e.out === undefined) {
        throw new Error(`Entity ${entityId} not found or not a clip`);
    }
    return { in: e.in, out: e.out };
}

describe("Restored: double-translate guard — clipin AND clipout in same lasso", () => {
    it("default-linked regions: each entity moves exactly +delta (not +2*delta)", () => {
        const store = makeStore();
        store.dispatch(
            addRegion({
                id: "r1",
                name: "R1",
                inPoint: 10,
                outPoint: 20,
                inBeatTime: 10,
                outBeatTime: 20,
                defaultLinked: true,
                bpm: 120,
                minStretch: 0.5,
                maxStretch: 2.0,
            }),
        );
        store.dispatch(
            addRegion({
                id: "r2",
                name: "R2",
                inPoint: 30,
                outPoint: 40,
                inBeatTime: 30,
                outBeatTime: 40,
                defaultLinked: true,
                bpm: 120,
                minStretch: 0.5,
                maxStretch: 2.0,
            }),
        );

        // Select all four entities: clipin AND clipout of both regions. The
        // lasso TranslateGroup is derived from these selections in buildGraph-
        // FromSlice — it will contain [r1-in, r2-in, r1-out, r2-out].
        store.dispatch(setListSelection({ list: "clipin", ids: ["r1", "r2"] }));
        store.dispatch(setListSelection({ list: "clipout", ids: ["r1", "r2"] }));

        // Move r1 by +5. The resolver must coordinate the lasso TranslateGroup
        // and the default-link DirectedPair so each entity ends up at +5, not +10.
        store.dispatch(applyRegionEntityMove({ id: "r1", delta: 5 }));

        expect(clipBounds(store, "r1-in")).toEqual({ in: 15, out: 25 });
        expect(clipBounds(store, "r2-in")).toEqual({ in: 35, out: 45 });
        expect(clipBounds(store, "r1-out")).toEqual({ in: 15, out: 25 });
        expect(clipBounds(store, "r2-out")).toEqual({ in: 35, out: 45 });
    });
});
