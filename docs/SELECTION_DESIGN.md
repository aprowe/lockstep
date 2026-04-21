# Selection System — Design

Goal: let the user select markers, marker-out, scene markers, and region/clips
— separately or together — so they can be bulk-deleted. Active-clip state
remains an independent concept.

## Data

New `selectionSlice`:

```ts
interface SelectionState {
  markersIn:  number[]  // ids into warp.origAnchors
  markersOut: number[]  // ids into warp.beatAnchors
  scenes:     number[]  // scene ids
  regions:    string[]  // region ids
}
```

Arrays for Redux serializability. Selectors memoize `Set<T>` for O(1) lookup
during render.

`activeRegionId` stays on `regionSlice`. Active ≠ selected: a region can be
active, selected, both, or neither.

## Actions

- `select({ kind, id, mode })` — `mode: 'replace' | 'toggle' | 'add'`
- `selectMany({ additions, mode })` — partial per-kind id lists; used by lasso
- `clear({ kind? })` — one kind or all
- thunk `deleteSelected()` — fans out to per-slice deletes, then clears

## Interactions

| Gesture | Effect |
|---|---|
| Click item | Replace selection within that kind; other kinds untouched |
| Ctrl/Cmd-click | Toggle within that kind |
| Click background | `clear()` — all kinds |
| Lasso drag | `selectMany` over whichever kinds the drag covers (see below) |
| Delete / Backspace | `deleteSelected` thunk, bound at App level |

Lasso section → kinds:
- `markerin` → markersIn
- `markerout` → markersOut
- `warp` → markersIn + markersOut
- `scene` → scenes
- `clipin` / `clipout` → regions
- multi-section (vertical drag) → union of the sections crossed

## Visual states

- MarkersTrack / MarkerOut: already have selected styling. Keep.
- SceneRow: new `.scene-marker--selected` modifier (bright outline).
- RegionBand: new `--selected` state distinct from `--active`. Both can
  stack — e.g. selected non-active = stroke-only; active-and-selected =
  stroke + fill.

## Main tradeoff — paired markers

Today, anchor id N identifies both the orig anchor and the beat anchor
(paired). The current "selectedAnchorIds" set lights both up together.

Separating `markersIn` / `markersOut` breaks that. Proposed resolution:

- Pairing is visual only (through-lines still connect pairs).
- Selection is per-side. A warp-section lasso selects both sides
  symmetrically so the user can still operate on pairs.
- If the user ever wants paired co-selection, it's a 2-line mirror in
  `select` — cheap to add later.

## Open question

Should clicking a marker clear region selection, or only clear markers
of that kind? Lean: clear only that kind, since the whole point of the
system is cross-type multi-select for bulk delete.

## Implementation sketch (rough order)

1. `selectionSlice.ts` + selectors (returns `Set`s).
2. Wire MarkersTrack to read from the new slice (replaces local state in
   WarpView).
3. Add selected state + CSS to SceneRow and RegionBand.
4. Extend `computeLassoIds` in ThinTimeline to cover scenes + regions
   based on sectionId.
5. `deleteSelected` thunk + keyboard binding (Delete / Backspace) at App
   or ThinTimeline root.
6. Tests: selection reducers; lasso-across-kinds; bulk-delete thunk.
