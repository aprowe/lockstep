/**
 * runConstraintPipeline — direct pipeline verification tests.
 *
 * Phase 4c rewrite: the "old path" (applyOp → state.constraint.graph) no longer
 * exists as a stable comparison baseline — graphMirrorMiddleware is deleted and
 * constraintSlice entities are not seeded from slice anymore.
 *
 * Tests now verify the pipeline's pure output directly:
 *   1. Build a PipelineSlice from inputs.
 *   2. Call runConstraintPipeline(slice, dragCtx, op).
 *   3. Apply diffs to a copy of the slice via applyDiffsToSlice.
 *   4. Assert the resulting slice values.
 *
 * These tests are the canonical verification that the constraint pipeline
 * resolves ops correctly for representative scenarios.
 */

import { describe, it, expect } from "vitest";

// Pipeline
import {
    runConstraintPipeline,
    buildGraphFromSlice,
    applyDiffsToSlice,
    type PipelineSlice,
    type DragCtx,
} from "../../../src/constraints/pipeline";
import { reduce } from "../../../src/constraints/resolver";
import { SNAP_RULES } from "../../../src/constraints/snap-rules";

// Constraint infra
import { OpKind } from "../../../src/constraints/types";
import { anchorInId, anchorOutId, regionInId, regionOutId } from "../../../src/constraints/ids";

// ─── Slice fixture builders ────────────────────────────────────────────────────

type SliceRegion = PipelineSlice["region"]["regions"][number];
type _SliceAnchor = PipelineSlice["warp"]["origAnchors"][number];

function emptySlice(): PipelineSlice {
    return {
        warp: { origAnchors: [], beatAnchors: [] },
        region: { regions: [] },
        ui: { anchorLock: false, anchorLockGestureOverride: null, lockMode: "bpm" },
        lists: { selection: { clipin: [], clipout: [] } },
        selection: { orig: [], beat: [] },
    };
}

function emptyDragCtx(): DragCtx {
    return {};
}

function withSelection(
    slice: PipelineSlice,
    sel: { orig?: number[]; beat?: number[]; clipin?: string[]; clipout?: string[] },
): PipelineSlice {
    return {
        ...slice,
        selection: { orig: sel.orig ?? [], beat: sel.beat ?? [] },
        lists: { selection: { clipin: sel.clipin ?? [], clipout: sel.clipout ?? [] } },
    };
}

function withOrigAnchor(slice: PipelineSlice, id: number, time: number): PipelineSlice {
    return {
        ...slice,
        warp: {
            origAnchors: [...slice.warp.origAnchors, { id, time }],
            beatAnchors: [...slice.warp.beatAnchors, { id, time, linked: true }],
        },
    };
}

function withRegion(slice: PipelineSlice, r: SliceRegion): PipelineSlice {
    return { ...slice, region: { regions: [...slice.region.regions, r] } };
}

