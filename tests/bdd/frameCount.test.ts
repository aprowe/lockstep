import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { secondsToFrames, formatFrames } from "../../src/utils/time";

const feature = await loadFeature("./spec/features/frame-count.feature");

describeFeature(feature, ({ Scenario }) => {
    const fps = 30;

    // @behavior frame-count-display::871cc353
    Scenario("Frame count shown next to timecode", ({ Given, When, Then }) => {
        let playheadSec = 0;
        Given("a 30fps video is loaded", () => {
            // fps is closed over
        });
        When("the playhead is at 2.5 seconds", () => {
            playheadSec = 2.5;
        });
        Then('the toolbar displays "75f" next to the timecode', () => {
            expect(secondsToFrames(playheadSec, fps)).toBe(75);
            expect(formatFrames(playheadSec, fps)).toBe("75f");
        });
    });

    // @behavior frame-count-display::3a49f366
    Scenario("Step forward increments the frame count", ({ Given, And, When, Then }) => {
        let playheadSec = 0;
        Given("a 30fps video is loaded", () => {});
        And("the playhead is at frame 75", () => {
            playheadSec = 75 / fps;
        });
        When("the user presses step-forward", () => {
            playheadSec += 1 / fps;
        });
        Then('the toolbar displays "76f"', () => {
            expect(secondsToFrames(playheadSec, fps)).toBe(76);
            expect(formatFrames(playheadSec, fps)).toBe("76f");
        });
    });

    // @behavior frame-count-display::607ab793
    Scenario("Step backward decrements the frame count", ({ Given, And, When, Then }) => {
        let playheadSec = 0;
        Given("a 30fps video is loaded", () => {});
        And("the playhead is at frame 75", () => {
            playheadSec = 75 / fps;
        });
        When("the user presses step-back", () => {
            playheadSec -= 1 / fps;
        });
        Then('the toolbar displays "74f"', () => {
            expect(secondsToFrames(playheadSec, fps)).toBe(74);
            expect(formatFrames(playheadSec, fps)).toBe("74f");
        });
    });

    // @behavior frame-count-display::fc7df5e5
    Scenario("Frame count rounds to nearest integer", ({ Given, When, Then }) => {
        let playheadSec = 0;
        Given("a 30fps video is loaded", () => {});
        When("the playhead is at 2.533 seconds", () => {
            playheadSec = 2.533;
        });
        Then('the toolbar displays "76f"', () => {
            // 2.533 * 30 = 75.99 → rounds to 76
            expect(secondsToFrames(playheadSec, fps)).toBe(76);
            expect(formatFrames(playheadSec, fps)).toBe("76f");
        });
    });

    // @behavior frame-count-display::bfa96c35
    Scenario("Frame count at time zero", ({ Given, When, Then }) => {
        let playheadSec = 0;
        Given("a 30fps video is loaded", () => {});
        When("the playhead is at 0 seconds", () => {
            playheadSec = 0;
        });
        Then('the toolbar displays "0f"', () => {
            expect(secondsToFrames(playheadSec, fps)).toBe(0);
            expect(formatFrames(playheadSec, fps)).toBe("0f");
            // Divide-by-zero guard: invalid fps still renders 0f.
            expect(secondsToFrames(5, 0)).toBe(0);
            expect(formatFrames(5, 0)).toBe("0f");
        });
    });

    // @behavior frame-count-display::2ae2aa1e
    Scenario("Frame count can be edited", ({ Given, When, And, Then }) => {
        let targetSeconds = 0;
        Given("a 30fps video is loaded", () => {});
        When("the user clicks the frame count display", () => {});
        And('enters "100"', () => {
            targetSeconds = 100 / fps;
        });
        Then("the playhead moves to frame 100", () => {
            expect(targetSeconds).toBeCloseTo(3.3333, 3);
            expect(secondsToFrames(targetSeconds, fps)).toBe(100);
        });
        And('the toolbar displays "100f"', () => {
            expect(formatFrames(targetSeconds, fps)).toBe("100f");
        });
    });
});
