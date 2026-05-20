/**
 * CLIP_BODY_DRAG — drag a clip (region) body (translate; both edges move).
 *
 * Either the clipin (input-space, regionInId) or clipout (output-space,
 * regionOutId) can be dragged depending on handle.space. The Move op
 * seeds both `in` and `out` writes simultaneously (signaling translate
 * to the resolver) so the lasso:main TranslateGroup propagates the
 * delta to other selected clip entities.
 *
 *   onDrag:        Move op on the clip entity (in/out both move by delta).
 *   whileDragging: SnapTarget on the clip's `in` field, mode='body'. In
 *                  body mode the SnapTarget snap handler aligns the
 *                  rigid clip body by either edge's nearest target.
 */

import { ConstraintKind, Field, OpKind, type Constraint } from "../types";
import { regionInId, regionOutId } from "../ids";
import { innerBeatAnchorIds } from "./inner-anchors";
import { buildGestureSnapTarget } from "./snap";
import type { GestureProfile } from "./types";

function entityForHandle(handle: {
    kind: "clip-body";
    clipId: string;
    space: "input" | "beat";
}): string {
    return handle.space === "input" ? regionInId(handle.clipId) : regionOutId(handle.clipId);
}

export const CLIP_BODY_DRAG: GestureProfile = {
    onDrag: (handle, delta) => {
        if (handle.kind !== "clip-body") return [];
        return [{ kind: OpKind.Move, id: entityForHandle(handle), delta }];
    },
    whileDragging: (handle, ctx, state) => {
        if (handle.kind !== "clip-body") return [];
        const driver = entityForHandle(handle);
        const cs: Constraint[] = [];
        const snap = buildGestureSnapTarget({
            draggedId: driver,
            field: Field.In,
            state,
            pxPerUnit: ctx.pxPerUnit,
            grid: ctx.grid,
            gestureRole: "body",
            tag: `gesture:snap:${driver}`,
        });
        if (snap) cs.push(snap);

        // Anchor-lock segment — clipout body drags only (input-space body
        // drags don't lock inner beat anchors; clipin moves independently
        // from beat-space). Lock active when ui.anchorLock XOR modifiers.alt.
        if (handle.space === "beat") {
            const lockActive = ctx.ui.anchorLock !== ctx.modifiers.alt;
            if (lockActive) {
                const region = ctx.preDrag.regions.find((r) => r.id === handle.clipId);
                if (region) {
                    const inner = innerBeatAnchorIds(
                        ctx.preDrag.beatAnchors,
                        region.inBeatTime,
                        region.outBeatTime,
                    );
                    if (inner.length > 0) {
                        cs.push({
                            kind: ConstraintKind.TranslateGroup,
                            ids: [driver, ...inner],
                            driver,
                            tag: `gesture:lock:${driver}`,
                        });
                        if (ctx.ui.lockMode === "beats") {
                            cs.push({
                                kind: ConstraintKind.ScaleGroup,
                                ids: [driver, ...inner],
                                driver,
                                tag: `gesture:lock:${driver}`,
                            });
                        }
                    }
                }
            }
        }
        return cs;
    },
};
