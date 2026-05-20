import { describe, it, expect } from "vitest";
import {
    LINK_EPSILON,
    detectInputLinks,
    detectOutputLinks,
    detectLinkState,
    isDefaultLinked,
} from "../../../../src/timeline/model/linkState";
import type { Anchor, Region } from "../../../../src/types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRegion(overrides: Partial<Region> = {}): Region {
    return {
        id: "r1",
        name: "Test Region",
        inPoint: 10,
        outPoint: 20,
        inBeatTime: 10,
        outBeatTime: 20,
        defaultLinked: true,
        bpm: 120,
        minStretch: 0.5,
        maxStretch: 2.0,
        ...overrides,
    };
}

// ── isDefaultLinked ────────────────────────────────────────────────────────────

describe("isDefaultLinked", () => {
    it("returns true when inBeatTime === inPoint and outBeatTime === outPoint", () => {
        const region = makeRegion({ inPoint: 10, outPoint: 20, inBeatTime: 10, outBeatTime: 20 });
        expect(isDefaultLinked(region)).toBe(true);
    });

    it("returns true when inBeatTime === inPoint and outBeatTime === outPoint (default-linked state)", () => {
        const region = makeRegion({ inPoint: 10, outPoint: 20, inBeatTime: 10, outBeatTime: 20 });
        expect(isDefaultLinked(region)).toBe(true);
    });

    it("returns false when inBeatTime differs from inPoint", () => {
        const region = makeRegion({ inPoint: 10, outPoint: 20, inBeatTime: 8, outBeatTime: 20 });
        expect(isDefaultLinked(region)).toBe(false);
    });

    it("returns false when outBeatTime differs from outPoint", () => {
        const region = makeRegion({ inPoint: 10, outPoint: 20, inBeatTime: 10, outBeatTime: 22 });
        expect(isDefaultLinked(region)).toBe(false);
    });

    it("returns true when both edges are exactly LINK_EPSILON away (boundary inclusive)", () => {
        const region = makeRegion({
            inPoint: 10,
            outPoint: 20,
            inBeatTime: 10 + LINK_EPSILON,
            outBeatTime: 20 - LINK_EPSILON,
        });
        expect(isDefaultLinked(region)).toBe(true);
    });

    it("returns false when inBeatTime is just past LINK_EPSILON", () => {
        const region = makeRegion({
            inPoint: 10,
            outPoint: 20,
            inBeatTime: 10 + LINK_EPSILON + 1e-10,
            outBeatTime: 20,
        });
        expect(isDefaultLinked(region)).toBe(false);
    });

    it("returns false when only one edge is within tolerance and the other is not", () => {
        const region = makeRegion({
            inPoint: 10,
            outPoint: 20,
            inBeatTime: 10, // linked
            outBeatTime: 20 + LINK_EPSILON + 1e-10, // diverged
        });
        expect(isDefaultLinked(region)).toBe(false);
    });
});

// ── detectInputLinks ───────────────────────────────────────────────────────────

