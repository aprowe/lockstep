# Drag-gesture profiles — design

Date: 2026-05-19
Status: approved, awaiting implementation plan

## Problem

Drag behavior is smeared across four layers:

- `src/timeline/controller.ts` — pointer state machine emits intents AND
  encodes gesture semantics (`isPair`, `capturedSpaces`, `gestureRole`,
  which intents to emit per pair-drag, etc.).
- `src/components/CanvasTimeline.tsx` — `applyIntents` switch dispatches
  one closure per intent kind, AND owns lifecycle bookkeeping such as the
  `prePairDragLassoIdsRef` snapshot/restore for warp-line drag.
- `src/components/WarpView.tsx` — fat with per-intent callbacks
  (`onSnapStart`, `onAnchorEntityMove`, `onRegionResize`, etc.); each
  closure runs a small amount of business logic before dispatching.
- `src/store/thunks/entityWriteThunks.ts` — multiple-dispatch logic
  (link/unlink checks, redundant beat dispatches that had to be removed
  one at a time as bugs surfaced).

Every recent drag bug surfaced in one of these layers, not in the
constraint pipeline itself. The freshest example: warp-connector drag
needed a temporary TranslateGroup over the pair, currently implemented
as a `lassoIds` snapshot/restore in `CanvasTimeline.dragStart`. The
bug-free version of that mechanism lives in the constraint graph.

## Vision

Drag behavior becomes a **declarative entity-gesture profile** managed
by the constraint pipeline. Controller becomes a slim intent emitter.
TSX becomes wiring-only. Bugs that today appear in three different
files can only appear in one — the profile registry — which is data,
not control flow.

The Illustrator-group analogy: a warp connector is just an entity-like
handle, the same way a group in Illustrator is a draggable object whose
drag translates its members. Dragging it is a uniform operation; the
graph dictates what that operation means.

## Scope

In scope:

- **Drag lifecycle** — `beginDrag` / `drag` / `endDrag` intents driving
  a pipeline-owned gesture state.
- **Entity-gesture profiles** — declarative `whileDragging` constraints
  + procedural `onDrag` op translation per handle kind.
- **Controller slim-down** — replace hit-aware intent variants
  (`anchorEntityMove`, `regionResize`, `regionEntityMove`, etc.) with a
  uniform `drag({ delta })` intent. Hit-test resolves to a `Handle`.
- **Dissolve `dragCtxSlice`** — its three fields (`snapInstall`,
  `lassoIds`, `anchorLock`) are pipeline ephemerals that leak into
  Redux via mirror middlewares. They move into the gesture profile +
  build-time derivation from selection.
- **Thunk audit** — keep thunks that are safe routers; collapse the
  ones whose only job was to fan out a single user gesture into
  multiple ops (those become profile `onDrag` outputs).

Out of scope (kept imperative):

- Non-drag interactions (click, hover, keyboard) — controller and
  WarpView keep handling these as one-shot intents. The profile
  registry shape leaves room for future `onClick` / `onHover` but
  doesn't use it yet.
- Non-entity gestures — pan (middle-mouse / shift), seek, minimap
  drag, lasso rectangle drag. None touch the constraint graph; no win
  from migrating them.
- Rendering and hit-test geometry — both stay in CanvasTimeline. The
  refactor only changes what the controller does **after** a hit.

## Architecture

