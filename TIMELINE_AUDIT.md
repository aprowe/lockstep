# Timeline Audit — 2026-05-12

Audit of `src/components/WarpView.tsx`, `src/components/CanvasTimeline.tsx`, and `src/timeline/controller.ts`. Performed in worktree `worktree-timeline-audit` (no code changes; analysis only).

## Files audited

| File | LOC | Shape |
|---|---|---|
| `WarpView.tsx` | 717 | Wrapper component: reads ~25 Redux selectors, derives ~15 memos, passes ~60 props down to CanvasTimeline |
| `CanvasTimeline.tsx` | 1,674 | Canvas renderer + interaction adapter. One `draw()` function spans **~850 lines** |
| `src/timeline/controller.ts` | 1,296 | Pure gesture state machine. Three drag branches in `pointerMove` are each 100–150 lines |

Plus the supporting `src/timeline/model/` modules (beatMap, clipoutProjection, conform, linkState, etc.) which are already cleanly factored.

---

## Cleanup opportunities (ranked by ROI)

### 1. Split `CanvasTimeline.draw()` into per-layer functions — biggest readability win

Lines 290–1142 are a single function drawing every visual element. Comment headers already mark the seams:
- backgrounds, minimap, time ruler, scenes, regions, through-lines, region envelopes, warp zone, snap hints, anchor markers, beat ruler, speed strip, playhead, hover cursor, lasso rect.

Each becomes a 30–100 LOC function with narrow params. No net LOC change, but the file becomes navigable. Inner helpers (`drawRegions`, `drawAnchorIn`, `drawAnchorOut`, `vline`, `drawSnapHint`) already point at this pattern — finish the job.

### 2. Lift `CanvasTimelineToolbar` to its own file

Lines 1539–1674 (135 LOC). It's a separate component with its own props; it only lives in this file for proximity. Moving it shrinks `CanvasTimeline.tsx` by ~135 LOC and removes confusion about file scope.

### 3. Fix the duplicate theme/palette indirection

CanvasTimeline has **two parallel palettes**:
- Module-level constants (`BG0`, `MARKER_COLOR`, ...) — used as fallbacks.
- `themeRef.current` — actual runtime CSS-var values, refreshed on theme change.

Inside `draw()`, locals shadow the module constants with theme values via `/* eslint-disable @typescript-eslint/no-shadow */`. This is a code smell. Pick one source (`themeRef.current`) and pass it explicitly to each layer function.

### 4. Extract `controller.pointerMove` drag branches

The three big branches in `pointerMove` are each enormous:
- `anchor` drag: ~185 LOC (lines 520–704)
- `region-edge` drag: ~110 LOC (lines 707–816)
- `region-move` drag: ~165 LOC (lines 819–985)

Pull each into a top-level `handleAnchorMove(drag, e, snap): Intent[]`, `handleRegionEdgeMove(...)`, `handleRegionMoveMove(...)`. The dispatcher becomes a 10-line switch.

**Caveat:** each helper has to re-narrow `drag` to its kind. Acceptable.

### 5. Reuse `beatMap.origToBeat` in WarpView

`WarpView.tsx` lines 227–255 duplicate `origToBeat` / `beatToOrig`. `src/timeline/model/beatMap.ts` already exports `origToBeat`; CanvasTimeline uses it via `liveOrigToBeat`. WarpView's variant exists only because it uses a clip-scoped anchor list — add a `scope?` parameter to beatMap and delete WarpView's copy.

### 6. Centralize `CLIP_PALETTE`

Defined twice with identical values:
- `WarpView.tsx:287` (`PALETTE`)
- `CanvasTimeline.tsx:68` (`CLIP_PALETTE`)

Move to `src/timeline/palette.ts`.

### 7. Extract two small hooks from WarpView

- `usePanGesture` — middle-mouse / shift+drag pan (lines 382–425, ~45 LOC).
- `useTimelineKeyboardShortcuts` — Delete / undo / redo (lines 352–377, ~25 LOC).

---

## Should WarpView become a connected component?

**Yes — mostly.** The current setup is a hybrid: WarpView already does `useAppSelector` for 25+ pieces of state *and* receives 25+ props from `CenterColumn`. Roughly **80% of the prop surface is Redux plumbing** that `CenterColumn` assembles as `(arg) => dispatch(thunk(arg))` wrappers — about 100 lines of pure indirection.

