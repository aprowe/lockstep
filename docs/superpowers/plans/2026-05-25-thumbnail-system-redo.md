# Thumbnail System Redo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the thumbnail system around a reusable `<Thumbnail />` component, a slimmed slice, and a middleware that derives per-reason wants from slice state and drives the IPC. Replace the multi-tier backend with a minimal LRU cache.

**Architecture:** Seven `ThumbnailReason` enum values (filmstrip, clips, clip-hover, scenes, scene-hover, anchors, anchor-hover) cross the IPC boundary as kebab-case strings. Middleware tracks an internal dirty Set<Reason> + lastSent cache; at debounce-fire it derives only dirty steady-state reasons from `warp` / `region` / `scene`, merges with hover state from the slice, deep-equals against lastSent, and sends one `set_thumbnail_wants` IPC. Drag.active suppresses all derivation, hover dispatches, and IPC until the trailing `dragEnd`. Backend is a single-worker FIFO with last-touch LRU eviction; wanted frames are eviction-protected.

**Tech Stack:** React + Redux Toolkit, Tauri v2 (Rust commands + events), Vitest, cargo test, ffmpeg CLI.

**Spec:** `docs/superpowers/specs/2026-05-25-thumbnail-system-redo-design.md`

---

## Pre-flight

- [ ] **Read the spec.** `docs/superpowers/specs/2026-05-25-thumbnail-system-redo-design.md`. The plan is a faithful execution of it. Where the plan is silent, the spec is authoritative.
- [ ] **Confirm a clean working tree.** `git status` should show nothing dirty. Branch off `main`: `git checkout -b thumbnails-redo`.
- [ ] **Note the pre-release rule (CLAUDE.md).** No migration shims, no `legacy` fields, no backwards-compat. Delete the old surface as you replace it.
- [ ] **Behavior coverage warning.** `spec/features/thumbnails.feature` will become stale. **Per project rule, do not edit anything in `spec/` unless explicitly asked.** At the end, surface a written list of stale scenarios for the user to update.

---

## Task 1: Add `ThumbnailReason` enum (frontend)

**Files:**
- Create: `src/api/thumbnailReason.ts`

- [ ] **Step 1: Create the enum**

```ts
// src/api/thumbnailReason.ts
/**
 * Reason a frame is being requested. Same kebab-case strings on the wire
 * (Rust mirror in src-tauri/src/thumbnails.rs uses serde rename_all).
 */
export enum ThumbnailReason {
    Filmstrip = "filmstrip",
    Clips = "clips",
    ClipHover = "clip-hover",
    Scenes = "scenes",
    SceneHover = "scene-hover",
    Anchors = "anchors",
    AnchorHover = "anchor-hover",
}

export type HoverReason =
    | ThumbnailReason.ClipHover
    | ThumbnailReason.SceneHover
    | ThumbnailReason.AnchorHover;

export const ALL_REASONS: readonly ThumbnailReason[] = [
    ThumbnailReason.Filmstrip,
    ThumbnailReason.Clips,
    ThumbnailReason.ClipHover,
    ThumbnailReason.Scenes,
    ThumbnailReason.SceneHover,
    ThumbnailReason.Anchors,
    ThumbnailReason.AnchorHover,
];

export const STEADY_REASONS: readonly ThumbnailReason[] = [
    ThumbnailReason.Filmstrip,
    ThumbnailReason.Clips,
    ThumbnailReason.Scenes,
    ThumbnailReason.Anchors,
];

export const HOVER_REASONS: readonly HoverReason[] = [
    ThumbnailReason.ClipHover,
    ThumbnailReason.SceneHover,
    ThumbnailReason.AnchorHover,
];
```

- [ ] **Step 2: Commit**

```bash
git add src/api/thumbnailReason.ts
git commit -m "feat(thumbnails): add ThumbnailReason enum"
```

---

## Task 2: New thumbnails slice (replace existing)

**Files:**
- Modify (full rewrite): `src/store/slices/thumbnailsSlice.ts`
- Create: `tests/unit/thumbnails/slice.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/thumbnails/slice.test.ts
import { describe, it, expect } from "vitest";
import reducer, {
    setThumbnail,
    setHover,
    clearForHash,
    selectThumbnailPath,
} from "../../../src/store/slices/thumbnailsSlice";
import { ThumbnailReason } from "../../../src/api/thumbnailReason";

const initial = reducer(undefined, { type: "@@INIT" });

describe("thumbnailsSlice", () => {
    it("setThumbnail writes a path under (hash, frame)", () => {
        const s = reducer(initial, setThumbnail({ fileHash: "h", frame: 42, path: "/p" }));
        expect(s.pathsByHashAndFrame.h[42]).toBe("/p");
    });

    it("setHover stores frame; passing null clears", () => {
        const s1 = reducer(
            initial,
            setHover({ fileHash: "h", reason: ThumbnailReason.ClipHover, frame: 7 }),
        );
        expect(s1.hoverByHash.h?.[ThumbnailReason.ClipHover]).toBe(7);
        const s2 = reducer(
            s1,
            setHover({ fileHash: "h", reason: ThumbnailReason.ClipHover, frame: null }),
        );
        expect(s2.hoverByHash.h?.[ThumbnailReason.ClipHover]).toBeUndefined();
    });

    it("clearForHash drops paths and hover for that hash only", () => {
        let s = reducer(initial, setThumbnail({ fileHash: "a", frame: 1, path: "/x" }));
        s = reducer(s, setThumbnail({ fileHash: "b", frame: 2, path: "/y" }));
        s = reducer(s, setHover({ fileHash: "a", reason: ThumbnailReason.SceneHover, frame: 1 }));
        s = reducer(s, clearForHash("a"));
        expect(s.pathsByHashAndFrame.a).toBeUndefined();
        expect(s.hoverByHash.a).toBeUndefined();
        expect(s.pathsByHashAndFrame.b[2]).toBe("/y");
    });

    it("selectThumbnailPath returns undefined when missing", () => {
        const root = { thumbnails: initial };
        expect(selectThumbnailPath("h", 0)(root)).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/thumbnails/slice.test.ts`
Expected: FAIL — old slice exports `setStripFrames` / `setHoverFrames`, not the new names.

- [ ] **Step 3: Rewrite the slice**