describe("detectInputLinks", () => {
    it("returns both edges undefined when anchor list is empty", () => {
        const region = makeRegion();
        const result = detectInputLinks(region, [], []);
        expect(result.inputIn).toBeUndefined();
        expect(result.inputOut).toBeUndefined();
    });

    it("returns inputIn with the paired beat anchor; inputOut undefined", () => {
        const region = makeRegion({ inPoint: 10, outPoint: 20 });
        const anchors: Anchor[] = [{ id: 1, time: 10 }];
        const beatAnchors: Anchor[] = [{ id: 1, time: 5 }];
        const result = detectInputLinks(region, anchors, beatAnchors);
        expect(result.inputIn).toEqual({ input: { id: 1, time: 10 }, beat: { id: 1, time: 5 } });
        expect(result.inputOut).toBeUndefined();
    });

    it("inputIn.beat is undefined when beat partner is absent (torn pairing)", () => {
        const region = makeRegion({ inPoint: 10, outPoint: 20 });
        const anchors: Anchor[] = [{ id: 1, time: 10 }];
        const beatAnchors: Anchor[] = []; // no pair for id 1
        const result = detectInputLinks(region, anchors, beatAnchors);
        expect(result.inputIn).toBeDefined();
        expect(result.inputIn!.input).toEqual({ id: 1, time: 10 });
        expect(result.inputIn!.beat).toBeUndefined();
        expect(result.inputOut).toBeUndefined();
    });

    it("populates both inputIn and inputOut when both edges have matching anchors", () => {
        const region = makeRegion({ inPoint: 10, outPoint: 20 });
        const anchors: Anchor[] = [
            { id: 1, time: 10 },
            { id: 2, time: 20 },
        ];
        const beatAnchors: Anchor[] = [
            { id: 1, time: 5 },
            { id: 2, time: 12 },
        ];
        const result = detectInputLinks(region, anchors, beatAnchors);
        expect(result.inputIn).toEqual({ input: { id: 1, time: 10 }, beat: { id: 1, time: 5 } });
        expect(result.inputOut).toEqual({ input: { id: 2, time: 20 }, beat: { id: 2, time: 12 } });
    });

    it("degenerate: two anchors at the same time — picks the one with the smallest id", () => {
        const region = makeRegion({ inPoint: 10, outPoint: 20 });
        const anchors: Anchor[] = [
            { id: 7, time: 10 },
            { id: 3, time: 10 },
        ];
        const beatAnchors: Anchor[] = [
            { id: 3, time: 5 },
            { id: 7, time: 6 },
        ];
        const result = detectInputLinks(region, anchors, beatAnchors);
        // id 3 < id 7, so id 3 is selected
        expect(result.inputIn!.input).toEqual({ id: 3, time: 10 });
        expect(result.inputIn!.beat).toEqual({ id: 3, time: 5 });
    });

    it("returns undefined when anchor is close but just past tolerance", () => {
        const region = makeRegion({ inPoint: 10, outPoint: 20 });
        const anchors: Anchor[] = [{ id: 1, time: 10 + LINK_EPSILON + 1e-10 }];
        const beatAnchors: Anchor[] = [{ id: 1, time: 5 }];
        const result = detectInputLinks(region, anchors, beatAnchors);
        expect(result.inputIn).toBeUndefined();
    });

    it("matches anchor at exactly LINK_EPSILON away (boundary inclusive)", () => {
        const region = makeRegion({ inPoint: 10, outPoint: 20 });
        const anchors: Anchor[] = [{ id: 1, time: 10 + LINK_EPSILON }];
        const beatAnchors: Anchor[] = [{ id: 1, time: 5 }];
        const result = detectInputLinks(region, anchors, beatAnchors);
        expect(result.inputIn).toBeDefined();
        expect(result.inputIn!.input!.id).toBe(1);
    });

    it("anchor near outPoint does not pollute inputIn", () => {
        const region = makeRegion({ inPoint: 10, outPoint: 20 });
        const anchors: Anchor[] = [{ id: 2, time: 20 }];
        const beatAnchors: Anchor[] = [{ id: 2, time: 12 }];
        const result = detectInputLinks(region, anchors, beatAnchors);
        expect(result.inputIn).toBeUndefined();
        expect(result.inputOut).toBeDefined();
    });
});

// ── detectOutputLinks ──────────────────────────────────────────────────────────

