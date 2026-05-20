# Conform invariant restructure — design

**Date:** 2026-05-20
**Status:** Approved by user, pending plan
**Supersedes:** ConformVisual + MirrorPair coupling (current constraint pipeline)

## Problem

The "conform" invariant is:

> Whenever `anchor.orig` coincides with `clipin.edge` (within `CONFORM_EPSILON`),
> `clipout.edge` MUST equal `anchor.beat` — at every pipeline pass, regardless
> of which entity the user is dragging.

The current implementation expresses this with two constraints:

- `ConformVisual` — one-way write `anchor.beat → clipout.edge` when coincidence
  holds. Gated on the txn containing a write to `clipin.edge` or `anchor.orig`.
- `MirrorPair` — *symmetric* binding `anchor.beat ↔ clipout.edge`, installed
  whenever dual coincidence (input AND output) holds at pre-drag time.

`MirrorPair`'s symmetric coupling was added so the user could "drag clipout
while conformed and have the anchor follow" (QoL). The symmetry is also the
back-edge that lets raw cursor values contaminate `anchor.beat` through the
default-link cascade (`clipin → clipout → anchor.beat`). Three handle-based
skip exceptions accreted in the pipeline to suppress this leak — none of them
solve the structural issue, and each new gesture risks re-introducing the bug.

## Goal

Replace the symmetric coupling with a strictly directed derivation so the
invariant holds by construction, with no handle-specific skips. Preserve the
"drag clipout = drag anchor" QoL by *redirecting* the user's clipout write
into an anchor.beat write at the constraint level.

## Architecture

Three constraint-pipeline changes:

### 1. Delete `MirrorPair` and all skip exceptions

- Delete the `MirrorPair` constraint kind, its resolver handler, and its
  install site in `pipeline.ts` step 12.
- Delete the three drag-handle skip predicates introduced earlier:
  - `draggedClipinRegionId` (step 12)
  - `draggedPairId` (step 12)
  - `conformSkipPairId` (step 4a — ConformVisual install)
- Delete `findSnapCandidates`'s related test fixtures and any
  MirrorPair-specific unit tests; port surviving behaviors to the new model.

### 2. Expand `ConformVisual` to fire on any relevant write

`ConformVisual` already writes `anchor.beat → clipout.edge` when input
coincidence holds. Its txn gate is currently:

```ts
if (!clipInWrite && !anchorInWrite) return txn
```

Expand to fire whenever any of these are written this txn:

- `clipin.edge` (coincidence might be entering or leaving)
- `anchor.orig` (same)
- `anchor.beat` (output value changed — re-write clipout)
- `clipout.edge` (assert the override)

Override is unconditional: if coincidence holds, the write to `clipout.edge`
matching `anchor.beat` is added to the txn (the existing no-op check on
`Math.abs(clipOutEffective - anchorOutTime) < EPSILON` keeps fixed-point
iteration terminating).

### 3. New rule: `ConformRedirect` (Propose phase, after SnapTarget)

A pure Propose-phase rule that detects user-driven clipout writes while
conform holds and redirects them to anchor.beat with the same delta.

**Trigger conditions** (all must hold in the txn):
- A write exists on `clipout.edge` (entity = `regionOutId(r.id)`, field = `in` or `out`).
- Input coincidence holds at the post-write state: `|clipin.edge - anchor.orig| < CONFORM_EPSILON`.
- No write on `anchor.beat` exists in the txn (don't double-write if user
  also grabbed the anchor directly).

**Effect:**
- Compute `delta = clipoutWrite.to - clipoutWrite.from`.
- Remove the clipout write from the txn (let `ConformVisual` re-add it).
- Add a write on `anchor.beat`: `{ to: anchor.beat.time + delta }`.

Auto-installed per `(region × anchor × edge)`, same fan-out as `ConformVisual`.

### Order of operations within Propose

Constraints fire in insertion order during each fixed-point iteration. The
insertion order in `buildGraphFromSlice` must be:

```
1. Default-link (DirectedPair MirrorEdge)   — cascades clipin → clipout
2. SnapTarget                                — installed by active profile,
                                               snaps the dragged entity's
                                               write using ITS OWN targets
3. ConformRedirect                           — clipout write → anchor.beat
4. ConformVisual                             — asserts clipout = anchor.beat
```

Concrete trace — user drags `clipout.in` by +0.5 while conformed
(clipin.in=10 on orig=10, clipout.in=15 on beat=15):

| Step | Txn after |
|------|-----------|
| User write | `[clipout.in: 15 → 15.5]` |
| Default-link | `[clipout.in: 15 → 15.5]` (clipin unchanged, no cascade) |
| SnapTarget (clipout) | `[clipout.in: 15 → 15.5]` (no nearby target; suppose unsnapped) |
| ConformRedirect | `[anchor.beat: 15 → 15.5]` |
| ConformVisual | `[anchor.beat: 15 → 15.5, clipout.in: 15 → 15.5]` |
| Fixed point | converged |

### Provenance: distinguishing seed writes from cascade writes

ConformRedirect must not redirect *every* clipout write — only ones that
originated from a user gesture. A default-link cascade write on clipout
(produced when clipin moves and `defaultLinked` is true) would otherwise
be redirected to anchor.beat, recreating the contamination bug at a new
layer.

From `Write.from / Write.to` alone the two are indistinguishable. We need
explicit provenance.

**Resolution:** add an optional `seedTag?: string` to the resolver's `Write`
type. Default-link's `DirectedPair` MirrorEdge handler stamps cascade
writes with `seedTag: 'defaultlink'`. ConformRedirect skips writes whose
`seedTag === 'defaultlink'`. Untagged writes default to "seed."

Trace — user drags clipin.in by +0.3 from 10 (already on orig=10) toward
a diverged anchor (orig=10, beat=15, clipin.in=10, clipout.in=15 from
prior conform):

| Step | Txn after |
|------|-----------|
| User write | `[clipin.in: 10 → 10.3 (seed)]` |
| Default-link | `[..., clipout.in: 15 → 10.3 (tag=defaultlink)]` |
| SnapTarget (clipin) snaps to orig=10 | `[clipin.in: 10 → 10, clipout.in: 15 → 10.3 (tag=defaultlink)]` |
| ConformRedirect | *skips* (clipout write tagged defaultlink) |
| ConformVisual | `[..., clipout.in: 15 → 15]` (writes anchor.beat=15 → clipout=15) |
| Fixed point | converged: clipin=10, clipout=15, anchor untouched ✓ |

The default-link cascade is overridden by ConformVisual without ever
touching anchor.beat.

| Step | Txn after (with seedTag) |
|------|---------------------------|
| User write | `[clipin.in: 10→10.3 (seed)]` |
| Default-link | `[clipin.in: 10→10.3, clipout.in: 15→10.3 (tag=defaultlink)]` |
| SnapTarget (clipin) | `[clipin.in: 10→10, clipout.in: 15→10.3 (tag=defaultlink)]` |
| ConformRedirect | skips (clipout write tagged defaultlink) |
| ConformVisual | `[..., clipout.in: 15→15]` (writes anchor.beat=15 → clipout = 15) |
| Fixed point | converged: clipin=10, clipout=15, anchor stays (10, 15) |

Anchor untouched. Default-link cascade overridden by ConformVisual. ✓

This resolves the order-of-operations / provenance question.

## Components

### `src/constraints/types.ts`
- Add optional `seedTag?: string` to `Write` (or whatever the existing
  write-record type is named). Document: "Provenance marker for writes
  produced by cascade rules. Seed writes (from user gestures) have no tag."
- Remove `MirrorPair` from `ConstraintKind`. Remove its TypeScript
  interface and any imports.
- Add `ConformRedirect` to `ConstraintKind` as a new constraint kind with
  the same shape as `ConformVisual` (region/anchor/edge fan-out fields).
  Keeping it separate from ConformVisual keeps phase logic legible.

### `src/constraints/resolver.ts`
- Remove the `MirrorPair` handler (~lines 406-450).
- Modify the `DirectedPair` MirrorEdge mode handler to stamp `seedTag:
  'defaultlink'` on its cascade writes.
