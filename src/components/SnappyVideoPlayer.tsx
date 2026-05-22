import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import {
    cancelFrameStream,
    decodeFrameMessage,
    decodeJpeg,
    startFrameStream,
} from "../api/frameStream";
import type { VideoPlayerHandle } from "./VideoPlayer";
import "./VideoPlayer.css";

/**
 * Experimental "snappy" video player.
 *
 * Architecture: a Rust-side ffmpeg subprocess streams MJPEG frames over a
 * Tauri Channel (raw binary IPC, no base64) into an in-memory ring buffer
 * keyed by pts. The canvas always paints the cached frame nearest to
 * whatever the imperative API has been told to seek to — so once a window
 * of frames is cached, scrubbing inside that window is instantaneous: no
 * decoder warmup, no keyframe seek, no black flash.
 *
 * Known gaps (documented in docs/SNAPPY_PLAYER_NOTES.md):
 * - Audio comes from a sibling `<audio>` element. Sync is best-effort and
 *   drifts under heavy scrub.
 * - `setPlaybackRate` only affects the cache walker (and the audio element);
 *   speeds > ~2× outrun the prefetch window on long clips.
 * - First paint of a new window costs one ffmpeg startup + first-frame
 *   decode (~150 ms on a warm SSD).
 */
interface SnappyVideoPlayerProps {
    /** Absolute filesystem path. NOT `videoUrl` — Rust reads via ffmpeg. */
    path: string;
    /** Total duration in seconds, so we can clamp seeks without a ffprobe RTT. */
    duration: number;
    /** Source fps. Used to size the decode window and as the cache step. */
    fps: number;
    /** `convertFileSrc(path)` — only used by the sibling `<audio>` element. */
    audioUrl: string;
    onTimeUpdate?: (time: number) => void;
    onPlayStateChange?: (playing: boolean) => void;
}

/** Seconds of frames decoded around the playhead at any time. Larger =
 *  smoother scrub but more memory and longer initial decode. */
const WINDOW_SECONDS = 6;
/** When the playhead gets within this many seconds of either window edge,
 *  request a new stream centred on the current playhead. */
const PREFETCH_MARGIN = 1.0;
/** Frame decode width — capped here so the player has a single, predictable
 *  bandwidth budget regardless of source resolution. */
const STREAM_WIDTH = 1280;

interface CachedFrame {
    pts: number;
    bitmap: ImageBitmap;
}

