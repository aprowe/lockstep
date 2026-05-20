/**
 * Profile helper — wraps `snapToSiblings` for use inside whileDragging.
 *
 * snapToSiblings returns an AddConstraint Op carrying a SnapTarget. The
 * profile system wants the SnapTarget constraint directly so it can be
 * merged into the graph via the gesture-extension step.
 *
 * `pixelThreshold` defaults to 8 — the same default WarpView's onSnapStart
 * callback used. When `pxPerUnit` is 0 (no controller-supplied conversion
 * — e.g., in unit tests), the threshold falls back to a sensible
 * time-space default (4 units) so the SnapTarget is still well-defined.
 */

import type { Constraint, EntityId, Field, State } from "../types";
import { ConstraintKind, OpKind } from "../types";
import { snapToSiblings } from "../recipes";

const DEFAULT_PIXEL_THRESHOLD = 8;
const FALLBACK_TIME_THRESHOLD = 4;

export function buildGestureSnapTarget(opts: {
    draggedId: EntityId;
    field: Field;
    state: State;
    pxPerUnit: number;
    grid?: { interval: number; offset: number };
    gestureRole?: "edge" | "body" | "anchor";
    tag?: string;
}): Constraint | null {
    const op = snapToSiblings(
        opts.draggedId,
        opts.field,
        opts.state,
        opts.pxPerUnit || 1, // avoid divide-by-zero; threshold computed below
        DEFAULT_PIXEL_THRESHOLD,
        opts.grid,
        opts.gestureRole,
    );
    if (op.kind !== OpKind.AddConstraint || op.constraint.kind !== ConstraintKind.SnapTarget) {
        return null;
    }
    const snap = op.constraint;
    // If pxPerUnit was 0 (no controller info), snapToSiblings produced a
    // bogus pixel-derived threshold. Replace with the fallback so behavior
    // is sane in unit / scenario contexts.
    const threshold = opts.pxPerUnit > 0 ? snap.threshold : FALLBACK_TIME_THRESHOLD;
    return {
        kind: ConstraintKind.SnapTarget,
        id: snap.id,
        field: snap.field,
        targets: snap.targets,
        threshold,
        grid: snap.grid,
        mode: snap.mode,
        tag: opts.tag ?? snap.tag,
    };
}
