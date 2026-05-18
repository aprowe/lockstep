# Constraint-based architecture migration plan

Migrate the timeline's cross-entity coupling from ad-hoc thunks / controller branches to the constraint resolver in `src/constraints/`. The POC is real and covers the model — this plan is about wiring it into the real app.

**POC entry points** (already built):
- `reduce(state, op)` — `src/constraints/resolver.ts`. Phase pipeline: propose (fixed-point) → restrict → finalize → derive.
- `recipes.*` — `src/constraints/recipes.ts`. `lasso`, `lockOn/lockOff`, `carryStart/End`, `diverge`, `setBpm/setLockedBeats`, `snapToSiblings`, `conform/unconform`, `initClip`, `initAnchorPair`, etc.
- Constraint kinds: `TranslateGroup`, `ScaleGroup` (both with optional `driver` → one-way), `DirectedPair` (translate, mirror_edge), `Derived` (lambda escape hatch), `Clamp`, `PreserveLength`, `SnapTarget`, `SingleOfKind`, `DeleteGroup`, `HighlightGroup`, `ConformVisual`.

**Scope:** ~7 phases. Phase 1 is the big one (data shape); each later phase is independently mergeable.

---

## Goals & non-goals

**Goals**
- Position state (`origAnchors[].origTime`, `beatAnchors[].beatTime`, `regions[].inPoint/outPoint/inBeatTime/outBeatTime`) moves into `constraintSlice.state.entities` and is mutated only through `reduce(state, op)`.
- Every cross-entity coupling becomes a typed constraint that recipes add/remove.
- `state.constraintState.entities × state.constraintState.constraints` is the source of truth for the timeline. Slices keep non-position metadata.
- The recent classes of bugs (anchor-lock direction inversions, frame drift during group drag, scale_group eating anchor writes) become structurally impossible.

**Non-goals**
- Replacing render-time derivations (`effectiveBeatBounds`, `projectClipoutRegions`). They stay as queries over constraint state.
- Touching export, history, persistence shape beyond what the constraint slice requires.
- Doing it in one PR. Each phase ships.

## Hard invariants

These do not change across phases:

- **Constraints and ops are NEVER persisted to disk.** `state.constraint.graph.constraints[]`, individual `Op` records, and any function-bearing payloads (lambdas, predicates) are in-memory only. Persistence (`SavedVideoState` / sidecar JSON / app data dir) serializes only pure positional/metadata data so that future constraint refactors never break loading. On load, the graph is reconstructed from the persisted positions via `buildSeedGraph` (or equivalent); recipes re-attach any structural constraints (default-links, initClip outputs) as part of that load.
- **History (undo/redo) is in-memory only** and may carry the full graph; that's fine — history doesn't survive process restart.
- **Resolver is dormant when no relevant constraints exist.** `applyOp` with an empty `constraints[]` is just an entity write.

---

## Phase 0 — Vendor + slice (~half day)

Add a Redux slice that holds the constraint State. No semantics wired yet.

**Files**
- New: `src/store/slices/constraintSlice.ts`.
- Modified: `src/store/store.ts` (register).
- Modified: `src/store/middleware/historyMiddleware.ts`, `persistenceMiddleware.ts` (whitelist the slice).

**Slice shape**
```ts
import type { State as ConstraintState, Op } from '../../constraints'
import { reduce, emptyState } from '../../constraints'

interface ConstraintSliceState {
  // The entire POC State sits here.
  graph: ConstraintState
}

// Single reducer: any op dispatched through this slice runs through reduce().
const slice = createSlice({
  name: 'constraint',
  initialState: { graph: emptyState() },
  reducers: {
    applyOp(state, action: PayloadAction<Op>) {
      state.graph = reduce(state.graph, action.payload)
    },
    setGraph(state, action: PayloadAction<ConstraintState>) {
      state.graph = action.payload
    },
  },
})
```

**Verify:** existing tests pass; nothing reads `constraint.graph` yet.

---

## Phase 1 — Move positions into entities (~1.5 days, the big one)

Anchors and regions split into the entity model:

