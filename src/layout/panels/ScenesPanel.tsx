import { useCallback, useEffect, useMemo, useState } from "react";
import ListPanel from "../../components/list/ListPanel";
import { useFilteredItems } from "../../components/list/useFilteredItems";
import SceneRow, { type SceneRowData } from "./SceneRow";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
    setMinGap as setSceneMinGapAction,
    deleteCut as deleteSceneCutAction,
} from "../../store/slices/sceneSlice";
import { detectScenesThunk, cancelSceneDetectionThunk } from "../../store/thunks/sceneThunks";
import { setListSelection } from "../../store/slices/listsSlice";
import { selectActiveRegion } from "../../store/selectors";
import { visibleSceneCuts } from "../../utils/sceneFilter";
import { useDockBridge } from "../DockContext";
import { useGesture } from "../../store/gesture";
import "./ScenesPanel.css";

// Stable empty-array sentinel — `?? []` in a selector allocates a fresh
// array every render, churning downstream memos that depend on items
// identity. Sharing one frozen `[]` keeps the default identity stable.
const EMPTY_CUTS: readonly number[] = Object.freeze([]) as readonly number[];

export default function ScenesPanel() {
    const dispatch = useAppDispatch();
    const { seek } = useDockBridge();
    const video = useAppSelector((s) => s.video.video);
    const videoPath = video?.path ?? null;
    const regions = useAppSelector((s) => s.region.regions);
    const cuts = useAppSelector(
        (s) => (videoPath ? s.scene.cutsByPath[videoPath] : undefined) ?? (EMPTY_CUTS as number[]),
    );
    const userCuts = useAppSelector(
        (s) =>
            (videoPath ? s.scene.userCutsByPath[videoPath] : undefined) ?? (EMPTY_CUTS as number[]),
    );
    const status = useAppSelector((s) =>
        videoPath ? (s.scene.statusByPath[videoPath] ?? "idle") : "idle",
    );
    const progress = useAppSelector((s) =>
        videoPath ? (s.scene.progressByPath[videoPath] ?? 0) : 0,
    );
    const error = useAppSelector((s) => (videoPath ? s.scene.errorByPath[videoPath] : undefined));
    const threshold =
        useAppSelector((s) => (videoPath ? s.scene.thresholdByPath[videoPath] : undefined)) ?? 10;
    const minGap =
        useAppSelector((s) => (videoPath ? s.scene.minGapByPath[videoPath] : undefined)) ?? 2;
    const filterMode = useAppSelector((s) => s.lists.filterMode.scenes);
    const activeRegion = useAppSelector(selectActiveRegion);
    const view = useAppSelector((s) => s.ui.view);

    const [draftThreshold, setDraftThreshold] = useState(String(threshold));
    // Keep the threshold input in sync when upstream changes (e.g. new video).
    useEffect(() => {
        setDraftThreshold(String(threshold));
    }, [threshold]);
    const parsedThreshold = Number.parseFloat(draftThreshold);
    const thresholdChanged =
        Number.isFinite(parsedThreshold) && Math.abs(parsedThreshold - threshold) > 1e-3;

    const filteredCuts = useMemo(
        () => visibleSceneCuts(cuts, userCuts, minGap),
        [cuts, userCuts, minGap],
    );

    // Boundaries 0 → ...cuts → duration become rows; each row spans [start, end).
    const allItems = useMemo<SceneRowData[]>(() => {
        if (!video) return [];
        const boundaries = [0, ...filteredCuts, video.duration];
        return boundaries.slice(0, -1).map((start, i) => {
            const end = boundaries[i + 1];
            // Inherit the containing region's persistent colorIndex so a scene
            // inside that clip matches its overlay hue. Falls through to null
            // when the scene falls outside every region.
            const region = regions.find((r) => start >= r.inPoint && start < r.outPoint);
            return {
                id: String(i),
                index: i,
                start,
                end,
                thumbnailTime: start,
                regionColorIndex: region?.colorIndex ?? null,
                // Boundary at t=0 is implied, not a real cut — disable its delete.
                canDelete: i > 0,
            };
        });
    }, [video, filteredCuts, regions]);

    const lassoSelection = useGesture((s) => s.lassoSelection);
    const lassoSceneIdSet = useMemo(() => {
        if (!lassoSelection) return undefined;
        const result = new Set<string>();
        for (const item of allItems) {
            if (lassoSelection.sceneTimes.has(item.start)) result.add(item.id);
        }
        return result;
    }, [lassoSelection, allItems]);

    const items = useFilteredItems({
        items: allItems,
        filterMode,
        getRange: useCallback((s: SceneRowData) => ({ start: s.start, end: s.end }), []),
    });

    // Active scene = the [start, end) the playhead currently sits in. Boundaries
    // are stored sorted by start, and a passed boundary stays active until the
    // next one — so a simple linear scan over `items` finds the right row, or
    // the last row when the playhead is past every boundary.
    const playhead = useAppSelector((s) => s.warp.playhead);
    const activeSceneId = useMemo<string | null>(() => {
        if (items.length === 0) return null;
        for (const it of items) {
            if (playhead >= it.start && playhead < it.end) return it.id;
        }
        const last = items[items.length - 1];
        return playhead >= last.end ? last.id : null;
    }, [items, playhead]);

    const onActivate = useCallback(
        (id: string) => {
            const data = items.find((r) => r.id === id);
            if (!data || !video) return;
            seek(data.start);
        },
        [items, video, seek],
    );

    const onDelete = useCallback(
        (ids: string[]) => {
            if (!videoPath) return;
            for (const id of ids) {
                const row = items.find((r) => r.id === id);
                if (row && row.canDelete) {
                    dispatch(deleteSceneCutAction({ path: videoPath, cut: row.start }));
                }
            }
            dispatch(setListSelection({ list: "scenes", ids: [] }));
        },
        [items, videoPath, dispatch],
    );

    if (!video) return <div className="vj-empty-panel">No video</div>;

    const startScan = (window?: { start: number; end: number }) => {
        const t = Number.parseFloat(draftThreshold);
        if (!videoPath || !Number.isFinite(t) || t < 0) return;
        dispatch(detectScenesThunk({ path: videoPath, threshold: t, window }));
    };

    // "Scan view" only makes sense when the timeline view is a strict sub-range
    // of the file — if it covers the whole video, both buttons would do the
    // same work, so disable the scoped one.
    const viewSpansFullVideo = view.start <= 1e-3 && view.end >= video.duration - 1e-3;
    const viewWindow = { start: Math.max(0, view.start), end: Math.min(video.duration, view.end) };
    const viewIsValid = viewWindow.end - viewWindow.start > 1e-3 && !viewSpansFullVideo;
    const scanDisabled = status === "analyzing";

    const subHeader = (
        <>
            <div className="scenes-panel__controls">
                <div className="scenes-panel__row">
                    <label className="scenes-panel__label">Threshold</label>
                    <input
                        type="number"
                        className="scenes-panel__input"
                        min={0}
                        max={100}
                        step={1}
                        value={draftThreshold}
                        onChange={(e) => setDraftThreshold(e.target.value)}
                    />
                </div>
                <button
                    type="button"
                    className="scenes-panel__btn"
                    onClick={() => startScan()}
                    disabled={scanDisabled}
                    title="Scan the whole video for scene cuts"
                >
                    {thresholdChanged ? "Apply" : "Scan"}
                </button>
                <div className="scenes-panel__row">
                    <label
                        className="scenes-panel__label"
                        title="Collapse cuts closer than this into one segment."
                    >
                        Min gap
                    </label>
                    <input
                        type="number"
                        className="scenes-panel__input"
                        min={0}
                        max={60}
                        step={0.25}
                        value={minGap}
                        onChange={(e) => {
                            if (!videoPath) return;
                            const v = Number.parseFloat(e.target.value);
                            dispatch(
                                setSceneMinGapAction({
                                    path: videoPath,
                                    minGap: Number.isFinite(v) && v >= 0 ? v : 0,
                                }),
                            );
                        }}
                    />
                    <span className="scenes-panel__unit">s</span>
                </div>
                <button
                    type="button"
                    className="scenes-panel__btn scenes-panel__btn--secondary"
                    onClick={() => startScan(viewWindow)}
                    disabled={scanDisabled || !viewIsValid}
                    title={
                        viewIsValid
                            ? `Scan only the current view (${viewWindow.start.toFixed(2)}s → ${viewWindow.end.toFixed(2)}s)`
                            : "Zoom in to enable a scoped scan"
                    }
                >
                    Scan View
                </button>
            </div>
            {status === "analyzing" && (
                <div
                    className="scenes-panel__progress"
                    role="progressbar"
                    aria-valuenow={Math.round(progress * 100)}
                >
                    <div
                        className="scenes-panel__progress-bar"
                        style={{ width: `${Math.max(2, Math.round(progress * 100))}%` }}
                    />
                    <span className="scenes-panel__progress-label">
                        Analyzing… {Math.round(progress * 100)}%
                    </span>
                    <button
                        type="button"
                        className="scenes-panel__progress-cancel"
                        onClick={() => dispatch(cancelSceneDetectionThunk())}
                        title="Stop scene detection"
                    >
                        Stop
                    </button>
                </div>
            )}
            {status === "error" && error && (
                <div className="scenes-panel__error" title={error}>
                    {error}
                </div>
            )}
        </>
    );

    return (
        <ListPanel
            listId="scenes"
            items={items}
            activeId={activeSceneId}
            onActivate={onActivate}
            onDelete={onDelete}
            selectedIdsOverride={lassoSceneIdSet}
            subHeader={subHeader}
            clipFilterDisabled={!activeRegion}
            emptyHint={
                status === "analyzing"
                    ? "Analyzing…"
                    : filterMode === "clip" && !activeRegion
                      ? "Select a clip to scope scenes"
                      : filterMode === "clip"
                        ? "No scenes in the active clip"
                        : filterMode === "viewport"
                          ? "No scenes in view"
                          : "No scene cuts detected"
            }
            renderRow={(item, ctx) => (
                <SceneRow
                    key={item.id}
                    data={item}
                    ctx={ctx}
                    onDelete={() => {
                        if (videoPath && item.canDelete) {
                            dispatch(deleteSceneCutAction({ path: videoPath, cut: item.start }));
                        }
                    }}
                />
            )}
        />
    );
}
