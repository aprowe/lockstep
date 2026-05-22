import { useCallback, useEffect, useMemo, useRef } from "react";
import VideoPlayer from "../components/VideoPlayer";
import SnappyVideoPlayer from "../components/SnappyVideoPlayer";
import Filmstrip from "../components/Filmstrip";
import WarpView from "../components/WarpView";
import Toolbar from "../components/Toolbar";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { selectActiveRegion, selectSelectedIdsUnion, selectWarpData } from "../store/selectors";
import {
    setOrigAnchorsFromTimeline,
    setPlayhead as setPlayheadAction,
    newAnchorId,
} from "../store/slices/warpSlice";
import {
    addRegion as addRegionAction,
    deleteRegion as deleteRegionAction,
    setActiveRegionId as setActiveRegionIdAction,
    resetRegionBoundary as resetRegionBoundaryAction,
} from "../store/slices/regionSlice";
import {
    setPlaying as setPlayingAction,
    setView as setViewAction,
    setTimelineHeight as setTimelineHeightAction,
    setPlaybackLoopMode as setPlaybackLoopModeAction,
    setPlaybackMode as setPlaybackModeAction,
    type PlaybackLoopMode,
    type PlaybackMode,
} from "../store/slices/uiSlice";
import { openFileThunk } from "../store/thunks/videoThunks";
import {
    setInPointToPlayhead,
    setOutPointToPlayhead,
    moveRegionBounds,
    panClipinBounds,
    deleteTimelineSelection,
    deselectTimelineSelection,
} from "../store/thunks/regionThunks";
import {
    addCut as addSceneCutAction,
    deleteCut as deleteSceneCutAction,
    setSelectedCutTimes as setSelectedSceneCutTimesAction,
    type ScannedRange,
} from "../store/slices/sceneSlice";
import { setListSelection, setPendingEdit } from "../store/slices/listsSlice";
import { calcZoomToRegion } from "../utils/view";
import { beatRateAt } from "../timeline/model/beatMap";
import { calcNewRegionBoundsFromScenes } from "../timeline/model/newRegionBounds";
import { findPreviousTarget } from "../utils/navigation";
import { visibleSceneCuts } from "../utils/sceneFilter";
import type { View } from "../types";
import { useDockBridge } from "./DockContext";

const MIN_TIMELINE = 60;
/** Stable empty default for the scanned-ranges selector. Allocating
 *  `[]` inline would change identity every render and re-key WarpView's
 *  scenes-track props, which on a busy panel becomes a measurable cost. */
const EMPTY_SCANNED_RANGES: readonly ScannedRange[] = Object.freeze([]) as readonly ScannedRange[];
/** Reserved space for everything *above* the timeline inside .vj-center —
 *  breadcrumb (~40) + minimum video pane (~125) + toolbar (~50) + resizer (~5).
 *  Without enough headroom here the player gets squeezed to nothing and the
 *  timeline grows past the bottom of the dockview panel. */
const MIN_PLAYER_HEIGHT = 220;

/**
 * The fixed center column: video player + filmstrip + toolbar above the
 * timeline, separated by a vertical resizer. Lives inside a locked dockview
 * group so it can't be dragged or accept drops; everything else docks around
 * it.
 */