```ts
// src/store/slices/thumbnailsSlice.ts
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { type HoverReason } from "../../api/thumbnailReason";

export interface ThumbnailsState {
    /** Resolved cache paths keyed by file hash then frame. */
    pathsByHashAndFrame: Record<string, Record<number, string>>;
    /** Component-dispatched hover state, one frame per hover reason per hash. */
    hoverByHash: Record<string, Partial<Record<HoverReason, number>>>;
}

const initialState: ThumbnailsState = {
    pathsByHashAndFrame: {},
    hoverByHash: {},
};

const slice = createSlice({
    name: "thumbnails",
    initialState,
    reducers: {
        setThumbnail(
            state,
            action: PayloadAction<{ fileHash: string; frame: number; path: string }>,
        ) {
            const { fileHash, frame, path } = action.payload;
            const bucket = state.pathsByHashAndFrame[fileHash] ?? {};
            bucket[frame] = path;
            state.pathsByHashAndFrame[fileHash] = bucket;
        },
        setHover(
            state,
            action: PayloadAction<{
                fileHash: string;
                reason: HoverReason;
                frame: number | null;
            }>,
        ) {
            const { fileHash, reason, frame } = action.payload;
            const bucket = state.hoverByHash[fileHash] ?? {};
            if (frame == null) delete bucket[reason];
            else bucket[reason] = frame;
            if (Object.keys(bucket).length === 0) delete state.hoverByHash[fileHash];
            else state.hoverByHash[fileHash] = bucket;
        },
        clearForHash(state, action: PayloadAction<string>) {
            delete state.pathsByHashAndFrame[action.payload];
            delete state.hoverByHash[action.payload];
        },
    },
});

export const { setThumbnail, setHover, clearForHash } = slice.actions;
export default slice.reducer;

export function selectThumbnailPath(fileHash: string | null | undefined, frame: number) {
    return (state: { thumbnails: ThumbnailsState }): string | undefined => {
        if (fileHash == null) return undefined;
        return state.thumbnails.pathsByHashAndFrame[fileHash]?.[frame];
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/thumbnails/slice.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/slices/thumbnailsSlice.ts tests/unit/thumbnails/slice.test.ts
git commit -m "feat(thumbnails): rewrite slice for path+hover only"
```

> ⚠️ **TypeScript will be red across the project at this point** — old consumers still import `setStripFrames`, `setHoverFrames`, `selectStripFramesFor`, `selectThumbnailPathsFor`. That's expected. Tasks 9–13 fix the consumers. Do not chase the type errors yet.

---

## Task 3: `<Thumbnail />` component

**Files:**
- Create: `src/components/Thumbnail.tsx`
- Create: `src/components/Thumbnail.css`
- Create: `tests/unit/components/Thumbnail.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/Thumbnail.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import thumbnailsReducer, { setThumbnail } from "../../../src/store/slices/thumbnailsSlice";
import Thumbnail from "../../../src/components/Thumbnail";

vi.mock("@tauri-apps/api/core", () => ({
    convertFileSrc: (p: string) => `tauri://localhost/${p}`,
}));

function makeStore() {
    return configureStore({ reducer: { thumbnails: thumbnailsReducer } });
}

