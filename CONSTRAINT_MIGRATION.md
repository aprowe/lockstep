# Constraint-based architecture migration plan

Migrate the timeline's cross-entity coupling from ad-hoc thunks / controller branches to a declarative `state.constraints: Constraint[]` list with a generic resolver. POC: `src/sandbox.ts`.

**Total scope:** ~6 phases, ~5 working days of focused work. Each phase is independently mergeable and produces visible cleanup. Phase 1 alone is worth doing even if you stop there.

---

## Goals & non-goals

**Goals**
- Every cross-entity coupling (selection group, anchor-lock, default-link, conformed-marker carry, etc.) becomes a typed entry in `state.constraints`.
- The user-visible behavior at any moment is a pure function of `entities × constraints`.
- A user gesture (lasso, lock toggle, conform-on-pointerUp) becomes a "recipe" that adds/removes constraints — recipes are tiny and explicit.
- Resolver code is generic (~5 constraint kinds, ~3 propagators). No per-behavior switch arms.

**Non-goals**
- Replacing render-time derivations (`effectiveBeatBounds`, `projectClipoutRegions`). These stay as queries — conform is visual, not a commit.
- Touching the controller's intent shape, the export pipeline, history snapshots, or persistence file format beyond the constraint list itself.
- Doing the whole thing in one pass. Each phase ships.

---

## Phase 0 — Scaffolding (~half day)

Add the constraint slice with no semantics wired up. Pure storage + actions, ready to use.

**Files**
- New: `src/store/slices/constraintSlice.ts`
- Modified: `src/store/store.ts` (register slice)

**Shape**
```ts
type Constraint =
  | { kind: 'translate_group'; ids: EntityId[] }
  | { kind: 'scale_group';     ids: EntityId[]; pivot: number }
  | { kind: 'pair';            aId: EntityId; bId: EntityId }
  | { kind: 'delete_group';    ids: EntityId[] }
  | { kind: 'derived_quantity'; clipoutId: EntityId; formula: 'beats = length * bpm / 60'; fixed: 'bpm' | 'beats' }

interface ConstraintState {
  constraints: Constraint[]
}
```

Actions: `addConstraint`, `removeConstraint(predicate)`, `clearConstraints`.

History + persistence whitelisting: yes.

**Verify:** tests still pass, no behavior change yet.

---

## Phase 1 — Selection as constraint (~1 day)

Replace per-space selection sets with `translate_group` constraints.

### What changes

**Today's state**
```ts
selectedOrigAnchorIds: Set<EntityId>
selectedBeatAnchorIds: Set<EntityId>
selectedClipinIds: Set<EntityId>
selectedClipoutIds: Set<EntityId>
```

**After**
- The four sets become derived: a selector reads constraints + finds entities mentioned in `translate_group` constraints, partitions by entity space.
- Lasso commit dispatches `addConstraint({ kind: 'translate_group', ids: lassoedIds })` once per space the lasso covered.
- Click-select replaces the existing-group constraint with a new one-member group.
- Deselect = `removeConstraint(predicate matching the selection group)`.

### Files affected

| File | Change |
|---|---|
| `src/store/slices/warpSlice.ts` | Delete `selectedOrigIds` / `selectedBeatIds` fields + actions. |
| `src/store/slices/listsSlice.ts` | Delete `clipin` / `clipout` selection lists (or keep as render-only hover). |
| `src/store/selectors.ts` | Replace `selectSelectedOrigIdsSet` etc. with constraint-derived selectors. |
| `src/timeline/types.ts` | `Snapshot.selected*` fields become derived from constraints. Update lasso `DragState` to write a single constraint payload instead of two id sets. |
| `src/timeline/controller.ts` | Lasso commit writes constraints. `buildAnchorDrag` reads constraint membership instead of `wasSelected` + manual per-space partition (~70 lines simpler). `buildRegionDrag` same. |
| `src/components/CanvasTimeline.tsx` | Render selection highlight from constraint-derived selectors. |

### Resolver (Phase 1 subset)

Just `translate_group` propagation: moving any member by delta translates all other members by the same delta. The reducer needs:
```ts
function propagateTranslate(state, id, delta, visited): State
```
Called from a new `move` action that wraps the existing `moveOrigAnchor` etc.

### Win

