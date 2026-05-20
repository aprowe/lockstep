import { useCallback, useMemo, useState } from "react";
import ListPanel from "../../components/list/ListPanel";
import { useFilteredItems } from "../../components/list/useFilteredItems";
import ContextMenu, { type ContextMenuState } from "../../components/ContextMenu";
import ClipRow from "./ClipRow";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { useGesture } from "../../store/gesture";
import {
    addRegion as addRegionAction,
    deleteRegion as deleteRegionAction,
    setActiveRegionId as setActiveRegionIdAction,
    resetRegionBoundary as resetRegionBoundaryAction,
    renameRegion as renameRegionAction,
} from "../../store/slices/regionSlice";
import { setExportOpen as setExportOpenAction } from "../../store/slices/uiSlice";
import { setListSelection, setPendingEdit } from "../../store/slices/listsSlice";
import { calcNewRegionBoundsFromScenes } from "../../timeline/model/newRegionBounds";
import { visibleSceneCuts } from "../../utils/sceneFilter";
import { useDockBridge } from "../DockContext";

const EMPTY: never[] = [];

/**
 * Clips list — first port of the shared list pattern. Multiselect lives in
 * lists.selection.clips; the single "active" clip (which drives the
 * timeline view) stays in regionSlice.activeRegionId. A plain click sets
 * both; shift/ctrl-click only touches selection.
 */
