import { describe, it, expect } from "vitest";
import { smallestVisibleBeatGridSec } from "../../../../src/timeline/model/snapTarget";

describe("smallestVisibleBeatGridSec", () => {
    it("returns Infinity for invalid inputs", () => {
        expect(smallestVisibleBeatGridSec(0, 800, 60)).toBe(Number.POSITIVE_INFINITY);
        expect(smallestVisibleBeatGridSec(100, 0, 60)).toBe(Number.POSITIVE_INFINITY);
        expect(smallestVisibleBeatGridSec(100, 800, 0)).toBe(Number.POSITIVE_INFINITY);
    });

    it("returns sub-beat spacing at high zoom (large ppb)", () => {
        expect(smallestVisibleBeatGridSec(10, 1000, 60)).toBeCloseTo(0.25);
    });

    it("returns bar-level spacing at low zoom (large viewSpan)", () => {
        // Very zoomed out — groups of bars
        const result = smallestVisibleBeatGridSec(10000, 800, 60);
        expect(result).toBeGreaterThan(1);
    });
});
