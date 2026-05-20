import { describe, it, expect } from "vitest";
import {
    snapToBeat,
    snapAllToBeat,
    buildSegments,
    computeOutputDuration,
    origBands,
    quantBands,
} from "../../../src/utils/quantize";
import type { Anchor } from "../../../src/types";

describe("snapToBeat", () => {
    it("snaps a time exactly on a beat boundary unchanged", () => {
        expect(snapToBeat(1.0, 120)).toBeCloseTo(1.0);
        expect(snapToBeat(2.5, 120)).toBeCloseTo(2.5);
    });

    it("rounds to the nearest beat", () => {
        expect(snapToBeat(0.3, 120)).toBeCloseTo(0.5);
        expect(snapToBeat(0.2, 120)).toBeCloseTo(0.0);
    });
});

describe("snapAllToBeat", () => {
    const beat = 0.5;

    it("returns anchors unchanged when beat is 0", () => {
        const anchors: Anchor[] = [{ id: 1, time: 0.3 }];
        expect(snapAllToBeat(anchors, 0, 0)).toEqual(anchors);
    });

    it("returns anchors unchanged when empty", () => {
        expect(snapAllToBeat([], beat, 0)).toEqual([]);
    });

    it("snaps a single anchor to the nearest beat", () => {
        const result = snapAllToBeat([{ id: 1, time: 0.3 }], beat, 0);
        expect(result[0].time).toBeCloseTo(0.5);
    });

    it("snaps with a non-zero beat offset (phase)", () => {
        const result = snapAllToBeat([{ id: 1, time: 0.65 }], beat, 0.1);
        expect(result[0].time).toBeCloseTo(0.6);
    });

    it("closest anchor wins a conflict — loser keeps original time", () => {
        const anchors: Anchor[] = [
            { id: 1, time: 0.9 },
            { id: 2, time: 1.2 },
        ];
        const result = snapAllToBeat(anchors, 1.0, 0);
        expect(result.find((a) => a.id === 1)!.time).toBeCloseTo(1.0);
        expect(result.find((a) => a.id === 2)!.time).toBeCloseTo(1.2);
    });

    it("both anchors snap to distinct beats when there is no conflict", () => {
        const anchors: Anchor[] = [
            { id: 1, time: 0.45 },
            { id: 2, time: 1.45 },
        ];
        const result = snapAllToBeat(anchors, 1.0, 0);
        expect(result.find((a) => a.id === 1)!.time).toBeCloseTo(0.0);
        expect(result.find((a) => a.id === 2)!.time).toBeCloseTo(1.0);
    });
});

describe("computeOutputDuration", () => {
    it("returns origDuration when there are no beat anchors", () => {
        expect(computeOutputDuration([], [], 60)).toBe(60);
    });

    it("computes duration: lastBeat + (origDuration - lastOrig)", () => {
        const orig: Anchor[] = [{ id: 1, time: 10 }];
        const beat: Anchor[] = [{ id: 1, time: 12 }];
        expect(computeOutputDuration(orig, beat, 60)).toBe(62);
    });

    it("handles stretching the tail (last beat > last orig)", () => {
        const orig: Anchor[] = [{ id: 1, time: 50 }];
        const beat: Anchor[] = [{ id: 1, time: 55 }];
        expect(computeOutputDuration(orig, beat, 60)).toBe(65);
    });
});

describe("buildSegments", () => {
    it("builds one segment when there are no anchors", () => {
        const segs = buildSegments([], [], 60, 60);
        expect(segs).toHaveLength(1);
        expect(segs[0].stretchRatio).toBeCloseTo(1);
        expect(segs[0].origLeft).toBeCloseTo(0);
        expect(segs[0].origRight).toBeCloseTo(100);
    });

    it("builds N+1 segments for N anchors", () => {
        const orig: Anchor[] = [
            { id: 1, time: 20 },
            { id: 2, time: 40 },
        ];
        const beat: Anchor[] = [
            { id: 1, time: 20 },
            { id: 2, time: 40 },
        ];
        const segs = buildSegments(orig, beat, 60, 60);
        expect(segs).toHaveLength(3);
    });

    it("computes stretchRatio correctly for a stretched segment", () => {
        const orig: Anchor[] = [{ id: 1, time: 10 }];
        const beat: Anchor[] = [{ id: 1, time: 20 }];
        const segs = buildSegments(orig, beat, 60, 70);
        expect(segs[0].stretchRatio).toBeCloseTo(2.0);
    });

    it("computes percentages relative to their respective durations", () => {
        const orig: Anchor[] = [{ id: 1, time: 30 }];
        const beat: Anchor[] = [{ id: 1, time: 30 }];
        const segs = buildSegments(orig, beat, 60, 60);
        expect(segs[0].origLeft).toBeCloseTo(0);
        expect(segs[0].origRight).toBeCloseTo(50);
        expect(segs[1].origLeft).toBeCloseTo(50);
        expect(segs[1].origRight).toBeCloseTo(100);
    });
});

describe("origBands / quantBands", () => {
    it("extracts orig bounds", () => {
        const segs = buildSegments([{ id: 1, time: 30 }], [{ id: 1, time: 30 }], 60, 60);
        const bands = origBands(segs);
        expect(bands[0]).toMatchObject({ left: segs[0].origLeft, right: segs[0].origRight });
    });

    it("extracts quant bounds", () => {
        const segs = buildSegments([{ id: 1, time: 30 }], [{ id: 1, time: 30 }], 60, 60);
        const bands = quantBands(segs);
        expect(bands[0]).toMatchObject({ left: segs[0].quantLeft, right: segs[0].quantRight });
    });
});
