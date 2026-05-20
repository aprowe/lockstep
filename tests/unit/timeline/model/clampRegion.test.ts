import { describe, it, expect } from "vitest";
import { clampRegionInOut, MIN_REGION_LENGTH } from "../../../../src/timeline/model/clampRegion";

describe("clampRegionInOut", () => {
    const current = { inPoint: 10, outPoint: 20 };

    it("returns unchanged when bounds are within constraints", () => {
        expect(clampRegionInOut(current, { inPoint: 12, outPoint: 18 })).toEqual({
            inPoint: 12,
            outPoint: 18,
        });
    });

    it("shifts out when in moves past out (preserve length)", () => {
        expect(clampRegionInOut(current, { inPoint: 25, outPoint: 20 })).toEqual({
            inPoint: 25,
            outPoint: 35,
        });
    });

    it("shifts in when out moves before in (preserve length)", () => {
        expect(clampRegionInOut(current, { inPoint: 10, outPoint: 5 })).toEqual({
            inPoint: -5,
            outPoint: 5,
        });
    });

    it("pulls in back when in moves too close to out", () => {
        expect(clampRegionInOut(current, { inPoint: 19.5, outPoint: 20 })).toEqual({
            inPoint: 19,
            outPoint: 20,
        });
    });

    it("pushes out forward when out moves too close to in", () => {
        expect(clampRegionInOut(current, { inPoint: 10, outPoint: 10.5 })).toEqual({
            inPoint: 10,
            outPoint: 11,
        });
    });

    it("accepts a custom min length", () => {
        expect(
            clampRegionInOut(current, { inPoint: 10, outPoint: 10.1 }, { minLength: 0.1 }),
        ).toEqual({ inPoint: 10, outPoint: 10.1 });
    });

    it("exports MIN_REGION_LENGTH = 1", () => {
        expect(MIN_REGION_LENGTH).toBe(1);
    });
});
