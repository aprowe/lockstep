import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VideoPlayerHandle } from "./components/VideoPlayer";
import ExportProgressBar from "./components/ExportProgressBar";
import ExportDialog from "./components/ExportDialog";
import MenuBar from "./components/MenuBar";
import type { MenuDef, MenuEntry } from "./components/MenuBar";
import { buildFileMenu, buildEditMenu, buildViewMenu } from "./menus";
import {
    getRecentFiles,
    addRecentFile,
    clearRecentFiles as clearRecentFilesApi,
} from "./api/recentFiles";
import { stepUiScale, resetUiScale, getUiScale, UI_SCALE_STEP } from "./uiScale";
import HudChip from "./components/HudChip";
import { useTransientChip } from "./utils/useTransientChip";

import PanelDock, { PANEL_LIST, type PanelDockHandle } from "./layout/PanelDock";
import { DockBridgeProvider } from "./layout/DockContext";
import ContextMenu from "./components/ContextMenu";
import type { ContextMenuState } from "./components/ContextMenu";
import ThumbnailPopup, { ThumbnailHoverProvider } from "./components/ThumbnailPopup";
import SettingsDialog from "./components/SettingsDialog";
import AboutDialog from "./components/AboutDialog";
import HotkeySheet from "./components/HotkeySheet";
import { IconSettings, IconDropVideo } from "./components/icons";
import { undo as undoAction, redo as redoAction } from "./store/slices/historySlice";
import {
    addRegion as addRegionAction,
    deleteRegion as deleteRegionAction,
    setActiveRegionId as setActiveRegionIdAction,
    updateRegionInOut as updateRegionInOutAction,
    updateRegionBeatTimes as updateRegionBeatTimesAction,
    renameRegion as renameRegionAction,
} from "./store/slices/regionSlice";
import {
    openFileThunk,
    openFolderThunk,
    loadFolderFromPathThunk,
    selectVideoThunk,
    closeVideoThunk,
    resetVideoDataThunk,
    openJsonFileThunk,
} from "./store/thunks/videoThunks";
import { ensureSceneListener } from "./store/thunks/sceneThunks";
import { startThumbnailMiddleware } from "./store/middleware/thumbnailMiddleware";

import { useAppDispatch, useAppSelector } from "./store/hooks";
import { setDetectingBpm as setDetectingBpmAction } from "./store/slices/videoSlice";
import {
    setBpm as setBpmAction,
    selectAll as selectAllWarp,
    deselectAll as deselectAllWarp,
} from "./store/slices/warpSlice";
import { selectWarpData, selectActiveRegion as selectActiveRegionRedux } from "./store/selectors";
import { setExportOpen as setExportOpenAction } from "./store/slices/uiSlice";
import "./App.css";

const VIDEO_EXTS = ["mp4", "mov", "avi", "mkv", "webm", "m4v"];
function hasVideoExt(p: string) {
    return VIDEO_EXTS.includes(p.split(".").pop()?.toLowerCase() ?? "");
}
function hasJsonExt(p: string) {
    return p.split(".").pop()?.toLowerCase() === "json";
}
function hasLlcExt(p: string) {
    return p.split(".").pop()?.toLowerCase() === "llc";
}

// ── App ──────────────────────────────────────────────────────────────────────

