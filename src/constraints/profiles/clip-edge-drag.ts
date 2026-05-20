/**
 * CLIP_EDGE_DRAG — resize a clip by dragging one of its edges.
 *
 * Handle distinguishes which edge ('in' or 'out') and which space
 * (clipin vs clipout). Op is SetEdge with the new value = preDrag edge
 * + delta. Snap target is edge-mode (snap only the dragged field).
 *
 *   onDrag:        SetEdge op writing the target edge to preDrag value
 *                  plus delta. The pipeline's snap + MirrorEdge / conform
 *                  constraints handle propagation.
 *   whileDragging: SnapTarget on the dragged field, mode='edge'.
 */

import { ConstraintKind, Field, OpKind, type Constraint } from "../types";
import { regionInId, regionOutId } from "../ids";
import { innerBeatAnchorIds } from "./inner-anchors";
import { buildGestureSnapTarget } from "./snap";
import type { GestureProfile } from "./types";

type EdgeHandle =
    | { kind: "clip-in-edge"; clipId: string; space: "input" | "beat" }
    | { kind: "clip-out-edge"; clipId: string; space: "input" | "beat" };

function isEdgeHandle(h: { kind: string }): h is EdgeHandle {
    return h.kind === "clip-in-edge" || h.kind === "clip-out-edge";
}

function entityForHandle(h: EdgeHandle): string {
    return h.space === "input" ? regionInId(h.clipId) : regionOutId(h.clipId);
}

function edgeOfHandle(h: EdgeHandle): "in" | "out" {
    return h.kind === "clip-in-edge" ? "in" : "out";
}

function preDragEdgeValue(
    h: EdgeHandle,
    ctx: {
        preDrag: {
            regions: ReadonlyArray<{
                id: string;
                inPoint: number;
                outPoint: number;
                inBeatTime: number;
                outBeatTime: number;
            }>;
        };
    },
): number | undefined {
    const r = ctx.preDrag.regions.find((rr) => rr.id === h.clipId);
    if (!r) return undefined;
    const edge = edgeOfHandle(h);
    if (h.space === "input") return edge === "in" ? r.inPoint : r.outPoint;
    return edge === "in" ? r.inBeatTime : r.outBeatTime;
}

export const CLIP_EDGE_DRAG: GestureProfile = {
    onDrag: (handle, delta, ctx) => {
        if (!isEdgeHandle(handle)) return [];
        const baseline = preDragEdgeValue(handle, ctx);
        if (baseline === undefined) return [];
        return [
            {
                kind: OpKind.SetEdge,
                id: entityForHandle(handle),
                edge: edgeOfHandle(handle),
                value: baseline + delta,
            },
        ];
    },
    whileDragging: (handle, ctx, state) => {
        if (!isEdgeHandle(handle)) return [];
        const driver = entityForHandle(handle);
        const edge = edgeOfHandle(handle);
        const cs: Constraint[] = [];
        const snap = buildGestureSnapTarget({
            draggedId: driver,
            field: edge === "in" ? Field.In : Field.Out,
            state,
            pxPerUnit: ctx.pxPerUnit,
            grid: ctx.grid,
            gestureRole: "edge",
            tag: `gesture:snap:${driver}:${edge}`,
        });
        if (snap) cs.push(snap);

        // Anchor-lock segment for clipout edge drags (beat space only).
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
