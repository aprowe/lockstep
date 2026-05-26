import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import type { RegionBlock } from "../timeline/types";
import type { Anchor, Region, WarpSegment, View } from "../types";
import type { State as ConstraintState } from "../constraints/types";
import { buildAnchorPairs } from "../timeline/model/beatMap";
import { clipHsl } from "../timeline/palette";
import { visibleSceneThumbs } from "../timeline/sceneThumbs";
import { selectThumbnailPathsFor } from "../store/slices/thumbnailsSlice";
import { gesture, useGesture } from "../store/gesture";
import { dragStart, dragEnd } from "../store/slices/dragSlice";
import { setActiveRegionId as setActiveRegionIdAction } from "../store/slices/regionSlice";
import {
    cancelDrag,
    snapshotPreDragState,
    beginDrag,
    drag,
    endDrag,
} from "../store/thunks/dragThunks";
import { store } from "../store/store";
import { getUiScale } from "../uiScale";
import { useSetThumbnailHover } from "./ThumbnailPopup";
import {
    MINIMAP_H,
    TRI_HALF,
    TRI_H,
    FONT,
    buildLayout,
    type LayoutTrack,
} from "../timeline/layout";
import { timeLayers, barsLayers } from "../timeline/ruler";
import { createHitListBuilder, hitAt as hitAtPure, type HitListBuilder } from "../timeline/hitTest";
import { createTimelineController } from "../timeline/controller";
import type {
    Snapshot,
    Intent,
    PointerEventLike,
    WheelEventLike,
    KeyEventLike,
} from "../timeline/types";
import "./CanvasTimeline.css";

// ── PALETTE ────────────────────────────────────────────────
const BG0 = "#0d0b09";
const BG2 = "#171410";
const BGWARP = "#13151c";
const _BLACK = "#000000";
const FG1 = "#e2dbd2";
const FG3 = "#a09488";
const FG4 = "#7a6e62";

const SP_INPUT = "hsl(195,75%,55%)";
const SP_WARP = "hsl(32,90%,55%)";
const SP_OUTPUT = "hsl(280,55%,60%)";

const _MARKER_COLOR = "hsl(195,75%,55%)";
const MARKER_HOVER = "hsl(195,75%,78%)";
const PLAYHEAD_COL = "hsl(0,90%,65%)";
const _PLAYHEAD_GLOW = "hsla(0,90%,65%,0.22)";
const SCENE_COLOR = "hsl(48,95%,62%)";
const _THROUGH_COLOR = "hsla(195,85%,75%,0.5)";
const _THROUGH_HOVER = "hsla(195,85%,70%,0.85)";
const _BAR_TICK = "rgba(226,219,210,0.75)";
const _BEAT_TICK = "rgba(160,148,136,0.5)";
const _SUB_TICK = "rgba(90,78,66,0.7)";
const _GRID_BAR = "rgba(226,219,210,0.14)";
const _GRID_BEAT = "rgba(226,219,210,0.07)";

// CLIP_PALETTE and clipHsl are defined in ../timeline/palette.ts (shared with WarpView).

// Shared empty-set sentinel passed to the controller's Snapshot when no
// linkedBeatIds prop is provided. Keeping a single reference avoids
// re-allocating a Set on every pointer event.
const EMPTY_LINKED_IDS: ReadonlySet<number> = new Set<number>();

// ── PROPS ──────────────────────────────────────────────────
/**
 * Props for the canvas timeline. WarpView owns slice-derived data and selectors
 * and feeds them in; the timeline itself is pure wiring over a pointer/wheel/key
 * controller (`createTimelineController`) and a canvas draw routine.
 *
 * Callback naming convention:
 *  - `onXEntityMove` — single-entity intent for the primary grabbed item; the
 *    resolver propagates the delta to other selected entities via the lasso group.
 *  - `onXChange` — bulk slice writes used outside of drag.
 *  - `onX{Add,Delete,Select}` — discrete intents emitted by the controller.
 */
export interface CanvasTimelineProps {
    duration: number;
    outputDuration: number;
    view: View;
    onViewChange: (v: View) => void;
    maxDuration: number;
    playhead?: number;
    beatPlayhead?: number;
    onSeek?: (time: number) => void;
    onSeekBeat?: (beatTime: number) => void;
    anchors: Anchor[];
    /** Selected IDs in input (orig) space. */
    selectedOrigAnchorIds: ReadonlySet<number>;
    /** Selected IDs in beat (output) space. */
    selectedBeatAnchorIds: ReadonlySet<number>;
    onAnchorAdd?: (time: number) => void;
    onAnchorDelete?: (id: number) => void;
    onAnchorSelect?: (id: number, additive: boolean) => void;
    onAnchorContextMenu?: (id: number, x: number, y: number) => void;
    onAnchorsChange?: (next: Anchor[]) => void;
    /** Single-entity anchor move (primary grabbed entity only).
     *  The resolver propagates to other selected entities via lasso:main. */
    onAnchorEntityMove?: (entityId: string, time: number) => void;
    /** Called at the start of each pointer-event intent batch to reset slice
     *  entities to preDrag values. Implements the per-frame replay boundary
     *  that the constraint pipeline's drag model relies on. */
    onBeginReplayFrame?: () => void;
    beatAnchors: Anchor[];
    linkedBeatIds?: ReadonlySet<number>;
    onBeatAnchorDelete?: (id: number) => void;
    onBeatAnchorSelect?: (id: number, additive: boolean) => void;
    onBeatAnchorContextMenu?: (id: number, x: number, y: number) => void;
    onBeatAnchorsChange?: (next: Anchor[]) => void;
    snapInterval?: number;
    snapOffset?: number;
    snapTargetsInput?: number[];
    snapTargetsOutput?: number[];
    bpm: number;
    beatOffset?: number;
    clipLock?: "bpm" | "beats";
    clipLockedBeats?: number;
    clipAnchorLock?: boolean;
    smoothPan?: boolean;
    gridDiv?: number;
    scenes: number[];
    scannedRanges?: ReadonlyArray<{ start: number; end: number }>;
    onSceneAdd?: (time: number) => void;
    onSceneDelete?: (time: number) => void;
    onSceneContextMenu?: (time: number, x: number, y: number) => void;
    onRegionAdd?: (time: number) => void;
    onTimelineContextMenu?: (time: number, x: number, y: number) => void;
    regions: RegionBlock[];
    regionsOutput?: RegionBlock[];
    /** Full Region objects for live linking-event preview during anchor drags.
     *  Optional — defaults to [] when omitted. */
    regionDetails?: Region[];
    onRegionSelect?: (id: string) => void;
    onRegionContextMenu?: (id: string, x: number, y: number) => void;
    onRegionResize?: (id: string, inPoint: number, outPoint: number) => void;
    onRegionMove?: (id: string, inPoint: number, outPoint: number, altKey: boolean) => void;
    /** Single-entity region body move (primary grabbed region only).
     *  delta is the signed translate from the entity's position at drag start.
     *  The resolver propagates to other selected regions via lasso:main. */
    onRegionEntityMove?: (id: string, delta: number, isOutput: boolean, altKey: boolean) => void;
    /** Constraint graph passed to the Snapshot so the controller can call
     *  findSnapCandidates for render hints. */
    constraintGraph?: ConstraintState;
    onRegionZoom?: (id: string) => void;
    onZoomToRegion?: () => void;
    onGridDivChange?: (div: number) => void;
    segments: WarpSegment[];
    clipIn?: number;
    clipOut?: number;
    beatClipIn?: number;
    beatClipOut?: number;
    clipFillColor?: string;
    boundaryColor?: string;
    linkedBoundaries?: boolean[];
    selectedBoundaries?: boolean[];
    onConnectorSelectionChange?: (origIds: Set<number>, beatIds: Set<number>) => void;
    selectedClipinIds?: ReadonlySet<string>;
    selectedClipoutIds?: ReadonlySet<string>;
    onClipsSelectionChange?: (clipinIds: Set<string>, clipoutIds: Set<string>) => void;
    selectedSceneTimes?: ReadonlySet<number>;
    onScenesSelectionChange?: (times: Set<number>) => void;
    userSceneTimes?: ReadonlySet<number>;
    onTimelineDelete?: () => void;
    onTimelineDeselect?: () => void;
    warpCollapsed?: boolean;
    onToggleWarp?: () => void;
}

// ── SNAP ──────────────────────────────────────────────────
function _snapTime(t: number, interval?: number, offset = 0): number {
    if (!interval || interval <= 0) return t;
    return Math.round((t - offset) / interval) * interval + offset;
}

