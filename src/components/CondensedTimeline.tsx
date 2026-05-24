import { useCallback, useEffect, useRef } from "react";
import { useAppSelector } from "../store/hooks";
import { useDockBridge } from "../layout/DockContext";
import { clipHsl } from "../timeline/palette";
import { timeLayers } from "../timeline/ruler";
import "./CondensedTimeline.css";

const HEIGHT = 36;
const SCENE_COLOR = "hsl(48,95%,62%)";
const ANCHOR_COLOR = "hsl(195,75%,55%)";
const PLAYHEAD_COLOR = "hsl(0,90%,65%)";
const TICK_COLOR = "rgba(226,219,210,0.55)";
const TICK_LABEL_COLOR = "rgba(226,219,210,0.75)";
const BG_COLOR = "#0d0b09";

/**
 * Compact LosslessCut-style overview strip: a single track that always shows
 * the full video duration. Time ticks, region bars, scene cuts, and input
 * anchors stack on top of each other. Pointer down/move scrubs the playhead
 * like the main timeline's time ruler.
 */
export default function CondensedTimeline() {
    const { playerRef } = useDockBridge();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const scrubbingRef = useRef(false);

    const duration = useAppSelector((s) => s.video.video?.duration ?? 0);
    const playhead = useAppSelector((s) => s.warp.playhead);
    const origAnchors = useAppSelector((s) => s.warp.origAnchors);
    const regions = useAppSelector((s) => s.region.regions);
    const activeRegionId = useAppSelector((s) => s.region.activeRegionId);
    const videoPath = useAppSelector((s) => s.video.video?.path ?? null);
    const sceneCuts = useAppSelector((s) =>
        videoPath ? (s.scene.cutsByPath[videoPath] ?? []) : [],
    );
    const userSceneCuts = useAppSelector((s) =>
        videoPath ? (s.scene.userCutsByPath[videoPath] ?? []) : [],
    );

    const seek = useCallback(
        (clientX: number) => {
            const canvas = canvasRef.current;
            if (!canvas || duration <= 0) return;
            const rect = canvas.getBoundingClientRect();
            const x = clientX - rect.left;
            const t = Math.max(0, Math.min(duration, (x / rect.width) * duration));
            playerRef.current?.seek(t);
        },
        [duration, playerRef],
    );

    const handlePointerDown = useCallback(
        (e: React.PointerEvent<HTMLCanvasElement>) => {
            if (e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            scrubbingRef.current = true;
            seek(e.clientX);
        },
        [seek],
    );

    const handlePointerMove = useCallback(
        (e: React.PointerEvent<HTMLCanvasElement>) => {
            if (!scrubbingRef.current) return;
            seek(e.clientX);
        },
        [seek],
    );

    const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
        }
        scrubbingRef.current = false;
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const draw = () => {
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            const dpr = window.devicePixelRatio || 1;
            const rect = canvas.getBoundingClientRect();
            const W = rect.width;
            const H = rect.height;
            if (W === 0 || H === 0) return;
            if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
                canvas.width = Math.round(W * dpr);
                canvas.height = Math.round(H * dpr);
            }
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            ctx.fillStyle = BG_COLOR;
            ctx.fillRect(0, 0, W, H);

            if (duration <= 0) return;

            const tX = (t: number) => (t / duration) * W;
            const pps = W / duration;

            // ── Time ruler — top band ────────────────────────────
            const rulerH = 12;
            for (const layer of timeLayers(pps)) {
                const su = layer.spacingUnit;
                const first = Math.floor(0 / su);
                const last = Math.ceil(duration / su);
                ctx.strokeStyle = TICK_COLOR;
                ctx.lineWidth = 1;
                ctx.beginPath();
                for (let i = first; i <= last; i++) {
                    if (layer.skipModulo && i % layer.skipModulo === 0) continue;
                    const t = i * su;
                    if (t < 0 || t > duration + 1e-6) continue;
                    const x = Math.round(tX(t)) + 0.5;
                    if (x < 0 || x > W) continue;
                    const tickH = layer.isMajor ? rulerH : (layer.tickHeight ?? 4);
                    ctx.moveTo(x, 0);
                    ctx.lineTo(x, tickH);
                }
                ctx.stroke();

                if (layer.label && layer.labelStyle === "major") {
                    ctx.fillStyle = TICK_LABEL_COLOR;
                    ctx.font = "9px system-ui, sans-serif";
                    ctx.textAlign = "left";
                    ctx.textBaseline = "top";
                    for (let i = first; i <= last; i++) {
                        if (layer.skipModulo && i % layer.skipModulo === 0) continue;
                        const t = i * su;
                        if (t < 0 || t > duration) continue;
                        const x = Math.round(tX(t));
                        if (x < 0 || x > W - 20) continue;
                        const text = layer.label(t);
                        if (text == null) continue;
                        ctx.fillText(text, x + 2, 1);
                    }
                }
            }

            // ── Region bars — middle band ────────────────────────
            const barTop = rulerH + 2;
            const barH = H - barTop - 4;
            for (const r of regions) {
                const x1 = tX(r.inPoint);
                const x2 = tX(r.outPoint);
                const w = Math.max(1, x2 - x1);
                const isActive = r.id === activeRegionId;
                ctx.fillStyle = clipHsl(r.colorIndex ?? 0, isActive ? 0.85 : 0.55);
                ctx.fillRect(x1, barTop, w, barH);
                if (isActive) {
                    ctx.strokeStyle = clipHsl(r.colorIndex ?? 0, 1, 15);
                    ctx.lineWidth = 1;
                    ctx.strokeRect(x1 + 0.5, barTop + 0.5, w - 1, barH - 1);
                }
            }

            // ── Scene cuts — thin vertical ticks ─────────────────
            const allScenes = [...sceneCuts, ...userSceneCuts];
            if (allScenes.length > 0) {
                ctx.strokeStyle = SCENE_COLOR;
                ctx.lineWidth = 1;
                ctx.beginPath();
                for (const t of allScenes) {
                    if (t < 0 || t > duration) continue;
                    const x = Math.round(tX(t)) + 0.5;
                    ctx.moveTo(x, barTop);
                    ctx.lineTo(x, barTop + barH);
                }
                ctx.stroke();
            }

            // ── Anchor-in markers — small down triangles ─────────
            if (origAnchors.length > 0) {
                ctx.fillStyle = ANCHOR_COLOR;
                const triH = 5;
                const triHalf = 3;
                for (const a of origAnchors) {
                    if (a.time < 0 || a.time > duration) continue;
                    const x = tX(a.time);
                    ctx.beginPath();
                    ctx.moveTo(x - triHalf, barTop);
                    ctx.lineTo(x + triHalf, barTop);
                    ctx.lineTo(x, barTop + triH);
                    ctx.closePath();
                    ctx.fill();
                }
            }

            // ── Playhead ─────────────────────────────────────────
            if (playhead !== undefined && playhead >= 0 && playhead <= duration) {
                const x = Math.round(tX(playhead)) + 0.5;
                ctx.strokeStyle = PLAYHEAD_COLOR;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, H);
                ctx.stroke();
            }
        };

        draw();

        const ro = new ResizeObserver(draw);
        ro.observe(canvas);
        return () => ro.disconnect();
    }, [
        duration,
        playhead,
        origAnchors,
        regions,
        activeRegionId,
        sceneCuts,
        userSceneCuts,
    ]);

    return (
        <div className="condensed-timeline" style={{ height: HEIGHT }}>
            <canvas
                ref={canvasRef}
                className="condensed-timeline__canvas"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
            />
        </div>
    );
}
