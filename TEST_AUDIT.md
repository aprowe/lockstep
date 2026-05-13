# Test Audit — 2026-05-12

## Summary

- **Total test files:** 46 (44 passing, 2 failing)
- **Total tests (approx):** 1070
- **Currently passing:** 1065
- **Currently failing:** 5 (in 2 files)

---

## Pre-existing failures

### 1. `tests/bdd/timeline/clip-bounds.test.ts` — `ScenarioNotCalledError` (file-level, 0 tests run)

**Root cause:** `spec/features/timeline/clip-bounds.feature` line 79 contains:
```
Scenario: A region's zoom action is called when double-clicked
```
The test file marks it as:
```ts
// @behavior clip-bounds::8636d673 — TODO: re-implement for CanvasTimeline (thin timeline removed)
```
No `Scenario(...)` block is provided. vitest-cucumber throws `ScenarioNotCalledError` when any feature scenario is unimplemented, failing the entire file.

**Action:** Add a stub `Scenario(...)` block referencing the missing canvas double-click path, or remove the scenario from the feature file if it is covered elsewhere. This is a spec-gap, not broken production code.

---

### 2. `tests/bdd/regionEditing.test.ts` — 5 failures in 2 scenarios

**Scenario A: "Clicking a region moves the playhead to its start" — `timeline overlay` row**
The `ScenarioOutline` runs for `clip sidebar` (passes) and `timeline overlay` (fails). The `timeline overlay` branch is a stub that does nothing — `observed.selected` stays `null`. This is a spec-gap left after the thin timeline was removed.

**Scenario B: "Right-clicking a clip in the sidebar opens a menu with Rename"**
The `When: user selects Rename` step re-renders the panel (workaround for step isolation) but `cleanup()` only runs in `BeforeEachScenario`. Both the prior `When` render and this new render are alive simultaneously, so `screen.getByText('Rename')` finds two elements and throws. The `Then`/`And` steps cascade as `null` assertions.

Both are bugs in the test harness against active production code. **Fix, don't delete.**

---

## Recommended deletions (REMOVE-trivial)

Setter-only tests that assert "field is set to payload". A regression in the reducer would be caught by the BDD tests that exercise these paths end-to-end.

- `tests/unit/slices/regionSlice.test.ts:66` — `describe('setActiveRegionId')` — both `it` blocks (`sets the active region`, `accepts null to clear selection`). Plain field assignment; no side-effects.
- `tests/unit/slices/regionSlice.test.ts:131` — `describe('renameRegion') it('updates the region name')` — trivial name-field setter.
- `tests/unit/slices/regionSlice.test.ts:139` — `describe('updateRegionBpm') it('updates the bpm')` — trivial BPM-field setter.
- `tests/unit/slices/regionSlice.test.ts:113` — `describe('updateRegionBeatTimes') it('sets beat boundary times')` — trivial field setter; the interesting invariant (preserving vs. clearing beat times when in/out changes) is in the two `updateRegionInOut` tests.
- `tests/unit/slices/warpSlice.test.ts:105` — `describe('moveBeatAnchor') it('updates the beat anchor time')` — the unlink test (line 98) and the orig-unchanged test (line 111) carry all the value; this middle test just confirms `time` is written.
- `tests/unit/slices/warpSlice.test.ts:235` — `describe('selection') it('setSelectedIds sets an explicit list')` — plain setter for `selectedIds`.
- `tests/unit/playbackLoop.test.ts:20` — `it('setPlaybackLoopMode swaps the mode')` — cycles through three enum values to confirm the setter sets. The `defaults to continue` test on line 15 has value; this one is boilerplate.

**Estimated removals:** ~9 individual `it()` blocks across 3 files. No file deletion.

---

## Recommended deletions (REMOVE-obsolete)

Tests that assert old behavior that is now **wrong** (not just different).

- `tests/bdd/regionEditing.test.ts:34` (the `timeline overlay` example row only) — the `ScenarioOutline` `Examples` table lists two surfaces. The `timeline overlay` row has never been implemented since the thin timeline was removed and always fails. Remove the `| timeline overlay |` row from the `Examples` table; keep the rest of the scenario. **Do not delete the file or the scenario block.**

**Estimated removals:** 1 table row in the feature file's `spec/features/region-editing.feature` (and the corresponding `TODO` stub in the test).

---

## Recommended deletions (REMOVE-dead-code)

No test file imports a symbol that no longer exists after the `chore: remove thin timeline + dead gesture-store fields` commit. However, six commented-out scenario stubs remain in `tests/bdd/timeline/clip-bounds.test.ts` that reference removed gesture-store fields:

