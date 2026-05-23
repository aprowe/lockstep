import { useCallback, useEffect, useImperativeHandle, useRef, forwardRef, useState } from "react";
import {
    DockviewReact,
    type DockviewApi,
    type DockviewReadyEvent,
    type DockviewTheme,
    type IDockviewPanelProps,
    type SerializedDockview,
} from "dockview";
import "dockview/dist/styles/dockview.css";
import "./PanelDock.css";
import PanelMoveOverlay from "./PanelMoveOverlay";

/** Custom theme object — dockview's `theme` option drives which className it
 *  pins on its root element. Without this it falls back to themeAbyss and
 *  appends "dockview-theme-abyss", which then overrides our --dv-* vars. */
const lockstepTheme: DockviewTheme = {
    name: "lockstep",
    className: "dockview-theme-lockstep",
};

import FileBrowserPanel from "./panels/FileBrowserPanel";
import ClipsPanel from "./panels/ClipsPanel";
import ClipInfoPanel from "./panels/ClipInfoPanel";
import ScenesPanel from "./panels/ScenesPanel";
import MarkersPanel from "./panels/MarkersPanel";
import VideoInfoPanel from "./panels/VideoInfoPanel";
import AssistantPanelDock from "./panels/AssistantPanel";
import CenterColumn from "./CenterColumn";
import DevRecorderPanel from "../components/DevRecorderPanel";

// Show the thumbnail recorder panel in dev OR when VITE_THUMB_RECORDER=1 is
// set at build time (for opt-in instrumented release builds).
const SHOW_THUMB_RECORDER = import.meta.env.DEV || import.meta.env.VITE_THUMB_RECORDER === "1";

// ── Component registry ─────────────────────────────────────────────────────
//
// Keys are the `component` strings round-tripped through serialized layouts.
// The `center` panel is locked + headerless so it can't be dragged or accept
// drops — see lockCenterGroup() below.
const components: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {
    files: () => <FileBrowserPanel />,
    clips: () => <ClipsPanel />,
    "clip-info": () => <ClipInfoPanel />,
    scenes: () => <ScenesPanel />,
    markers: () => <MarkersPanel />,
    "video-info": () => <VideoInfoPanel />,
    assistant: () => <AssistantPanelDock />,
    center: () => <CenterColumn />,
    ...(SHOW_THUMB_RECORDER ? { "thumb-recorder": () => <DevRecorderPanel /> } : {}),
};

const PANEL_TITLES: Record<string, string> = {
    files: "Files",
    clips: "Clips",
    "clip-info": "Clip Info",
    scenes: "Scenes",
    markers: "Anchors",
    "video-info": "Video Info",
    assistant: "Assistant",
    center: "Player",
    ...(SHOW_THUMB_RECORDER ? { "thumb-recorder": "Thumb Recorder" } : {}),
};

const SIDE_PANEL_IDS = [
    "files",
    "clips",
    "clip-info",
    "scenes",
    "markers",
    "video-info",
    "assistant",
] as const;

// Versioned key — bump when the default layout shape changes so previously
// saved layouts are dropped instead of half-deserializing into the new schema.
const STORAGE_KEY = "lockstep:panel-layout:v7";

/**
 * Default 4-slot layout the dock falls back to whenever there's no saved
 * layout (or the saved one fails to deserialize):
 *
 *   ┌──────────────┬─────────────┬──────────────────────┐
 *   │ clips        │             │ scenes/markers/tasks │  (NW · CENTER · NE)
 *   │ (+ files)    │  player +   │  (tabbed)            │
 *   ├──────────────┤  timeline   ├──────────────────────┤
 *   │ (empty)      │             │ clip-info / video-info│  (SW · CENTER · SE)
 *   └──────────────┴─────────────┴──────────────────────┘
 *
 * Built imperatively with addPanel(...) so we can position relative to the
 * locked center group.
 */
