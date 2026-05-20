# Drag-gesture profiles implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move drag-lifecycle behavior out of the controller, WarpView, and entity-write thunks into a declarative entity-gesture profile registry managed by the constraint pipeline.

**Architecture:** A new `gesture` slice tracks `activeHandle`, `cumulativeDelta`, and `modifiers`. Three thin thunks (`beginDrag` / `drag` / `endDrag`) translate intents to ops via a profile registry. `buildGraphFromSlice` reads `gesture.activeHandle` and injects each profile's `whileDragging` constraints automatically — no install/teardown ops. Controller emits uniform `beginDrag` / `drag` / `endDrag` intents instead of per-handle variants. `dragCtxSlice` and three mirror middlewares dissolve.

**Tech stack:** TypeScript + Redux Toolkit + Vitest. No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-05-19-drag-gesture-profiles-design.md`](../specs/2026-05-19-drag-gesture-profiles-design.md)

---

## Status — 2026-05-19 (updated)

**Tasks 1–11 complete to varying depths.** Architecture is in place;
four profiles wired (pair, anchor, clipin body, clipin edge); snap
install reads from gestureSlice (with legacy fallback). The original
bug class (pair-drag lasso install/teardown smear across TSX +
controller + thunks) is structurally fixed.

| Task | Status | Commit |
|---|---|---|
| 1. Profile registry scaffold | ✅ | `eb58f05` |
| 2. Gesture slice | ✅ | `bd336bd` |
| 3. Drag thunks (beginDrag/drag/endDrag) | ✅ | `2d3458b` |
| 4. buildGraphFromSlice gesture extension | ✅ | `67efe72` |
| 5. PAIR_DRAG profile | ✅ | `a4cf76c` |
| 6. Wire pair-drag through controller + CanvasTimeline | ✅ | `accc5ca` |
| 7. ANCHOR_DRAG profile + wired for clean single-anchor case | ✅ | `8e34ade` |
| 9. CLIP_BODY_DRAG profile + wired for clipin body (input space) | ✅ | `1ea4ed6` |
| 10. CLIP_EDGE_DRAG profile + wired for clipin edge (input space) | ✅ | `f7fe92a` |
| 11. Snap install moved to gestureSlice (with dragCtx fallback) | ✅ | `76c64eb` |
| 8. Lasso TranslateGroup from selection slices directly | ✅ | `1019274` |
| 12a. Anchor-lock segment in clip body / edge profiles | ✅ | `9888db7` |
| 12b. Wire clipout body / edge drags through profiles | deferred (commitClipout* migration) |
| 13. Dissolve dragCtxSlice | deferred (blocked on 12b — anchor-lock is the last primary consumer) |
| 14. Controller cleanup pass | deferred (DragState fields used by legacy paths too) |

**All 1583 tests pass.**

## Migration patterns established

Each profile follows the same shape:
1. Profile in `src/constraints/profiles/<name>.ts` — pure `onDrag`
   (returns ops) + `whileDragging` (returns constraints).
2. Controller's pointerDown branch sets `drag.profileHandle` and emits
   `beginDrag(handle)` when the case is "clean" (no combined-gesture
   couplings).
3. pointerMove handler emits `drag(delta, modifiers)` when
   `drag.profileHandle` is set; legacy `regionResize` /
   `anchorEntityMove` otherwise.
4. pointerUp re-emits the final cumulative `drag(delta)` before
   `endDrag` — required because applyIntents's `beginReplayFrame`
   resets the slice to preDrag on every pointer event, including the
   pointerUp event, so the final state must be re-applied after that
   reset.

## What's deferred and why

- **Wiring clipout body / edge drags through profiles** (Task 12b):
  the profile anchor-lock segment is built and tested, but the
  controller's clipout branches still route through
  `commitClipoutPan` / `commitClipoutResize` thunks, which dispatch
  `applyConformedClipout` — a richer write that conformed-marker carry
  and other clipout-specific semantics rely on. Migrating clipout to
  the profile path requires either folding those semantics into the
  profile or running both paths during transition. Designed but not
  attempted because it needs careful test reconciliation.
- **`dragCtxSlice` dissolution** (Task 13): blocked on Task 12b. The
  `anchorLock` field is still the primary source (consumed via
  `anchorLockMirrorMiddleware`); the `lassoIds` and `snapInstall`
  fields are fallbacks only. Once the middleware retires, the slice
  can go.
- **Controller cleanup** (Task 14): the unused-looking DragState
  fields (`isPair`, `capturedSpaces`, `partnerOrigTime`,
  `gestureRole`, `linkedOutputEdges`, `regionGroupIds`) are still
  consumed by the legacy paths (combined-selection anchor drag,
  conformed-input anchor drag, beat-anchor + linked clipout edge,
  clipout drags). They can be stripped once those paths retire. The
  combined-gesture deferral in the spec covers some; clipout
  migration covers the rest.

The architecture proves out. Remaining tasks are mostly mechanical
test reconciliation for the clipout cases and cosmetic cleanup.

## What ships

- Five gesture profiles (`PAIR_DRAG`, `ANCHOR_DRAG`, `CLIP_BODY_DRAG`,
  `CLIP_EDGE_DRAG`) plus the registry indexed by handle kind. Each is
  pure data + a small `onDrag` function; each has its own unit test.
- Profile-driven warp-line pair drag (Task 6) — the freshly-painful
  bug from the brainstorm is structurally impossible now.
- Profile-driven clean single-anchor drag (Task 7) — non-coupling
  cases go through `beginDrag` → `drag` → `endDrag`. The conformed-
  input and combined-selection cases stay on the legacy path (deferred
  combined-gesture audit per the spec).

## Remaining work shape

- **Wiring CLIP_BODY_DRAG / CLIP_EDGE_DRAG** (Task 14 cleanup pass) —
  same mechanical pattern as Task 7: switch the controller branch to
  emit `beginDrag` with the appropriate handle, update tests that
  asserted intent shape to assert lifecycle intents instead.
- **Snap consolidation** (Task 11) — currently profile.whileDragging
  declares an empty-targets SnapTarget; live snap candidates still come
  from the legacy `dragCtx.snapInstall` populated by WarpView's
  `onSnapStart` callback. Consolidation means moving the snap-target
  computation into the profile, callable from `buildGraphFromSlice`.
- **dragCtxSlice dissolution** (Task 13) — after Task 11 there are no
  remaining consumers; the slice + its mirror middleware can be
  deleted.

The architecture is proven and the highest-value bug class is fixed.
Remaining work is mechanical and can land incrementally without
blocking on this PR.

**Key validation:** the warp-line drag is now driven entirely by the
constraint pipeline — `PAIR_DRAG.whileDragging` injects the
TranslateGroup over both partners while `gesture.activeHandle` is set,
vanishes when it's cleared. The `prePairDragLassoIdsRef` snapshot/restore
hack in CanvasTimeline is gone. The bug class "behavior in TSX install
logic drifts from the constraint graph" is structurally unrepresentable
for pair drag.

**DragState gained a `profileHandle` field.** Distinguishes profile-driven
drags (set by warp-line pointerDown) from legacy drags that happen to
have `isPair=true` (conformed-input single-anchor drags). Controller
checks `profileHandle` to decide whether to emit `drag` (profile path)
or `anchorEntityMove` (legacy path).

**Remaining migrations follow the same pattern.** Each task: write the
profile (TDD), wire the controller branch to emit `beginDrag` with the
appropriate handle, update tests. The biggest wrinkle to watch for:
non-pair anchor drag (Task 7) has a `linkedOutputEdges` secondary
emission for "beat-anchor + linked clipout edge" coupling — this is the
deferred combined-gesture case; preserve its legacy path through Task 7
and don't try to fold it into ANCHOR_DRAG.

---

## File structure

**New files:**
- `src/constraints/profiles/types.ts` — `GestureProfile` and `Handle` types
- `src/constraints/profiles/index.ts` — `PROFILES` registry, `lookupProfile`
- `src/constraints/profiles/pair-drag.ts` — `PAIR_DRAG` profile
- `src/constraints/profiles/anchor-drag.ts` — `ANCHOR_DRAG` profile (both spaces)
- `src/constraints/profiles/clip-body-drag.ts` — `CLIP_BODY_DRAG` profile (both spaces)
- `src/constraints/profiles/clip-edge-drag.ts` — `CLIP_EDGE_DRAG` profile (in/out edges, both spaces)
- `src/constraints/profiles/inner-anchors.ts` — `innerBeatAnchorIds` helper for anchor-lock
- `src/store/slices/gestureSlice.ts` — `GestureState` slice
- `src/store/thunks/dragThunks.ts` — UPDATED: add `beginDrag` / `drag` / `endDrag` exports
- `tests/unit/profiles/` — per-profile unit tests

**Modified files:**
- `src/constraints/pipeline.ts` — `buildGraphFromSlice` reads `gesture.activeHandle`, injects `profile.whileDragging`; reads selection directly for lasso TranslateGroup
- `src/constraints/pipelineDispatch.ts` — `extractDragCtxFromSlice` reads from `gesture` instead of `dragCtx`
- `src/store/store.ts` — register `gesture` reducer; drop `dragCtx`, drop dragCtx mirror middleware, drop anchorLock mirror middleware
- `src/timeline/controller.ts` — emit `beginDrag` / `drag` / `endDrag` for migrated handles
- `src/components/CanvasTimeline.tsx` — `applyIntents` dispatches the three new thunks; drop `prePairDragLassoIdsRef`
- `src/components/WarpView.tsx` — drop migrated callback props (`onSnapStart`, `onSnapEnd`, primary drag callbacks)
- `src/store/thunks/entityWriteThunks.ts` — delete migrated thunks
- Various tests — adapt to new intent / thunk shape

**Files dissolved:**
- `src/store/slices/dragCtxSlice.ts`
- `src/store/middleware/dragCtxMirrorMiddleware.ts`
- `src/store/middleware/anchorLockMirrorMiddleware.ts`
- `src/store/middleware/globalLockModeMirrorMiddleware.ts` (subsumed)
- `selectionGraphMirrorMiddleware.ts` — lasso-mirror portion (selection actions still need to write into gesture's lasso view; restructured)

---

## Tasks

Each task ends with a green-tests checkpoint. Run `rtk vitest run tests/` after every task body change to verify.

### Task 1: Scaffolding — types and registry skeleton

**Files:**
- Create: `src/constraints/profiles/types.ts`
- Create: `src/constraints/profiles/index.ts`
- Test: `tests/unit/profiles/registry.test.ts`

- [ ] **Step 1.1 — write failing test for registry shape**

```ts
// tests/unit/profiles/registry.test.ts
import { describe, it, expect } from 'vitest'
import { PROFILES, lookupProfile } from '../../../src/constraints/profiles'

