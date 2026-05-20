/**
 * Render harness for the Toolbar component.
 * Wires up a Redux store and default props so tests can query the rendered DOM.
 */

import { render, type RenderResult } from "@testing-library/react";
import { Provider } from "react-redux";
import { createRef } from "react";
import Toolbar from "../../src/components/Toolbar";
import type { VideoPlayerHandle } from "../../src/components/VideoPlayer";
import { makeStore } from "../helpers/setup";

export interface RenderToolbarOptions {
    /** Override any Toolbar prop. By default all optional handlers are provided
     *  as no-ops so every button renders. */
    [key: string]: unknown;
}

export function renderToolbar(overrides: RenderToolbarOptions = {}): RenderResult {
    const store = makeStore();
    const playerRef = createRef<VideoPlayerHandle>();

    const defaults = {
        playerRef,
        duration: 60,
        fps: 30,
        playing: false,
        currentTime: 0,
        // Provide all optional handlers so every button is rendered and enabled
        onMark: () => {},
        onJumpPrev: () => {},
        onJumpNext: () => {},
        onZoomToRegion: () => {},
        onSetIn: () => {},
        onSetOut: () => {},
        onGridDivChange: () => {},
        onNewRegion: () => {},
        onJumpRegionStart: () => {},
        onJumpRegionEnd: () => {},
        playbackLoopMode: "continue" as const,
        onPlaybackLoopModeChange: () => {},
    };

    return render(
        <Provider store={store}>
            <Toolbar {...defaults} {...overrides} />
        </Provider>,
    );
}
