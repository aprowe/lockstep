/**
 * Issue #22 — playback loop mode is a UI-level setting that lives in
 * `uiSlice`. Tests cover the reducer surface and the default; the actual
 * playhead-intercept behavior in CenterColumn is exercised in BDD tests
 * via the dock harness.
 */

import { describe, expect, it } from "vitest";
import uiReducer, { type PlaybackLoopMode } from "../../src/store/slices/uiSlice";

describe("uiSlice playback loop mode", () => {
    it("defaults to continue (preserves prior behavior)", () => {
        const state = uiReducer(undefined, { type: "@@INIT" });
        expect(state.playbackLoopMode).toBe("continue" satisfies PlaybackLoopMode);
    });
});
