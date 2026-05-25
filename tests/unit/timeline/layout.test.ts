import { describe, it, expect } from "vitest";
import { buildLayout, ALL_TRACKS, MINIMAP_H } from "../../../src/timeline/layout";

describe("buildLayout", () => {
    it("renders all rows when warp is expanded", () => {
        const layout = buildLayout(false, 600);
        expect(layout.length).toBe(ALL_TRACKS.length);
        expect(layout.map((t) => t.id)).toEqual(ALL_TRACKS.map((t) => t.id));
    });

    it("renders only input-space rows when warp is collapsed", () => {
        const layout = buildLayout(true, 400);
        expect(layout.every((t) => t.space === "input")).toBe(true);
        const inputIds = ALL_TRACKS.filter((t) => t.space === "input").map((t) => t.id);
        expect(layout.map((t) => t.id)).toEqual(inputIds);
    });

    it("places the first row just below the minimap with a 1px gap", () => {
        const layout = buildLayout(false, 600);
        expect(layout[0].y).toBe(MINIMAP_H + 1);
    });

    it("stacks rows with 1px gaps in order", () => {
        const layout = buildLayout(false, 600);
        for (let i = 1; i < layout.length; i++) {
            const prev = layout[i - 1];
            expect(layout[i].y).toBeCloseTo(prev.y + prev.h + 1, 5);
        }
    });

    it("distributes leftover height across flex>0 rows", () => {
        // Pick a height that leaves clearly extra room
        const layout = buildLayout(false, 800);
        const flexed = layout.filter((t) => {
            const def = ALL_TRACKS.find((d) => d.id === t.id)!;
            return def.flex > 0;
        });
        const minH = flexed.reduce((sum, t) => {
            const def = ALL_TRACKS.find((d) => d.id === t.id)!;
            return sum + def.h;
        }, 0);
        const actualH = flexed.reduce((sum, t) => sum + t.h, 0);
        expect(actualH).toBeGreaterThan(minH);
    });

    it("keeps flex-0 rows at their base height", () => {
        const layout = buildLayout(false, 800);
        for (const tr of layout) {
            const def = ALL_TRACKS.find((d) => d.id === tr.id)!;
            if (def.flex === 0) {
                expect(tr.h).toBe(def.h);
            }
        }
    });

    it("honors per-row overrides, locking the row at the override height", () => {
        const layout = buildLayout(false, 800, { time: 50 });
        const time = layout.find((t) => t.id === "time")!;
        expect(time.h).toBe(50);
    });

    it("uses default height when no override is provided", () => {
        const layout = buildLayout(false, 600, { time: 50 });
        expect(layout.find((t) => t.id === "time")!.h).toBe(50);
        // Other flex-0 row should be at default height
        expect(layout.find((t) => t.id === "scenes")!.h).toBe(18);
    });

    it("returns rows whose y + h never exceeds the available area", () => {
        const totalH = 500;
        const layout = buildLayout(false, totalH);
        const last = layout[layout.length - 1];
        expect(last.y + last.h).toBeLessThanOrEqual(totalH);
    });

    it("drops bottom rows when totalH is too small, keeping top rows at preferred size", () => {
        // 100px isn't enough for the full stack; top rows should stay at
        // preferred height and bottom rows should be absent from the result.
        const totalH = 100;
        const layout = buildLayout(false, totalH);
        // Some rows have been dropped.
        expect(layout.length).toBeLessThan(ALL_TRACKS.length);
        // Surviving rows (except possibly the last, which may be partial) are
        // at their preferred height.
        for (let i = 0; i < layout.length - 1; i++) {
            const def = ALL_TRACKS.find((d) => d.id === layout[i].id)!;
            expect(layout[i].h).toBe(def.h);
        }
        // Nothing spills past the bottom.
        const last = layout[layout.length - 1];
        expect(last.y + last.h).toBeLessThanOrEqual(totalH);
        // Top row is preserved.
        expect(layout[0].id).toBe(ALL_TRACKS[0].id);
    });

    it("allows the last visible row to render slightly under preferred, but drops it when too small", () => {
        const first = ALL_TRACKS[0];
        const second = ALL_TRACKS[1];
        // ~80% of second.h — above the 2/3 readability threshold, so it
        // should partial-render rather than drop.
        const partialH = Math.ceil((second.h * 4) / 5);
        const tallish = MINIMAP_H + 1 + first.h + 1 + partialH + 1;
        const layoutPartial = buildLayout(false, tallish);
        expect(layoutPartial.length).toBe(2);
        expect(layoutPartial[0].h).toBe(first.h);
        expect(layoutPartial[1].h).toBeLessThan(second.h);
        expect(layoutPartial[1].h).toBeGreaterThanOrEqual(Math.ceil((second.h * 2) / 3));

        // Below the threshold the second row should drop entirely.
        const squished = MINIMAP_H + 1 + first.h + 1 + Math.floor(second.h / 3) + 1;
        const layoutDrop = buildLayout(false, squished);
        expect(layoutDrop.length).toBe(1);
        expect(layoutDrop[0].id).toBe(first.id);
    });

    it("returns no tracks at the minimum (minimap-only) height", () => {
        const layout = buildLayout(false, MINIMAP_H + 1);
        expect(layout).toEqual([]);
    });
});