- Delete `selectedOrigIds`, `selectedBeatIds`, `selectedClipinIds`, `selectedClipoutIds` — replaced by one list.
- Delete the per-space pairing logic in `buildAnchorDrag` (lines ~78–155 of controller.ts).
- Selection persistence: just persist the constraints list, get four sets' equivalent for free.

### Risks

- Selection logic is touched in many places (panel sidebars, context menus, delete handlers). Need a thorough audit.
- The constraint identity for "this is a lasso group" vs "this is an anchor-lock group" matters for removal. Add a `tag: string` field to constraints if needed (`tag: 'lasso'` / `tag: 'anchorlock'`).

---

## Phase 2 — Anchor-lock as constraint (~1 day)

Replace the global `ui.anchorLock` boolean → drag-time anchor-lock check → thunk-side translate/rescale logic with constraints.

### What changes

**Today**
- `ui.anchorLock: boolean` is read by `commitClipoutPan` / `commitClipoutResize` / `panClipinBounds`.
- Each thunk computes `effectiveAnchorLock = ui.anchorLock !== altKey`, then computes the inner-anchor set from preDrag snapshot, then applies translate or scale.

**After**
- `ui.anchorLock` stays as a UI toggle.
- When the toggle is ON, a recipe runs that adds two constraints per active region:
  - `translate_group { ids: [clipout, ...innerAnchorOuts], tag: 'anchorlock' }`
  - `scale_group     { ids: [clipout, ...innerAnchorOuts], pivot: clipout.in, tag: 'anchorlock' }`
- When OFF, recipe removes them.
- Alt-flip during drag: same recipe but ephemeral — added on pointerDown if altKey, removed on pointerUp.
- The thunks shrink dramatically. `commitClipoutPan` becomes: write the new bounds + let the resolver propagate. `commitClipoutResize` same.

### Files affected

| File | Change |
|---|---|
| `src/store/thunks/clipoutThunks.ts` | Delete the anchor translation / rescale branches (~80 lines per thunk). Keep the BPM/lockedBeats tradeoff math (or move to a `derived_quantity` constraint — see Phase 4). |
| `src/store/thunks/regionThunks.ts` | `panClipinBounds` similarly shrinks. |
| `src/timeline/controller.ts` | Live-preview rescale path in `pointerMove` (the one we just fixed for the resize/pan inversion) deletes — propagation happens through constraints. |
| New: `src/store/recipes/anchorLockRecipe.ts` | Computes which constraints to add when lock toggles. Watches `ui.anchorLock` + active region + inner anchors. |

### Resolver additions

`scale_group` propagation around a pivot.

### Win

- Delete ~150 lines of duplicated anchor-translation / anchor-rescale logic across thunks and the controller's live-preview branch.
- The "lock ON + lock=beats + resize" condition lives in ONE place (the recipe), not three (controller pointerMove + thunk + maybe more).
- The recent controller/thunk inversion bug we just fixed (`shouldRescale = effectiveAnchorLock && region.lock === 'beats'`) is structurally impossible: if the wrong constraint is in state, the recipe is the only place to fix it.

### Risks

- Recipe needs to react to: `ui.anchorLock`, the active region id, inner anchor set, region.lock. That's a multi-dependency effect — needs careful subscription (probably a listener middleware that fires on relevant action types and rebuilds the anchor-lock constraints).
- Inner-anchor set captured at drag start (today via `state.drag.preDrag`) — needs to map to "the recipe captures the entities at lock-ON moment, not live." Define semantics.

---

## Phase 3 — Default-linked clipout as `pair` (~half day)

### What changes

**Today**
- `effectiveBeatBounds(region, anchors, beatAnchors)` derives the clipout bounds: explicit `inBeatTime`/`outBeatTime` if set, else conformed input anchor's paired beat time, else fall back to `inPoint`/`outPoint`.
- "Default-linked" status is derived by checking if `inBeatTime` is undefined.

**After**
- Newly-added clipouts get a `pair(clipinId, clipoutId)` constraint.
- When the user pans/resizes the clipout (committing explicit bounds), the recipe removes the `pair`.
- `effectiveBeatBounds` still exists as a render query — but it can read `constraints` to know if the pair is active, instead of inspecting `inBeatTime` undefinedness.

### Files affected

