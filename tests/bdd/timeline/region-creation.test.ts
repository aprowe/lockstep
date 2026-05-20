import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import {
    calcNewRegionSpan,
    calcNewRegionBounds,
    calcNewRegionBoundsFromScenes,
} from "../../../src/timeline/model/newRegionBounds";
import type { View } from "../../../src/types";
import { addRegion, setActiveRegionId } from "../../../src/store/slices/regionSlice";
import { makeStore } from "../../helpers/setup";

const feature = await loadFeature("./spec/features/timeline/region-creation.feature");

const makeRegion = (id: string, inPoint: number, outPoint: number) => ({
    id,
    name: id,
    inPoint,
    outPoint,
    inBeatTime: inPoint,
    outBeatTime: outPoint,
    defaultLinked: true,
    bpm: 120,
    minStretch: 0.5,
    maxStretch: 2,
});

describeFeature(feature, ({ ScenarioOutline, Scenario }) => {
    // @behavior region-creation::30fd066b
    ScenarioOutline(
        "New region size is the larger of 10% of view or 5 seconds",
        ({ Given, When, Then }, variables) => {
            let span = 0;
            Given("the current viewport span is <viewSpan> seconds", () => {
                // variables.viewSpan drives the computation
            });
            When("a new region is created", () => {
                span = calcNewRegionSpan(Number(variables.viewSpan));
            });
            Then("the region span is <expectedSpan> seconds", () => {
                expect(span).toBeCloseTo(Number(variables.expectedSpan));
            });
        },
    );

    // @behavior region-creation::089f7025
    Scenario(
        "New region from the timeline is is aligned on the cursor position",
        ({ Given, And, When, Then }) => {
            let bounds: { inPoint: number; outPoint: number } = { inPoint: 0, outPoint: 0 };
            Given("the current viewport span is 40 seconds", () => {});
            And("the video duration is 120 seconds", () => {});
            When("a new region is created at cursor position 60 seconds", () => {
                bounds = calcNewRegionBounds(60, 40, 120);
            });
            Then("the region spans from 60 to 65 seconds", () => {
                expect(bounds.inPoint).toBeCloseTo(60);
                expect(bounds.outPoint).toBeCloseTo(65);
            });
        },
    );

    // @behavior region-creation::622d79ba
    Scenario(
        "New region from the region list is aligned on the playhead",
        ({ Given, And, When, Then }) => {
            let bounds: { inPoint: number; outPoint: number } = { inPoint: 0, outPoint: 0 };
            Given("the current viewport span is 40 seconds", () => {});
            And("the video duration is 120 seconds", () => {});
            When("a new region is created at playhead position 60 seconds", () => {
                bounds = calcNewRegionBounds(60, 40, 120);
            });
            Then("the region spans from 60 to 65 seconds", () => {
                expect(bounds.inPoint).toBeCloseTo(60);
                expect(bounds.outPoint).toBeCloseTo(65);
            });
        },
    );

    // @behavior region-creation::beaf3038
    Scenario("Region is clamped to the start of the video", ({ Given, And, When, Then }) => {
        let inPoint = 0;
        Given("the current viewport span is 40 seconds", () => {});
        And("the video duration is 120 seconds", () => {});
        When("a new region is created at cursor position -0.5 seconds", () => {
            inPoint = calcNewRegionBounds(-0.5, 40, 120).inPoint;
        });
        Then("the region in-point is 0", () => {
            expect(inPoint).toBe(0);
        });
    });

    // @behavior region-creation::220bf2e0
    Scenario("Region is clamped to the end of the video", ({ Given, And, When, Then }) => {
        let outPoint = 0;
        Given("the current viewport span is 40 seconds", () => {});
        And("the video duration is 120 seconds", () => {});
        When("a new region is created at cursor position 119.5 seconds", () => {
            outPoint = calcNewRegionBounds(119.5, 40, 120).outPoint;
        });
        Then("the region out-point is 120", () => {
            expect(outPoint).toBe(120);
        });
    });

    // ── Scene- and region-aware bounds ─────────────────────────────────────

    // @behavior region-creation::60eb8748
    Scenario(
        "No scene markers at all — falls back to 5s / 10% rule",
        ({ Given, And, When, Then }) => {
            const view: View = { start: 50, end: 90 };
            let bounds = { inPoint: 0, outPoint: 0 };
            Given("the viewport is from 50 to 90 seconds", () => {});
            And("the video duration is 120 seconds", () => {});
            And("there are no scene markers", () => {});
            And("there are no other regions", () => {});
            When("a new region is created at cursor position 60 seconds", () => {
                bounds = calcNewRegionBoundsFromScenes(60, view, [], 120, []);
            });
            Then("the region spans from 60 to 65 seconds", () => {
                expect(bounds).toEqual({ inPoint: 60, outPoint: 65 });
            });
        },
    );

    // @behavior region-creation::728bc8d1
    Scenario(
        "Snaps between surrounding scene markers when both are in view",
        ({ Given, And, When, Then }) => {
            const view: View = { start: 50, end: 90 };
            let bounds = { inPoint: 0, outPoint: 0 };
            Given("the viewport is from 50 to 90 seconds", () => {});
            And("the video duration is 120 seconds", () => {});
            And("there is a scene marker at 55 seconds", () => {});
            And("there is a scene marker at 70 seconds", () => {});
            And("there are no other regions", () => {});
            When("a new region is created at cursor position 60 seconds", () => {
                bounds = calcNewRegionBoundsFromScenes(60, view, [55, 70], 120, []);
            });
            Then("the region spans from 55 to 70 seconds", () => {
                expect(bounds).toEqual({ inPoint: 55, outPoint: 70 });
            });
        },
    );

    // @behavior region-creation::3f2b3bed
    Scenario(
        "No next scene marker in view — out-point stops at the viewport end",
        ({ Given, And, When, Then }) => {
            const view: View = { start: 50, end: 90 };
            let bounds = { inPoint: 0, outPoint: 0 };
            Given("the viewport is from 50 to 90 seconds", () => {});
            And("the video duration is 120 seconds", () => {});
            And("there is a scene marker at 55 seconds", () => {});
            And("there are no other regions", () => {});
            When("a new region is created at cursor position 60 seconds", () => {
                bounds = calcNewRegionBoundsFromScenes(60, view, [55], 120, []);
            });
            Then("the region spans from 55 to 90 seconds", () => {
                expect(bounds).toEqual({ inPoint: 55, outPoint: 90 });
            });
        },
    );

    // @behavior region-creation::a5661c96
    Scenario(
        "No previous scene marker in view — in-point starts at the viewport start",
        ({ Given, And, When, Then }) => {
            const view: View = { start: 50, end: 90 };
            let bounds = { inPoint: 0, outPoint: 0 };
            Given("the viewport is from 50 to 90 seconds", () => {});
            And("the video duration is 120 seconds", () => {});
            And("there is a scene marker at 80 seconds", () => {});
            And("there are no other regions", () => {});
            When("a new region is created at cursor position 60 seconds", () => {
                bounds = calcNewRegionBoundsFromScenes(60, view, [80], 120, []);
            });
            Then("the region spans from 50 to 80 seconds", () => {
                expect(bounds).toEqual({ inPoint: 50, outPoint: 80 });
            });
        },
    );

    // @behavior region-creation::fe66bfde
    Scenario(
        "No scene markers in view — region fills the viewport around the cursor",
        ({ Given, And, When, Then }) => {
            const view: View = { start: 50, end: 90 };
            let bounds = { inPoint: 0, outPoint: 0 };
            Given("the viewport is from 50 to 90 seconds", () => {});
            And("the video duration is 120 seconds", () => {});
            And("there is a scene marker at 10 seconds", () => {});
            And("there is a scene marker at 110 seconds", () => {});
            And("there are no other regions", () => {});
            When("a new region is created at cursor position 60 seconds", () => {
                bounds = calcNewRegionBoundsFromScenes(60, view, [10, 110], 120, []);
            });
            Then("the region spans from 50 to 90 seconds", () => {
                expect(bounds).toEqual({ inPoint: 50, outPoint: 90 });
            });
        },
    );

    // @behavior region-creation::dfeb811f
    Scenario(
        "Previous region out-point takes precedence over an earlier scene marker",
        ({ Given, And, When, Then }) => {
            const view: View = { start: 50, end: 100 };
            let bounds = { inPoint: 0, outPoint: 0 };
            Given("the viewport is from 50 to 100 seconds", () => {});
            And("the video duration is 120 seconds", () => {});
            And("there is a scene marker at 55 seconds", () => {});
            And("there is a region from 60 to 70 seconds", () => {});
            When("a new region is created at cursor position 80 seconds", () => {
                bounds = calcNewRegionBoundsFromScenes(80, view, [55], 120, [
                    { inPoint: 60, outPoint: 70 },
                ]);
            });
            Then("the region spans from 70 to 100 seconds", () => {
                expect(bounds).toEqual({ inPoint: 70, outPoint: 100 });
            });
        },
    );

    // @behavior region-creation::373255c3
    Scenario(
        "Next region in-point takes precedence over a later scene marker",
        ({ Given, And, When, Then }) => {
            const view: View = { start: 50, end: 100 };
            let bounds = { inPoint: 0, outPoint: 0 };
            Given("the viewport is from 50 to 100 seconds", () => {});
            And("the video duration is 120 seconds", () => {});
            And("there is a scene marker at 95 seconds", () => {});
            And("there is a region from 80 to 90 seconds", () => {});
            When("a new region is created at cursor position 60 seconds", () => {
                bounds = calcNewRegionBoundsFromScenes(60, view, [95], 120, [
                    { inPoint: 80, outPoint: 90 },
                ]);
            });
            Then("the region spans from 50 to 80 seconds", () => {
                expect(bounds).toEqual({ inPoint: 50, outPoint: 80 });
            });
        },
    );

    // @behavior region-creation::5d8f7863
    Scenario(
        "Cursor inside an existing region — behaves as if the playhead is just past the region's out",
        ({ Given, And, When, Then }) => {
            const view: View = { start: 50, end: 100 };
            let bounds = { inPoint: 0, outPoint: 0 };
            Given("the viewport is from 50 to 100 seconds", () => {});
            And("the video duration is 120 seconds", () => {});
            And("there is a region from 60 to 70 seconds", () => {});
            And("there is a scene marker at 80 seconds", () => {});
            When("a new region is created at cursor position 65 seconds", () => {
                bounds = calcNewRegionBoundsFromScenes(65, view, [80], 120, [
                    { inPoint: 60, outPoint: 70 },
                ]);
            });
            Then("the region spans from 70 to 80 seconds", () => {
                expect(bounds).toEqual({ inPoint: 70, outPoint: 80 });
            });
        },
    );

    // @behavior region-creation::95af3b45
    Scenario("Region is selected when created", ({ Given, When, Then, And }) => {
        const store = makeStore();
        const viewBefore = store.getState().ui.view;

        Given("Region A is selected", () => {
            store.dispatch(addRegion(makeRegion("a", 0, 10)));
            store.dispatch(setActiveRegionId("a"));
        });
        When("Region B is created", () => {
            store.dispatch(addRegion(makeRegion("b", 10, 20)));
        });
        Then("Region B is selected", () => {
            expect(store.getState().region.activeRegionId).toBe("b");
        });
        And("the viewport has not changed", () => {
            expect(store.getState().ui.view).toEqual(viewBefore);
        });
    });
});
