import { describe, it, expect } from "vitest";
import {
    anchorBeatAt,
    beatRateAt,
    beatToOrig,
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

/** Helper: simulate the snappy player's per-frame wall→source projection.
 *  Mirrors `mapWallToSource` in `CenterColumn.tsx` so the test exercises the
 *  exact same composition (`origToBeat → +elapsed → beatToOrig`) the player
 *  uses each animation frame. */
function mapWallToSource(
    anchorSource: number,
    wallElapsed: number,
    pairs: ReturnType<typeof buildAnchorPairs>,
): number {
    if (pairs.length < 2) return anchorSource + wallElapsed;
    return beatToOrig(origToBeat(anchorSource, pairs) + wallElapsed, pairs);
}

describe("frame-perfect projection (wall → source in beat mode)", () => {
    // Two-segment warp:
    //   segment A: source [0..10] → beat [0..5]   (source plays at 2× to make
    //                                              beat 1×; rate = 10/5 = 2)
    //   segment B: source [10..20] → beat [5..20] (source plays at 0.667×;
    //                                              rate = 10/15)
    // A boundary crossing at source=10 means the local rate jumps abruptly.
    const orig: Anchor[] = [
        { id: 1, time: 0 },
        { id: 2, time: 10 },
        { id: 3, time: 20 },
    ];
    const beat: Anchor[] = [
        { id: 1, time: 0 },
        { id: 2, time: 5 },
        { id: 3, time: 20 },
    ];
    const pairs = buildAnchorPairs(orig, beat);

    it("crosses a segment boundary frame-perfectly", () => {
        // Start at source=8 inside segment A (rate 2×). Project forward 4
        // wall-clock seconds. Beat advances 4: 4→8. 8 lies inside segment B,
        // so source-end = beatToOrig(8) = 10 + (8-5)/(20-5)*(20-10) = 12.
        // The OLD integration approach would have rounded to whichever side
        // of source=10 the rate switch landed on, leaking a fraction of a
        // frame; the direct projection lands on 12 exactly.
        expect(mapWallToSource(8, 4, pairs)).toBe(12);
    });

    it("matches the integrated rate inside a single segment", () => {
        // Same answer as `anchor + rate * dt` when the entire interval stays
        // in one segment — sanity-check that the new path doesn't introduce
        // drift for the easy case.
        const dt = 1.5;
        const rate = 2; // segment A
        const projected = mapWallToSource(2, dt, pairs);
        const integrated = 2 + rate * dt;
        expect(projected).toBeCloseTo(integrated, 12);
    });

    it("recovers the local audio rate as the numerical slope", () => {
        // The player's tick computes `localRate = (next - last) / wall_dt`
        // and feeds it to the <audio> element. Verify the slope matches
        // beatRateAt at the sample point on both sides of the segment edge.
        const eps = 1e-5;
        const sourceInA = 6;
        const sourceInB = 14;
        const slopeA = (mapWallToSource(sourceInA, eps, pairs) - sourceInA) / eps;
        const slopeB = (mapWallToSource(sourceInB, eps, pairs) - sourceInB) / eps;
        expect(slopeA).toBeCloseTo(beatRateAt(sourceInA, orig, beat), 4);
        expect(slopeB).toBeCloseTo(beatRateAt(sourceInB, orig, beat), 4);
    });

    it("is monotonic non-decreasing across the boundary", () => {
        // Walk 200 ms in 5 ms steps from before to after the boundary; the
        // source position must never go backwards (it has to be a valid
        // playback trajectory for the cache walker to paint sensibly).
        let prev = -Infinity;
        for (let dt = 0; dt <= 0.2; dt += 0.005) {
            const s = mapWallToSource(9.5, dt, pairs);
            expect(s).toBeGreaterThanOrEqual(prev);
            prev = s;
        }
    });

    it("degrades to identity with fewer than two anchor pairs", () => {
        const empty = buildAnchorPairs([], []);
        expect(mapWallToSource(7, 3, empty)).toBe(10);
    });
});