### Props that should move into WarpView (≈80%)

- `clipOverlays` — derived from `regions + activeRegionId + selectedClipSet`, all already in Redux.
- `scenes`, `scannedRanges`, `userSceneTimes`, `selectedSceneTimes`, `selectedClipIds` — selectors.
- `onSceneAdd`, `onSceneDelete`, `onClipsSelectionChange`, `onScenesSelectionChange` — thin `dispatch(action)` wrappers.
- `onClipOverlayResize`, `onClipOverlayMove`, `onClipOverlayZoom` — thunks.
- `onTimelineDelete`, `onTimelineDeselect` — thunks.

### Props that are genuinely external (≈20%)

These don't disappear by making the component connected — they need a deliberate decision per item:

1. **`onSeek={t => playerRef.current?.seek(t)}`** — imperative video element ref, owned by CenterColumn. Either:
   - Make a `usePlayback()` hook that exposes `seek()`.
   - Move `playerRef` to a small module so WarpView can call it directly.
   - Or keep this one prop.
2. **`preZoomView.current`** — used by `onZoomToRegion` and `onClipOverlayZoom` for the zoom-toggle behavior. Move to `uiSlice` as `viewBeforeZoom`. It's view state.
3. **`onClipOverlayContextMenu`** — opens CenterColumn's `clipContextMenu` portal state. Either:
   - Move into WarpView (it already owns an anchor context menu).
   - Move to a global menu slice.
4. **`onSendToNewRegion` / `addRegion`** — make this a thunk. There's no reason it isn't one already.

### Why the answer is yes

- Single-instance, single-purpose component in a desktop app. No "reuse in another context" concern to preserve a clean prop interface for.
- Tests already mount WarpView via the Redux store (`tests/harnesses/`), so connectedness doesn't break the test pattern.
- The current hybrid is the worst of both worlds: Redux is the source of truth, but `CenterColumn` pretends to be the source of truth for half the data by relaying it as props. You have to grep two files to understand any data flow.

### Net effect after refactor

- WarpView prop surface: **~25 props → ~1–3 props**.
- CenterColumn's WarpView block: **~100 lines → ~5 lines**.

### Honest caveat

Don't do this in isolation. The cleanup is only worth it if you also resolve items 1–4 above. Otherwise you've just renamed the problem. Also: run the BDD suite afterward — region/clip overlay interaction has spec coverage that catches regressions.

---

## Tradeoffs to weigh before refactoring

- Splitting `draw()` adds function-call overhead per redraw. It's negligible (15 calls × 60fps) but worth a quick before/after profile.
- The conform/clipout paths in CanvasTimeline are dense with bug-fix context — comments reference "Bug G/H", "Slice B". The comments are load-bearing. Don't refactor these without verifying tests pass.
- Grouping the 60+ props on `<CanvasTimeline>` into bundles (`onAnchorEvents={...}`, `onRegionEvents={...}`) just hides what's wired. Skip.

## What to leave alone

- The controller's per-drag commit emission in `pointerUp` looks redundant with `pointerMove`'s live commits, but the live ones skip when `!moved` (under threshold). Correct as-is.
- `src/timeline/model/*` — already cleanly factored into single-purpose modules with their own tests. No work needed here.

---

## Recommended order

If you decide to do this, work in this order to keep blast radius small and tests green at every step:

1. Lift `CanvasTimelineToolbar` to its own file (#2). Trivial, no risk.
2. Centralize `CLIP_PALETTE` (#6). Trivial.
3. Reuse `beatMap.origToBeat` in WarpView (#5). Localized to one function pair.
4. Extract `usePanGesture` and `useTimelineKeyboardShortcuts` from WarpView (#7).
5. Split `CanvasTimeline.draw()` into per-layer functions (#1). One layer at a time; run BDD tests between each.
6. Fix the duplicate theme/palette indirection (#3). Comes naturally with #5.
7. Extract `pointerMove` drag branches in controller (#4). Run `tests/bdd/timeline/clip-bounds.test.ts` and `drag.test.ts` after.
8. Make WarpView fully connected. Resolve `playerRef`, `preZoomView`, `clipContextMenu`, `addRegion` first per the four items above.

Steps 1–4 are mechanical and low-risk. Step 5 is the biggest readability win. Step 8 is the structural payoff.
