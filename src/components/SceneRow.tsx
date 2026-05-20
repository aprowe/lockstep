import { useCallback, useMemo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useAppSelector } from "../store/hooks";
import { selectThumbnailPathsFor } from "../store/slices/thumbnailsSlice";
import { gesture } from "../store/gesture";
import type { View } from "../types";
import { timeToViewPct } from "../utils/view";
import { useSetThumbnailHover } from "./ThumbnailPopup";
import "./SceneRow.css";

interface SceneRowProps {
    /** Scene change times in orig (input) seconds. */
    scenes: number[];
    /** Source-time ranges that have actually been scanned for cuts. Renders as
     *  a faint accent stripe inside the scene band so the operator can tell
     *  which slices of the file have been analysed (vs. having no cuts because
     *  none were found vs. because the scanner never ran there). */
    scannedRanges?: ReadonlyArray<{ start: number; end: number }>;
    view: View;
    /** Clip duration — used to clamp projection. */
    duration: number;
    /** When true, expand to show scene index labels per diamond. */
    expanded?: boolean;
    /** Click on a scene diamond — receives the scene time. */
    onSceneClick?: (time: number) => void;
    /** Current playhead time — highlights the closest scene within one frame. */
    playhead?: number;
    /** Shift-click or double-click on a scene diamond — remove that scene. */
    onSceneDelete?: (time: number) => void;
    /** Double-click on the empty row background — add a scene at that timestamp. */
    onSceneAdd?: (time: number) => void;
    /** Right-click on a scene diamond — caller shows a context menu. */
    onSceneContextMenu?: (time: number, x: number, y: number) => void;
    /** Right-click on the empty row background — global timeline menu. */
    onBackgroundContextMenu?: (time: number, x: number, y: number) => void;
    /** Currently-selected scene cut times — diamonds in this set get an accent
     *  outline. Independent of the activeIdx (playhead-derived) styling. */
    selectedTimes?: ReadonlySet<number>;
    /** Times the user explicitly placed (vs. ffmpeg-detected). User-placed
     *  diamonds render with a slightly different fill so they're visually
     *  distinguishable from auto-detected cuts. */
    userTimes?: ReadonlySet<number>;
}

const PLAYHEAD_MATCH_TOLERANCE = 0.05; // ~1 video frame at 20fps

