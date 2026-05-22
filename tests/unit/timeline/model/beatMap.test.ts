import { describe, it, expect } from "vitest";
import {
    anchorBeatAt,
    beatRateAt,
    buildAnchorPairs,
    origToBeat,
} from "../../../../src/timeline/model/beatMap";
import type { Anchor } from "../../../../src/types";

describe("buildAnchorPairs", () => {
    it("pairs anchors with their beat counterparts by id and sorts by input time", () => {
        const anchors: Anchor[] = [
            { id: 1, time: 30 },
            { id: 2, time: 10 },
            { id: 3, time: 20 },
        ];
        const beatAnchors: Anchor[] = [
            { id: 1, time: 15 },
            { id: 2, time: 5 },
            { id: 3, time: 10 },
        ];
        expect(buildAnchorPairs(anchors, beatAnchors)).toEqual([
            { id: 2, inT: 10, outT: 5 },
            { id: 3, inT: 20, outT: 10 },
            { id: 1, inT: 30, outT: 15 },
        ]);
    });

    it("drops anchors without a beat pair", () => {
        const anchors: Anchor[] = [
            { id: 1, time: 10 },
            { id: 2, time: 20 },
        ];
        const beatAnchors: Anchor[] = [{ id: 2, time: 10 }]; // no pair for id 1
        expect(buildAnchorPairs(anchors, beatAnchors)).toEqual([{ id: 2, inT: 20, outT: 10 }]);
    });

    it("returns empty for empty input", () => {
        expect(buildAnchorPairs([], [])).toEqual([]);
    });
});

describe("origToBeat", () => {
    const pairs = [
        { id: 1, inT: 10, outT: 5 },
        { id: 2, inT: 20, outT: 12 },
    ];

    it("returns t unchanged when no pairs", () => {
        expect(origToBeat(5, [])).toBe(5);
    });

    it("returns the pair beat at the pair input", () => {
        expect(origToBeat(10, pairs)).toBe(5);
        expect(origToBeat(20, pairs)).toBe(12);
    });

    it("linearly interpolates between consecutive pairs", () => {
        expect(origToBeat(15, pairs)).toBe(8.5); // (5+12)/2
    });

    it("returns t unchanged outside the pair range", () => {
        expect(origToBeat(5, pairs)).toBe(5);
        expect(origToBeat(25, pairs)).toBe(25);
    });

    it("handles degenerate pairs (same input time) without dividing by zero", () => {
        const degen = [
            { id: 1, inT: 10, outT: 5 },
            { id: 2, inT: 10, outT: 6 },
        ];
        expect(origToBeat(10, degen)).toBe(5);
    });
});

describe("anchorBeatAt", () => {
    const anchors: Anchor[] = [{ id: 1, time: 10 }];
    const beatAnchors: Anchor[] = [{ id: 1, time: 5 }];

    it("returns the beat time when an anchor sits exactly on the input time", () => {
        expect(anchorBeatAt(10, anchors, beatAnchors)).toBe(5);
    });

    it("returns undefined when no anchor matches", () => {
        expect(anchorBeatAt(10.5, anchors, beatAnchors)).toBeUndefined();
    });

    it("uses 1e-4 tolerance", () => {
        expect(anchorBeatAt(10.00005, anchors, beatAnchors)).toBe(5);
        expect(anchorBeatAt(10.001, anchors, beatAnchors)).toBeUndefined();
    });

    it("returns undefined when the anchor has no beat pair", () => {
        expect(anchorBeatAt(10, anchors, [])).toBeUndefined();
    });
});

describe("beatRateAt", () => {
    // Two segments: [0..10] orig stretches to [0..5] beat (2× faster than beat),
    // [10..20] orig stretches to [5..20] beat (1.5× slower than beat).
    const anchors: Anchor[] = [
        { id: 1, time: 0 },
        { id: 2, time: 10 },
        { id: 3, time: 20 },
    ];
    const beatAnchors: Anchor[] = [
        { id: 1, time: 0 },
        { id: 2, time: 5 },
        { id: 3, time: 20 },
    ];

    it("returns origSpan / beatSpan inside each segment", () => {
        expect(beatRateAt(5, anchors, beatAnchors)).toBe(2);
        expect(beatRateAt(15, anchors, beatAnchors)).toBeCloseTo(10 / 15);
    });

    it("returns 1 outside the anchor range", () => {
        expect(beatRateAt(-1, anchors, beatAnchors)).toBe(1);
        expect(beatRateAt(25, anchors, beatAnchors)).toBe(1);
    });

    it("returns 1 with fewer than two anchors", () => {
        expect(beatRateAt(5, [], [])).toBe(1);
        expect(beatRateAt(5, [{ id: 1, time: 0 }], [{ id: 1, time: 0 }])).toBe(1);
    });

    it("returns 1 on a degenerate zero-length segment", () => {
        const a: Anchor[] = [
            { id: 1, time: 5 },
            { id: 2, time: 5 },
        ];
        const b: Anchor[] = [
            { id: 1, time: 0 },
            { id: 2, time: 1 },
        ];
        expect(beatRateAt(5, a, b)).toBe(1);
    });
});
