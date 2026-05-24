import { describe, it, expect } from "vitest";
import { buildLayout, MINIMAP_H } from "../../src/timeline/layout";

describe("condensed layout", () => {
    it("produces exactly one track when timelineMode is 'condensed'", () => {
        const tracks = buildLayout(false, 200, {}, "condensed");
        expect(tracks).toHaveLength(1);
        expect(tracks[0]?.id).toBe("condensed");
        expect(tracks[0]?.y).toBe(MINIMAP_H + 1);
    });

    it("condensed track height fills available space below minimap", () => {
        const tracks = buildLayout(false, 200, {}, "condensed");
        const total = (tracks[0]?.h ?? 0) + MINIMAP_H + 1;
        expect(total).toBeCloseTo(200, 0);
    });

    it("warp mode still returns the existing multi-track layout", () => {
        const tracks = buildLayout(false, 400, {}, "warp");
        expect(tracks.length).toBeGreaterThan(1);
        expect(tracks.some((t) => t.id === "warp")).toBe(true);
    });
});
