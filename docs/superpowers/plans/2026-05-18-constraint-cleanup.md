# Constraint Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up residue from the 17-commit constraint refactor: rename tests for visible split, strip dead `live*` state from controller, move logic out of TSX into selectors, sweep stale comments / dead intent kinds.

**Architecture:** Two commits — (1) **Sweep**: non-behavioral renames, stale-comment updates, dead-code removal. (2) **Refactor**: controller intent-pure + WarpView logic-to-selectors.

**Tech Stack:** TypeScript, Vitest, Redux Toolkit, React. Tests run via `npx vitest run`; type-check via `npx tsc -b tsconfig.build.json`.

**Spec:** `docs/superpowers/specs/2026-05-18-constraint-cleanup-design.md`.

---

## Commit 1: Sweep

### Task 1: Rename constraints/ test files with `unit-` / `scenario-` prefixes

**Files:**
- Rename (via `git mv`): 18 files in `tests/unit/constraints/`

**- [ ] Step 1: Verify current test count baseline**

Run: `npx vitest run tests/unit/constraints/ 2>&1 | tail -5`
Expected: all tests pass. Note total count.

**- [ ] Step 2: Rename primitive/unit tests**

Run these `git mv` commands (one at a time so collisions surface clearly):

```bash
git mv tests/unit/constraints/mirror-pair.test.ts tests/unit/constraints/unit-mirror-pair.test.ts
git mv tests/unit/constraints/anchor-lock-propagation.test.ts tests/unit/constraints/unit-anchor-lock-propagation.test.ts
git mv tests/unit/constraints/constraint-ids.test.ts tests/unit/constraints/unit-constraint-ids.test.ts
git mv tests/unit/constraints/default-link-clipout-pan.test.ts tests/unit/constraints/unit-default-link-clipout-pan.test.ts
git mv tests/unit/constraints/pipeline-equivalence.test.ts tests/unit/constraints/unit-pipeline-equivalence.test.ts
git mv tests/unit/constraints/snap-cohort.test.ts tests/unit/constraints/unit-snap-cohort.test.ts
git mv tests/unit/constraints/snap-grid.test.ts tests/unit/constraints/unit-snap-grid.test.ts
git mv tests/unit/constraints/snap-propagation.test.ts tests/unit/constraints/unit-snap-propagation.test.ts
git mv tests/unit/constraints/snap-transitive-exclusion.test.ts tests/unit/constraints/unit-snap-transitive-exclusion.test.ts
git mv tests/unit/constraints/translate-group-propagation.test.ts tests/unit/constraints/unit-translate-group-propagation.test.ts
```

**- [ ] Step 3: Rename scenario tests**

```bash
git mv tests/unit/constraints/anchor-drag-into-snap-radius.test.ts tests/unit/constraints/scenario-anchor-drag-into-snap-radius.test.ts
git mv tests/unit/constraints/conform-anchor-onto-clipin.test.ts tests/unit/constraints/scenario-conform-anchor-onto-clipin.test.ts
git mv tests/unit/constraints/conform-clipin-across-diverged.test.ts tests/unit/constraints/scenario-conform-clipin-across-diverged.test.ts
git mv tests/unit/constraints/conform-clipout-drag-app.test.ts tests/unit/constraints/scenario-conform-clipout-drag-app.test.ts
git mv tests/unit/constraints/conform-clipout-drag-both-edges.test.ts tests/unit/constraints/scenario-conform-clipout-drag-both-edges.test.ts
git mv tests/unit/constraints/conform-cross-anchor.test.ts tests/unit/constraints/scenario-conform-cross-anchor.test.ts
git mv tests/unit/constraints/conform-diverged-anchor-bug.test.ts tests/unit/constraints/scenario-conform-diverged-anchor-bug.test.ts
git mv tests/unit/constraints/conform-snap-decrement.test.ts tests/unit/constraints/scenario-conform-snap-decrement.test.ts
```

**- [ ] Step 4: Re-run tests; count must match baseline**

Run: `npx vitest run tests/unit/constraints/ 2>&1 | tail -5`
Expected: same count as Step 1, all pass.

**Don't commit yet — bundled with Task 2.**

---

### Task 2: Add `tests/unit/constraints/README.md`

**Files:**
- Create: `tests/unit/constraints/README.md`

**- [ ] Step 1: Write the README**

```markdown
# Constraints Tests

Two flavors of tests live here, distinguished by filename prefix:

- **`unit-*.test.ts`** — primitive / business-logic tests. Each file targets
  one constraint kind, one pipeline mechanism, or one pure helper. Asserts
  behavior at the smallest possible surface (e.g., one `reduce()` call).

- **`scenario-*.test.ts`** — user-facing scenario tests. Each file describes
  a drag gesture or conform interaction the user can perform, set up via
  the store + thunk dispatch path. These are marked for future BDD port
  (one `.feature` per scenario file).

When porting a scenario test to BDD, the test stays here until the BDD
covers the equivalent behavior, then this file is deleted.
```

Write the content above to `tests/unit/constraints/README.md`.

