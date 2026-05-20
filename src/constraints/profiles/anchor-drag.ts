/**
 * ANCHOR_DRAG — single-anchor drag in either input or beat space.
 *
 * The user grabs one anchor (orig or beat side) without any structural
 * coupling — no warp-line, no conformed-input pairing, no linked clipout
 * edges. Drag translates that single anchor; the resolver handles all
 * downstream propagation:
 *   - Lasso TranslateGroup carries followers when other anchors / regions
 *     are co-selected (lasso:main installed from selection slices).
 *   - DirectedPair (orig→beat from initAnchorPair) carries the beat
 *     partner when the pair is linked and the user dragged the orig.
 *
 *   onDrag:        Move op on the dragged anchor's entity (anchorInId or
 *                  anchorOutId based on handle.space).
 *   whileDragging: SnapTarget on the dragged entity's `time` field. The
 *                  resolver's snap rules + cohorts (built by
 *                  buildGraphFromSlice) supply the actual snap targets.
 */

import { Field, OpKind } from "../types";
import { anchorInId, anchorOutId } from "../ids";
import { buildGestureSnapTarget } from "./snap";
import type { GestureProfile } from "./types";

function entityForHandle(handle: {
    kind: "anchor-drag";
    anchorId: number;
    space: "input" | "beat";
}): string {
    return handle.space === "input" ? anchorInId(handle.anchorId) : anchorOutId(handle.anchorId);
}

export const ANCHOR_DRAG: GestureProfile = {
    onDrag: (handle, delta) => {
        if (handle.kind !== "anchor-drag") return [];
        return [{ kind: OpKind.Move, id: entityForHandle(handle), delta }];
    },
    whileDragging: (handle, ctx, state) => {
        if (handle.kind !== "anchor-drag") return [];
        const snap = buildGestureSnapTarget({
            draggedId: entityForHandle(handle),
            field: Field.Time,
            state,
            pxPerUnit: ctx.pxPerUnit,
            grid: ctx.grid,
            gestureRole: "anchor",
            tag: `gesture:snap:${entityForHandle(handle)}`,
        });
        return snap ? [snap] : [];
    },
};