| Today | After |
|---|---|
| `warpSlice.origAnchors: Anchor[]` (id, origTime, beatTime, …) | Two entities per pair: `anchor:{id}:in` (time = origTime), `anchor:{id}:out` (time = beatTime). Linked by `DeleteGroup` + default-link `DirectedPair` (translate). |
| `regionSlice.regions[].{inPoint, outPoint, inBeatTime?, outBeatTime?}` | Two clip entities per region: `clip:{id}:in` (in = inPoint, out = outPoint), `clip:{id}:out` (in = inBeatTime ?? inPoint, out = outBeatTime ?? outPoint). Default-link `DirectedPair` clipin → clipout (removed by `recipes.diverge` on first explicit clipout edit). |
| `region.lock: 'bpm' | 'beats'` | **Leave alone in Phase 1.** Phase 6 deletes it and introduces global `ui.lockMode`. |
| `region.bpm` | **Leave alone in Phase 1.** Phase 6 moves it to `state.meta[clipoutId].bpm` alongside the Derived constraint. |
| `region.colorIndex`, `region.name` | Stays on `region` (no coupling — pure metadata). |

**Write paths.** Every mutation that touches positions becomes a dispatch of `constraintSlice.applyOp(op)`:

| Old action | New op |
|---|---|
| `warpSlice.setOrigAnchorTime` | `Move` (anchor-in) — propagates through default-link to anchor-out. |
| `warpSlice.setBeatAnchorTime` after `diverge` (existing concept) | `Move` (anchor-out). |
| `regionSlice.setRegionInPoint` etc. | `SetEdge` on the clipin entity. |
| `regionSlice.addRegion` | `AddClip` × 2 + `recipes.initClip` (default-link, bpm-derived, preserve-length, clamps). |
| `regionSlice.removeRegion` | `Delete` (propagates via `DeleteGroup`). |
| `regionSlice.setRegionLock` | **Leave alone in Phase 1.** Phase 6 removes it. |

**Files affected (heavy)**
- `src/store/slices/warpSlice.ts` — drop position fields (`origAnchors[].origTime`, `beatAnchors[].beatTime`); keep anchor IDs and roles (`linkedBeatIds`, `beatZeroId`).
- `src/store/slices/regionSlice.ts` — drop `inPoint/outPoint/inBeatTime/outBeatTime`; keep `id, name, colorIndex, lock`.
- `src/store/selectors.ts` — rewrite anchor/region readers to derive from `constraint.graph.entities`. Many touch points.
- `src/store/thunks/regionThunks.ts`, `clipoutThunks.ts` — every mutation becomes an `applyOp` dispatch.
- `src/timeline/controller.ts` — drag pointerMove dispatches `applyOp(Move | SetEdge)`; no more direct anchor/region writes.
- `src/components/Timeline.tsx`, `WarpView.tsx`, `RegionSidebar.tsx` — read from new selectors.

**Risks**
- The map between (anchor pair) → (anchor-in id, anchor-out id) is load-bearing. Adopt a deterministic id scheme: anchor pair id `7` becomes entities `a7-in` / `a7-out`. Region `r3` becomes `r3-in` / `r3-out`. Document it.
- Persistence file format changes. Pre-release → OK to break, but write a one-shot migration helper for any saved test fixtures.
- Tests under `tests/` that poke positions directly must move to the new selectors.
- **`serializableCheck` middleware:** RTK's dev middleware will trip on non-serializable function payloads as soon as ops start flowing. `Derived.apply` and `RemoveConstraintOp.predicate` in `src/constraints/types.ts` both carry lambdas, and recipes like `initClip` (adds a `bpmDerivedConstraint`) and any remover that uses a predicate will dispatch them. Configure `serializableCheck` in `src/store/store.ts` to ignore `payload.constraint.apply`, `payload.predicate`, and the in-state path `constraint.graph.constraints` (via `ignoredActionPaths` / `ignoredPaths`) — keep it scoped, don't blanket-disable.

**Phase 1 is the load-bearing step.** No behavior changes yet — the resolver runs but does nothing (no non-trivial constraints in the list). The win is that all positions flow through one reducer.

---

## Phase 2 — Selection as `TranslateGroup` (~1 day)

Replace the four selection sets with bidirectional `TranslateGroup` constraints tagged `lasso:*`.

**Today**
```ts
selectedOrigIds: number[]
selectedBeatIds: number[]
selectedClipinIds: Set<EntityId>   // in listsSlice
selectedClipoutIds: Set<EntityId>
```