export default function ClipsPanel() {
    const dispatch = useAppDispatch();
    const { seek } = useDockBridge();
    const pendingEdit = useAppSelector((s) => s.lists.pendingEdit);
    const pendingRenameId = pendingEdit?.list === "clips" ? pendingEdit.id : null;
    const video = useAppSelector((s) => s.video.video);
    const regions = useAppSelector((s) => s.region.regions);
    const activeRegionId = useAppSelector((s) => s.region.activeRegionId);
    const playhead = useAppSelector((s) => s.warp.playhead);
    const view = useAppSelector((s) => s.ui.view);
    const warpBpm = useAppSelector((s) => s.warp.bpm);
    const videoPath = video?.path;
    const sceneCuts = useAppSelector(
        (s) => (videoPath ? s.scene.cutsByPath[videoPath] : undefined) ?? EMPTY,
    );
    const userSceneCuts = useAppSelector(
        (s) => (videoPath ? s.scene.userCutsByPath[videoPath] : undefined) ?? EMPTY,
    );
    const sceneMinGap =
        useAppSelector((s) => (video ? s.scene.minGapByPath[video.path] : undefined)) ?? 2;
    const visibleCuts = useMemo(
        () => visibleSceneCuts(sceneCuts, userSceneCuts, sceneMinGap),
        [sceneCuts, userSceneCuts, sceneMinGap],
    );
    const filterMode = useAppSelector((s) => s.lists.filterMode.clips);
    const lassoSelection = useGesture((s) => s.lassoSelection);

    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

    type ClipItem = (typeof regions)[number] & { thumbnailTime: number };
    const augmented = useMemo<ClipItem[]>(
        () => regions.map((r) => ({ ...r, thumbnailTime: r.inPoint })),
        [regions],
    );
    // Clips list hides the 'clip' filter tab (filtering clips by themselves
    // is meaningless) but the hook still treats 'clip' mode as no-window →
    // returns []. Force 'global' here so a stale Redux value can't surface.
    const effectiveMode = filterMode === "clip" ? "global" : filterMode;
    const getClipRange = useCallback((r: ClipItem) => ({ start: r.inPoint, end: r.outPoint }), []);
    const items = useFilteredItems({
        items: augmented,
        filterMode: effectiveMode,
        getRange: getClipRange,
    });

    const addRegion = useCallback(
        (inPoint: number, outPoint: number) => {
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
        },
        [dispatch, regions.length, warpBpm],
    );

    const duplicateRegion = useCallback(
        (srcId: string) => {
            const src = regions.find((r) => r.id === srcId);
            if (!src || !video) return null;
            const span = src.outPoint - src.inPoint;
            const inPoint = Math.min(src.outPoint, video.duration - span);
            const outPoint = Math.min(inPoint + span, video.duration);
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
        },
        [dispatch, regions, video],
    );

    // Active = the single clip a plain click landed on. Seek the player only
    // when the activated clip is changing — re-clicking the already-active
    // clip leaves the playhead alone.
    const onActivate = useCallback(
        (id: string) => {
            if (id === activeRegionId) return;
            dispatch(setActiveRegionIdAction(id));
            const r = regions.find((x) => x.id === id);
            if (r) seek(r.inPoint);
        },
        [dispatch, regions, seek, activeRegionId],
    );

    const onDelete = useCallback(
        (ids: string[]) => {
            for (const id of ids) dispatch(deleteRegionAction(id));
            dispatch(setListSelection({ list: "clipin", ids: [] }));
            dispatch(setListSelection({ list: "clipout", ids: [] }));
        },
        [dispatch],
    );

    // Union of both clip spaces for context-menu replace-select logic.
    const selectedClipinIds = useAppSelector((s) => s.lists.selection.clipin);
    const selectedClipoutIds = useAppSelector((s) => s.lists.selection.clipout);
    const selectedClipIds = useMemo(
        () => [...new Set([...selectedClipinIds, ...selectedClipoutIds])],
        [selectedClipinIds, selectedClipoutIds],
    );

    const openContextMenu = useCallback(
        (e: React.MouseEvent, id: string) => {
            e.preventDefault();
            e.stopPropagation();
            const region = regions.find((r) => r.id === id);
            if (!region) return;
            // Adobe-style "replace-then-act" — if the right-clicked row isn't
            // already in the selection, replace selection with [id] + activate
            // before showing the menu, so menu actions hit the row the user
            // visually targeted instead of a stale multi-selection.
            if (!selectedClipIds.includes(id)) {
                // Replace-select: put this id in both spaces so it's visible on both tracks.
                dispatch(setListSelection({ list: "clipin", ids: [id] }));
                dispatch(setListSelection({ list: "clipout", ids: [id] }));
                dispatch(setActiveRegionIdAction(id));
            }
            setContextMenu({
                x: e.clientX,
                y: e.clientY,
                title: region.name,
                items: [
                    {
                        label: "Rename",
                        action: () => {
                            dispatch(setActiveRegionIdAction(id));
                            dispatch(setPendingEdit({ list: "clips", id }));
                        },
                    },
                    {
                        label: "Duplicate",
                        action: () => {
                            const newId = duplicateRegion(id);
                            if (newId) dispatch(setActiveRegionIdAction(newId));
                        },
                    },
                    {
                        label: "Export",
                        action: () => {
                            dispatch(setActiveRegionIdAction(id));
                            dispatch(setExportOpenAction(true));
                        },
                    },
                    { separator: true as const },
                    {
                        label: "Reset boundaries",
                        action: () => dispatch(resetRegionBoundaryAction({ id })),
                        disabled: region.defaultLinked,
                    },
                    {
                        label: "Delete",
                        action: () => dispatch(deleteRegionAction(id)),
                        danger: true,
                    },
                ],
            });
        },
        [regions, dispatch, duplicateRegion, selectedClipIds],
    );

    if (!video) return <div className="vj-empty-panel">No video</div>;

    return (
        <>
            <ListPanel
                listId="clips"
                items={items}
                activeId={activeRegionId}
                onActivate={onActivate}
                onDelete={onDelete}
                hideClipFilter
                emptyHint="Drag on the strip to create a clip"
                selectedIdsOverride={
                    lassoSelection
                        ? new Set([
                              ...(lassoSelection.clipinIds ?? new Set()),
                              ...(lassoSelection.clipoutIds ?? new Set()),
                          ])
                        : undefined
                }
                prefixRows={
                    <div
                        className={`clip-row clip-row--full${activeRegionId === null ? " clip-row--active" : ""}`}
                        onClick={() => {
                            dispatch(setActiveRegionIdAction(null));
                            dispatch(setListSelection({ list: "clipin", ids: [] }));
                            dispatch(setListSelection({ list: "clipout", ids: [] }));
                        }}
                    >
                        <span className="clip-row__swatch" style={{ background: "var(--bg-5)" }} />
                        <div className="clip-row__body">
                            <div className="clip-row__name">No Clip</div>
                        </div>
                    </div>
                }
                renderRow={(item, ctx) => {
                    // ClipRow reads colorIndex straight off the region; the slice
                    // backfills it on load and writes it on add.
                    return (
                        <ClipRow
                            key={item.id}
                            region={item}
                            ctx={ctx}
                            pendingRename={pendingRenameId === item.id}
                            onCommitRename={(id, name) => {
                                dispatch(renameRegionAction({ id, name }));
                                dispatch(setPendingEdit(null));
                            }}
                            onCancelRename={() => dispatch(setPendingEdit(null))}
                            onContextMenu={(e) => openContextMenu(e, item.id)}
                            onDoubleClick={() =>
                                dispatch(setPendingEdit({ list: "clips", id: item.id }))
                            }
                            onDelete={() => dispatch(deleteRegionAction(item.id))}
                        />
                    );
                }}
            />
            {contextMenu && <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />}
        </>
    );
}