export default function App() {
    const dispatch = useAppDispatch();

    // ── Redux state ─────────────────────────────────────────────────────────
    const video = useAppSelector((s) => s.video.video);
    const _folderVideos = useAppSelector((s) => s.video.folderVideos);
    const _detectingBpm = useAppSelector((s) => s.video.detectingBpm);
    const regions = useAppSelector((s) => s.region.regions);
    const activeRegionId = useAppSelector((s) => s.region.activeRegionId);
    const activeRegion = useAppSelector(selectActiveRegionRedux);
    const _view = useAppSelector((s) => s.ui.view);
    const _videoPath = video?.path ?? null;

    // ── Dispatch helpers ────────────────────────────────────────────────────
    // Wrapped in useCallback so they're referentially stable across renders.
    // The downstream useMemo / useCallback hooks that depend on these would
    // otherwise recompute every render, defeating their memoization.
    const openFile = useCallback(() => dispatch(openFileThunk()), [dispatch]);
    const openFolder = useCallback(() => dispatch(openFolderThunk()), [dispatch]);
    const loadFolderFromPath = useCallback(
        (p: string) => dispatch(loadFolderFromPathThunk(p)),
        [dispatch],
    );
    const selectVideo = useCallback((p: string) => dispatch(selectVideoThunk(p)), [dispatch]);
    const closeVideo = useCallback(() => dispatch(closeVideoThunk()), [dispatch]);
    const resetVideoData = useCallback(() => dispatch(resetVideoDataThunk()), [dispatch]);
    const openJsonFile = useCallback(() => dispatch(openJsonFileThunk()), [dispatch]);
    const setDetectingBpm = useCallback(
        (v: boolean) => dispatch(setDetectingBpmAction(v)),
        [dispatch],
    );
    const _addRegion = (inPoint: number, outPoint: number) => {
        const id = `region_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const name = `Clip ${regions.length + 1}`;
        dispatch(
            addRegionAction({
                id,
                name,
                inPoint,
                outPoint,
                inBeatTime: inPoint,
                outBeatTime: outPoint,
                defaultLinked: true,
                bpm: warpBpm,
                minStretch: 0.5,
                maxStretch: 2.0,
            }),
        );
        return id;
    };
    const _duplicateRegion = (srcId: string) => {
        const src = regions.find((r) => r.id === srcId);
        if (!src) return null;
        const span = src.outPoint - src.inPoint;
        const maxTime = video?.duration ?? Infinity;
        const inPoint = Math.min(src.outPoint, maxTime - span);
        const outPoint = Math.min(inPoint + span, maxTime);
        const id = `region_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        dispatch(
            addRegionAction({
                ...src,
                id,
                name: `Clip ${regions.length + 1}`,
                inPoint,
                outPoint,
                inBeatTime: inPoint,
                outBeatTime: outPoint,
                defaultLinked: true,
            }),
        );
        return id;
    };
    const _deleteRegion = (id: string) => dispatch(deleteRegionAction(id));
    const _setActiveRegionId = (id: string | null) => dispatch(setActiveRegionIdAction(id));
    const _updateRegionInOut = (id: string, inP: number, outP: number) =>
        dispatch(updateRegionInOutAction({ id, inPoint: inP, outPoint: outP }));
    const _updateRegionBeatTimes = (id: string, inBT: number, outBT: number) =>
        dispatch(updateRegionBeatTimesAction({ id, inBeatTime: inBT, outBeatTime: outBT }));
    const _renameRegion = (id: string, name: string) => dispatch(renameRegionAction({ id, name }));
    const exportOpen = useAppSelector((s) => s.ui.exportOpen);
    const setExportOpen = (v: boolean) => dispatch(setExportOpenAction(v));
    const selectedClipinIds = useAppSelector((s) => s.lists.selection.clipin);
    const selectedClipoutIds = useAppSelector((s) => s.lists.selection.clipout);
    // Union of both spaces for ExportDialog pre-selection (export doesn't distinguish clipin/clipout).
    const selectedClipIds = useMemo(
        () => [...new Set([...selectedClipinIds, ...selectedClipoutIds])],
        [selectedClipinIds, selectedClipoutIds],
    );
    const [clipContextMenu, setClipContextMenu] = useState<ContextMenuState | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [pendingZoom, setPendingZoom] = useState<{ start: number; end: number } | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [aboutOpen, setAboutOpen] = useState(false);
    const [hotkeysOpen, setHotkeysOpen] = useState(false);
    const [uiScale, setUiScaleState] = useState(getUiScale);
    const [recentFiles, setRecentFiles] = useState<string[]>([]);
    useEffect(() => {
        const handler = (e: Event) => setUiScaleState((e as CustomEvent<number>).detail);
        window.addEventListener("ui-scale-change", handler);
        return () => window.removeEventListener("ui-scale-change", handler);
    }, []);

    useEffect(() => {
        getRecentFiles().then(setRecentFiles);
    }, []);

    useEffect(() => {
        startThumbnailMiddleware(dispatch);
    }, [dispatch]);

    useEffect(() => {
        if (!video?.path) return;
        addRecentFile(video.path).then(() => getRecentFiles().then(setRecentFiles));
    }, [video?.path]);
    const uiScaleLabel = `${Math.round(uiScale * 100)}%`;
    const uiScaleChipVisible = useTransientChip(uiScaleLabel);

    // ? opens the keyboard shortcuts cheat sheet (definition lives in src/hotkeys.ts).
    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement | null;
            if (
                t &&
                (t.tagName === "INPUT" ||
                    t.tagName === "TEXTAREA" ||
                    t.tagName === "SELECT" ||
                    t.isContentEditable)
            )
                return;
            if (e.key === "?") {
                e.preventDefault();
                setHotkeysOpen((o) => !o);
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, []);

    const playerRef = useRef<VideoPlayerHandle>(null);

    // Bridge of imperative App-level APIs (player ref, dialog state, floating
    // context menu) to dockview-mounted panels. Inline-rename state moved to
    // lists.pendingEdit. useMemo so panels don't see a fresh identity each
    // App render.
    const dockBridge = useMemo(
        () => ({
            seek: (t: number) => playerRef.current?.seek(t),
            setExportOpen: (open: boolean) => dispatch(setExportOpenAction(open)),
            playerRef,
            setClipContextMenu,
        }),
        [dispatch],
    );

    const _rDragStart = useRef<{ x: number; w: number } | null>(null);

    // Imperative handle into PanelDock — lets the View menu reset the layout
    // and toggle individual panels. Visible panel ids re-render the menu so the
    // ✓ check marks reflect the live dock state.
    const dockHandleRef = useRef<PanelDockHandle | null>(null);
    const [visiblePanelIds, setVisiblePanelIds] = useState<ReadonlySet<string>>(new Set());

    // Clear pendingZoom after it's consumed by WarpView on mount
    useEffect(() => {
        if (pendingZoom) setPendingZoom(null);
    }, [pendingZoom]);

    // ── Drag and drop ─────────────────────────────────────────────────────────

    useEffect(() => {
        let unlisten: (() => void) | null = null;

        import("@tauri-apps/api/webview").then(({ getCurrentWebview }) => {
            getCurrentWebview()
                .onDragDropEvent(async (event) => {
                    const e = event.payload;
                    if (e.type === "enter" || e.type === "over") {
                        setIsDragOver(true);
                        return;
                    }
                    if (e.type === "leave") {
                        setIsDragOver(false);
                        return;
                    }
                    if (e.type === "drop") {
                        setIsDragOver(false);
                        const paths = e.paths;
                        if (!paths || paths.length === 0) return;

                        // If any dropped path is a video file, load the first one
                        const firstVideo = paths.find(hasVideoExt);
                        if (firstVideo) {
                            await selectVideo(firstVideo);
                            return;
                        }
                        // If a LosslessCut .llc project is dropped, import it: load the
                        // referenced video and populate regions from cutSegments.
                        const firstLlc = paths.find(hasLlcExt);
                        if (firstLlc) {
                            const { openLlcProjectThunk } =
                                await import("./store/thunks/videoThunks");
                            await dispatch(openLlcProjectThunk(firstLlc));
                            return;
                        }
                        // If a .json sidecar is dropped, resolve video + state on the backend
                        const firstJson = paths.find(hasJsonExt);
                        if (firstJson) {
                            try {
                                const { readJsonSidecarForVideo } = await import("./api/warp");
                                const { videoInfo } = await readJsonSidecarForVideo(firstJson);
                                await selectVideo(videoInfo.path);
                            } catch (err: unknown) {
                                if (!String(err).includes("cancelled"))
                                    console.error("JSON drop failed:", err);
                            }
                            return;
                        }
                        // Otherwise treat the first dropped path as a folder
                        await loadFolderFromPath(paths[0]);
                    }
                })
                .then((fn) => {
                    unlisten = fn;
                });
        });

        return () => {
            unlisten?.();
        };
    }, [selectVideo, loadFolderFromPath, dispatch]);

    // ── Theme: mirror settings.theme onto <html data-theme="…"> so the
    //     theme tokens cascade. Settings are persisted in localStorage by the
    //     slice; this effect just keeps the DOM in sync with the redux value.

    const theme = useAppSelector((s) => s.settings.theme);
    useEffect(() => {
        document.documentElement.setAttribute("data-theme", theme);
    }, [theme]);

    // ── Scene detection: register listener (detection itself is user-driven
    //     from the Scenes panel — we never kick it off automatically). ───────

    useEffect(() => {
        dispatch(ensureSceneListener());
    }, [dispatch]);

    // ── Seek to region start when active region changes ──────────────────────

    useEffect(() => {
        if (activeRegion) {
            playerRef.current?.seek(activeRegion.inPoint);
        }
    }, [activeRegionId]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── BPM handlers ──────────────────────────────────────────────────────────

    const _playhead = useAppSelector((s) => s.warp.playhead);
    const warpData = useAppSelector(selectWarpData);
    const origAnchors = useAppSelector((s) => s.warp.origAnchors);
    const _beatAnchorsForSnap = useAppSelector((s) => s.warp.beatAnchors);
    const warpBpm = useAppSelector((s) => s.warp.bpm);

    const _handleBpmChange = useCallback(
        (bpm: number) => {
            dispatch(setBpmAction(bpm));
        },
        [dispatch],
    );

    const _handleBpmDetect = useCallback(async () => {
        if (origAnchors.length < 2) return;
        setDetectingBpm(true);
        try {
            const { analyzeAnchors } = await import("./api/warp");
            const data = await analyzeAnchors(origAnchors.map((a) => a.time));
            if (data.bpm && data.bpm > 0) dispatch(setBpmAction(data.bpm));
        } catch {
            // analyzeAnchors failed (no anchors, or backend error). Best-effort
            // BPM detection — fall through to clear the loading state.
        }
        setDetectingBpm(false);
    }, [setDetectingBpm, origAnchors, dispatch]);

    // ── Menus ──────────────────────────────────────────────────────────────────

    const anchorCount = warpData?.origAnchors.length ?? 0;

    const clearRecents = useCallback(() => {
        clearRecentFilesApi().then(() => setRecentFiles([]));
    }, []);

    const fileMenu: MenuDef = useMemo(
        () =>
            buildFileMenu({
                video,
                anchorCount,
                openFile,
                openFolder,
                openJsonFile,
                resetVideoData,
                closeVideo,
                saveProjectAs: () => {
                    /* TODO: save project state to a new JSON location */
                },
                recentFiles,
                openRecentFile: selectVideo,
                clearRecentFiles: clearRecents,
            }),
        [
            openFile,
            openFolder,
            openJsonFile,
            resetVideoData,
            closeVideo,
            video,
            anchorCount,
            recentFiles,
            selectVideo,
            clearRecents,
        ],
    );

    const editMenu: MenuDef = useMemo(
        () =>
            buildEditMenu({
                video,
                anchorCount,
                undo: () => dispatch(undoAction()),
                redo: () => dispatch(redoAction()),
                selectAll: () => dispatch(selectAllWarp()),
                deselect: () => dispatch(deselectAllWarp()),
                openSettings: () => setSettingsOpen(true),
            }),
        [video, anchorCount, dispatch],
    );

    const viewMenu: MenuDef = useMemo(
        () =>
            buildViewMenu({
                increaseUiScale: () => stepUiScale(UI_SCALE_STEP),
                decreaseUiScale: () => stepUiScale(-UI_SCALE_STEP),
                resetUiScale: () => resetUiScale(),
                resetPanelLayout: () => dockHandleRef.current?.resetLayout(),
                togglePanel: (id) => dockHandleRef.current?.togglePanel(id),
                panels: PANEL_LIST,
                visiblePanelIds,
                showShortcuts: () => setHotkeysOpen(true),
            }),
        [visiblePanelIds],
    );

    const brandMenu: MenuEntry[] = useMemo(
        () => [
            { label: "About Lockstep", action: () => setAboutOpen(true) },
            { separator: true },
            { label: "Settings…", shortcut: "Ctrl+,", action: () => setSettingsOpen(true) },
            { separator: true },
            {
                label: "Quit",
                shortcut: "Ctrl+Q",
                action: async () => {
                    const { getCurrentWindow } = await import("@tauri-apps/api/window");
                    try {
                        await getCurrentWindow().close();
                    } catch {
                        /* non-Tauri context */
                    }
                },
            },
        ],
        [],
    );

    const canExport = !!video;

    const _clipIn = activeRegion?.inPoint ?? undefined;
    const _clipOut = activeRegion?.outPoint ?? undefined;
    const _clipInBeatTime = activeRegion?.inBeatTime;
    const _clipOutBeatTime = activeRegion?.outBeatTime;

    // ── Render ─────────────────────────────────────────────────────────────────

    return (
        <ThumbnailHoverProvider>
            <div className="app">
                {/* Menu bar */}
                <MenuBar
                    menus={[fileMenu, editMenu, viewMenu]}
                    brandMenu={brandMenu}
                    rightContent={
                        <div className="menubar__right-actions">
                            <button
                                className="menubar__settings-btn"
                                onClick={() => setSettingsOpen(true)}
                                title="Settings"
                                aria-label="Settings"
                            >
                                <IconSettings size={16} />
                            </button>
                            <button
                                className="menubar__export-btn"
                                onClick={() => setExportOpen(true)}
                                disabled={!canExport}
                            >
                                Export
                            </button>
                        </div>
                    }
                />

                {/* Body — PanelDock renders unconditionally so the file-browser panel
          is reachable even before a video is loaded. The center column
          shows the empty / loading state itself. */}
                <DockBridgeProvider value={dockBridge}>
                    <div className="vj-body">
                        <ExportProgressBar />
                        <PanelDock
                            ref={dockHandleRef}
                            onPanelsChange={(ids) => setVisiblePanelIds(new Set(ids))}
                        />
                    </div>
                </DockBridgeProvider>

                {/* Drag-over overlay */}
                {isDragOver && (
                    <div className="app-drop-overlay">
                        <div className="app-drop-overlay__inner">
                            <IconDropVideo size={48} />
                            <span>Drop video or folder</span>
                        </div>
                    </div>
                )}

                {/* Export dialog */}
                {clipContextMenu && (
                    <ContextMenu menu={clipContextMenu} onClose={() => setClipContextMenu(null)} />
                )}
                <ExportDialog
                    open={exportOpen}
                    onClose={() => setExportOpen(false)}
                    warpData={warpData}
                    videoPath={video?.path ?? ""}
                    originalName={video?.originalName ?? ""}
                    videoFps={video?.fps}
                    regions={regions}
                    activeRegionId={activeRegionId}
                    selectedClipIds={selectedClipIds}
                />
                <ThumbnailPopup />
                <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
                <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
                <HotkeySheet open={hotkeysOpen} onClose={() => setHotkeysOpen(false)} />
                <HudChip
                    label={uiScaleLabel}
                    title="UI Scale"
                    visible={uiScaleChipVisible}
                    position="top-center"
                    fixed
                />
            </div>
        </ThumbnailHoverProvider>
    );
}