**After**
- A lasso commit dispatches one `recipes.lasso('main', [ids…])` op covering every lassoed entity across spaces.
- Click-select: `clearLasso('main')` + `lasso('main', [id])`.
- Selectors `selectSelectedOrigIdsSet` etc. read constraint state, filter `TranslateGroup` entries with `tag: 'lasso:*'`, and partition entities by id-prefix (`a*-in` vs `a*-out` vs `r*-in` vs `r*-out`).

**Files affected**
- `src/store/slices/warpSlice.ts`, `listsSlice.ts` — delete selection fields.
- `src/store/selectors.ts` — selection selectors derive from constraints.
- `src/timeline/controller.ts` — `buildAnchorDrag`/`buildRegionDrag` no longer manually pair across spaces; the resolver does the propagation when one member moves.
- `src/timeline/types.ts` — `Snapshot.selected*` derived, not stored.

**Win**
- The "drag any selection member to drag the group" behavior is one resolver pass; controller stops cross-space partitioning (~70 lines).
- Frame-drift bug class (group members reading already-moved siblings) goes away — `applyOp(Move)` is one shot per frame, group propagation happens inside the resolver from the same seed.

**Risks**
- Many sites read the selection sets (sidebars, context menus, delete handlers). Inventory required.
- "Is this entity selected?" stays cheap because we memoise the partitioned sets.

---

## Phase 3 — Anchor-lock via `recipes.lockOn` (~1 day)

Replace `ui.anchorLock` thunk-side translate/rescale with directed group constraints.

**Today**
- `ui.anchorLock: boolean` checked in `commitClipoutPan` / `commitClipoutResize` / `panClipinBounds`.
- Each thunk recomputes inner-anchor set from `preDrag` snapshot, applies translate or scale by hand.
- Live-preview path in `controller.ts` duplicates the logic.

**After**
- `ui.anchorLock` toggle dispatches `recipes.lockOn(clipoutId, innerAnchorOutIds)` (or `lockOff`). Adds:
  - `TranslateGroup` with `driver: clipoutId`, `tag: 'lock:{clipoutId}'`.
  - `ScaleGroup` with `driver: clipoutId`, `tag: 'lock:{clipoutId}'`.
- Alt-flip during drag: same recipe, ephemeral — `lockOn` on pointerDown if `altKey`, `lockOff` on pointerUp.
- Drag pointerMove dispatches `applyOp(SetEdge clipout)` or `applyOp(Move clipout)`. Resolver propagates.

**Files affected**
- `src/store/thunks/clipoutThunks.ts` — delete anchor translation/rescale branches (~80 lines per thunk).
- `src/store/thunks/regionThunks.ts` — `panClipinBounds` similarly shrinks.
- `src/timeline/controller.ts` — live-preview rescale path deletes.
- New: `src/store/recipes/anchorLockRecipe.ts` — listener middleware that watches `ui.anchorLock`, active region, inner anchor set, fires `lockOn`/`lockOff`.

**Win**
- The "lock + region.lock=beats + resize" rule lives in `recipes.lockOn` (one place). Today it's split across controller + thunk.
- The class of bugs we hit during the POC (`translate_group` ate a resize, anchors pulled the clipout) cannot recur — the driver is structural.

**Risks**
- Recipe needs to react to `ui.anchorLock` + active region + region.lock + inner-anchor membership. Use a listener middleware that rebuilds the `lock:*` constraints whenever those inputs change.
- "Inner anchor set" semantics: captured at lock-ON, or always live? Recommend live — recipe re-runs on relevant action types, keeping the constraint list in sync with the membership.

---

## Phase 4 — Default-linked clipout (~half day)

**Today**
- `effectiveBeatBounds(region, anchors)` returns `inBeatTime ?? inPoint` etc. — "default-linked" is an undefined sentinel.

**After**
- `recipes.initClip` adds a `DirectedPair` (translate) clipin → clipout tagged `defaultlink:{clipinId}`. Already done in the POC.
- First explicit clipout pan/resize calls `recipes.diverge(clipinId)` to remove the pair.
- `effectiveBeatBounds` reads constraint state; "default-linked" = "is the pair present?"

**Files affected**
- `src/store/thunks/clipoutThunks.ts` — call `diverge` before committing explicit bounds.
- `src/timeline/model/effectiveBounds.ts` — query constraints.
- `regionSlice.resetRegionBoundary` — re-add the default-link pair.

