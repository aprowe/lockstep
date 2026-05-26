import { createListenerMiddleware, type Dispatch } from "@reduxjs/toolkit";
import type { RootState } from "../store";
import { setThumbnail, clearForHash } from "../slices/thumbnailsSlice";
import {
    listenThumbnailReady,
    setThumbnailWants,
    clearThumbnails,
} from "../../api/thumbnails";
import { ThumbnailReason, type HoverReason, ALL_REASONS, STEADY_REASONS } from "../../api/thumbnailReason";
import { dragEnd } from "../slices/dragSlice";
import { secondsToFrames } from "../../utils/time";
import { visibleSceneCuts } from "../../utils/sceneFilter";
import type { Anchor, Region } from "../../types";

export const thumbnailMiddleware = createListenerMiddleware();

/** Frames requested per filmstrip update. Wider than the 7 slots actually
 *  rendered (see Filmstrip.tsx SLOTS) so a small playhead step finds the
 *  next slot already cached instead of flashing a placeholder. */
const FILMSTRIP_WANT_FRAMES = 11;
const DEBOUNCE_MS = 100;

interface SourceSnapshot {
    fileHash: string | null;
    videoPath: string | null;
    fps: number;
    duration: number;
    playing: boolean;
    playhead: number;
    regions: readonly Region[];
    origAnchors: readonly Anchor[];
    rawScenes: number[] | undefined;
    userScenes: number[] | undefined;
    sceneMinGap: number;
    hoverBucket: Partial<Record<HoverReason, number>> | undefined;
    maxCachedFrames: number;
    thumbWidth: number;
}

let prev: SourceSnapshot | null = null;
let dirty = new Set<ThumbnailReason>();
let timer: ReturnType<typeof setTimeout> | null = null;
let lastSent: { fileHash: string | null; byReason: Partial<Record<ThumbnailReason, number[]>> } = {
    fileHash: null,
    byReason: {},
};
let started = false;
let unlistenReady: (() => void) | null = null;

export const __testing = {
    reset() {
        prev = null;
        dirty = new Set();
        if (timer) clearTimeout(timer);
        timer = null;
        lastSent = { fileHash: null, byReason: {} };
    },
};

export async function startThumbnailMiddleware(dispatch: Dispatch) {
    if (started) return;
    started = true;
    unlistenReady = await listenThumbnailReady((p) => {
        dispatch(setThumbnail({ fileHash: p.file_hash, frame: p.frame, path: p.path }));
    });
}

export function stopThumbnailMiddleware() {
    if (unlistenReady) unlistenReady();
    unlistenReady = null;
    started = false;
}

function snap(state: RootState): SourceSnapshot {
    const v = state.video.video;
    const path = v?.path;
    return {
        fileHash: v?.fileHash ?? null,
        videoPath: v?.path ?? null,
        fps: v?.fps ?? 0,
        duration: v?.duration ?? 0,
        playing: state.ui.playing,
        playhead: state.warp.playhead,
        regions: state.region.regions,
        origAnchors: state.warp.origAnchors,
        rawScenes: path ? state.scene.cutsByPath[path] : undefined,
        userScenes: path ? state.scene.userCutsByPath[path] : undefined,
        sceneMinGap: (path ? state.scene.minGapByPath[path] : undefined) ?? 2,
        hoverBucket: v?.fileHash ? state.thumbnails.hoverByHash[v.fileHash] : undefined,
        maxCachedFrames: state.settings.maxCachedFrames,
        thumbWidth: state.settings.thumbWidth,
    };
}

function diff(curr: SourceSnapshot, p: SourceSnapshot | null): Set<ThumbnailReason> {
    const d = new Set<ThumbnailReason>();
    if (!p) {
        for (const r of ALL_REASONS) d.add(r);
        return d;
    }
    if (curr.fileHash !== p.fileHash) {
        for (const r of ALL_REASONS) d.add(r);
        return d;
    }
    if (curr.playhead !== p.playhead || curr.fps !== p.fps || curr.duration !== p.duration ||
        curr.playing !== p.playing) {
        d.add(ThumbnailReason.Filmstrip);
    }
    if (curr.regions !== p.regions || curr.fps !== p.fps) d.add(ThumbnailReason.Clips);
    if (curr.origAnchors !== p.origAnchors || curr.fps !== p.fps) d.add(ThumbnailReason.Anchors);
    if (curr.rawScenes !== p.rawScenes || curr.userScenes !== p.userScenes ||
        curr.sceneMinGap !== p.sceneMinGap || curr.fps !== p.fps) {
        d.add(ThumbnailReason.Scenes);
    }
    if (curr.hoverBucket !== p.hoverBucket) {
        d.add(ThumbnailReason.ClipHover);
        d.add(ThumbnailReason.SceneHover);
        d.add(ThumbnailReason.AnchorHover);
    }
    return d;
}