describe("<Thumbnail />", () => {
    it("renders a placeholder when no path", () => {
        const store = makeStore();
        const { container } = render(
            <Provider store={store}>
                <Thumbnail fileHash="h" frame={0} />
            </Provider>,
        );
        expect(container.querySelector("img")).toBeNull();
        expect(container.querySelector(".thumbnail--placeholder")).not.toBeNull();
    });

    it("renders an <img> with convertFileSrc when path is present", () => {
        const store = makeStore();
        store.dispatch(setThumbnail({ fileHash: "h", frame: 5, path: "/x.jpg" }));
        const { container } = render(
            <Provider store={store}>
                <Thumbnail fileHash="h" frame={5} />
            </Provider>,
        );
        const img = container.querySelector("img");
        expect(img).not.toBeNull();
        expect(img!.getAttribute("src")).toBe("tauri://localhost//x.jpg");
    });

    it("renders nothing when frame is null", () => {
        const store = makeStore();
        const { container } = render(
            <Provider store={store}>
                <Thumbnail fileHash="h" frame={null} />
            </Provider>,
        );
        expect(container.firstChild).toBeNull();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/Thumbnail.test.tsx`
Expected: FAIL — `Thumbnail` not found.

- [ ] **Step 3: Write component + css**

```tsx
// src/components/Thumbnail.tsx
import { memo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useAppSelector } from "../store/hooks";
import { selectThumbnailPath } from "../store/slices/thumbnailsSlice";
import "./Thumbnail.css";

interface ThumbnailProps {
    fileHash: string | null | undefined;
    frame: number | null | undefined;
    className?: string;
    placeholderClassName?: string;
    alt?: string;
}

function ThumbnailImpl({
    fileHash,
    frame,
    className,
    placeholderClassName,
    alt = "",
}: ThumbnailProps) {
    const path = useAppSelector(
        fileHash != null && frame != null ? selectThumbnailPath(fileHash, frame) : () => undefined,
    );
    if (fileHash == null || frame == null) return null;
    if (!path) {
        return <div className={`thumbnail thumbnail--placeholder ${placeholderClassName ?? ""}`} />;
    }
    return (
        <img
            className={`thumbnail ${className ?? ""}`}
            src={convertFileSrc(path)}
            alt={alt}
            draggable={false}
        />
    );
}

export default memo(ThumbnailImpl);
```

```css
/* src/components/Thumbnail.css */
.thumbnail {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    user-select: none;
}
.thumbnail--placeholder {
    background: var(--surface-2, #222);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/Thumbnail.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/Thumbnail.tsx src/components/Thumbnail.css tests/unit/components/Thumbnail.test.tsx
git commit -m "feat(thumbnails): add reusable <Thumbnail /> component"
```

---

## Task 4: `set_thumbnail_wants` API client

**Files:**
- Modify: `src/api/thumbnails.ts` (additive — old `setThumbnailPriority` is kept until Task 9 rewires consumers)

- [ ] **Step 1: Add the new request type and call**

Replace the entire contents of `src/api/thumbnails.ts` with:

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ThumbnailReason } from "./thumbnailReason";

export interface SetThumbnailWantsRequest {
    fileHash: string;
    videoPath: string;
    fps: number;
    byReason: Partial<Record<ThumbnailReason, number[]>>;
    maxCachedFrames?: number;
    thumbWidth?: number;
}

/** Replace the full wants state for one file. Backend extracts wanted-but-uncached
 *  frames and evicts unwanted frames in LRU order when over cap. */
export function setThumbnailWants(r: SetThumbnailWantsRequest): Promise<void> {
    return invoke("set_thumbnail_wants", {
        req: {
            file_hash: r.fileHash,
            video_path: r.videoPath,
            fps: r.fps,
            by_reason: r.byReason,
            max_cached_frames: r.maxCachedFrames,
            thumb_width: r.thumbWidth,
        },
    });
}

export function getThumbnailPath(fileHash: string, frame: number): Promise<string | null> {
    return invoke<string | null>("get_thumbnail_path", { fileHash, frame });
}

export function clearThumbnails(fileHash: string): Promise<void> {
    return invoke("clear_thumbnails", { fileHash });
}

export function clearAllThumbnails(): Promise<void> {
    return invoke("clear_all_thumbnails");
}

export interface ThumbnailReadyPayload {
    file_hash: string;
    frame: number;
    path: string;
    duration_ms?: number;
}

export function listenThumbnailReady(cb: (p: ThumbnailReadyPayload) => void): Promise<UnlistenFn> {
    return listen<ThumbnailReadyPayload>("thumbnail-ready", (e) => cb(e.payload));
}
```

> The old `setThumbnailPriority`, `ThumbnailPriorityRequest`, `getThumbnailQueueStats`, `QueueStats`, `QueueTierStats` are **removed in this commit**. Consumers (Filmstrip, ListPanel) and `ThumbnailQueueDebug` still import them — TypeScript will be red. Tasks 9–13 fix this. Do not chase the errors.

- [ ] **Step 2: Commit**

```bash
git add src/api/thumbnails.ts
git commit -m "feat(thumbnails): add setThumbnailWants API, drop old priority surface"
```

---

## Task 5: Thumbnail middleware — wiring + thumbnail-ready listener

**Files:**
- Create: `src/store/middleware/thumbnailMiddleware.ts`
- Modify: `src/store/store.ts`

This task adds the listener middleware skeleton, registers it, and wires the `thumbnail-ready` event into `setThumbnail`. Steady-state derivation comes in Task 6, drag gating in Task 7.

- [ ] **Step 1: Create the middleware skeleton**

```ts
// src/store/middleware/thumbnailMiddleware.ts
import { createListenerMiddleware } from "@reduxjs/toolkit";
import type { AppDispatch, RootState } from "../store";
import { setThumbnail } from "../slices/thumbnailsSlice";
import { listenThumbnailReady } from "../../api/thumbnails";

export const thumbnailMiddleware = createListenerMiddleware<RootState, AppDispatch>();

let started = false;
let unlistenReady: (() => void) | null = null;

/** Bootstrap: subscribe to backend thumbnail-ready events once. Called from
 *  App on mount (since middleware modules can't await tauri listen during
 *  store construction). */
export async function startThumbnailMiddleware(dispatch: AppDispatch) {
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
```

- [ ] **Step 2: Register middleware in the store**

In `src/store/store.ts`, add to the imports and prepend list:

```ts
import { thumbnailMiddleware } from "./middleware/thumbnailMiddleware";
// ...inside configureStore:
            .prepend(persistenceMiddleware.middleware)
            .prepend(historyMiddleware.middleware)
            .prepend(revealPlayheadMiddleware.middleware)
            .prepend(thumbnailMiddleware.middleware),
```

- [ ] **Step 3: Bootstrap from App**

In `src/App.tsx`, find the first `useEffect` and add a sibling effect that calls `startThumbnailMiddleware(dispatch)` once on mount. (Search for `useEffect` near the top of `App.tsx` for an existing place to add it; if uncertain, place it directly after `const dispatch = useAppDispatch();`.)

```tsx
import { startThumbnailMiddleware } from "./store/middleware/thumbnailMiddleware";
// ...inside App():
useEffect(() => {
    startThumbnailMiddleware(dispatch);
}, [dispatch]);
```

- [ ] **Step 4: Verify build still resolves the middleware**

Run: `npx tsc --noEmit -p . 2>&1 | grep thumbnailMiddleware`
Expected: no output (the middleware itself is clean; other thumbnail-related errors persist from Task 4).

- [ ] **Step 5: Commit**

```bash
git add src/store/middleware/thumbnailMiddleware.ts src/store/store.ts src/App.tsx
git commit -m "feat(thumbnails): add middleware skeleton + thumbnail-ready listener"
```

---

## Task 6: Middleware — steady-state derivation + IPC

**Files:**
- Modify: `src/store/middleware/thumbnailMiddleware.ts`
- Create: `tests/unit/thumbnails/middleware.test.ts`

This task adds the dirty-set + debounce + derive-at-fire-time core, *without* drag gating (Task 7).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/thumbnails/middleware.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import videoReducer, { setVideo } from "../../../src/store/slices/videoSlice";
import warpReducer, { addAnchor, setPlayhead } from "../../../src/store/slices/warpSlice";
import regionReducer, { addRegion } from "../../../src/store/slices/regionSlice";
import sceneReducer from "../../../src/store/slices/sceneSlice";
import dragReducer from "../../../src/store/slices/dragSlice";
import uiReducer from "../../../src/store/slices/uiSlice";
import settingsReducer from "../../../src/store/slices/settingsSlice";
import thumbnailsReducer from "../../../src/store/slices/thumbnailsSlice";
import {
    thumbnailMiddleware,
    __testing,
} from "../../../src/store/middleware/thumbnailMiddleware";

vi.mock("../../../src/api/thumbnails", () => ({
    setThumbnailWants: vi.fn().mockResolvedValue(undefined),
    listenThumbnailReady: vi.fn().mockResolvedValue(() => {}),
    clearThumbnails: vi.fn().mockResolvedValue(undefined),
}));

import { setThumbnailWants } from "../../../src/api/thumbnails";

function makeStore() {
    return configureStore({
        reducer: {
            video: videoReducer, warp: warpReducer, region: regionReducer,
            scene: sceneReducer, drag: dragReducer, ui: uiReducer,
            settings: settingsReducer, thumbnails: thumbnailsReducer,
        },
        middleware: (g) => g().prepend(thumbnailMiddleware.middleware),
    });
}

describe("thumbnailMiddleware — steady-state derivation", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        (setThumbnailWants as ReturnType<typeof vi.fn>).mockClear();
        __testing.reset();
    });
    afterEach(() => vi.useRealTimers());

    it("coalesces multi-source changes into one IPC call", async () => {
        const store = makeStore();
        store.dispatch(setVideo({
            path: "/v.mp4", name: "v.mp4", fps: 30, duration: 100,
            width: 1920, height: 1080, fileHash: "h",
        }));
        store.dispatch(addRegion({ id: "r1", name: "r", inPoint: 1, outPoint: 2 }));
        store.dispatch(addAnchor({ time: 1.5 }));
        await vi.advanceTimersByTimeAsync(200);
        expect(setThumbnailWants).toHaveBeenCalledTimes(1);
        const arg = (setThumbnailWants as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(arg.fileHash).toBe("h");
        expect(arg.byReason.clips).toContain(30); // r1.inPoint=1s @ 30fps
        expect(arg.byReason.anchors).toContain(45); // 1.5s @ 30fps
    });

    it("skips IPC when payload deep-equals lastSent", async () => {
        const store = makeStore();
        store.dispatch(setVideo({
            path: "/v.mp4", name: "v.mp4", fps: 30, duration: 100,
            width: 1920, height: 1080, fileHash: "h",
        }));
        store.dispatch(setPlayhead(5));
        await vi.advanceTimersByTimeAsync(200);
        const callsAfterFirst = (setThumbnailWants as ReturnType<typeof vi.fn>).mock.calls.length;
        // Re-dispatch the same playhead — same filmstrip frames → no IPC.
        store.dispatch(setPlayhead(5));
        await vi.advanceTimersByTimeAsync(200);
        expect((setThumbnailWants as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterFirst);
    });
});
```

> Verify the action creators (`setVideo`, `addRegion`, `addAnchor`, `setPlayhead`) and their payload shapes against the actual slice exports. Adjust the test imports/payloads to match the real signatures before running. If a slice doesn't export a one-shot creator (e.g. anchors need an id), construct the payload the slice expects.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/thumbnails/middleware.test.ts`
Expected: FAIL — `__testing` export and derivation don't exist yet.

- [ ] **Step 3: Implement derivation + debounce**

Replace the contents of `src/store/middleware/thumbnailMiddleware.ts` with:

```ts
import { createListenerMiddleware } from "@reduxjs/toolkit";
import type { AppDispatch, RootState } from "../store";
import { setThumbnail, clearForHash } from "../slices/thumbnailsSlice";
import {
    listenThumbnailReady,
    setThumbnailWants,
    clearThumbnails,
} from "../../api/thumbnails";
import { ThumbnailReason, ALL_REASONS } from "../../api/thumbnailReason";
import { secondsToFrames } from "../../utils/time";
import { visibleSceneCuts } from "../../utils/sceneFilter";

export const thumbnailMiddleware = createListenerMiddleware<RootState, AppDispatch>();

const FILMSTRIP_SLOTS = 7;
const DEBOUNCE_MS = 100;

interface SourceSnapshot {
    fileHash: string | null;
    videoPath: string | null;
    fps: number;
    duration: number;
    playing: boolean;
    playhead: number;
    regions: unknown;
    origAnchors: unknown;
    rawScenes: unknown;
    userScenes: unknown;
    sceneMinGap: number;
    hoverBucket: unknown;
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

export async function startThumbnailMiddleware(dispatch: AppDispatch) {
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

function derive(
    reason: ThumbnailReason,
    s: SourceSnapshot,
): number[] {
    if (s.fps <= 0 || s.duration <= 0) return [];
    const maxFrame = Math.max(0, Math.floor(s.duration * s.fps));
    const bucket = s.hoverBucket as Partial<Record<ThumbnailReason, number>> | undefined;
    switch (reason) {
        case ThumbnailReason.Filmstrip: {
            const center = clamp(secondsToFrames(s.playhead, s.fps), maxFrame);
            const half = Math.floor(FILMSTRIP_SLOTS / 2);
            const out: number[] = [];
            for (let i = -half; i <= half; i++) {
                const f = center + i;
                if (f >= 0 && f <= maxFrame) out.push(f);
            }
            return out;
        }
        case ThumbnailReason.Clips: {
            const regs = s.regions as Array<{ inPoint: number }>;
            return regs.map((r) => clamp(Math.floor(r.inPoint * s.fps), maxFrame));
        }
        case ThumbnailReason.Anchors: {
            const ax = s.origAnchors as Array<{ time: number }>;
            return ax.map((a) => clamp(Math.floor(a.time * s.fps), maxFrame));
        }
        case ThumbnailReason.Scenes: {
            const raw = (s.rawScenes as number[] | undefined) ?? [];
            const user = (s.userScenes as number[] | undefined) ?? [];
            return visibleSceneCuts(raw, user, s.sceneMinGap).map((t) =>
                clamp(Math.floor(t * s.fps), maxFrame),
            );
        }
        case ThumbnailReason.ClipHover: {
            const f = bucket?.[ThumbnailReason.ClipHover];
            return f != null ? [clamp(f, maxFrame)] : [];
        }
        case ThumbnailReason.SceneHover: {
            const f = bucket?.[ThumbnailReason.SceneHover];
            return f != null ? [clamp(f, maxFrame)] : [];
        }
        case ThumbnailReason.AnchorHover: {
            const f = bucket?.[ThumbnailReason.AnchorHover];
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
    predicate: () => true,
    effect: (_action, api) => {
        const state = api.getState();
        const curr = snap(state);
        // File swap: clear slice + tell backend; reset prev to fully re-derive.
        if (prev && prev.fileHash && prev.fileHash !== curr.fileHash) {
            api.dispatch(clearForHash(prev.fileHash));
            clearThumbnails(prev.fileHash).catch(() => {});
            lastSent = { fileHash: null, byReason: {} };
            prev = null;
        }
        const d = diff(curr, prev);
        prev = curr;
        if (d.size === 0) return;
        for (const r of d) dirty.add(r);
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => flush(api.getState()), DEBOUNCE_MS);
    },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/thumbnails/middleware.test.ts`
Expected: PASS (2 tests). Fix slice payload shapes in the test if they don't match real creators.

- [ ] **Step 5: Commit**

```bash
git add src/store/middleware/thumbnailMiddleware.ts tests/unit/thumbnails/middleware.test.ts
git commit -m "feat(thumbnails): derive wants from slice changes, coalesce via dirty-set"
```

---

## Task 7: Middleware — drag gating

**Files:**
- Modify: `src/store/middleware/thumbnailMiddleware.ts`
- Modify: `tests/unit/thumbnails/middleware.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/thumbnails/middleware.test.ts`:

```ts
import { dragStart, dragEnd } from "../../../src/store/slices/dragSlice";

describe("thumbnailMiddleware — drag gating", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        (setThumbnailWants as ReturnType<typeof vi.fn>).mockClear();
        __testing.reset();
    });
    afterEach(() => vi.useRealTimers());

    it("suppresses IPC while drag.active, fires once on dragEnd", async () => {
        const store = makeStore();
        store.dispatch(setVideo({
            path: "/v.mp4", name: "v.mp4", fps: 30, duration: 100,
            width: 1920, height: 1080, fileHash: "h",
        }));
        store.dispatch(addAnchor({ time: 1.0 }));
        await vi.advanceTimersByTimeAsync(200);
        const baseline = (setThumbnailWants as ReturnType<typeof vi.fn>).mock.calls.length;

        store.dispatch(dragStart({ regions: [], origAnchors: [], beatAnchors: [] }));
        for (let i = 0; i < 50; i++) {
            store.dispatch(setPlayhead(i / 30));
        }
        await vi.advanceTimersByTimeAsync(500);
        expect((setThumbnailWants as ReturnType<typeof vi.fn>).mock.calls.length).toBe(baseline);

        store.dispatch(dragEnd());
        await vi.advanceTimersByTimeAsync(200);
        expect((setThumbnailWants as ReturnType<typeof vi.fn>).mock.calls.length).toBe(baseline + 1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/thumbnails/middleware.test.ts`
Expected: FAIL on the drag-gating block (existing tests still pass).

- [ ] **Step 3: Add the drag gate**

In `thumbnailMiddleware.ts`, modify the `startListening` block:

```ts
import { ALL_REASONS, STEADY_REASONS } from "../../api/thumbnailReason";
// (add STEADY_REASONS to the existing import line)
import { dragEnd } from "../slices/dragSlice";

thumbnailMiddleware.startListening({
    predicate: () => true,
    effect: (action, api) => {
        const state = api.getState();
        const curr = snap(state);
        if (prev && prev.fileHash && prev.fileHash !== curr.fileHash) {
            api.dispatch(clearForHash(prev.fileHash));
            clearThumbnails(prev.fileHash).catch(() => {});
            lastSent = { fileHash: null, byReason: {} };
            prev = null;
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
            timer = setTimeout(() => flush(api.getState()), DEBOUNCE_MS);
            return;
        }

        const d = diff(curr, prev);
        prev = curr;
        if (d.size === 0) return;
        for (const r of d) dirty.add(r);
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => flush(api.getState()), DEBOUNCE_MS);
    },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/thumbnails/middleware.test.ts`
Expected: PASS (all blocks).

- [ ] **Step 5: Commit**

```bash
git add src/store/middleware/thumbnailMiddleware.ts tests/unit/thumbnails/middleware.test.ts
git commit -m "feat(thumbnails): gate middleware on drag.active, flush on dragEnd"
```

---

## Task 8: Backend — wipe and rewrite `thumbnails.rs`

**Files:**
- Modify (full rewrite): `src-tauri/src/thumbnails.rs`
- Modify: `src-tauri/src/lib.rs` (command list)

- [ ] **Step 1: Replace `thumbnails.rs` with the minimal LRU**

```rust
// src-tauri/src/thumbnails.rs
//! Minimal thumbnail cache: per-file FIFO worker + last-touch LRU eviction.
//! Wanted frames (anything in the latest `wants_by_reason` union) are
//! eviction-protected. Reason buckets are stored verbatim for future use
//! but do not affect priority in v1.

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

use crate::ffmpeg::find_bin;

const DEFAULT_MAX_CACHED: usize = 2000;
const DEFAULT_THUMB_WIDTH: u32 = 120;

#[derive(Serialize, Deserialize, Hash, Eq, PartialEq, Clone, Copy, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum ThumbnailReason {
    Filmstrip,
    Clips,
    ClipHover,
    Scenes,
    SceneHover,
    Anchors,
    AnchorHover,
}

pub struct VideoCache {
    video_path: String,
    fps: f64,
    max_frame: i64,
    cache_dir: PathBuf,
    wants_by_reason: HashMap<ThumbnailReason, Vec<i64>>,
    wanted_set: HashSet<i64>,
    ready: HashMap<i64, Instant>,
    in_flight: HashSet<i64>,
    queue: VecDeque<i64>,
    max_cached: usize,
    thumb_width: u32,
    worker_running: bool,
}

#[derive(Default)]
pub struct Registry {
    videos: HashMap<String, Arc<Mutex<VideoCache>>>,
}

pub struct ThumbnailsState(pub Arc<Mutex<Registry>>);
impl ThumbnailsState {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(Registry::default())))
    }
}

#[derive(Deserialize)]
pub struct SetWantsRequest {
    pub file_hash: String,
    pub video_path: String,
    pub fps: f64,
    pub by_reason: HashMap<ThumbnailReason, Vec<i64>>,
    pub max_cached_frames: Option<usize>,
    pub thumb_width: Option<u32>,
}

fn app_cache_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let d = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("thumbnails");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

fn cache_dir_for<R: Runtime>(app: &AppHandle<R>, file_hash: &str) -> Result<PathBuf, String> {
    let d = app_cache_dir(app)?.join(file_hash);
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

fn scan_ready(cache_dir: &PathBuf) -> HashMap<i64, Instant> {
    let mut out = HashMap::new();
    let now = Instant::now();
    if let Ok(rd) = std::fs::read_dir(cache_dir) {
        for entry in rd.flatten() {
            let name = entry.file_name();
            let s = name.to_string_lossy();
            if let Some(stem) = s.strip_suffix(".jpg") {
                if let Ok(f) = stem.parse::<i64>() {
                    out.insert(f, now);
                }
            }
        }
    }
    out
}

fn frame_path(cache_dir: &PathBuf, frame: i64) -> PathBuf {
    cache_dir.join(format!("{frame}.jpg"))
}

fn evict_to_cap(c: &mut VideoCache) {
    if c.ready.len() <= c.max_cached {
        return;
    }
    // Collect (frame, instant) for unwanted, sort oldest first, drop until at cap.
    let mut victims: Vec<(i64, Instant)> = c
        .ready
        .iter()
        .filter(|(f, _)| !c.wanted_set.contains(*f))
        .map(|(f, t)| (*f, *t))
        .collect();
    victims.sort_by_key(|(_, t)| *t);
    for (f, _) in victims {
        if c.ready.len() <= c.max_cached {
            break;
        }
        c.ready.remove(&f);
        let _ = std::fs::remove_file(frame_path(&c.cache_dir, f));
    }
}

fn run_ffmpeg(
    bin: &str,
    video_path: &str,
    fps: f64,
    frame: i64,
    width: u32,
    out: &PathBuf,
) -> bool {
    let t = (frame as f64) / fps.max(0.0001);
    // Hybrid seek: -ss before -i for coarse keyframe seek, then a small
    // refine pass with -ss after to land on the right frame.
    let mut cmd = Command::new(bin);
    cmd.arg("-y")
        .arg("-ss")
        .arg(format!("{:.3}", (t - 0.5).max(0.0)))
        .arg("-i")
        .arg(video_path)
        .arg("-ss")
        .arg(format!("{:.3}", t.min(0.5)))
        .arg("-frames:v")
        .arg("1")
        .arg("-vf")
        .arg(format!("scale={width}:-2"))
        .arg("-q:v")
        .arg("4")
        .arg(out)
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    match cmd.status() {
        Ok(s) => s.success(),
        Err(_) => false,
    }
}

fn spawn_worker<R: Runtime>(
    app: AppHandle<R>,
    file_hash: String,
    entry: Arc<Mutex<VideoCache>>,
) {
    {
        let mut c = entry.lock().unwrap();
        if c.worker_running {
            return;
        }
        c.worker_running = true;
    }
    let bin = match find_bin("ffmpeg") {
        Some(b) => b,
        None => {
            entry.lock().unwrap().worker_running = false;
            return;
        }
    };
    std::thread::spawn(move || loop {
        let next: Option<i64> = {
            let mut c = entry.lock().unwrap();
            loop {
                match c.queue.pop_front() {
                    None => break None,
                    Some(f) => {
                        if c.ready.contains_key(&f) || c.in_flight.contains(&f) {
                            continue;
                        }
                        c.in_flight.insert(f);
                        break Some(f);
                    }
                }
            }
        };
        let frame = match next {
            Some(f) => f,
            None => {
                entry.lock().unwrap().worker_running = false;
                return;
            }
        };
        let (video_path, fps, width, out) = {
            let c = entry.lock().unwrap();
            (
                c.video_path.clone(),
                c.fps,
                c.thumb_width,
                frame_path(&c.cache_dir, frame),
            )
        };
        let ok = run_ffmpeg(&bin, &video_path, fps, frame, width, &out);
        {
            let mut c = entry.lock().unwrap();
            c.in_flight.remove(&frame);
            if ok {
                c.ready.insert(frame, Instant::now());
            }
        }
        if ok {
            let _ = app.emit(
                "thumbnail-ready",
                serde_json::json!({
                    "file_hash": &file_hash,
                    "frame": frame,
                    "path": out.to_string_lossy().to_string(),
                }),
            );
        }
    });
}

#[tauri::command]
pub async fn set_thumbnail_wants<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, ThumbnailsState>,
    req: SetWantsRequest,
) -> Result<(), String> {
    if req.fps <= 0.0 {
        return Err("invalid fps".into());
    }
    let cache_dir = cache_dir_for(&app, &req.file_hash)?;
    let thumb_width = req.thumb_width.unwrap_or(DEFAULT_THUMB_WIDTH).max(16);
    let max_cached = req.max_cached_frames.unwrap_or(DEFAULT_MAX_CACHED).max(16);

    let entry = {
        let mut reg = state.0.lock().unwrap();
        reg.videos
            .entry(req.file_hash.clone())
            .or_insert_with(|| {
                let ready = scan_ready(&cache_dir);
                Arc::new(Mutex::new(VideoCache {
                    video_path: req.video_path.clone(),
                    fps: req.fps,
                    max_frame: 0,
                    cache_dir: cache_dir.clone(),
                    wants_by_reason: HashMap::new(),
                    wanted_set: HashSet::new(),
                    ready,
                    in_flight: HashSet::new(),
                    queue: VecDeque::new(),
                    max_cached,
                    thumb_width,
                    worker_running: false,
                }))
            })
            .clone()
    };

    {
        let mut c = entry.lock().unwrap();
        c.video_path = req.video_path;
        c.fps = req.fps;
        if c.thumb_width != thumb_width {
            // Width changed → cached frames are wrong size; purge.
            for (f, _) in c.ready.drain() {
                let _ = std::fs::remove_file(frame_path(&c.cache_dir, f));
            }
            c.thumb_width = thumb_width;
        }
        c.max_cached = max_cached;
        c.wants_by_reason = req.by_reason;

        let mut union: HashSet<i64> = HashSet::new();
        for v in c.wants_by_reason.values() {
            for &f in v {
                if f >= 0 {
                    union.insert(f);
                }
            }
        }
        c.wanted_set = union;
        c.max_frame = *c.wanted_set.iter().max().unwrap_or(&c.max_frame);

        let now = Instant::now();
        for &f in c.wanted_set.clone().iter() {
            if c.ready.contains_key(&f) {
                c.ready.insert(f, now);
            } else if !c.in_flight.contains(&f) && !c.queue.contains(&f) {
                c.queue.push_back(f);
            }
        }
        evict_to_cap(&mut c);
    }

    spawn_worker(app, req.file_hash, entry);
    Ok(())
}

#[tauri::command]
pub fn get_thumbnail_path(
    state: tauri::State<'_, ThumbnailsState>,
    file_hash: String,
    frame: i64,
) -> Option<String> {
    let reg = state.0.lock().unwrap();
    let entry = reg.videos.get(&file_hash)?.clone();
    drop(reg);
    let c = entry.lock().unwrap();
    if c.ready.contains_key(&frame) {
        Some(frame_path(&c.cache_dir, frame).to_string_lossy().to_string())
    } else {
        None
    }
}

#[tauri::command]
pub fn clear_thumbnails(
    state: tauri::State<'_, ThumbnailsState>,
    file_hash: String,
) -> Result<(), String> {
    let entry = {
        let mut reg = state.0.lock().unwrap();
        reg.videos.remove(&file_hash)
    };
    if let Some(e) = entry {
        let c = e.lock().unwrap();
        let _ = std::fs::remove_dir_all(&c.cache_dir);
    }
    Ok(())
}

#[tauri::command]
pub fn clear_all_thumbnails<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, ThumbnailsState>,
) -> Result<(), String> {
    let mut reg = state.0.lock().unwrap();
    reg.videos.clear();
    let root = app_cache_dir(&app)?;
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(())
}

// ── tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn fresh_cache() -> VideoCache {
        VideoCache {
            video_path: "/tmp/x.mp4".into(),
            fps: 30.0,
            max_frame: 100,
            cache_dir: std::env::temp_dir().join(format!("thumbtest_{}", std::process::id())),
            wants_by_reason: HashMap::new(),
            wanted_set: HashSet::new(),
            ready: HashMap::new(),
            in_flight: HashSet::new(),
            queue: VecDeque::new(),
            max_cached: 3,
            thumb_width: 120,
            worker_running: false,
        }
    }

    #[test]
    fn wanted_frames_never_evict() {
        let mut c = fresh_cache();
        // 4 ready frames; wanted={1,2,3,4}; cap=3. Eviction can't drop any.
        let now = Instant::now();
        for f in 1..=4i64 {
            c.ready.insert(f, now);
        }
        c.wanted_set = (1..=4).collect();
        evict_to_cap(&mut c);
        assert_eq!(c.ready.len(), 4, "wanted frames are protected past cap");
    }

    #[test]
    fn lru_evicts_oldest_unwanted() {
        let mut c = fresh_cache();
        let base = Instant::now();
        c.ready.insert(1, base);
        c.ready.insert(2, base + Duration::from_millis(10));
        c.ready.insert(3, base + Duration::from_millis(20));
        c.ready.insert(4, base + Duration::from_millis(30));
        // None wanted → cap=3 → drop the oldest (frame 1).
        evict_to_cap(&mut c);
        assert_eq!(c.ready.len(), 3);
        assert!(!c.ready.contains_key(&1));
    }
}
```

- [ ] **Step 2: Update `lib.rs` command list**

In `src-tauri/src/lib.rs`, replace the thumbnails command block:

```rust
            thumbnails::set_thumbnail_wants,
            thumbnails::get_thumbnail_path,
            thumbnails::clear_thumbnails,
            thumbnails::clear_all_thumbnails,
```

(Removes `set_thumbnail_priority` and `get_thumbnail_queue_stats`.)

- [ ] **Step 3: Build the backend**

Run: `rtk cargo build --manifest-path src-tauri/Cargo.toml`
Expected: clean build. Fix any leftover references to deleted types if they appear.

- [ ] **Step 4: Run the unit tests**

Run: `rtk cargo test --manifest-path src-tauri/Cargo.toml thumbnails::tests`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/thumbnails.rs src-tauri/src/lib.rs
git commit -m "feat(thumbnails): rewrite backend as minimal LRU"
```

---

## Task 9: Rewire `Filmstrip.tsx`

**Files:**
- Modify: `src/components/Filmstrip.tsx`

- [ ] **Step 1: Replace the file**

```tsx
// src/components/Filmstrip.tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Filmstrip.tsx
git commit -m "refactor(filmstrip): consume <Thumbnail /> + drop in-component IPC"
```

---

## Task 10: Rewire `SceneRow.tsx`

**Files:**
- Modify: `src/components/SceneRow.tsx`

- [ ] **Step 1: Update imports and inline-thumb rendering**

In `SceneRow.tsx`:

1. Remove imports: `convertFileSrc`, `selectThumbnailPathsFor`, `useSetThumbnailHover`.
2. Add imports: `Thumbnail` from `./Thumbnail`, `setHover` from `../store/slices/thumbnailsSlice`, `ThumbnailReason` from `../api/thumbnailReason`, `useAppDispatch`.
3. Remove `thumbPaths`, `inlineSrcs`, and the `useMemo` that built them. The component now renders `<Thumbnail fileHash={video.fileHash} frame={Math.floor(t * video.fps)} />` directly inside the `scene-band__thumb-btn` button.
4. Replace `handleDiamondEnter` body with: dispatch `setHover({ fileHash: video.fileHash, reason: ThumbnailReason.SceneHover, frame: Math.floor(t * video.fps) })` (instead of calling `setThumbnailHover`). Also still publish `gesture.setHoveredScene(time)` for the through-line.
5. Replace `handleLeave` body with: dispatch `setHover({ fileHash, reason: SceneHover, frame: null })` + `gesture.setHoveredScene(null)`.

Final relevant excerpt:

```tsx
import { useCallback, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { gesture } from "../store/gesture";
import { setHover } from "../store/slices/thumbnailsSlice";
import { ThumbnailReason } from "../api/thumbnailReason";
import Thumbnail from "./Thumbnail";
// ... (keep View, timeToViewPct, etc.)

const dispatch = useAppDispatch();
const video = useAppSelector((s) => s.video.video);

const handleDiamondEnter = useCallback(
    (time: number) => {
        gesture.setHoveredScene(time);
        if (!video || video.fps <= 0) return;
        dispatch(setHover({
            fileHash: video.fileHash,
            reason: ThumbnailReason.SceneHover,
            frame: Math.floor(time * video.fps),
        }));
    },
    [dispatch, video],
);

const handleLeave = useCallback(() => {
    gesture.setHoveredScene(null);
    if (!video) return;
    dispatch(setHover({
        fileHash: video.fileHash,
        reason: ThumbnailReason.SceneHover,
        frame: null,
    }));
}, [dispatch, video]);

// inside the expanded branch:
{expanded && video && (
    <button /* ... */>
        <Thumbnail
            fileHash={video.fileHash}
            frame={Math.floor(t * video.fps)}
            className="scene-band__thumb-img"
            placeholderClassName="scene-band__thumb-img--placeholder"
        />
    </button>
)}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/SceneRow.tsx
git commit -m "refactor(scenes): SceneRow consumes <Thumbnail />, dispatches scene-hover"
```

---

## Task 11: Rewire `RowShell` / `ListPanel`

**Files:**
- Modify: `src/components/list/RowShell.tsx`
- Modify: `src/components/list/ListPanel.tsx`
- Modify: `src/layout/panels/ClipsPanel.tsx`, `MarkersPanel.tsx`, `ScenesPanel.tsx` (only if their `listId` is needed to pick the hover reason)

The shared row now renders `<Thumbnail />` instead of receiving a resolved src.

- [ ] **Step 1: Change `RowContext`**

In `ListPanel.tsx`, replace `thumbnailSrc: string | null` with:

```ts
export interface RowContext {
    isActive: boolean;
    isSelected: boolean;
    isPlaying: boolean;
    viewMode: ListViewMode;
    fileHash: string | null;
    thumbnailFrame: number | null;
    onRowClick: (e: React.MouseEvent) => void;
    onRowMouseEnter: (e: React.MouseEvent) => void;
    onRowMouseLeave: () => void;
}
```

- [ ] **Step 2: Update `RowShell.tsx`**

Replace the thumbnail rendering block:

```tsx
import Thumbnail from "../Thumbnail";

// ... inside the component, replace the {viewMode !== "none" && (...)} block with:

{viewMode !== "none" && (
    <div className="list-panel__row-thumb-wrap">
        <Thumbnail
            fileHash={ctx.fileHash}
            frame={ctx.thumbnailFrame}
            className="list-panel__row-thumb"
            placeholderClassName="list-panel__row-thumb--placeholder"
        />
        {isPlaying && (
            <span className="list-panel__row-thumb-play" aria-hidden>
                <IconPlay size={20} />
            </span>
        )}
    </div>
)}
```

- [ ] **Step 3: Rewrite `ListPanel.tsx` hover + ctx build**

In `ListPanel.tsx`:

1. Remove imports of `convertFileSrc`, `setStripFrames`, `selectThumbnailPathsFor`, `useSetThumbnailHover`.
2. Add: `import { setHover } from "../../store/slices/thumbnailsSlice";` and `import { ThumbnailReason, type HoverReason } from "../../api/thumbnailReason";`.
3. Delete the `useMemo` that produced `stripFrames` and the `useEffect` that dispatched `setStripFrames` — the middleware now drives `clips` / `scenes` / `anchors` reasons from the slice state, not from what's mounted.
4. Map `listId` to a hover reason:

```ts
const hoverReason: HoverReason | null =
    listId === "clips" ? ThumbnailReason.ClipHover :
    listId === "scenes" ? ThumbnailReason.SceneHover :
    listId === "markers" ? ThumbnailReason.AnchorHover :
    null;
```

5. In `buildCtx`, build the new `RowContext`:

```ts
const thumbFrame =
    item.thumbnailTime != null && fps > 0
        ? Math.max(0, Math.floor(item.thumbnailTime * fps))
        : null;
return {
    isActive, isPlaying, isSelected, viewMode,
    fileHash: video?.fileHash ?? null,
    thumbnailFrame: thumbFrame,
    onRowClick: (e) => handleRowClick(item.id, e),
    onRowMouseEnter: () => {
        if (!video || hoverReason == null || thumbFrame == null) return;
        dispatch(setHover({ fileHash: video.fileHash, reason: hoverReason, frame: thumbFrame }));
    },
    onRowMouseLeave: () => {
        if (!video || hoverReason == null) return;
        dispatch(setHover({ fileHash: video.fileHash, reason: hoverReason, frame: null }));
    },
};
```

6. Drop the dependency on `thumbPaths` in the `useCallback` deps array. Keep `video`, `fps`, `viewMode`, etc.

- [ ] **Step 4: Update panel callers if needed**

If `ClipsPanel.tsx`, `MarkersPanel.tsx`, or `ScenesPanel.tsx` read `thumbnailSrc` from `RowContext`, replace those reads to render `<Thumbnail fileHash={ctx.fileHash} frame={ctx.thumbnailFrame} />` inline instead. Search: `rtk grep -n "thumbnailSrc" src/layout/panels`.

- [ ] **Step 5: Commit**

```bash
git add src/components/list/RowShell.tsx src/components/list/ListPanel.tsx src/layout/panels
git commit -m "refactor(list): RowShell renders <Thumbnail />, hover dispatched per-list reason"
```

---

## Task 12: Rewire `ThumbnailPopup.tsx`

**Files:**
- Modify: `src/components/ThumbnailPopup.tsx`

- [ ] **Step 1: Replace inline img with `<Thumbnail />`**

```tsx
// src/components/ThumbnailPopup.tsx
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useAppSelector } from "../store/hooks";
import Thumbnail from "./Thumbnail";
import "./ThumbnailPopup.css";

interface HoverState { time: number; x: number; y: number; }
interface Ctx { hovered: HoverState | null; setHovered: (h: HoverState | null) => void; }

const ThumbnailHoverContext = createContext<Ctx | null>(null);

export function ThumbnailHoverProvider({ children }: { children: ReactNode }) {
    const [hovered, setHovered] = useState<HoverState | null>(null);
    const value = useMemo(() => ({ hovered, setHovered }), [hovered]);
    return (
        <ThumbnailHoverContext.Provider value={value}>{children}</ThumbnailHoverContext.Provider>
    );
}

const NOOP_SET: (h: HoverState | null) => void = () => {};

// eslint-disable-next-line react-refresh/only-export-components
export function useSetThumbnailHover() {
    const ctx = useContext(ThumbnailHoverContext);
    return ctx?.setHovered ?? NOOP_SET;
}

export default function ThumbnailPopup() {
    const ctx = useContext(ThumbnailHoverContext);
    const video = useAppSelector((s) => s.video.video);
    if (!ctx || !ctx.hovered || !video || video.fps <= 0) return null;
    const { hovered } = ctx;
    const frame = Math.floor(hovered.time * video.fps);
    return (
        <div
            className="thumb-popup"
            style={{
                position: "fixed",
                left: hovered.x + 12,
                top: hovered.y - 12,
                transform: "translate(0, -100%)",
                pointerEvents: "none",
            }}
        >
            <Thumbnail
                fileHash={video.fileHash}
                frame={frame}
                className="thumb-popup__img"
                placeholderClassName="thumb-popup__img thumb-popup__img--placeholder"
            />
        </div>
    );
}
```

> `useSetThumbnailHover` is retained for the **popup position context** (used by SceneRow / ListPanel via separate code paths). It no longer drives backend priority — hover dispatch is independent. Callers that want both popup *and* backend priority dispatch both: `setHovered({...})` for the popup, `setHover({...})` for the priority. Most callers can probably drop the popup context now that the inline thumbnail covers most cases; that's a follow-up.

- [ ] **Step 2: Commit**

```bash
git add src/components/ThumbnailPopup.tsx
git commit -m "refactor(popup): ThumbnailPopup renders <Thumbnail />"
```

---

## Task 13: Delete dead surface

**Files:**
- Delete: `src/components/ThumbnailQueueDebug.tsx`
- Delete: `docs/THUMBNAIL_CACHE_DESIGN.md` (now superseded by the new spec)
- Modify: anywhere `ThumbnailQueueDebug` is imported (likely `SettingsDialog.tsx` and `DevRecorderPanel.tsx` — search)

- [ ] **Step 1: Find and remove references**

Run: `rtk grep -n "ThumbnailQueueDebug" src`
Remove every import + JSX usage. The diagnostic panel returns when the backend grows complexity worth surfacing.

- [ ] **Step 2: Search for any remaining stale identifiers**

Run: `rtk grep -n "selectThumbnailPathsFor\|selectStripFramesFor\|setStripFrames\|setHoverFrames\|setThumbnailPriority\|getThumbnailQueueStats\|stripFramesBySource\|hoverFramesByHash" src`
Expected: no matches. Fix any stragglers.

- [ ] **Step 3: Delete files**

```bash
git rm src/components/ThumbnailQueueDebug.tsx docs/THUMBNAIL_CACHE_DESIGN.md
```

- [ ] **Step 4: Drop the obsolete `devThumbnailRecorder` `recordPriorityPush` call site if any remains**

Run: `rtk grep -n "recordPriorityPush\|recordThumbnailDone" src`
If the recorder is only used by deleted code, also remove it or leave the stub; pick the simpler option.

- [ ] **Step 5: Build clean**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

Run: `npx vitest run`
Expected: all tests pass.

Run: `rtk cargo build --manifest-path src-tauri/Cargo.toml`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(thumbnails): delete dead diagnostic + old design doc"
```

---

## Task 14: Smoke test the full system in dev

- [ ] **Step 1: Start the app**

Run: `npm run tauri dev`

- [ ] **Step 2: Manual smoke checklist**

For each item, watch the filmstrip + list panels + scene band fill in:

- Load a video. Filmstrip thumbs appear around the playhead within ~2s.
- Open Clips panel in grid mode. Clip thumbs appear.
- Open Scenes panel; expand scene band. Scene diamonds get inline thumbs.
- Open Markers panel. Anchor thumbs appear.
- Hover a clip row → that frame appears in the popup (or row thumb if grid). Move hover → previous frame eventually evicts under cap.
- Drag an anchor across the timeline. **DevTools network/IPC traffic should be silent during the drag.** On release, one `set_thumbnail_wants` fires.
- Switch to a second video. Cache for the first video is cleared (`clear_thumbnails` IPC fires); new video starts queueing.

- [ ] **Step 3: Note any visual regressions**

If the placeholder color or the play-icon overlay drifts, follow up — but don't gate the merge on cosmetics that are easy CSS tweaks.

---

## Task 15: Report stale behavior scenarios

- [ ] **Step 1: List the stale scenarios**

Read `spec/features/thumbnails.feature`. For each scenario that names T1/T2/T3, REQ_RADIUS, marker neighborhoods, recency tau, or the old priority IPC shape, note the scenario name and what it asserted.

- [ ] **Step 2: Surface the list to the user**

Post the list verbatim in chat. **Do not edit `spec/`.** The user decides whether to rewrite scenarios per the new model (wanted-vs-LRU, drag suppression, multi-source coalescing) or to defer.

---

## Final self-review (run before opening the PR)

- [ ] `rtk git log --oneline thumbnails-redo ^main` — 14 commits, one per task.
- [ ] `npx tsc --noEmit -p .` — clean.
- [ ] `npx vitest run` — green.
- [ ] `rtk cargo test --manifest-path src-tauri/Cargo.toml` — green.
- [ ] `rtk grep -n "set_thumbnail_priority\|PriorityContext\|stripFramesBySource\|hoverFramesByHash" src src-tauri/src` — no matches.
- [ ] `npm run tauri dev` smoke checklist (Task 14) passed.

If all green, open the PR with the spec linked in the body.