export default function SceneRow({
    scenes,
    scannedRanges,
    view,
    duration,
    expanded,
    onSceneClick,
    playhead,
    onSceneDelete,
    onSceneAdd,
    onSceneContextMenu,
    onBackgroundContextMenu,
    selectedTimes,
    userTimes,
}: SceneRowProps) {
    const video = useAppSelector((s) => s.video.video);
    const thumbPaths = useAppSelector(selectThumbnailPathsFor(video?.fileHash));
    const setThumbnailHover = useSetThumbnailHover();

    // Precompute the per-scene inline thumbnail URLs only when expanded. Without
    // this, convertFileSrc runs N times per render (N = scene count), and the
    // render runs on every playhead tick during playback.
    const inlineSrcs = useMemo<(string | null)[]>(() => {
        if (!expanded || !video || video.fps <= 0) return [];
        return scenes.map((t) => {
            const path = thumbPaths[Math.floor(t * video.fps)];
            return path ? convertFileSrc(path) : null;
        });
    }, [expanded, scenes, thumbPaths, video]);

    // Active-scene index: the scene closest to the current playhead (within
    // one video frame). Memoized so repeated playhead ticks that don't cross
    // a scene boundary don't force a full recomputation.
    const activeIdx = useMemo(() => {
        if (playhead === undefined) return -1;
        let best = -1;
        let bestDist = PLAYHEAD_MATCH_TOLERANCE;
        for (let i = 0; i < scenes.length; i++) {
            const d = Math.abs(scenes[i] - playhead);
            if (d <= bestDist) {
                bestDist = d;
                best = i;
            }
        }
        return best;
    }, [scenes, playhead]);

    // Diamond hover — publishes into the shared gesture store (for through-line
    // rendering) and shows the popup thumbnail in collapsed mode (expanded mode
    // already shows the thumbnail inline).
    const handleDiamondEnter = useCallback(
        (time: number, e: React.MouseEvent<HTMLElement>) => {
            gesture.setHoveredScene(time);
            if (expanded) return;
            const rect = e.currentTarget.getBoundingClientRect();
            setThumbnailHover({ time, x: rect.left + rect.width / 2, y: rect.top });
        },
        [expanded, setThumbnailHover],
    );

    const handleLeave = useCallback(() => {
        gesture.setHoveredScene(null);
        setThumbnailHover(null);
    }, [setThumbnailHover]);

    // Double-click on empty row background → add a cut at the clicked timestamp.
    const handleBackgroundDoubleClick = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            if (!onSceneAdd) return;
            if (e.target !== e.currentTarget) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            const span = view.end - view.start;
            const t = view.start + Math.max(0, Math.min(1, pct)) * span;
            if (t >= 0 && t <= duration) onSceneAdd(t);
        },
        [onSceneAdd, view.start, view.end, duration],
    );

    const handleBackgroundContextMenu = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            if (!onBackgroundContextMenu) return;
            if (e.target !== e.currentTarget) return;
            e.preventDefault();
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            const t = view.start + Math.max(0, Math.min(1, pct)) * (view.end - view.start);
            onBackgroundContextMenu(t, e.clientX, e.clientY);
        },
        [onBackgroundContextMenu, view.start, view.end],
    );

    // Project each scanned range into viewport-relative percentages and clip
    // to the visible window. Computed inline (cheap — typically 1–2 ranges)
    // so a partially-scanned file doesn't pay any cost when nothing's set.
    const visibleScannedRanges = (scannedRanges ?? [])
        .map((r) => {
            const start = Math.max(view.start, Math.max(0, r.start));
            // Clamp Infinity (the "open-ended through the file" sentinel from
            // loadCached) and out-of-bounds ends against both view and duration.
            const end = Math.min(view.end, Math.min(duration, r.end));
            return { start, end };
        })
        .filter((r) => r.end > r.start);

    return (
        <div
            className={`scene-band${expanded ? " scene-band--expanded" : ""}`}
            onDoubleClick={handleBackgroundDoubleClick}
            onContextMenu={handleBackgroundContextMenu}
        >
            {visibleScannedRanges.map((r, i) => {
                const left = timeToViewPct(r.start, view);
                const right = timeToViewPct(r.end, view);
                return (
                    <div
                        key={`scanned-${i}`}
                        className="scene-band__scanned"
                        style={{ left: `${left}%`, width: `${right - left}%` }}
                        aria-hidden
                    />
                );
            })}
            {scenes.map((t, i) => {
                if (t < 0 || t > duration) return null;
                const x = timeToViewPct(t, view);
                if (x < -2 || x > 102) return null;
                const active = i === activeIdx;
                const selected = !!selectedTimes?.has(t);
                const isUser = !!userTimes?.has(t);
                const inlineSrc = expanded ? (inlineSrcs[i] ?? null) : null;
                return (
                    <div key={i} className="scene-band__marker" style={{ left: `${x}%` }}>
                        <button
                            type="button"
                            className={`scene-band__diamond${active ? " scene-band__diamond--active" : ""}${selected ? " scene-band__diamond--selected" : ""}${isUser ? " scene-band__diamond--user" : ""}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                if (e.shiftKey && onSceneDelete) onSceneDelete(t);
                                else onSceneClick?.(t);
                            }}
                            onDoubleClick={(e) => {
                                e.stopPropagation();
                                onSceneDelete?.(t);
                            }}
                            onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (onSceneContextMenu) onSceneContextMenu(t, e.clientX, e.clientY);
                                else onSceneDelete?.(t);
                            }}
                            onMouseEnter={(e) => handleDiamondEnter(t, e)}
                            onMouseLeave={handleLeave}
                            aria-label={`Scene ${i + 1}`}
                            title={`Scene ${i + 1}`}
                        />
                        {expanded && (
                            <button
                                type="button"
                                className={`scene-band__thumb-btn${active ? " scene-band__thumb-btn--active" : ""}`}
                                onClick={onSceneClick ? () => onSceneClick(t) : undefined}
                                onMouseEnter={() => gesture.setHoveredScene(t)}
                                onMouseLeave={() => gesture.setHoveredScene(null)}
                                aria-label={`Scene ${i + 1} thumbnail`}
                                title={`Scene ${i + 1}`}
                            >
                                {inlineSrc ? (
                                    <img
                                        className="scene-band__thumb-img"
                                        src={inlineSrc}
                                        alt=""
                                        draggable={false}
                                    />
                                ) : (
                                    <div className="scene-band__thumb-img scene-band__thumb-img--placeholder" />
                                )}
                            </button>
                        )}
                        {expanded && <span className="scene-band__label">{i + 1}</span>}
                    </div>
                );
            })}
        </div>
    );
}
