/**
 * Menu definitions for the main menu bar.
 *
 * Each builder takes the dependencies it needs (handlers, current state) and
 * returns a `MenuDef`. Lives outside the React tree so tests can import them
 * with stub deps.
 *
 * Layout specs: `layouts/menubar.layout.yaml`.
 */

import type { MenuDef, MenuEntry } from "./components/MenuBar";
import type { VideoInfo } from "./types";

/** Shorten a path by replacing the middle with a single ellipsis so both
 *  ends stay visible — keeps the volume/root and the immediate parent dir
 *  legible when the absolute path is too long for the submenu width. */
function truncateMiddle(s: string, max: number): string {
    if (s.length <= max) return s;
    const keep = Math.max(0, max - 1); // 1 char for the ellipsis
    const head = Math.ceil(keep / 2);
    const tail = Math.floor(keep / 2);
    return `${s.slice(0, head)}…${s.slice(s.length - tail)}`;
}

interface FileMenuDeps {
    video: VideoInfo | null;
    anchorCount: number;
    openFile: () => void;
    openFolder: () => void;
    openJsonFile: () => void;
    resetVideoData: () => void;
    closeVideo: () => void;
    saveProjectAs: () => void;
    recentFiles: string[];
    openRecentFile: (path: string) => void;
    clearRecentFiles: () => void;
}

/**
 * Build the "File" top-level menu. Items disable themselves based on whether
 * a video is loaded and whether any anchors exist.
 */
export function buildFileMenu(d: FileMenuDeps): MenuDef {
    const recentItems: MenuEntry[] =
        d.recentFiles.length > 0
            ? [
                  ...d.recentFiles.map((path) => {
                      const norm = path.replace(/\\/g, "/");
                      const slash = norm.lastIndexOf("/");
                      const basename = slash >= 0 ? norm.slice(slash + 1) : norm;
                      const parent = slash >= 0 ? norm.slice(0, slash) : "";
                      return {
                          label: basename,
                          secondary: parent ? truncateMiddle(parent, 56) : undefined,
                          action: () => d.openRecentFile(path),
                      };
                  }),
                  { separator: true as const },
                  { label: "Clear Recent Files", action: d.clearRecentFiles },
              ]
            : [{ label: "No Recent Files", disabled: true }];

    return {
        label: "File",
        items: [
            { label: "Open Video", shortcut: "Ctrl+O", action: d.openFile },
            { label: "Open Folder", shortcut: "Ctrl+Shift+O", action: d.openFolder },
            { label: "Open Recent", submenu: recentItems },
            { separator: true },
            { label: "Open Project", action: d.openJsonFile },
            {
                label: "Save Project As",
                shortcut: "Ctrl+E",
                action: d.saveProjectAs,
                disabled: !d.video || d.anchorCount === 0,
            },
            { separator: true },
            { label: "Reset Project", action: d.resetVideoData, disabled: !d.video },
            { separator: true },
            { label: "Close Video", action: d.closeVideo, disabled: !d.video },
        ],
    };
}

interface EditMenuDeps {
    video: VideoInfo | null;
    anchorCount: number;
    undo: () => void;
    redo: () => void;
    selectAll: () => void;
    deselect: () => void;
    openSettings: () => void;
}

/**
 * Build the "Edit" top-level menu (undo/redo, select-all, settings).
 */
export function buildEditMenu(d: EditMenuDeps): MenuDef {
    return {
        label: "Edit",
        items: [
            { label: "Undo", shortcut: "Ctrl+Z", action: d.undo, disabled: !d.video },
            { label: "Redo", shortcut: "Ctrl+Shift+Z", action: d.redo, disabled: !d.video },
            { separator: true },
            {
                label: "Select All",
                shortcut: "Ctrl+A",
                action: d.selectAll,
                disabled: !d.video || d.anchorCount === 0,
            },
            { label: "Deselect", shortcut: "Escape", action: d.deselect, disabled: !d.video },
            { separator: true },
            { label: "Settings…", action: d.openSettings },
        ],
    };
}

interface ViewMenuDeps {
    increaseUiScale: () => void;
    decreaseUiScale: () => void;
    resetUiScale: () => void;
    resetPanelLayout: () => void;
    /** Toggle a dock panel's visibility. Hidden panels can be brought back via
     *  the same toggle — useful since panels close via the tab × button. */
    togglePanel: (id: string) => void;
    /** All side-panel definitions in the order they should appear in the menu. */
    panels: Array<{ id: string; title: string }>;
    /** Set of currently-visible panel ids (for the ✓ check state). */
    visiblePanelIds: ReadonlySet<string>;
    showShortcuts: () => void;
    timelineMode: "warp" | "condensed";
    toggleTimelineMode: () => void;
}

/**
 * Build the "View" top-level menu — UI scale controls, the keyboard-shortcut
 * sheet, and one checked-toggle entry per dock panel.
 */
export function buildViewMenu(d: ViewMenuDeps): MenuDef {
    return {
        label: "View",
        items: [
            { label: "Increase UI Scale", shortcut: "Ctrl+=", action: d.increaseUiScale },
            { label: "Decrease UI Scale", shortcut: "Ctrl+-", action: d.decreaseUiScale },
            { label: "Reset UI Scale", shortcut: "Ctrl+0", action: d.resetUiScale },
            { separator: true },
            {
                label: "Condensed Timeline",
                shortcut: "Shift+T",
                action: d.toggleTimelineMode,
                checked: d.timelineMode === "condensed",
            },
            { separator: true },
            { label: "Keyboard Shortcuts…", shortcut: "?", action: d.showShortcuts },
            { separator: true },
            { label: "Reset Panel Layout", action: d.resetPanelLayout },
            { separator: true },
            // One toggle per dock panel — checked when visible, unchecked when
            // closed (brings the panel back into the active group on click).
            ...d.panels.map((p) => ({
                label: p.title,
                action: () => d.togglePanel(p.id),
                checked: d.visiblePanelIds.has(p.id),
            })),
        ],
    };
}