**- [ ] Step 2: Commit Tasks 1 + 2 together**

```bash
git add tests/unit/constraints/
git commit -m "$(cat <<'EOF'
test(constraints): rename test files with unit-/scenario- prefix

Filename prefix marks the split: unit-* tests primitives (single constraint
kind or helper); scenario-* tests user-facing drag/conform behavior set up
through the store path. The scenario-* files are earmarked for future BDD
port; README.md documents the convention.

No behavior change — git mv only. Test count unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Pull in `clipoutThunks.test.ts` as a scenario file

**Files:**
- Move (via `git mv`): `tests/unit/thunks/clipoutThunks.test.ts` → `tests/unit/constraints/scenario-clipout-thunks.test.ts`

**- [ ] Step 1: Inspect the source file's imports**

Run: `head -20 tests/unit/thunks/clipoutThunks.test.ts`

Note the relative import depths (`../../../src/...`). After the move from `tests/unit/thunks/` to `tests/unit/constraints/`, the depth stays the same (`../../../src/...`), so imports should not need adjustment.

**- [ ] Step 2: Move the file**

Run: `git mv tests/unit/thunks/clipoutThunks.test.ts tests/unit/constraints/scenario-clipout-thunks.test.ts`

**- [ ] Step 3: Verify the moved test still passes**

Run: `npx vitest run tests/unit/constraints/scenario-clipout-thunks.test.ts 2>&1 | tail -5`
Expected: all tests pass.

**Don't commit yet — bundled with Tasks 4 and 5.**

---

### Task 4: Pull in `regionThunks.test.ts` as a scenario file

**Files:**
- Move: `tests/unit/thunks/regionThunks.test.ts` → `tests/unit/constraints/scenario-region-thunks.test.ts`

**- [ ] Step 1: Move the file**

Run: `git mv tests/unit/thunks/regionThunks.test.ts tests/unit/constraints/scenario-region-thunks.test.ts`

**- [ ] Step 2: Verify**

Run: `npx vitest run tests/unit/constraints/scenario-region-thunks.test.ts 2>&1 | tail -5`
Expected: pass.

---

### Task 5: Pull in `dragCancelGraph.test.ts` as a scenario file

**Files:**
- Move: `tests/unit/thunks/dragCancelGraph.test.ts` → `tests/unit/constraints/scenario-drag-cancel.test.ts`

**- [ ] Step 1: Move the file**

Run: `git mv tests/unit/thunks/dragCancelGraph.test.ts tests/unit/constraints/scenario-drag-cancel.test.ts`

**- [ ] Step 2: Verify**

Run: `npx vitest run tests/unit/constraints/scenario-drag-cancel.test.ts 2>&1 | tail -5`
Expected: pass.

**- [ ] Step 3: Commit Tasks 3 + 4 + 5 together**

```bash
git add tests/
git commit -m "$(cat <<'EOF'
test(constraints): pull drag-scenario thunk tests into constraints/

clipoutThunks, regionThunks, and dragCancelGraph all exercise drag
scenarios at the store + thunk level — same shape as scenario-* tests
in tests/unit/constraints/. Renamed with scenario- prefix.

No code change. Import depths unchanged (same `../../../src/...`).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Delete the `pubLiveBeatAnchors` dead intent kind

**Files:**
- Modify: `src/timeline/types.ts` (Intent union)
- Modify: `src/components/CanvasTimeline.tsx` (applyIntents switch)
- Modify: `tests/bdd/timeline/fixtures.ts` (applyIntents switch)
- Modify: `tests/unit/timeline/controller.test.ts` (drop dead assertion)

**- [ ] Step 1: Verify the intent has zero emitters**

Run: `grep -rn "kind: 'pubLiveBeatAnchors'" src/ --include="*.ts" --include="*.tsx"`
Expected: only the type definition (no emitter). If a producer is found, STOP and update the plan.

**- [ ] Step 2: Remove the variant from the Intent union**

Edit `src/timeline/types.ts` — remove these lines (around line 319-324):

```ts
  /** Publish live beat-anchor positions during a clipout-edge drag that carries a
   *  linked beat anchor. Canvas draws from dragState directly (liveBeatAnchorOverrides);
   *  this intent triggers a redraw. */
  | { kind: 'pubLiveBeatAnchors'; anchors: Anchor[] }
```

**- [ ] Step 3: Remove the consumer case in CanvasTimeline.tsx**

Edit `src/components/CanvasTimeline.tsx` (~line 1317):

```ts
        // pubLiveBeatAnchors: slice is updated on every pointerMove so the slice
        // IS the live state — no separate overlay needed.
        case 'pubLiveBeatAnchors': break
```

Delete those three lines.

**- [ ] Step 4: Remove the consumer case in fixtures.ts**

Edit `tests/bdd/timeline/fixtures.ts` (~line 318):

```ts
        case 'pubLiveBeatAnchors':
          // Canvas reads live beat-anchor positions from dragState directly;
          // no store update needed here.
          break
```

Delete those lines.

**- [ ] Step 5: Remove or update the controller test that asserts absence**

