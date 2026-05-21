/**
 * Shared scene builder + gesture configuration for the constraint-pipeline
 * benchmarks. Used by both the vitest bench suite (regression gate) and the
 * standalone matrix-sweep script (exploratory perf investigation).
 *
 * Each scenario:
 *   1. Builds a fresh Redux store via makeStore().
 *   2. Populates N anchor pairs, N regions, N scene cuts using a seeded
 *      mulberry32 PRNG so positions are deterministic but scattered.
 *   3. Configures selection / lock state per gesture and returns the Handle
 *      to use with the production drag thunks (beginDrag / drag / endDrag).
 */

import { makeStore } from "../helpers/setup";
import { addAnchor, setSelectedBothIds } from "../../src/store/slices/warpSlice";
import { addRegion, setActiveRegionId } from "../../src/store/slices/regionSlice";
import { setListSelection } from "../../src/store/slices/listsSlice";
import { setVideo } from "../../src/store/slices/videoSlice";
import { setCuts } from "../../src/store/slices/sceneSlice";
import { setAnchorLock, setLockMode } from "../../src/store/slices/uiSlice";
import type { Handle } from "../../src/constraints/profiles/types";
import type { Region, VideoInfo } from "../../src/types";

export const ALL_GESTURES = [
    "anchor",
    "region-pan",
    "region-resize",
    "region-resize-lock",
    "group-pan",
] as const;

export type Gesture = (typeof ALL_GESTURES)[number];

export const DURATION = 600;
export const VIDEO_PATH = "/bench/synthetic.mp4";

export interface Scene {
    store: ReturnType<typeof makeStore>;
    anchorIds: number[];
    regionIds: string[];
    firstRegionId: string;
    wideRegionId: string;
}

/** mulberry32 — small, deterministic 32-bit PRNG. */
export function makeRng(seed: number): () => number {
    let s = seed >>> 0;
    return function () {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export interface SceneCounts {
    /** Number of region clip pairs (clipin + clipout). */
    regions: number;
    /** Number of anchor pairs (anchor-in / anchor-out). */
    anchors: number;
    /** Number of scene cuts — pure snap targets, never move. */
    scenes: number;
}

export function buildScene(nOrCounts: number | SceneCounts, seed: number): Scene {
    const counts: SceneCounts =
        typeof nOrCounts === "number"
            ? { regions: nOrCounts, anchors: nOrCounts, scenes: nOrCounts }
            : nOrCounts;
    const { regions: nR, anchors: nA, scenes: nS } = counts;
    const store = makeStore();
    const rng = makeRng(seed);

    const video: VideoInfo = {
        path: VIDEO_PATH,
        originalName: "synthetic.mp4",
        videoUrl: "tauri://localhost/bench/synthetic.mp4",
        duration: DURATION,
        fps: 30,
        fileHash: "bench",
    };
    store.dispatch(setVideo(video));

    const span = DURATION - 20;

    // Anchors — random scatter, sorted so the slice stays monotonic.
    const anchorTimes = Array.from({ length: nA }, () => 10 + rng() * span).sort((a, b) => a - b);
    const anchorIds: number[] = [];
    for (let i = 0; i < nA; i++) {
        const id = i + 1;
        store.dispatch(addAnchor({ id, time: anchorTimes[i] }));
        anchorIds.push(id);
    }

    // Regions — random center, fixed width, sorted by start.
    const regionWidth = Math.max(2, span / Math.max(4, nR));
    const regionCenters = Array.from({ length: nR }, () => 10 + rng() * span).sort(
        (a, b) => a - b,
    );
    const regionIds: string[] = [];
    let firstRegionId = "";
    for (let i = 0; i < nR; i++) {
        const id = `r${i + 1}`;
        const inPoint = Math.max(0, regionCenters[i] - regionWidth / 2);
        const outPoint = Math.min(DURATION, regionCenters[i] + regionWidth / 2);
        const region: Region = {
            id,
            name: id,
            inPoint,
            outPoint,
            bpm: 120,
            minStretch: 0.5,
            maxStretch: 2.0,
            inBeatTime: inPoint,
            outBeatTime: outPoint,
            defaultLinked: true,
            lockedBeats: 8,
        };
        store.dispatch(addRegion(region));
        regionIds.push(id);
        if (i === 0) firstRegionId = id;
    }

    // Wide region that contains many anchors — used by region-resize-lock so
    // the per-frame beat-anchor rescale has real work to do.
    const wideId = "rw";
    const wideOut = Math.min(DURATION, 10 + span * 0.8);
    store.dispatch(
        addRegion({
            id: wideId,
            name: wideId,
            inPoint: 10,
            outPoint: wideOut,
            bpm: 120,
            minStretch: 0.5,
            maxStretch: 2.0,
            inBeatTime: 10,
            outBeatTime: wideOut,
            defaultLinked: true,
            lockedBeats: 32,
        }),
    );
    regionIds.push(wideId);

    // Scenes — random cuts under the active video path so the pipeline picks
    // them up as snap targets via extractSliceForPipeline.
    const sceneTimes = Array.from({ length: nS }, () => rng() * DURATION).sort((a, b) => a - b);
    store.dispatch(setCuts({ path: VIDEO_PATH, cuts: sceneTimes }));

    return { store, anchorIds, regionIds, firstRegionId, wideRegionId: wideId };
}

export interface GestureConfig {
    handle: Handle;
    /** Peak |delta| during the drag, in time units (seconds). Picked per
     *  gesture so the zigzag stays inside the synthetic timeline. */
    amplitude: number;
}

export function configureForGesture(scene: Scene, gesture: Gesture): GestureConfig {
    switch (gesture) {
        case "anchor":
            return {
                handle: { kind: "anchor-drag", anchorId: scene.anchorIds[0], space: "input" },
                amplitude: 20,
            };
        case "region-pan":
            return {
                handle: { kind: "clip-body", clipId: scene.firstRegionId, space: "input" },
                amplitude: 15,
            };
        case "region-resize":
            return {
                handle: { kind: "clip-in-edge", clipId: scene.firstRegionId, space: "input" },
                amplitude: 5,
            };
        case "region-resize-lock":
            // anchorLock + lockMode='beats' + active region → resizing the
            // clipout edge rescales every beat anchor inside the region.
            scene.store.dispatch(setActiveRegionId(scene.wideRegionId));
            scene.store.dispatch(setAnchorLock(true));
            scene.store.dispatch(setLockMode("beats"));
            return {
                handle: { kind: "clip-out-edge", clipId: scene.wideRegionId, space: "beat" },
                amplitude: 30,
            };
        case "group-pan":
            // Select every anchor + region so the resolver installs a
            // lasso:main TranslateGroup over the whole scene. Body-panning
            // one region then translates the whole group on every frame.
            scene.store.dispatch(setSelectedBothIds(scene.anchorIds));
            scene.store.dispatch(setListSelection({ list: "clipin", ids: scene.regionIds }));
            scene.store.dispatch(setListSelection({ list: "clipout", ids: scene.regionIds }));
            return {
                handle: { kind: "clip-body", clipId: scene.firstRegionId, space: "input" },
                amplitude: 15,
            };
    }
}