- `tests/bdd/timeline/clip-bounds.test.ts:516` — `// @behavior clip-bounds::f0e33aba — TODO: re-implement (relied on removed gesture-store live fields)`
- `tests/bdd/timeline/clip-bounds.test.ts:780` — same pattern (`clip-bounds::293237ae`)
- `tests/bdd/timeline/clip-bounds.test.ts:948` — same pattern (`clip-bounds::b92723ee`)
- `tests/bdd/timeline/clip-bounds.test.ts:1461` — same pattern (`clip-bounds::a6f4c36c`)
- `tests/bdd/timeline/clip-bounds.test.ts:2748` — same pattern (`clip-bounds::abb7525e`)

These are not executable — they are orphaned comment blocks. Delete them (and the `spec/features/timeline/clip-bounds.feature` scenarios they map to) or convert them to `it.todo()` stubs so the file-level `ScenarioNotCalledError` at line 79 gets fixed at the same time.

**Estimated removals:** 5–6 comment-only stubs (~20–50 lines).

---

## Weak tests (WEAK-gesture-bypass) — keep but flag

These dispatch thunks or mutate state directly, bypassing the controller's pointer-event → intent → React handler path that runs in production.

- `tests/unit/thunks/regionThunks.test.ts` — `describe('moveRegionBounds')`, `describe('moveAnchors')`, `describe('moveBeatAnchors')` — correct assertions about the no-linking-event design, but they call thunks directly. The controller path that produces these dispatches is only exercised in `clip-bounds.test.ts`. **Keep; upgrade candidate when time allows.**

- `tests/unit/thunks/clipoutThunks.test.ts` — all `commitClipoutResize` and `commitClipoutPan` tests use direct dispatch. The anchor-rescale math is non-trivial and genuinely worth testing at this layer, but no test exercises the controller `pointerUp` → clipout-commit path. **Keep.**

- `tests/unit/thunks/dragThunks.test.ts` — `cancelDrag rollback` tests bypass the controller's full drag lifecycle. Valid smoke tests for the rollback mechanism. **Keep.**

- `tests/unit/slices/regionSlice.test.ts` — `describe('applyLinkingEvent')` and `describe('applyConformedClipout')` — test the reducer directly; production fires these only through `clipoutThunks`. Overlaps with `clipoutThunks.test.ts` at a lower layer. **Keep for slice-level coverage; note the duplication.**

---

## Files to keep wholesale

```
tests/unit/slices/warpSlice.test.ts
tests/unit/slices/historySlice.test.ts
tests/unit/selectors.test.ts
tests/unit/utils/quantize.test.ts
tests/unit/utils/snap.test.ts
tests/unit/utils/view.test.ts
tests/unit/utils/exportRequest.test.ts
tests/unit/middleware/revealPlayheadMiddleware.test.ts
tests/unit/assistant.registry.test.ts
tests/unit/timeline/controller.test.ts
tests/unit/timeline/hitTest.test.ts
tests/unit/timeline/layout.test.ts
tests/unit/timeline/ruler.test.ts
tests/unit/timeline/view.test.ts
tests/unit/timeline/model/beatMap.test.ts
tests/unit/timeline/model/clampRegion.test.ts
tests/unit/timeline/model/clipoutProjection.test.ts
tests/unit/timeline/model/conform.test.ts
tests/unit/timeline/model/conformedRegionUpdate.test.ts
tests/unit/timeline/model/effectiveBounds.test.ts
tests/unit/timeline/model/linkState.test.ts
tests/unit/timeline/model/linkingEvent.test.ts
tests/unit/timeline/model/liveOverrides.test.ts
tests/unit/timeline/model/newRegionBounds.test.ts
tests/unit/timeline/model/snapTarget.test.ts
tests/unit/timeline/model/stretchRescale.test.ts
tests/bdd/fileMenu.test.ts
tests/bdd/frameCount.test.ts
tests/bdd/markerFileDrop.test.ts
tests/bdd/prevJumpWindow.test.ts
tests/bdd/thumbnails.test.ts
tests/bdd/videoLoading.test.ts
tests/bdd/timeline/drag.test.ts
tests/bdd/timeline/region-creation.test.ts
tests/bdd/timeline/viewport.test.ts
tests/integration/frameCount.bdd.spec.ts
tests/integration/exportOptions.bdd.spec.ts
tests/integration/listSelection.bdd.spec.ts
tests/integration/videoLoading.bdd.spec.ts
```

`regionSlice.test.ts` and `warpSlice.test.ts` should be **partially trimmed** per the REMOVE-trivial list above, not deleted — both contain genuinely defensive tests of non-obvious reducer logic.
