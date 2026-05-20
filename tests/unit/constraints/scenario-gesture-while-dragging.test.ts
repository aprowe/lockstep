/**
 * The pipeline injects each GestureProfile.whileDragging constraint into
 * the graph for as long as `state.gesture.activeHandle` points at that
 * handle kind. Clearing the handle removes them on the next build. No
 * install/teardown ops.
 */

import { describe, it, expect, afterEach } from "vitest";
import { makeStore } from "../../helpers/setup";
import { addAnchor } from "../../../src/store/slices/warpSlice";
import { beginDrag, endDrag } from "../../../src/store/thunks/dragThunks";
import { PROFILES } from "../../../src/constraints/profiles";
import type { GestureProfile, Handle } from "../../../src/constraints/profiles/types";
import { ConstraintKind } from "../../../src/constraints/types";
import { buildGraphFromSlice, extractDragCtxFromSlice } from "../../../src/constraints/pipeline";
import { extractSliceForPipeline } from "../../../src/constraints/pipelineDispatch";

const TEST_HANDLE_KIND = "pair-drag"; // borrow an existing kind; profile is swapped below

describe("gesture-scoped whileDragging extension", () => {
    let savedProfile: GestureProfile | undefined;

    afterEach(() => {
        if (savedProfile === undefined) {
            delete (PROFILES as Record<string, GestureProfile | undefined>)[TEST_HANDLE_KIND];
        } else {
            (PROFILES as Record<string, GestureProfile>)[TEST_HANDLE_KIND] = savedProfile;
        }
        savedProfile = undefined;
    });

    it("inserts profile.whileDragging constraints while activeHandle is set; removes when cleared", () => {
        savedProfile = (PROFILES as Record<string, GestureProfile | undefined>)[TEST_HANDLE_KIND];
        (PROFILES as Record<string, GestureProfile>)[TEST_HANDLE_KIND] = {
            onDrag: () => [],
            whileDragging: () => [
                { kind: ConstraintKind.SnapCohort, tag: "gesture-test-marker", ids: [] },
            ],
        };

        const store = makeStore();
        store.dispatch(addAnchor({ id: 1, time: 5 }));
        store.dispatch(beginDrag({ handle: { kind: TEST_HANDLE_KIND, pairId: 1 } as Handle }));

        let state = store.getState();
        let slice = extractSliceForPipeline(state);
        let dragCtx = extractDragCtxFromSlice(state as never);
        let graph = buildGraphFromSlice(slice, dragCtx);

        const present = graph.constraints.some(
            (c) =>
                c.kind === ConstraintKind.SnapCohort &&
                (c as { tag?: string }).tag === "gesture-test-marker",
        );
        expect(present, "gesture marker constraint present while dragging").toBe(true);

        store.dispatch(endDrag());

        state = store.getState();
        slice = extractSliceForPipeline(state);
        dragCtx = extractDragCtxFromSlice(state as never);
        graph = buildGraphFromSlice(slice, dragCtx);

        const stillPresent = graph.constraints.some(
            (c) =>
                c.kind === ConstraintKind.SnapCohort &&
                (c as { tag?: string }).tag === "gesture-test-marker",
        );
        expect(stillPresent, "gesture marker gone after endDrag").toBe(false);
    });
});
