/**
 * Render harness for the new ClipsPanel (replaces the legacy
 * RegionSidebar harness). Wires the bare minimum store + DockBridge so
 * the panel renders inside a fixture exactly as the live app would.
 */

import { render, type RenderResult } from "@testing-library/react/pure";
import { Provider } from "react-redux";
import { vi } from "vitest";
import type { RefObject } from "react";
import ClipsPanel from "../../src/layout/panels/ClipsPanel";
import { ThumbnailHoverProvider } from "../../src/components/ThumbnailPopup";
import { DockBridgeProvider, type DockBridge } from "../../src/layout/DockContext";
import { setVideo } from "../../src/store/slices/videoSlice";
import { setRegions, setActiveRegionId } from "../../src/store/slices/regionSlice";
import {
    setListSelection,
    setListFilterMode,
    setPendingEdit,
    type ListFilterMode,
} from "../../src/store/slices/listsSlice";
import { setSelectedOrigIds as setSelectedOrigAnchorIds } from "../../src/store/slices/warpSlice";
import { setView } from "../../src/store/slices/uiSlice";
import type { Region, View } from "../../src/types";
import type { VideoPlayerHandle } from "../../src/components/VideoPlayer";
import { makeStore, makeVideoInfo } from "../helpers/setup";

const makeRegion = (id: string, name: string, inP: number, outP: number): Region => ({
    id,
    name,
    inPoint: inP,
    outPoint: outP,
    inBeatTime: inP,
    outBeatTime: outP,
    defaultLinked: true,
    bpm: 120,
    minStretch: 0.5,
    maxStretch: 2.0,
    colorIndex: 0,
});

export interface RenderClipsPanelOptions {
    regions?: Region[];
    activeRegionId?: string | null;
    pendingRenameId?: string | null;
    /** Pre-seed lists.selection.clips before render so the rendered tree
     *  picks the value up on first commit (dispatching after render leaves
     *  the closures inside handlers stale until React re-renders). */
    selectedClipIds?: string[];
    /** Pre-seed warp.selectedIds (markers selection) before render. */
    selectedMarkerIds?: number[];
    /** Pre-seed the timeline view (used by the viewport filter). */
    view?: View;
    /** Pre-seed the clips list filter mode. */
    filterMode?: ListFilterMode;
}

export function renderClipsPanel(opts: RenderClipsPanelOptions = {}) {
    const store = makeStore();
    store.dispatch(setVideo(makeVideoInfo({ duration: 120 })));
    store.dispatch(setRegions(opts.regions ?? [makeRegion("r1", "Verse", 30, 45)]));
    if (opts.activeRegionId !== undefined) {
        store.dispatch(setActiveRegionId(opts.activeRegionId));
    }
    if (opts.pendingRenameId) {
        store.dispatch(setPendingEdit({ list: "clips", id: opts.pendingRenameId }));
    }
    if (opts.selectedClipIds) {
        store.dispatch(setListSelection({ list: "clips", ids: opts.selectedClipIds }));
    }
    if (opts.selectedMarkerIds) {
        store.dispatch(setSelectedOrigAnchorIds(opts.selectedMarkerIds));
    }
    if (opts.view) {
        store.dispatch(setView(opts.view));
    }
    if (opts.filterMode) {
        store.dispatch(setListFilterMode({ list: "clips", mode: opts.filterMode }));
    }

    const seek = vi.fn();
    const setExportOpen = vi.fn();
    const setClipContextMenu = vi.fn();
    const playerRef: RefObject<VideoPlayerHandle | null> = { current: null };
    const bridge: DockBridge = { seek, setExportOpen, playerRef, setClipContextMenu };

    const result = render(
        <Provider store={store}>
            <ThumbnailHoverProvider>
                <DockBridgeProvider value={bridge}>
                    <ClipsPanel />
                </DockBridgeProvider>
            </ThumbnailHoverProvider>
        </Provider>,
    );

    return { ...(result as RenderResult), store, seek, setExportOpen, setClipContextMenu };
}

export { makeRegion };