function buildDefaultLayout(api: DockviewApi) {
    api.clear();
    // Center first — every other panel positions relative to it.
    api.addPanel({
        id: "center",
        component: "center",
        title: PANEL_TITLES.center,
    });

    // NW — clips, with files as a second tab in the same group.
    api.addPanel({
        id: "clips",
        component: "clips",
        title: PANEL_TITLES.clips,
        position: { referencePanel: "center", direction: "left" },
        initialWidth: 240,
    });
    api.addPanel({
        id: "files",
        component: "files",
        title: PANEL_TITLES.files,
        position: { referencePanel: "clips" },
        inactive: true, // keep clips active on first paint
    });

    // NE — scenes + markers tabbed together.
    api.addPanel({
        id: "scenes",
        component: "scenes",
        title: PANEL_TITLES.scenes,
        position: { referencePanel: "center", direction: "right" },
        initialWidth: 300,
    });
    api.addPanel({
        id: "markers",
        component: "markers",
        title: PANEL_TITLES.markers,
        position: { referencePanel: "scenes" },
        inactive: true,
    });
    api.addPanel({
        id: "assistant",
        component: "assistant",
        title: PANEL_TITLES.assistant,
        position: { referencePanel: "scenes" },
        inactive: true,
    });
    if (SHOW_THUMB_RECORDER) {
        api.addPanel({
            id: "thumb-recorder",
            component: "thumb-recorder",
            title: PANEL_TITLES["thumb-recorder"],
            position: { referencePanel: "scenes" },
            inactive: true,
        });
    }

    // SE — clip-info below the scenes/markers group, with video-info tabbed
    // alongside it (both "metadata about a thing" panels).
    api.addPanel({
        id: "clip-info",
        component: "clip-info",
        title: PANEL_TITLES["clip-info"],
        position: { referencePanel: "scenes", direction: "below" },
        initialHeight: 220,
    });
    api.addPanel({
        id: "video-info",
        component: "video-info",
        title: PANEL_TITLES["video-info"],
        position: { referencePanel: "clip-info" },
        inactive: true,
    });
    // SW is intentionally empty — drag any panel below the clips group to fill it.

    lockCenterGroup(api);
}

/** Lock the center group so it can't be dragged or used as a drop target,
 *  and hide its tab header so the player UI fills the panel cleanly. */
function lockCenterGroup(api: DockviewApi) {
    const center = api.getPanel("center");
    if (!center) return;
    center.group.locked = "no-drop-target";
    center.group.header.hidden = true;
}

/** Imperative handle exposed to App so the View menu can reset the layout
 *  and toggle individual panels open/closed. */
export interface PanelDockHandle {
    /** Wipe the saved layout and rebuild the default 4-slot arrangement. */
    resetLayout: () => void;
    /** Close the panel if open, or add it back into the active group if hidden. */
    togglePanel: (id: string) => void;
    /** Snapshot of currently-open side-panel ids (excluding the locked center). */
    getOpenSidePanelIds: () => string[];
}

interface PanelDockProps {
    className?: string;
    /** Fired whenever a panel is added/removed so callers can re-render the
     *  View menu's "show/hide" check marks against the current set. */
    onPanelsChange?: (openSidePanelIds: string[]) => void;
}

