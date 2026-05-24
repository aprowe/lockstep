# Condensed Timeline Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `condensed` view mode to `CanvasTimeline` that overlays the ruler, regions, scene cuts, anchors, and playhead onto a single ~48px row. Pointer-drag on the body scrubs the playhead; holding **Alt** falls through to the existing select/lasso/item-drag behaviour. Toggle via **View → Condensed Timeline** and hotkey **Shift+T**.

**Architecture:** A single `timelineMode: 'warp' | 'condensed'` flag on `uiSlice` (persisted alongside the existing `TimelinePrefs`). The flag flows into the `Snapshot` and three pure modules branch on it: `layout.ts` produces a one-row layout, `hitTest.ts` resolves hits against the new geometry, `controller.ts` adds a `scrub` `DragState` branch with an Alt-modifier override. A new `SetPlayhead` intent writes `warp.playhead` directly — no constraint pipeline, no history snapshot.

**Tech Stack:** TypeScript, React, Redux Toolkit, Vitest, Tauri v2. Spec: `docs/superpowers/specs/2026-05-24-condensed-timeline-mode-design.md`.

---

## File map

**Modify:**
- `src/store/slices/uiSlice.ts` — add `timelineMode` state + reducers + persistence.
- `src/timeline/types.ts` — `timelineMode` field on `Snapshot`, `ScrubDragState` variant on `DragState`, `SetPlayhead` intent kind.
- `src/timeline/layout.ts` — `condensedLayout` branch.
- `src/timeline/hitTest.ts` — `condensedHitTest` branch.
- `src/timeline/controller.ts` — `pointerDown` scrub branch + Alt-override + `pointerMove` scrub branch.
- `src/components/CanvasTimeline.tsx` — read `timelineMode`, pass into snapshot, branch render, handle `SetPlayhead` intent in `applyIntents`.
- `src/hotkeys.ts` — register `toggle-condensed-timeline` under View category.
- `src/menus.ts` — add View → Condensed Timeline menu item.

**Create:**
- `tests/unit/unit-layout-condensed.test.ts`
- `tests/unit/unit-hittest-condensed.test.ts`
- `tests/unit/unit-controller-condensed.test.ts`
- `tests/unit/constraints/scenario-condensed-mode.test.ts`

---

## Task 1: Add `timelineMode` to `uiSlice` with persistence

**Files:**
- Modify: `src/store/slices/uiSlice.ts`

- [ ] **Step 1: Extend `TimelinePrefs` and `UiState`**

In `src/store/slices/uiSlice.ts`:

Add to the `TimelinePrefs` interface (after `alwaysScenes`):
```ts
timelineMode: "warp" | "condensed";
```

Add to `DEFAULT_TIMELINE_PREFS`:
```ts
timelineMode: "warp",
```

In `loadTimelinePrefs`, add the parser entry following the existing pattern:
```ts
timelineMode:
    p.timelineMode === "warp" || p.timelineMode === "condensed"
        ? p.timelineMode
        : DEFAULT_TIMELINE_PREFS.timelineMode,
```

In `saveTimelinePrefs`, add to the prefs object:
```ts
timelineMode: state.timelineMode,
```

Add to `UiState` (after `timelineAlwaysScenes`):
```ts
timelineMode: "warp" | "condensed";
```

Add to `initialState`:
```ts
timelineMode: _prefs.timelineMode,
```

- [ ] **Step 2: Add reducers**

Append to the `reducers` block in `uiSlice`:
```ts
setTimelineMode(state, action: PayloadAction<"warp" | "condensed">) {
    state.timelineMode = action.payload;
    saveTimelinePrefs(state);
},
toggleTimelineMode(state) {
    state.timelineMode = state.timelineMode === "warp" ? "condensed" : "warp";
    saveTimelinePrefs(state);
},
```

Export them from the `uiSlice.actions` destructure at the bottom of the file.

- [ ] **Step 3: Type check passes**

Run: `npm run build` (or `npx tsc --noEmit`)
Expected: PASS

- [ ] **Step 4: Commit**

```bash
rtk git add src/store/slices/uiSlice.ts
rtk git commit -m "feat(ui): add timelineMode state to uiSlice"
```

---

## Task 2: Register hotkey and menu entry

