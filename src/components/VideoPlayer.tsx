import { forwardRef, useRef, useImperativeHandle, useEffect } from "react";
import "./VideoPlayer.css";

export interface VideoPlayerHandle {
    seek(time: number): void;
    play(): void;
    pause(): void;
    toggle(): void;
    setPlaybackRate(rate: number): void;
    get currentTime(): number;
    get playing(): boolean;
    get videoElement(): HTMLVideoElement | null;
}

interface VideoPlayerProps {
    src: string;
    duration: number;
    onTimeUpdate?: (time: number) => void;
    onPlayStateChange?: (playing: boolean) => void;
}

type RVFCMetadata = { mediaTime: number };
type RVFCVideo = HTMLVideoElement & {
    requestVideoFrameCallback?(cb: (now: number, metadata: RVFCMetadata) => void): number;
    cancelVideoFrameCallback?(id: number): void;
};

export default forwardRef<VideoPlayerHandle, VideoPlayerProps>(function VideoPlayer(
    { src, duration, onTimeUpdate, onPlayStateChange },
    ref,
) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const playingRef = useRef(false);
    const rafRef = useRef<number | null>(null);
    const rvfcRef = useRef<number | null>(null);
    const onTimeUpdateRef = useRef(onTimeUpdate);
    onTimeUpdateRef.current = onTimeUpdate;
    const lastEmittedRef = useRef(0);

    // Some files (B-frames before first I-frame, composition time offsets, edit
    // lists) have their first painted frame at mediaTime > 0. Treat that offset
    // as the UI origin so "frame 0" / "0.00s" in the UI maps to the actual first
    // visible frame. We add it back on every seek. Reset per-src.
    const startOffsetRef = useRef(0);
    useEffect(() => {
        startOffsetRef.current = 0;
    }, [src]);

    function emit(mediaTime: number) {
        const t = Math.max(0, mediaTime - startOffsetRef.current);
        lastEmittedRef.current = t;
        onTimeUpdateRef.current?.(t);
    }

    function emitIfNotSpuriousZero() {
        const raw = videoRef.current?.currentTime ?? 0;
        if (raw === 0 && lastEmittedRef.current > 0.05) return;
        emit(raw);
    }

    // Prefer requestVideoFrameCallback when available — its `mediaTime` is the
    // timestamp of the frame actually presented on screen, which is typically
    // 1-3 frames behind `video.currentTime` during playback.
    function startTracking() {
        const v = videoRef.current as RVFCVideo | null;
        if (!v) return;
        if (typeof v.requestVideoFrameCallback === "function") {
            const tick = (_now: number, metadata: RVFCMetadata) => {
                if (!playingRef.current) {
                    rvfcRef.current = null;
                    return;
                }
                emit(metadata.mediaTime);
                rvfcRef.current = v.requestVideoFrameCallback!(tick);
            };
            rvfcRef.current = v.requestVideoFrameCallback(tick);
            return;
        }
        if (rafRef.current !== null) return;
        const tick = () => {
            if (!playingRef.current) {
                rafRef.current = null;
                return;
            }
            emit(videoRef.current?.currentTime ?? 0);
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
    }

    function stopTracking() {
        const v = videoRef.current as RVFCVideo | null;
        if (rvfcRef.current !== null && v?.cancelVideoFrameCallback) {
            v.cancelVideoFrameCallback(rvfcRef.current);
            rvfcRef.current = null;
        }
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
    }

    // Detect the start offset once per src by scheduling a one-shot rVFC on
    // load — the first painted frame's mediaTime is our origin.
    function detectStartOffset() {
        const v = videoRef.current as RVFCVideo | null;
        if (!v) return;
        if (typeof v.requestVideoFrameCallback === "function") {
            v.requestVideoFrameCallback((_now, meta) => {
                if (meta.mediaTime > 0 && startOffsetRef.current === 0) {
                    startOffsetRef.current = meta.mediaTime;
                    // Re-emit so downstream UI snaps from "2f" to "0f" without the user
                    // having to seek.
                    emit(meta.mediaTime);
                }
            });
        }
    }

    useImperativeHandle(ref, () => ({
        seek(time: number) {
            if (videoRef.current) {
                const target = Math.max(0, Math.min(duration, time)) + startOffsetRef.current;
                videoRef.current.currentTime = target;
            }
        },
        play() {
            videoRef.current?.play();
        },
        pause() {
            videoRef.current?.pause();
        },
        toggle() {
            const v = videoRef.current;
            if (!v) return;
            playingRef.current ? v.pause() : v.play();
        },
        setPlaybackRate(rate: number) {
            if (videoRef.current) videoRef.current.playbackRate = rate;
        },
        get currentTime() {
            return Math.max(0, (videoRef.current?.currentTime ?? 0) - startOffsetRef.current);
        },
        get playing() {
            return playingRef.current;
        },
        get videoElement() {
            return videoRef.current;
        },
    }));

    return (
        <div className="video-player">
            <video
                ref={videoRef}
                src={src}
                className="video-player__video"
                onLoadedMetadata={detectStartOffset}
                onPlay={() => {
                    playingRef.current = true;
                    onPlayStateChange?.(true);
                    startTracking();
                }}
                onPause={() => {
                    playingRef.current = false;
                    onPlayStateChange?.(false);
                    stopTracking();
                    emitIfNotSpuriousZero();
                }}
                onEnded={() => {
                    playingRef.current = false;
                    onPlayStateChange?.(false);
                    stopTracking();
                    emitIfNotSpuriousZero();
                }}
                onSeeked={() => {
                    if (!playingRef.current) {
                        emit(videoRef.current?.currentTime ?? 0);
                    }
                }}
            />
        </div>
    );
});
