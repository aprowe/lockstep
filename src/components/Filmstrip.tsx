import { useCallback, useMemo, useRef } from "react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { setFilmstripHeight } from "../store/slices/uiSlice";
import { secondsToFrames } from "../utils/time";
import Thumbnail from "./Thumbnail";
import "./Filmstrip.css";

const SLOTS = 7;

interface FilmstripProps {
    onSeekFrame?: (frame: number) => void;
}

export default function Filmstrip({ onSeekFrame }: FilmstripProps) {
    const dispatch = useAppDispatch();
    const video = useAppSelector((s) => s.video.video);
    const livePlayhead = useAppSelector((s) => s.warp.playhead);
    const playing = useAppSelector((s) => s.ui.playing);
    const origAnchors = useAppSelector((s) => s.warp.origAnchors);
    const stripHeight = useAppSelector((s) => s.ui.filmstripHeight);

    const frozenPlayheadRef = useRef<number>(livePlayhead);
    if (!playing) frozenPlayheadRef.current = livePlayhead;
    const playhead = playing ? frozenPlayheadRef.current : livePlayhead;

    const slots = useMemo(() => {
        if (!video) return [];
        const fps = video.fps;
        const maxFrame = Math.max(0, Math.floor(video.duration * fps));
        const center = Math.max(0, Math.min(maxFrame, secondsToFrames(playhead, fps)));
        const markerFrameSet = new Set(origAnchors.map((a) => secondsToFrames(a.time, fps)));
        const half = Math.floor(SLOTS / 2);
        const result: { frame: number; offset: number; inBounds: boolean; hasMarker: boolean }[] = [];
        for (let i = -half; i <= half; i++) {
            const frame = center + i;
            result.push({
                frame, offset: i,
                inBounds: frame >= 0 && frame <= maxFrame,
                hasMarker: markerFrameSet.has(frame),
            });
        }
        return result;
    }, [video, playhead, origAnchors]);

    const resizeStart = useRef<{ y: number; h: number } | null>(null);
    const handleResizeDown = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            resizeStart.current = { y: e.clientY, h: stripHeight };
            const onMove = (ev: MouseEvent) => {
                if (!resizeStart.current) return;
                const delta = resizeStart.current.y - ev.clientY;
                dispatch(setFilmstripHeight(resizeStart.current.h + delta));
            };
            const onUp = () => {
                resizeStart.current = null;
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        },
        [dispatch, stripHeight],
    );

    if (!video) return null;

    return (
        <div
            className={`filmstrip-wrap${playing ? " filmstrip-wrap--playing" : ""}`}
            style={{ height: stripHeight }}
        >
            <div
                className="filmstrip__resizer"
                onMouseDown={handleResizeDown}
                role="separator"
                aria-label="Resize filmstrip"
            />
            <div className="filmstrip" role="group" aria-label="Thumbnail filmstrip">
                {slots.map(({ frame, offset, inBounds, hasMarker }) => {
                    const classes = [
                        "filmstrip__slot",
                        offset === 0 ? "filmstrip__slot--center" : "",
                        !inBounds ? "filmstrip__slot--out" : "",
                        hasMarker ? "filmstrip__slot--marker" : "",
                    ].filter(Boolean).join(" ");
                    return (
                        <button
                            key={offset}
                            className={classes}
                            disabled={!inBounds}
                            onClick={() => inBounds && onSeekFrame?.(frame)}
                            title={inBounds ? `Frame ${frame}` : ""}
                        >
                            <Thumbnail
                                fileHash={video.fileHash}
                                frame={inBounds ? frame : null}
                                className="filmstrip__img"
                                placeholderClassName="filmstrip__placeholder"
                            />
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
