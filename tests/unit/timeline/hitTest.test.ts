import { describe, it, expect } from "vitest";
import { createHitListBuilder, hitAt } from "../../../src/timeline/hitTest";

describe("createHitListBuilder", () => {
    it("returns an empty result when no hits are added", () => {
        const b = createHitListBuilder();
        expect(b.result()).toEqual([]);
    });

    it("captures added rects in insertion order", () => {
        const b = createHitListBuilder();
        b.add(0, 0, 10, 10, "a");
        b.add(20, 0, 10, 10, "b");
        const result = b.result();
        expect(result.length).toBe(2);
        expect(result[0].data).toBe("a");
        expect(result[1].data).toBe("b");
    });

    it("returns the same underlying array on repeated calls", () => {
        const b = createHitListBuilder();
        b.add(0, 0, 10, 10, "a");
        const r1 = b.result();
        b.add(20, 0, 10, 10, "b");
        const r2 = b.result();
        expect(r2.length).toBe(2);
        // Same reference (callers can rely on it staying live)
        expect(r1).toBe(r2);
    });
});

describe("hitAt", () => {
    it("returns null when no rect contains the point", () => {
        const b = createHitListBuilder();
        b.add(0, 0, 10, 10, "a");
        expect(hitAt(b.result(), 50, 50)).toBeNull();
    });

    it("returns the data of a containing rect", () => {
        const b = createHitListBuilder();
        b.add(0, 0, 10, 10, "a");
        expect(hitAt(b.result(), 5, 5)).toBe("a");
    });

    it("returns the most-recently-added rect when rects overlap (topmost-first)", () => {
        const b = createHitListBuilder();
        b.add(0, 0, 100, 100, "bottom");
        b.add(10, 10, 20, 20, "top");
        expect(hitAt(b.result(), 15, 15)).toBe("top");
    });

    it("treats the right/bottom edges as inclusive", () => {
        const b = createHitListBuilder();
        b.add(0, 0, 10, 10, "a");
        expect(hitAt(b.result(), 10, 10)).toBe("a");
        expect(hitAt(b.result(), 0, 0)).toBe("a");
    });

    it("handles an empty hit list", () => {
        expect(hitAt([], 5, 5)).toBeNull();
    });
});