describe('profile registry', () => {
  it('exposes a PROFILES object keyed by handle kind', () => {
    expect(PROFILES).toBeDefined()
    expect(typeof PROFILES).toBe('object')
  })

  it('lookupProfile returns undefined for unknown handles', () => {
    const result = lookupProfile({ kind: 'nonexistent' } as never)
    expect(result).toBeUndefined()
  })
})
```

Run: `rtk vitest run tests/unit/profiles/registry.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 1.2 — write types**

```ts
// src/constraints/profiles/types.ts
import type { Constraint, Op } from '../types'

export type Handle =
  | { kind: 'pair-drag';     pairId: number }
  | { kind: 'anchor-drag';   anchorId: number; space: 'input' | 'beat' }
  | { kind: 'clip-body';     clipId: string; space: 'input' | 'beat' }
  | { kind: 'clip-in-edge';  clipId: string; space: 'input' | 'beat' }
  | { kind: 'clip-out-edge'; clipId: string; space: 'input' | 'beat' }

export type ProfileContext = {
  preDrag: {
    origAnchors: ReadonlyArray<{ id: number; time: number }>
    beatAnchors: ReadonlyArray<{ id: number; time: number; linked?: boolean }>
    regions: ReadonlyArray<{
      id: string; inPoint: number; outPoint: number
      inBeatTime: number; outBeatTime: number
      defaultLinked: boolean
    }>
  }
  ui: { anchorLock: boolean; lockMode: 'bpm' | 'beats' }
  modifiers: { alt: boolean }
}

export type GestureProfile = {
  onDrag: (handle: Handle, delta: number, ctx: ProfileContext) => Op[]
  whileDragging: (handle: Handle, ctx: ProfileContext) => Constraint[]
}
```

