/**
 * Unit tests for the SnapCohort + SnapRule constraint model and the
 * refactored snapToSiblings recipe.
 *
 * Covers:
 *  1. buildSnapIndex: cohort membership round-trips.
 *  2. buildSnapIndex: rule lookup by dragger.
 *  3. snapToSiblings: targets derived from rules, not ID parsing.
 *  4. Asymmetric rules: anchor-out → clipout is valid; clipout → anchor-out is not.
 *  5. gestureRole: clipout:edge vs clipout:body resolve different rules.
 *  6. Twin cohort: clipout snaps to its clipin twin via clipout:edge → twin rule.
 *  7. Conditions: grid snap appears only when SNAP_CONDITIONS predicate passes.
 */

import { describe, it, expect } from "vitest";
import { reduce, emptyState } from "../../../src/constraints";
import type { State } from "../../../src/constraints/types";
import { OpKind, ConstraintKind, LockMode } from "../../../src/constraints/types";
import { snapToSiblings } from "../../../src/constraints/recipes";
import { buildSnapIndex } from "../../../src/constraints/snap-index";
import { anchorInId, anchorOutId, regionInId, regionOutId } from "../../../src/constraints/ids";

// ── Helpers ───────────────────────────────────────────────────────────────────

function addCohort(state: State, tag: string, ids: string[]): State {
    return reduce(state, {
        kind: OpKind.AddConstraint,
        constraint: { kind: ConstraintKind.SnapCohort, tag, ids },
    });
}

function addRule(state: State, dragger: string, target: string, condition?: string): State {
    return reduce(state, {
        kind: OpKind.AddConstraint,
        constraint: { kind: ConstraintKind.SnapRule, dragger, target, condition },
    });
}

// ── 1. buildSnapIndex: cohort membership round-trips ─────────────────────────

describe("buildSnapIndex — cohort membership", () => {
    it("maps ids correctly for a single cohort", () => {
        let state = emptyState();
        state = addCohort(state, "anchor-in", ["a1-in", "a2-in"]);

        const index = buildSnapIndex(state);
        expect(index.idsByCohort.get("anchor-in")).toEqual(["a1-in", "a2-in"]);
        expect(index.cohortsByEntity.get("a1-in")).toContain("anchor-in");
        expect(index.cohortsByEntity.get("a2-in")).toContain("anchor-in");
    });

    it("handles multiple cohorts for the same entity", () => {
        let state = emptyState();
        state = addCohort(state, "clipout", ["r1-out"]);
        state = addCohort(state, "twin:r1", ["r1-in", "r1-out"]);

        const index = buildSnapIndex(state);
        const cohorts = index.cohortsByEntity.get("r1-out") ?? [];
        expect(cohorts).toContain("clipout");
        expect(cohorts).toContain("twin:r1");
    });

    it("returns empty maps when no cohorts exist", () => {
        const index = buildSnapIndex(emptyState());
        expect(index.idsByCohort.size).toBe(0);
        expect(index.cohortsByEntity.size).toBe(0);
        expect(index.rules).toHaveLength(0);
    });
});

// ── 2. buildSnapIndex: rule lookup ────────────────────────────────────────────

describe("buildSnapIndex — rule lookup", () => {
    it("collects SnapRule constraints into the rules array", () => {
        let state = emptyState();
        state = addRule(state, "anchor-in", "anchor-out");
        state = addRule(state, "anchor-in", "clipin");

        const index = buildSnapIndex(state);
        const anchorInRules = index.rules.filter((r) => r.dragger === "anchor-in");
        expect(anchorInRules.map((r) => r.target)).toContain("anchor-out");
        expect(anchorInRules.map((r) => r.target)).toContain("clipin");
    });
});

// ── 3. snapToSiblings: rule-driven targets ────────────────────────────────────

