/**
 * Tests for SnapTarget with optional grid: { interval, offset }.
 * After the legacy computeSnap path was deleted, the constraint resolver is the
 * single source of truth for all snap (entity targets + grid marks).
 */
import { describe, it, expect } from "vitest";
import { reduce, emptyState, findSnapCandidates } from "../../../src/constraints/resolver";
import { ConstraintKind, OpKind } from "../../../src/constraints/types";
import type { State } from "../../../src/constraints/types";

function stateWithEntities(): State {
    const s = emptyState();
    s.entities = {
        dragged: { kind: "anchor", id: "dragged", time: 5.3 },
        other: { kind: "anchor", id: "other", time: 10.0 },
    };
    return s;
}

describe("SnapTarget with grid — resolver propose phase", () => {
    it("snaps to a grid mark when closer than any entity target", () => {
        const s = stateWithEntities();
        // Install snap constraint: dragged.time, entity target at 10, grid interval=2 offset=0
        // Grid marks at 0, 2, 4, 6, 8, 10...
        // Current value: 5.3 → nearest grid mark = 6 (distance 0.7)
        // Entity target at 10 (distance 4.7)
        // Grid mark wins.
        s.constraints = [
            {
                kind: ConstraintKind.SnapTarget,
                id: "dragged",
                field: "time",
                targets: [{ entityId: "other", field: "time" }],
                threshold: 1.0,
                grid: { interval: 2, offset: 0 },
            },
        ];

        const result = reduce(s, { kind: OpKind.Move, id: "dragged", delta: 0 });
        // delta=0 means dragged stays at 5.3 → snap to grid mark 6
        const dragged = result.entities["dragged"];
        if (dragged?.kind !== "anchor") throw new Error("expected anchor");
        expect(dragged.time).toBeCloseTo(6, 3);
    });

    it("snaps to an entity target when closer than the grid mark", () => {
        const s = stateWithEntities();
        // Grid mark nearest to 5.3 is 6 (distance 0.7)
        // Entity target at 5.1 (distance 0.2) — entity wins
        s.entities["other"] = { kind: "anchor", id: "other", time: 5.1 };
        s.constraints = [
            {
                kind: ConstraintKind.SnapTarget,
                id: "dragged",
                field: "time",
                targets: [{ entityId: "other", field: "time" }],
                threshold: 1.0,
                grid: { interval: 2, offset: 0 },
            },
        ];

        const result = reduce(s, { kind: OpKind.Move, id: "dragged", delta: 0 });
        const dragged = result.entities["dragged"];
        if (dragged?.kind !== "anchor") throw new Error("expected anchor");
        expect(dragged.time).toBeCloseTo(5.1, 3);
    });

    it("does not snap to grid when grid mark is outside threshold", () => {
        const s = stateWithEntities();
        // Dragged at 5.3, grid interval=10, nearest mark=10 (distance 4.7)
        // No entity targets within threshold. threshold=1.0 → no snap.
        s.constraints = [
            {
                kind: ConstraintKind.SnapTarget,
                id: "dragged",
                field: "time",
                targets: [],
                threshold: 1.0,
                grid: { interval: 10, offset: 0 },
            },
        ];

        const result = reduce(s, { kind: OpKind.Move, id: "dragged", delta: 0 });
        const dragged = result.entities["dragged"];
        if (dragged?.kind !== "anchor") throw new Error("expected anchor");
        expect(dragged.time).toBeCloseTo(5.3, 3);
    });

    it("respects grid offset", () => {
        const s = stateWithEntities();
        // Dragged at 5.3, grid interval=2, offset=1 → marks at 1, 3, 5, 7...
        // Nearest mark to 5.3 is 5 (distance 0.3)
        s.constraints = [
            {
                kind: ConstraintKind.SnapTarget,
                id: "dragged",
                field: "time",
                targets: [],
                threshold: 1.0,
                grid: { interval: 2, offset: 1 },
            },
        ];

        const result = reduce(s, { kind: OpKind.Move, id: "dragged", delta: 0 });
        const dragged = result.entities["dragged"];
        if (dragged?.kind !== "anchor") throw new Error("expected anchor");
        expect(dragged.time).toBeCloseTo(5, 3);
    });
});

describe("findSnapCandidates — grid candidates", () => {
    it('returns grid candidates with entityId="grid"', () => {
        const s = stateWithEntities();
        s.constraints = [
            {
                kind: ConstraintKind.SnapTarget,
                id: "dragged",
                field: "time",
                targets: [],
                threshold: 1.0,
                grid: { interval: 2, offset: 0 },
            },
        ];
        // Current value 5.3 → nearest grid mark = 6 (distance 0.7 ≤ 1.0)
        const candidates = findSnapCandidates(s, "dragged", "time", 5.3);
        expect(candidates.length).toBeGreaterThan(0);
        const gridCandidate = candidates.find((c) => c.entityId === "grid");
        expect(gridCandidate).toBeDefined();
        expect(gridCandidate!.value).toBeCloseTo(6, 3);
        expect(gridCandidate!.distance).toBeCloseTo(0.7, 3);
    });

    it("returns both entity and grid candidates, sorted by distance", () => {
        const s = stateWithEntities();
        // Entity at 5.8 (distance 0.5), grid mark at 6 (distance 0.7)
        s.entities["other"] = { kind: "anchor", id: "other", time: 5.8 };
        s.constraints = [
            {
                kind: ConstraintKind.SnapTarget,
                id: "dragged",
                field: "time",
                targets: [{ entityId: "other", field: "time" }],
                threshold: 1.0,
                grid: { interval: 2, offset: 0 },
            },
        ];
        const candidates = findSnapCandidates(s, "dragged", "time", 5.3);
        expect(candidates.length).toBe(2);
        // Sorted by distance: entity (0.5) first, then grid (0.7)
        expect(candidates[0].entityId).toBe("other");
        expect(candidates[1].entityId).toBe("grid");
    });

    it("returns no grid candidates when grid mark is outside threshold", () => {
        const s = stateWithEntities();
        s.constraints = [
            {
                kind: ConstraintKind.SnapTarget,
                id: "dragged",
                field: "time",
                targets: [],
                threshold: 0.5,
                grid: { interval: 2, offset: 0 },
            },
        ];
        // Nearest grid mark is 6 (distance 0.7 > 0.5)
        const candidates = findSnapCandidates(s, "dragged", "time", 5.3);
        expect(candidates.length).toBe(0);
    });
});
