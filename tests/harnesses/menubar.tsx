/**
 * Render harness for the MenuBar with the real menu builders from src/menus.ts.
 * Provides stub deps so menu items render (the submenu content that tests query
 * is only visible when a menu is opened — see openMenu()).
 */

import { render, fireEvent, type RenderResult } from "@testing-library/react";
import MenuBar from "../../src/components/MenuBar";
import { buildFileMenu, buildEditMenu, buildViewMenu } from "../../src/menus";
import { makeVideoInfo } from "../helpers/setup";

/** Default deps produce enabled menu items (video loaded, some anchors). */
function defaultDeps() {
    const noop = () => {};
    return {
        video: makeVideoInfo(),
        anchorCount: 5,
        openFile: noop,
        openFolder: noop,
        openJsonFile: noop,
        resetVideoData: noop,
        closeVideo: noop,
        importMarkers: noop,
        exportMarkers: noop,
        undo: noop,
        redo: noop,
        selectAll: noop,
        deselect: noop,
        openSettings: noop,
        increaseUiScale: noop,
        decreaseUiScale: noop,
        resetUiScale: noop,
        resetPanelLayout: noop,
        togglePanel: (_id: string) => {},
        panels: [],
        visiblePanelIds: new Set<string>(),
        showShortcuts: noop,
        saveProjectAs: noop,
        recentFiles: [],
        openRecentFile: (_path: string) => {},
        clearRecentFiles: noop,
    };
}

export function renderMenuBar(): RenderResult {
    const deps = defaultDeps();
    const menus = [buildFileMenu(deps), buildEditMenu(deps), buildViewMenu(deps)];
    return render(<MenuBar menus={menus} />);
}

/** Click the menu trigger with the given label to open its dropdown. */
export function openMenu(result: RenderResult, label: string) {
    const trigger = [...result.container.querySelectorAll(".menubar__trigger")].find(
        (el) => el.textContent?.trim() === label,
    ) as HTMLButtonElement | undefined;
    if (!trigger) throw new Error(`MenuBar trigger "${label}" not found`);
    fireEvent.click(trigger);
}
