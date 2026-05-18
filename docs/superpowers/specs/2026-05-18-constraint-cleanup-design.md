# Constraint System & Drag Layer Cleanup

**Date:** 2026-05-18
**Status:** Approved for implementation

## Motivation

The constraint system has been through ~17 incremental commits over the last few sessions — adding MirrorPair, removing/reviving ConformVisual, fixing snap-order bugs, introducing replay drag, adding `beginReplayFrame`. The behavior is now correct, but the code carries residue from each iteration: stale comments, leftover types referring to deleted concepts, parallel "live" state in the controller that's no longer needed, and React components doing data derivation that should live in testable selectors.

This cleanup is non-behavioral. No bug fixes. No new features. The goal is to make the codebase match the model we actually arrived at.

## Goals

1. **Test organization** — separate primitive unit tests from scenario tests via `unit-` / `scenario-` filename prefix, so it's obvious which is which without folder traversal. Pull drag-scenario tests from `tests/unit/thunks/` into `tests/unit/constraints/`.
2. **Controller becomes intent-pure** — delete the parallel `live*` state on `DragState`. Compute intent payloads inline from `origTime + delta` against the snapshot.
3. **TSX files are pure wiring** — move `useMemo`'d derivations out of `WarpView.tsx` into memoised selectors. The TSX surface becomes `useAppSelector + dispatch callbacks + JSX`.
4. **Code sweep** — stale comments, dead intent kinds, redundant gestureSlice fields, tests for deleted code paths.

## Non-Goals

- Constraint behavior changes. The model (MirrorPair, ConformVisual, defaultlink MirrorEdge, replay) is fixed.
- Porting scenario tests to BDD. That's a future commit (filename prefix marks them for migration).
- Refactoring the BDD test harness itself.

## Design

### Section 1: Test reorganization

#### Renames (within `tests/unit/constraints/`)

**`unit-*` (primitive / business-logic tests):**
- `mirror-pair.test.ts` → `unit-mirror-pair.test.ts`
- `anchor-lock-propagation.test.ts` → `unit-anchor-lock-propagation.test.ts`
- `constraint-ids.test.ts` → `unit-constraint-ids.test.ts`
- `default-link-clipout-pan.test.ts` → `unit-default-link-clipout-pan.test.ts`
- `pipeline-equivalence.test.ts` → `unit-pipeline-equivalence.test.ts`
- `snap-cohort.test.ts` → `unit-snap-cohort.test.ts`
- `snap-grid.test.ts` → `unit-snap-grid.test.ts`
- `snap-propagation.test.ts` → `unit-snap-propagation.test.ts`
- `snap-transitive-exclusion.test.ts` → `unit-snap-transitive-exclusion.test.ts`
- `translate-group-propagation.test.ts` → `unit-translate-group-propagation.test.ts`

**`scenario-*` (user-facing drag/conform behavior):**
- `anchor-drag-into-snap-radius.test.ts` → `scenario-anchor-drag-into-snap-radius.test.ts`
- `conform-anchor-onto-clipin.test.ts` → `scenario-conform-anchor-onto-clipin.test.ts`
- `conform-clipin-across-diverged.test.ts` → `scenario-conform-clipin-across-diverged.test.ts`
- `conform-clipout-drag-app.test.ts` → `scenario-conform-clipout-drag-app.test.ts`
- `conform-clipout-drag-both-edges.test.ts` → `scenario-conform-clipout-drag-both-edges.test.ts`
- `conform-cross-anchor.test.ts` → `scenario-conform-cross-anchor.test.ts`
- `conform-diverged-anchor-bug.test.ts` → `scenario-conform-diverged-anchor-bug.test.ts`
- `conform-snap-decrement.test.ts` → `scenario-conform-snap-decrement.test.ts`

#### Pull-ins (move into `tests/unit/constraints/`)

- `tests/unit/thunks/clipoutThunks.test.ts` → `tests/unit/constraints/scenario-clipout-thunks.test.ts`
- `tests/unit/thunks/regionThunks.test.ts` → `tests/unit/constraints/scenario-region-thunks.test.ts`
- `tests/unit/thunks/dragCancelGraph.test.ts` → `tests/unit/constraints/scenario-drag-cancel.test.ts`

These already test drag scenarios at the store level — same shape as the new scenario files.

#### New: `tests/unit/constraints/README.md`

```
# Constraints Tests

Two flavors of tests live here:

- `unit-*.test.ts` — primitive / business-logic tests. Each file targets one
  constraint kind, one pipeline mechanism, or one pure helper. Asserts
  behavior at the smallest possible surface (e.g., one reduce() call).

- `scenario-*.test.ts` — user-facing scenario tests. Each file describes
  a drag gesture or conform interaction the user can perform, set up via
  the store + thunk dispatch path. These are marked for future BDD port.
```

### Section 2: Commit 1 — Sweep (non-refactor cleanup)

Single commit covering:

#### Test renames + pull-ins (Section 1)

#### Stale comment sweep