```
                           ┌──────────────────┐
   pointer events ────────►│   Controller     │   pure intent emitter
                           │ hit → Handle     │   no semantics
                           └────────┬─────────┘
                                    │ Intent[]
                                    ▼
                           ┌──────────────────┐
                           │ CanvasTimeline   │   thin wiring: dispatch one
                           │   applyIntents   │   thunk per intent kind
                           └────────┬─────────┘
                                    │
                                    ▼
                           ┌──────────────────┐
                           │   Drag thunks    │   look up profile,
                           │ (pure routers)   │   call onDrag, dispatch ops
                           └────────┬─────────┘
                                    │ Op
                                    ▼
                           ┌──────────────────────────────────────┐
                           │  buildGraphFromSlice                 │
                           │  ├─ structural constraints (today)   │
                           │  └─ profile.whileDragging for        │  NEW
                           │     state.gesture.activeHandle       │
                           └──────────┬───────────────────────────┘
                                      │
                                      ▼
                           ┌──────────────────┐
                           │     Resolver     │   unchanged
                           └────────┬─────────┘
                                    │
                                    ▼
                              Slice writes
```

## Components

### Handle

The unit of "what the user grabbed". A discriminated union keyed off
`kind`. Examples:

```ts
type Handle =
  | { kind: 'anchor-drag';    anchorId: number; space: 'input' | 'beat' }
  | { kind: 'pair-drag';      pairId: number }
  | { kind: 'clip-body';      clipId: string; space: 'input' | 'beat' }
  | { kind: 'clip-in-edge';   clipId: string; space: 'input' | 'beat' }
  | { kind: 'clip-out-edge';  clipId: string; space: 'input' | 'beat' }
```

The controller's hit-test returns a `Handle`. No other gesture state
needed at intent-emission time.

### Gesture state

A new slice (or sub-slice) holding the live gesture:

```ts
type GestureState = {
  activeHandle: Handle | null
  // Delta is tracked here so the resolver / TSX never reads cumulative
  // delta off the controller's mutable `drag` object.
  cumulativeDelta: number
  // Transient modifier-key state for the active drag. Piggy-backed on
  // the `drag` intent — `drag({ delta, modifiers })` updates this and
  // then runs the op translation. Used today by anchor-lock's alt-XOR
  // toggle; shift/ctrl can be added when needed.
  modifiers: { alt: boolean }
}
```

Replaces `dragCtxSlice`. The replay-model `drag.preDrag` slice stays
unchanged — it's the snapshot baseline that thunks read.

### GestureProfile

The per-handle-kind declaration:

```ts
type GestureProfile = {
  onDrag: (handle: Handle, delta: number, state: RootState) => Op[]
  whileDragging: (handle: Handle, state: RootState) => Constraint[]
}
```

- `onDrag` is procedural — translating a delta into ops legitimately
  varies by handle kind (Move vs SetEdge vs anchor-time write). Keeping
  this as code, not data, avoids over-engineering.
- `whileDragging` is declarative — the constraints that exist for the
  duration of this gesture. Returned constraints are merged into the
  graph by `buildGraphFromSlice` on every pipeline dispatch where the
  active handle matches. No install / teardown ops; the lifecycle is
  the existence of `gestureState.activeHandle`.

### Profile registry

```ts
// src/constraints/profiles/index.ts
export const PROFILES: Record<Handle['kind'], GestureProfile> = {
  'anchor-drag':    ANCHOR_DRAG,
  'pair-drag':      PAIR_DRAG,
  'clip-body':      CLIP_BODY_DRAG,
  'clip-in-edge':   CLIP_EDGE_DRAG('in'),
  'clip-out-edge':  CLIP_EDGE_DRAG('out'),
}
```

One file per profile group in `src/constraints/profiles/`. Each profile
is pure data + a small `onDrag` function. Easy to read in isolation;
easy to unit-test (give it a handle, get back ops/constraints, assert).

### Drag thunks

Three small thunks replace the per-intent zoo:

```ts
// src/store/thunks/dragThunks.ts
export const beginDrag = ({ handle }: { handle: Handle }) =>
  (dispatch, getState) => {
    dispatch(dragStart(snapshotPreDragState(getState())))
    dispatch(setActiveHandle(handle))
  }

export const drag = ({ delta, modifiers }: { delta: number; modifiers: { alt: boolean } }) =>
  (dispatch, getState) => {
    dispatch(setGestureModifiers(modifiers))   // updates gesture.modifiers
    const handle = getState().gesture.activeHandle
    if (!handle) return
    const profile = PROFILES[handle.kind]
    for (const op of profile.onDrag(handle, delta, getState())) {
      dispatchPipelinedReplay(dispatch, getState, op)
    }
  }

export const endDrag = () =>
  (dispatch) => {
    dispatch(setActiveHandle(null))
    dispatch(dragEnd())
  }

export const cancelDrag = () =>
  (dispatch) => {
    dispatch(setActiveHandle(null))
    dispatch(dragCancel())   // separate action — discards preDrag without commit
  }
```

That's the entire dispatch layer for drag. No more `applyMoveOrigAnchor`,
no more `applyAnchorEntityMove`, no more per-region thunk closures in
WarpView for drag intents.

### buildGraphFromSlice extension

The graph builder gains one step at the end:

```ts
export function buildGraphFromSlice(slice, gesture: GestureState): State {
  let state = /* existing structural build */

  // Gesture-scoped constraints — exist only while a drag is active.
  if (gesture.activeHandle) {
    const profile = PROFILES[gesture.activeHandle.kind]
    for (const c of profile.whileDragging(gesture.activeHandle, slice)) {
      state = reduce(state, { kind: OpKind.AddConstraint, constraint: c })
    }
  }
  return state
}
```

No new constraint kinds. No install/teardown ops. The constraint exists
when `activeHandle` is set, vanishes when it's cleared.

### Anchor-lock as a profile extension

Anchor-lock is currently a UI toggle (`state.ui.anchorLock`) with an
alt-key XOR override per pointer event, mirrored through
`anchorLockMirrorMiddleware` into `dragCtx.anchorLock`, then read by
`buildGraphFromSlice` step 10. In the new design, anchor-lock is just
a conditional segment of certain clipout drag profiles'
`whileDragging`:

```ts
const CLIPOUT_BODY_DRAG: GestureProfile = {
  onDrag: (handle, delta) => [
    { kind: OpKind.Move, id: regionOutId(handle.clipId), delta },
  ],
  whileDragging: (handle, slice) => {
    const cs: Constraint[] = [
      SnapTarget({ id: regionOutId(handle.clipId), mode: 'body' }),
    ]
    const lockActive = slice.ui.anchorLock !== slice.gesture.modifiers.alt   // XOR
    if (lockActive) {
      const inner = innerBeatAnchorIds(slice, handle.clipId)
      const driver = regionOutId(handle.clipId)
      cs.push(TranslateGroup({ ids: [driver, ...inner], driver, tag: 'lock' }))
      if (slice.ui.lockMode === 'beats') {
        cs.push(ScaleGroup({ ids: [driver, ...inner], driver, tag: 'lock' }))
      }
    }
    return cs
  },
}
```

`innerBeatAnchorIds(slice, clipId)` is a pure helper — same logic as
today's middleware, lifted to a function. `anchorLockMirrorMiddleware`
deletes. `dragCtx.anchorLock` deletes. The lock constraints exist
exactly while a clipout drag is active and the XOR is true; vanish
otherwise.

