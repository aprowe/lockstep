# Condensed Timeline Mode

## Summary

A second timeline mode that replaces the canvas timeline's normal multi-track view with a single, LosslessCut-style overlaid row. Same look and feel, same gestures, same controller — pointer-drag on the body defaults to scrubbing the playhead. Existing select / lasso / item-drag behaviour is reached by holding the lasso modifier.

This is a view-mode flag on the existing `CanvasTimeline`, not a sibling component. The constraint pipeline, replay machinery, slices, and intent dispatcher are untouched.

## Goals

- Provide a condensed read/scrub-first timeline for navigation-heavy workflows.
- Keep the warp mode behaviour bit-identical when the flag is off.
- Reuse one controller, one canvas, one set of intent handlers.

## Non-goals

- No new editing affordances. Anchors, regions, scenes are read-only by default in this mode; edits remain available only via the modifier override.
- No persistence migration. Pre-release app, no shims.
- No new BDD coverage in `spec/` for this feature (deferred per user direction).

## UX

### Toggle

- Menu: **View → Condensed Timeline** (checkbox).
- Hotkey: `Shift+T` (registered in `src/hotkeys.ts`; final binding to be confirmed with user).
- Scope: global app setting, persisted in `settings` (not per-video).
- Default: `'warp'`.

### Condensed layout

One row, overlaid in z-order from bottom to top:

1. **Region bars** — full row height (~48px), current region palette, name label clipped to bar width.
2. **Scene cuts** — full-row 1px vertical lines, low alpha so regions remain readable.
3. **Anchors** — small pins (~10px) along the row baseline, in/out variants visually distinct as today.
4. **Playhead** — full-row vertical line, on top.

Ruler (top) and minimap (bottom) are unchanged.

### Interaction

- **Drag on body (no modifier)** — scrubs the playhead. Emits `SetPlayhead` on every move.
- **Click on item** — selects it, same semantics as warp mode (movement under `DRAG_THRESHOLD_PX_SQ` is a click).
- **Drag with lasso modifier held** — falls through to the existing controller paths (lasso on empty, item drag on anchors/regions/edges).
- **Wheel zoom, wheel pan, keyboard, double-click, context menu, minimap recenter** — unchanged.

## Architecture

### State

- `uiSlice` gains `timelineMode: 'warp' | 'condensed'`, default `'warp'`.
- Reducers: `setTimelineMode(mode)`, `toggleTimelineMode()`.
- Persisted via existing `settings` flow (UI scale / theme already follow this pattern — confirm `uiSlice` is in the persisted set; if not, move the flag to `settingsSlice`).

### Snapshot

- `Snapshot` in `src/timeline/types.ts` gets a `timelineMode` field, populated by `CanvasTimeline.tsx` from the selector.
- All downstream pure modules (`layout.ts`, `hitTest.ts`, `controller.ts`) branch on `snap.timelineMode`.

### Layout (`src/timeline/layout.ts`)

- New `condensedLayout(snap)` branch returning the same `Layout` shape (ruler rect, track rects, minimap rect) with a single ~48px overlaid track.
- Existing warp layout untouched.

### Hit test (`src/timeline/hitTest.ts`)

- New condensed branch returns the existing hit kinds: `anchor`, `regionEdge`, `regionBody`, `empty` — plus `sceneCut` (new, hit-testable but not yet draggable; reserved for future "jump to next cut" affordance).
- Priority: `anchor > regionEdge > regionBody > sceneCut > empty`.

### Controller (`src/timeline/controller.ts`)

Two narrow changes, both gated on `snap.timelineMode === 'condensed'`:

1. **`pointerDown` default → scrub.** If no modifier is held and the hit is on the row body (anchor/regionEdge/regionBody/empty), start `DragState{kind:'scrub'}` and emit `SetPlayhead` at the cursor's time. `pointerMove` emits `SetPlayhead` again. `pointerUp` clears the drag.
2. **Modifier override.** If the lasso modifier is held at `pointerDown`, the controller skips the scrub branch entirely and runs the existing warp-mode pointerDown logic verbatim.

Selection-by-click is preserved: the existing `pendingSelect` path runs alongside the scrub drag and is finalised on `pointerUp` if movement stayed under threshold.

`DragState` gets one new variant:

```ts
type ScrubDragState = { kind: 'scrub'; startClientX: number; startClientY: number; moved: boolean };
```

### Intents

New intent kind:

```ts
{ kind: 'SetPlayhead'; tSec: number }
```

Wired into the existing intent dispatcher. Writes `warp.playhead` directly. Not routed through the constraint pipeline (not an entity edit), not snapshotted into history (scrubbing is transient navigation).

### Rendering

- The canvas renderer (`CanvasTimeline.tsx` and its helpers) branches on `timelineMode` and draws the condensed row using the existing primitives (region bar, anchor pin, playhead line, scene tick). No new colors or shaders — palette comes from `src/timeline/palette.ts`.

## Open questions

- **Hotkey binding.** Tentatively `Shift+T`; confirm.
- **Lasso modifier identity.** The controller already keys lasso intent off a specific modifier; need to confirm which (likely shift or alt) when wiring the override branch — a grep through `controller.ts` will resolve at implementation time.
- **Persistence slice.** Whether `timelineMode` lives in `uiSlice` or `settingsSlice` depends on which is included in the persistence flow.

## Testing

Unit (`tests/unit/`):

- `unit-layout-condensed.test.ts` — condensed layout geometry; ruler/minimap unaffected.
- `unit-hittest-condensed.test.ts` — priority order against fixture snapshots.
- `unit-controller-condensed.test.ts` —
  - pointerDown on body → emits `SetPlayhead`, sets `DragState{kind:'scrub'}`.
  - pointerMove during scrub → emits `SetPlayhead` at new cursor time.
  - pointerDown with modifier → runs warp-mode logic (lasso on empty, drag on items).
  - Click on anchor (no movement) still selects.
  - Wheel zoom / keyboard / double-click identical to warp mode (parameterized).

Scenario (`tests/unit/constraints/`):

- `scenario-condensed-mode.test.ts` —
  - Toggling mode mid-session does not mutate anchors/regions.
  - Scrubbing does not push a history snapshot.
  - Modifier-held drag on an anchor still routes through the constraint pipeline correctly.

No `spec/` changes (deferred).

## Rollout

Single PR. Default off. No migration.