| File | Change |
|---|---|
| `src/store/thunks/clipoutThunks.ts` | Pan/resize recipes: remove the `pair` before committing explicit bounds. |
| `src/store/recipes/clipDefaultLink.ts` | New: on `addRegion`, add the `pair`. |
| `src/timeline/model/effectiveBounds.ts` | Optional: read constraint list to decide default-linked vs explicit. (Pure rewrite if you want; works as today otherwise.) |

### Win

- "Default-linked" becomes a first-class structural state, not a sentinel-value (undefined) check.
- `resetRegionBoundary` becomes: re-add the `pair`, clear `inBeatTime`/`outBeatTime`. The button's disabled state derives from "is the pair already present."

### Risks

- The `pair` propagates symmetrically (move clipout → clipin moves). For default-linked, we likely want one-way: clipin → clipout but not reverse. Either add a `direction: 'forward' | 'bidirectional'` field to `pair`, or use `translate_group` with the understanding that clipout pan is preceded by removing the pair anyway.

---

## Phase 4 — Conformed-marker carry as ephemeral `pair` (~half day)

### What changes

**Today**
- `commitClipoutResize` / `commitClipoutPan` call `detectConformedMoves` at every dispatch to find input-anchors-at-boundary, and translate their paired beat anchors with the edge.

**After**
- On pointerDown of a clipout edge or body drag, a recipe scans for conformed boundaries (using the same `detectConformedMoves` logic but ONCE).
- For each conformed boundary, recipe adds an ephemeral `pair(clipoutEdge, pairedAnchorOut)` constraint with `tag: 'carry'`.
- During the drag, every `move` / `set_edge` on the clipout propagates to the paired anchor through the pair.
- On pointerUp, recipe removes all `tag: 'carry'` constraints.

### Files affected

| File | Change |
|---|---|
| `src/store/thunks/clipoutThunks.ts` | Delete the conformed-marker carry branch. ~50 lines. |
| `src/store/recipes/conformCarryRecipe.ts` | New: dispatched at drag start. Detects + adds pairs. Tied to `dragStart` / `dragEnd` actions. |

### Win

- `detectConformedMoves` becomes a one-shot query at drag start instead of running on every pointerMove.
- The carry behavior is visible in `state.constraints` during the drag — you can dump the list mid-drag and see exactly which markers are tied to which edges.

### Risks

- Need to thread the clip-edge vs clip-body distinction into the constraint (an "edge of clipout = pair only when that specific edge moves"). May need a slightly richer `pair` shape: `{ kind: 'pair_edge', clipId, edge: 'in' | 'out', anchorId }`.

---

## Phase 5 — BPM/lockedBeats tradeoff as `derived_quantity` (~half day)

### What changes

**Today**
- `conformedRegionUpdate(region, conformedIn, conformedOut)` computes BPM or lockedBeats from the new length depending on `region.lock`. Called by `applyConformedClipout`.

**After**
- A `derived_quantity` constraint per clipout: `{ clipoutId, formula: 'beats = length * bpm / 60', fixed: region.lock }`.
- Resolver propagates: when length changes (clipout in or out edge writes), recompute the non-fixed quantity.
- `region.lock` becomes the `fixed` field of the constraint.

### Files affected

| File | Change |
|---|---|
| `src/store/slices/regionSlice.ts` | `region.lock` field deprecated (or stays as a UI shortcut for editing the constraint). |
| `src/timeline/model/conformedRegionUpdate.ts` | Delete; logic moves into the constraint resolver's `derived_quantity` case. |
| `src/store/thunks/clipoutThunks.ts` | `applyConformedClipout` no longer needs to call `conformedRegionUpdate` — resolver handles it. |

### Win

- The lock tradeoff lives in ONE place (resolver case for `derived_quantity`). Today it's split between `conformedRegionUpdate` and various inline computations.

### Risks

- Changing `fixed` (e.g., user switches lock from 'bpm' to 'beats') needs to snapshot the current beat count at the moment of switch — today's `updateRegionLock` does this via the `lockedBeats` payload. Same pattern works: the action that flips `fixed` also writes the current value of the now-fixed quantity.

---

## Phase 6 — Drag/cancel through constraints (~half day)

### What changes

**Today**
- `dragSlice.preDrag` snapshots `{ regions, origAnchors, beatAnchors }` at drag start.
- `dragCancel` thunk restores those slice fields.

**After**
- `preDrag` snapshots `{ entities, constraints }`.
- Cancel restores both — any ephemeral constraints added by recipes during the drag are automatically removed because the constraint list reverts.