describe("detectOutputLinks", () => {
    it("returns both edges undefined when beatAnchor list is empty", () => {
        const region = makeRegion({ inBeatTime: 5, outBeatTime: 15 });
        const result = detectOutputLinks(region, [], []);
        expect(result.outputIn).toBeUndefined();
        expect(result.outputOut).toBeUndefined();
    });

    it("returns outputIn with the paired input anchor; outputOut undefined", () => {
        const region = makeRegion({ inPoint: 10, outPoint: 20, inBeatTime: 5, outBeatTime: 15 });
        const anchors: Anchor[] = [{ id: 1, time: 10 }];
        const beatAnchors: Anchor[] = [{ id: 1, time: 5 }];
        const result = detectOutputLinks(region, anchors, beatAnchors);
        expect(result.outputIn).toEqual({ input: { id: 1, time: 10 }, beat: { id: 1, time: 5 } });
        expect(result.outputOut).toBeUndefined();
    });

    it("outputIn.input is undefined when input partner is absent (torn pairing)", () => {
        const region = makeRegion({ inPoint: 10, outPoint: 20, inBeatTime: 5, outBeatTime: 15 });
        const anchors: Anchor[] = []; // no pair for id 1
        const beatAnchors: Anchor[] = [{ id: 1, time: 5 }];
        const result = detectOutputLinks(region, anchors, beatAnchors);
        expect(result.outputIn).toBeDefined();
        expect(result.outputIn!.beat).toEqual({ id: 1, time: 5 });
        expect(result.outputIn!.input).toBeUndefined();
        expect(result.outputOut).toBeUndefined();
    });

    it("populates both outputIn and outputOut when both edges have matching beat anchors", () => {
        const region = makeRegion({ inPoint: 10, outPoint: 20, inBeatTime: 5, outBeatTime: 15 });
        const anchors: Anchor[] = [
            { id: 1, time: 10 },
            { id: 2, time: 20 },
        ];
        const beatAnchors: Anchor[] = [
            { id: 1, time: 5 },
            { id: 2, time: 15 },
        ];
        const result = detectOutputLinks(region, anchors, beatAnchors);
        expect(result.outputIn).toEqual({ input: { id: 1, time: 10 }, beat: { id: 1, time: 5 } });
        expect(result.outputOut).toEqual({ input: { id: 2, time: 20 }, beat: { id: 2, time: 15 } });
    });

    it("degenerate: two beat anchors at the same time — picks the one with the smallest id", () => {
        const region = makeRegion({ inPoint: 10, outPoint: 20, inBeatTime: 5, outBeatTime: 15 });
        const anchors: Anchor[] = [
            { id: 3, time: 10 },
            { id: 7, time: 11 },
        ];
        const beatAnchors: Anchor[] = [
            { id: 7, time: 5 },
            { id: 3, time: 5 },
        ];
        const result = detectOutputLinks(region, anchors, beatAnchors);
        // id 3 < id 7, so id 3 is selected
        expect(result.outputIn!.beat).toEqual({ id: 3, time: 5 });
        expect(result.outputIn!.input).toEqual({ id: 3, time: 10 });
    });

    it("returns undefined when beat anchor is just past tolerance", () => {
        const region = makeRegion({ inPoint: 10, outPoint: 20, inBeatTime: 5, outBeatTime: 15 });
        const beatAnchors: Anchor[] = [{ id: 1, time: 5 + LINK_EPSILON + 1e-10 }];
        const result = detectOutputLinks(region, [], beatAnchors);
        expect(result.outputIn).toBeUndefined();
    });

    it("matches beat anchor at exactly LINK_EPSILON away (boundary inclusive)", () => {
        const region = makeRegion({ inPoint: 10, outPoint: 20, inBeatTime: 5, outBeatTime: 15 });
        const anchors: Anchor[] = [{ id: 1, time: 10 }];
        const beatAnchors: Anchor[] = [{ id: 1, time: 5 + LINK_EPSILON }];
        const result = detectOutputLinks(region, anchors, beatAnchors);
        expect(result.outputIn).toBeDefined();
        expect(result.outputIn!.beat!.id).toBe(1);
    });

    it("matches beat anchors at inBeatTime/outBeatTime when equal to inPoint/outPoint", () => {
        // inBeatTime === inPoint (default-linked state) — beat anchors at those times still match
        const region = makeRegion({ inPoint: 10, outPoint: 20, inBeatTime: 10, outBeatTime: 20 });
        const anchors: Anchor[] = [
            { id: 1, time: 10 },
            { id: 2, time: 20 },
        ];
        const beatAnchors: Anchor[] = [
            { id: 1, time: 10 },
            { id: 2, time: 20 },
        ];
        const result = detectOutputLinks(region, anchors, beatAnchors);
        expect(result.outputIn).toBeDefined();
        expect(result.outputOut).toBeDefined();
    });
});

