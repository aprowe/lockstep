# Combined-gesture audit — design

Date: 2026-05-19
Status: draft, awaiting plan

## Problem

Two "combined gesture" patterns were deferred during the drag-gesture
profiles refactor. Both live in the controller as ad-hoc secondary
intent emissions alongside the primary drag, and both have
correctness issues that the constraint system can solve more cleanly:

1. **Anchor + selected regions** (`handleAnchorDrag` ~L376-392): when
   the dragged anchor was part of a selection that also included
   regions, the controller emits one explicit `regionEntityMove` for a
   "primary" selected region. Followers propagate via the
   resolver's lasso TranslateGroup. Audit suggests the explicit emit
   is **redundant** with lasso propagation (the lasso group already
   spans anchors + regions; `findTranslateDelta` walks all members,
   the anchor's write seeds the translate, `makeTranslateWrites`
   propagates to every member including clips). Removing the explicit
   emit lets the resolver own all coupling.

2. **Beat-anchor + linked clipout edge** (`handleAnchorDrag`
   ~L396-403): the controller captures clipout edges coincident with
   the beat anchor at pointerDown and emits a `regionResize` for each
   on every pointerMove. The coincidence check uses **beat-space
   only**, ignoring input-space coincidence — wrong for solo beat
   drags of diverged pairs (the clipout edge follows when it
   shouldn't). The right behavior is "clipout edge follows beat
   anchor only when conform holds in BOTH spaces", which is exactly
   what `MirrorPair`'s dual-space-guard already enforces (step 4b in
   `buildGraphFromSlice`). The fix is **deletion**, not migration —
   the MirrorPair takes over.

## Vision

Both cases dissolve into the constraint resolver:
- Case 1: lasso TranslateGroup is the single propagation mechanism for
  selection-driven coupling. Controller emits one Move/SetEdge on the
  primary; the resolver handles the rest.
- Case 2: MirrorPair (dual-space guard) is the single propagation
  mechanism for coincidence-driven coupling between beat anchors and
  clipout edges. Controller emits one Move on the primary; the
  resolver propagates symmetrically when both spaces conform.

After these changes, the controller has no per-gesture coupling logic.
Combined behavior becomes a property of the constraint graph.

## Scope

In scope:

- **Case 1 — remove redundant primary `regionEntityMove`** alongside
  anchor drags. Replace with a single anchor `drag(delta)` intent +
  lasso TranslateGroup propagation.
- **Case 2 — remove `linkedOutputEdges` capture and `regionResize`
  emission** from beat-anchor drag. The existing MirrorPair (step 4b
  in `buildGraphFromSlice`) already installs when input AND output
  coincide; verify it handles the propagation correctly and remove
  the controller-side coupling.
- **DragState cleanup** — strip `linkedOutputEdges` and
  `regionGroupIds` once the cases above are migrated.
- **MirrorPair audit** — confirm the existing handler propagates
  bidirectionally (anchor-out → clipout edge AND clipout edge →
  anchor-out) when its guard holds.

Out of scope:

- The clipout drag profile migration (Task 12b in the previous
  plan) — independent.
- Snap consolidation, dragCtx dissolution, broader controller
  cleanup — independent.

## Architecture

Two small changes:

### Case 1 — controller emits one intent, resolver propagates

Before:

```
pointerMove (anchor + selected regions):
  emit: anchorEntityMove(primary anchor)
  emit: regionEntityMove(primary region, delta)   ← redundant
  lasso TranslateGroup propagates to other anchors + regions
```

After:

```
pointerMove (anchor + selected regions):
  emit: drag(delta)   (via ANCHOR_DRAG profile; or anchorEntityMove
                       on the legacy path until that retires)
  lasso TranslateGroup propagates to ALL members — anchors AND regions
  (the group is mixed-entity; findTranslateDelta walks all members and
  finds the seed write on the anchor; makeTranslateWrites writes to every
  other member including clips)
```