- [ ] **Step 1.3 — write registry shell**

```ts
// src/constraints/profiles/index.ts
import type { GestureProfile, Handle } from './types'

export type { Handle, GestureProfile, ProfileContext } from './types'

export const PROFILES: Partial<Record<Handle['kind'], GestureProfile>> = {}

export function lookupProfile(handle: Handle): GestureProfile | undefined {
  return PROFILES[handle.kind]
}
```

- [ ] **Step 1.4 — run test, verify passes**

Run: `rtk vitest run tests/unit/profiles/registry.test.ts`
Expected: PASS.

- [ ] **Step 1.5 — commit**

```bash
git add src/constraints/profiles/ tests/unit/profiles/
git commit -m "feat(profiles): scaffold gesture profile registry"
```

---

### Task 2: Gesture slice

**Files:**
- Create: `src/store/slices/gestureSlice.ts`
- Modify: `src/store/store.ts`
- Test: `tests/unit/slices/gestureSlice.test.ts`

- [ ] **Step 2.1 — write failing test**

```ts
// tests/unit/slices/gestureSlice.test.ts
import { describe, it, expect } from 'vitest'
import gestureReducer, {
  setActiveHandle, setCumulativeDelta, setGestureModifiers, clearGesture,
} from '../../../src/store/slices/gestureSlice'

describe('gestureSlice', () => {
  it('starts with no active handle and default modifiers', () => {
    const s = gestureReducer(undefined, { type: '@@INIT' })
    expect(s.activeHandle).toBeNull()
    expect(s.cumulativeDelta).toBe(0)
    expect(s.modifiers).toEqual({ alt: false })
  })

  it('setActiveHandle records the handle', () => {
    const s = gestureReducer(undefined, setActiveHandle({ kind: 'pair-drag', pairId: 1 }))
    expect(s.activeHandle).toEqual({ kind: 'pair-drag', pairId: 1 })
  })

  it('clearGesture resets to initial', () => {
    let s = gestureReducer(undefined, setActiveHandle({ kind: 'pair-drag', pairId: 1 }))
    s = gestureReducer(s, setCumulativeDelta(5))
    s = gestureReducer(s, setGestureModifiers({ alt: true }))
    s = gestureReducer(s, clearGesture())
    expect(s.activeHandle).toBeNull()
    expect(s.cumulativeDelta).toBe(0)
    expect(s.modifiers).toEqual({ alt: false })
  })

  it('setGestureModifiers updates only modifiers', () => {
    let s = gestureReducer(undefined, setActiveHandle({ kind: 'pair-drag', pairId: 1 }))
    s = gestureReducer(s, setGestureModifiers({ alt: true }))
    expect(s.activeHandle).toEqual({ kind: 'pair-drag', pairId: 1 })
    expect(s.modifiers.alt).toBe(true)
  })
})
```

