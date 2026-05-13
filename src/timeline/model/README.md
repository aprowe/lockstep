# Timeline model layer

Pure, time-domain rules that the timeline depends on. No React. No Redux.
No DOM. No mutable module state. Functions in this directory take plain
data and return plain data.

Each rule is called from two places: the live-drag path (controller / canvas)
and the discrete-event path (Redux slices, thunks). Defining the rule here
once prevents the two paths from drifting apart.

Add a file here when you find a behavior that needs to fire both live
during a gesture and again on a discrete commit. Do NOT add anything here
that depends on canvas geometry, the gesture singleton, or React state —
that's the controller's job.

## Files

- `conform.ts` — clipout edges follow anchors that sit exactly on the
  region's input edges.
- `clampRegion.ts` — region in/out reconciliation: minimum length, swap
  shifting, boundary preservation.
- `snapTarget.ts` — context-aware snap target builders (anchor input,
  anchor output grid, region drag in either space) plus
  `smallestVisibleBeatGridSec` so output grids never snap to invisible ticks.
- `beatMap.ts` — anchor-pair list, piecewise input→beat mapping,
  `anchorBeatAt` exact-match lookup.
- `newRegionBounds.ts` — viewport-aware region creation rules (10%/5s
  span, scene/region neighbor clamping, "set out before in" fallback).