Mechanism is unchanged — the lasso already covers the mixed-entity
case. Removing the explicit primary regionEntityMove is a no-op for
behavior; it just cleans up the duplicate path.

### Case 2 — MirrorPair handles beat-anchor ↔ clipout edge

Before:

```
pointerDown (beat anchor):
  controller captures linkedOutputEdges = clipout edges where
  clipout.edge ≈ beat-anchor.time (input-space NOT checked)

pointerMove:
  for each captured edge: emit regionResize(edge to anchor's new beat time)
```

After:

```
pointerDown (beat anchor):
  no special capture

pointerMove:
  emit: drag(delta) or anchorEntityMove (beat anchor)
  MirrorPair (already installed in buildGraphFromSlice step 4b when
  conform holds in both spaces) propagates anchor.time → clipout.edge
  in the same pipeline pass:
    - Guard: anchor-in.time ≈ clipin.edge (input-space coincidence)
    - Pair: anchor-out.time ↔ clipout.edge
    - Handler fires only when the guard holds, propagates the write
      from whichever endpoint received it
```

The MirrorPair install condition in `buildGraphFromSlice` step 4b is
already correct:

```ts
// Excerpt from current pipeline.ts:
if (Math.abs(clipInEdgeValue  - orig.time) > LINK_EPSILON) continue
if (Math.abs(clipOutEdgeValue - beat.time) > LINK_EPSILON) continue
state = reduce(state, {
  kind: OpKind.AddConstraint,
  constraint: {
    kind: ConstraintKind.MirrorPair,
    a:    { id: anchorOutId(orig.id), field: Field.Time },
    b:    { id: regionOutId(r.id),    field: edge },
    guard: {
      a: { id: anchorInId(orig.id), field: Field.Time },
      b: { id: regionInId(r.id),    field: edge },
    },
    tag:  `conform:${orig.id}:${r.id}:${edge}`,
  },
})
```

For solo beat-anchor drag of a diverged pair (only beat coincides):
the second `continue` (clipOutEdgeValue ≈ beat.time) passes, but the
FIRST (clipInEdgeValue ≈ orig.time) might not — the MirrorPair is not
installed, the clipout edge stays put. Correct.

For pair-anchor drag (both spaces coincide): MirrorPair IS installed,
the beat-anchor's Move op propagates to clipout edge via the handler.
Correct.

For diverged-pair beat drag that *happens* to also have input
coincidence: MirrorPair installed; the dual-space guard catches the
divergence on the next pass (anchor-in moves alone vs anchor-out
moving) and suppresses propagation. Correct.

So the existing MirrorPair install already handles case 2. The
controller's `linkedOutputEdges` mechanism is genuinely redundant AND
incorrect — deletion is the right move.

## Verification

Both changes need behavior tests that drive through the controller +
pipeline and assert the slice state, not just the intent stream.

### Case 1 tests

- Lassoed (anchor + region) drag: drag the anchor, both move by the
  same delta. (Existing
  `tests/unit/constraints/unit-translate-group-propagation.test.ts`
  covers this for anchor-only and region-only; extend to mixed.)
- Lassoed (anchor + region + region) drag: all three move; spacing
  preserved.

### Case 2 tests

- Linked pair (both spaces conform), beat-anchor drag → clipout edge
  follows.
- Diverged pair, solo beat-anchor drag → clipout edge **stays put**
  (the bug the current `linkedOutputEdges` path causes).
- Linked pair, clipout edge drag (when wired through CLIP_EDGE_DRAG
  with space='beat') → beat anchor follows.
- Diverged pair, clipout edge drag → beat anchor stays put.

Existing scenario tests (
`scenario-conform-clipin-across-diverged.test.ts`,
`scenario-clipin-edge-resize-onto-diverged-anchor.test.ts`,
`scenario-clipin-edge-resize-snap-sweep-onto-diverged-anchor.test.ts`)
exercise the input side. Mirror scenarios for the output side.

## Migration order

