# Timeline shrink: drop tracks from the bottom

## Problem

The center-column timeline has a hard minimum height (`MIN_TIMELINE = 60`). Below
that minimum the resizer stops; above it, `buildLayout` enters a `tightFit` mode
that scales every track proportionally so nothing spills past the bottom. The
result is that pulling the resizer down past a point produces uniformly tiny,
unreadable tracks rather than a smaller-but-still-usable timeline.

## Goal

When the timeline shrinks, keep the top tracks at their natural size and drop
the bottom ones instead of squishing the whole stack. The minimap (overview)
band always stays visible; only data tracks are dropped.

## Behavior

- `MIN_TIMELINE`: `60` → `25` (= `MINIMAP_H` + 1px separator). Keeps the minimap
  visible at the floor and leaves the resizer grabbable. No separate collapse
  control is needed.
- `buildLayout` (`src/timeline/layout.ts`) is rewritten to walk visible tracks
  top → bottom, consuming `available` height:
  1. Each track gets its preferred height (or override, if set) plus the 1px
     row separator, while there is room for it.
  2. When a track does not fit at its preferred height, it is given the
     remaining slack as its height (partial render — produces a smooth resize
     instead of a discrete jump). If the slack is `< 1px`, the track is
     dropped instead.
  3. Every track after that is dropped.
  4. If all tracks fit at preferred and there is leftover slack, flex tracks
     split it exactly as today.
- The existing track-visibility toggle continues to work; this new logic
  applies on top of the already-filtered `visible` set.
- The proportional `tightFit` branch (current lines 52–57) is removed.

## Non-goals

- No change to which tracks count as `flex` / non-flex.
- No change to the visibility toggle UI or the per-row override map.
- No change to `WarpView` — it already renders only the rows `buildLayout`
  returns and hit-tests against `y` / `h`.

## Test

A unit test in `tests/unit/timeline/` (creating the file if needed) covering
`buildLayout` at representative `totalH` values:

- Large `totalH`: every track present at preferred size or larger (flex slack).
- Mid `totalH`: top N tracks at preferred, last visible track partially
  shrunk, remaining tracks absent from the returned array.
- `totalH = 25` (floor): only the minimap-driven setup — empty visible array.

The assertions check `result.length`, each entry's `id`, and that `y + h` never
exceeds `totalH`.
