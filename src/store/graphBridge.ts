/**
 * Phase 1 bridge between slice metadata and the constraint graph.
 *
 * Slices hold IDs + non-position metadata. The constraint graph holds the
 * authoritative position for every anchor and region edge. These helpers
 * keep the two in sync:
 *
 *   buildSeedGraph()      — construct a fresh constraint State from an
 *                           anchor/region snapshot (load paths).
 *   anchorEntityOp(…)     — translate a slice-shaped anchor mutation into
 *                           a constraint Op for `applyOp` dispatch.
 *   regionEntityOps(…)    — translate a region edit into the appropriate
 *                           SetEdge ops.
 *
 * The graph in Phase 1 carries NO constraints — just entities. The resolver
 * therefore runs but performs no propagation. Future phases add constraints.
 */

import { emptyState, type State as ConstraintState, OpKind } from "../constraints";
import { anchorInId, anchorOutId, regionInId, regionOutId } from "../constraints/ids";
import type {
    AddAnchorOp,
    AddClipOp,
    DeleteOp,
    EntityId,
    SetEdgeOp,
    SetValueOp,
} from "../constraints";
import type { Anchor, Region } from "../types";

// ─── Seed the graph from current slice state ──────────────────────────────

/**
 * Build a constraint State that mirrors the given anchor + region snapshot.
 * Used on initial load, undo/redo restore, video switch, etc.
 *
 * Anchors: each anchor id N becomes two entities — `a{N}-in` (time=origTime)
 * and `a{N}-out` (time=beatTime).
 *
 * Regions: each region id S becomes two clip entities — `{S}-in`
 * (in=inPoint, out=outPoint) and `{S}-out` (in=inBeatTime ?? inPoint,
 * out=outBeatTime ?? outPoint).
 */
export function buildSeedGraph(
    origAnchors: readonly Anchor[],
    beatAnchors: readonly Anchor[],
    regions: readonly Region[],
): ConstraintState {
    const state = emptyState();

    // Anchors — pair `a{N}-in` (orig) with `a{N}-out` (beat).
    for (const a of origAnchors) {
        state.entities[anchorInId(a.id)] = {
            kind: "anchor",
            id: anchorInId(a.id),
            time: a.time,
        };
    }
    for (const a of beatAnchors) {
        state.entities[anchorOutId(a.id)] = {
            kind: "anchor",
            id: anchorOutId(a.id),
            time: a.time,
        };
    }

    // Regions — clipin holds input bounds; clipout holds beat-space bounds.
    // Also seed meta[clipoutId] with bpm/lockedBeats so the bpmDerivedConstraint
    // (installed by the middleware after setGraph) has initial values to work with.
    for (const r of regions) {
        state.entities[regionInId(r.id)] = {
            kind: "clip",
            id: regionInId(r.id),
            in: r.inPoint,
            out: r.outPoint,
        };
        state.entities[regionOutId(r.id)] = {
            kind: "clip",
            id: regionOutId(r.id),
            in: r.inBeatTime,
            out: r.outBeatTime,
        };
        if (typeof r.bpm === "number" || typeof r.lockedBeats === "number") {
            state.meta[regionOutId(r.id)] = {
                ...(typeof r.bpm === "number" ? { bpm: r.bpm } : {}),
                ...(typeof r.lockedBeats === "number" ? { lockedBeats: r.lockedBeats } : {}),
            };
        }
    }

    return state;
}

// ─── Ops for individual mutations ─────────────────────────────────────────

export function addAnchorOps(id: number, origTime: number, beatTime: number): AddAnchorOp[] {
    return [
        { kind: OpKind.AddAnchor, id: anchorInId(id), time: origTime },
        { kind: OpKind.AddAnchor, id: anchorOutId(id), time: beatTime },
    ];
}

export function deleteAnchorOps(id: number): DeleteOp[] {
    return [
        { kind: OpKind.Delete, id: anchorInId(id) },
        { kind: OpKind.Delete, id: anchorOutId(id) },
    ];
}

export function setAnchorOrigTimeOp(id: number, time: number): SetValueOp {
    return {
        kind: OpKind.SetValue,
        id: anchorInId(id),
        field: "time",
        value: time,
    };
}

export function setAnchorBeatTimeOp(id: number, time: number): SetValueOp {
    return {
        kind: OpKind.SetValue,
        id: anchorOutId(id),
        field: "time",
        value: time,
    };
}

export function addRegionOps(region: Region): AddClipOp[] {
    return [
        {
            kind: OpKind.AddClip,
            id: regionInId(region.id),
            in: region.inPoint,
            out: region.outPoint,
        },
        {
            kind: OpKind.AddClip,
            id: regionOutId(region.id),
            in: region.inBeatTime,
            out: region.outBeatTime,
        },
    ];
}

export function deleteRegionOps(id: string): DeleteOp[] {
    return [
        { kind: OpKind.Delete, id: regionInId(id) },
        { kind: OpKind.Delete, id: regionOutId(id) },
    ];
}

/** Update a clipin (input-space) region edge. */
export function setRegionInEdgeOp(id: string, edge: "in" | "out", value: number): SetEdgeOp {
    return {
        kind: OpKind.SetEdge,
        id: regionInId(id),
        edge,
        value,
    };
}

/** Update a clipout (beat-space) region edge. */
export function setRegionOutEdgeOp(id: string, edge: "in" | "out", value: number): SetEdgeOp {
    return {
        kind: OpKind.SetEdge,
        id: regionOutId(id),
        edge,
        value,
    };
}

// ─── Pure read helpers (used by selectors) ────────────────────────────────

/** Return the `time` of an anchor entity in the graph, or `undefined`. */
export function readAnchorTime(graph: ConstraintState, entityId: EntityId): number | undefined {
    const e = graph.entities[entityId];
    return e && e.kind === "anchor" ? e.time : undefined;
}

/** Return `{ in, out }` for a clip entity in the graph, or `undefined`. */
export function readClipBounds(
    graph: ConstraintState,
    entityId: EntityId,
): { in: number; out: number } | undefined {
    const e = graph.entities[entityId];
    return e && e.kind === "clip" ? { in: e.in, out: e.out } : undefined;
}