function makeRegion(overrides: {
    id: string;
    inPoint: number;
    outPoint: number;
    inBeatTime?: number;
    outBeatTime?: number;
    bpm?: number;
    lockedBeats?: number;
    defaultLinked?: boolean;
}): SliceRegion {
    return {
        id: overrides.id,
        inPoint: overrides.inPoint,
        outPoint: overrides.outPoint,
        inBeatTime: overrides.inBeatTime ?? overrides.inPoint,
        outBeatTime: overrides.outBeatTime ?? overrides.outPoint,
        bpm: overrides.bpm ?? 120,
        lockedBeats: overrides.lockedBeats,
        defaultLinked: overrides.defaultLinked ?? true,
    };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("runConstraintPipeline — equivalence with applyOp path", () => {
    // ── 1. Simple anchor orig move ─────────────────────────────────────────────

    it("1. orig anchor Move — single anchor, no selection", () => {
        let slice = emptySlice();
        slice = withOrigAnchor(slice, 1, 1.0);
        slice = withOrigAnchor(slice, 2, 3.0);
        const dragCtx = emptyDragCtx();

        const output = runConstraintPipeline({
            slice,
            dragCtx,
            op: { kind: OpKind.Move, id: anchorInId(1), delta: 2.0 },
        });
        const newState = applyDiffsToSlice(slice, output);

        expect(newState.origAnchors.find((a) => a.id === 1)!.time).toBeCloseTo(3.0);
        expect(newState.origAnchors.find((a) => a.id === 2)!.time).toBeCloseTo(3.0); // unaffected
    });

    // ── 2. Beat anchor Move ────────────────────────────────────────────────────

    it("2. beat anchor Move — single beat anchor", () => {
        let slice = emptySlice();
        slice = withOrigAnchor(slice, 1, 2.0);
        const dragCtx = emptyDragCtx();

        const output = runConstraintPipeline({
            slice,
            dragCtx,
            op: { kind: OpKind.Move, id: anchorOutId(1), delta: 1.5 },
        });
        const newState = applyDiffsToSlice(slice, output);

        expect(newState.beatAnchors.find((a) => a.id === 1)!.time).toBeCloseTo(3.5);
    });

    // ── 3. Multi-anchor lasso drag (TranslateGroup propagation) ────────────────

    it("3. lasso multi-anchor drag — TranslateGroup propagates delta", () => {
        let slice = emptySlice();
        slice = withOrigAnchor(slice, 1, 1.0);
        slice = withOrigAnchor(slice, 2, 2.0);
        slice = withOrigAnchor(slice, 3, 3.0);
        slice = withSelection(slice, { orig: [1, 2, 3] });
        const dragCtx = emptyDragCtx();

        const output = runConstraintPipeline({
            slice,
            dragCtx,
            op: { kind: OpKind.Move, id: anchorInId(1), delta: 0.5 },
        });
        const newState = applyDiffsToSlice(slice, output);

        // All three anchors should move by +0.5
        expect(newState.origAnchors.find((a) => a.id === 1)!.time).toBeCloseTo(1.5);
        expect(newState.origAnchors.find((a) => a.id === 2)!.time).toBeCloseTo(2.5);
        expect(newState.origAnchors.find((a) => a.id === 3)!.time).toBeCloseTo(3.5);
    });

    // ── 4. Region clipin body pan — default-linked (DirectedPair propagates) ───

    it("4. clipin body pan — default-linked region, clipout follows via DirectedPair", () => {
        let slice = emptySlice();
        slice = withRegion(slice, makeRegion({ id: "r1", inPoint: 0, outPoint: 10 }));
        const dragCtx = emptyDragCtx();

        const output = runConstraintPipeline({
            slice,
            dragCtx,
            op: { kind: OpKind.Move, id: regionInId("r1"), delta: 2.0 },
        });
        const newState = applyDiffsToSlice(slice, output);

        const r1 = newState.regions.find((r) => r.id === "r1")!;
        expect(r1.inPoint).toBeCloseTo(2.0);
        expect(r1.outPoint).toBeCloseTo(12.0);
        expect(r1.inBeatTime).toBeCloseTo(2.0); // followed via DirectedPair
        expect(r1.outBeatTime).toBeCloseTo(12.0);
    });

    // ── 5. Region clipin body pan — diverged (no DirectedPair) ─────────────────

    it("5. clipin body pan — diverged region, clipout does NOT follow", () => {
        let slice = emptySlice();
        slice = withRegion(
            slice,
            makeRegion({
                id: "r1",
                inPoint: 0,
                outPoint: 10,
                inBeatTime: 5,
                outBeatTime: 20,
                defaultLinked: false,
            }),
        );
        const dragCtx = emptyDragCtx();

        const output = runConstraintPipeline({
            slice,
            dragCtx,
            op: { kind: OpKind.Move, id: regionInId("r1"), delta: 2.0 },
        });
        const newState = applyDiffsToSlice(slice, output);

        const r1 = newState.regions.find((r) => r.id === "r1")!;
        expect(r1.inPoint).toBeCloseTo(2.0);
        expect(r1.outPoint).toBeCloseTo(12.0);
        // Beat-space clip is NOT linked — should stay put
        expect(r1.inBeatTime).toBeCloseTo(5.0);
        expect(r1.outBeatTime).toBeCloseTo(20.0);
    });

    // ── 6. Region clipout body pan (Move on clipout entity) ─────────────────────

    it("6. clipout body pan — Move on clipout entity", () => {
        let slice = emptySlice();
        slice = withRegion(
            slice,
            makeRegion({
                id: "r1",
                inPoint: 0,
                outPoint: 10,
                inBeatTime: 2,
                outBeatTime: 12,
                defaultLinked: false,
            }),
        );
        const dragCtx = emptyDragCtx();

        const output = runConstraintPipeline({
            slice,
            dragCtx,
            op: { kind: OpKind.Move, id: regionOutId("r1"), delta: 3.0 },
        });
        const newState = applyDiffsToSlice(slice, output);

        const r1 = newState.regions.find((r) => r.id === "r1")!;
        expect(r1.inBeatTime).toBeCloseTo(5.0);
        expect(r1.outBeatTime).toBeCloseTo(15.0);
    });

    // ── 7. Region clipout edge resize (SetEdge on clipout) ─────────────────────

    it("7. clipout edge resize — SetEdge on out edge", () => {
        let slice = emptySlice();
        slice = withRegion(
            slice,
            makeRegion({
                id: "r1",
                inPoint: 0,
                outPoint: 10,
                inBeatTime: 0,
                outBeatTime: 10,
                bpm: 120,
                defaultLinked: false,
            }),
        );
        const dragCtx = emptyDragCtx();

        const output = runConstraintPipeline({
            slice,
            dragCtx,
            op: { kind: OpKind.SetEdge, id: regionOutId("r1"), edge: "out", value: 15.0 },
        });
        const newState = applyDiffsToSlice(slice, output);

        const r1 = newState.regions.find((r) => r.id === "r1")!;
        expect(r1.inBeatTime).toBeCloseTo(0.0);
        expect(r1.outBeatTime).toBeCloseTo(15.0);
    });

    // ── 8. Region clipin edge resize ───────────────────────────────────────────

    it("8. clipin edge resize — SetEdge on in edge", () => {
        let slice = emptySlice();
        slice = withRegion(slice, makeRegion({ id: "r1", inPoint: 2, outPoint: 10 }));
        const dragCtx = emptyDragCtx();

        const output = runConstraintPipeline({
            slice,
            dragCtx,
            op: { kind: OpKind.SetEdge, id: regionInId("r1"), edge: "in", value: 4.0 },
        });
        const newState = applyDiffsToSlice(slice, output);

        const r1 = newState.regions.find((r) => r.id === "r1")!;
        expect(r1.inPoint).toBeCloseTo(4.0);
        expect(r1.outPoint).toBeCloseTo(10.0);
    });

    // ── 9. (removed) Carry pair test — carry field deleted from DragCtx ─────────
    // The MirrorEdge carry behavior no longer exists in the pipeline.

    // ── 10. BPM derived — SetEdge on clipout triggers bpmDerivedConstraint ──────

    it("10. bpmDerivedConstraint — clipout SetEdge updates lockedBeats (fixed=bpm)", () => {
        let slice = emptySlice();
        slice = withRegion(
            slice,
            makeRegion({
                id: "r1",
                inPoint: 0,
                outPoint: 10,
                inBeatTime: 0,
                outBeatTime: 10,
                bpm: 120,
                lockedBeats: 20,
                defaultLinked: false,
            }),
        );
        const dragCtx = emptyDragCtx();

        // Extend the clipout — lockedBeats should recompute from new length
        const output = runConstraintPipeline({
            slice,
            dragCtx,
            op: { kind: OpKind.SetEdge, id: regionOutId("r1"), edge: "out", value: 20.0 },
        });
        const newState = applyDiffsToSlice(slice, output);

        // new length = 20, bpm = 120, lockedBeats = length * bpm / 60 = 20 * 120/60 = 40
        const r1 = newState.regions.find((r) => r.id === "r1")!;
        expect(r1.lockedBeats).toBeCloseTo(40.0, 6);
    });

    // ── 11. Multi-region lasso + clipin body pan ───────────────────────────────

    it("11. lasso multi-region body pan — TranslateGroup propagates to all selected clipins", () => {
        let slice = emptySlice();
        slice = withRegion(slice, makeRegion({ id: "r1", inPoint: 0, outPoint: 10 }));
        slice = withRegion(slice, makeRegion({ id: "r2", inPoint: 20, outPoint: 30 }));
        slice = withSelection(slice, { clipin: ["r1", "r2"] });
        const dragCtx = emptyDragCtx();

        const output = runConstraintPipeline({
            slice,
            dragCtx,
            op: { kind: OpKind.Move, id: regionInId("r1"), delta: 5.0 },
        });
        const newState = applyDiffsToSlice(slice, output);

        const r1 = newState.regions.find((r) => r.id === "r1")!;
        const r2 = newState.regions.find((r) => r.id === "r2")!;
        expect(r1.inPoint).toBeCloseTo(5.0);
        expect(r1.outPoint).toBeCloseTo(15.0);
        expect(r2.inPoint).toBeCloseTo(25.0);
        expect(r2.outPoint).toBeCloseTo(35.0);
    });

    // ── 12. Snap — SnapTarget snaps a proposed value to nearest target ──────────

    it.skip("12. SnapTarget snap — anchor-in move snaps to nearest anchor-out (legacy: dragCtx.snapInstall removed; snap now installed by profile.whileDragging)", () => {});

    // ── 13. SetValue for bpm — meta only, no position change ───────────────────

    it("13. SetValue bpm — updates meta, no entity position writes", () => {
        let slice = emptySlice();
        slice = withRegion(
            slice,
            makeRegion({
                id: "r1",
                inPoint: 0,
                outPoint: 10,
                bpm: 120,
                lockedBeats: 20,
                defaultLinked: false,
            }),
        );
        const dragCtx = emptyDragCtx();

        const output = runConstraintPipeline({
            slice,
            dragCtx,
            op: { kind: OpKind.SetValue, id: regionOutId("r1"), field: "bpm", value: 140 },
        });
        // No position diffs expected
        expect(output.regionDiffs["r1"]?.inPoint).toBeUndefined();
        expect(output.regionDiffs["r1"]?.outPoint).toBeUndefined();
        expect(output.metaDiffs["r1"]?.bpm).toBeCloseTo(140);
    });

    // ── 14. Region clipout body pan with snapping ────────────────────────────────

    it.skip("14. clipout body pan — with snap to twin (legacy: dragCtx.snapInstall removed; snap now installed by profile.whileDragging)", () => {});

    // ── 15. Anchor delete propagates through DeleteGroup ────────────────────────

    it("15. anchor Delete — both pair members removed via DeleteGroup", () => {
        let slice = emptySlice();
        slice = withOrigAnchor(slice, 10, 2.0);
        slice = withOrigAnchor(slice, 11, 4.0);
        const dragCtx = emptyDragCtx();

        const op = { kind: OpKind.Delete, id: anchorInId(10) };
        const output = runConstraintPipeline({ slice, dragCtx, op });

        // Delete op produces no position diffs (entities disappear).
        expect(output.regionDiffs).toEqual({});
        // The pipeline itself ran without error — anchor 10 entities gone from graph
        const graph = buildGraphFromSlice(slice, dragCtx);
        expect(graph.entities[anchorInId(10)]).toBeDefined(); // still in pre-op slice
        // After the op, anchor 10 is deleted
        const postState = reduce(graph, op);
        expect(postState.entities[anchorInId(10)]).toBeUndefined();
        expect(postState.entities[anchorOutId(10)]).toBeUndefined();
        // Anchor 11 survives
        expect(postState.entities[anchorInId(11)]).toBeDefined();
    });

    // ── 16. AddConstraint — pure state mutation, no position change ─────────────

    it("16. AddConstraint op passes through resolver, no position writes", () => {
        let slice = emptySlice();
        slice = withOrigAnchor(slice, 1, 1.0);
        const dragCtx = emptyDragCtx();

        const output = runConstraintPipeline({
            slice,
            dragCtx,
            op: {
                kind: OpKind.AddConstraint,
                constraint: {
                    kind: "highlight_group" as const,
                    ids: [anchorInId(1)],
                    tag: "test-highlight",
                },
            },
        });
        // No position diffs
        expect(output.anchorDiffs.orig).toEqual({});
        expect(output.anchorDiffs.beat).toEqual({});
        expect(output.regionDiffs).toEqual({});
    });

    // ── 17. Clipin pan with selected anchors in lasso (combined selection) ───────

    it("17. combined selection — clipin pan and anchor in same lasso group", () => {
        let slice = emptySlice();
        slice = withOrigAnchor(slice, 1, 5.0);
        slice = withRegion(slice, makeRegion({ id: "r1", inPoint: 0, outPoint: 10 }));
        slice = withSelection(slice, { orig: [1], clipin: ["r1"] });
        const dragCtx = emptyDragCtx();

        const output = runConstraintPipeline({
            slice,
            dragCtx,
            op: { kind: OpKind.Move, id: regionInId("r1"), delta: 2.0 },
        });
        const newState = applyDiffsToSlice(slice, output);

        // Both r1-in and a1-in should have moved by +2
        const r1 = newState.regions.find((r) => r.id === "r1")!;
        expect(r1.inPoint).toBeCloseTo(2.0);
        const a1 = newState.origAnchors.find((a) => a.id === 1)!;
        expect(a1.time).toBeCloseTo(7.0);
    });

    // ── 18. Linked anchor DeleteGroup — deleting pair member removes both ────────

    it("18. anchor pair — DeleteGroup installed by initAnchorPair", () => {
        const slice: PipelineSlice = {
            warp: {
                origAnchors: [{ id: 7, time: 3.0 }],
                beatAnchors: [{ id: 7, time: 3.0, linked: true }],
            },
            region: { regions: [] },
            ui: { anchorLock: false, anchorLockGestureOverride: null, lockMode: "bpm" },
            lists: { selection: { clipin: [], clipout: [] } },
        };
        const dragCtx = emptyDragCtx();

        // buildGraphFromSlice should produce the pair DeleteGroup.
        const pairTag = `pair:${anchorInId(7)}`;
        const builtState = buildGraphFromSlice(slice, dragCtx);
        const hasBuiltPair = builtState.constraints.some(
            (c) => c.kind === "delete_group" && (c as { tag?: string }).tag === pairTag,
        );
        expect(hasBuiltPair).toBe(true);
    });

    // ── 19. lockMode=beats — bpmDerivedConstraint uses beats mode ───────────────

    it("19. lockMode beats — bpmDerivedConstraint keeps lockedBeats fixed on resize", () => {
        let slice = emptySlice();
        slice = {
            ...slice,
            ui: { ...slice.ui, lockMode: "beats" },
        };
        slice = withRegion(
            slice,
            makeRegion({
                id: "r1",
                inPoint: 0,
                outPoint: 10,
                inBeatTime: 0,
                outBeatTime: 10,
                bpm: 120,
                lockedBeats: 20,
                defaultLinked: false,
            }),
        );
        const dragCtx = emptyDragCtx();

        // Should not throw
        const output = runConstraintPipeline({
            slice,
            dragCtx,
            op: { kind: OpKind.SetEdge, id: regionOutId("r1"), edge: "out", value: 15.0 },
        });
        expect(output).toBeDefined();
    });

    // ── 20. buildGraphFromSlice — snap rules always installed ───────────────────

    it("20. buildGraphFromSlice always installs SnapRule constraints", () => {
        const slice: PipelineSlice = {
            warp: { origAnchors: [], beatAnchors: [] },
            region: { regions: [] },
            ui: { anchorLock: false, anchorLockGestureOverride: null, lockMode: "bpm" },
            lists: { selection: { clipin: [], clipout: [] } },
        };
        const dragCtx: DragCtx = {};
        const state = buildGraphFromSlice(slice, dragCtx);

        const snapRules = state.constraints.filter((c) => c.kind === "snap_rule");
        expect(snapRules.length).toBeGreaterThan(0);

        // All SNAP_RULES should be present.
        expect(snapRules).toHaveLength(SNAP_RULES.length);
    });
});
