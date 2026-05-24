import { describe, it, expect } from "vitest";
import { hitAtCondensed } from "../../src/timeline/hitTest";
import type { Snapshot } from "../../src/timeline/types";

function condensedSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
    return {
        view: { start: 0, end: 10 },
        duration: 10,
        outputDuration: 10,
        maxDuration: 10,
        anchors: [],
        beatAnchors: [],
        linkedBeatIds: new Set<number>(),
        selectedOrigAnchorIds: new Set<number>(),
        selectedBeatAnchorIds: new Set<number>(),
        regions: [],
        regionDetails: [],
        selectedClipinIds: new Set<string>(),
        selectedClipoutIds: new Set<string>(),
        scenes: [],
        selectedSceneTimes: new Set<number>(),
        segments: [],
        bpm: 120,
        followDrag: false,
        warpCollapsed: false,
        canvas: { width: 1000, height: 100 },
        tracks: [
            {
                id: "condensed",
                label: "Condensed",
                h: 76,
                space: "input",
                flex: 1,
                y: 25,
            },
        ],
        hits: [],
        timelineMode: "condensed",
        ...overrides,
    } as Snapshot;
}

describe("condensed hit-test priority", () => {
    it("returns 'empty' when no entities are at the cursor", () => {
        const snap = condensedSnapshot();
        const hit = hitAtCondensed(500, 60, snap);
        expect(hit.kind).toBe("empty");
    });

    it("returns 'empty' when y is outside the condensed track", () => {
        const snap = condensedSnapshot({
            anchors: [{ id: 1, time: 5 } as any],
        });
        // y=5 is above the condensed track (which starts at y=25)
        const hit = hitAtCondensed(500, 5, snap);
        expect(hit.kind).toBe("empty");
    });

    it("prefers anchor over region body at the same x", () => {
        const snap = condensedSnapshot({
            anchors: [{ id: 1, time: 5 } as any],
            regions: [{ id: "r1", inPoint: 4, outPoint: 6 } as any],
        });
        const hit = hitAtCondensed(500, 60, snap);
        expect(hit.kind).toBe("anchor");
        expect((hit as any).id).toBe(1);
    });

    it("prefers region edge over region body", () => {
        const snap = condensedSnapshot({
            regions: [{ id: "r1", inPoint: 4, outPoint: 6 } as any],
        });
        // x=400 corresponds to t=4 (inPoint) in view 0..10 over 1000px
        const hit = hitAtCondensed(400, 60, snap);
        expect(hit.kind).toBe("region-edge");
        expect((hit as any).id).toBe("r1");
        expect((hit as any).edge).toBe("in");
    });

    it("prefers region body over scene cut", () => {
        const snap = condensedSnapshot({
            regions: [{ id: "r1", inPoint: 4, outPoint: 6 } as any],
            scenes: [5],
        });
        const hit = hitAtCondensed(500, 60, snap);
        expect(hit.kind).toBe("region");
        expect((hit as any).id).toBe("r1");
    });

    it("returns sceneCut when only a scene is at the cursor", () => {
        const snap = condensedSnapshot({ scenes: [5] });
        const hit = hitAtCondensed(500, 60, snap);
        expect(hit.kind).toBe("sceneCut");
        expect((hit as any).time).toBe(5);
    });
});