// ── detectLinkState ────────────────────────────────────────────────────────────

describe("detectLinkState", () => {
    it("combines input-side and output-side results correctly", () => {
        const region = makeRegion({ inPoint: 10, outPoint: 20, inBeatTime: 5, outBeatTime: 15 });
        const anchors: Anchor[] = [
            { id: 1, time: 10 },
            { id: 2, time: 20 },
        ];
        const beatAnchors: Anchor[] = [
            { id: 1, time: 5 },
            { id: 2, time: 15 },
        ];
        const result = detectLinkState(region, anchors, beatAnchors);
        expect(result.inputIn).toEqual({ input: { id: 1, time: 10 }, beat: { id: 1, time: 5 } });
        expect(result.inputOut).toEqual({ input: { id: 2, time: 20 }, beat: { id: 2, time: 15 } });
        expect(result.outputIn).toEqual({ input: { id: 1, time: 10 }, beat: { id: 1, time: 5 } });
        expect(result.outputOut).toEqual({ input: { id: 2, time: 20 }, beat: { id: 2, time: 15 } });
    });

    it("input-side undefined does not affect output-side results", () => {
        const region = makeRegion({ inPoint: 10, outPoint: 20, inBeatTime: 5, outBeatTime: 15 });
        // No anchors at inPoint/outPoint (input side misses), but beat anchors at inBeatTime/outBeatTime
        const anchors: Anchor[] = [{ id: 1, time: 99 }];
        const beatAnchors: Anchor[] = [{ id: 1, time: 5 }];
        const result = detectLinkState(region, anchors, beatAnchors);
        expect(result.inputIn).toBeUndefined();
        expect(result.inputOut).toBeUndefined();
        // outputIn: beat anchor at 5 matches inBeatTime=5; input partner id=1 is at 99
        expect(result.outputIn).toBeDefined();
        expect(result.outputIn!.beat).toEqual({ id: 1, time: 5 });
        expect(result.outputOut).toBeUndefined();
    });

    it("output-side undefined does not affect input-side results", () => {
        const region = makeRegion({ inPoint: 10, outPoint: 20, inBeatTime: 5, outBeatTime: 15 });
        // Input anchor at inPoint, but no beat anchor at inBeatTime
        const anchors: Anchor[] = [{ id: 1, time: 10 }];
        const beatAnchors: Anchor[] = [{ id: 1, time: 99 }]; // not at inBeatTime=5
        const result = detectLinkState(region, anchors, beatAnchors);
        // inputIn: anchor at 10 matches, but beat partner id=1 is at 99 (not at inBeatTime)
        expect(result.inputIn).toBeDefined();
        expect(result.inputIn!.input).toEqual({ id: 1, time: 10 });
        expect(result.inputIn!.beat).toEqual({ id: 1, time: 99 }); // beat partner found by id
        expect(result.inputOut).toBeUndefined();
        expect(result.outputIn).toBeUndefined();
        expect(result.outputOut).toBeUndefined();
    });

    it("all four edges undefined when no anchors match any edge", () => {
        const region = makeRegion({ inPoint: 10, outPoint: 20, inBeatTime: 5, outBeatTime: 15 });
        const anchors: Anchor[] = [{ id: 1, time: 50 }];
        const beatAnchors: Anchor[] = [{ id: 1, time: 50 }];
        const result = detectLinkState(region, anchors, beatAnchors);
        expect(result.inputIn).toBeUndefined();
        expect(result.inputOut).toBeUndefined();
        expect(result.outputIn).toBeUndefined();
        expect(result.outputOut).toBeUndefined();
    });
});
