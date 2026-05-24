import { describe, it, expect } from "vitest";
import { createTimelineController } from "../../src/timeline/controller";
import { buildLayout } from "../../src/timeline/layout";
import type { Snapshot, PointerEventLike } from "../../src/timeline/types";

const CANVAS_W = 1000;
const CANVAS_H = 100;

function makeSnap(overrides: Partial<Snapshot> = {}): Snapshot {
    const tracks = buildLayout(false, CANVAS_H);
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
        regionsOutput: undefined,
        regionDetails: [],
        selectedClipinIds: new Set<string>(),
        selectedClipoutIds: new Set<string>(),
        scenes: [],
        selectedSceneTimes: new Set<number>(),
        segments: [],
        bpm: 120,
        beatOffset: 0,
        snapInterval: undefined,
        snapOffset: undefined,
        followDrag: false,
        warpCollapsed: false,
        canvas: { width: CANVAS_W, height: CANVAS_H },
        tracks,
        hits: [],
        playhead: 0,
        timelineMode: "condensed",
        ...overrides,
    } as Snapshot;
}

function pe(x: number, opts: Partial<PointerEventLike> = {}): PointerEventLike {
    return {
        clientX: x,
        clientY: 60,
        button: 0,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        canvasRect: { left: 0, top: 0, width: CANVAS_W, height: CANVAS_H },
        ...opts,
    };
}

describe("controller condensed mode", () => {
    it("pointerDown emits setPlayhead and starts a scrub drag", () => {
        const c = createTimelineController();
        const intents = c.pointerDown(pe(500), makeSnap());
        const setPh = intents.find((i) => i.kind === "setPlayhead");
        expect(setPh).toBeDefined();
        expect((setPh as { tSec: number }).tSec).toBeCloseTo(5, 2);
        expect(c.getDragState()?.kind).toBe("scrub");
    });

    it("middle-click pointerDown also starts a scrub (so it can't drag elements)", () => {
        const c = createTimelineController();
        const intents = c.pointerDown(pe(500, { button: 1 }), makeSnap());
        const setPh = intents.find((i) => i.kind === "setPlayhead");
        expect(setPh).toBeDefined();
        expect((setPh as { tSec: number }).tSec).toBeCloseTo(5, 2);
        expect(c.getDragState()?.kind).toBe("scrub");
    });

    it("right-click pointerDown does NOT start a scrub (context menu path)", () => {
        const c = createTimelineController();
        const intents = c.pointerDown(pe(500, { button: 2 }), makeSnap());
        expect(intents.find((i) => i.kind === "setPlayhead")).toBeUndefined();
        expect(c.getDragState()).toBeNull();
    });

    it("pointerMove during scrub emits setPlayhead at the new cursor time", () => {
        const c = createTimelineController();
        c.pointerDown(pe(500), makeSnap());
        const intents = c.pointerMove(pe(700), makeSnap());
        const setPh = intents.find((i) => i.kind === "setPlayhead");
        expect(setPh).toBeDefined();
        expect((setPh as { tSec: number }).tSec).toBeCloseTo(7, 2);
    });

    it("pointerUp ends the scrub drag", () => {
        const c = createTimelineController();
        c.pointerDown(pe(500), makeSnap());
        c.pointerUp(makeSnap());
        expect(c.getDragState()).toBeNull();
    });

    it("Alt-held pointerDown does NOT start a scrub", () => {
        const c = createTimelineController();
        c.pointerDown(pe(500, { altKey: true }), makeSnap());
        expect(c.getDragState()?.kind).not.toBe("scrub");
    });

    it("warp mode is unaffected (no scrub, no setPlayhead)", () => {
        const c = createTimelineController();
        const intents = c.pointerDown(pe(500), makeSnap({ timelineMode: "warp" }));
        expect(intents.find((i) => i.kind === "setPlayhead")).toBeUndefined();
        expect(c.getDragState()?.kind).not.toBe("scrub");
    });
});