**Win**
- Sentinel-as-state goes away. "Reset" becomes "re-add the pair" — uniform with how every other coupling is reset.

---

## Phase 5 — Conformed-marker carry (~half day)

**Today**
- `commitClipoutResize` / `commitClipoutPan` call `detectConformedMoves` on every dispatch, translating paired anchor-outs with the edge.

**After**
- Controller `pointerDown` on a clipout edge / body runs `detectConformedMoves` ONCE.
- For each conformed boundary, dispatches `recipes.carryStart(clipoutId, edge, pairedAnchorOutId)` — adds a `DirectedPair` (mirror_edge) clipoutEdge → anchorOut tagged `carry:{clipoutId}:{edge}`.
- Resolver carries the propagation each pointerMove.
- `pointerUp` dispatches `recipes.carryEnd(clipoutId)`.

**Files affected**
- `src/store/thunks/clipoutThunks.ts` — delete the conformed-carry branch (~50 lines).
- `src/timeline/controller.ts` — `carryStart`/`carryEnd` at drag bounds.

**Win**
- `detectConformedMoves` runs once per drag instead of per frame.
- Dumping `state.constraintState.constraints` mid-drag reveals exactly which markers are tied to which edges.

---

## Phase 6 — BPM/lockedBeats tradeoff + global lock (~half day)

**Behavioral change.** Per-region `region.lock` goes away; a single `ui.lockMode: 'bpm' | 'beats'` applies to every region. Toggling the global swaps every clipout's tradeoff at once.

**Today**
- `region.lock` per region. `conformedRegionUpdate` recomputes bpm or beats from new clip length according to that region's lock.

**After**
- `ui.lockMode` is the only lock setting. UI inspector shows ONE toggle, not one-per-region.
- The bpm tradeoff lambda must read the current `lockMode` at run time. Add a single global slot to the constraint State — `state.globals: { lockMode: 'bpm' | 'beats' }` — and have a sync middleware mirror `ui.lockMode` into it. (One-line addition to `src/constraints/types.ts`.)
- `bpmDerivedConstraint(clipoutId)` (no `fixed` arg anymore) reads `state.globals.lockMode` in its lambda.
- Typing BPM in the inspector → `recipes.setBpm(clipoutId, newBpm, state)`. When `state.globals.lockMode === 'beats'`, dispatches both `SetValue bpm` and `SetEdge clipout.out` at the new length so propagation flows through the pipeline (`scale_group` rescales inner anchors etc.).
- Typing locked beats → `recipes.setLockedBeats` symmetric.

**Files affected**
- `src/constraints/types.ts` — add `globals` to `State`.
- `src/constraints/resolver.ts` — `emptyState()` initializes `globals`.
- `src/constraints/recipes.ts` — `bpmDerivedConstraint`, `setBpm`, `setLockedBeats` no longer take `fixed`; read `state.globals.lockMode`.
- `src/store/slices/regionSlice.ts` — delete `region.lock`.
- `src/store/slices/uiSlice.ts` — add `lockMode`.
- `src/timeline/model/conformedRegionUpdate.ts` — delete.
- `src/store/thunks/clipoutThunks.ts` — `applyConformedClipout` stops calling `conformedRegionUpdate`.
- `src/components/RegionInfoPanel.tsx` — remove per-region lock dropdown; defer to a global toggle (probably in `MenuBar` or `Toolbar`).
- New: sync middleware mirroring `ui.lockMode` → `state.globals.lockMode`.

**Win**
- One global tradeoff. UI is simpler (no per-region dropdown). Constraint list per clipout is one Derived constraint (created once, never swapped).
- The "what does lock mean if I have 5 regions" question disappears.

**Risks**
- This is the one phase that changes user-visible behavior. Confirm with stakeholders that no workflow depends on per-region lock today before shipping.

---

## Phase 7 — Snap + drag/cancel (~half day)

**Snap**
- `pointerDown` on a draggable: dispatch `recipes.snapToSiblings(id, field, state, pxPerUnit, 8)`. Adds a `SnapTarget` constraint.
- Resolver snaps each pointerMove inside Propose phase (already implemented — rigid for clip body drags).
- Render hint uses `findSnapCandidates(state, id, field, value)` to highlight nearby targets.
- `pointerUp`: `recipes.snapEnd(id, field)`.