export default forwardRef<VideoPlayerHandle, SnappyVideoPlayerProps>(function SnappyVideoPlayer(
    { path, duration, fps, audioUrl, onTimeUpdate, onPlayStateChange },
    ref,
) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const audioRef = useRef<HTMLAudioElement>(null);
    // Sorted-by-pts cache. Plain array — we binary-search to render and
    // typically push to one end during a stream.
    const cacheRef = useRef<CachedFrame[]>([]);
    // Active stream metadata. `seq` is bumped on every requestWindow so
    // late-arriving frames from a superseded stream can be discarded.
    const streamRef = useRef<{
        seq: number;
        id: number | null;
        start: number;
        end: number;
    }>({ seq: 0, id: null, start: 0, end: 0 });
    const playingRef = useRef(false);
    const currentTimeRef = useRef(0);
    const playbackRateRef = useRef(1);
    // Wall-clock anchor for the cache-walker loop: when we last advanced the
    // playhead during playback, what (wall, media) pair did we use?
    const playClockRef = useRef<{ wall: number; media: number } | null>(null);
    const rafRef = useRef<number | null>(null);
    const onTimeUpdateRef = useRef(onTimeUpdate);
    onTimeUpdateRef.current = onTimeUpdate;
    const onPlayStateChangeRef = useRef(onPlayStateChange);
    onPlayStateChangeRef.current = onPlayStateChange;

    const [status, setStatus] = useState<"idle" | "decoding" | "ready" | "error">("idle");
    const [error, setError] = useState<string | null>(null);

    // ── Cache helpers ─────────────────────────────────────────────────────────

    const clearCache = useCallback(() => {
        for (const f of cacheRef.current) f.bitmap.close?.();
        cacheRef.current = [];
    }, []);

    const nearestCachedIndex = useCallback((pts: number): number => {
        const cache = cacheRef.current;
        if (cache.length === 0) return -1;
        let lo = 0;
        let hi = cache.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (cache[mid].pts < pts) lo = mid + 1;
            else hi = mid;
        }
        if (lo > 0 && Math.abs(cache[lo - 1].pts - pts) < Math.abs(cache[lo].pts - pts)) {
            return lo - 1;
        }
        return lo;
    }, []);

    const drawFrame = useCallback((bitmap: ImageBitmap) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        // Resize backing store on first paint or whenever the bitmap changes
        // dimensions (e.g. switching videos). CSS object-fit:contain handles
        // letterboxing.
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
        }
        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) return;
        ctx.drawImage(bitmap, 0, 0);
    }, []);

    const paintNearest = useCallback(
        (pts: number) => {
            const idx = nearestCachedIndex(pts);
            if (idx >= 0) drawFrame(cacheRef.current[idx].bitmap);
        },
        [drawFrame, nearestCachedIndex],
    );

    // ── Stream lifecycle ──────────────────────────────────────────────────────

    const requestWindow = useCallback(
        async (around: number) => {
            const half = WINDOW_SECONDS / 2;
            const start = Math.max(0, around - half);
            const end = Math.min(duration, around + half);
            if (end <= start) return;

            // Cancel whatever was running. We deliberately do NOT clear the
            // cache here — overlap between the old and new windows is still
            // valid for painting, and clearing on every reposition would
            // flash black.
            const prev = streamRef.current;
            if (prev.id !== null) {
                void cancelFrameStream(prev.id).catch(() => undefined);
            }

            // Drop cached frames outside the new window (+ a little slack)
            // so memory doesn't grow without bound across many repositions.
            const KEEP_SLACK = 0.5;
            cacheRef.current = cacheRef.current.filter((f) => {
                const keep = f.pts >= start - KEEP_SLACK && f.pts <= end + KEEP_SLACK;
                if (!keep) f.bitmap.close?.();
                return keep;
            });

            const seq = prev.seq + 1;
            streamRef.current = { seq, id: null, start, end };
            setStatus("decoding");
            setError(null);

            // Per-stream Channel. Late frames from a superseded stream are
            // gated by `seq` rather than by tearing down the channel (the
            // Rust side already stops sending when we cancel its id).
            const onFrame = new Channel<ArrayBuffer>();
            onFrame.onmessage = async (buffer) => {
                if (streamRef.current.seq !== seq) return;
                let bitmap: ImageBitmap;
                try {
                    const { pts, jpeg } = decodeFrameMessage(buffer);
                    bitmap = await decodeJpeg(jpeg);
                    if (streamRef.current.seq !== seq) {
                        bitmap.close?.();
                        return;
                    }
                    insertSorted(cacheRef.current, { pts, bitmap });
                    // Repaint if this frame is the new nearest to the
                    // current playhead — minimises stale-frame visibility
                    // on the first paint of a new window.
                    if (Math.abs(pts - currentTimeRef.current) < 1 / fps) {
                        drawFrame(bitmap);
                    } else if (status !== "ready") {
                        paintNearest(currentTimeRef.current);
                    }
                } catch {
                    /* drop individual decode failures — they're usually a
                       torn frame at the tail of a cancelled stream */
                }
            };

            try {
                const id = await startFrameStream({
                    path,
                    start,
                    end,
                    fps,
                    width: STREAM_WIDTH,
                    onFrame,
                });
                if (streamRef.current.seq !== seq) {
                    // A newer request raced past us. Cancel this one before
                    // it eats CPU on the Rust side.
                    void cancelFrameStream(id).catch(() => undefined);
                    return;
                }
                streamRef.current = { ...streamRef.current, id };
                // We don't get a "done" signal from the Channel pattern.
                // Once we've requested expected_frames worth of frames the
                // window is considered ready; until then the cache fills in
                // the background and paintNearest keeps catching up.
                setStatus("ready");
            } catch (e) {
                setStatus("error");
                setError(String(e));
            }
        },
        [duration, fps, path, status, drawFrame, paintNearest],
    );

    // Initial decode + reset on src change.
    useEffect(() => {
        currentTimeRef.current = 0;
        clearCache();
        playClockRef.current = null;
        if (audioRef.current) audioRef.current.currentTime = 0;
        void requestWindow(0);
        const captured = streamRef.current;
        return () => {
            if (captured.id !== null) {
                void cancelFrameStream(captured.id).catch(() => undefined);
            }
            clearCache();
        };
    }, [path, clearCache, requestWindow]);

    // ── Playback loop ────────────────────────────────────────────────────────

    const tick = useCallback(() => {
        if (!playingRef.current) {
            rafRef.current = null;
            return;
        }
        const now = performance.now() / 1000;
        const clock = playClockRef.current;
        if (clock) {
            const elapsed = (now - clock.wall) * playbackRateRef.current;
            const next = Math.min(duration, clock.media + elapsed);
            currentTimeRef.current = next;
            paintNearest(next);
            onTimeUpdateRef.current?.(next);
            if (next >= duration - 1e-4) {
                playingRef.current = false;
                onPlayStateChangeRef.current?.(false);
                rafRef.current = null;
                return;
            }
            const s = streamRef.current;
            if (next > s.end - PREFETCH_MARGIN || next < s.start + PREFETCH_MARGIN) {
                void requestWindow(next);
            }
        }
        rafRef.current = requestAnimationFrame(tick);
    }, [duration, paintNearest, requestWindow]);

    const startTicking = useCallback(() => {
        playClockRef.current = {
            wall: performance.now() / 1000,
            media: currentTimeRef.current,
        };
        if (rafRef.current === null) rafRef.current = requestAnimationFrame(tick);
    }, [tick]);

    const stopTicking = useCallback(() => {
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        playClockRef.current = null;
    }, []);

    useEffect(() => {
        return () => stopTicking();
    }, [stopTicking]);

    // ── Imperative handle ────────────────────────────────────────────────────

    useImperativeHandle(
        ref,
        () => ({
            seek(time: number) {
                const clamped = Math.max(0, Math.min(duration, time));
                currentTimeRef.current = clamped;
                paintNearest(clamped);
                onTimeUpdateRef.current?.(clamped);
                if (audioRef.current) {
                    try {
                        audioRef.current.currentTime = clamped;
                    } catch {
                        /* element not ready yet */
                    }
                }
                const s = streamRef.current;
                if (clamped < s.start + PREFETCH_MARGIN || clamped > s.end - PREFETCH_MARGIN) {
                    void requestWindow(clamped);
                }
                // Re-anchor the play clock so seek-while-playing doesn't
                // jump forward by however long the last wall-clock interval
                // was.
                if (playingRef.current) {
                    playClockRef.current = {
                        wall: performance.now() / 1000,
                        media: clamped,
                    };
                }
            },
            play() {
                if (playingRef.current) return;
                playingRef.current = true;
                onPlayStateChangeRef.current?.(true);
                void audioRef.current?.play().catch(() => undefined);
                startTicking();
            },
            pause() {
                if (!playingRef.current) return;
                playingRef.current = false;
                onPlayStateChangeRef.current?.(false);
                audioRef.current?.pause();
                stopTicking();
            },
            toggle() {
                if (playingRef.current) {
                    playingRef.current = false;
                    onPlayStateChangeRef.current?.(false);
                    audioRef.current?.pause();
                    stopTicking();
                } else {
                    playingRef.current = true;
                    onPlayStateChangeRef.current?.(true);
                    void audioRef.current?.play().catch(() => undefined);
                    startTicking();
                }
            },
            setPlaybackRate(rate: number) {
                playbackRateRef.current = rate;
                if (audioRef.current) audioRef.current.playbackRate = rate;
                // Re-anchor so the new rate applies from "now", not retroactively.
                if (playingRef.current) {
                    playClockRef.current = {
                        wall: performance.now() / 1000,
                        media: currentTimeRef.current,
                    };
                }
            },
            get currentTime() {
                return currentTimeRef.current;
            },
            get playing() {
                return playingRef.current;
            },
            get videoElement() {
                // No <video> here. The caller is the beat-rate effect in
                // CenterColumn — it reads currentTime / sets playbackRate
                // and listens for `timeupdate`. We don't synthesize that
                // event; beat-mode playback-rate adjustment is a known gap
                // for the prototype (see SNAPPY_PLAYER_NOTES.md).
                return null;
            },
        }),
        [duration, paintNearest, requestWindow, startTicking, stopTicking],
    );

    return (
        <div className="video-player video-player--snappy">
            <canvas ref={canvasRef} className="video-player__canvas" />
            <audio ref={audioRef} src={audioUrl} preload="auto" />
            {status === "error" && (
                <div className="video-player__error" title={error ?? ""}>
                    decode error
                </div>
            )}
            {status === "decoding" && cacheRef.current.length === 0 && (
                <div className="video-player__decoding">decoding…</div>
            )}
        </div>
    );
});

/** In-place insert into a pts-sorted array. Streams arrive in order, so the
 *  common case is `push`; the fall-back binary-insert keeps things tidy if a
 *  reorder ever slips through. */
function insertSorted(arr: CachedFrame[], frame: CachedFrame) {
    if (arr.length === 0 || arr[arr.length - 1].pts <= frame.pts) {
        arr.push(frame);
        return;
    }
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid].pts < frame.pts) lo = mid + 1;
        else hi = mid;
    }
    arr.splice(lo, 0, frame);
}