Run: `rtk vitest run tests/unit/slices/gestureSlice.test.ts`
Expected: FAIL.

- [ ] **Step 2.2 — write slice**

```ts
// src/store/slices/gestureSlice.ts
import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { Handle } from '../../constraints/profiles/types'

export interface GestureState {
  activeHandle: Handle | null
  cumulativeDelta: number
  modifiers: { alt: boolean }
}

const initialState: GestureState = {
  activeHandle: null,
  cumulativeDelta: 0,
  modifiers: { alt: false },
}

const gestureSlice = createSlice({
  name: 'gesture',
  initialState,
  reducers: {
    setActiveHandle(state, action: PayloadAction<Handle | null>) {
      state.activeHandle = action.payload
    },
    setCumulativeDelta(state, action: PayloadAction<number>) {
      state.cumulativeDelta = action.payload
    },
    setGestureModifiers(state, action: PayloadAction<{ alt: boolean }>) {
      state.modifiers = action.payload
    },
    clearGesture(state) {
      state.activeHandle = null
      state.cumulativeDelta = 0
      state.modifiers = { alt: false }
    },
  },
})

export const { setActiveHandle, setCumulativeDelta, setGestureModifiers, clearGesture } = gestureSlice.actions
export default gestureSlice.reducer
```

- [ ] **Step 2.3 — register reducer in store**

In `src/store/store.ts` and `tests/helpers/setup.ts`, add `gesture: gestureReducer` to the reducer map. Keep `dragCtx` for now (dissolves in Task 8).

- [ ] **Step 2.4 — verify all tests still pass**

Run: `rtk vitest run tests/`
Expected: all pass.

- [ ] **Step 2.5 — commit**

```bash
git add src/store/slices/gestureSlice.ts src/store/store.ts tests/helpers/setup.ts tests/unit/slices/gestureSlice.test.ts
git commit -m "feat(gesture): add gestureSlice (activeHandle, cumulativeDelta, modifiers)"
```

---

### Task 3: Drag thunks

**Files:**
- Modify: `src/store/thunks/dragThunks.ts`
- Test: `tests/unit/thunks/dragThunks.test.ts` (extend existing)

- [ ] **Step 3.1 — write failing test for beginDrag / drag / endDrag**

```ts
// tests/unit/thunks/dragThunks.test.ts — add to existing file
import { beginDrag, drag, endDrag, cancelDrag } from '../../../src/store/thunks/dragThunks'

describe('drag lifecycle thunks', () => {
  it('beginDrag snapshots preDrag and sets activeHandle', () => {
    const store = makeStore()
    store.dispatch(addAnchor({ id: 1, time: 5 }))
    store.dispatch(beginDrag({ handle: { kind: 'anchor-drag', anchorId: 1, space: 'input' } }))
    const s = store.getState()
    expect(s.gesture.activeHandle).toEqual({ kind: 'anchor-drag', anchorId: 1, space: 'input' })
    expect(s.drag.preDrag).toBeTruthy()
    expect(s.drag.preDrag?.origAnchors[0].time).toBe(5)
  })

  it('endDrag clears activeHandle and ends drag', () => {
    const store = makeStore()
    store.dispatch(addAnchor({ id: 1, time: 5 }))
    store.dispatch(beginDrag({ handle: { kind: 'anchor-drag', anchorId: 1, space: 'input' } }))
    store.dispatch(endDrag())
    expect(store.getState().gesture.activeHandle).toBeNull()
    expect(store.getState().drag.preDrag).toBeNull()
  })

  it('drag is a no-op when no activeHandle', () => {
    const store = makeStore()
    store.dispatch(drag({ delta: 5, modifiers: { alt: false } }))
    // no-op; should not throw
    expect(store.getState().gesture.cumulativeDelta).toBe(0)
  })
})
```

- [ ] **Step 3.2 — implement thunks**

Read existing `src/store/thunks/dragThunks.ts` and extend with:

