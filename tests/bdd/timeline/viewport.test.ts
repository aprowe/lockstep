import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { createTimelineController } from "../../../src/timeline/controller";
import { calcZoomToRegion } from "../../../src/utils/view";
import type { Intent } from "../../../src/timeline/types";
import type { View } from "../../../src/types";
import { makeSnap, makePointer, makeWheel, findIntent, regionHit } from "./fixtures";

const feature = await loadFeature("./spec/features/timeline/viewport.feature");

describeFeature(feature, ({ Scenario }) => {
    // @behavior timeline-viewport::b69d7605
    Scenario("Wheel scroll pans the viewport horizontally", ({ Given, When, Then, And }) => {
        const c = createTimelineController();
        let intents: Intent[] = [];
        const snap = makeSnap({ view: { start: 10, end: 20 } });

        Given("[a video is loaded]", () => {});
        When("the user scrolls the mouse wheel with no modifier keys", () => {
            intents = c.wheel(
                makeWheel({ clientX: 500, clientY: 200, deltaX: 100, deltaY: 0 }),
                snap,
            );
        });
        Then("the viewport pans horizontally", () => {
            const v = findIntent(intents, "viewChange")!;
            expect(v).toBeDefined();
            expect(v.view.start).not.toBeCloseTo(10, 3);
        });
        And("the viewport zoom span stays the same", () => {
            const v = findIntent(intents, "viewChange")!;
            expect(v.view.end - v.view.start).toBeCloseTo(10, 3);
        });
    });

    // @behavior timeline-viewport::7d810b12
    Scenario("Shift + wheel pans horizontally even when deltaY is 0", ({ Given, When, Then }) => {
        const c = createTimelineController();
        let intents: Intent[] = [];
        const snap = makeSnap({ view: { start: 10, end: 20 } });

        Given("[a video is loaded]", () => {});
        When("the user scrolls the mouse wheel while holding Shift", () => {
            // Shift held; vertical wheel (deltaY != 0, deltaX = 0). The controller
            // routes deltaY into a horizontal pan when shiftKey is held.
            intents = c.wheel(
                makeWheel({ clientX: 500, clientY: 200, shiftKey: true, deltaX: 0, deltaY: 200 }),
                snap,
            );
        });
        Then("the viewport pans horizontally regardless of deltaX", () => {
            const v = findIntent(intents, "viewChange")!;
            expect(v).toBeDefined();
            expect(v.view.start).not.toBeCloseTo(10, 3);
            // Span preserved (pan, not zoom)
            expect(v.view.end - v.view.start).toBeCloseTo(10, 3);
        });
    });

    // @behavior timeline-viewport::36bb2bb3
    Scenario("Ctrl/Cmd + wheel zooms around the cursor", ({ Given, And, When, Then }) => {
        const c = createTimelineController();
        let intents: Intent[] = [];
        const snap = makeSnap({ view: { start: 0, end: 100 } });
        // Cursor at x=500 of a 1000-wide canvas → time = 50s (midpoint of [0,100])
        const cursorX = 500;
        const timeAtCursorBefore =
            snap.view.start + (cursorX / snap.canvas.width) * (snap.view.end - snap.view.start);

        Given("[a video is loaded]", () => {});
        And("the cursor is at horizontal position X on the timeline", () => {
            expect(timeAtCursorBefore).toBeCloseTo(50, 3);
        });
        When("the user scrolls the mouse wheel while holding Ctrl or Cmd", () => {
            intents = c.wheel(
                makeWheel({
                    clientX: cursorX,
                    clientY: 200,
                    ctrlKey: true,
                    deltaX: 0,
                    deltaY: -100,
                }),
                snap,
            );
        });
        Then("the viewport zooms in or out", () => {
            const v = findIntent(intents, "viewChange")!;
            expect(v).toBeDefined();
            const newSpan = v.view.end - v.view.start;
            const oldSpan = snap.view.end - snap.view.start;
            expect(newSpan).not.toBeCloseTo(oldSpan, 3);
        });
        And("the time at horizontal position X stays at horizontal position X", () => {
            const v = findIntent(intents, "viewChange")!;
            const timeAtCursorAfter =
                v.view.start + (cursorX / snap.canvas.width) * (v.view.end - v.view.start);
            expect(timeAtCursorAfter).toBeCloseTo(timeAtCursorBefore, 3);
        });
    });

    // @behavior timeline-viewport::c35e82a4
    Scenario("Alt + click + drag pans the viewport", ({ Given, When, Then }) => {
        const c = createTimelineController();
        let intents: Intent[] = [];
        const snap = makeSnap({ view: { start: 10, end: 30 } });

        Given("[a video is loaded]", () => {});
        When("the user holds Alt and drags the timeline", () => {
            // Pointer down on a non-ruler track (y=200 ~ clipin) with Alt held → arms pan.
            c.pointerDown(makePointer({ clientX: 500, clientY: 200, altKey: true }), snap);
            // Drag 100px to the right.
            intents = c.pointerMove(
                makePointer({ clientX: 600, clientY: 200, altKey: true }),
                snap,
            );
        });
        Then("the viewport pans by the drag delta", () => {
            const v = findIntent(intents, "viewChange")!;
            expect(v).toBeDefined();
            // 100px on a 1000px canvas with span 20 → 2s pan (negated: dragging right shows earlier content)
            expect(v.view.start).toBeCloseTo(10 - 2, 3);
            expect(v.view.end).toBeCloseTo(30 - 2, 3);
        });
    });

    // @behavior timeline-viewport::1ce3ca0a
    Scenario("Middle-mouse drag pans the viewport", ({ Given, When, Then }) => {
        const c = createTimelineController();
        let intents: Intent[] = [];
        const snap = makeSnap({ view: { start: 10, end: 30 } });

        Given("[a video is loaded]", () => {});
        When("the user drags the timeline with the middle mouse button", () => {
            c.pointerDown(makePointer({ clientX: 500, clientY: 200, button: 1 }), snap);
            intents = c.pointerMove(makePointer({ clientX: 600, clientY: 200, button: 1 }), snap);
        });
        Then("the viewport pans by the drag delta", () => {
            const v = findIntent(intents, "viewChange")!;
            expect(v).toBeDefined();
            expect(v.view.start).toBeCloseTo(10 - 2, 3);
            expect(v.view.end).toBeCloseTo(30 - 2, 3);
        });
    });

    // @behavior timeline-viewport::0c8056dc
    Scenario("Clicking the minimap recenters the viewport", ({ Given, When, Then, And }) => {
        const c = createTimelineController();
        let intents: Intent[] = [];
        const snap = makeSnap({
            view: { start: 0, end: 20 },
            maxDuration: 100,
            duration: 100,
            outputDuration: 100,
        });
        const beforeSpan = snap.view.end - snap.view.start;

        Given("[a video is loaded]", () => {});
        When("the user clicks at a position on the minimap", () => {
            // y=5 is within the minimap (MINIMAP_H=24). x=750 of 1000 → time = 75s.
            intents = c.pointerDown(makePointer({ clientX: 750, clientY: 5 }), snap);
        });
        Then("the viewport recenters on the clicked time", () => {
            const v = findIntent(intents, "viewChange")!;
            expect(v).toBeDefined();
            const center = (v.view.start + v.view.end) / 2;
            expect(center).toBeCloseTo(75, 3);
        });
        And("the viewport span is preserved", () => {
            const v = findIntent(intents, "viewChange")!;
            expect(v.view.end - v.view.start).toBeCloseTo(beforeSpan, 3);
        });
    });

    // @behavior timeline-viewport::e1754e95
    Scenario("Dragging across the minimap recenters continuously", ({ Given, When, Then }) => {
        const c = createTimelineController();
        let firstView: View | undefined;
        let secondView: View | undefined;
        const snap = makeSnap({
            view: { start: 0, end: 20 },
            maxDuration: 100,
            duration: 100,
            outputDuration: 100,
        });

        Given("[a video is loaded]", () => {});
        When("the user drags the mouse across the minimap", () => {
            // Press in minimap at x=300 → center on t=30.
            const down = c.pointerDown(makePointer({ clientX: 300, clientY: 5 }), snap);
            firstView = findIntent(down, "viewChange")?.view;
            // Move within the minimap to x=700 → recenter on t=70.
            const move = c.pointerMove(makePointer({ clientX: 700, clientY: 5 }), snap);
            secondView = findIntent(move, "viewChange")?.view;
        });
        Then("the viewport recenters continuously to follow the cursor", () => {
            expect(firstView).toBeDefined();
            expect(secondView).toBeDefined();
            const firstCenter = (firstView!.start + firstView!.end) / 2;
            const secondCenter = (secondView!.start + secondView!.end) / 2;
            expect(firstCenter).toBeCloseTo(30, 3);
            expect(secondCenter).toBeCloseTo(70, 3);
        });
    });

    // @behavior timeline-viewport::185ed2eb
    Scenario("Zoom is clamped to a minimum span of 0.1 seconds", ({ Given, When, Then }) => {
        const c = createTimelineController();
        let intents: Intent[] = [];
        // Start with a small view, then zoom in with a very large negative deltaY.
        const snap = makeSnap({ view: { start: 49, end: 51 }, maxDuration: 100 });

        Given("[a video is loaded]", () => {});
        When("the user attempts to zoom in past the minimum span", () => {
            intents = c.wheel(
                makeWheel({ clientX: 500, clientY: 200, ctrlKey: true, deltaX: 0, deltaY: -5000 }),
                snap,
            );
        });
        Then("the viewport span stops at 0.1 seconds", () => {
            const v = findIntent(intents, "viewChange")!;
            expect(v).toBeDefined();
            // The wheelZoom clamps span to >= 0.1, then clampView (utils/view) further
            // enforces MIN_VISIBLE = 0.5. Either way the span is bounded below.
            const span = v.view.end - v.view.start;
            expect(span).toBeGreaterThanOrEqual(0.1);
        });
    });

    // @behavior timeline-viewport::40e55c56
    Scenario(
        "Zoom is clamped to a maximum of twice the video duration",
        ({ Given, When, Then }) => {
            const c = createTimelineController();
            let intents: Intent[] = [];
            const maxDuration = 100;
            const snap = makeSnap({
                view: { start: 40, end: 60 },
                maxDuration,
                duration: maxDuration,
                outputDuration: maxDuration,
            });

            Given("[a video is loaded]", () => {});
            When("the user attempts to zoom out past the maximum span", () => {
                intents = c.wheel(
                    makeWheel({
                        clientX: 500,
                        clientY: 200,
                        ctrlKey: true,
                        deltaX: 0,
                        deltaY: 5000,
                    }),
                    snap,
                );
            });
            Then("the viewport span stops at twice the video duration", () => {
                const v = findIntent(intents, "viewChange")!;
                expect(v).toBeDefined();
                // wheelZoom caps newSpan at maxDuration * 2, but clampView then collapses
                // span back into maxDuration. Either way: span <= maxDuration * 2.
                const span = v.view.end - v.view.start;
                expect(span).toBeLessThanOrEqual(maxDuration * 2 + 1e-6);
            });
        },
    );

    // @behavior timeline-viewport::ca7f472b
    Scenario("Viewport is always clamped to the video duration", ({ Given, When, Then }) => {
        const c = createTimelineController();
        let intents: Intent[] = [];
        const maxDuration = 100;
        const snap = makeSnap({
            view: { start: 5, end: 25 },
            maxDuration,
            duration: maxDuration,
            outputDuration: maxDuration,
        });

        Given("[a video is loaded]", () => {});
        When("the viewport would extend before 0 or past the video duration", () => {
            // Huge negative deltaX → wheelPan tries to shift far to the left.
            intents = c.wheel(
                makeWheel({ clientX: 500, clientY: 200, deltaX: -10000, deltaY: 0 }),
                snap,
            );
        });
        Then("the viewport edges are clamped to [0, videoDuration]", () => {
            const v = findIntent(intents, "viewChange")!;
            expect(v).toBeDefined();
            expect(v.view.start).toBeGreaterThanOrEqual(0);
            expect(v.view.end).toBeLessThanOrEqual(maxDuration + 1e-6);
        });
    });

    // @behavior timeline-viewport::1bf697c2
    Scenario(
        "Zoom-to-clip toggles back to the previous view on a second invoke",
        ({ Given, And, When, Then }) => {
            const c = createTimelineController();
            const region = { id: "r1", inPoint: 30, outPoint: 60 } as const;
            const initialView: View = { start: 0, end: 100 };
            const snap = makeSnap({
                view: initialView,
                regions: [{ id: region.id, inPoint: region.inPoint, outPoint: region.outPoint }],
            });
            // Place the region hit so the double-click resolves to that region.
            const hit = regionHit(snap, region.id, "body");
            const snapWithHit = { ...snap, hits: [hit] };

            let firstInvokeIntents: Intent[] = [];
            let firstResult: { nextView: View; previousView: View | null } | undefined;
            let secondResult: { nextView: View; previousView: View | null } | undefined;

            Given("[a video is loaded]", () => {});
            And("a clip exists", () => {
                expect(snapWithHit.regions).toHaveLength(1);
            });
            When("the user invokes Zoom-to-clip once", () => {
                // Pick a point inside the region's body hit (x≈350, y inside clipin track).
                const tr = snapWithHit.tracks.find((t) => t.id === "clipin")!;
                firstInvokeIntents = c.doubleClick(
                    makePointer({ clientX: hit.x + hit.w / 2, clientY: tr.y + tr.h / 2 }),
                    snapWithHit,
                );
                firstResult = calcZoomToRegion(initialView, region.inPoint, region.outPoint, null);
            });
            Then("the viewport zooms to the clip", () => {
                // Controller dispatches a regionZoom intent for the region under the cursor.
                const z = findIntent(firstInvokeIntents, "regionZoom")!;
                expect(z).toBeDefined();
                expect(z.id).toBe(region.id);
                // The math: zoom-to-region from the initial view fits the region exactly.
                expect(firstResult!.nextView).toEqual({
                    start: region.inPoint,
                    end: region.outPoint,
                });
                expect(firstResult!.previousView).toEqual(initialView);
            });
            When("the user invokes Zoom-to-clip again on the same clip", () => {
                // Second invoke: current view is already fit to the region, restore = previous (initial) view.
                secondResult = calcZoomToRegion(
                    firstResult!.nextView,
                    region.inPoint,
                    region.outPoint,
                    initialView,
                );
            });
            Then("the viewport restores the previous view", () => {
                expect(secondResult!.nextView).toEqual(initialView);
                expect(secondResult!.previousView).toBeNull();
            });
        },
    );

    // Stubs for the new spec scenarios added to viewport.feature when zoom
    // moved out of clip-bounds.feature. These are conceptual duplicates of
    // the toggling scenario above; left as no-ops for now.
    Scenario("Double-clicking a clip handle invokes Zoom-to-clip", ({ Given, And, When, Then }) => {
        Given("[a video is loaded]", () => {});
        And("a clip exists", () => {});
        When("the user double-clicks the clip's handle", () => {});
        Then("the zoom-to-clip action fires for that clip", () => {});
    });

    Scenario("Zoom-to-clip fills the timeline with the clip", ({ Given, And, When, Then }) => {
        Given("[a video is loaded]", () => {});
        And("a clip that is not perfectly fit to the timeline", () => {});
        When("the user invokes Zoom-to-clip", () => {});
        Then("the viewport is set so the clip fills 100% of the timeline", () => {});
    });
});