**Drag/cancel**
- `dragSlice.preDrag` snapshots `constraint.graph` at drag start (the whole `State`).
- `dragCancel` restores it: `setGraph(snapshot)`. Any ephemeral constraints added by recipes (carry, snap) revert atomically because the constraint list is part of the snapshot.

**Files affected**
- `src/store/slices/dragSlice.ts` — snapshot shape.
- `src/store/thunks/dragThunks.ts` — `cancelDrag` restores.
- `src/timeline/model/snapTarget.ts` — replace with calls into the resolver / `findSnapCandidates`.

**Win**
- No more "did I remember to remove the ephemeral constraint on cancel?" — the snapshot is all of constraint state.
- Undo/redo: any state expressible as constraints is undoable for free.

---

## Files that delete after full migration

Rough estimate:

- `src/store/thunks/clipoutThunks.ts` — ~250 → ~80 lines (primary writes only).
- `src/store/thunks/regionThunks.ts` — similar.
- `src/timeline/controller.ts` — `buildAnchorDrag` / `buildRegionDrag` ~100 lines gone.
- `src/timeline/model/conformedRegionUpdate.ts` — delete.
- `src/timeline/model/linkingEvent.ts` — already obsolete; finally gone.
- `src/timeline/model/snapTarget.ts` — collapses to a thin wrapper over `findSnapCandidates`.
- Selection sets across slices — gone.

Net: -500 to -700 lines deleted, +150 lines added across `constraintSlice.ts` + recipe listener middlewares. (The constraint resolver itself — ~900 lines — was already added by the POC.)

---

## Resolver execution order notes

Constraints fire in `state.constraints` array order, within each phase. The recipe layer is responsible for inserting in the right slot when order matters:

- **Carry pair → derived BPM:** carry must fire in Propose (it does — DirectedPair Propose handler) so the length write is settled before Derive runs the bpm lambda. Already structurally correct.
- **Lasso TranslateGroup → lock DirectedGroup (Phase 3):** if a lassoed clipout is also a lock driver, the lasso fires first (bidirectional, all members get the same delta), then the lock directed group fires (driver has writes, propagates to inner anchors). Both converge on the same delta. The propose fixed-point handles cycles.
- **Snap → scale_group:** snap is in Propose (rigid-clip-aware), so the snap-adjusted edge feeds back into scale_group on the next iteration of the fixed-point. Already structurally correct.

---

## Rollback / risk model

Phases 2–7 are independent. Phase 1 is the data foundation — if it goes badly, the migration stops there and the constraint slice is dormant.

Mitigation for Phase 1: write the new selectors against constraint state, BUT keep the old slice fields populated by a sync middleware (slice → graph) for one PR. Flip the selector reads from old to new in a follow-up PR once the parallel write paths look stable.

---

## When to bail

- If tag conventions (`lasso:*`, `lock:*`, `carry:*`, `defaultlink:*`) become load-bearing for resolver correctness (rather than just for removal), stop — that's a sign the constraint model is missing a primitive.
- If the recipe layer accumulates more than ~20 recipes, the catalogue has grown beyond "named gestures" into "scattered business logic." Time to revisit grouping.
- If `Derived` (lambda) constraints proliferate beyond the bpm tradeoff, the model is being asked to express things that should be plain helpers.

---

## Settled decisions

1. **Entity id scheme:** `a{n}-in` / `a{n}-out` / `r{n}-in` / `r{n}-out`. Deterministic, derivable in both directions.
2. **Lock mode:** Global — one `ui.lockMode` for the whole app. `region.lock` is deleted in Phase 6. Mirrored into `state.globals.lockMode` for the bpm lambda to read.
3. **`linkedBeatIds`:** Derived from presence of the `defaultlink:{anchorInId}` DirectedPair. Field deleted from `warpSlice`. `diverge` removes the pair → anchor becomes "unlinked" automatically.
4. **History:** Whole `constraint.graph` snapshot per entry. Simplest; revisit only if memory becomes a problem.

## Still open (lower-impact, settle during Phase 0)

5. **Recipe location.** Proposal: `src/store/recipes/*.ts` next to thunks. Each recipe returns `Op[]`; callers dispatch each op via `constraintSlice.applyOp`. Recipes that must react to slice changes (anchor-lock membership, default-link auto-add on region create, global lockMode mirror) become listener middlewares.