```ts
import {
  setActiveHandle, setCumulativeDelta, setGestureModifiers, clearGesture,
} from '../slices/gestureSlice'
import { dragStart, dragEnd } from '../slices/dragSlice'
import type { Handle } from '../../constraints/profiles/types'
import { lookupProfile } from '../../constraints/profiles'
import { dispatchPipelinedReplay } from '../../constraints/pipelineDispatch'

export const beginDrag = ({ handle }: { handle: Handle }) =>
  (dispatch: AppDispatch, getState: () => RootState) => {
    dispatch(dragStart(snapshotPreDragState(getState())))
    dispatch(setActiveHandle(handle))
    dispatch(setCumulativeDelta(0))
    dispatch(setGestureModifiers({ alt: false }))
  }

export const drag = ({ delta, modifiers }: { delta: number; modifiers: { alt: boolean } }) =>
  (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState()
    const handle = state.gesture.activeHandle
    if (!handle) return
    dispatch(setGestureModifiers(modifiers))
    dispatch(setCumulativeDelta(delta))
    const profile = lookupProfile(handle)
    if (!profile) return
    const ctx = profileContextFromState(getState())
    for (const op of profile.onDrag(handle, delta, ctx)) {
      dispatchPipelinedReplay(dispatch, getState, op)
    }
  }

export const endDrag = () => (dispatch: AppDispatch) => {
  dispatch(clearGesture())
  dispatch(dragEnd())
}

export const cancelDrag = () => (dispatch: AppDispatch) => {
  dispatch(clearGesture())
  dispatch(_existingCancelDrag())   // whatever the existing cancel is named
}

function profileContextFromState(state: RootState): ProfileContext {
  return {
    preDrag: state.drag.preDrag ?? { origAnchors: [], beatAnchors: [], regions: [] },
    ui: { anchorLock: state.ui.anchorLock ?? false, lockMode: state.ui.lockMode ?? 'bpm' },
    modifiers: state.gesture.modifiers,
  }
}
```

- [ ] **Step 3.3 — run new tests, verify pass**

Run: `rtk vitest run tests/unit/thunks/dragThunks.test.ts`
Expected: PASS (existing + new).

- [ ] **Step 3.4 — run full suite, verify pass**

Run: `rtk vitest run tests/`
Expected: 1555+ tests pass.

- [ ] **Step 3.5 — commit**

```bash
git add src/store/thunks/dragThunks.ts tests/unit/thunks/dragThunks.test.ts
git commit -m "feat(drag): add beginDrag/drag/endDrag thunks (pure routers)"
```

---

### Task 4: buildGraphFromSlice gesture-scoped extension

**Files:**
- Modify: `src/constraints/pipeline.ts`
- Modify: `src/constraints/pipelineDispatch.ts`
- Test: `tests/unit/constraints/scenario-gesture-while-dragging.test.ts`

- [ ] **Step 4.1 — write failing test**

```ts
// tests/unit/constraints/scenario-gesture-while-dragging.test.ts
import { describe, it, expect } from 'vitest'
import { makeStore } from '../../helpers/setup'
import { addAnchor } from '../../../src/store/slices/warpSlice'
import { beginDrag, endDrag } from '../../../src/store/thunks/dragThunks'
import { PROFILES } from '../../../src/constraints/profiles'
import type { GestureProfile, Handle } from '../../../src/constraints/profiles/types'
import { ConstraintKind } from '../../../src/constraints/types'
import { buildGraphFromSlice, extractDragCtxFromSlice } from '../../../src/constraints/pipeline'
import { extractSliceForPipeline } from '../../../src/constraints/pipelineDispatch'

describe('gesture-scoped whileDragging extension', () => {
  it('inserts constraints from profile.whileDragging when activeHandle is set', () => {
    const TEST_HANDLE_KIND = 'test-handle' as const
    const testProfile: GestureProfile = {
      onDrag: () => [],
      whileDragging: () => [
        { kind: ConstraintKind.SnapCohort, tag: 'test-marker', ids: [] },
      ],
    }
    ;(PROFILES as Record<string, GestureProfile>)[TEST_HANDLE_KIND] = testProfile

    const store = makeStore()
    store.dispatch(addAnchor({ id: 1, time: 5 }))
    store.dispatch(beginDrag({ handle: { kind: TEST_HANDLE_KIND, anchorId: 1 } as unknown as Handle }))

    const state = store.getState()
    const slice = extractSliceForPipeline(state)
    const dragCtx = extractDragCtxFromSlice(state as never)
    const graph = buildGraphFromSlice(slice, dragCtx)

    const hasMarker = graph.constraints.some(c =>
      c.kind === ConstraintKind.SnapCohort && (c as { tag?: string }).tag === 'test-marker'
    )
    expect(hasMarker).toBe(true)

    store.dispatch(endDrag())
    const graphAfter = buildGraphFromSlice(
      extractSliceForPipeline(store.getState()),
      extractDragCtxFromSlice(store.getState() as never),
    )
    const stillHasMarker = graphAfter.constraints.some(c =>
      c.kind === ConstraintKind.SnapCohort && (c as { tag?: string }).tag === 'test-marker'
    )
    expect(stillHasMarker).toBe(false)

    delete (PROFILES as Record<string, GestureProfile>)[TEST_HANDLE_KIND]
  })
})
```

Run: expected to FAIL (extension not implemented).

- [ ] **Step 4.2 — extend `buildGraphFromSlice`**

In `src/constraints/pipeline.ts`, add a new gesture parameter to `DragCtx` (or extend it). Read the active gesture, look up the profile, insert `whileDragging` constraints at the end.