describe("snapToSiblings — rule-driven target derivation", () => {
    it("anchor-in drag targets anchor-out entities per installed rule", () => {
        let state = emptyState();
        state = reduce(state, { kind: OpKind.AddAnchor, id: anchorInId(1), time: 10 });
        state = reduce(state, { kind: OpKind.AddAnchor, id: anchorOutId(2), time: 20 });
        state = reduce(state, { kind: OpKind.AddAnchor, id: anchorOutId(3), time: 30 });
        state = addCohort(state, "anchor-in", [anchorInId(1)]);
        state = addCohort(state, "anchor-out", [anchorOutId(2), anchorOutId(3)]);
        state = addRule(state, "anchor-in", "anchor-out");

        const op = snapToSiblings(anchorInId(1), "time", state, 10, 8);
        if (op.kind !== OpKind.AddConstraint || op.constraint.kind !== ConstraintKind.SnapTarget) {
            throw new Error("expected SnapTarget");
        }
        const targetIds = op.constraint.targets.map((t) => t.entityId);
        expect(targetIds).toContain(anchorOutId(2));
        expect(targetIds).toContain(anchorOutId(3));
        // anchor-in entity (the dragged one) is excluded.
        expect(targetIds).not.toContain(anchorInId(1));
    });

    it("produces no targets when no rules match the dragger cohort", () => {
        let state = emptyState();
        state = reduce(state, { kind: OpKind.AddAnchor, id: anchorInId(1), time: 10 });
        state = reduce(state, { kind: OpKind.AddAnchor, id: anchorInId(2), time: 20 });
        state = addCohort(state, "anchor-in", [anchorInId(1), anchorInId(2)]);
        // NO rule: anchor-in → anything.

        const op = snapToSiblings(anchorInId(1), "time", state, 10, 8);
        if (op.kind !== OpKind.AddConstraint || op.constraint.kind !== ConstraintKind.SnapTarget) {
            throw new Error("expected SnapTarget");
        }
        expect(op.constraint.targets).toHaveLength(0);
    });
});

// ── 4. Asymmetric rules ───────────────────────────────────────────────────────

describe("snapToSiblings — asymmetric rules", () => {
    it("anchor-out → clipout is a valid target", () => {
        let state = emptyState();
        state = reduce(state, { kind: OpKind.AddAnchor, id: anchorOutId(1), time: 10 });
        state = reduce(state, { kind: OpKind.AddClip, id: regionOutId("r1"), in: 5, out: 15 });
        state = addCohort(state, "anchor-out", [anchorOutId(1)]);
        state = addCohort(state, "clipout", [regionOutId("r1")]);
        state = addRule(state, "anchor-out", "clipout");

        const op = snapToSiblings(anchorOutId(1), "time", state, 10, 8);
        if (op.kind !== OpKind.AddConstraint || op.constraint.kind !== ConstraintKind.SnapTarget) {
            throw new Error("expected SnapTarget");
        }
        const targetIds = op.constraint.targets.map((t) => t.entityId);
        expect(targetIds).toContain(regionOutId("r1"));
    });

    it("clipout drag has NO anchor-out targets (no reverse rule)", () => {
        let state = emptyState();
        state = reduce(state, { kind: OpKind.AddAnchor, id: anchorOutId(1), time: 10 });
        state = reduce(state, { kind: OpKind.AddClip, id: regionOutId("r1"), in: 5, out: 15 });
        state = addCohort(state, "anchor-out", [anchorOutId(1)]);
        state = addCohort(state, "clipout", [regionOutId("r1")]);
        // Only anchor-out → clipout rule (one direction).
        state = addRule(state, "anchor-out", "clipout");
        // No clipout → anchor-out rule installed.

        const op = snapToSiblings(regionOutId("r1"), "out", state, 10, 8);
        if (op.kind !== OpKind.AddConstraint || op.constraint.kind !== ConstraintKind.SnapTarget) {
            throw new Error("expected SnapTarget");
        }
        const targetIds = op.constraint.targets.map((t) => t.entityId);
        // clipout has no rule → anchor-out should NOT appear as a target.
        expect(targetIds).not.toContain(anchorOutId(1));
    });
});

// ── 5. gestureRole: role-split cohorts ───────────────────────────────────────

describe("snapToSiblings — gestureRole disambiguation", () => {
    function setupCliproles() {
        let state = emptyState();
        state = reduce(state, { kind: OpKind.AddClip, id: regionOutId("r1"), in: 5, out: 15 });
        state = reduce(state, { kind: OpKind.AddClip, id: regionInId("r1"), in: 5, out: 15 });
        state = addCohort(state, "clipout", [regionOutId("r1")]);
        state = addCohort(state, "twin:r1", [regionInId("r1"), regionOutId("r1")]);
        // clipout:edge → twin; clipout:body → twin
        state = addRule(state, "clipout:edge", "twin");
        state = addRule(state, "clipout:body", "twin");
        return state;
    }

    it("edge role: clipout:edge rule fires when gestureRole=edge", () => {
        const state = setupCliproles();
        const op = snapToSiblings(regionOutId("r1"), "out", state, 10, 8, undefined, "edge");
        if (op.kind !== OpKind.AddConstraint || op.constraint.kind !== ConstraintKind.SnapTarget) {
            throw new Error("expected SnapTarget");
        }
        const targetIds = op.constraint.targets.map((t) => t.entityId);
        // Twin cohort includes r1-in, r1-out. r1-out is the dragged entity → excluded.
        expect(targetIds).toContain(regionInId("r1"));
        expect(targetIds).not.toContain(regionOutId("r1"));
    });

    it("body role: clipout:body rule fires when gestureRole=body", () => {
        const state = setupCliproles();
        const op = snapToSiblings(regionOutId("r1"), "out", state, 10, 8, undefined, "body");
        if (op.kind !== OpKind.AddConstraint || op.constraint.kind !== ConstraintKind.SnapTarget) {
            throw new Error("expected SnapTarget");
        }
        const targetIds = op.constraint.targets.map((t) => t.entityId);
        expect(targetIds).toContain(regionInId("r1"));
    });
});

