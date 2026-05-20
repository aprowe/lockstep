import { describe, it, expect } from "vitest";
import { CLIP_EDGE_DRAG } from "../../../src/constraints/profiles/clip-edge-drag";
import { ConstraintKind, Field, OpKind } from "../../../src/constraints/types";
import type { ProfileContext } from "../../../src/constraints/profiles/types";
import { emptyState } from "../../../src/constraints/resolver";

const ctx: ProfileContext = {
    preDrag: {
        origAnchors: [],
        beatAnchors: [],
        regions: [
            {
                id: "r1",
                inPoint: 10,
                outPoint: 20,
                inBeatTime: 15,
                outBeatTime: 25,
                defaultLinked: false,
            },
        ],
    },
    ui: { anchorLock: false, lockMode: "bpm" },
    modifiers: { alt: false },
    pxPerUnit: 0,
};
const state = emptyState();

describe("CLIP_EDGE_DRAG profile", () => {
    it("onDrag clipin in-edge: SetEdge with preDrag inPoint + delta", () => {
        const ops = CLIP_EDGE_DRAG.onDrag(
            { kind: "clip-in-edge", clipId: "r1", space: "input" },
            3,
            ctx,
        );
        expect(ops).toHaveLength(1);
        expect(ops[0]).toMatchObject({ kind: OpKind.SetEdge, id: "r1-in", edge: "in", value: 13 });
    });

    it("onDrag clipin out-edge: SetEdge with preDrag outPoint + delta", () => {
        const ops = CLIP_EDGE_DRAG.onDrag(
            { kind: "clip-out-edge", clipId: "r1", space: "input" },
            5,
            ctx,
        );
        expect(ops).toHaveLength(1);
        expect(ops[0]).toMatchObject({ kind: OpKind.SetEdge, id: "r1-in", edge: "out", value: 25 });
    });

    it("onDrag clipout in-edge: SetEdge with preDrag inBeatTime + delta", () => {
        const ops = CLIP_EDGE_DRAG.onDrag(
            { kind: "clip-in-edge", clipId: "r1", space: "beat" },
            2,
            ctx,
        );
        expect(ops).toHaveLength(1);
        expect(ops[0]).toMatchObject({ kind: OpKind.SetEdge, id: "r1-out", edge: "in", value: 17 });
    });

    it("whileDragging installs an edge-mode SnapTarget on the dragged field", () => {
        const cs = CLIP_EDGE_DRAG.whileDragging(
            { kind: "clip-in-edge", clipId: "r1", space: "input" },
            ctx,
            state,
        );
        const st = cs.find((c) => c.kind === ConstraintKind.SnapTarget) as
            | { kind: string; id: string; field: string; mode: string }
            | undefined;
        expect(st).toBeDefined();
        expect(st!.id).toBe("r1-in");
        expect(st!.field).toBe(Field.In);
        expect(st!.mode).toBe("edge");
    });

    it("onDrag is empty for non-edge handles", () => {
        const ops = CLIP_EDGE_DRAG.onDrag({ kind: "pair-drag", pairId: 1 }, 3, ctx);
        expect(ops).toEqual([]);
    });
});