export default function CenterColumn() {
    const dispatch = useAppDispatch();
    const { playerRef, setExportOpen, setClipContextMenu } = useDockBridge();

    const video = useAppSelector((s) => s.video.video);
    const videoPath = video?.path ?? null;
    const playhead = useAppSelector((s) => s.warp.playhead);
    const playing = useAppSelector((s) => s.ui.playing);
    const playbackLoopMode = useAppSelector((s) => s.ui.playbackLoopMode);
    const view = useAppSelector((s) => s.ui.view);
    const timelineHeight = useAppSelector((s) => s.ui.timelineHeight);
    const snappyPlayer = useAppSelector((s) => s.settings.snappyPlayer);

    const warpData = useAppSelector(selectWarpData);
    const origAnchors = useAppSelector((s) => s.warp.origAnchors);
    const beatAnchors = useAppSelector((s) => s.warp.beatAnchors);
    const playbackMode = useAppSelector((s) => s.ui.playbackMode);
    const regions = useAppSelector((s) => s.region.regions);
    const activeRegionId = useAppSelector((s) => s.region.activeRegionId);
    const activeRegion = useAppSelector(selectActiveRegion);
    const sceneCuts = useAppSelector((s) =>
        videoPath ? (s.scene.cutsByPath[videoPath] ?? []) : [],
    );
    const userSceneCuts = useAppSelector((s) =>
        videoPath ? (s.scene.userCutsByPath[videoPath] ?? []) : [],
    );
    const sceneMinGap =
        useAppSelector((s) => (videoPath ? s.scene.minGapByPath[videoPath] : undefined)) ?? 2;
    const scannedSceneRanges = useAppSelector((s) =>
        videoPath
            ? (s.scene.scannedRangesByPath[videoPath] ?? EMPTY_SCANNED_RANGES)
            : EMPTY_SCANNED_RANGES,
    );
    // Live scan progress drives a synthetic partial range so the scanned-tint
    // on the scene track grows in lockstep with the panel's progress bar
    // instead of popping in only when the scan completes.
    const sceneStatus = useAppSelector((s) =>
        videoPath ? (s.scene.statusByPath[videoPath] ?? "idle") : "idle",
    );
    const sceneProgress = useAppSelector((s) =>
        videoPath ? (s.scene.progressByPath[videoPath] ?? 0) : 0,
    );
    const sceneScanWindow = useAppSelector((s) =>
        videoPath ? s.scene.scanWindowByPath[videoPath] : undefined,
    );
    const effectiveScannedRanges = useMemo<readonly ScannedRange[]>(() => {
        if (sceneStatus !== "analyzing" || !sceneScanWindow || !video) return scannedSceneRanges;
        const winEnd = Number.isFinite(sceneScanWindow.end) ? sceneScanWindow.end : video.duration;
        const span = winEnd - sceneScanWindow.start;
        if (span <= 0) return scannedSceneRanges;
        const liveEnd = sceneScanWindow.start + span * sceneProgress;
        if (liveEnd <= sceneScanWindow.start) return scannedSceneRanges;
        return [...scannedSceneRanges, { start: sceneScanWindow.start, end: liveEnd }];
    }, [scannedSceneRanges, sceneStatus, sceneProgress, sceneScanWindow, video]);
    const filteredSceneCuts = visibleSceneCuts(sceneCuts, userSceneCuts, sceneMinGap);
    // Multi-selection set from the clips list — surfaced on the timeline so
    // drag/edit gestures show which clips are about to be affected.
    const selectedClipinIds = useAppSelector((s) => s.lists.selection.clipin);
    const selectedClipoutIds = useAppSelector((s) => s.lists.selection.clipout);
    const selectedClipinSet = useMemo(() => new Set(selectedClipinIds), [selectedClipinIds]);
    const selectedClipoutSet = useMemo(() => new Set(selectedClipoutIds), [selectedClipoutIds]);
    // Union of both spaces for contexts that don't need to distinguish (e.g. clipOverlays.selected)
    const selectedClipSet = useMemo(
        () => new Set([...selectedClipinSet, ...selectedClipoutSet]),
        [selectedClipinSet, selectedClipoutSet],
    );
    // Union of orig + beat selected anchor ids — used for Delete key handling,
    // region thunks, and the marker panel's selectedIdsOverride.
    const _selectedAnchorIds = useAppSelector(selectSelectedIdsUnion);
    // Lasso-driven scene-cut selection — lives in sceneSlice (not lists.selection
    // because scene rows in the panel address segments, not cuts; conflating the
    // two would make panel checkboxes reflect timeline lasso state).
    const selectedSceneCutTimes = useAppSelector((s) => s.scene.selectedCutTimes);
    const userSceneCutSet = useMemo(() => new Set(userSceneCuts), [userSceneCuts]);
    const selectedSceneCutSet = useMemo(
        () => new Set(selectedSceneCutTimes),
        [selectedSceneCutTimes],
    );

    // Delete the union of every timeline-side selection in one shot. Fires
    // from Delete / Backspace when the timeline root has keyboard focus.
    const handleTimelineDelete = useCallback(() => dispatch(deleteTimelineSelection()), [dispatch]);

    // Clear every timeline-side selection — Cmd+D and the empty-click
    // deselect (Policy B from docs/INTERACTION_DESIGN.md).
    const handleTimelineDeselect = useCallback(
        () => dispatch(deselectTimelineSelection()),
        [dispatch],
    );

    // Saved viewport from before the user zoomed into a region — restored when
    // the same zoom action toggles back out.
    const preZoomView = useRef<View | null>(null);
    // Tracks the start of a drag on the player/timeline divider.
    const vDragStart = useRef<{ y: number; h: number } | null>(null);

    const folderVideos = useAppSelector((s) => s.video.folderVideos);
    const markersLoaded = useAppSelector((s) => s.video.markersLoaded);

    // ── Beat-time playback rate ───────────────────────────────────────────────
    // Keep refs current so the effect closure never captures stale values.
    const playbackModeRef = useRef(playbackMode);
    playbackModeRef.current = playbackMode;
    const origAnchorsRef = useRef(origAnchors);
    origAnchorsRef.current = origAnchors;
    const beatAnchorsRef = useRef(beatAnchors);
    beatAnchorsRef.current = beatAnchors;
    // Tracks the speed-dropdown multiplier set in Toolbar (default 1×).
    const speedRef = useRef(1);

    // The single source of truth for "what rate should playback advance at
    // right now". Beat mode walks the orig→beat anchor map (per-segment
    // linear slope); orig mode is the dropdown multiplier directly. Both
    // players (HTML5 and snappy) consume this same function so they warp
    // identically.
    const getEffectiveRate = useCallback((mediaTime: number): number => {
        const dropdownSpeed = speedRef.current;
        if (playbackModeRef.current !== "beat") return dropdownSpeed;
        return (
            beatRateAt(mediaTime, origAnchorsRef.current, beatAnchorsRef.current) * dropdownSpeed
        );
    }, []);

    useEffect(() => {
        const v = playerRef.current?.videoElement;
        if (!v) return;

        // HTML5 path: drive the rate from `timeupdate` events on the
        // underlying <video>. Browser clamp on playbackRate is 0.0625–16.
        const handleTimeUpdate = () => {
            const rate = Math.max(0.0625, Math.min(16, getEffectiveRate(v.currentTime)));
            if (v.playbackRate !== rate) v.playbackRate = rate;
        };

        v.addEventListener("timeupdate", handleTimeUpdate);
        handleTimeUpdate();
        return () => {
            v.removeEventListener("timeupdate", handleTimeUpdate);
            if (v.playbackRate !== 1) v.playbackRate = 1;
        };
        // Re-attach when the underlying <video> element changes (new src
        // load) or when the player implementation swaps. Anchor + mode
        // changes are picked up through refs.
    }, [playerRef, playbackMode, video?.path, getEffectiveRate]);

    // ── Empty / loading state ─────────────────────────────────────────────────
    // Rendered in the center slot whenever there's no usable video, so the
    // rest of the dock (file browser etc.) stays reachable around it.
    if (!video) {
        return (
            <div className="vj-center vj-center--empty">
                <p className="vj-center__hint">
                    {folderVideos.length === 0
                        ? "Open a file or folder to get started"
                        : "Select a video from the Files panel"}
                </p>
                {folderVideos.length === 0 && (
                    <button
                        className="vj-center__load-btn"
                        onClick={() => dispatch(openFileThunk())}
                    >
                        Load Video
                    </button>
                )}
            </div>
        );
    }
    if (!markersLoaded) {
        return (
            <div className="vj-center vj-center--empty">
                <p className="vj-center__hint">Loading…</p>
            </div>
        );
    }

    const setActiveRegionId = (id: string | null) => dispatch(setActiveRegionIdAction(id));

    const addRegion = (inPoint: number, outPoint: number) => {
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
                bpm: warpData?.bpm ?? 120,
                minStretch: 0.5,
                maxStretch: 2.0,
            }),
        );
        return id;
    };
    const duplicateRegion = (srcId: string) => {
        const src = regions.find((r) => r.id === srcId);
        if (!src) return null;
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
    };
    const deleteRegion = (id: string) => dispatch(deleteRegionAction(id));
    const updateRegionInOut = (id: string, inP: number, outP: number) =>
        dispatch(moveRegionBounds({ id, inPoint: inP, outPoint: outP }));
    // Vertical resizer between the player area and the timeline.
    const handleResizerPointerDown = (e: React.PointerEvent) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        vDragStart.current = { y: e.clientY, h: timelineHeight };
    };
    const handleResizerPointerMove = (e: React.PointerEvent) => {
        if (!vDragStart.current || !e.buttons) return;
        // .vj-center is sized to fill its dockview panel — clientHeight here is
        // the actual visible area we have to share between player and timeline.
        // Falling back to window.innerHeight (the old default) let the timeline
        // grow past the panel edge inside the dock.
        const body = (e.currentTarget as HTMLElement).closest(".vj-center") as HTMLElement | null;
        if (!body) return;
        const maxTimeline = Math.max(MIN_TIMELINE, body.clientHeight - MIN_PLAYER_HEIGHT);
        const desired = vDragStart.current.h - (e.clientY - vDragStart.current.y);
        dispatch(setTimelineHeightAction(Math.max(MIN_TIMELINE, Math.min(maxTimeline, desired))));
    };
    const handleResizerPointerUp = () => {
        vDragStart.current = null;
    };

    return (
        <div className="vj-center">
            <div className="vj-breadcrumb">
                <span className="vj-breadcrumb__name">{video.originalName}</span>
                {activeRegion && (
                    <span className="vj-breadcrumb__region"> › {activeRegion.name}</span>
                )}
            </div>
            <div className="vj-player">
                <div className="vj-player__video">
                    {snappyPlayer ? (
                        <SnappyVideoPlayer
                            ref={playerRef}
                            path={video.path}
                            duration={video.duration}
                            fps={video.fps}
                            audioUrl={video.videoUrl}
                            getRate={getEffectiveRate}
                            onTimeUpdate={(t) => {
                                if (playbackLoopMode !== "continue" && playing) {
                                    const inPoint = activeRegion?.inPoint ?? 0;
                                    const outPoint = activeRegion?.outPoint ?? video.duration;
                                    if (t >= outPoint - 0.001 && outPoint > inPoint) {
                                        if (playbackLoopMode === "loop") {
                                            playerRef.current?.seek(inPoint);
                                            dispatch(setPlayheadAction(inPoint));
                                            return;
                                        }
                                        playerRef.current?.pause();
                                        playerRef.current?.seek(outPoint);
                                        dispatch(setPlayheadAction(outPoint));
                                        return;
                                    }
                                }
                                dispatch(setPlayheadAction(t));
                            }}
                            onPlayStateChange={(v) => dispatch(setPlayingAction(v))}
                        />
                    ) : (
                        <VideoPlayer
                            ref={playerRef}
                            src={video.videoUrl}
                            duration={video.duration}
                            onTimeUpdate={(t) => {
                                // Apply the playback loop mode at the active region's outPoint
                                // (or video duration when no region is active). The HTML5 video
                                // element keeps rolling past the end on its own — we intercept
                                // here, *before* publishing the playhead, so the timeline
                                // doesn't overshoot the boundary even for a frame.
                                if (playbackLoopMode !== "continue" && playing) {
                                    const inPoint = activeRegion?.inPoint ?? 0;
                                    const outPoint = activeRegion?.outPoint ?? video.duration;
                                    if (t >= outPoint - 0.001 && outPoint > inPoint) {
                                        if (playbackLoopMode === "loop") {
                                            playerRef.current?.seek(inPoint);
                                            dispatch(setPlayheadAction(inPoint));
                                            return;
                                        }
                                        // 'stop' — pause at the boundary, snap the playhead exactly.
                                        playerRef.current?.pause();
                                        playerRef.current?.seek(outPoint);
                                        dispatch(setPlayheadAction(outPoint));
                                        return;
                                    }
                                }
                                dispatch(setPlayheadAction(t));
                            }}
                            onPlayStateChange={(v) => dispatch(setPlayingAction(v))}
                        />
                    )}
                </div>
                <Filmstrip
                    onSeekFrame={(frame) => {
                        if (video.fps > 0) playerRef.current?.seek(frame / video.fps);
                    }}
                />
            </div>

            <Toolbar
                playerRef={playerRef}
                duration={video.duration}
                fps={video.fps}
                playing={playing}
                currentTime={playhead}
                onMark={(t) =>
                    dispatch(
                        setOrigAnchorsFromTimeline([
                            ...origAnchors,
                            { id: newAnchorId(), time: Math.max(0, t) },
                        ]),
                    )
                }
                onJumpPrev={() => {
                    const times = (warpData?.origAnchors ?? []).map((a) => a.time);
                    const prev = findPreviousTarget(times, playhead, playing);
                    if (prev !== undefined) playerRef.current?.seek(prev);
                }}
                onJumpNext={() => {
                    const sorted = [...(warpData?.origAnchors ?? [])].sort(
                        (a, b) => a.time - b.time,
                    );
                    const next = sorted.find((a) => a.time > playhead + 0.05);
                    if (next) playerRef.current?.seek(next.time);
                }}
                onJumpRegionStart={
                    regions.length > 0
                        ? () => {
                              // Navigate BACKWARD through all region endpoints (both inPoints and
                              // outPoints), interleaved by time: s1 e1 s2 e2 ...
                              const endpoints = regions.flatMap((r) => [r.inPoint, r.outPoint]);
                              const prev = findPreviousTarget(endpoints, playhead, playing);
                              if (prev !== undefined) playerRef.current?.seek(prev);
                          }
                        : undefined
                }
                onJumpRegionEnd={
                    regions.length > 0
                        ? () => {
                              // Navigate FORWARD through all region endpoints.
                              const endpoints = regions
                                  .flatMap((r) => [r.inPoint, r.outPoint])
                                  .sort((a, b) => a - b);
                              const next = endpoints.find((t) => t > playhead + 0.05);
                              if (next !== undefined) playerRef.current?.seek(next);
                          }
                        : undefined
                }
                onSetIn={() =>
                    dispatch(
                        setInPointToPlayhead({
                            playhead,
                            viewSpan: view.end - view.start,
                            duration: video.duration,
                        }),
                    )
                }
                onSetOut={() =>
                    dispatch(
                        setOutPointToPlayhead({
                            playhead,
                            viewSpan: view.end - view.start,
                            duration: video.duration,
                        }),
                    )
                }
                onNewRegion={() => {
                    const { inPoint, outPoint } = calcNewRegionBoundsFromScenes(
                        playhead,
                        view,
                        filteredSceneCuts,
                        video.duration,
                        regions,
                    );
                    addRegion(inPoint, outPoint);
                }}
                onPrevRegion={
                    regions.length > 1
                        ? () => {
                              const inPoints = regions.map((r) => r.inPoint);
                              const prev = findPreviousTarget(inPoints, playhead, playing);
                              if (prev === undefined) return;
                              const target = regions.find((r) => r.inPoint === prev);
                              if (target) {
                                  setActiveRegionId(target.id);
                                  playerRef.current?.seek(target.inPoint);
                              }
                          }
                        : undefined
                }
                onNextRegion={
                    regions.length > 1
                        ? () => {
                              const sorted = [...regions].sort((a, b) => a.inPoint - b.inPoint);
                              const idx = sorted.findIndex((r) => r.id === activeRegionId);
                              const next = idx < sorted.length - 1 ? sorted[idx + 1] : null;
                              if (next) {
                                  setActiveRegionId(next.id);
                                  playerRef.current?.seek(next.inPoint);
                              }
                          }
                        : undefined
                }
                onDeleteRegion={activeRegion ? () => deleteRegion(activeRegion.id) : undefined}
                onNewScene={
                    videoPath
                        ? () => dispatch(addSceneCutAction({ path: videoPath, cut: playhead }))
                        : undefined
                }
                onPrevScene={
                    filteredSceneCuts.length > 0
                        ? () => {
                              const prev = findPreviousTarget(filteredSceneCuts, playhead, playing);
                              if (prev !== undefined) playerRef.current?.seek(prev);
                          }
                        : undefined
                }
                onNextScene={
                    filteredSceneCuts.length > 0
                        ? () => {
                              const next = [...filteredSceneCuts]
                                  .sort((a, b) => a - b)
                                  .find((t) => t > playhead + 0.001);
                              if (next !== undefined) playerRef.current?.seek(next);
                          }
                        : undefined
                }
                playbackLoopMode={playbackLoopMode}
                onPlaybackLoopModeChange={(m: PlaybackLoopMode) =>
                    dispatch(setPlaybackLoopModeAction(m))
                }
                playbackMode={playbackMode}
                onPlaybackModeChange={(m: PlaybackMode) => dispatch(setPlaybackModeAction(m))}
                onSpeedChange={(rate) => {
                    speedRef.current = rate;
                }}
                currentBeat={(() => {
                    const bpm = warpData?.bpm ?? 0;
                    if (bpm <= 0) return null;
                    // Beat zero anchors at the active region's in-point when one is
                    // set; otherwise it falls back to the warp's beat-zero time, or 0.
                    const beatZero = activeRegion?.inPoint ?? 0;
                    return (playhead - beatZero) * (bpm / 60);
                })()}
            />

            <div
                className="vj-resizer"
                onPointerDown={handleResizerPointerDown}
                onPointerMove={handleResizerPointerMove}
                onPointerUp={handleResizerPointerUp}
            />

            <div className="vj-timeline" style={{ height: timelineHeight }}>
                <WarpView
                    onSeek={(t) => playerRef.current?.seek(t)}
                    scenes={filteredSceneCuts}
                    scannedRanges={effectiveScannedRanges}
                    onSceneAdd={(t) => {
                        if (videoPath) dispatch(addSceneCutAction({ path: videoPath, cut: t }));
                    }}
                    onSceneDelete={(t) => {
                        if (videoPath) dispatch(deleteSceneCutAction({ path: videoPath, cut: t }));
                    }}
                    onSendToNewRegion={(inPoint, outPoint) => addRegion(inPoint, outPoint)}
                    onRegionAdd={(t) => {
                        const { inPoint, outPoint } = calcNewRegionBoundsFromScenes(
                            t,
                            view,
                            filteredSceneCuts,
                            video.duration,
                            regions,
                        );
                        addRegion(inPoint, outPoint);
                    }}
                    clipOverlays={regions.map((r) => {
                        const isActive = r.id === activeRegionId;
                        // A single clip that's both active AND the only selected one
                        // shows just the active treatment — the selected outline on top
                        // would be visually redundant and noisier than the active state
                        // it duplicates. Multi-select still flags the active clip as
                        // selected so the user can see it's part of the group.
                        const onlySelfSelected =
                            selectedClipSet.size === 1 && selectedClipSet.has(r.id);
                        return {
                            id: r.id,
                            name: r.name,
                            inPoint: r.inPoint,
                            outPoint: r.outPoint,
                            active: isActive,
                            selected: selectedClipSet.has(r.id) && !(isActive && onlySelfSelected),
                            colorIndex: r.colorIndex,
                            inBeatTime: r.inBeatTime,
                            outBeatTime: r.outBeatTime,
                        };
                    })}
                    onClipOverlaySelect={(id) => {
                        setActiveRegionId(id);
                        if (id) {
                            const region = regions.find((r) => r.id === id);
                            if (region) playerRef.current?.seek(region.inPoint);
                        }
                    }}
                    selectedClipinIds={selectedClipinSet}
                    selectedClipoutIds={selectedClipoutSet}
                    onClipsSelectionChange={(clipinIds, clipoutIds) => {
                        dispatch(setListSelection({ list: "clipin", ids: [...clipinIds] }));
                        dispatch(setListSelection({ list: "clipout", ids: [...clipoutIds] }));
                    }}
                    selectedSceneTimes={selectedSceneCutSet}
                    onScenesSelectionChange={(times) =>
                        dispatch(setSelectedSceneCutTimesAction([...times]))
                    }
                    userSceneTimes={userSceneCutSet}
                    onTimelineDelete={handleTimelineDelete}
                    onTimelineDeselect={handleTimelineDeselect}
                    onClipOverlayResize={(id, inP, outP) => updateRegionInOut(id, inP, outP)}
                    onClipOverlayMove={(id, inP, outP, altKey) =>
                        dispatch(panClipinBounds({ id, inPoint: inP, outPoint: outP, altKey }))
                    }
                    onClipOverlayZoom={(id) => {
                        const region = regions.find((r) => r.id === id);
                        if (!region) return;
                        const { nextView, previousView } = calcZoomToRegion(
                            view,
                            region.inPoint,
                            region.outPoint,
                            preZoomView.current,
                        );
                        if (previousView !== null) preZoomView.current = previousView;
                        else preZoomView.current = null;
                        dispatch(setViewAction(nextView));
                    }}
                    onZoomToRegion={() => {
                        const from = activeRegion?.inPoint ?? 0;
                        const to = activeRegion?.outPoint ?? video.duration;
                        const { nextView, previousView } = calcZoomToRegion(
                            view,
                            from,
                            to,
                            preZoomView.current,
                        );
                        if (previousView !== null) preZoomView.current = previousView;
                        else preZoomView.current = null;
                        dispatch(setViewAction(nextView));
                    }}
                    onClipOverlayContextMenu={(id, x, y) => {
                        const region = regions.find((r) => r.id === id);
                        if (!region) return;
                        setClipContextMenu({
                            x,
                            y,
                            title: region.name,
                            items: [
                                {
                                    label: "Rename",
                                    action: () => {
                                        setActiveRegionId(id);
                                        dispatch(setPendingEdit({ list: "clips", id }));
                                    },
                                },
                                {
                                    label: "Duplicate",
                                    action: () => {
                                        const newId = duplicateRegion(id);
                                        if (newId) setActiveRegionId(newId);
                                    },
                                },
                                {
                                    label: "Export",
                                    action: () => {
                                        setActiveRegionId(id);
                                        setExportOpen(true);
                                    },
                                },
                                { separator: true as const },
                                {
                                    label: "Reset boundaries",
                                    action: () => dispatch(resetRegionBoundaryAction({ id })),
                                    disabled: region.defaultLinked,
                                },
                                { label: "Delete", action: () => deleteRegion(id), danger: true },
                            ],
                        });
                    }}
                />
            </div>
        </div>
    );
}