// ── 6. Twin cohort snapping ───────────────────────────────────────────────────

describe("snapToSiblings — twin cohort", () => {
    it("clipout edge-drag snaps to its own clipin twin", () => {
        let state = emptyState();
        state = reduce(state, { kind: OpKind.AddClip, id: regionOutId("r1"), in: 5, out: 15 });
        state = reduce(state, { kind: OpKind.AddClip, id: regionInId("r1"), in: 5, out: 15 });
        state = reduce(state, { kind: OpKind.AddClip, id: regionOutId("r2"), in: 20, out: 30 });
        state = reduce(state, { kind: OpKind.AddClip, id: regionInId("r2"), in: 20, out: 30 });
        state = addCohort(state, "clipout", [regionOutId("r1"), regionOutId("r2")]);
        state = addCohort(state, "twin:r1", [regionInId("r1"), regionOutId("r1")]);
        state = addCohort(state, "twin:r2", [regionInId("r2"), regionOutId("r2")]);
        state = addRule(state, "clipout:edge", "twin");

        const op = snapToSiblings(regionOutId("r1"), "out", state, 10, 8, undefined, "edge");
        if (op.kind !== OpKind.AddConstraint || op.constraint.kind !== ConstraintKind.SnapTarget) {
            throw new Error("expected SnapTarget");
        }
        const targetIds = op.constraint.targets.map((t) => t.entityId);
        // The own twin (r1-in) should be a target.
        expect(targetIds).toContain(regionInId("r1"));
        // The dragged entity itself is excluded.
        expect(targetIds).not.toContain(regionOutId("r1"));
        // Other region's twin should not be a target (different twin cohort).
        expect(targetIds).not.toContain(regionInId("r2"));
    });
});

// ── 7. Conditional rule: grid snap ───────────────────────────────────────────

describe("snapToSiblings — conditional rules (grid)", () => {
    it("grid is included when lockMode-bpm-and-out-edge condition passes", () => {
        let state = emptyState();
        state.globals.lockMode = LockMode.Bpm;
        state = reduce(state, { kind: OpKind.AddClip, id: regionOutId("r1"), in: 5, out: 15 });
        state = addCohort(state, "clipout", [regionOutId("r1")]);
        state = addRule(state, "clipout:edge", "grid", "lockMode-bpm-and-out-edge");

        const grid = { interval: 2, offset: 0 };
        const op = snapToSiblings(regionOutId("r1"), "out", state, 10, 8, grid, "edge");
        if (op.kind !== OpKind.AddConstraint || op.constraint.kind !== ConstraintKind.SnapTarget) {
            throw new Error("expected SnapTarget");
        }
        // Grid should be included since lockMode=bpm and field=out.
        expect(op.constraint.grid).toEqual(grid);
    });

    it("grid is NOT included when draggedField=in (condition fails)", () => {
        let state = emptyState();
        state.globals.lockMode = LockMode.Bpm;
        state = reduce(state, { kind: OpKind.AddClip, id: regionOutId("r1"), in: 5, out: 15 });
        state = addCohort(state, "clipout", [regionOutId("r1")]);
        state = addRule(state, "clipout:edge", "grid", "lockMode-bpm-and-out-edge");

        const grid = { interval: 2, offset: 0 };
        // field='in' → condition fails (draggedField !== 'out')
        const op = snapToSiblings(regionOutId("r1"), "in", state, 10, 8, grid, "edge");
        if (op.kind !== OpKind.AddConstraint || op.constraint.kind !== ConstraintKind.SnapTarget) {
            throw new Error("expected SnapTarget");
        }
        expect(op.constraint.grid).toBeUndefined();
    });

    it("grid is NOT included when lockMode=beats (condition fails)", () => {
        let state = emptyState();
        state.globals.lockMode = LockMode.Beats;
        state = reduce(state, { kind: OpKind.AddClip, id: regionOutId("r1"), in: 5, out: 15 });
        state = addCohort(state, "clipout", [regionOutId("r1")]);
        state = addRule(state, "clipout:edge", "grid", "lockMode-bpm-and-out-edge");

        const grid = { interval: 2, offset: 0 };
        const op = snapToSiblings(regionOutId("r1"), "out", state, 10, 8, grid, "edge");
        if (op.kind !== OpKind.AddConstraint || op.constraint.kind !== ConstraintKind.SnapTarget) {
            throw new Error("expected SnapTarget");
        }
        expect(op.constraint.grid).toBeUndefined();
    });
});