Concretely: `extractDragCtxFromSlice` reads `state.gesture` and merges it into the `DragCtx`. Then `buildGraphFromSlice` adds a final step:

```ts
// after step 10
if (dragCtx.activeHandle) {
  const profile = lookupProfile(dragCtx.activeHandle)
  if (profile) {
    const ctx: ProfileContext = {
      preDrag: { /* from slice */ },
      ui: { anchorLock: slice.ui.anchorLock, lockMode: slice.ui.lockMode },
      modifiers: dragCtx.modifiers,
    }
    for (const c of profile.whileDragging(dragCtx.activeHandle, ctx)) {
      state = reduce(state, { kind: OpKind.AddConstraint, constraint: c })
    }
  }
}
```

Add `activeHandle?: Handle` and `modifiers?: { alt: boolean }` to the `DragCtx` interface.

- [ ] **Step 4.3 — update `extractDragCtxFromSlice` to read gesture**

```ts
export function extractDragCtxFromSlice(state: { dragCtx?: ..., gesture?: ... }): DragCtx {
  // existing reads from state.dragCtx
  return {
    ...existing,
    activeHandle: state.gesture?.activeHandle ?? null,
    modifiers: state.gesture?.modifiers ?? { alt: false },
  }
}
```

- [ ] **Step 4.4 — run test, verify pass**

Run: `rtk vitest run tests/unit/constraints/scenario-gesture-while-dragging.test.ts`
Expected: PASS.

- [ ] **Step 4.5 — full suite**

Run: `rtk vitest run tests/`
Expected: 1556+ pass.

- [ ] **Step 4.6 — commit**

```bash
git add src/constraints/pipeline.ts src/constraints/pipelineDispatch.ts tests/unit/constraints/scenario-gesture-while-dragging.test.ts
git commit -m "feat(pipeline): inject profile.whileDragging constraints from active gesture"
```

---

### Task 5: PAIR_DRAG profile

**Files:**
- Create: `src/constraints/profiles/pair-drag.ts`
- Modify: `src/constraints/profiles/index.ts`
- Test: `tests/unit/profiles/pair-drag.test.ts`

- [ ] **Step 5.1 — write failing test**

```ts
// tests/unit/profiles/pair-drag.test.ts
import { describe, it, expect } from 'vitest'
import { PAIR_DRAG } from '../../../src/constraints/profiles/pair-drag'
import { ConstraintKind, OpKind } from '../../../src/constraints/types'

const ctx = {
  preDrag: { origAnchors: [{ id: 1, time: 5 }], beatAnchors: [{ id: 1, time: 10 }], regions: [] },
  ui: { anchorLock: false, lockMode: 'bpm' as const },
  modifiers: { alt: false },
}

describe('PAIR_DRAG profile', () => {
  it('onDrag emits a single Move op on the orig anchor', () => {
    const ops = PAIR_DRAG.onDrag({ kind: 'pair-drag', pairId: 1 }, 3, ctx)
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ kind: OpKind.Move, id: 'a1-in', delta: 3 })
  })

  it('whileDragging installs TranslateGroup over the pair + SnapTarget on orig', () => {
    const cs = PAIR_DRAG.whileDragging({ kind: 'pair-drag', pairId: 1 }, ctx)
    const tg = cs.find(c => c.kind === ConstraintKind.TranslateGroup)
    expect(tg).toBeDefined()
    expect((tg as { ids: string[] }).ids).toEqual(['a1-in', 'a1-out'])
    expect(cs.find(c => c.kind === ConstraintKind.SnapTarget)).toBeDefined()
  })
})
```

- [ ] **Step 5.2 — implement profile**

```ts
// src/constraints/profiles/pair-drag.ts
import { ConstraintKind, OpKind } from '../types'
import { anchorInId, anchorOutId } from '../ids'
import type { GestureProfile, Handle } from './types'

export const PAIR_DRAG: GestureProfile = {
  onDrag: (handle, delta) => {
    if (handle.kind !== 'pair-drag') return []
    return [{ kind: OpKind.Move, id: anchorInId(handle.pairId), delta }]
  },
  whileDragging: (handle) => {
    if (handle.kind !== 'pair-drag') return []
    const orig = anchorInId(handle.pairId)
    const beat = anchorOutId(handle.pairId)
    return [
      {
        kind: ConstraintKind.TranslateGroup,
        ids: [orig, beat],
        tag: `gesture:pair:${handle.pairId}`,
      },
      {
        kind: ConstraintKind.SnapTarget,
        id: orig,
        field: 'time',
        threshold: 4,
        targets: [],
        mode: 'edge',
        tag: `gesture:snap:${orig}`,
      },
    ]
  },
}
```