The same anchor-lock segment applies to clipout-edge drags (where
ScaleGroup is what stretches the inner anchors when an edge resize
changes the clipout's length). One helper function shared by the
clipout body and edge profiles.

## Data flow examples

### Warp-connector drag (the bug magnet)

1. **pointerDown on warp-line** — controller hit-tests, returns
   `Handle = { kind: 'pair-drag', pairId: 1 }`. Emits intent
   `{ kind: 'beginDrag', handle }`.
2. **CanvasTimeline** dispatches `beginDrag({ handle })`. Slice now has
   `gesture.activeHandle = { kind: 'pair-drag', pairId: 1 }` and
   `drag.preDrag = snapshot`.
3. **pointerMove** — controller computes cumulative `delta`. Emits
   `{ kind: 'drag', delta }`.
4. `drag` thunk looks up `PAIR_DRAG`. Its `onDrag` returns:
   `[{ kind: OpKind.Move, id: anchorInId(1), delta }]`. Thunk
   dispatches the op via `dispatchPipelinedReplay`.
5. **Pipeline build** sees `activeHandle.kind === 'pair-drag'`, calls
   `PAIR_DRAG.whileDragging`, which returns a TranslateGroup over
   `[anchorInId(1), anchorOutId(1)]` and a SnapTarget on the orig.
   These are merged into the graph for this run.
6. Resolver applies Move → SnapTarget snaps orig → TranslateGroup
   propagates snapped delta to beat. Slice updated for both.
7. **pointerUp** — controller emits `{ kind: 'endDrag' }`. Slice clears
   `activeHandle`. Next pipeline build no longer adds the gesture
   constraints — they vanish.

No `lassoIds` snapshot/restore. No isPair branching in controller. No
explicit beat intent at pointerUp. No `dragCtxSlice`.

### Clip in-edge resize with snap

1. **pointerDown on clip in-edge** — hit-test returns
   `Handle = { kind: 'clip-in-edge', clipId: 'r1', space: 'input' }`.
2. `beginDrag` dispatched, gesture state set.
3. **pointerMove** — `drag({ delta })` thunk looks up `CLIP_EDGE_DRAG('in')`.
   `onDrag` returns `[{ kind: OpKind.SetEdge, id: regionInId('r1'),
   edge: 'in', value: preDrag.inPoint + delta }]`.
4. `whileDragging` returns `SnapTarget` on the clip's in edge.
5. Pipeline: SetEdge → SnapTarget restricts → MirrorEdge propagates to
   clipout → slice updated.

`applyUpdateRegionInOut` thunk dissolves entirely.

### Single anchor drag, lassoed selection

1. **pointerDown on anchor** — hit-test returns
   `Handle = { kind: 'anchor-drag', anchorId: 1, space: 'input' }`.
2. `beginDrag` dispatched.
3. **pointerMove** — `drag({ delta })`. `onDrag` returns
   `[{ kind: OpKind.Move, id: anchorInId(1), delta }]`.
4. `whileDragging` returns `SnapTarget` on the anchor's time field.
5. Pipeline build also reads `state.warp.selectedOrigIds` and installs
   the existing `lasso:main` TranslateGroup over all selected orig
   anchors. (This part is unchanged in semantics — but now the
   `selectionGraphMirrorMiddleware` path that mirrored selection into
   `dragCtxSlice.lassoIds` collapses; `buildGraphFromSlice` reads
   selection directly.)
6. Resolver: Move on orig → SnapTarget restricts → TranslateGroup
   propagates to other selected orig anchors → DirectedPair propagates
   each linked orig to its beat.

## What survives, what dissolves

### Survives

- `src/store/slices/dragSlice.ts` — preDrag snapshot for the replay model
- `src/constraints/pipeline.ts` (`buildGraphFromSlice`) — gains the
  gesture-scoped extension at the end
- `src/constraints/resolver.ts` — unchanged
- `src/constraints/recipes.ts` — structural recipes (`initAnchorPair`,
  `lockOn`) unchanged
- Non-drag thunks: `videoThunks`, `sceneThunks`, the safe parts of
  `clipoutThunks` and `regionThunks`. These are dispatchers, not
  semantics owners.

### Dissolves

- `src/store/slices/dragCtxSlice.ts` — entire slice
- `src/store/middleware/dragCtxMirrorMiddleware.ts` — already a passthrough
- `selectionGraphMirrorMiddleware`'s lasso-mirror logic only — the
  selection arrays themselves (`warp.selectedOrigIds`,
  `warp.selectedBeatIds`, `lists.selection.clipin`,
  `lists.selection.clipout`) stay in their owning slices.
  `buildGraphFromSlice` reads them directly to build the
  `lasso:main` TranslateGroup, instead of going through a mirrored
  `dragCtx.lassoIds` array
- `anchorLockMirrorMiddleware` — anchor-lock becomes a gesture profile
  field
- WarpView's drag callbacks: `onAnchorEntityMove`, `onRegionResize`,
  `onRegionMove`, `onSnapStart`, `onSnapEnd`. CanvasTimeline calls one
  drag thunk per drag intent.
- CanvasTimeline's `prePairDragLassoIdsRef` and the pair-drag
  `dragStart` branch
- Controller's `isPair` / `capturedSpaces` / `partnerOrigTime` / per-handle
  intent emission — replaced by `Handle` + `delta`
- Thunks: `applyMoveOrigAnchor`, `applyMoveBeatAnchor`,
  `applyAnchorEntityMove`, `applyRegionEntityMove`,
  `applyUpdateRegionInOut`. Their behavior moves to profile `onDrag`
  + the pipeline.
- Link/unlink bookkeeping on beat drag — runs as a post-dispatch step
  inside the `drag` thunk (it's a small slice update, not constraint
  semantics — keeping it in the thunk preserves its existing tests
  without forcing it into a Derive-phase constraint).

## Migration order

Each step lands as its own commit, all tests green at each step.

1. **Scaffolding** — `GestureState` slice + `setActiveHandle` action +
   profile registry skeleton (no profiles populated). `Handle` type
   added. New thunks (`beginDrag` / `drag` / `endDrag`) added but
   unused.
2. **buildGraphFromSlice extension** — gesture-scoped constraint
   insertion implemented but inert (no profiles).
3. **Migrate pair-drag** (the fresh bug magnet) — `PAIR_DRAG` profile
   populated; controller's warp-line branch emits `beginDrag` /
   `drag` / `endDrag`; remove `prePairDragLassoIdsRef` and the
   `dragStart` lasso-extension. Existing pair-drag tests adapted.
4. **Migrate anchor-drag** — `ANCHOR_DRAG` profile; controller's
   regular anchor hit emits the new intents; `applyMoveOrigAnchor`
   removed.
5. **Migrate clip body drag** — `CLIP_BODY_DRAG` profile; remove
   `applyRegionEntityMove`.
6. **Migrate clip edge drag** — `CLIP_EDGE_DRAG` profile; remove
   `applyUpdateRegionInOut`'s explicit dispatches; thunk dissolves.
7. **Migrate clipout drags** — body + edges; clipoutThunks audited.
8. **Dissolve `dragCtxSlice`** — `snapInstall`, `lassoIds`, `anchorLock`
   all read from gesture / selection / etc directly. Drop the slice and
   its middleware.
9. **Anchor-lock** — folded into `CLIPOUT_BODY_DRAG` and
   `CLIPOUT_EDGE_DRAG` profiles as a conditional segment in
   `whileDragging`, reading `ui.anchorLock` XOR `gesture.modifiers.alt`.
   `anchorLockMirrorMiddleware` deletes.
10. **Controller pass** — remove `isPair`, `capturedSpaces`,
    `partnerOrigTime`, `gestureRole`. `handleAnchorDrag` /
    `handleRegionEdgeMove` / `handleRegionMoveMove` collapse to "hit
    type, emit drag intents (+ legacy secondary intents for the
    deferred combined-gesture cases until the follow-up lands)".

Each step is a green-tests checkpoint. Order chosen so each step's
blast radius is contained: pair-drag first because its tests are
freshest and we know exactly what good looks like.

## Testing strategy

Tests gain affordances; we don't lose any.

- **Profile unit tests** — for each profile, assert `onDrag` returns
  the expected ops and `whileDragging` returns the expected
  constraints. Pure functions; trivial to test.
- **Pipeline integration** — keep the existing
  `dispatchPipelinedReplay` tests. They drive through `beginDrag`,
  `drag`, `endDrag` thunks instead of `applyAnchorEntityMove` /
  `applyRegionResize`. Slice assertions stay identical.
- **Controller tests** — assert the controller emits `beginDrag` /
  `drag` / `endDrag` intents with correct handle / delta. No semantic
  assertions in controller tests (semantics live in profile tests).
- **BDD tests** — gherkin step names stay; step bodies migrate to the
  new dispatch shape. Same as the migrations we already did for
  conform / snap behavior.

The class of bug we're trying to eliminate ("X works in test but is
broken in app because the install/teardown happens in TSX") is gone:
profile.whileDragging is what tests AND production both consume; no
TSX-side install logic to drift from the constraint graph.

## Deferred: combined-gesture audit

Two patterns in the current controller emit a SECONDARY intent
alongside the primary anchor move:

1. **Anchor + selected regions** (`handleAnchorDrag` ~L376-392) — when
   the dragged anchor was in a selection that also included regions,
   the controller emits one `regionEntityMove` for the "primary"
   selected region. Audit suggests this is redundant (the lasso
   TranslateGroup over the mixed-entity selection already propagates),
   but proving that and removing the emit is its own change.
2. **Beat-anchor + linked clipout edge** (`handleAnchorDrag`
   ~L396-403) — captures clipout edges coincident with the beat anchor
   at pointerDown (input-space coincidence NOT checked) and emits a
   `regionResize` for each on every pointerMove. Audit finds this
   produces wrong behavior for solo beat drags of diverged pairs (the
   edge follows when it shouldn't). The correct rule is what
   MirrorPair's dual-space guard already enforces — clipout edge
   follows beat anchor only when both spaces conform. The fix is
   removal, not a profile extension.

Both are deferred to a follow-up spec. During this refactor, those
controller paths keep emitting their existing intents and the existing
thunks (`applyRegionEntityMove`, `applyRegionResize`-via-thunks)
handle them as today. The drag-profile migration covers only the
primary anchor/clip drag; secondary intents stream through the legacy
path unchanged until the follow-up.

This preserves correct-as-of-today behavior (including the two known
quirks above) and decouples the refactor from the audit. The
follow-up spec can treat each case on its own merits — case 1 likely
becomes a no-op removal; case 2 becomes a deletion + MirrorPair
verification.

## Risks

- **Migration breakage window** — between steps the system runs in a
  mixed state (some gestures profile-driven, some still thunk-driven,
  combined gestures on the legacy path throughout). Each step's tests
  catch its own regressions; risk is bounded by small commits.
- **Modifier-key plumbing** — adding `modifiers` to the `drag` intent
  means every pointerMove serializes through the gesture slice. Single
  field, single dispatch per move, but worth flagging as a small
  perf change versus today's per-event mutable-state path on the
  controller's `drag` object.

## Success criteria

- `dragCtxSlice` and its middleware are gone.
- `anchorLockMirrorMiddleware` is gone.
- WarpView's prop surface for primary drag callbacks
  (`onAnchorEntityMove`, `onRegionResize` for clipin, `onRegionMove`,
  `onSnapStart`, `onSnapEnd`) reduces. Legacy secondary intents for
  the deferred combined-gesture cases (`onRegionEntityMove` when
  triggered alongside an anchor drag; `onRegionResizeOutput` when
  triggered alongside a beat-anchor drag) survive until the follow-up.
- Controller has no `isPair`, `capturedSpaces`, `gestureRole`,
  `partnerOrigTime`. `linkedOutputEdges` and `regionGroupIds` stay
  until the combined-gesture follow-up.
- Anchor-lock is purely a clipout profile concern — no separate
  middleware, no separate dragCtx field.
- Adding a new draggable entity (e.g., a future "marker chain"
  handle) takes one new profile file, no controller or TSX
  changes.
- All 1555 existing tests still pass; new profile unit tests added.