// ── COMPONENT ─────────────────────────────────────────────
export default function CanvasTimeline(props: CanvasTimelineProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const propsRef = useRef(props);
    propsRef.current = props;

    const dispatch = useAppDispatch();

    const alwaysAnchors = useAppSelector((s) => s.ui.timelineAlwaysAnchors);
    const alwaysRegions = useAppSelector((s) => s.ui.timelineAlwaysRegions);
    const alwaysScenes = useAppSelector((s) => s.ui.timelineAlwaysScenes);
    const followDrag = useAppSelector((s) => s.ui.timelineFollowDrag);

    // Video metadata + thumbnail cache for the scene-thumbs row. Read directly
    // from the store so the timeline doesn't need to thread these through props.
    const video = useAppSelector((s) => s.video.video);
    const thumbPaths = useAppSelector(selectThumbnailPathsFor(video?.fileHash));
    const videoFps = video?.fps ?? 0;
    const videoAspect =
        video && video.width && video.height && video.height > 0
            ? video.width / video.height
            : 16 / 9;

    const snapHintsIn = useGesture((s) => s.snapHintsIn);
    const snapHintsOut = useGesture((s) => s.snapHintsOut);
    const gestDragTime = useGesture((s) => s.dragTime);
    const gestHoverAnchorId = useGesture((s) => s.hoveredAnchorId);
    const gestHoverRegionId = useGesture((s) => s.hoveredRegionId);
    const gestHoverSceneTime = useGesture((s) => s.hoveredSceneTime);
    const gestHoverWarpLineId = useGesture((s) => s.hoveredWarpLineId);

    // ── Track layout ────────────────────────────────────────
    const [containerH, setContainerH] = useState(0);
    const [rowOverrides, setRowOverrides] = useState<Record<string, number>>({});
    const rowResizeRef = useRef<{
        aboveId: string;
        belowId: string;
        startY: number;
        hAbove: number;
        hBelow: number;
    } | null>(null);

    const setThumbnailHover = useSetThumbnailHover();

    // UI scale — read once, update when the global ui-scale-change event fires.
    // Drives both DOM (via CSS calc(var(--ui-scale))) and canvas (via this state).
    const [uiScale, setUiScaleState] = useState<number>(() => getUiScale());
    useEffect(() => {
        const handler = (e: Event) => setUiScaleState((e as CustomEvent).detail as number);
        window.addEventListener("ui-scale-change", handler);
        return () => window.removeEventListener("ui-scale-change", handler);
    }, []);

    const warpCollapsed = props.warpCollapsed ?? false;
    // Canvas-layer wiring (hit-testing, draw commands, layout geometry) lives
    // in this file. Pure data derivations from slice state belong in
    // src/store/selectors/timeline.ts and arrive via props from WarpView.
    const tracks = useMemo(
        () => (containerH > 0 ? buildLayout(warpCollapsed, containerH, rowOverrides) : []),
        [warpCollapsed, containerH, rowOverrides],
    );
    const tracksRef = useRef<LayoutTrack[]>([]);
    tracksRef.current = tracks;

    // ── Theme colors (read once, updated on theme change) ───
    const themeRef = useRef({
        bg0: BG0,
        bg2: BG2,
        bg4: "#1c1915",
        bgInset: "#131110",
        bgWarp: BGWARP,
        fg1: FG1,
        fg3: FG3,
        fg4: FG4,
        border: "#2c2720",
        fg1Rgb: "226,219,210",
        beatRgb: "255,240,220",
        playheadRgb: "240,92,92",
        spaceInput: SP_INPUT,
        spaceInputHi: MARKER_HOVER,
        spaceWarp: SP_WARP,
        spaceOutput: SP_OUTPUT,
        playhead: PLAYHEAD_COL,
        sceneCut: SCENE_COLOR,
        sceneCutHi: "hsl(48,100%,72%)",
        sceneCutBd: "hsl(40,90%,45%)",
        sceneCutActive: "hsl(48,100%,78%)",
        sceneCutActiveBd: "hsl(48,100%,88%)",
        snapColor: "hsl(140,80%,65%)",
        snapActive: "hsl(50,100%,60%)",
    });
    useEffect(() => {
        const read = () => {
            const s = getComputedStyle(document.documentElement);
            const g = (v: string) => s.getPropertyValue(v).trim();
            themeRef.current = {
                bg0: g("--bg-0") || BG0,
                bg2: g("--bg-2") || BG2,
                bg4: g("--bg-4") || "#1c1915",
                bgInset: g("--bg-inset") || "#131110",
                bgWarp: g("--wp-bg") || BGWARP,
                border: g("--border") || "#2c2720",
                fg1: g("--fg-1") || FG1,
                fg3: g("--fg-3") || FG3,
                fg4: g("--fg-4") || FG4,
                fg1Rgb: g("--fg-1-rgb") || "226,219,210",
                beatRgb: g("--beat-rgb") || "255,240,220",
                playheadRgb: g("--playhead-rgb") || "240,92,92",
                spaceInput: g("--space-input") || SP_INPUT,
                spaceInputHi: g("--blue-light") || MARKER_HOVER,
                spaceWarp: g("--space-warp") || SP_WARP,
                spaceOutput: g("--space-output") || SP_OUTPUT,
                playhead: g("--playhead") || PLAYHEAD_COL,
                sceneCut: g("--scene-cut") || SCENE_COLOR,
                sceneCutHi: g("--scene-cut-hi") || "hsl(48,100%,72%)",
                sceneCutBd: g("--scene-cut-bd") || "hsl(40,90%,45%)",
                sceneCutActive: g("--scene-cut-active") || "hsl(48,100%,78%)",
                sceneCutActiveBd: g("--scene-cut-active-bd") || "hsl(48,100%,88%)",
                snapColor: g("--snap") || "hsl(140,80%,65%)",
                snapActive: g("--snap-active") || "hsl(50,100%,60%)",
            };
            drawRef.current();
        };
        read();
        const obs = new MutationObserver(read);
        obs.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["class", "data-theme"],
        });
        return () => obs.disconnect();
    }, []);

    // ── Hover state ──────────────────────────────────────────
    // Anchor/region/scene hover are owned by the gesture store (published by the
    // controller). `hoverRegionEdge` is a draw-only detail not in the gesture
    // store, so it stays a local ref updated by handleMouseMove.
    const hoverRegionEdge = useRef<{ id: string; edge: "in" | "out" } | null>(null);
    const hoverX = useRef<number | null>(null);
    const [hoverTrackId, setHoverTrackId] = useState<string | null>(null);

    const lerpedView = useRef<{ start: number; end: number } | null>(null);
    const lerpRafRef = useRef<number | null>(null);

    // Gesture state machine — pure controller; all event handlers delegate to it.
    const controllerRef = useRef(createTimelineController());

    // ── Scene thumbnail image cache ─────────────────────────
    // Maps frame number → HTMLImageElement. The canvas draw routine is sync;
    // when a thumbnail path is known but its image isn't loaded yet we kick
    // off the load and request a redraw on completion.
    const thumbImageCacheRef = useRef<Map<number, HTMLImageElement>>(new Map());

    // ── Hit list (per-draw builder, queried by handlers) ─────
    const hitsBuilderRef = useRef<HitListBuilder>(createHitListBuilder());
    const clearHits = () => {
        hitsBuilderRef.current = createHitListBuilder();
    };
    const addHit = (x: number, y: number, w: number, h: number, data: unknown) =>
        hitsBuilderRef.current.add(x, y, w, h, data);
    const hitAt = (px: number, py: number): unknown =>
        hitAtPure(hitsBuilderRef.current.result(), px, py);

    // ── DRAW ────────────────────────────────────────────────
    function draw() {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
        if (!ctx) return;
        const p = propsRef.current;

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const W = rect.width,
            H = rect.height;
        if (W === 0 || H === 0) return;

        if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
            canvas.width = Math.round(W * dpr);
            canvas.height = Math.round(H * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const tracks = tracksRef.current;
        if (!tracks.length) return;
        const byId = (id: string) => tracks.find((t) => t.id === id);

        const th = themeRef.current;
        // Derived color strings computed from theme — single source of truth.
        const pal = {
            bg0: th.bg0,
            fg1: th.fg1,
            fg3: th.fg3,
            barTick: `rgba(${th.fg1Rgb},0.75)`,
            beatTick: `rgba(${th.fg1Rgb},0.45)`,
            subTick: `rgba(${th.fg1Rgb},0.28)`,
            gridBar: `rgba(${th.fg1Rgb},0.14)`,
            gridBeat: `rgba(${th.fg1Rgb},0.07)`,
            markerColor: th.spaceInput,
            markerHover: th.spaceInputHi,
            playhead: th.playhead,
            playheadGlow: `rgba(${th.playheadRgb},0.22)`,
            sceneColor: th.sceneCut,
            throughLine: `hsla(${th.fg1Rgb},0.5)`,
            throughHover: `hsla(${th.fg1Rgb},0.85)`,
        };
        // UI scale only applies to text-bearing elements per design intent —
        // tick labels and scene/anchor sizes remain pixel-stable.
        const SC = uiScale;

        const view = lerpedView.current ?? p.view;
        const tX = (t: number) => ((t - view.start) / (view.end - view.start)) * W;
        const _xToT = (x: number) => view.start + (x / W) * (view.end - view.start);

        // Pull live drag state from the controller for lasso + gesture helpers.
        // The slice (p.anchors / p.regions / p.beatAnchors / p.regionsOutput) is
        // updated on every pointerMove via dispatched ops so it IS the live state —
        // no separate live-override map is needed.
        const dragState = controllerRef.current.getDragState();
        const lassoOrigAnchorIds =
            dragState?.kind === "lasso" && dragState.active ? dragState.lassoOrigAnchorIds : null;
        const lassoBeatAnchorIds =
            dragState?.kind === "lasso" && dragState.active ? dragState.lassoBeatAnchorIds : null;
        const lassoClipinIds =
            dragState?.kind === "lasso" && dragState.active ? dragState.lassoClipinIds : null;
        const lassoClipoutIds =
            dragState?.kind === "lasso" && dragState.active ? dragState.lassoClipoutIds : null;
        const lassoSceneTimes =
            dragState?.kind === "lasso" && dragState.active ? dragState.lassoSceneTimes : null;

        // Read anchors and regions directly from the slice — the constraint mirror
        // middleware keeps them current within the same React tick.
        const anchors = p.anchors;
        const beatAnchors = p.beatAnchors;
        const regions = p.regions;

        const bpm = p.bpm;
        const beatSec = 60 / bpm;
        // Anchors paired by id and sorted by input time; everything that
        // connects input ↔ output anchors must iterate these pairs.
        const anchorPairs = buildAnchorPairs(anchors, beatAnchors);

        // True when an anchor (input or beat) is currently being dragged.
        const _anchorsDragging = dragState?.kind === "anchor";

        // Beat grid origin reads directly from the slice
        // (p.beatOffset = effectiveBounds.inBeatTime). The grid and the
        // region overlay both source from here so they stay in lockstep
        // during anchor drags — MirrorPair writes the authoritative value
        // to the slice and we display whatever it wrote.
        const beatOffset = p.beatOffset ?? 0;

        // Clipout regions render straight from the slice; MirrorPair is the
        // single writer for clipout position during a drag.
        const regionsOutput = p.regionsOutput;

        function spaceRange(space: "input" | "warp" | "output") {
            const ts = tracks.filter((t) => t.space === space);
            if (!ts.length) return null;
            return { top: ts[0].y, bottom: ts[ts.length - 1].y + ts[ts.length - 1].h };
        }

        function inputToOutput(inputTime: number): number {
            if (!p.segments.length || p.duration <= 0) return inputTime;
            const inputPct = (inputTime / p.duration) * 100;
            for (const seg of p.segments) {
                if (inputPct >= seg.origLeft - 1e-6 && inputPct <= seg.origRight + 1e-6) {
                    const span = seg.origRight - seg.origLeft;
                    const t = span > 0 ? (inputPct - seg.origLeft) / span : 0;
                    return (
                        ((seg.quantLeft + t * (seg.quantRight - seg.quantLeft)) / 100) *
                        p.outputDuration
                    );
                }
            }
            return (p.outputDuration / p.duration) * inputTime;
        }

        function setFont(size: number, bold: boolean) {
            ctx.font = `${bold ? "600 " : ""}${Math.round(size * SC)}px ${FONT}`;
        }

        clearHits();

        // ── Backgrounds ──────────────────────────────────────
        function layerBackgrounds() {
            ctx.fillStyle = pal.bg0;
            ctx.fillRect(0, 0, W, H);
            for (const tr of tracks) {
                ctx.fillStyle = pal.bg0;
                ctx.fillRect(0, tr.y, W, tr.h);
                ctx.fillStyle = th.border;
                ctx.fillRect(0, tr.y + tr.h, W, 1);
            }
        }
        layerBackgrounds();

        // ── Minimap ──────────────────────────────────────────
        function layerMinimap() {
            const maxDur = Math.max(p.duration, p.outputDuration);
            ctx.fillStyle = th.bgInset;
            ctx.fillRect(0, 0, W, MINIMAP_H);
            const barH = 6,
                barY = Math.round((MINIMAP_H - barH) / 2);
            for (const r of regions) {
                const x1 = (r.inPoint / maxDur) * W;
                const x2 = (r.outPoint / maxDur) * W;
                const isSel = r.active || r.selected;
                ctx.fillStyle = clipHsl(r.colorIndex ?? 0, isSel ? 0.65 : 0.45);
                ctx.fillRect(x1, barY, x2 - x1, barH);
                ctx.strokeStyle = clipHsl(r.colorIndex ?? 0, isSel ? 1 : 0.9);
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x1 + 0.5, barY);
                ctx.lineTo(x1 + 0.5, barY + barH);
                ctx.moveTo(x2 - 0.5, barY);
                ctx.lineTo(x2 - 0.5, barY + barH);
                ctx.stroke();
            }
            for (const a of anchors) {
                const x = (a.time / maxDur) * W;
                ctx.fillStyle = pal.markerColor;
                ctx.globalAlpha = 0.6;
                ctx.fillRect(Math.round(x), barY, 1, barH);
                ctx.globalAlpha = 1;
            }
            const visibleSpan = view.end - view.start;
            if (maxDur > 0 && visibleSpan < maxDur - 0.001) {
                const vx1 = (view.start / maxDur) * W;
                const vx2 = (view.end / maxDur) * W;
                const vInset = 2;
                const { beatRgb } = th;
                ctx.fillStyle = `rgba(${beatRgb},0.1)`;
                ctx.fillRect(vx1, vInset, vx2 - vx1, MINIMAP_H - vInset * 2);
                ctx.strokeStyle = `rgba(${beatRgb},0.75)`;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.roundRect(
                    vx1 + 0.5,
                    vInset + 0.5,
                    Math.max(0, vx2 - vx1 - 1),
                    MINIMAP_H - vInset * 2 - 1,
                    4,
                );
                ctx.stroke();
            }
            const phm = ((p.playhead ?? 0) / maxDur) * W;
            ctx.fillStyle = pal.playhead;
            ctx.fillRect(Math.round(phm), 0, 1, MINIMAP_H);
            ctx.fillStyle = th.border;
            ctx.fillRect(0, MINIMAP_H, W, 1);
            addHit(0, 0, W, MINIMAP_H, { kind: "minimap" });
        }
        layerMinimap();

        // ── Clip into canvas area ─────────────────────────────
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, MINIMAP_H + 1, W, H);
        ctx.clip();

        // ── Time ruler ───────────────────────────────────────
        function layerTimeRuler() {
            const tr = byId("time");
            if (!tr) return;
            const pps = W / (view.end - view.start);
            for (const layer of timeLayers(pps)) {
                const su = layer.spacingUnit;
                const first = Math.floor(view.start / su) - 1;
                const last = Math.ceil(view.end / su) + 1;
                const tkClr = layer.styleKey === "bar" ? pal.barTick : pal.subTick;
                const tickTop = layer.isMajor ? tr.y + 3 : tr.y + tr.h - (layer.tickHeight ?? 6);

                ctx.strokeStyle = tkClr;
                ctx.lineWidth = 1;
                ctx.beginPath();
                for (let i = first; i <= last; i++) {
                    if (layer.skipModulo && i % layer.skipModulo === 0) continue;
                    const t = i * su;
                    if (t < 0 || t > p.duration + 1e-6) continue;
                    const x = Math.round(tX(t)) + 0.5;
                    if (x < 0 || x > W) continue;
                    ctx.moveTo(x, tickTop);
                    ctx.lineTo(x, tr.y + tr.h - 1);
                }
                ctx.stroke();

                if (layer.label) {
                    const isMaj = layer.labelStyle === "major";
                    ctx.fillStyle = isMaj ? pal.fg1 : pal.fg3;
                    setFont(isMaj ? 10 : 9, isMaj);
                    ctx.textAlign = "left";
                    ctx.textBaseline = "top";
                    for (let i = first; i <= last; i++) {
                        if (layer.skipModulo && i % layer.skipModulo === 0) continue;
                        const t = i * su;
                        if (t < 0) continue;
                        const x = Math.round(tX(t));
                        if (x < 0 || x > W) continue;
                        const text = layer.label(t);
                        if (text == null) continue;
                        ctx.fillText(text, x + 3, tr.y + (isMaj ? 3 : 5));
                    }
                }
            }
        }
        layerTimeRuler();

        // ── Scenes ───────────────────────────────────────────
        function layerScenes() {
            const tr = byId("scenes");
            if (!tr) return;
            if (p.scannedRanges) {
                ctx.fillStyle = `rgba(${th.fg1Rgb},0.04)`;
                for (const sr of p.scannedRanges) {
                    const x1 = tX(sr.start),
                        x2 = tX(sr.end);
                    if (x2 < 0 || x1 > W) continue;
                    const xLo = Math.max(x1, 0),
                        xHi = Math.min(x2, W);
                    // Thin strip at bottom of track so the scene track BG itself stays uniform
                    ctx.fillRect(xLo, tr.y + tr.h - 2, xHi - xLo, 2);
                }
            }
            const cy = tr.y + tr.h / 2;
            // Diamond spans the full track height — active state uses color only,
            // not a size bump, to keep edges flush with the track.
            const baseR = tr.h / 2;
            const playhead = p.playhead ?? -1;
            const PLAYHEAD_TOL = 0.05;
            for (const t of p.scenes) {
                const x = tX(t);
                if (x < -10 || x > W + 10) continue;
                const isUser = p.userSceneTimes?.has(t) ?? false;
                const isSel =
                    (p.selectedSceneTimes?.has(t) ?? false) || (lassoSceneTimes?.has(t) ?? false);
                const isHov = gestHoverSceneTime === t;
                const isActive = playhead >= 0 && Math.abs(t - playhead) <= PLAYHEAD_TOL;
                const R = baseR;
                const fill = isActive
                    ? th.sceneCutActive
                    : isHov
                      ? th.sceneCutHi
                      : isUser
                        ? "hsl(195,75%,62%)"
                        : pal.sceneColor;
                ctx.fillStyle = fill;
                ctx.globalAlpha = alwaysScenes || isSel || isHov || isActive ? 1 : 0.85;
                ctx.beginPath();
                ctx.moveTo(x, cy - R);
                ctx.lineTo(x + R, cy);
                ctx.lineTo(x, cy + R);
                ctx.lineTo(x - R, cy);
                ctx.closePath();
                ctx.fill();
                // Always-on hairline border (matches ThinTimeline)
                ctx.strokeStyle = isActive ? th.sceneCutActiveBd : th.sceneCutBd;
                ctx.lineWidth = 1;
                ctx.stroke();
                // Selected ring — light blue outer ring on top of the bd
                if (isSel) {
                    ctx.strokeStyle = "hsl(195,100%,75%)";
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(x, cy - R - 1.5);
                    ctx.lineTo(x + R + 1.5, cy);
                    ctx.lineTo(x, cy + R + 1.5);
                    ctx.lineTo(x - R - 1.5, cy);
                    ctx.closePath();
                    ctx.stroke();
                }
                ctx.globalAlpha = 1;
                const hitR = Math.ceil(R + 2);
                addHit(x - hitR, tr.y, hitR * 2, tr.h, { kind: "scene", time: t });
            }
        }
        layerScenes();

        // ── Scene thumbnails ─────────────────────────────────
        function layerSceneThumbnails() {
            const tr = byId("scene-thumbs");
            if (!tr) return;
            if (videoFps <= 0 || p.scenes.length === 0) return;
            const thumbW = Math.round(tr.h * videoAspect);
            const slots = visibleSceneThumbs(p.scenes, (t) => Math.round(tX(t)), thumbW, W);
            const cache = thumbImageCacheRef.current;
            const drawNow = drawRef.current;
            for (const slot of slots) {
                const frame = Math.round(slot.time * videoFps);
                const path = thumbPaths[frame];
                const cached = cache.get(frame);
                const ready = cached && cached.complete && cached.naturalWidth > 0;
                const clipped = slot.width < slot.naturalW;
                if (ready && cached) {
                    if (!clipped) {
                        ctx.drawImage(cached, slot.x, tr.y, slot.width, tr.h);
                    } else {
                        // Source-crop the left portion so the cut edge stays flush.
                        const srcW = Math.max(
                            1,
                            (cached.naturalWidth * slot.width) / slot.naturalW,
                        );
                        ctx.drawImage(
                            cached,
                            0,
                            0,
                            srcW,
                            cached.naturalHeight,
                            slot.x,
                            tr.y,
                            slot.width,
                            tr.h,
                        );
                    }
                } else {
                    // Placeholder
                    ctx.fillStyle = th.bg2;
                    ctx.fillRect(slot.x, tr.y, slot.width, tr.h);
                    ctx.strokeStyle = th.border;
                    ctx.lineWidth = 1;
                    ctx.strokeRect(slot.x + 0.5, tr.y + 0.5, slot.width - 1, tr.h - 1);
                    if (path && !cached) {
                        const img = new Image();
                        img.onload = () => drawNow();
                        img.src = convertFileSrc(path);
                        cache.set(frame, img);
                    }
                }
                if (clipped) {
                    // Right-edge fade so the user reads "more of this thumbnail
                    // is hidden by the next cut." Fade width caps at 12 px and
                    // never exceeds the slot itself.
                    const fadeW = Math.min(12, slot.width);
                    const gx = slot.x + slot.width - fadeW;
                    const grad = ctx.createLinearGradient(gx, 0, gx + fadeW, 0);
                    grad.addColorStop(0, "rgba(0,0,0,0)");
                    grad.addColorStop(1, "rgba(0,0,0,0.7)");
                    ctx.fillStyle = grad;
                    ctx.fillRect(gx, tr.y, fadeW, tr.h);
                    // 1px accent on the right edge in the scene-cut color so
                    // the clipped boundary is unmistakable.
                    ctx.fillStyle = th.sceneCut;
                    ctx.fillRect(slot.x + slot.width - 1, tr.y, 1, tr.h);
                }
                addHit(slot.x, tr.y, slot.width, tr.h, { kind: "scene-thumb", time: slot.time });
            }
        }
        layerSceneThumbnails();

        // ── Clip regions (helper) ─────────────────────────────
        function drawRegions(
            tr: LayoutTrack | undefined,
            regions: RegionBlock[],
            isOutput: boolean,
            draggable = true,
        ) {
            if (!tr) return;
            const lAdj = isOutput ? -18 : 0;
            // Per-space lasso set: clipout track checks lassoClipoutIds; clipin track checks lassoClipinIds.
            const lassoClipIds = isOutput ? lassoClipoutIds : lassoClipinIds;
            // Active region is sorted last so its edge hits are added last and
            // win the reverse-scan in hitAt when two boundaries coincide.
            const sorted = [...regions].sort((a, b) => {
                if (a.active !== b.active) return a.active ? 1 : -1;
                return a.inPoint - b.inPoint;
            });
            for (const r of sorted) {
                const x1 = tX(r.inPoint),
                    x2 = tX(r.outPoint);
                if (x2 < 0 || x1 > W) continue;
                const cx1 = Math.max(x1, 0),
                    cx2 = Math.min(x2, W),
                    cw = cx2 - cx1;
                const isHov = gestHoverRegionId === r.id;
                const isLassoSel = lassoClipIds?.has(r.id) ?? false;
                const isSel = r.selected || r.active || isLassoSel;

                ctx.fillStyle = clipHsl(
                    r.colorIndex ?? 0,
                    isHov ? 0.45 : isSel ? 0.38 : 0.32,
                    lAdj,
                );
                ctx.fillRect(cx1, tr.y + 2, cw, tr.h - 4);
                const isActive = r.active && !isOutput;
                ctx.strokeStyle = clipHsl(r.colorIndex ?? 0, isSel ? 1 : isHov ? 1 : 0.95, lAdj);
                ctx.lineWidth = isActive ? 2.5 : isSel ? 1.5 : 1;
                const offLeft = x1 < 0;
                const offRight = x2 > W;
                const bx1 = cx1 + 0.5,
                    bx2 = cx2 - 0.5;
                const by1 = tr.y + 2.5,
                    by2 = tr.y + tr.h - 2.5;
                ctx.beginPath();
                ctx.moveTo(bx1, by1);
                ctx.lineTo(bx2, by1);
                ctx.moveTo(bx1, by2);
                ctx.lineTo(bx2, by2);
                if (!offLeft) {
                    ctx.moveTo(bx1, by1);
                    ctx.lineTo(bx1, by2);
                }
                if (!offRight) {
                    ctx.moveTo(bx2, by1);
                    ctx.lineTo(bx2, by2);
                }
                ctx.stroke();
                if (offLeft || offRight) {
                    const lw = ctx.lineWidth;
                    ctx.setLineDash([3, 4]);
                    ctx.beginPath();
                    if (offLeft) {
                        ctx.moveTo(bx1 + lw / 2, by1);
                        ctx.lineTo(bx1 + lw / 2, by2);
                    }
                    if (offRight) {
                        ctx.moveTo(bx2 - lw / 2, by1);
                        ctx.lineTo(bx2 - lw / 2, by2);
                    }
                    ctx.stroke();
                    ctx.setLineDash([]);
                }

                if (r.selected || isLassoSel) {
                    ctx.strokeStyle = `rgba(${th.fg1Rgb},0.7)`;
                    ctx.lineWidth = 1;
                    ctx.strokeRect(cx1 - 1.5, tr.y + 0.5, cw + 3, tr.h - 1);
                }

                if (cw > 20 && r.label && !isOutput) {
                    ctx.fillStyle = pal.fg1;
                    ctx.globalAlpha = 0.9;
                    setFont(10, true);
                    ctx.textAlign = "left";
                    ctx.textBaseline = "middle";
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(cx1 + 1, tr.y + 2, cw - 2, tr.h - 4);
                    ctx.clip();
                    ctx.fillText(r.label, cx1 + 5, tr.y + tr.h / 2);
                    ctx.restore();
                    ctx.globalAlpha = 1;
                }

                if (draggable) {
                    // Body hit registered FIRST so edges (added below) win at overlap.
                    addHit(cx1, tr.y, cw, tr.h, { kind: "region", id: r.id, isOutput });
                    const edgeHov = hoverRegionEdge.current;
                    const hovIn = edgeHov?.id === r.id && edgeHov.edge === "in";
                    const hovOut = edgeHov?.id === r.id && edgeHov.edge === "out";
                    if (x1 >= -2) {
                        if (hovIn) {
                            ctx.fillStyle = clipHsl(r.colorIndex ?? 0, 1, lAdj + 25);
                            ctx.fillRect(x1, tr.y + 2, 3, tr.h - 4);
                        }
                        addHit(x1 - 5, tr.y, 10, tr.h, {
                            kind: "region-edge",
                            id: r.id,
                            edge: "in",
                            isOutput,
                        });
                    }
                    if (x2 <= W + 2) {
                        if (hovOut) {
                            ctx.fillStyle = clipHsl(r.colorIndex ?? 0, 1, lAdj + 25);
                            ctx.fillRect(x2 - 3, tr.y + 2, 3, tr.h - 4);
                        }
                        addHit(x2 - 5, tr.y, 10, tr.h, {
                            kind: "region-edge",
                            id: r.id,
                            edge: "out",
                            isOutput,
                        });
                    }
                }
            }
        }

        drawRegions(byId("clipin"), regions, false);
        drawRegions(byId("clipout"), regionsOutput ?? regions, true);

        // ── Through-lines ────────────────────────────────────
        function layerThroughLines() {
            const inp = spaceRange("input");
            const out = spaceRange("output");
            const warp = byId("warp");
            ctx.setLineDash([2, 2]);
            ctx.lineWidth = 1;

            for (const pair of anchorPairs) {
                const hov = gestHoverAnchorId === pair.id;
                // Through-line is highlighted when EITHER space has this id selected/lassoed.
                const origSel =
                    p.selectedOrigAnchorIds.has(pair.id) ||
                    (lassoOrigAnchorIds?.has(pair.id) ?? false);
                const beatSel =
                    p.selectedBeatAnchorIds.has(pair.id) ||
                    (lassoBeatAnchorIds?.has(pair.id) ?? false);
                const sel = origSel || beatSel;
                if (!hov && !sel && !alwaysAnchors) continue;
                ctx.strokeStyle = hov
                    ? pal.throughHover
                    : sel
                      ? "hsla(195,85%,75%,0.7)"
                      : pal.throughLine;

                const inX = tX(pair.inT),
                    outX = tX(pair.outT);
                if (inp && inX >= 0 && inX <= W) {
                    ctx.beginPath();
                    ctx.moveTo(inX + 0.5, inp.top);
                    ctx.lineTo(inX + 0.5, inp.bottom);
                    ctx.stroke();
                }
                if (warp) {
                    ctx.beginPath();
                    ctx.moveTo(inX + 0.5, warp.y);
                    ctx.lineTo(outX + 0.5, warp.y + warp.h);
                    ctx.stroke();
                }
                if (out && outX >= 0 && outX <= W) {
                    ctx.beginPath();
                    ctx.moveTo(outX + 0.5, out.top);
                    ctx.lineTo(outX + 0.5, out.bottom);
                    ctx.stroke();
                }
            }

            if (alwaysRegions) {
                for (const r of p.regions) {
                    ctx.strokeStyle = clipHsl(r.colorIndex ?? 0, 0.5);
                    for (const inT of [r.inPoint, r.outPoint]) {
                        const inX = tX(inT);
                        const outT = inputToOutput(inT);
                        const outX = tX(outT);
                        if (inp && inX >= 0 && inX <= W) {
                            ctx.beginPath();
                            ctx.moveTo(inX + 0.5, inp.top);
                            ctx.lineTo(inX + 0.5, inp.bottom);
                            ctx.stroke();
                        }
                        if (warp) {
                            ctx.beginPath();
                            ctx.moveTo(inX + 0.5, warp.y);
                            ctx.lineTo(outX + 0.5, warp.y + warp.h);
                            ctx.stroke();
                        }
                        if (out && outX >= 0 && outX <= W) {
                            ctx.beginPath();
                            ctx.moveTo(outX + 0.5, out.top);
                            ctx.lineTo(outX + 0.5, out.bottom);
                            ctx.stroke();
                        }
                    }
                }
            }

            if (
                alwaysScenes ||
                (p.selectedSceneTimes && p.selectedSceneTimes.size > 0) ||
                (lassoSceneTimes?.size ?? 0) > 0
            ) {
                if (inp) {
                    for (const t of p.scenes) {
                        const isSel =
                            (p.selectedSceneTimes?.has(t) ?? false) ||
                            (lassoSceneTimes?.has(t) ?? false);
                        if (!alwaysScenes && !isSel) continue;
                        const x = tX(t);
                        if (x < 0 || x > W) continue;
                        const isUser = p.userSceneTimes?.has(t) ?? false;
                        ctx.strokeStyle = isUser
                            ? "hsla(195,75%,62%,0.6)"
                            : `hsla(48,95%,62%,${isSel ? "0.75" : "0.45"})`;
                        ctx.beginPath();
                        ctx.moveTo(x + 0.5, inp.top);
                        ctx.lineTo(x + 0.5, inp.bottom);
                        ctx.stroke();
                    }
                }
            }

            ctx.setLineDash([]);
        }
        layerThroughLines();

        // ── Region envelopes (markerin → warp → markerout as one shape) ──
        function layerRegionEnvelopes() {
            const trMIn = byId("markerin");
            const trMOut = byId("markerout");
            const trWarp = byId("warp");
            if (!trMIn) return;
            const rOut = regionsOutput ?? regions;
            const n = Math.min(regions.length, rOut.length);
            for (let ri = 0; ri < n; ri++) {
                const rIn = regions[ri],
                    rO = rOut[ri];
                const x0 = tX(rIn.inPoint),
                    x1 = tX(rIn.outPoint);
                const x3 = tX(rO.inPoint),
                    x2 = tX(rO.outPoint);
                if (Math.max(x1, x2) < 0 || Math.min(x0, x3) > W) continue;
                const cIdx = rIn.colorIndex ?? 0;

                // Single-polygon fill spanning all three rows
                const topY = trMIn.y;
                const botY = trMOut
                    ? trMOut.y + trMOut.h
                    : trWarp
                      ? trWarp.y + trWarp.h
                      : trMIn.y + trMIn.h;
                const warpTopY = trWarp ? trWarp.y : trMIn.y + trMIn.h;
                const warpBotY = trWarp ? trWarp.y + trWarp.h : warpTopY;
                ctx.fillStyle = clipHsl(cIdx, 0.12);
                ctx.beginPath();
                ctx.moveTo(x0, topY);
                ctx.lineTo(x1, topY);
                ctx.lineTo(x1, warpTopY);
                ctx.lineTo(x2, warpBotY);
                ctx.lineTo(x2, botY);
                ctx.lineTo(x3, botY);
                ctx.lineTo(x3, warpBotY);
                ctx.lineTo(x0, warpTopY);
                ctx.closePath();
                ctx.fill();

                // Continuous outline (left side, then right side)
                ctx.strokeStyle = clipHsl(cIdx, 0.6);
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x0 + 0.5, topY);
                ctx.lineTo(x0 + 0.5, warpTopY);
                if (trWarp) ctx.lineTo(x3 + 0.5, warpBotY);
                if (trMOut) ctx.lineTo(x3 + 0.5, botY);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(x1 - 0.5, topY);
                ctx.lineTo(x1 - 0.5, warpTopY);
                if (trWarp) ctx.lineTo(x2 - 0.5, warpBotY);
                if (trMOut) ctx.lineTo(x2 - 0.5, botY);
                ctx.stroke();
            }
        }
        layerRegionEnvelopes();

        // ── Warp zone (anchor diagonals only — region fills are above) ───
        function layerWarpZone() {
            const tr = byId("warp");
            if (!tr) return;
            const inY = tr.y,
                outY = tr.y + tr.h;
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, inY, W, tr.h);
            ctx.clip();

            for (const pair of anchorPairs) {
                const hov = gestHoverWarpLineId === pair.id;
                ctx.strokeStyle = hov ? pal.markerHover : th.spaceWarp;
                ctx.lineWidth = hov ? 2 : 1;
                const ix = tX(pair.inT),
                    ox = tX(pair.outT);
                ctx.beginPath();
                ctx.moveTo(ix + 0.5, inY);
                ctx.lineTo(ox + 0.5, outY);
                ctx.stroke();
                // Hit zone covers the line's bounding box (with a few px of padding)
                // across the full warp row. Pairs that overlap resolve via topmost-
                // wins in hitAt — acceptable since the user can only meaningfully
                // grab one warp line at a time.
                const HIT_PAD = 4;
                const hx = Math.min(ix, ox) - HIT_PAD;
                const hw = Math.abs(ox - ix) + HIT_PAD * 2;
                addHit(hx, tr.y, hw, tr.h, { kind: "warp-line", id: pair.id });
            }

            ctx.restore();
            ctx.fillStyle = th.border;
            ctx.fillRect(0, inY - 1, W, 1);
            ctx.fillRect(0, outY, W, 1);
        }
        layerWarpZone();

        // ── Snap highlights (gesture store, during drag) ──────
        function layerSnapHighlights() {
            const inp = spaceRange("input");
            const out = spaceRange("output");
            const SNAP_EPS = 1e-6;
            const activeIn = gestDragTime?.space === "input" ? gestDragTime.time : null;
            const activeOut = gestDragTime?.space === "output" ? gestDragTime.time : null;

            function drawSnapHint(
                t: number,
                range: { top: number; bottom: number } | null,
                isActive: boolean,
            ) {
                if (!range) return;
                const x = Math.round(tX(t)) + 0.5;
                if (x < 0 || x > W) return;
                ctx.strokeStyle = isActive ? th.snapActive : th.snapColor;
                ctx.globalAlpha = isActive ? 0.95 : 0.6;
                ctx.lineWidth = isActive ? 1.5 : 1;
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                ctx.moveTo(x, range.top);
                ctx.lineTo(x, range.bottom);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.globalAlpha = 1;
            }

            for (const t of snapHintsIn) {
                const isActive = activeIn !== null && Math.abs(activeIn - t) < SNAP_EPS;
                drawSnapHint(t, inp, isActive);
            }
            for (const t of snapHintsOut) {
                const isActive = activeOut !== null && Math.abs(activeOut - t) < SNAP_EPS;
                drawSnapHint(t, out, isActive);
            }
        }
        layerSnapHighlights();

        // ── Anchor markers ───────────────────────────────────
        function drawAnchorIn(x: number, tr: LayoutTrack, hov: boolean, sel: boolean) {
            if (x < -TRI_HALF - 2 || x > W + TRI_HALF + 2) return;
            const anchorCol = hov ? pal.markerHover : sel ? "hsl(195,85%,78%)" : pal.markerColor;
            ctx.strokeStyle = anchorCol;
            ctx.lineWidth = hov ? 2 : 1.5;
            const apexY = tr.y + TRI_H;
            ctx.beginPath();
            ctx.moveTo(x - TRI_HALF, tr.y);
            ctx.lineTo(x + TRI_HALF, tr.y);
            ctx.lineTo(x, apexY);
            ctx.closePath();
            ctx.fillStyle = sel && !hov ? "hsla(195,85%,70%,0.35)" : anchorCol;
            ctx.fill();
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x, apexY);
            ctx.lineTo(x, tr.y + tr.h - 1);
            ctx.stroke();
        }
        function drawAnchorOut(
            x: number,
            tr: LayoutTrack,
            hov: boolean,
            linked: boolean,
            sel = false,
        ) {
            if (x < -TRI_HALF - 2 || x > W + TRI_HALF + 2) return;
            const anchorCol = hov ? pal.markerHover : sel ? "hsl(195,85%,78%)" : pal.markerColor;
            ctx.strokeStyle = anchorCol;
            ctx.lineWidth = hov ? 2 : 1.5;
            const apexY = tr.y + tr.h - TRI_H;
            ctx.beginPath();
            ctx.moveTo(x - TRI_HALF, tr.y + tr.h);
            ctx.lineTo(x + TRI_HALF, tr.y + tr.h);
            ctx.lineTo(x, apexY);
            ctx.closePath();
            if (linked) {
                ctx.fillStyle = sel && !hov ? "hsla(195,85%,70%,0.35)" : anchorCol;
                ctx.fill();
            } else {
                ctx.globalAlpha = 0.55;
                ctx.stroke();
                ctx.globalAlpha = 1;
            }
            if (linked) ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x, tr.y + 1);
            ctx.lineTo(x, apexY);
            ctx.stroke();
        }

        function layerAnchorMarkers() {
            const trIn = byId("markerin");
            const trOut = byId("markerout");

            if (trIn) {
                for (const a of anchors) {
                    const x = tX(a.time);
                    const hov = gestHoverAnchorId === a.id;
                    // Highlight the input anchor only when it's selected in orig space.
                    const sel =
                        p.selectedOrigAnchorIds.has(a.id) ||
                        (lassoOrigAnchorIds?.has(a.id) ?? false);
                    drawAnchorIn(x, trIn, hov, sel);
                    addHit(x - TRI_HALF - 2, trIn.y, (TRI_HALF + 2) * 2, trIn.h, {
                        kind: "anchor",
                        id: a.id,
                        space: "input",
                    });
                }
            }
            if (trOut) {
                for (const a of beatAnchors) {
                    const x = tX(a.time);
                    const hov = gestHoverAnchorId === a.id;
                    const linked = !p.linkedBeatIds || p.linkedBeatIds.has(a.id);
                    // Highlight the beat anchor only when it's selected in beat space.
                    const selBeat =
                        p.selectedBeatAnchorIds.has(a.id) ||
                        (lassoBeatAnchorIds?.has(a.id) ?? false);
                    drawAnchorOut(x, trOut, hov, linked, selBeat);
                    addHit(x - TRI_HALF - 2, trOut.y, (TRI_HALF + 2) * 2, trOut.h, {
                        kind: "anchor",
                        id: a.id,
                        space: "output",
                    });
                }
            }
        }
        layerAnchorMarkers();

        // ── Beat ruler ───────────────────────────────────────
        function layerBeatRuler() {
            const tr = byId("beat");
            if (!tr) return;
            const pps = W / (view.end - view.start);
            const ppb = pps * beatSec;
            const bpb = 4;
            for (const layer of barsLayers(ppb, bpb)) {
                const su = layer.spacingUnit;
                const vStartB = (view.start - beatOffset) / beatSec;
                const vEndB = (view.end - beatOffset) / beatSec;
                const firstIdx = Math.floor(vStartB / su) - 1;
                const lastIdx = Math.ceil(vEndB / su) + 1;
                const tkClr =
                    layer.styleKey === "bar"
                        ? pal.barTick
                        : layer.styleKey === "beat"
                          ? pal.beatTick
                          : pal.subTick;
                const gdClr =
                    layer.styleKey === "bar"
                        ? pal.gridBar
                        : layer.styleKey === "beat"
                          ? pal.gridBeat
                          : "rgba(0,0,0,0)";
                const tickTop = layer.isMajor ? tr.y + 2 : tr.y + tr.h - (layer.tickHeight ?? 6);

                const outRange = spaceRange("output");
                const beatTr = byId("beat");
                const trWarp = byId("warp");
                const outTop = (outRange?.top ?? tr.y) - (trWarp ? trWarp.h / 2 : 0);
                const outBot = beatTr ? beatTr.y + beatTr.h : (outRange?.bottom ?? tr.y + tr.h);
                ctx.strokeStyle = gdClr;
                ctx.lineWidth = 1;
                ctx.beginPath();
                for (let i = firstIdx; i <= lastIdx; i++) {
                    if (layer.skipModulo && i % layer.skipModulo === 0) continue;
                    const bv = i * su;
                    const t = beatOffset + bv * beatSec;
                    if (t < -1e-6 || t > p.outputDuration + 1e-6) continue;
                    const x = Math.round(tX(t)) + 0.5;
                    if (x < 0 || x > W) continue;
                    ctx.moveTo(x, outTop);
                    ctx.lineTo(x, outBot);
                }
                ctx.stroke();

                ctx.strokeStyle = tkClr;
                ctx.lineWidth = layer.isMajor ? 1.5 : 1;
                ctx.beginPath();
                for (let i = firstIdx; i <= lastIdx; i++) {
                    if (layer.skipModulo && i % layer.skipModulo === 0) continue;
                    const bv = i * su;
                    const t = beatOffset + bv * beatSec;
                    if (t < -1e-6 || t > p.outputDuration + 1e-6) continue;
                    const x = Math.round(tX(t)) + 0.5;
                    if (x < 0 || x > W) continue;
                    ctx.moveTo(x, tickTop);
                    ctx.lineTo(x, tr.y + tr.h - 1);
                }
                ctx.stroke();

                if (layer.label) {
                    const isMaj = layer.labelStyle === "major";
                    ctx.fillStyle = isMaj ? pal.fg1 : pal.fg3;
                    setFont(isMaj ? 10 : 9, isMaj);
                    ctx.textAlign = "left";
                    ctx.textBaseline = "top";
                    for (let i = firstIdx; i <= lastIdx; i++) {
                        if (layer.skipModulo && i % layer.skipModulo === 0) continue;
                        const bv = i * su;
                        const t = beatOffset + bv * beatSec;
                        if (t < -1e-6 || t > p.outputDuration + 1e-6) continue;
                        const x = Math.round(tX(t));
                        if (x < 0 || x > W) continue;
                        const text = layer.label(bv);
                        if (text == null) continue;
                        ctx.fillText(text, x + 3, tr.y + (isMaj ? 2 : 5));
                    }
                }
            }
        }
        layerBeatRuler();

        // ── Speed strip ──────────────────────────────────────
        function layerSpeedStrip() {
            const tr = byId("speed");
            if (!tr) return;
            // Build a unified marker list: real anchor pairs + virtual boundary
            // markers for the active region's effective edges. This eliminates the
            // separate leading/trailing path and gives uniform handling for every
            // segment between two markers (real or boundary-virtual).
            const clipIn = p.clipIn;
            const clipOut = p.clipOut;
            const beatIn = p.beatClipIn;
            const beatOut = p.beatClipOut;
            const hasActiveRegion =
                clipIn !== undefined &&
                clipOut !== undefined &&
                beatIn !== undefined &&
                beatOut !== undefined &&
                clipOut > clipIn + 1e-6 &&
                beatOut > beatIn + 1e-6;
            const boundaryMarkers = hasActiveRegion
                ? [
                      { id: -1001, inT: clipIn!, outT: beatIn! },
                      { id: -1002, inT: clipOut!, outT: beatOut! },
                  ]
                : [];
            // Filter to markers within the active region's input range (or all
            // when there is no active region), then sort by input time.
            const allMarkers = hasActiveRegion
                ? [...anchorPairs, ...boundaryMarkers]
                      .filter((ap) => ap.inT >= clipIn! - 1e-6 && ap.inT <= clipOut! + 1e-6)
                      .sort((a, b) => a.inT - b.inT)
                : [...anchorPairs];

            for (let i = 0; i < allMarkers.length - 1; i++) {
                const inSpan = allMarkers[i + 1].inT - allMarkers[i].inT;
                const outSpan = allMarkers[i + 1].outT - allMarkers[i].outT;
                if (inSpan <= 0 || outSpan <= 0) continue;
                // speed = inputSpan / beatSpan: >1 means faster, <1 means slower.
                const speed = inSpan / outSpan;
                const x1 = tX(allMarkers[i].outT);
                const x2 = tX(allMarkers[i + 1].outT);
                const cx1 = Math.max(x1, 0),
                    cx2 = Math.min(x2, W);
                if (cx2 <= cx1) continue;
                // Symmetric deviation: 0 at 1×, 1 at 2× or 0.5×.
                // ±10% (dev ≤ 0.1) is a deadband — no color.
                // Above that, ramp linearly to 0.5 opacity by 2× / 0.5×.
                const dev = speed >= 1 ? speed - 1 : 1 / speed - 1;
                const a = dev <= 0.1 ? 0 : Math.min(0.5, (0.5 * (dev - 0.1)) / 0.9);
                if (a > 0) {
                    ctx.fillStyle = speed < 1 ? `rgba(96,165,250,${a})` : `rgba(239,68,68,${a})`;
                    ctx.fillRect(cx1 + 1, tr.y + 3, cx2 - cx1 - 2, tr.h - 6);
                }
                if (cx2 - cx1 > 28) {
                    ctx.fillStyle = pal.fg3;
                    setFont(9, false);
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(`${speed.toFixed(2)}×`, (cx1 + cx2) / 2, tr.y + tr.h / 2);
                }
            }
        }
        layerSpeedStrip();

        // ── Playhead ─────────────────────────────────────────
        function layerPlayhead() {
            const inp = spaceRange("input");
            const out = spaceRange("output");
            const warp = byId("warp");
            const timeTr = byId("time");

            const inPx = tX(p.playhead ?? 0);
            const outPx = tX(p.beatPlayhead ?? p.playhead ?? 0);

            function vline(x: number, y1: number, y2: number, glow: boolean) {
                const px = Math.round(x) + 0.5;
                if (px < -2 || px > W + 2) return;
                if (glow) {
                    ctx.strokeStyle = pal.playheadGlow;
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.moveTo(px, y1);
                    ctx.lineTo(px, y2);
                    ctx.stroke();
                }
                ctx.strokeStyle = pal.playhead;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(px, y1);
                ctx.lineTo(px, y2);
                ctx.stroke();
            }

            if (inp) vline(inPx, inp.top, inp.bottom, true);
            if (warp) {
                ctx.strokeStyle = pal.playheadGlow;
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(inPx + 0.5, warp.y);
                ctx.lineTo(outPx + 0.5, warp.y + warp.h);
                ctx.stroke();
                ctx.strokeStyle = pal.playhead;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(inPx + 0.5, warp.y);
                ctx.lineTo(outPx + 0.5, warp.y + warp.h);
                ctx.stroke();
            }
            if (out) vline(outPx, out.top, out.bottom, true);

            if (timeTr && inPx >= 0 && inPx <= W) {
                const ax = Math.round(inPx);
                ctx.fillStyle = pal.playhead;
                ctx.beginPath();
                ctx.moveTo(ax - 5, timeTr.y);
                ctx.lineTo(ax + 6, timeTr.y);
                ctx.lineTo(ax + 0.5, timeTr.y + 8);
                ctx.closePath();
                ctx.fill();
            }
        }
        layerPlayhead();

        // ── Hover cursor ─────────────────────────────────────
        function layerHoverCursor() {
            if (hoverX.current === null) return;
            const bot = tracks.length
                ? tracks[tracks.length - 1].y + tracks[tracks.length - 1].h
                : H;
            ctx.strokeStyle = "rgba(226,219,210,0.08)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(hoverX.current + 0.5, MINIMAP_H + 1);
            ctx.lineTo(hoverX.current + 0.5, bot);
            ctx.stroke();
        }
        layerHoverCursor();

        // ── Lasso rect ───────────────────────────────────────
        function layerLassoRect() {
            const ld = dragState;
            if (!(ld?.kind === "lasso" && ld.active)) return;
            const lx = Math.min(ld.startX, ld.curX);
            const lw = Math.abs(ld.curX - ld.startX);
            const rawLoY = Math.min(ld.startY, ld.curY);
            const rawHiY = Math.max(ld.startY, ld.curY);
            const covT = tracks.filter((t) => t.y < rawHiY && t.y + t.h > rawLoY);
            const ly = covT.length > 0 ? covT[0].y : rawLoY;
            const lh =
                covT.length > 0
                    ? covT[covT.length - 1].y + covT[covT.length - 1].h - ly
                    : rawHiY - rawLoY;
            ctx.fillStyle = "rgba(100,180,255,0.14)";
            ctx.fillRect(lx, ly, lw, lh);
            ctx.strokeStyle = "rgba(100,180,255,0.75)";
            ctx.lineWidth = 1;
            ctx.beginPath();

            ctx.moveTo(lx + 0.5, ly);
            ctx.lineTo(lx + 0.5, ly + lh);

            ctx.moveTo(lx + lw - 0.5, ly);
            ctx.lineTo(lx + lw - 0.5, ly + lh);
            ctx.stroke();
        }
        layerLassoRect();

        ctx.restore(); // end canvas clip
    }

    const drawRef = useRef(draw);
    drawRef.current = draw;

    // Redraw whenever any visual input changes (view handled separately by lerp effect)
    useEffect(() => {
        drawRef.current();
    }, [
        tracks,
        props.playhead,
        props.beatPlayhead,
        props.anchors,
        props.beatAnchors,
        props.regions,
        props.regionsOutput,
        props.scenes,
        props.bpm,
        props.beatOffset,
        alwaysAnchors,
        alwaysRegions,
        alwaysScenes,
        snapHintsIn,
        snapHintsOut,
        gestDragTime,
        gestHoverAnchorId,
        gestHoverRegionId,
        gestHoverSceneTime,
        gestHoverWarpLineId,
        thumbPaths,
        videoFps,
        videoAspect,
    ]);

    // Evict thumbnail image cache entries whose frames are no longer in the
    // current scene set. Keeps the cache bounded by the visible scene count.
    useEffect(() => {
        if (videoFps <= 0) return;
        const active = new Set(props.scenes.map((t) => Math.round(t * videoFps)));
        const cache = thumbImageCacheRef.current;
        for (const frame of cache.keys()) {
            if (!active.has(frame)) cache.delete(frame);
        }
    }, [props.scenes, videoFps]);

    // View lerp — snap during active pan/minimap drag, animate otherwise
    useEffect(() => {
        const drag = controllerRef.current.getDragState();
        const isDraggingView = drag?.kind === "pan" || drag?.kind === "minimap";
        if (lerpedView.current === null || isDraggingView || props.smoothPan === false) {
            lerpedView.current = props.view;
            drawRef.current();
            return;
        }
        if (lerpRafRef.current) cancelAnimationFrame(lerpRafRef.current);
        const target = props.view;
        function step() {
            const cur = lerpedView.current!;
            const ns = cur.start + (target.start - cur.start) * 0.25;
            const ne = cur.end + (target.end - cur.end) * 0.25;
            const done = Math.abs(ns - target.start) < 1e-3 && Math.abs(ne - target.end) < 1e-3;
            lerpedView.current = done ? target : { start: ns, end: ne };
            drawRef.current();
            lerpRafRef.current = done ? null : requestAnimationFrame(step);
        }
        lerpRafRef.current = requestAnimationFrame(step);
    }, [props.view, props.smoothPan]);

    useEffect(
        () => () => {
            if (lerpRafRef.current) cancelAnimationFrame(lerpRafRef.current);
        },
        [],
    );

    // Resize observer — drives containerH which recomputes tracks
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ro = new ResizeObserver((entries) => {
            setContainerH(entries[0].contentRect.height);
        });
        ro.observe(canvas);
        return () => ro.disconnect();
    }, []);

    // ── INTERACTIONS ──────────────────────────────────────
    // Thin adapter layer over the pure controller. The wrapper is responsible
    // for: (a) producing a fresh `Snapshot` per event, (b) adapting React
    // events to the controller's `*EventLike` shapes, and (c) dispatching the
    // returned `Intent[]` to props / gesture store / cursor / redraw.

    function makeSnapshot(canvas: HTMLCanvasElement): Snapshot {
        const p = propsRef.current;
        const rect = canvas.getBoundingClientRect();
        return {
            view: p.view,
            duration: p.duration,
            outputDuration: p.outputDuration,
            maxDuration: p.maxDuration,
            anchors: p.anchors,
            beatAnchors: p.beatAnchors,
            linkedBeatIds: p.linkedBeatIds ?? EMPTY_LINKED_IDS,
            selectedOrigAnchorIds: p.selectedOrigAnchorIds,
            selectedBeatAnchorIds: p.selectedBeatAnchorIds,
            regions: p.regions,
            regionsOutput: p.regionsOutput,
            regionDetails: p.regionDetails ?? [],
            selectedClipinIds: p.selectedClipinIds ?? new Set(),
            selectedClipoutIds: p.selectedClipoutIds ?? new Set(),
            scenes: p.scenes,
            selectedSceneTimes: p.selectedSceneTimes ?? new Set(),
            segments: p.segments,
            bpm: p.bpm,
            beatOffset: p.beatOffset,
            snapInterval: p.snapInterval,
            snapOffset: p.snapOffset,
            clipLock: p.clipLock,
            clipLockedBeats: p.clipLockedBeats,
            clipAnchorLock: p.clipAnchorLock,
            followDrag,
            warpCollapsed: p.warpCollapsed ?? false,
            canvas: { width: rect.width, height: rect.height },
            tracks: tracksRef.current,
            hits: hitsBuilderRef.current.result(),
            playhead: p.playhead,
            constraintGraph: p.constraintGraph,
        };
    }

    function toPointerEvent(e: React.MouseEvent<HTMLCanvasElement>): PointerEventLike {
        const rect = canvasRef.current?.getBoundingClientRect() ?? {
            left: 0,
            top: 0,
            width: 1,
            height: 1,
        };
        return {
            clientX: e.clientX,
            clientY: e.clientY,
            button: e.button,
            shiftKey: e.shiftKey,
            ctrlKey: e.ctrlKey,
            metaKey: e.metaKey,
            altKey: e.altKey,
            canvasRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        };
    }

    function toWheelEvent(e: React.WheelEvent<HTMLCanvasElement>): WheelEventLike {
        const rect = canvasRef.current?.getBoundingClientRect() ?? {
            left: 0,
            top: 0,
            width: 1,
            height: 1,
        };
        return {
            clientX: e.clientX,
            clientY: e.clientY,
            button: e.button,
            shiftKey: e.shiftKey,
            ctrlKey: e.ctrlKey,
            metaKey: e.metaKey,
            altKey: e.altKey,
            deltaX: e.deltaX,
            deltaY: e.deltaY,
            canvasRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        };
    }

    function toKeyEvent(e: React.KeyboardEvent<HTMLDivElement> | KeyboardEvent): KeyEventLike {
        return {
            key: e.key,
            shiftKey: e.shiftKey,
            ctrlKey: e.ctrlKey,
            metaKey: e.metaKey,
            altKey: e.altKey,
        };
    }

    function applyIntents(intents: Intent[]) {
        const p = propsRef.current;
        // Replay-frame boundary: reset slice's regions/anchors to preDrag values
        // before processing this pointer event's intents. Required by the
        // replay-based drag model — without it, prior-frame constraint writes
        // (e.g., anchor-lock while alt was held) persist into the current frame.
        p.onBeginReplayFrame?.();
        for (const i of intents) {
            switch (i.kind) {
                case "seek":
                    p.onSeek?.(i.time);
                    break;
                case "seekBeat":
                    p.onSeekBeat?.(i.time);
                    break;
                case "viewChange":
                    p.onViewChange(i.view);
                    break;
                case "anchorsChanged":
                    p.onAnchorsChange?.(i.next);
                    break;
                case "beatAnchorsChanged":
                    p.onBeatAnchorsChange?.(i.next);
                    break;
                // Single-entity intents — route to constraint-graph dispatch.
                case "anchorEntityMove":
                    p.onAnchorEntityMove?.(i.entityId, i.time);
                    break;
                case "regionEntityMove":
                    p.onRegionEntityMove?.(i.id, i.delta, i.isOutput, i.altKey);
                    break;
                case "regionResize":
                    // Output-space resizes flow through the CLIP_EDGE_DRAG profile (drag/endDrag),
                    // not this intent — only input-space callers reach here.
                    if (!i.isOutput) p.onRegionResize?.(i.id, i.inPoint, i.outPoint);
                    break;
                case "regionMove":
                    // Same — output-space body drags flow through CLIP_BODY_DRAG.
                    if (!i.isOutput) p.onRegionMove?.(i.id, i.inPoint, i.outPoint, i.altKey);
                    break;
                case "anchorAdd":
                    p.onAnchorAdd?.(i.time);
                    break;
                case "anchorDelete":
                    p.onAnchorDelete?.(i.id);
                    break;
                case "beatAnchorDelete":
                    p.onBeatAnchorDelete?.(i.id);
                    break;
                case "anchorSelect":
                    p.onAnchorSelect?.(i.id, i.additive);
                    break;
                case "beatAnchorSelect":
                    p.onBeatAnchorSelect?.(i.id, i.additive);
                    break;
                case "anchorContextMenu":
                    p.onAnchorContextMenu?.(i.id, i.x, i.y);
                    break;
                case "beatAnchorContextMenu":
                    p.onBeatAnchorContextMenu?.(i.id, i.x, i.y);
                    break;
                case "sceneContextMenu":
                    p.onSceneContextMenu?.(i.time, i.x, i.y);
                    break;
                case "regionContextMenu":
                    p.onRegionContextMenu?.(i.id, i.x, i.y);
                    break;
                case "timelineContextMenu":
                    p.onTimelineContextMenu?.(i.time, i.x, i.y);
                    break;
                case "sceneAdd":
                    p.onSceneAdd?.(i.time);
                    break;
                case "sceneDelete":
                    p.onSceneDelete?.(i.time);
                    break;
                case "regionAdd":
                    p.onRegionAdd?.(i.time);
                    break;
                case "regionSelect":
                    p.onRegionSelect?.(i.id);
                    break;
                case "regionZoom":
                    p.onRegionZoom?.(i.id);
                    break;
                case "timelineDeselect":
                    p.onTimelineDeselect?.();
                    break;
                case "timelineDelete":
                    p.onTimelineDelete?.();
                    break;
                case "clipsSelectionChange":
                    p.onClipsSelectionChange?.(i.clipinIds, i.clipoutIds);
                    break;
                case "scenesSelectionChange":
                    p.onScenesSelectionChange?.(i.times);
                    break;
                case "connectorSelectionChange":
                    p.onConnectorSelectionChange?.(i.origIds, i.beatIds);
                    break;
                case "pubDragTime":
                    gesture.setDragTime(i.space, i.time);
                    break;
                case "pubSnapHints":
                    gesture.setSnapHints(i.space, i.times);
                    break;
                case "pubScrubTime":
                    gesture.setScrubTime(i.time);
                    break;
                case "pubLasso":
                    gesture.setLassoSelection(
                        i.clipinIds,
                        i.clipoutIds,
                        i.origAnchorIds,
                        i.beatAnchorIds,
                        i.sceneTimes,
                    );
                    break;
                case "pubClearGesture":
                    gesture.clearAll();
                    break;
                case "dragStart": {
                    dispatch(dragStart(snapshotPreDragState(store.getState())));
                    // Activate the region being dragged so it becomes the active clip.
                    // This applies to both clipin (region-edge/region-move, !isOutput) and
                    // clipout (region-edge/region-move, isOutput) drags.
                    const ds = controllerRef.current.getDragState();
                    if (ds && (ds.kind === "region-edge" || ds.kind === "region-move")) {
                        dispatch(setActiveRegionIdAction(ds.id));
                    }
                    break;
                }
                case "dragEnd":
                    dispatch(dragEnd());
                    break;
                case "dragCancel":
                    dispatch(cancelDrag());
                    break;
                // Profile-driven drag lifecycle: beginDrag → drag → endDrag dispatches
                // pure deltas through the constraint pipeline.
                case "beginDrag":
                    dispatch(beginDrag({ handle: i.handle, pxPerUnit: i.pxPerUnit, grid: i.grid }));
                    break;
                case "drag":
                    dispatch(drag({ delta: i.delta, modifiers: i.modifiers }));
                    break;
                case "endDrag":
                    dispatch(endDrag());
                    break;
                case "pubModifierKeys":
                    break;
                case "pubHoveredAnchor":
                    gesture.setHoveredAnchor(i.id);
                    break;
                case "pubHoveredRegion":
                    gesture.setHoveredRegion(i.id);
                    break;
                case "pubHoveredScene":
                    gesture.setHoveredScene(i.time);
                    break;
                case "pubHoveredWarpLine":
                    gesture.setHoveredWarpLine(i.id);
                    break;
                case "thumbnailHover":
                    setThumbnailHover(i.payload);
                    break;
                case "cursor":
                    if (canvasRef.current) canvasRef.current.style.cursor = i.cursor;
                    break;
                case "redraw":
                    drawRef.current();
                    break;
            }
        }
    }

    function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
        const canvas = e.currentTarget;
        const snap = makeSnapshot(canvas);
        const intents = controllerRef.current.pointerDown(toPointerEvent(e), snap);
        applyIntents(intents);
    }

    function handleDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
        const canvas = e.currentTarget;
        const snap = makeSnapshot(canvas);
        const intents = controllerRef.current.doubleClick(toPointerEvent(e), snap);
        applyIntents(intents);
    }

    function handleContextMenu(e: React.MouseEvent<HTMLCanvasElement>) {
        e.preventDefault();
        const canvas = e.currentTarget;
        const snap = makeSnapshot(canvas);
        const intents = controllerRef.current.contextMenu(toPointerEvent(e), snap);
        applyIntents(intents);
    }

    function handleWheel(e: React.WheelEvent<HTMLCanvasElement>) {
        e.preventDefault();
        const canvas = e.currentTarget;
        const snap = makeSnapshot(canvas);
        const intents = controllerRef.current.wheel(toWheelEvent(e), snap);
        applyIntents(intents);
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
        const intents = controllerRef.current.keyDown(toKeyEvent(e));
        if (intents.length > 0) {
            applyIntents(intents);
            e.preventDefault();
        }
    }

    function handleGripMouseDown(aboveId: string, belowId: string, e: React.MouseEvent) {
        e.preventDefault();
        const above = tracksRef.current.find((t) => t.id === aboveId);
        const below = tracksRef.current.find((t) => t.id === belowId);
        if (!above || !below) return;
        rowResizeRef.current = {
            aboveId,
            belowId,
            startY: e.clientY,
            hAbove: above.h,
            hBelow: below.h,
        };
    }

    // Window mousemove / mouseup keep the gesture alive when the pointer
    // strays outside the canvas. Pointercancel/blur/Escape cancel the gesture
    // (clearing state without firing commits).
    useEffect(() => {
        function pointerEventLikeFromNative(e: MouseEvent): PointerEventLike {
            const rect = canvasRef.current?.getBoundingClientRect() ?? {
                left: 0,
                top: 0,
                width: 1,
                height: 1,
            };
            return {
                clientX: e.clientX,
                clientY: e.clientY,
                button: e.button,
                shiftKey: e.shiftKey,
                ctrlKey: e.ctrlKey,
                metaKey: e.metaKey,
                altKey: e.altKey,
                canvasRect: {
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height,
                },
            };
        }

        function onMouseMove(e: MouseEvent) {
            // Row resize takes precedence — it's a separate, non-canvas drag.
            if (rowResizeRef.current) {
                const { aboveId, belowId, startY, hAbove, hBelow } = rowResizeRef.current;
                const hSum = hAbove + hBelow;
                const MIN_PX = 14;
                const dy = e.clientY - startY;
                const newAbove = Math.max(MIN_PX, Math.min(hSum - MIN_PX, hAbove + dy));
                const newBelow = hSum - newAbove;
                setRowOverrides((prev) => ({ ...prev, [aboveId]: newAbove, [belowId]: newBelow }));
                return;
            }
            const canvas = canvasRef.current;
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            hoverX.current = e.clientX - rect.left;

            // Track-row hover (used by the rail to highlight the row label).
            const my = e.clientY - rect.top;
            const trUnder = tracksRef.current.find((t) => my >= t.y && my < t.y + t.h);
            const newTrackHov = trUnder?.id ?? null;
            if (newTrackHov !== hoverTrackId) setHoverTrackId(newTrackHov);

            // Edge hover (draw-only — controller doesn't publish edge info).
            const mx = e.clientX - rect.left;
            const hit = hitAt(mx, my) as Record<string, unknown> | null;
            const newEdgeHov =
                hit?.kind === "region-edge"
                    ? { id: hit.id as string, edge: hit.edge as "in" | "out" }
                    : null;
            const prev = hoverRegionEdge.current;
            const edgeChanged = prev?.id !== newEdgeHov?.id || prev?.edge !== newEdgeHov?.edge;
            if (edgeChanged) hoverRegionEdge.current = newEdgeHov;

            const snap = makeSnapshot(canvas);
            const intents = controllerRef.current.pointerMove(pointerEventLikeFromNative(e), snap);
            applyIntents(intents);
        }

        function onMouseUp() {
            rowResizeRef.current = null;
            const canvas = canvasRef.current;
            if (!canvas) return;
            const snap = makeSnapshot(canvas);
            const intents = controllerRef.current.pointerUp(snap);
            applyIntents(intents);
        }

        function onPointerCancelOrBlur() {
            const intents = controllerRef.current.cancel();
            applyIntents(intents);
        }

        function onKeyDownEscape(e: KeyboardEvent) {
            if (e.key === "Escape") {
                const intents = controllerRef.current.cancel();
                applyIntents(intents);
            }
        }

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
        window.addEventListener("pointercancel", onPointerCancelOrBlur);
        window.addEventListener("blur", onPointerCancelOrBlur);
        window.addEventListener("keydown", onKeyDownEscape);
        return () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
            window.removeEventListener("pointercancel", onPointerCancelOrBlur);
            window.removeEventListener("blur", onPointerCancelOrBlur);
            window.removeEventListener("keydown", onKeyDownEscape);
        };
        // applyIntents / makeSnapshot are stable closures over the current
        // render — re-registering window listeners on every change defeats
        // the point of the effect. hoverTrackId is the only thing that
        // semantically requires re-registration.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hoverTrackId]);

    const inpRange = (() => {
        const ts = tracks.filter((t) => t.space === "input");
        if (!ts.length) return null;
        return { top: ts[0].y, height: ts[ts.length - 1].y + ts[ts.length - 1].h - ts[0].y };
    })();
    const warpTrack = tracks.find((t) => t.id === "warp");
    const outRange = (() => {
        const ts = tracks.filter((t) => t.space === "output");
        if (!ts.length) return null;
        return { top: ts[0].y, height: ts[ts.length - 1].y + ts[ts.length - 1].h - ts[0].y };
    })();

    return (
        <div className="canvas-timeline" tabIndex={0} onKeyDown={handleKeyDown}>
            <div className="canvas-timeline__body">
                <div className="canvas-timeline__rail">
                    <div className="canvas-timeline__rail-minimap">OVERVIEW</div>
                    <div className="canvas-timeline__rail-sep" />
                    {tracks.map((tr, i) => (
                        <Fragment key={tr.id}>
                            <div
                                className={`canvas-timeline__rail-row${hoverTrackId === tr.id ? " canvas-timeline__rail-row--hover" : ""}`}
                                style={{ height: tr.h }}
                            >
                                {tr.label.toUpperCase()}
                            </div>
                            {i < tracks.length - 1 && (
                                <div
                                    className="canvas-timeline__rail-grip"
                                    onMouseDown={(e) =>
                                        handleGripMouseDown(tr.id, tracks[i + 1].id, e)
                                    }
                                />
                            )}
                        </Fragment>
                    ))}
                    {inpRange && (
                        <div
                            className="ct-accent ct-accent--input"
                            style={{ top: inpRange.top, height: inpRange.height }}
                        />
                    )}
                    {warpTrack && (
                        <div
                            className="ct-accent ct-accent--warp"
                            style={{ top: warpTrack.y, height: warpTrack.h }}
                        />
                    )}
                    {outRange && (
                        <div
                            className="ct-accent ct-accent--output"
                            style={{ top: outRange.top, height: outRange.height }}
                        />
                    )}
                </div>
                <canvas
                    ref={canvasRef}
                    className="canvas-timeline__canvas"
                    onMouseDown={handleMouseDown}
                    onDoubleClick={handleDoubleClick}
                    onContextMenu={handleContextMenu}
                    onWheel={handleWheel}
                    onMouseLeave={(e) => {
                        hoverX.current = null;
                        hoverRegionEdge.current = null;
                        // Clear gesture-store hover state so highlight visuals fade.
                        // Only do this when no drag is in flight — during a drag we want
                        // hover state to stick so the dragged element keeps its highlight.
                        if (!controllerRef.current.getDragState()) {
                            gesture.setHoveredAnchor(null);
                            gesture.setHoveredRegion(null);
                            gesture.setHoveredScene(null);
                        }
                        setHoverTrackId(null);
                        setThumbnailHover(null);
                        e.currentTarget.style.cursor = "";
                        drawRef.current();
                    }}
                />
            </div>
        </div>
    );
}

// CanvasTimelineToolbar has been extracted to ./CanvasTimelineToolbar.tsx
export type { CanvasTimelineToolbarProps } from "./CanvasTimelineToolbar";
export { CanvasTimelineToolbar } from "./CanvasTimelineToolbar";