(Note: the SnapTarget's `targets` and `threshold` will be populated by the existing snap-rules machinery via `snapToSiblings`. For now, leave empty; Task 11 wires snap targets through the profile.)

- [ ] **Step 5.3 — register in PROFILES**

```ts
// src/constraints/profiles/index.ts
import { PAIR_DRAG } from './pair-drag'

export const PROFILES: Partial<Record<Handle['kind'], GestureProfile>> = {
  'pair-drag': PAIR_DRAG,
}
```

- [ ] **Step 5.4 — run profile test**

Run: `rtk vitest run tests/unit/profiles/pair-drag.test.ts`
Expected: PASS.

- [ ] **Step 5.5 — commit**

```bash
git add src/constraints/profiles/pair-drag.ts src/constraints/profiles/index.ts tests/unit/profiles/pair-drag.test.ts
git commit -m "feat(profiles): PAIR_DRAG — orig→beat TranslateGroup + snap"
```

---

### Task 6: Wire pair-drag through the controller and CanvasTimeline

**Files:**
- Modify: `src/timeline/controller.ts` — warp-line pointerDown branch emits `beginDrag` intent
- Modify: `src/components/CanvasTimeline.tsx` — `applyIntents` dispatches `beginDrag`/`drag`/`endDrag`; remove `prePairDragLassoIdsRef`
- Modify: `src/timeline/types.ts` — add `beginDrag` / `drag` / `endDrag` Intent variants
- Test: extend existing `tests/bdd/timeline/drag.test.ts` warp-line scenarios

- [ ] **Step 6.1 — add Intent variants**

Locate the Intent type in `src/timeline/types.ts`. Add:

```ts
| { kind: 'beginDrag';  handle: Handle }
| { kind: 'drag';       delta: number; modifiers: { alt: boolean } }
| { kind: 'endDrag' }
```

(Don't remove old anchorEntityMove etc. yet — both coexist during migration.)

- [ ] **Step 6.2 — write failing controller test**

Extend `tests/unit/timeline/controller.test.ts`:

```ts
it('warp-line pointerDown emits beginDrag(pair-drag)', () => {
  const c = createTimelineController()
  const tracks = buildLayout(false, CANVAS_H)
  const warp = tracks.find(t => t.id === 'warp')!
  const warpY = warp.y + warp.h / 2
  const snap = makeSnapshot({
    anchors: [{ id: 1, time: 10 }],
    beatAnchors: [{ id: 1, time: 5 }],
    hits: [pointHit(80, warpY, { kind: 'warp-line', id: 1 })],
  })
  const intents = c.pointerDown(makePointerEvent({ clientX: 80, clientY: warpY }), snap)
  const beginDragIntent = intents.find(i => i.kind === 'beginDrag')
  expect(beginDragIntent).toBeDefined()
  expect((beginDragIntent as { handle: Handle }).handle).toEqual({ kind: 'pair-drag', pairId: 1 })
})

it('warp-line pointerMove emits drag intent with cumulative delta', () => {
  // ...
})
```

- [ ] **Step 6.3 — modify controller's warp-line branch**

Replace the existing warp-line pointerDown emission (lines ~704-744) with:

```ts
if (hit && hit.kind === 'warp-line') {
  const id = hit.id as number
  const inAnchor = snap.anchors.find(a => a.id === id)
  const beatAnchor = snap.beatAnchors.find(a => a.id === id)
  if (inAnchor && beatAnchor) {
    drag = buildAnchorDrag(
      snap, id, 'input', inAnchor.time,
      true, true,
      e.clientX, e.clientY,
      [
        { kind: 'anchorSelect', id, additive: false },
        { kind: 'beatAnchorSelect', id, additive: false },
      ],
    )
    drag.capturedSpaces = { input: true, beat: true }
    drag.partnerOrigTime = beatAnchor.time
    drag.isPair = true
    intents.push({ kind: 'beginDrag', handle: { kind: 'pair-drag', pairId: id } })
    // snap install is now declared by PAIR_DRAG.whileDragging — no snapStart intent
    return intents
  }
}
```

Update `handleAnchorDrag` for pair drags: emit `drag({ delta, modifiers: { alt: e.altKey } })` INSTEAD of `anchorEntityMove`.

Update pointerUp for pair drags: emit `endDrag` INSTEAD of the orig anchorEntityMove.

- [ ] **Step 6.4 — wire intents in CanvasTimeline**

```ts
case 'beginDrag':
  dispatch(beginDrag({ handle: i.handle }))
  break
case 'drag':
  dispatch(drag({ delta: i.delta, modifiers: i.modifiers }))
  break
case 'endDrag':
  dispatch(endDrag())
  break
```

Remove the `prePairDragLassoIdsRef` and its dragStart/dragEnd/dragCancel logic.

- [ ] **Step 6.5 — adapt warp-line tests**

Update existing warp-line BDD tests to assert `beginDrag` / `drag` / `endDrag` instead of `dragStart` + `anchorEntityMove`.

- [ ] **Step 6.6 — run full suite**

Run: `rtk vitest run tests/`
Expected: all pass.

- [ ] **Step 6.7 — commit**

```bash
git add -u src/ tests/
git commit -m "feat(controller): warp-line → beginDrag/drag/endDrag via PAIR_DRAG profile"
```

---

### Tasks 7-12: Wire remaining profiles (anchor-drag, clip-body, clip-edges)

Each follows the Task 5 + Task 6 pattern. For brevity in this plan: same TDD cadence — write failing profile test, implement profile, register, then write controller test, modify controller branch, wire CanvasTimeline. Each profile ends in a commit.

**Task 7 — ANCHOR_DRAG**
- Profile: `onDrag` returns `Move(anchorInId|anchorOutId, delta)` depending on space.
- `whileDragging`: just `SnapTarget(anchor, 'time')`. Lasso TranslateGroup comes from selection (Task 8).
- Wire regular anchor pointerDown branch (line 632 area).
- Remove `applyMoveOrigAnchor`, `applyMoveBeatAnchor` thunks; tests update to use `beginDrag(anchor-drag) + drag + endDrag` sequence.

**Task 8 — lasso TranslateGroup from selection (direct read)**
- Modify `buildGraphFromSlice` to read `state.warp.selectedOrigIds + selectedBeatIds + lists.selection.clipin + clipout` directly and install `lasso:main` TranslateGroup.
- Remove `dragCtx.lassoIds` field, `setLassoIds` action, the selectionGraphMirrorMiddleware's mirroring code.
- Lasso entities are computed in `extractSliceForPipeline` if needed.

**Task 9 — CLIP_BODY_DRAG**
- Profile: `onDrag` returns `Move(regionInId|regionOutId, delta)`.
- `whileDragging`: `SnapTarget(clip, 'in', mode: 'body')`.
- Wire region body pointerDown branch (line 799 area).
- Remove `applyRegionEntityMove` (clipin path only — clipout pan stays via `commitClipoutPan` for now).

**Task 10 — CLIP_EDGE_DRAG**
- Profile: `onDrag` returns `SetEdge(clipId, edge, preDrag.edge + delta)`.
- `whileDragging`: `SnapTarget(clip, edge, mode: 'edge')`.
- Wire region edge pointerDown branch (line 747 area).
- Remove `applyUpdateRegionInOut`'s drag path (keep the API for non-drag callers like Set-In-Point if they exist; audit).

**Task 11 — snap target rule wiring through profile**
- Profile's `whileDragging` needs to produce the right SnapTarget targets. Currently `snapToSiblings` (in WarpView callback) does this. Move that logic into a helper called by profile `whileDragging`.
- Remove `setSnapInstall`, `dragCtxSlice.snapInstall`, `dragCtxMirrorMiddleware` related pieces.
- Remove WarpView's `onSnapStart`/`onSnapEnd` callbacks.

**Task 12 — clipout body + edge profiles + anchor-lock**
- `CLIPOUT_BODY_DRAG` and `CLIPOUT_EDGE_DRAG` profiles.
- Anchor-lock segment: read `slice.ui.anchorLock XOR modifiers.alt`, conditionally inject TranslateGroup + ScaleGroup.
- `innerBeatAnchorIds(slice, clipId)` helper extracted from `anchorLockMirrorMiddleware`.
- Delete `anchorLockMirrorMiddleware` and `dragCtx.anchorLock`.

---

### Task 13: Dissolve dragCtxSlice

By this point, all three `dragCtx` fields are unused.

- [ ] Delete `src/store/slices/dragCtxSlice.ts`.
- [ ] Delete `src/store/middleware/dragCtxMirrorMiddleware.ts`.
- [ ] Remove from `src/store/store.ts` and test setup.
- [ ] Remove `dragCtx` import paths.
- [ ] Update `extractDragCtxFromSlice` (rename to `extractGestureCtx` perhaps) to read only from gesture + selection slices.
- [ ] Run full suite.
- [ ] Commit.

---

### Task 14: Controller cleanup pass

- [ ] Remove `isPair`, `capturedSpaces`, `partnerOrigTime`, `gestureRole` from `DragState` type.
- [ ] Remove `linkedOutputEdges` capture (combined gesture, deferred — keep its emission path via legacy regionResize).
- [ ] Remove `regionGroupIds` if combined gesture audit shows it unused — otherwise keep for case 1.
- [ ] Verify controller's drag-related code is "hit-test → emit beginDrag/drag/endDrag" only.
- [ ] Run full suite.
- [ ] Commit.

---

## Final verification

- All 1555 pre-existing tests pass.
- New tests added: per-profile (5+ profiles), gesture lifecycle (1+ scenario), gesture state slice (1+ unit), drag thunks (1+).
- `git log --oneline` shows one commit per task — easy bisect if regression surfaces.

---

## Notes on execution

- After each task: `rtk vitest run tests/` must be green. If red, fix before commit.
- Combined gestures stay on the legacy path throughout. Don't touch them.
- If a step encounters surprise complexity (e.g., a profile needs slice data we didn't anticipate in `ProfileContext`), extend `ProfileContext` and update earlier profiles to match. Don't add ad-hoc fields.
- Snap-target wiring (Task 11) is the trickiest — `snapToSiblings` reads the live graph state. The profile system needs the same access. Plan for the helper to take the (slice, dragCtx) tuple as input.