- Modify the `ConformVisual` handler:
  - Expand the txn gate to include `anchor.beat` and `clipout.edge` writes.
  - Keep the existing no-op convergence check.
- Add the `ConformRedirect` handler (Propose phase). Logic per the spec
  above. Skip writes with `seedTag === 'defaultlink'`.

### `src/constraints/pipeline.ts`
- Step 4a (ConformVisual install): delete `conformSkipPairId` and its
  block. Restore the simple per-(region × anchor × edge) install loop.
- Step 4b (formerly MirrorPair install at step 12): delete entirely.
- Add new step 4b: ConformRedirect install, same fan-out as ConformVisual.
- Verify insertion order matches: default-link (step 3b) → SnapTarget
  (step 11) → ConformRedirect (new step 4b) → ConformVisual (step 4a).
  May need to re-order existing steps so insertion sequence matches the
  intended Propose iteration order.

### Tests
- **Delete** `tests/unit/constraints/scenario-snap-conformed-clipout-anchor-stays-aligned.test.ts`'s
  MirrorPair-specific assertions; rewrite as behavioral (clipout stays = anchor.beat at every frame).
- **Keep** all three "diverged anchor stays put" scenarios — they should pass
  unchanged under the new model.
- **Add** scenarios for the redirect:
  - "drag clipout while conformed: anchor.beat moves by the same delta"
  - "drag clipout while conformed and snap: anchor.beat absorbs the snapped value"
  - "lasso clipin + clipout (no anchor), drag clipin: clipout follows clipin via default-link when conform breaks; clipout stays = anchor.beat while conform holds"
- **Verify** the existing `scenario-conform-anchor-onto-clipin` and
  `scenario-drag-anchor-onto-clipin-via-profile` still pass.

## Data flow summary

```
                ┌─────────────────────────┐
                │  user gesture (intent)  │
                └────────────┬────────────┘
                             │
                             ▼  seed writes (no seedTag)
                ┌─────────────────────────┐
                │  Propose iteration loop │ — fixed point on:
                │   1. default-link       │
                │   2. SnapTarget         │
                │   3. ConformRedirect    │
                │   4. ConformVisual      │
                └────────────┬────────────┘
                             ▼
                ┌─────────────────────────┐
                │  Restrict / Finalize    │
                └────────────┬────────────┘
                             ▼
                         slice writeback
```

The conform invariant is established by step 4 (ConformVisual) and protected
by step 3 (ConformRedirect routing user clipout writes away from clipout).

## Non-goals (deferred)

- **Sticky release.** When coincidence breaks, clipout returns to default-link
  value. The user's preference for "stays where it was unless DL" can be
  added later via a `PreConformValue` memo. Not in this design.
- **Conform on derived entities.** Scene markers, BPM-derived endpoints, etc.
  remain outside the conform invariant.
- **Multi-anchor conform.** If two anchors coincide with the same clipin edge,
  the *first* anchor by id wins (ConformVisual fires per anchor; the last
  write wins). No tie-breaking design needed yet — surface a bug if it
  comes up.

## Risks

- **Provenance via `seedTag`** introduces a new field. Untagged writes default
  to "seed," so existing code paths keep working without modification.
- **Fixed-point convergence.** The added rules don't create new write
  cycles: ConformRedirect removes the clipout write before adding an
  anchor.beat write (net no growth), and ConformVisual's no-op check
  prevents repeated identical writes. Termination preserved.
- **Default-link cascade tagging** could be missed if a future contributor
  adds a new MirrorEdge-like rule without stamping. Mitigation: a single
  helper `taggedWrite(seedTag, ...)` and a code comment in `DirectedPair`
  pointing at this design doc.

## Success criteria

- All three handle-based skip exceptions removed.
- `MirrorPair` deleted.
- The four behavioral scenarios listed in Tests pass without exceptions.
- Full vitest suite green.
- A new test asserting "drag clipout +0.5 while conformed → anchor.beat moved
  by +0.5" passes.
- A new test asserting "drag clipin onto a diverged anchor's orig, then
  nudge within snap → anchor.beat stays put" passes (existing regression).