const PanelDock = forwardRef<PanelDockHandle, PanelDockProps>(function PanelDock(
    { className, onPanelsChange },
    ref,
) {
    const apiRef = useRef<DockviewApi | null>(null);

    // Tab mousedown + ≥THRESHOLD movement enters "fake drag" mode: a
    // PanelMoveOverlay mounts and the drop is finalized on mouseup. Pure
    // pointer events — dockview's HTML5 drag is off (`disableDnd`).
    const [movingPanelId, setMovingPanelId] = useState<string | null>(null);
    // Stable identity so the overlay's window listeners don't churn on every
    // PanelDock re-render — listener tear-down/re-attach could otherwise drop
    // a mouseup that lands in the gap.
    const exitMove = useCallback(() => setMovingPanelId(null), []);

    useEffect(
        () => () => {
            apiRef.current = null;
        },
        [],
    );

    const emitPanels = () => {
        const api = apiRef.current;
        if (!api) return;
        const ids = api.panels.map((p) => p.id).filter((id) => id !== "center");
        onPanelsChange?.(ids);
    };

    useImperativeHandle(
        ref,
        () => ({
            resetLayout: () => {
                const api = apiRef.current;
                if (!api) return;
                try {
                    localStorage.removeItem(STORAGE_KEY);
                } catch {
                    /* best effort */
                }
                buildDefaultLayout(api);
                emitPanels();
            },
            togglePanel: (id: string) => {
                const api = apiRef.current;
                if (!api) return;
                const existing = api.getPanel(id);
                if (existing) {
                    api.removePanel(existing);
                } else {
                    // Re-add as a new tab in whichever group is active. If nothing is
                    // active (rare — e.g. the user closed every side panel), fall back
                    // to docking right of the locked center group.
                    const center = api.getPanel("center");
                    const active =
                        api.activePanel && api.activePanel.id !== "center" ? api.activePanel : null;
                    api.addPanel({
                        id,
                        component: id,
                        title: PANEL_TITLES[id] ?? id,
                        position: active
                            ? { referencePanel: active.id }
                            : center
                              ? { referencePanel: "center", direction: "right" }
                              : undefined,
                    });
                }
            },
            getOpenSidePanelIds: () => {
                const api = apiRef.current;
                if (!api) return [];
                return api.panels.map((p) => p.id).filter((id) => id !== "center");
            },
        }),
        // emitPanels is a stable closure over apiRef + onPanelsChange; the
        // latter is the only thing that semantically affects the imperative
        // handle. Adding emitPanels here would force a new handle identity
        // on every render and tear down whatever holds the imperative ref.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [onPanelsChange],
    );

    const onReady = (event: DockviewReadyEvent) => {
        apiRef.current = event.api;
        const saved = loadLayout();
        if (saved) {
            try {
                event.api.fromJSON(saved);
                // The center panel is mandatory — every other side panel is optional
                // and may legitimately be closed by the user.
                if (!event.api.getPanel("center")) {
                    event.api.addPanel({
                        id: "center",
                        component: "center",
                        title: PANEL_TITLES.center,
                    });
                }
                lockCenterGroup(event.api);
            } catch {
                buildDefaultLayout(event.api);
            }
        } else {
            buildDefaultLayout(event.api);
        }

        event.api.onDidLayoutChange(() => {
            try {
                saveLayout(event.api.toJSON());
            } catch {
                /* best effort */
            }
            emitPanels();
        });
        // Initial snapshot so the menu picks up the post-restore state.
        emitPanels();
    };

    // Movement threshold (px) before a tab mousedown turns into a "drag".
    // Below this, the mousedown→mouseup is treated as a click and dockview's
    // default tab-switch behaviour runs.
    const DRAG_THRESHOLD = 5;

    const onMouseDownCapture = (e: React.MouseEvent) => {
        if (e.button !== 0) return; // left button only
        if (movingPanelId) return; // already mid-drag
        const api = apiRef.current;
        if (!api) return;
        const tabEl = (e.target as HTMLElement).closest(".dv-tab") as HTMLElement | null;
        if (!tabEl) return; // Mousedown outside a tab — let panel content handle it.
        const container = tabEl.parentElement;
        if (!container) return;
        // Tab index within its strip → matches the group's panel ordering.
        const tabs = Array.from(container.children).filter((el): el is HTMLElement =>
            el instanceof HTMLElement && el.classList.contains("dv-tab"),
        );
        const idx = tabs.indexOf(tabEl);
        if (idx < 0) return;
        const group = api.groups.find((g) => g.element.contains(tabEl));
        if (!group) return;
        const panel = group.panels[idx];
        if (!panel) return;

        const startX = e.clientX;
        const startY = e.clientY;

        const cleanup = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
        const onMove = (ev: MouseEvent) => {
            if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
            cleanup();
            setMovingPanelId(panel.id);
            // Suppress the trailing click so dockview doesn't switch tabs
            // when the drag ends — the user committed to a move, not a click.
            const suppressClick = (ev2: MouseEvent) => {
                ev2.preventDefault();
                ev2.stopPropagation();
                window.removeEventListener("click", suppressClick, true);
            };
            window.addEventListener("click", suppressClick, true);
        };
        const onUp = () => cleanup();
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    };

    return (
        <div className={`panel-dock ${className ?? ""}`} onMouseDownCapture={onMouseDownCapture}>
            <DockviewReact
                components={components}
                onReady={onReady}
                theme={lockstepTheme}
                disableDnd
            />
            {movingPanelId && apiRef.current && (
                <PanelMoveOverlay
                    api={apiRef.current}
                    panelId={movingPanelId}
                    onExit={exitMove}
                />
            )}
        </div>
    );
});

export default PanelDock;

// eslint-disable-next-line react-refresh/only-export-components
export const PANEL_LIST: Array<{ id: string; title: string }> = [
    ...SIDE_PANEL_IDS.map((id) => ({ id, title: PANEL_TITLES[id] })),
    ...(SHOW_THUMB_RECORDER
        ? [{ id: "thumb-recorder", title: PANEL_TITLES["thumb-recorder"] }]
        : []),
];

function loadLayout(): SerializedDockview | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as SerializedDockview;
    } catch {
        return null;
    }
}

function saveLayout(layout: SerializedDockview) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
}