Edit `tests/unit/timeline/controller.test.ts` (~line 1707). The test:

```ts
  it('pointerMove does NOT emit pubLiveBeatAnchors for linked edge (carry now in thunk)', () => {
    ...
    expect(intents.some(i => i.kind === 'pubLiveBeatAnchors')).toBe(false)
```

This assertion is now trivially true (the intent kind doesn't exist). Delete this `it(...)` block. Keep neighboring tests intact.

**- [ ] Step 6: Type-check + test**

Run:
```bash
npx tsc -b tsconfig.build.json
npx vitest run
```
Expected: tsc clean, all tests pass.

**Don't commit yet — bundled into the Sweep commit.**

---

### Task 7: Stale-comment sweep

**Files (modify, comments only):**
- `src/constraints/pipeline.ts` — "carry pairs" reference in docstring
- `src/constraints/recipes.ts` — `carry:*` paragraph header still references the obsolete recipe
- `src/constraints/types.ts` — DirectedPair docstring mentions `carry`
- `src/constraints/resolver.ts` — DirectedPair handler comment mentions "carry pairs"
- `src/store/slices/dragCtxSlice.ts` — header references "snap and carry dispatch sites"
- `src/timeline/types.ts` — `pubLiveBeatAnchors`-adjacent paragraph (already partly cleaned in Task 6)
- `src/components/WarpView.tsx` — `conformClipoutToBeatAnchors` reference
- `tests/bdd/timeline/fixtures.ts` — comment about "carry shadow-write"
- `src/timeline/controller.ts` — `Phase 2.5` / `Phase 4c` / `Phase 5` / "Bug G/H" references

The pattern: each occurrence of a deleted-concept name should either be:
1. Removed (if the surrounding comment is purely about that concept), or
2. Replaced with the current mechanism name (e.g., "carry" → "MirrorPair conform binding").

**- [ ] Step 1: Inventory every reference**

Run:
```bash
grep -rn "\bcarry\b\|carryStart\|carryEnd\|ConformVisualSpec\|projectClipoutRegions\|linkingMirrorMiddleware\|Phase 2\.5\|Phase 4c\|Phase 5\b\|Bug G/H" src/ tests/ --include="*.ts" --include="*.tsx" | grep -v "node_modules"
```

Note each line — these are the comments to update.

**- [ ] Step 2: For each match, decide remove vs. rephrase**

Working file by file (not line by line — context matters):

- **`src/constraints/recipes.ts`**: the `// ─── Carry on drag ───` header section is documentation of the obsoleted recipe. Replace the section header with a one-liner pointing to MirrorPair, and keep the existing "obsolete — MirrorPair handles this" prose.
- **`src/constraints/pipeline.ts`**: in the `buildGraphFromSlice` docstring, change `"... carry pairs."` to `"... ConformVisual + MirrorPair conform bindings."`.
- **`src/constraints/types.ts`**: the `DirectedPair.fromEdge` docstring says "needed for body-pan carry". Reword to "needed for body-pan edge propagation".
- **`src/constraints/resolver.ts`**: the MirrorEdge propose-handler docstring says "carry needed for body-pan where both edges move and two separate carry pairs exist". Reword without `carry`.
- **`src/store/slices/dragCtxSlice.ts`**: header references "snap and carry dispatch sites" — drop "and carry".
- **`src/components/WarpView.tsx`**: any leftover `conformClipoutToBeatAnchors` mentions — delete the comment block; the function no longer exists.
- **`tests/bdd/timeline/fixtures.ts`**: drop the "carry shadow-write" comment block now that the case is gone.
- **`src/timeline/controller.ts`**: Phase comments (`Phase 2.5`, `Phase 4c`, `Phase 5`, `Bug G/H`) — replace with intent-named labels (e.g., `// single-entity drag commit` instead of `// Phase 2.5: single-entity commit`). Keep the comment meaningful; drop the phase number.

**- [ ] Step 3: Apply the edits**

For each file flagged in Step 2, use `Edit` (replace_all for repeated phrases) or `Read + Edit` to update the comments. Do NOT change any code behavior — comments only.

**- [ ] Step 4: Verify no comment update broke anything**

```bash
npx tsc -b tsconfig.build.json
npx vitest run
```
Expected: clean.

---

### Task 8: gestureSlice / gesture store audit

**Files:**
- Read: `src/store/gesture.ts` (this is the gesture store, not a Redux slice — uses Set + listeners)
- Modify: any field with no readers AND no writers in the codebase.

The user-approved spec calls this "gestureSlice audit". The actual file is `src/store/gesture.ts`. Audit it the same way.

**- [ ] Step 1: List every field in `GestureState`**

Read `src/store/gesture.ts` lines 18-48. Note each field name:
- `hoveredAnchorId`, `hoveredRegionId`, `hoveredSceneTime`, `hoveredWarpLineId`
- `snapHintsIn`, `snapHintsOut`
- `dragTime`, `scrubTime`
- `lassoSelection`
- `modifierKeys`

**- [ ] Step 2: For each field, grep readers + writers**

For field `<F>`:
```bash
grep -rn "gesture\.set<F>\|use.*gesture\|getSnapshot" src/ --include="*.ts" --include="*.tsx" | head -10
```

A field with at least one reader (selector / `useGesture` usage in a component) AND at least one writer (`gesture.setX(...)` call) is LIVE. Anything else is dead.

Expected outcome for this repo: most fields are alive (they drive canvas overlays during drag). If anything is genuinely dead (e.g., a hover field with no canvas consumer), delete the field + its setter.

**- [ ] Step 3: Apply removals (if any)**

For each dead field, edit `src/store/gesture.ts`:
- Remove from `GestureState` interface.
- Remove from `initialState`.
- Remove the setter method on the `gesture` object.
- Remove any selectors / `useGesture(g => g.X)` reads from consumers.

If no fields are dead, document the audit in a comment at the top of `src/store/gesture.ts`:

```ts
// All fields below are actively read by canvas overlays / status indicators.
// Audited 2026-05-18.
```

**- [ ] Step 4: Type-check + tests**

```bash
npx tsc -b tsconfig.build.json
npx vitest run
```
Expected: clean.

---

### Task 9: Pre-existing test audit — remove tests of deleted code paths

**Files:**
- Audit: `tests/unit/middleware/*.test.ts`, `tests/unit/store/dragCtxSlice.test.ts`
- Potentially delete: any file testing `linkingMirrorMiddleware`, `addCarryPair`, `clearAllCarry`, `ConformVisualSpec`, `projectClipoutRegions`.

**- [ ] Step 1: Grep test files for deleted-API references**

```bash
grep -rln "linkingMirror\|carryStart\|carryEnd\|addCarryPair\|clearAllCarry\|ConformVisualSpec\|projectClipoutRegions" tests/ --include="*.ts"
```

**- [ ] Step 2: For each match, classify**

- If the test file's PRIMARY subject is the deleted thing (e.g., `linkingMirrorMiddleware.test.ts`): delete the whole file.
- If the test file tests live code but has incidental references in setup: update the setup (remove the irrelevant dispatch).

**- [ ] Step 3: Delete obsolete files**

For each file flagged for deletion:
```bash
git rm tests/path/to/dead.test.ts
```

**- [ ] Step 4: Update partial files**

For each file that needs setup updates, edit it to drop the dead references but keep the live-code tests.

**- [ ] Step 5: Verify**

```bash
npx tsc -b tsconfig.build.json
npx vitest run
```
Expected: clean.

---

### Task 10: Commit Sweep (Tasks 6-9)

**- [ ] Step 1: Sanity check before commit**

```bash
git status
git diff --stat
```

Confirm: types.ts, recipes.ts, pipeline.ts, resolver.ts, controller.ts, dragCtxSlice.ts, gesture.ts (maybe), fixtures.ts, CanvasTimeline.tsx, WarpView.tsx, controller.test.ts — and any test deletions.

**- [ ] Step 2: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(constraints): sweep stale comments + dead intent kind + obsolete tests

Non-behavioral cleanup of residue from the constraint refactor series:

- Removed `pubLiveBeatAnchors` intent variant (no emitter; canvas reads
  slice now). Dropped the `case` in both applyIntents and the controller
  test that asserted its absence.
- Stale-comment sweep: removed/rephrased docstring references to deleted
  concepts (carry / carryStart / carryEnd, the symmetric ConformVisual,
  projectClipoutRegions, linkingMirrorMiddleware) across constraints/,
  store/slices/, components/, fixtures.
- gestureSlice (= src/store/gesture.ts) audit — confirmed each field is
  read + written. (Or: dropped <fields> with no consumer/producer.)
- Deleted obsolete test files for removed code paths.
- Stripped vestigial "Phase 2.5 / Phase 4c / Phase 5 / Bug G/H" comment
  labels; reworded as intent-named where the comment still carries info.

All 1539 tests pass. Type-check clean.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

(Adjust the test count + dropped-fields specifics based on the actual audit results.)

---

## Commit 2: Refactor

### Task 11: Strip `live*` fields from `DragState` `kind: 'anchor'` variant

**Files:**
- Modify: `src/timeline/types.ts` — anchor variant (lines ~136-186)
- Modify: `src/timeline/controller.ts` — anchor drag handlers

**- [ ] Step 1: Write a regression test that locks current behavior**

Pick the most representative anchor-drag controller test (e.g., from `tests/unit/timeline/controller.test.ts` covering an output-space anchor drag with linked output edges).

Run that single test FIRST:
```bash
npx vitest run tests/unit/timeline/controller.test.ts -t "<test name>" 2>&1 | tail -10
```
Expected: PASS. Note the assertions — they are the contract we must preserve.

**- [ ] Step 2: Remove fields from the `kind: 'anchor'` variant**

In `src/timeline/types.ts` (anchor variant), delete:

```ts
      liveAnchors: Anchor[]
      liveBeatAnchors: Anchor[]
      ...
      origInputTimes?: Map<number, number>
      origBeatTimes?: Map<number, number>
      ...
      liveRegionBounds?: { id: string; inPoint: number; outPoint: number }[]
```

Keep: `id, space, origTime, startClientX, startClientY, moved, pendingSelect, isPair, groupIds, regionGroupIds, origRegionBounds, linkedOutputEdges`.

Note: `origInputTimes`/`origBeatTimes` are used to decide *which space's intent to emit*. Replace with a simpler `capturedSpaces: { input: boolean; beat: boolean }` flag, or recompute from `groupIds` + `space` at intent-emit time.

**- [ ] Step 3: Refactor `buildAnchorDrag` and `handleAnchorMove` in controller.ts**

In `buildAnchorDrag` (controller.ts ~line 78): stop populating `origInputTimes`/`origBeatTimes`/`liveAnchors`/`liveBeatAnchors`. Compute `isPair` and `capturedSpaces` from the same selection logic.

In `handleAnchorMove` (~line 334): the live-update of `drag.liveAnchors`/`drag.liveBeatAnchors` goes away. Where the intent emitter currently reads `anchorDragNow.liveAnchors.find(a => a.id === anchorDragNow.id)?.time`, replace with:

```ts
const cursorT = pxToT(e.clientX - e.canvasRect.left, snap)
const primaryInputTime  = drag.capturedSpaces.input ? cursorT : undefined
const primaryBeatTime   = drag.capturedSpaces.beat  ? cursorT : undefined
```

(For multi-anchor drags, the "delta" derivation uses `cursorT - drag.origTime`; followers' positions are recomputed inline.)

**- [ ] Step 4: Re-run the regression test from Step 1**

Expected: PASS.

**- [ ] Step 5: Run full controller test suite**

```bash
npx vitest run tests/unit/timeline/controller.test.ts 2>&1 | tail -10
```
Expected: all pass.

**Don't commit yet — bundled into Refactor commit.**

---

### Task 12: Strip `live*` from `region-edge` and `region-move` variants

**Files:**
- Modify: `src/timeline/types.ts` — region-edge variant (~line 187), region-move variant (~line 211)
- Modify: `src/timeline/controller.ts` — `handleRegionEdgeMove` (~line 469), `handleRegionMoveMove` (~line 570)

**- [ ] Step 1: Run baseline region-drag tests**

```bash
npx vitest run tests/unit/timeline/controller.test.ts -t "region" 2>&1 | tail -10
```
Expected: PASS. Note assertions.

**- [ ] Step 2: Remove fields from `kind: 'region-edge'` variant**

Delete:

```ts
      liveRegion: { id: string; inPoint: number; outPoint: number } | null
      liveBeatAnchors?: Anchor[]
      origBeatAnchorTimes?: Map<number, number>
```

Keep: `id, edge, isOutput, origIn, origOut, startClientX, startClientY, moved, pendingSelect, lastAltKey`.

**- [ ] Step 3: Remove fields from `kind: 'region-move'` variant**

Delete:

```ts
      liveRegion: { id: string; inPoint: number; outPoint: number } | null
      anchorGroupIds?: ReadonlySet<number>
      origInputAnchorTimes?: Map<number, number>
      origBeatAnchorTimes?: Map<number, number>
      liveAnchors?: Anchor[]
      liveBeatAnchors?: Anchor[]
```

Keep: `id, isOutput, origIn, origOut, anchorX, startClientX, startClientY, moved, pendingSelect, lastAltKey, groupIds, origBounds`.

**- [ ] Step 4: Refactor handleRegionEdgeMove**

The Slice-B beat-anchor rescale block (lines ~507-537) referenced `drag.liveBeatAnchors`/`drag.origBeatAnchorTimes`. Compute the scale inline from `snap.beatAnchors` + `drag.origIn` + the new live edge position:

```ts
// Replace the prior `drag.liveBeatAnchors = drag.liveBeatAnchors.map(...)` block.
// Live region edge position:
const liveIn  = drag.edge === 'in'  ? newIn  : drag.origIn
const liveOut = drag.edge === 'out' ? newOut : drag.origOut
// ... emit beatAnchorsChanged with computed positions inline ...
```

The full transform should emit the same `regionResize` + (conditionally) `beatAnchorsChanged` intents.

**- [ ] Step 5: Refactor handleRegionMoveMove**

Same approach: remove `drag.liveRegion = ...` and `drag.liveAnchors = ...` assignments; compute the intent-payload values from `snap.regions.find(...) + delta` and `snap.anchors.find(...) + delta` at the point of emission.

**- [ ] Step 6: Re-run baseline + full controller tests**

```bash
npx vitest run tests/unit/timeline/controller.test.ts 2>&1 | tail -10
```
Expected: PASS.

---

### Task 13: Remove `pubLiveBeatAnchors` emitter (if any remained after Task 6) + drop `liveBeatAnchorOverrides` references

**Files:**
- Modify (if needed): `src/timeline/controller.ts` — any leftover emitter
- Modify: `src/components/CanvasTimeline.tsx` — `getDragState()` reads of removed fields

**- [ ] Step 1: Grep for any leftover read of deleted fields**

```bash
grep -rn "liveBeatAnchorOverrides\|dragState.*liveRegion\|dragState.*liveAnchors\|dragState.*liveBeatAnchors\|dragState.*origInputTimes\|dragState.*origBeatTimes" src/ --include="*.ts" --include="*.tsx"
```

For each match — comment-only references get deleted (Task 7 already covered most). Code reads must be replaced with the slice equivalent (`p.beatAnchors`, `p.regions` for live drag state).

**- [ ] Step 2: Update CanvasTimeline to not depend on dragState's deleted fields**

Replace any `controllerRef.current.getDragState()?.liveX` reads with `p.X` reads (from the snapshot's slice values).

**- [ ] Step 3: Run full vitest**

```bash
npx vitest run
```
Expected: all pass.

---

### Task 14: Extract `selectAnchorPairs` and `selectQuantAnchors` selectors

**Files:**
- Create: `src/store/selectors/timeline.ts` (new file — selectors are accumulating)
- Modify: `src/store/selectors.ts` (re-export from `./selectors/timeline`)
- Modify: `src/components/WarpView.tsx` (use the new selectors)
- Create: `tests/unit/store/selectors/timeline.test.ts`

**- [ ] Step 1: Write failing selector tests**

`tests/unit/store/selectors/timeline.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { selectAnchorPairs, selectQuantAnchors } from '../../../../src/store/selectors/timeline'
import { makeStore } from '../../../helpers/setup'
import { addAnchor } from '../../../../src/store/slices/warpSlice'

describe('selectAnchorPairs', () => {
  it('pairs orig and beat anchors by id, sorted by orig time', () => {
    const store = makeStore()
    store.dispatch(addAnchor({ id: 1, time: 5 }))
    store.dispatch(addAnchor({ id: 2, time: 3 }))
    const pairs = selectAnchorPairs(store.getState() as never)
    expect(pairs).toHaveLength(2)
    expect(pairs[0].input.id).toBe(2)
    expect(pairs[1].input.id).toBe(1)
  })
})

describe('selectQuantAnchors', () => {
  it('returns sorted beat anchors as {id, time} array', () => {
    const store = makeStore()
    store.dispatch(addAnchor({ id: 1, time: 5 }))
    store.dispatch(addAnchor({ id: 2, time: 3 }))
    const result = selectQuantAnchors(store.getState() as never)
    expect(result.map(a => a.id)).toEqual([2, 1])
  })
})
```

**- [ ] Step 2: Run — expect FAIL ("Cannot find module 'selectors/timeline'")**

```bash
npx vitest run tests/unit/store/selectors/timeline.test.ts 2>&1 | tail -10
```
Expected: FAIL.

**- [ ] Step 3: Create the selectors file**

`src/store/selectors/timeline.ts`:

```ts
import { createSelector } from '@reduxjs/toolkit'
import type { RootState } from '../store'
import { selectSortedOrig, selectSortedBeat } from '../selectors'
import { buildAnchorPairs } from '../../timeline/model/beatMap'

/** Beat anchors as `{id, time}[]`, sorted by id alignment with orig.
 *  Replaces the inline `useMemo` in WarpView. */
export const selectQuantAnchors = createSelector(
  selectSortedBeat,
  (sortedBeat) => sortedBeat.map(a => ({ id: a.id, time: a.time })),
)

/** Anchor pairs (orig ↔ beat by id), sorted by orig time. */
export const selectAnchorPairs = createSelector(
  selectSortedOrig,
  selectSortedBeat,
  (sortedOrig, sortedBeat) => buildAnchorPairs(sortedOrig, sortedBeat),
)
```

**- [ ] Step 4: Run — expect PASS**

```bash
npx vitest run tests/unit/store/selectors/timeline.test.ts 2>&1 | tail -10
```
Expected: PASS.

**- [ ] Step 5: Update WarpView to consume the selectors**

In `src/components/WarpView.tsx`:

Replace:
```ts
const quantAnchors: Anchor[] = useMemo(
  () => sortedBeat.map(a => ({ id: a.id, time: a.time })),
  [sortedBeat],
)
```

with:
```ts
const quantAnchors = useAppSelector(selectQuantAnchors)
```

Replace `buildAnchorPairs(anchors, beatAnchors)` calls (search and find) with `useAppSelector(selectAnchorPairs)`.

Add the import:
```ts
import { selectQuantAnchors, selectAnchorPairs } from '../store/selectors/timeline'
```

**- [ ] Step 6: Verify**

```bash
npx tsc -b tsconfig.build.json
npx vitest run
```
Expected: all pass.

---

### Task 15: Extract `selectSnapTargetsInput` and `selectSnapTargetsOutput`

**Files:**
- Modify: `src/store/selectors/timeline.ts` — add new selectors
- Modify: `tests/unit/store/selectors/timeline.test.ts` — add tests
- Modify: `src/components/WarpView.tsx` — consume the selectors

**- [ ] Step 1: Write failing tests**

Append to `tests/unit/store/selectors/timeline.test.ts`:

```ts
import { selectSnapTargetsInput, selectSnapTargetsOutput } from '../../../../src/store/selectors/timeline'

describe('selectSnapTargetsInput', () => {
  it('includes orig anchor times', () => {
    const store = makeStore()
    store.dispatch(addAnchor({ id: 1, time: 5 }))
    const targets = selectSnapTargetsInput(store.getState() as never)
    expect(targets).toContain(5)
  })
})

describe('selectSnapTargetsOutput', () => {
  it('includes beat anchor times when no clip is selected', () => {
    const store = makeStore()
    store.dispatch(addAnchor({ id: 1, time: 5 }))
    const targets = selectSnapTargetsOutput(store.getState() as never)
    expect(targets).toContain(5)
  })
})
```

**- [ ] Step 2: Run — expect FAIL**

```bash
npx vitest run tests/unit/store/selectors/timeline.test.ts 2>&1 | tail -10
```
Expected: FAIL on import.

**- [ ] Step 3: Implement the selectors**

Append to `src/store/selectors/timeline.ts`:

```ts
import { selectActiveRegion, selectScenesForActiveVideo } from '../selectors'
import { selectClipIn, selectClipOut } from '../selectors'  // adjust to actual exports

export const selectSnapTargetsInput = createSelector(
  selectScenesForActiveVideo,
  (s: RootState) => s.warp.origAnchors,
  (scenes, origAnchors) => [...scenes, ...origAnchors.map(a => a.time)],
)

export const selectSnapTargetsOutput = createSelector(
  selectQuantAnchors,
  selectClipIn,
  (s: RootState) => s.region.regions.find(r => r.id === s.region.activeRegionId)?.inBeatTime,
  (s: RootState) => s.region.regions.find(r => r.id === s.region.activeRegionId)?.outBeatTime,
  (quantAnchors, clipIn, beatClipIn, beatClipOut) => {
    const beatTimes = quantAnchors.map(a => a.time)
    if (clipIn === undefined) return beatTimes
    return [...beatTimes, beatClipIn ?? 0, beatClipOut ?? 0]
  },
)
```

(Adjust signatures to match WarpView's existing logic and the actual `selectors.ts` export shapes.)

**- [ ] Step 4: Run — expect PASS**

```bash
npx vitest run tests/unit/store/selectors/timeline.test.ts 2>&1 | tail -10
```
Expected: PASS.

**- [ ] Step 5: Update WarpView**

Replace these `useMemo`s in WarpView.tsx:

```ts
const snapTargetsInput = useMemo(
  () => [...scenes, ...origAnchors.map(a => a.time)],
  [scenes, origAnchors],
)
const snapTargetsOutput = useMemo(() => {
  const beatTimes = quantAnchors.map(a => a.time)
  if (clipIn === undefined) return beatTimes
  return [...beatTimes, beatClipIn ?? 0, beatClipOut ?? outputDuration]
}, [quantAnchors, clipIn, beatClipIn, beatClipOut, outputDuration])
```

with:

```ts
const snapTargetsInput  = useAppSelector(selectSnapTargetsInput)
const snapTargetsOutput = useAppSelector(selectSnapTargetsOutput)
```

**- [ ] Step 6: Verify**

```bash
npx tsc -b tsconfig.build.json
npx vitest run
```
Expected: all pass.

---

### Task 16: Extract `selectLinkedBoundaries` and `selectSelectedBoundaries`

**Files:**
- Modify: `src/store/selectors/timeline.ts`, `tests/unit/store/selectors/timeline.test.ts`, `src/components/WarpView.tsx`

**- [ ] Step 1: Inspect the existing useMemos in WarpView (~lines 339-348)**

Find:

```ts
const linkedBoundaries = useMemo(
  () => segmentAnchors.map(a => a.id < 0 || linkedAnchorIds.has(a.id)),
  [segmentAnchors, linkedAnchorIds],
)
const selectedBoundaries = useMemo(...)
```

Note their inputs (segmentAnchors, linkedAnchorIds, etc.).

**- [ ] Step 2: Write failing tests for each selector**

Add tests in `timeline.test.ts` covering the basic shape: given a known store state, the selector returns the expected boolean array.

**- [ ] Step 3: Implement the selectors**

Add to `src/store/selectors/timeline.ts` — copy the logic from WarpView's useMemos, parameterized on state. If `segmentAnchors` is itself a derived value, lift its derivation into a selector too.

**- [ ] Step 4: Run — expect PASS**

**- [ ] Step 5: Replace WarpView's useMemos with `useAppSelector(...)`**

**- [ ] Step 6: Verify**

```bash
npx tsc -b tsconfig.build.json
npx vitest run
```
Expected: all pass.

---

### Task 17: Extract `selectBeatOffset`

**Files:**
- Modify: `src/store/selectors/timeline.ts`, `tests/unit/store/selectors/timeline.test.ts`, `src/components/WarpView.tsx`

**- [ ] Step 1: Inspect current beatOffset logic (~line 200-208)**

```ts
const beatOffset = useMemo(() => {
  if (clipIn === undefined) return sortedBeat[0]?.time ?? 0
  if (beatZeroId !== null) {
    const z = sortedBeat.find(a => a.id === beatZeroId)
    if (z) return z.time
  }
  return effectiveBounds?.inBeatTime ?? clipInBeatTime ?? clipIn
}, [clipIn, clipInBeatTime, effectiveBounds, sortedBeat, beatZeroId])
```

**- [ ] Step 2: Write failing test**

```ts
describe('selectBeatOffset', () => {
  it('returns activeRegion.inBeatTime when set', () => {
    const store = makeStore()
    store.dispatch(addRegion({ id: 'r', ..., inBeatTime: 7, outBeatTime: 17 }))
    store.dispatch(setActiveRegionId('r'))
    expect(selectBeatOffset(store.getState() as never)).toBe(7)
  })
})
```

**- [ ] Step 3: Implement selector**

```ts
export const selectBeatOffset = createSelector(
  selectClipIn,
  selectActiveRegion,
  (s: RootState) => s.warp.beatZeroId,
  selectSortedBeat,
  (clipIn, activeRegion, beatZeroId, sortedBeat) => {
    if (clipIn === undefined) return sortedBeat[0]?.time ?? 0
    if (beatZeroId !== null) {
      const z = sortedBeat.find(a => a.id === beatZeroId)
      if (z) return z.time
    }
    return activeRegion?.inBeatTime ?? clipIn
  },
)
```

**- [ ] Step 4: Run — expect PASS**

**- [ ] Step 5: Replace useMemo in WarpView**

```ts
const beatOffset = useAppSelector(selectBeatOffset)
```

**- [ ] Step 6: Verify**

```bash
npx tsc -b tsconfig.build.json
npx vitest run
```
Expected: all pass.

---

### Task 18: Sweep residual CanvasTimeline logic + final verification

**Files:**
- Modify: `src/components/CanvasTimeline.tsx`

**- [ ] Step 1: Audit `useMemo` / inline derivations in CanvasTimeline.tsx**

Grep:
```bash
grep -n "useMemo\|useCallback\|const .* = .*find" src/components/CanvasTimeline.tsx | head -30
```

For each: is it pure logic on slice values (→ should be a selector)? Or is it canvas-geometry (→ stays)?

**- [ ] Step 2: Move any pure-data derivations to selectors**

Same pattern as Tasks 14-17: write selector test, add to `selectors/timeline.ts`, replace inline with `useAppSelector(...)`.

If the canvas component genuinely needs nothing extracted, document with a one-line comment:
```ts
// Logic in this file is canvas-layer wiring (hit-testing, draw commands).
// Pure data derivations live in src/store/selectors/timeline.ts.
```

**- [ ] Step 3: Full verification**

```bash
npx tsc -b tsconfig.build.json
npx vitest run
```
Expected: all 1500+ tests pass.

---

### Task 19: Commit Refactor (Tasks 11-18)

**- [ ] Step 1: Sanity check**

```bash
git status
git diff --stat
```

Expected:
- `src/timeline/types.ts` — `DragState` simplified.
- `src/timeline/controller.ts` — large delete + simplifications.
- `src/store/selectors/timeline.ts` — new file.
- `src/components/WarpView.tsx` — `useMemo` blocks replaced with `useAppSelector`.
- `src/components/CanvasTimeline.tsx` — minor cleanups.
- `tests/unit/store/selectors/timeline.test.ts` — new test file.

**- [ ] Step 2: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(timeline): controller intent-pure + WarpView logic to selectors

Two coordinated cleanups landed together:

1. Controller becomes intent-pure. Deleted parallel `live*` state from
   DragState (liveRegion, liveAnchors, liveBeatAnchors, liveRegionBounds,
   liveBoundsList, liveInputAnchors) plus origInputTimes/origBeatTimes.
   Intent payloads are now computed inline from origTime + delta against
   the snapshot, so the controller's drag-state shape only carries "what
   was grabbed" — derived values come from snap + cursor.

2. WarpView's useMemo'd derivations moved into memoised selectors
   (src/store/selectors/timeline.ts): selectAnchorPairs, selectQuantAnchors,
   selectSnapTargetsInput, selectSnapTargetsOutput, selectLinkedBoundaries,
   selectSelectedBoundaries, selectBeatOffset. WarpView is now pure
   wiring (useAppSelector + dispatch callbacks). Each selector gets a
   unit test under tests/unit/store/selectors/timeline.test.ts.

CanvasTimeline residual derivations swept similarly.

No behavior change — same test count passes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Checklist

Before claiming this plan is done, verify:

- [ ] Every spec requirement (Section 1, 2, 3 of the design doc) maps to at least one task above.
- [ ] No "TBD" / "TODO" / "similar to Task N" / "add appropriate error handling" anywhere.
- [ ] Every type / function name used in a later task is defined in an earlier task.
- [ ] Every code step has the actual code (no "implement the function" without showing it).
- [ ] Every test step has the actual assertion (no "write tests for the above" without code).
- [ ] Commands have expected output where it matters.

If the audit in Task 8 or Task 9 finds nothing dead, the relevant task becomes a no-op + a documentation comment. That's fine — the audit IS the value.