### Files affected

| File | Change |
|---|---|
| `src/store/slices/dragSlice.ts` | Snapshot shape change. |
| `src/store/thunks/dragThunks.ts` | `cancelDrag` restores entities + constraints. |
| `src/store/middleware/historyMiddleware.ts` | History entry includes constraints. |
| `src/store/middleware/persistenceMiddleware.ts` | Persisted file includes constraints. |

### Win

- The "active drag in flight" representation becomes consistent: state lives in `entities + constraints`. Snapshots are uniform.
- Undo/redo correctly captures multi-region selections, anchor-lock toggles, etc. — anything expressed as constraints is undoable for free.

### Risks

- Persisted file format changes. Pre-release (per CLAUDE.md) so OK to break.

---

## Resolver design notes

A single function:
```ts
function resolveConstraints(state: State, op: Op): State
```

Three propagators (translate, resize, delete) walk relevant constraints. Cycle detection via `visited: Set<EntityId>`.

Order matters: e.g., the lock-tradeoff `derived_quantity` should fire AFTER `scale_group`-driven anchor rescale, because the new length needs to be settled first. Encode order via the constraint list order (constraints fire in array order). Recipes are responsible for inserting constraints in the right slot.

**For the conformed-marker carry → length change → BPM recompute chain:**
1. User drags clipout in-edge.
2. Primary write: clipout.in changes.
3. `pair` (carry) propagates: paired anchor-out moves to new edge.
4. `derived_quantity` propagates: lockedBeats recomputes from new length.

The order is: pairs first, then derived quantities. Constraint list ordering enforces this.

---

## Files to delete after full migration

Rough estimate of code that goes away:

- `src/store/thunks/clipoutThunks.ts` shrinks from ~250 lines to ~80 (primary writes only).
- `src/store/thunks/regionThunks.ts` shrinks similarly.
- `src/timeline/controller.ts`'s `buildAnchorDrag` / `buildRegionDrag` shrink by ~100 lines (no manual per-space partitioning).
- `src/timeline/model/conformedRegionUpdate.ts` deletes.
- `src/timeline/model/linkState.ts` becomes a one-function query (still used for "find conformed pairs at drag start").
- `src/timeline/model/linkingEvent.ts` deletes (computeLinkingEvent was already obsolete after conform-is-visual).
- The 4 selection sets across slices delete.

Net: probably -500 to -700 lines, +250 lines (constraint slice + resolver + recipes).

---

## Rollback / risk model

Each phase is independent. If phase 2 (anchor-lock) goes badly, revert it and the prior phases still stand. The constraint slice is additive in Phase 0 — no commits there are destructive.

The single biggest risk is Phase 1 (selection-as-constraint) because selection is read in MANY places. Mitigation: in Phase 0, write a small derived selector `selectAnchorTranslateGroupIds(state)` and have the new behavior parallel the old behavior; only swap at the end of Phase 1 when all consumers are migrated.

---

## When to bail

- If after Phase 1, the per-purpose constraint tagging (`tag: 'lasso'` vs `tag: 'anchorlock'` vs `tag: 'carry'`) starts feeling load-bearing for resolver correctness — stop and reconsider. Tags are fine as metadata, bad as semantics.
- If `derived_quantity` (Phase 5) needs more than the one formula, that's a hint the constraint model is being asked to express things that should stay as plain helpers.

---

## Open questions to settle before starting

1. **Constraint identity for removal.** When the recipe needs to remove "the anchor-lock constraints," how does it find them? `tag: 'anchorlock'` is the cleanest answer. Need to formalize.

2. **Constraint ordering.** Does `state.constraints` order matter for correctness, or is the resolver order-independent? My read: order matters for the pair-then-derived chain. Document this.

3. **Live vs committed.** The live-by-default architecture means `state.entities` updates on every pointerMove. Constraints are part of state, so they're equally live. Confirm this is what we want vs. having a separate "live overlay" of constraints.

4. **What about non-coupling state?** `region.bpm`, `region.lock`, `region.name`, `region.colorIndex` — none of these are constraints. They stay in the slice as plain fields. The constraint model is ONLY for cross-entity propagation.

5. **Recipes location.** Are recipes thunks? React hooks? Top-level functions called from action creators? Probably thunks for parity with today's pattern, but worth deciding upfront.