1. **Audit existing MirrorPair behavior** (no code changes). Write
   the case 2 scenario tests against the current implementation. They
   should pass for the cases MirrorPair handles correctly and fail
   only for the cases the controller's `linkedOutputEdges` was
   masking. Document any unexpected results.
2. **Remove `linkedOutputEdges` capture and emission** from the
   controller. Run the case 2 scenario tests — they should still pass
   (or pass MORE — the bug case "solo beat drag of diverged pair"
   now correctly leaves the clipout edge put).
3. **Update or skip the BDD scenarios** that explicitly assert the
   old `linkedOutputEdges` regionResize emission.
4. **Remove the redundant primary `regionEntityMove`** from
   `handleAnchorDrag`'s combined-region branch. Add a mixed-entity
   lasso propagation test that proves the lasso TranslateGroup
   carries the region along.
5. **Strip `linkedOutputEdges` and `regionGroupIds`** from the
   `region-edge` and `anchor` DragState variants. Strip the
   `origInputAnchorTimes` and `origBeatAnchorTimes` capture from the
   combined-anchor-drag setup (only the
   `linkedOutputEdges`-related path consumed them).
6. **DragState cleanup pass** — `isPair`, `capturedSpaces`,
   `partnerOrigTime` may still be needed for warp-line drag (pair
   semantics live in the drag state), but `gestureRole` and the
   per-event mutables (`lastTime`, `lastAltKey`, etc.) can be audited
   for unused-after-migration fields.

## What survives, what dissolves

### Survives

- `handleAnchorDrag` / `handleRegionEdgeMove` / `handleRegionMoveMove`
  — the pointer state machine and intent emission remain.
- MirrorPair handler and the step 4b install logic in
  `buildGraphFromSlice` — unchanged.
- Lasso TranslateGroup install (now from selection slices directly
  per Task 8 of the previous plan).
- `applyAnchorEntityMove` thunk for the beat-anchor drag legacy path
  (until the beat-anchor drag is fully profile-driven).

### Dissolves

- `DragState['anchor'].linkedOutputEdges` field
- Controller's `linkedOutputEdges` capture block in the regular
  anchor pointerDown branch
- Controller's `linkedOutputEdges` `regionResize` emission in
  `handleAnchorDrag` (pointerMove) and the pointerUp anchor commit
- The `regionEntityMove` primary emission in `handleAnchorDrag` /
  pointerUp's anchor branch for combined-region drags

## Risks

- **MirrorPair install gating on stale snapshot values**: the
  install check in step 4b reads positions from the slice snapshot at
  graph-build time. During a beat-anchor drag, the slice's
  positions are being mutated by each `applyAnchorEntityMove`. If
  the MirrorPair was NOT installed at drag start (positions hadn't
  yet conformed), it won't appear mid-drag even if positions
  conform during the drag. This is fine for the
  "coincidence at drag start" semantic case 2 was trying to encode,
  but worth confirming with a sweep test.
- **Lasso group composition during a drag**: the lasso is rebuilt
  per build (Task 8 reads selection directly). If a drag changes
  the selection (it shouldn't — selection commits on pointerUp),
  the lasso composition would change mid-drag. Worth verifying.
- **Combined-region drag follower regions** when the dragged anchor
  was the ONLY selected anchor but other regions are in the
  selection: the lasso TranslateGroup must cover the anchor + the
  follower regions. Confirm `extractSliceForPipeline` populates
  `selection.orig + selection.beat + lists.selection.clipin/clipout`
  correctly when only anchors are dragged. (It does per Task 8 —
  selection is read directly from slice; doesn't depend on what's
  being dragged.)

## Success criteria

- The two known correctness issues — clipout edge following beat
  anchor on a diverged pair, redundant primary region emission — no
  longer occur.
- `linkedOutputEdges`-related fields removed from `DragState`.
- The MirrorPair (step 4b) is the single source of beat-anchor ↔
  clipout-edge coupling. The lasso TranslateGroup is the single
  source of selection-driven coupling.
- All existing tests continue to pass after the cleanup. New
  scenarios document the corrected behavior for the previously-
  buggy diverged-pair case.