Search and update docstrings / inline comments referencing:
- `carry` / `carryStart` / `carryEnd` — mechanism removed in commit 9e0be58.
- The original symmetric `ConformVisual` auto-detect — replaced by one-way + MirrorPair in 2a10a3e.
- `projectClipoutRegions` / projection-layer conform — deleted in 4f36447.
- `applyLinkingEvent` post-commit logic — largely vestigial after transient-conform.
- Phase numbering (`Phase 2.5`, `Phase 4c`, `Phase 5`) — drop or replace with intent-named comments where the phase number conveys no information today.

#### Dead intent kinds

Audit `Intent` union in `src/timeline/types.ts`:
- Verify each `pub*` and intent variant has an active consumer in `applyIntents` (both `fixtures.ts` and `CanvasTimeline.tsx`) AND a producer in `controller.ts`.
- Known candidate: `pubLiveBeatAnchors` (canvas reads from slice now, not from dragState).
- Remove unconsumed variants; drop their `case` in `applyIntents`.

#### gestureSlice audit

For each field in `gestureSlice`:
- Grep for writes (action dispatches). If none → field is dead.
- Grep for reads (selector / component). If none → field is dead.
- Delete dead fields, their setter actions, and any related selectors.

Likely-dead candidates (drag preview state superseded by slice-as-truth):
- live beat-anchor overrides
- live region overlay rects
- Any "drag preview" field whose role was replaced by the slice itself.

#### Pre-existing tests audit

`grep` for tests of deleted code paths:
- `linkingMirrorMiddleware` references in tests.
- `carryStart` / `carryEnd` / `addCarryPair` / `clearAllCarry` references.
- `projectClipoutRegions` / `ConformVisualSpec` references.

Delete obsolete test files. Update tests that still test live code but reference deleted helpers.

**Verification:** `npx tsc -b tsconfig.build.json && npx vitest run` pass before commit.

**Estimated diff:** −300 to −600 LOC net.

### Section 3: Commit 2 — Refactor (controller + tsx-to-selectors)

#### Controller becomes intent-pure

Delete from `DragState` in `src/timeline/types.ts`:
- `liveRegion`, `liveAnchors`, `liveBeatAnchors`, `liveRegionBounds`, `liveBoundsList`, `liveInputAnchors`
- `origInputTimes`, `origBeatTimes`, `origBeatAnchorTimes`

Keep (still needed for intent-payload computation):
- `origTime`
- `origRegionBounds`
- `regionGroupIds`, `linkedOutputEdges`, `pendingSelect`

In `src/timeline/controller.ts`:
- Remove all `drag.liveXxx = ...` assignments.
- Replace intent-payload computations that read `drag.liveXxx.find(...)` with inline expressions: `(snap.someList.find(id).time at drag start) + cumulativeDelta`, or `drag.origRegionBounds.get(id) + delta`.
- Specifically: `regionResize` intent's bounds, `anchorEntityMove` intent's `time`, `regionEntityMove` intent's `delta` (already inline), Bug G/H linked-output-edges intent emission.
- Result: controller's drag-state shape is minimal "what was grabbed + where"; computation of "what's the intent for this pointermove" is inline.

#### TSX-to-selectors

Goal: TSX is pure wiring, no logic on props.

For `WarpView.tsx`, move these `useMemo` derivations into memoised selectors:
- `quantAnchors` → `selectQuantAnchors`
- `snapTargetsInput` → `selectSnapTargetsInput`
- `snapTargetsOutput` → `selectSnapTargetsOutput`
- `linkedBoundaries` → `selectLinkedBoundaries`
- `selectedBoundaries` → `selectSelectedBoundaries`
- `beatOffset` → `selectBeatOffset`
- `anchorPairs` → `selectAnchorPairs`

Selectors live in `src/store/selectors.ts` (or `src/store/selectors/timeline.ts` if file growth justifies a split).

Each new selector gets a unit test in `tests/unit/store/selectors/` (or alongside existing selectors tests).

For `CanvasTimeline.tsx`:
- Sweep for remaining computed values that should be props:
  - `clipInAnchor` lookup
  - any `liveClipoutIn` / `clipinDragging` branches that became no-ops after the recent `beatOffset` fix.
- Hit-testing geometry stays — it's canvas-layer wiring, not business logic.

**Verification:** `npx tsc -b tsconfig.build.json && npx vitest run` pass. New selector tests required; TSX behavior tests come from the BDD layer.

**Estimated diff:** −500 to −800 LOC in controller + WarpView, +100 to +200 LOC in selectors + their tests. Net negative.

**Risk:** TSX selector extraction touches render paths. Isolating this in its own commit makes bisection easy if a visual regression surfaces.

## Sequencing & Verification

Two commits, in order:

1. **Sweep** (Section 2): renames + comments + dead intent kinds + gestureSlice audit + dead-test removal.
2. **Refactor** (Section 3): controller live* removal + TSX-to-selectors.

After each commit:
- `npx tsc -b tsconfig.build.json` clean.
- `npx vitest run` — all tests pass, no expected-fail markers added.

If a regression appears in the live app after commit 2, bisect cleanly identifies whether it's the controller change or the selector extraction.

## Out of Scope (Future Work)

- Porting `scenario-*.test.ts` files to BDD (`.feature` + step definitions). Filename prefix marks them as migration candidates.
- Refactoring `BDD` test harness in `tests/bdd/`.
- Touching constraint-pipeline semantics (the model is final).
- Performance optimization of the replay model (e.g., short-circuit when ops would be no-op).