function clamp(frame: number, maxFrame: number): number {
    return Math.max(0, Math.min(maxFrame, frame));
}

function derive(reason: ThumbnailReason, s: SourceSnapshot): number[] {
    if (s.fps <= 0 || s.duration <= 0) return [];
    const maxFrame = Math.max(0, Math.floor(s.duration * s.fps));
    switch (reason) {
        case ThumbnailReason.Filmstrip: {
            const center = clamp(secondsToFrames(s.playhead, s.fps), maxFrame);
            const half = Math.floor(FILMSTRIP_WANT_FRAMES / 2);
            const out: number[] = [];
            for (let i = -half; i <= half; i++) {
                const f = center + i;
                if (f >= 0 && f <= maxFrame) out.push(f);
            }
            return out;
        }
        case ThumbnailReason.Clips:
            return s.regions.map((r) => clamp(Math.floor(r.inPoint * s.fps), maxFrame));
        case ThumbnailReason.Anchors:
            return s.origAnchors.map((a) => clamp(Math.floor(a.time * s.fps), maxFrame));
        case ThumbnailReason.Scenes:
            return visibleSceneCuts(s.rawScenes ?? [], s.userScenes ?? [], s.sceneMinGap).map(
                (t) => clamp(Math.floor(t * s.fps), maxFrame),
            );
        case ThumbnailReason.ClipHover:
        case ThumbnailReason.SceneHover:
        case ThumbnailReason.AnchorHover: {
            const f = s.hoverBucket?.[reason];
            return f != null ? [clamp(f, maxFrame)] : [];
        }
    }
}

function arrEq(a: number[], b: number[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

function payloadEq(
    a: Partial<Record<ThumbnailReason, number[]>>,
    b: Partial<Record<ThumbnailReason, number[]>>,
): boolean {
    for (const r of ALL_REASONS) {
        if (!arrEq(a[r] ?? [], b[r] ?? [])) return false;
    }
    return true;
}

function flush(state: RootState) {
    timer = null;
    const s = snap(state);
    if (!s.fileHash || !s.videoPath) {
        dirty.clear();
        return;
    }
    const byReason: Partial<Record<ThumbnailReason, number[]>> = {};
    for (const r of ALL_REASONS) {
        byReason[r] = dirty.has(r) ? derive(r, s) : (lastSent.byReason[r] ?? derive(r, s));
    }
    dirty.clear();
    if (lastSent.fileHash === s.fileHash && payloadEq(byReason, lastSent.byReason)) return;
    lastSent = { fileHash: s.fileHash, byReason };
    setThumbnailWants({
        fileHash: s.fileHash,
        videoPath: s.videoPath,
        fps: s.fps,
        byReason,
        maxCachedFrames: s.maxCachedFrames,
        thumbWidth: s.thumbWidth,
    }).catch(() => {});
}

thumbnailMiddleware.startListening({
    predicate: () => true, // every dispatched action — we want fileHash / drag / setHover etc.
    effect: (action, api) => {
        const state = api.getState() as RootState;
        const curr = snap(state);
        // `clearForHash` is a slice action — dispatching it re-enters this
        // listener. Update `prev` BEFORE dispatching so the re-entry sees the
        // settled state and skips this branch instead of recursing forever.
        if (prev && prev.fileHash && prev.fileHash !== curr.fileHash) {
            const oldHash = prev.fileHash;
            prev = curr;
            lastSent = { fileHash: null, byReason: {} };
            api.dispatch(clearForHash(oldHash));
            clearThumbnails(oldHash).catch(() => {});
        }

        // Width change → wipe slice paths (backend purges its own cache on the
        // next set_thumbnail_wants when it sees the new thumb_width). Force the
        // next flush to send a complete payload. Same re-entry trap as above:
        // settle `prev` before dispatching.
        if (prev && curr.fileHash && curr.thumbWidth !== prev.thumbWidth) {
            const h = curr.fileHash;
            prev = curr;
            lastSent = { fileHash: null, byReason: {} };
            for (const r of ALL_REASONS) dirty.add(r);
            api.dispatch(clearForHash(h));
        }

        // Drag gate: while dragging, ignore everything except the dragEnd
        // trailing action. On dragEnd, mark all steady-state reasons dirty
        // so the final positions get sent in one shot.
        if (state.drag.active) {
            prev = curr;
            if (timer) { clearTimeout(timer); timer = null; }
            return;
        }
        if (dragEnd.match(action)) {
            for (const r of STEADY_REASONS) dirty.add(r);
            prev = curr;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => flush(api.getState() as RootState), DEBOUNCE_MS);
            return;
        }

        const d = diff(curr, prev);
        prev = curr;
        if (d.size === 0) return;
        for (const r of d) dirty.add(r);
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => flush(api.getState() as RootState), DEBOUNCE_MS);
    },
});
