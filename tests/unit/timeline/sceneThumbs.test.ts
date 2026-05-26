import { describe, it, expect } from "vitest";
import { visibleSceneThumbs } from "../../../src/timeline/sceneThumbs";

describe("visibleSceneThumbs", () => {
    const linX = (t: number) => t * 100; // 1 unit = 100 px

    it("returns every scene at full natural width when none overlap", () => {
        const slots = visibleSceneThumbs([0, 1, 2], linX, 50, 1000);
        expect(slots.map((s) => s.time)).toEqual([0, 1, 2]);
        expect(slots.every((s) => s.width === 50)).toBe(true);
        expect(slots.every((s) => s.naturalW === 50)).toBe(true);
    });

    it("shrinks the earlier slot to the gap when the next scene is close", () => {
        // gap 30 px, naturalW 50 → first slot clamps to 30
        const slots = visibleSceneThumbs([0, 0.3, 2], linX, 50, 1000);
        expect(slots.map((s) => s.time)).toEqual([0, 0.3, 2]);
        expect(slots[0].width).toBe(30);
        expect(slots[0].naturalW).toBe(50);
        expect(slots[1].width).toBe(50);
    });

    it("drops sub-3px slivers", () => {
        // gap 2 px → below MIN_SLOT_W
        const slots = visibleSceneThumbs([0, 0.02, 2], linX, 50, 1000);
        expect(slots.map((s) => s.time)).toEqual([0.02, 2]);
    });

    it("drops scenes whose right edge falls before the viewport", () => {
        const slots = visibleSceneThumbs([-2, 1], linX, 50, 1000);
        // scene at -2 → x=-200, right=-150 → off-canvas
        expect(slots.map((s) => s.time)).toEqual([1]);
    });

    it("drops scenes whose left edge falls past the viewport", () => {
        const slots = visibleSceneThumbs([1, 20], linX, 50, 1000);
        // scene at 20 → x=2000 > viewportW
        expect(slots.map((s) => s.time)).toEqual([1]);
    });

    it("returns nothing when naturalW <= 0", () => {
        expect(visibleSceneThumbs([0, 1], linX, 0, 1000)).toEqual([]);
        expect(visibleSceneThumbs([0, 1], linX, -10, 1000)).toEqual([]);
    });

    it("sorts unsorted input before culling", () => {
        const slots = visibleSceneThumbs([2, 0, 1], linX, 50, 1000);
        expect(slots.map((s) => s.time)).toEqual([0, 1, 2]);
    });
});
