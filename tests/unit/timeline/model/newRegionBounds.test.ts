import { describe, it, expect } from "vitest";
import {
    findSurroundingScenes,
    calcNewRegionBoundsFromScenes,
} from "../../../../src/timeline/model/newRegionBounds";
import type { View } from "../../../../src/types";

describe("findSurroundingScenes", () => {
    it("brackets cursor between two cuts", () => {
        expect(findSurroundingScenes(7, [3, 10, 18], 20)).toEqual({ prev: 3, next: 10 });
    });

    it("uses 0 as the prev boundary when cursor is before the first cut", () => {
        expect(findSurroundingScenes(1, [5, 10], 20)).toEqual({ prev: 0, next: 5 });
    });

    it("uses duration as the next boundary when cursor is past the last cut", () => {
        expect(findSurroundingScenes(15, [5, 10], 20)).toEqual({ prev: 10, next: 20 });
    });

    it("returns null for zero-duration videos", () => {
        expect(findSurroundingScenes(0, [], 0)).toBeNull();
    });

    it("ignores cuts at or outside the video bounds", () => {
        expect(findSurroundingScenes(5, [-1, 0, 15, 20, 25], 20)).toEqual({ prev: 0, next: 15 });
    });
});

describe("calcNewRegionBoundsFromScenes", () => {
    const view: View = { start: 0, end: 20 };

    it("returns prev/next scene bounds when both are in view", () => {
        expect(calcNewRegionBoundsFromScenes(7, view, [3, 10, 18], 30)).toEqual({
            inPoint: 3,
            outPoint: 10,
        });
    });

    it("clamps the out-point to view.end when the next scene is past it", () => {
        // Updated to match the new spec: when the next scene is offscreen, the
        // viewport end is the next-side wall (not a 5s/10% fallback).
        const narrow: View = { start: 0, end: 8 };
        const result = calcNewRegionBoundsFromScenes(7, narrow, [3, 10, 18], 30);
        expect(result).toEqual({ inPoint: 3, outPoint: 8 });
    });

    it("clamps the in-point to view.start when the previous scene is before it", () => {
        const view: View = { start: 50, end: 90 };
        const result = calcNewRegionBoundsFromScenes(60, view, [10, 80], 120);
        expect(result).toEqual({ inPoint: 50, outPoint: 80 });
    });

    it("treats prev region outPoint as a left wall, scene only beats it if later", () => {
        const view: View = { start: 50, end: 100 };
        const regions = [{ inPoint: 60, outPoint: 70 }];
        const result = calcNewRegionBoundsFromScenes(80, view, [55], 120, regions);
        expect(result).toEqual({ inPoint: 70, outPoint: 100 });
    });

    it("treats next region inPoint as a right wall, scene only beats it if earlier", () => {
        const view: View = { start: 50, end: 100 };
        const regions = [{ inPoint: 80, outPoint: 90 }];
        const result = calcNewRegionBoundsFromScenes(60, view, [95], 120, regions);
        expect(result).toEqual({ inPoint: 50, outPoint: 80 });
    });

    it("slides the cursor to the existing region outPoint when clicked inside", () => {
        const view: View = { start: 50, end: 100 };
        const regions = [{ inPoint: 60, outPoint: 70 }];
        const result = calcNewRegionBoundsFromScenes(65, view, [80], 120, regions);
        expect(result).toEqual({ inPoint: 70, outPoint: 80 });
    });

    it("falls back when there are no scene cuts", () => {
        const result = calcNewRegionBoundsFromScenes(5, view, [], 30);
        expect(result.inPoint).toBe(5);
        expect(result.outPoint).toBeCloseTo(10);
    });

    it("falls back when surrounding scenes are too close together", () => {
        // Cuts at 6.9 and 7.1 — span 0.2 < MIN_VISIBLE
        const result = calcNewRegionBoundsFromScenes(7, view, [6.9, 7.1], 30);
        expect(result.inPoint).toBe(7);
    });
});