**Files:**
- Modify: `src/hotkeys.ts`
- Modify: `src/menus.ts`

- [ ] **Step 1: Register the hotkey**

In `src/hotkeys.ts`, add to the View section of the `HOTKEYS` array (before `show-shortcuts`):
```ts
{
    id: "toggle-condensed-timeline",
    keys: "Shift+T",
    label: "Toggle condensed timeline",
    category: "View",
},
```

- [ ] **Step 2: Locate the View menu builder**

Grep for `buildViewMenu` in `src/menus.ts` (or whichever name builds the View top-level menu). Read its `Deps` interface and existing entries.

- [ ] **Step 3: Add the menu entry**

In the View menu deps interface, add:
```ts
timelineMode: "warp" | "condensed";
toggleTimelineMode: () => void;
```

In the View menu items array, add (place near other view toggles like `warpCollapsed`):
```ts
{
    label: "Condensed Timeline",
    checked: d.timelineMode === "condensed",
    accelerator: "Shift+T",
    action: d.toggleTimelineMode,
},
```

(If the menu API uses a different `checked` field name, match the existing pattern used by `warpCollapsed` or similar checkbox entries — read one before writing.)

- [ ] **Step 4: Wire deps from MenuBar consumer**

Grep for where the View menu is constructed (likely `App.tsx` or `MenuBar`'s host). Add to the dep object:
```ts
timelineMode,           // from useAppSelector((s) => s.ui.timelineMode)
toggleTimelineMode: () => dispatch(toggleTimelineMode()),
```

Import `toggleTimelineMode` from `./store/slices/uiSlice`.

- [ ] **Step 5: Bind the hotkey**

Grep for the global hotkey dispatcher (likely a `useEffect` keyed off `HOTKEYS` ids in `App.tsx` or a `useHotkeys` hook). Add a handler for `toggle-condensed-timeline`:
```ts
case "toggle-condensed-timeline":
    dispatch(toggleTimelineMode());
    return;
```

If the codebase uses a different binding pattern (e.g. a switch in a keydown listener that consults `e.key` and `e.shiftKey`), add an equivalent branch matching `e.key === "T" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey`.

- [ ] **Step 6: Manual smoke check**

Run `npm run tauri dev`. Press Shift+T. Verify View menu shows "Condensed Timeline" with a checkbox that toggles. The visual change won't appear yet — that's Tasks 4–8.

- [ ] **Step 7: Commit**

```bash
rtk git add src/hotkeys.ts src/menus.ts src/App.tsx
rtk git commit -m "feat(menu): View → Condensed Timeline toggle + Shift+T"
```

(Adjust `git add` to whichever files were actually touched.)

---

## Task 3: Add `timelineMode` to `Snapshot` and `DragState`

**Files:**
- Modify: `src/timeline/types.ts`

- [ ] **Step 1: Add `timelineMode` to `Snapshot`**

In `src/timeline/types.ts`, add to the `Snapshot` interface (next to `followDrag`):
```ts
/** Which timeline mode is active. 'warp' is the default multi-track view;
 *  'condensed' is a single overlaid row with scrub-by-default drag. */
timelineMode: "warp" | "condensed";
```

- [ ] **Step 2: Add the scrub `DragState` variant**

In the `DragState` union, append:
```ts
| {
      kind: "scrub";
      startClientX: number;
      startClientY: number;
      moved: boolean;
  }
```

- [ ] **Step 3: Add the `SetPlayhead` intent**

In the `Intent` union, append (group with other commits near `seek`):
```ts
/** Condensed-mode scrub: write `warp.playhead` directly. Not routed
 *  through the constraint pipeline; not snapshotted into history. */
| { kind: "SetPlayhead"; tSec: number }
```

- [ ] **Step 4: Type check**

Run: `npx tsc --noEmit`
Expected: errors about `timelineMode` missing in every Snapshot construction site. Note them — they're fixed in Task 9.

- [ ] **Step 5: Commit (allow type errors temporarily)**

```bash
rtk git add src/timeline/types.ts
rtk git commit -m "feat(timeline): add timelineMode + ScrubDragState + SetPlayhead intent types"
```

---

## Task 4: Implement `condensedLayout` (TDD)

**Files:**
- Create: `tests/unit/unit-layout-condensed.test.ts`
- Modify: `src/timeline/layout.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/unit-layout-condensed.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildLayout, MINIMAP_H } from "../../src/timeline/layout";

describe("condensed layout", () => {
    it("produces exactly one track when timelineMode is 'condensed'", () => {
        const tracks = buildLayout(false, 200, {}, "condensed");
        expect(tracks).toHaveLength(1);
        expect(tracks[0]?.id).toBe("condensed");
        expect(tracks[0]?.y).toBe(MINIMAP_H + 1);
    });

    it("condensed track height fills available space below minimap", () => {
        const tracks = buildLayout(false, 200, {}, "condensed");
        const total = (tracks[0]?.h ?? 0) + MINIMAP_H + 1;
        expect(total).toBeCloseTo(200, 0);
    });

    it("warp mode still returns the existing multi-track layout", () => {
        const tracks = buildLayout(false, 400, {}, "warp");
        expect(tracks.length).toBeGreaterThan(1);
        expect(tracks.some((t) => t.id === "warp")).toBe(true);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/unit-layout-condensed.test.ts`
Expected: FAIL — `buildLayout` does not accept a 4th arg / returns multi-track output.

- [ ] **Step 3: Extend `buildLayout`**

In `src/timeline/layout.ts`, change the signature and body:

```ts
export function buildLayout(
    warpCollapsed: boolean,
    totalH: number,
    overrides: Record<string, number> = {},
    timelineMode: "warp" | "condensed" = "warp",
): LayoutTrack[] {
    if (timelineMode === "condensed") {
        const available = totalH - MINIMAP_H - 1;
        return [
            {
                id: "condensed",
                label: "Condensed",
                h: Math.max(0, available),
                space: "input",
                flex: 1,
                y: MINIMAP_H + 1,
            },
        ];
    }
    // existing implementation unchanged below
    const visible = ALL_TRACKS.filter((def) => !(warpCollapsed && def.space !== "input"));
    // ... rest of function as before
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/unit-layout-condensed.test.ts`
Expected: PASS.

- [ ] **Step 5: Confirm no warp-mode regressions**

Run: `npm run test:unit -- timeline/layout` (or `npx vitest run tests/ -t layout`)
Expected: any existing layout tests still pass.

- [ ] **Step 6: Commit**

```bash
rtk git add src/timeline/layout.ts tests/unit/unit-layout-condensed.test.ts
rtk git commit -m "feat(timeline): condensedLayout produces single overlaid row"
```

---

## Task 5: Implement condensed hit-test (TDD)

**Files:**
- Create: `tests/unit/unit-hittest-condensed.test.ts`
- Modify: `src/timeline/hitTest.ts`

- [ ] **Step 1: Read existing hit-test**

Read `src/timeline/hitTest.ts` end-to-end. Note the `HitResult` (or equivalent) return type and how it currently dispatches per-track. The condensed branch must return the same kinds — `anchor`, `regionEdge`, `regionBody`, `empty` — plus a new `sceneCut`.

- [ ] **Step 2: Add `sceneCut` to the hit-result type (if not already present)**

In `src/timeline/hitTest.ts` (or wherever the result type lives), add a `sceneCut` variant:
```ts
| { kind: "sceneCut"; time: number }
```

If the project already represents scene-cut hits some other way, reuse that — do not duplicate.

- [ ] **Step 3: Write the failing test**

Create `tests/unit/unit-hittest-condensed.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hitAt } from "../../src/timeline/hitTest";
import type { Snapshot } from "../../src/timeline/types";

function condensedSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
    // Build a minimal snapshot with timelineMode: 'condensed'. Use the
    // codebase's test fixture helper if one exists (grep for makeSnapshot
    // in tests/helpers); otherwise inline-construct with the fields the
    // hit-test reads.
    return {
        view: { start: 0, end: 10 },
        duration: 10,
        outputDuration: 10,
        maxDuration: 10,
        anchors: [],
        beatAnchors: [],
        linkedBeatIds: new Set(),
        selectedOrigAnchorIds: new Set(),
        selectedBeatAnchorIds: new Set(),
        regions: [],
        regionDetails: [],
        selectedClipinIds: new Set(),
        selectedClipoutIds: new Set(),
        scenes: [],
        selectedSceneTimes: new Set(),
        segments: [],
        bpm: 120,
        followDrag: false,
        warpCollapsed: false,
        canvas: { width: 1000, height: 100 },
        tracks: [
            { id: "condensed", label: "Condensed", h: 76, space: "input", flex: 1, y: 25 },
        ],
        hits: [],
        timelineMode: "condensed",
        ...overrides,
    } as Snapshot;
}

describe("condensed hit-test priority", () => {
    it("returns 'empty' when no entities are at the cursor", () => {
        const snap = condensedSnapshot();
        const hit = hitAt(500, 60, snap);
        expect(hit.kind).toBe("empty");
    });

    it("prefers anchor over region body at the same x", () => {
        const snap = condensedSnapshot({
            anchors: [{ id: 1, time: 5 }],
            regions: [{ id: "r1", inPoint: 4, outPoint: 6 }],
        });
        // x for time=5 in a 1000px canvas, view 0..10 → x=500
        const hit = hitAt(500, 60, snap);
        expect(hit.kind).toBe("anchor");
    });

    it("prefers region edge over region body", () => {
        const snap = condensedSnapshot({
            regions: [{ id: "r1", inPoint: 4, outPoint: 6 }],
        });
        // x at inPoint=4 → x=400
        const hit = hitAt(400, 60, snap);
        expect(hit.kind).toBe("regionEdge");
    });

    it("prefers region body over scene cut", () => {
        const snap = condensedSnapshot({
            regions: [{ id: "r1", inPoint: 4, outPoint: 6 }],
            scenes: [5],
        });
        const hit = hitAt(500, 60, snap);
        expect(hit.kind).toBe("regionBody");
    });

    it("returns sceneCut when only a scene is at the cursor", () => {
        const snap = condensedSnapshot({ scenes: [5] });
        const hit = hitAt(500, 60, snap);
        expect(hit.kind).toBe("sceneCut");
    });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run tests/unit/unit-hittest-condensed.test.ts`
Expected: FAIL — condensed branch not implemented.

- [ ] **Step 5: Implement the condensed hit-test**

In `src/timeline/hitTest.ts`, at the top of `hitAt` (or whichever function the test imports), add:

```ts
if (snap.timelineMode === "condensed") {
    return hitAtCondensed(x, y, snap);
}
```

Then add `hitAtCondensed`:

```ts
function hitAtCondensed(x: number, y: number, snap: Snapshot): HitResult {
    const track = snap.tracks.find((t) => t.id === "condensed");
    if (!track || y < track.y || y > track.y + track.h) {
        return { kind: "empty" };
    }
    const tAtX = (px: number) =>
        snap.view.start + (px / snap.canvas.width) * (snap.view.end - snap.view.start);
    const xAtT = (t: number) =>
        ((t - snap.view.start) / (snap.view.end - snap.view.start)) * snap.canvas.width;

    const ANCHOR_PX = 6;
    const EDGE_PX = 4;
    const SCENE_PX = 3;

    // 1. Anchor (highest priority)
    for (const a of snap.anchors) {
        if (Math.abs(xAtT(a.time) - x) <= ANCHOR_PX) {
            return { kind: "anchor", id: a.id };
        }
    }

    // 2. Region edge
    for (const r of snap.regions) {
        if (Math.abs(xAtT(r.inPoint) - x) <= EDGE_PX) {
            return { kind: "regionEdge", id: r.id, edge: "in" };
        }
        if (Math.abs(xAtT(r.outPoint) - x) <= EDGE_PX) {
            return { kind: "regionEdge", id: r.id, edge: "out" };
        }
    }

    // 3. Region body
    const t = tAtX(x);
    for (const r of snap.regions) {
        if (t >= r.inPoint && t <= r.outPoint) {
            return { kind: "regionBody", id: r.id };
        }
    }

    // 4. Scene cut
    for (const s of snap.scenes) {
        if (Math.abs(xAtT(s) - x) <= SCENE_PX) {
            return { kind: "sceneCut", time: s };
        }
    }

    return { kind: "empty" };
}
```

If the existing `HitResult` types use different field names (e.g. `kind: "region-edge"` with a hyphen, `regionId` instead of `id`), match the existing shape — these test assertions will need to be adjusted to match. Read the type definitions first and update the test assertions to match the canonical shape.

- [ ] **Step 6: Run the tests until they pass**

Run: `npx vitest run tests/unit/unit-hittest-condensed.test.ts`
Expected: PASS.

- [ ] **Step 7: Confirm warp-mode hit-tests still pass**

Run: `npm run test:unit -- hittest`
Expected: existing hit-test suite green.

- [ ] **Step 8: Commit**

```bash
rtk git add src/timeline/hitTest.ts tests/unit/unit-hittest-condensed.test.ts
rtk git commit -m "feat(timeline): condensed hit-test with anchor>edge>body>scene priority"
```

---

## Task 6: Controller scrub-drag + Alt override (TDD)

**Files:**
- Create: `tests/unit/unit-controller-condensed.test.ts`
- Modify: `src/timeline/controller.ts`

- [ ] **Step 1: Read the existing controller**

Open `src/timeline/controller.ts`. Find:
- The `pointerDown` method on the controller object returned by the factory.
- The `pointerMove` and `pointerUp` methods.
- The point where the existing controller decides `kind: "lasso"` for empty area (around the `// Empty area — arm lasso` comment).

The scrub branch belongs at the **very top** of `pointerDown`, before any hit-test dispatch, so it short-circuits all other behaviour. The Alt-override is: if `e.altKey` is true, skip the scrub branch and fall through to existing logic.

- [ ] **Step 2: Write the failing tests**

Create `tests/unit/unit-controller-condensed.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createController } from "../../src/timeline/controller";
import type { Snapshot, PointerEventLike } from "../../src/timeline/types";

// Helper: minimal condensed snapshot. Reuse a project fixture if present.
function makeSnap(): Snapshot {
    return {
        view: { start: 0, end: 10 },
        duration: 10,
        outputDuration: 10,
        maxDuration: 10,
        anchors: [],
        beatAnchors: [],
        linkedBeatIds: new Set(),
        selectedOrigAnchorIds: new Set(),
        selectedBeatAnchorIds: new Set(),
        regions: [],
        regionDetails: [],
        selectedClipinIds: new Set(),
        selectedClipoutIds: new Set(),
        scenes: [],
        selectedSceneTimes: new Set(),
        segments: [],
        bpm: 120,
        followDrag: false,
        warpCollapsed: false,
        canvas: { width: 1000, height: 100 },
        tracks: [
            { id: "condensed", label: "Condensed", h: 76, space: "input", flex: 1, y: 25 },
        ],
        hits: [],
        timelineMode: "condensed",
    } as Snapshot;
}

function pe(x: number, opts: Partial<PointerEventLike> = {}): PointerEventLike {
    return {
        clientX: x,
        clientY: 60,
        button: 0,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        canvasRect: { left: 0, top: 0, width: 1000, height: 100 },
        ...opts,
    };
}

describe("controller condensed mode", () => {
    it("pointerDown emits SetPlayhead and starts scrub drag", () => {
        const c = createController();
        const intents = c.pointerDown(pe(500), makeSnap());
        const setPh = intents.find((i) => i.kind === "SetPlayhead");
        expect(setPh).toBeDefined();
        expect((setPh as { tSec: number }).tSec).toBeCloseTo(5, 2);
        expect(c.getDragState()?.kind).toBe("scrub");
    });

    it("pointerMove during scrub emits SetPlayhead at new cursor time", () => {
        const c = createController();
        c.pointerDown(pe(500), makeSnap());
        const intents = c.pointerMove(pe(700), makeSnap());
        const setPh = intents.find((i) => i.kind === "SetPlayhead");
        expect((setPh as { tSec: number }).tSec).toBeCloseTo(7, 2);
    });

    it("pointerUp clears the scrub drag", () => {
        const c = createController();
        c.pointerDown(pe(500), makeSnap());
        c.pointerUp(makeSnap());
        expect(c.getDragState()).toBeNull();
    });

    it("Alt-held pointerDown does NOT start a scrub", () => {
        const c = createController();
        const snap = makeSnap();
        c.pointerDown(pe(500, { altKey: true }), snap);
        expect(c.getDragState()?.kind).not.toBe("scrub");
    });

    it("Alt-held pointerDown on empty body arms the lasso (warp behaviour preserved)", () => {
        const c = createController();
        const snap = makeSnap();
        c.pointerDown(pe(500, { altKey: true }), snap);
        expect(c.getDragState()?.kind).toBe("lasso");
    });

    it("warp mode is unaffected (no scrub start, no SetPlayhead)", () => {
        const c = createController();
        const snap = { ...makeSnap(), timelineMode: "warp" as const };
        const intents = c.pointerDown(pe(500), snap);
        expect(intents.find((i) => i.kind === "SetPlayhead")).toBeUndefined();
        expect(c.getDragState()?.kind).not.toBe("scrub");
    });
});
```

(If `createController` is exported under a different name — read controller.ts — adjust the import.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/unit/unit-controller-condensed.test.ts`
Expected: FAIL — no scrub branch.

- [ ] **Step 4: Implement the scrub branch**

In `src/timeline/controller.ts`, at the very top of `pointerDown` (before any other logic):

```ts
// Condensed-mode scrub: pointer-drag on the body scrubs the playhead.
// Alt-held falls through to the existing warp-mode logic (lasso / drag).
if (snap.timelineMode === "condensed" && !e.altKey && e.button === 0) {
    const t = pxToT(mx(e), snap);
    drag = {
        kind: "scrub",
        startClientX: e.clientX,
        startClientY: e.clientY,
        moved: false,
    };
    return [
        { kind: "SetPlayhead", tSec: t },
        { kind: "dragStart" },
    ];
}
```

(Adjust `drag = ...` to match how the existing controller stores its drag state — likely an outer-scope variable like `dragState` or a `state.drag` field on a closure. Read the existing assignments.)

In `pointerMove`, near the top (before the other `drag.kind` branches):

```ts
if (drag?.kind === "scrub") {
    markMovedIfBeyondThreshold(drag, e);
    const t = pxToT(mx(e), snap);
    return [{ kind: "SetPlayhead", tSec: t }];
}
```

In `pointerUp`, add a branch that handles `scrub`:

```ts
if (drag?.kind === "scrub") {
    drag = null;
    return [{ kind: "dragEnd" }];
}
```

In `cancel()`, ensure the scrub drag is cleared too — match the pattern used for other drag kinds.

- [ ] **Step 5: Run tests until they pass**

Run: `npx vitest run tests/unit/unit-controller-condensed.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full controller suite to confirm no regressions**

Run: `npm run test:unit -- controller`
Expected: existing controller tests green.

- [ ] **Step 7: Commit**

```bash
rtk git add src/timeline/controller.ts tests/unit/unit-controller-condensed.test.ts
rtk git commit -m "feat(timeline): condensed-mode scrub drag with Alt override"
```

---

## Task 7: Scenario test — mode toggle, history isolation, modifier through-pipeline

**Files:**
- Create: `tests/unit/constraints/scenario-condensed-mode.test.ts`

- [ ] **Step 1: Write the scenario tests**

Create `tests/unit/constraints/scenario-condensed-mode.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import uiReducer, { setTimelineMode } from "../../../src/store/slices/uiSlice";
import warpReducer from "../../../src/store/slices/warpSlice";
import regionReducer from "../../../src/store/slices/regionSlice";
import historyReducer from "../../../src/store/slices/historySlice";
// Add any other slices the project tests usually configure — grep
// tests/helpers for a `makeStore` helper and reuse it if present.

function makeStore() {
    return configureStore({
        reducer: {
            ui: uiReducer,
            warp: warpReducer,
            region: regionReducer,
            history: historyReducer,
        },
    });
}

describe("scenario: condensed mode", () => {
    it("toggling mode does not mutate anchors or regions", () => {
        const store = makeStore();
        const anchorsBefore = store.getState().warp.anchors;
        const regionsBefore = store.getState().region.regions;
        store.dispatch(setTimelineMode("condensed"));
        expect(store.getState().warp.anchors).toBe(anchorsBefore);
        expect(store.getState().region.regions).toBe(regionsBefore);
    });

    it("scrubbing (SetPlayhead → setPlayhead) does not push history snapshots", async () => {
        const store = makeStore();
        const historyLenBefore = store.getState().history.past.length;
        // Dispatch the same action that the SetPlayhead intent handler will
        // dispatch (see Task 9 for the wiring; if `setPlayhead` is exported
        // from warpSlice, import and dispatch it directly here).
        const { setPlayhead } = await import("../../../src/store/slices/warpSlice");
        store.dispatch(setPlayhead(3.5));
        expect(store.getState().history.past.length).toBe(historyLenBefore);
    });
});
```

If the history middleware lives outside the reducer (in `store/middleware/historyMiddleware.ts`), include it in `makeStore` so the assertion is meaningful:

```ts
import { historyMiddleware } from "../../../src/store/middleware/historyMiddleware";
// ...
middleware: (gdm) => gdm().concat(historyMiddleware),
```

- [ ] **Step 2: Run tests until they pass**

Run: `npx vitest run tests/unit/constraints/scenario-condensed-mode.test.ts`
Expected: PASS. If `history.past` is undefined, inspect the actual history slice shape and adjust.

- [ ] **Step 3: Commit**

```bash
rtk git add tests/unit/constraints/scenario-condensed-mode.test.ts
rtk git commit -m "test: scenario-condensed-mode covers mode toggle + scrub history isolation"
```

---

## Task 8: Wire `SetPlayhead` intent and `timelineMode` in `CanvasTimeline`

**Files:**
- Modify: `src/components/CanvasTimeline.tsx`

- [ ] **Step 1: Read snapshot construction and applyIntents**

Grep `src/components/CanvasTimeline.tsx` for the function that builds the `Snapshot` passed into the controller (commonly named `buildSnapshot` or constructed inline). Also find `applyIntents` (or equivalent) — the function that consumes intents and dispatches to slices.

- [ ] **Step 2: Read `timelineMode` from the store**

Add:
```ts
const timelineMode = useAppSelector((s) => s.ui.timelineMode);
```

- [ ] **Step 3: Add `timelineMode` to the snapshot**

In every `Snapshot` literal constructed in this file, add:
```ts
timelineMode,
```

- [ ] **Step 4: Pass `timelineMode` to `buildLayout`**

Find every `buildLayout(...)` call site. Add the 4th argument:
```ts
buildLayout(warpCollapsed, height, overrides, timelineMode)
```

- [ ] **Step 5: Handle the `SetPlayhead` intent**

In `applyIntents`, add a case:

```ts
case "SetPlayhead":
    dispatch(setPlayhead(intent.tSec));
    break;
```

Import `setPlayhead` from `../store/slices/warpSlice` if not already imported. Confirm the action name — grep `setPlayhead|playhead` in `src/store/slices/warpSlice.ts`. If the action has a different name (e.g. `seekTo`, `setPlayheadTime`), match it.

- [ ] **Step 6: Type check**

Run: `npx tsc --noEmit`
Expected: PASS. All `Snapshot` construction sites now satisfy the new `timelineMode` requirement from Task 3.

- [ ] **Step 7: Commit**

```bash
rtk git add src/components/CanvasTimeline.tsx
rtk git commit -m "feat(canvas): wire timelineMode into snapshot + SetPlayhead intent handler"
```

---

## Task 9: Condensed render branch in `CanvasTimeline`

**Files:**
- Modify: `src/components/CanvasTimeline.tsx`

- [ ] **Step 1: Locate the canvas draw function**

Grep `CanvasTimeline.tsx` for the function that runs in the `useEffect`/`requestAnimationFrame` loop and draws onto the canvas context. It will iterate `snap.tracks` and call per-track drawing helpers (`drawTimeRuler`, `drawScenes`, `drawAnchors`, `drawRegions`, `drawWarp`, …).

- [ ] **Step 2: Add a condensed branch**

At the start of the draw function (after clearing the canvas and drawing the minimap), branch on `snap.timelineMode`:

```ts
if (snap.timelineMode === "condensed") {
    drawCondensed(ctx, snap);
    drawPlayhead(ctx, snap); // existing helper
    return;
}
// existing per-track loop below
```

- [ ] **Step 3: Implement `drawCondensed`**

Add a helper (place near the existing per-track draw helpers):

```ts
function drawCondensed(ctx: CanvasRenderingContext2D, snap: Snapshot) {
    const track = snap.tracks.find((t) => t.id === "condensed");
    if (!track) return;
    const xAtT = (t: number) =>
        ((t - snap.view.start) / (snap.view.end - snap.view.start)) * snap.canvas.width;

    // 1. Background (use the existing palette's track background color)
    ctx.fillStyle = PALETTE.trackBg;
    ctx.fillRect(0, track.y, snap.canvas.width, track.h);

    // 2. Ruler ticks across the top edge of the track (reuse drawTimeRuler
    //    or call the same tick-generation utility against a sub-rect of
    //    height ~16px at track.y).
    drawRulerInto(ctx, snap, { x: 0, y: track.y, w: snap.canvas.width, h: 16 });

    // 3. Region bars (full track height, low-saturation fill, label clipped)
    for (const r of snap.regions) {
        const x0 = xAtT(r.inPoint);
        const x1 = xAtT(r.outPoint);
        ctx.fillStyle = regionFill(r);
        ctx.fillRect(x0, track.y + 16, Math.max(1, x1 - x0), track.h - 16);
        // label (clip via save/clip/restore — match existing region label code)
    }

    // 4. Scene cuts (vertical lines, low alpha)
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = PALETTE.sceneCut;
    for (const s of snap.scenes) {
        const x = xAtT(s);
        ctx.beginPath();
        ctx.moveTo(x, track.y);
        ctx.lineTo(x, track.y + track.h);
        ctx.stroke();
    }
    ctx.restore();

    // 5. Anchors (small pins along the baseline)
    for (const a of snap.anchors) {
        drawAnchorPin(ctx, xAtT(a.time), track.y + track.h - 10);
    }
}
```

Notes for the implementer:
- `PALETTE` and per-entity colour helpers (`regionFill`, `drawAnchorPin`) likely already exist in `src/timeline/palette.ts` or as local helpers in `CanvasTimeline.tsx`. Reuse them — do not invent new colours.
- `drawRulerInto` may not exist with that name. If `drawTimeRuler` takes a track rect, call it. Otherwise extract the tick-drawing inner loop into a small helper and call both from the warp and condensed paths.
- Selection highlights: in v1 condensed mode, selected anchors and regions should still render with their existing selected appearance (since click-selection still works). Add the same selection rendering used by the warp path.

- [ ] **Step 4: Run the dev app and verify visually**

Run: `npm run tauri dev`. Open a video, drop a few anchors, create a region, run scene detection. Press **Shift+T**. Verify:
- The timeline collapses to a single overlaid row.
- Ruler ticks, region bars, scene-cut lines, anchor pins, and the playhead are all visible and aligned.
- Pressing Shift+T again restores the warp view exactly as before.
- Dragging on the body moves the playhead.
- Holding Alt and dragging on empty space draws the lasso.
- Holding Alt and dragging an anchor moves it (existing warp behaviour).

- [ ] **Step 5: Commit**

```bash
rtk git add src/components/CanvasTimeline.tsx
rtk git commit -m "feat(canvas): condensed-mode render branch (overlaid row)"
```

---

## Task 10: Full test sweep

- [ ] **Step 1: Run all unit tests**

Run: `rtk npm run test:unit`
Expected: all green.

- [ ] **Step 2: Run rust tests**

Run: `rtk npm run test:rs`
Expected: all green (no backend changes, sanity check only).

- [ ] **Step 3: Run typecheck and build**

Run: `rtk npm run build`
Expected: PASS.

- [ ] **Step 4: If any failures, fix and re-run before moving on**

- [ ] **Step 5: Final commit (only if fixes were needed)**

```bash
rtk git status
rtk git commit -am "fix: address test/build feedback for condensed timeline mode"
```

---

## Out of scope (deferred)

- `spec/features/condensed-timeline.feature` — user directed to skip `spec/` changes for now.
- Button-driven editing (delete region, jump to next scene, etc.) — v2.
- Scene-cut drag/edit in condensed mode — v2 (the hit-test already returns `sceneCut`; renderer draws them; controller leaves them inert).
- Per-video persistence of `timelineMode` — global only.
