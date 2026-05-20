# Legacy tests quarantined during Task 13 (dragCtxSlice dissolve)

These 14 test files were removed from the live test suite when `dragCtxSlice`
and its two mirror middlewares (`selectionGraphMirrorMiddleware`,
`anchorLockMirrorMiddleware`) were deleted. Each one imports at least one
deleted symbol (`dragCtxReducer`, `setSnapInstall`, `setLassoIds`,
`setAnchorLock`, `clearSnapInstall`, etc.).

They live here only for your review — vitest skips this folder via
`exclude: ['tests/_legacy-removed-task13/**']` in `vitest.config.ts`, and
tsconfig excludes it from type-checking.

## Categories

**Orphaned (slice/middleware no longer exists):**
- `dragCtxSlice.test.ts` — tested the deleted slice's reducers.
- `selectionGraphMirrorMiddleware.test.ts` — tested the deleted middleware.
- `anchorLockMirrorMiddleware.test.ts` — tested the deleted middleware.

**Drove tests by dispatching legacy actions instead of going through the
controller / profile path** (the behaviors they covered are still exercised
by `unit-pipeline-equivalence.test.ts`, the profile unit tests, and BDD
scenarios in `tests/bdd/timeline/`):
- `scenario-clipin-snap-directed-pair.test.ts`
- `scenario-clipin-snap-to-scene-marker.test.ts`
- `scenario-anchor-drag-into-snap-radius.test.ts`
- `scenario-clipin-edge-resize-snap-sweep-onto-diverged-anchor.test.ts`
- `scenario-conform-snap-decrement.test.ts`
- `scenario-conform-clipout-drag-both-edges.test.ts`
- `scenario-warp-connector-drag-live.test.ts`
- `scenario-drag-cancel.test.ts`
- `unit-anchor-lock-propagation.test.ts`
- `unit-default-link-clipout-pan.test.ts`
- `unit-translate-group-propagation.test.ts`

## How to restore one

1. Move the file back to its original location (paths preserved in the
   filename are easy to map back — they all came from `tests/unit/...`).
2. Rewrite its setup to drive the controller via pointer events (see
   `tests/bdd/timeline/fixtures.ts` `driveController`) or to dispatch ops
   directly via `runConstraintPipeline` / `dispatchPipelined`, rather than
   poking the deleted slices.
3. Drop the unused imports (`dragCtxReducer`, `setSnapInstall`, etc.) and
   wire the test fixture through the surviving store factory.
