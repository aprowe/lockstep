# Timeline Model Layer Implementation Plan (PR1 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the five pure time-domain rules (conform, clampRegion, snapTarget, beatMap, newRegionBounds) into `src/timeline/model/` and route both `regionSlice` and `CanvasTimeline` through them, so the same behavior is defined once and shared between the live-drag and discrete-event paths.

**Architecture:** Three files for each rule (function, types if needed, tests). Pure TypeScript — no React, no Redux, no DOM. Callers import from `src/timeline/model/*` and pass plain data in / out.

**Tech Stack:** TypeScript, Vitest. No new dependencies.

**Reference spec:** `docs/superpowers/specs/2026-05-11-canvas-timeline-extract-design.md`

---

## File Structure

**New:**
- `src/timeline/model/conform.ts` — `conformClipoutToAnchors(inputIn, inputOut, anchors, beatAnchors)` returns the beat-space `{ inPoint, outPoint }` for a clipout region given its input bounds and the anchor set. Replaces the inline `clipoutFor` in CanvasTimeline.
- `src/timeline/model/clampRegion.ts` — `clampRegionInOut(current, requested, minLength)` returns a corrected `{ inPoint, outPoint }`. Encapsulates the swap-vs-shift logic currently inline in `regionSlice.updateRegionInOut`.
- `src/timeline/model/snapTarget.ts` — context-aware target builders: `anchorDragInputTargets(scenes, regions)`, `anchorDragOutputGrid(bpm, view, canvasW, snapInterval, snapOffset)`, `regionDragTargets(isOutput, anchors, beatAnchors, scenes, regions, excludeId)`. Each returns `SnapTarget[]` / `SnapGrid` that callers feed into the existing `computeSnap()`.
- `src/timeline/model/beatMap.ts` — `buildAnchorPairs(anchors, beatAnchors)`, `origToBeat(time, pairs)`, `beatOffsetFor(region, anchors, beatAnchors)`. Replaces inline `liveOrigToBeat` + `anchorBeatAt` in CanvasTimeline.
- `src/timeline/model/newRegionBounds.ts` — re-exports from `src/utils/view.ts` for now (lift in a later task); placeholder so other model files can co-import the rule.

**New tests:**
- `tests/unit/timeline/model/conform.test.ts`
- `tests/unit/timeline/model/clampRegion.test.ts`
- `tests/unit/timeline/model/snapTarget.test.ts`
- `tests/unit/timeline/model/beatMap.test.ts`

**Modified:**
- `src/store/slices/regionSlice.ts` — `updateRegionInOut` calls `clampRegionInOut`. Inline clamp logic removed.
- `src/components/CanvasTimeline.tsx` — `regionsOutput` IIFE, `liveOrigToBeat`, `anchorBeatAt`, `beatOffset` computation, `clipSnapTargets`, and anchor-drag target building all delegate to `model/*` functions. No behavior change.

**Not touched in this PR** (later PRs handle these):
- `src/timeline/controller.ts` — PR3.
- `.feature` file moves and new feature files — PR2.
- ThinTimeline files — never (out of scope).

---

## Task 1: Set up directory structure

**Files:**
- Create: `src/timeline/model/.gitkeep`
- Create: `tests/unit/timeline/model/.gitkeep`

- [ ] **Step 1: Create the directories**

```bash
mkdir -p src/timeline/model
mkdir -p tests/unit/timeline/model
```

- [ ] **Step 2: Commit empty structure (so subsequent file moves have a target)**

```bash
git add src/timeline/model tests/unit/timeline/model
git commit -m "chore(timeline): create model/ directory structure"
```

Note: empty directories aren't tracked by git, but a later task in this same plan creates files inside them, so no .gitkeep needed. If git complains nothing was staged, skip the commit and continue.

---

## Task 2: Extract `clampRegionInOut`

The existing logic lives in `src/store/slices/regionSlice.ts` lines 63-89 (`updateRegionInOut` reducer). It enforces three rules:

1. If `newIn > current.outPoint`: shift `newOut = newIn + length` (preserve duration).
2. Else if `newOut < current.inPoint`: shift `newIn = newOut - length` (preserve duration).
3. Else if `newOut - newIn < MIN_LENGTH`: clamp whichever boundary moved.

`MIN_LENGTH` is 1 second.

**Files:**
- Create: `src/timeline/model/clampRegion.ts`
- Test: `tests/unit/timeline/model/clampRegion.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/timeline/model/clampRegion.test.ts
import { describe, it, expect } from 'vitest'
import { clampRegionInOut, MIN_REGION_LENGTH } from '../../../../src/timeline/model/clampRegion'

describe('clampRegionInOut', () => {
  const current = { inPoint: 10, outPoint: 20 }

  it('returns unchanged when bounds are within constraints', () => {
    expect(clampRegionInOut(current, { inPoint: 12, outPoint: 18 }))
      .toEqual({ inPoint: 12, outPoint: 18 })
  })

  it('shifts out when in moves past out (preserve length)', () => {
    expect(clampRegionInOut(current, { inPoint: 25, outPoint: 20 }))
      .toEqual({ inPoint: 25, outPoint: 35 })
  })

  it('shifts in when out moves before in (preserve length)', () => {
    expect(clampRegionInOut(current, { inPoint: 10, outPoint: 5 }))
      .toEqual({ inPoint: -5, outPoint: 5 })
  })

  it('pulls in back when in moves too close to out', () => {
    expect(clampRegionInOut(current, { inPoint: 19.5, outPoint: 20 }))
      .toEqual({ inPoint: 19, outPoint: 20 })
  })

  it('pushes out forward when out moves too close to in', () => {
    expect(clampRegionInOut(current, { inPoint: 10, outPoint: 10.5 }))
      .toEqual({ inPoint: 10, outPoint: 11 })
  })

  it('accepts a custom min length', () => {
    expect(clampRegionInOut(current, { inPoint: 10, outPoint: 10.1 }, { minLength: 0.1 }))
      .toEqual({ inPoint: 10, outPoint: 10.1 })
  })

  it('exports MIN_REGION_LENGTH = 1', () => {
    expect(MIN_REGION_LENGTH).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/timeline/model/clampRegion.test.ts
```

Expected: FAIL — `Cannot find module '.../src/timeline/model/clampRegion'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/timeline/model/clampRegion.ts

export const MIN_REGION_LENGTH = 1

export interface RegionBoundsInput {
  inPoint: number
  outPoint: number
}

export interface ClampOptions {
  /** Minimum allowed span (seconds). Defaults to MIN_REGION_LENGTH. */
  minLength?: number
}

/**
 * Reconcile a requested region in/out against the region's current bounds,
 * preserving length when the requested values cross over each other, and
 * enforcing a minimum span otherwise.
 *
 * The "which boundary moved" detection compares `requested` against
 * `current` — if `requested.inPoint !== current.inPoint`, in moved; else
 * out moved.
 */
export function clampRegionInOut(
  current: RegionBoundsInput,
  requested: RegionBoundsInput,
  opts: ClampOptions = {},
): RegionBoundsInput {
  const minLength = opts.minLength ?? MIN_REGION_LENGTH
  let { inPoint: newIn, outPoint: newOut } = requested
  const length = current.outPoint - current.inPoint

  if (newIn > current.outPoint) {
    newOut = newIn + length
  } else if (newOut < current.inPoint) {
    newIn = newOut - length
  } else if (newOut - newIn < minLength) {
    if (newIn !== current.inPoint) {
      newIn = newOut - minLength
    } else {
      newOut = newIn + minLength
    }
  }

  return { inPoint: newIn, outPoint: newOut }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/timeline/model/clampRegion.test.ts
```

Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/timeline/model/clampRegion.ts tests/unit/timeline/model/clampRegion.test.ts
git commit -m "feat(timeline/model): extract clampRegionInOut pure function"
```

---

## Task 3: Route `regionSlice.updateRegionInOut` through `clampRegionInOut`

The reducer currently inlines the same logic. Replace it with a single call to `clampRegionInOut` and verify all existing tests still pass.

**Files:**
- Modify: `src/store/slices/regionSlice.ts:63-89`

- [ ] **Step 1: Run existing regionSlice tests to capture baseline**

```bash
npx vitest run tests/unit/slices/regionSlice.test.ts
```

Expected: PASS. Note the test count for comparison after the change.

- [ ] **Step 2: Modify `updateRegionInOut` reducer**

```ts
// src/store/slices/regionSlice.ts
// Add import at top of file:
import { clampRegionInOut } from '../../timeline/model/clampRegion'

// Replace the updateRegionInOut reducer body (lines 63-89) with:
    updateRegionInOut(state, action: PayloadAction<{ id: string; inPoint: number; outPoint: number }>) {
      const r = state.regions.find(r => r.id === action.payload.id)
      if (!r) return
      const next = clampRegionInOut(
        { inPoint: r.inPoint, outPoint: r.outPoint },
        { inPoint: action.payload.inPoint, outPoint: action.payload.outPoint },
      )
      r.inPoint = next.inPoint
      r.outPoint = next.outPoint
      r.inBeatTime = undefined
      r.outBeatTime = undefined
    },
```

- [ ] **Step 3: Run regionSlice tests + region-editing BDD tests**

```bash
npx vitest run tests/unit/slices/regionSlice.test.ts tests/bdd/regionEditing.test.ts
```

Expected: PASS — same count as Step 1, plus the regionEditing BDD scenarios still green.

- [ ] **Step 4: Run the full test suite to catch any regression**

```bash
npm test
```

Expected: 744/744 PASS (same as baseline).

- [ ] **Step 5: Commit**

```bash
git add src/store/slices/regionSlice.ts
git commit -m "refactor(regionSlice): route updateRegionInOut through clampRegionInOut"
```

---

## Task 4: Extract `conformClipoutToAnchors`

The existing logic is in `src/components/CanvasTimeline.tsx` around line 558-590 (the `regionsOutput = (() => { ... })()` IIFE). The pure rule is the `clipoutFor` closure at lines 561-566:

```ts
function clipoutFor(inputIn: number, inputOut: number, r: RegionBlock): RegionBlock {
  const inBeat = anchorBeatAt(inputIn)
  if (inBeat === undefined) return { ...r, inPoint: inputIn, outPoint: inputOut }
  const outBeat = anchorBeatAt(inputOut) ?? inputOut
  return { ...r, inPoint: inBeat, outPoint: outBeat }
}
```

Where `anchorBeatAt(t)` finds an anchor whose time is within 1e-4 of `t` and returns its paired beat time.

**Files:**
- Create: `src/timeline/model/conform.ts`
- Test: `tests/unit/timeline/model/conform.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/timeline/model/conform.test.ts
import { describe, it, expect } from 'vitest'
import { conformClipoutToAnchors } from '../../../../src/timeline/model/conform'
import type { Anchor } from '../../../../src/types'

describe('conformClipoutToAnchors', () => {
  it('returns vertical (inputs unchanged) when no anchor sits on the in edge', () => {
    const anchors: Anchor[] = [{ id: 1, time: 5 }]
    const beatAnchors: Anchor[] = [{ id: 1, time: 2.5 }]
    expect(conformClipoutToAnchors(10, 20, anchors, beatAnchors))
      .toEqual({ inPoint: 10, outPoint: 20 })
  })

  it('conforms inPoint to anchor beat when input-in lands on an anchor; outPoint stays vertical', () => {
    const anchors: Anchor[] = [{ id: 1, time: 10 }]
    const beatAnchors: Anchor[] = [{ id: 1, time: 5 }]
    expect(conformClipoutToAnchors(10, 20, anchors, beatAnchors))
      .toEqual({ inPoint: 5, outPoint: 20 })
  })

  it('conforms both edges when anchors sit on both input-in and input-out', () => {
    const anchors: Anchor[] = [
      { id: 1, time: 10 },
      { id: 2, time: 20 },
    ]
    const beatAnchors: Anchor[] = [
      { id: 1, time: 5 },
      { id: 2, time: 12 },
    ]
    expect(conformClipoutToAnchors(10, 20, anchors, beatAnchors))
      .toEqual({ inPoint: 5, outPoint: 12 })
  })

  it('uses 1e-4 tolerance for boundary matching', () => {
    const anchors: Anchor[] = [{ id: 1, time: 10.00005 }]
    const beatAnchors: Anchor[] = [{ id: 1, time: 5 }]
    expect(conformClipoutToAnchors(10, 20, anchors, beatAnchors))
      .toEqual({ inPoint: 5, outPoint: 20 })
  })

  it('ignores anchors that miss the tolerance', () => {
    const anchors: Anchor[] = [{ id: 1, time: 10.001 }]
    const beatAnchors: Anchor[] = [{ id: 1, time: 5 }]
    expect(conformClipoutToAnchors(10, 20, anchors, beatAnchors))
      .toEqual({ inPoint: 10, outPoint: 20 })
  })

  it('ignores anchors that have no beat pair', () => {
    const anchors: Anchor[] = [{ id: 1, time: 10 }]
    const beatAnchors: Anchor[] = [] // no pair for id 1
    expect(conformClipoutToAnchors(10, 20, anchors, beatAnchors))
      .toEqual({ inPoint: 10, outPoint: 20 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/timeline/model/conform.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/timeline/model/conform.ts
import type { Anchor } from '../../types'

const TOL = 1e-4

/**
 * Find the anchor whose input time is within tolerance of `t` and return
 * its paired beat time. Returns `undefined` if no anchor matches or the
 * matched anchor has no beat pair.
 */
function anchorBeatAt(
  t: number,
  anchors: Anchor[],
  beatById: Map<number, number>,
): number | undefined {
  const a = anchors.find(a => Math.abs(a.time - t) < TOL)
  return a ? beatById.get(a.id) : undefined
}

/**
 * Given a region's input bounds and the anchor set, compute the beat-space
 * bounds the clipout track should display.
 *
 * Rule: if an anchor sits exactly on the input-in edge (within 1e-4 s),
 * the clipout in edge moves to that anchor's beat time. The out edge moves
 * to its paired anchor's beat time when one exists, otherwise the clipout
 * stays vertical (outPoint = inputOut).
 *
 * When the in edge has no anchor on it, the entire region stays vertical
 * (both edges equal the input bounds).
 */
export function conformClipoutToAnchors(
  inputIn: number,
  inputOut: number,
  anchors: Anchor[],
  beatAnchors: Anchor[],
): { inPoint: number; outPoint: number } {
  const beatById = new Map<number, number>()
  for (const b of beatAnchors) beatById.set(b.id, b.time)
  const inBeat = anchorBeatAt(inputIn, anchors, beatById)
  if (inBeat === undefined) return { inPoint: inputIn, outPoint: inputOut }
  const outBeat = anchorBeatAt(inputOut, anchors, beatById) ?? inputOut
  return { inPoint: inBeat, outPoint: outBeat }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/timeline/model/conform.test.ts
```

Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/timeline/model/conform.ts tests/unit/timeline/model/conform.test.ts
git commit -m "feat(timeline/model): extract conformClipoutToAnchors pure function"
```

---

## Task 5: Route CanvasTimeline's `clipoutFor` through `conformClipoutToAnchors`

The IIFE structure in CanvasTimeline (lines 558-590) handles three branches: live region drag, live anchor drag, and steady state. The pure rule lives inside the closure as `clipoutFor`. Replace that closure with a call to the model function — leaving the IIFE's branching logic in place for now.

**Files:**
- Modify: `src/components/CanvasTimeline.tsx:540-590`

- [ ] **Step 1: Capture baseline test count**

```bash
npm test
```

Expected: 744/744 PASS.

- [ ] **Step 2: Add the import and replace `clipoutFor`**

Add at the top of CanvasTimeline.tsx with the other imports:

```ts
import { conformClipoutToAnchors } from '../timeline/model/conform'
```

Replace the local `clipoutFor` closure (lines 561-566) and remove the `anchorBeatAt` helper (lines 540-543) — both are now subsumed by `conformClipoutToAnchors`. Update the IIFE body to call the model function instead:

```ts
    // Clipout only diverges from vertical when the clip's IN edge sits EXACTLY on a marker.
    // In that case clipout.in = anchor beat time; clipout.out = anchor beat time if OUT
    // also has an anchor, otherwise same as clipin.out (vertical). All other cases: vertical.
    const regionsOutput = (() => {
      if (!p.regionsOutput) return undefined

      function clipoutFor(inputIn: number, inputOut: number, r: RegionBlock): RegionBlock {
        const { inPoint, outPoint } = conformClipoutToAnchors(inputIn, inputOut, anchors, beatAnchors)
        return { ...r, inPoint, outPoint }
      }

      if (lr) {
        return p.regionsOutput.map(r => {
          const inputR = p.regions.find(ri => ri.id === r.id)
          if (!inputR) return r
          if (!r.active || r.id !== lr.id)
            return { ...r, inPoint: inputR.inPoint, outPoint: inputR.outPoint }
          return clipoutFor(lr.inPoint, lr.outPoint, r)
        })
      }
      if (anchorsDragging) {
        return p.regionsOutput.map(r => {
          const inputR = p.regions.find(ri => ri.id === r.id)
          if (!inputR) return r
          if (!r.active) return { ...r, inPoint: inputR.inPoint, outPoint: inputR.outPoint }
          return clipoutFor(inputR.inPoint, inputR.outPoint, r)
        })
      }
      return p.regionsOutput.map(r => {
        const inputR = p.regions.find(ri => ri.id === r.id)
        if (!inputR) return r
        return clipoutFor(inputR.inPoint, inputR.outPoint, r)
      })
    })()
```

Note: the local `clipoutFor` stays (as a thin wrapper that spreads `r`); it's the conform *rule* that's been extracted, not the per-region projection.

The `anchorBeatAt` helper is also still used elsewhere in the file (line 550: `lr ? (anchorBeatAt(lr.inPoint) ?? liveOrigToBeat(lr.inPoint)) : ...`). Leave that usage in place — Task 8 (beatMap.ts) will replace it. Don't delete `anchorBeatAt` yet.

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: 744/744 PASS (no regression).

- [ ] **Step 4: Smoke-test in the app**

```bash
npm run tauri dev
```

In the app: load a video, create a region from 10–20s, place an anchor at exactly 10s, drag the anchor to a different beat time. The clipout track's in edge should follow the anchor's beat position. Drag the anchor off 10s — clipout should snap back to vertical alignment with clipin. Close the dev session.

- [ ] **Step 5: Commit**

```bash
git add src/components/CanvasTimeline.tsx
git commit -m "refactor(CanvasTimeline): route clipout conform through model layer"
```

---

## Task 6: Extract `beatMap` (anchor pair builder, origToBeat, beatOffsetFor)

The existing logic in `src/components/CanvasTimeline.tsx`:

- Lines 502-509 build `anchorPairs` and sort by input time.
- Lines 526-538 define `liveOrigToBeat(t)`: piecewise-linear input→beat using the pair list.
- Lines 540-543 define `anchorBeatAt(inputTime)`: returns the beat time of an anchor exactly at `inputTime`, or undefined.
- Lines 545-553 derive `beatOffset` from `lr`, `anchorsDragging`, `clipInAnchor`, and `p.beatOffset`.

The model layer extracts the three pure helpers. The `beatOffset` derivation logic — which decides which of `lr` / `anchorsDragging` / `p.beatOffset` to use — stays in CanvasTimeline because it's gesture-aware (controller territory in PR3).

**Files:**
- Create: `src/timeline/model/beatMap.ts`
- Test: `tests/unit/timeline/model/beatMap.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/timeline/model/beatMap.test.ts
import { describe, it, expect } from 'vitest'
import {
  buildAnchorPairs,
  origToBeat,
  anchorBeatAt,
} from '../../../../src/timeline/model/beatMap'
import type { Anchor } from '../../../../src/types'

describe('buildAnchorPairs', () => {
  it('pairs anchors with their beat counterparts by id and sorts by input time', () => {
    const anchors: Anchor[] = [
      { id: 1, time: 30 },
      { id: 2, time: 10 },
      { id: 3, time: 20 },
    ]
    const beatAnchors: Anchor[] = [
      { id: 1, time: 15 },
      { id: 2, time: 5 },
      { id: 3, time: 10 },
    ]
    expect(buildAnchorPairs(anchors, beatAnchors)).toEqual([
      { id: 2, inT: 10, outT: 5 },
      { id: 3, inT: 20, outT: 10 },
      { id: 1, inT: 30, outT: 15 },
    ])
  })

  it('drops anchors without a beat pair', () => {
    const anchors: Anchor[] = [{ id: 1, time: 10 }, { id: 2, time: 20 }]
    const beatAnchors: Anchor[] = [{ id: 2, time: 10 }] // no pair for id 1
    expect(buildAnchorPairs(anchors, beatAnchors)).toEqual([
      { id: 2, inT: 20, outT: 10 },
    ])
  })

  it('returns empty for empty input', () => {
    expect(buildAnchorPairs([], [])).toEqual([])
  })
})

describe('origToBeat', () => {
  const pairs = [
    { id: 1, inT: 10, outT: 5 },
    { id: 2, inT: 20, outT: 12 },
  ]

  it('returns t unchanged when no pairs', () => {
    expect(origToBeat(5, [])).toBe(5)
  })

  it('returns the pair beat at the pair input', () => {
    expect(origToBeat(10, pairs)).toBe(5)
    expect(origToBeat(20, pairs)).toBe(12)
  })

  it('linearly interpolates between consecutive pairs', () => {
    expect(origToBeat(15, pairs)).toBe(8.5) // (5+12)/2
  })

  it('returns t unchanged outside the pair range', () => {
    expect(origToBeat(5, pairs)).toBe(5)
    expect(origToBeat(25, pairs)).toBe(25)
  })

  it('handles degenerate pairs (same input time) without dividing by zero', () => {
    const degen = [
      { id: 1, inT: 10, outT: 5 },
      { id: 2, inT: 10, outT: 6 },
    ]
    expect(origToBeat(10, degen)).toBe(5)
  })
})

describe('anchorBeatAt', () => {
  const anchors: Anchor[] = [{ id: 1, time: 10 }]
  const beatAnchors: Anchor[] = [{ id: 1, time: 5 }]

  it('returns the beat time when an anchor sits exactly on the input time', () => {
    expect(anchorBeatAt(10, anchors, beatAnchors)).toBe(5)
  })

  it('returns undefined when no anchor matches', () => {
    expect(anchorBeatAt(10.5, anchors, beatAnchors)).toBeUndefined()
  })

  it('uses 1e-4 tolerance', () => {
    expect(anchorBeatAt(10.00005, anchors, beatAnchors)).toBe(5)
    expect(anchorBeatAt(10.001, anchors, beatAnchors)).toBeUndefined()
  })

  it('returns undefined when the anchor has no beat pair', () => {
    expect(anchorBeatAt(10, anchors, [])).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/timeline/model/beatMap.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```ts
// src/timeline/model/beatMap.ts
import type { Anchor } from '../../types'

const TOL = 1e-4

export interface AnchorPair {
  id: number
  /** Input-space time. */
  inT: number
  /** Output (beat) time. */
  outT: number
}

/**
 * Pair input-space anchors with beat-space anchors by id, dropping any that
 * don't have a partner. Sorted by input time so the result can be walked
 * linearly for piecewise mapping.
 */
export function buildAnchorPairs(
  anchors: Anchor[],
  beatAnchors: Anchor[],
): AnchorPair[] {
  const beatById = new Map<number, number>()
  for (const b of beatAnchors) beatById.set(b.id, b.time)
  const pairs: AnchorPair[] = []
  for (const a of anchors) {
    const outT = beatById.get(a.id)
    if (outT !== undefined) pairs.push({ id: a.id, inT: a.time, outT })
  }
  pairs.sort((a, b) => a.inT - b.inT)
  return pairs
}

/**
 * Piecewise-linear map from input time to beat time using `pairs`. Returns
 * `t` unchanged outside the covered range (or when there are fewer than
 * two pairs).
 */
export function origToBeat(t: number, pairs: AnchorPair[]): number {
  for (let i = 0; i < pairs.length - 1; i++) {
    const { inT: o0, outT: b0 } = pairs[i]
    const { inT: o1, outT: b1 } = pairs[i + 1]
    if (t >= o0 && t <= o1) {
      const frac = o1 > o0 ? (t - o0) / (o1 - o0) : 0
      return b0 + frac * (b1 - b0)
    }
  }
  return t
}

/**
 * If an input-space anchor sits within tolerance of `inputTime`, return its
 * paired beat time. Otherwise undefined.
 */
export function anchorBeatAt(
  inputTime: number,
  anchors: Anchor[],
  beatAnchors: Anchor[],
): number | undefined {
  const a = anchors.find(a => Math.abs(a.time - inputTime) < TOL)
  if (!a) return undefined
  const b = beatAnchors.find(b => b.id === a.id)
  return b?.time
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/timeline/model/beatMap.test.ts
```

Expected: PASS — all 12 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/timeline/model/beatMap.ts tests/unit/timeline/model/beatMap.test.ts
git commit -m "feat(timeline/model): extract buildAnchorPairs/origToBeat/anchorBeatAt"
```

---

## Task 7: Route CanvasTimeline's inline beatMap helpers through model

**Files:**
- Modify: `src/components/CanvasTimeline.tsx:496-543`

- [ ] **Step 1: Capture baseline**

```bash
npm test
```

Expected: 744/744 PASS.

- [ ] **Step 2: Add import and replace inline helpers**

Add to imports:

```ts
import { buildAnchorPairs, origToBeat, anchorBeatAt } from '../timeline/model/beatMap'
```

Replace the inline pair build (lines 496-505) and the two local closures (lines 526-543) with calls into the model. The block at line 496 becomes:

```ts
    // Anchors paired by id and sorted by input time; everything that
    // connects input ↔ output anchors must iterate these pairs.
    const anchorPairs = buildAnchorPairs(anchors, beatAnchors)

    const anchorsDragging = liveAnchorsIn.current.length > 0 || liveAnchorsOut.current.length > 0
```

Replace `function liveOrigToBeat(t: number): number { ... }` (originally lines 526-538) with a small adapter, since the call sites pass no extra args:

```ts
    function liveOrigToBeat(t: number): number {
      return origToBeat(t, anchorPairs)
    }
```

Replace `function anchorBeatAt(inputTime: number): number | undefined { ... }` (originally lines 540-543) — but this name collides with the imported one. Rename the local to `anchorBeatAtHere` OR delete the local and update call sites to pass anchors/beatAnchors. Prefer the latter:

Delete the local `anchorBeatAt` declaration entirely. Find the 4 call sites (search the file for `anchorBeatAt(`) and update each to:

```ts
anchorBeatAt(<original arg>, anchors, beatAnchors)
```

Locations to update (search to confirm):
- Line ~536 (clipIn beat-offset derivation, inside `lr` branch)
- Lines ~562, ~564 (inside `clipoutFor` — but that function is already routed through `conformClipoutToAnchors` in Task 5, so this should already be gone)

Confirm by running `grep -n "anchorBeatAt" src/components/CanvasTimeline.tsx` — if any local definitions or unparameterized calls remain, fix them.

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: 744/744 PASS.

- [ ] **Step 4: Smoke-test in the app**

```bash
npm run tauri dev
```

In the app: drag an anchor — the warp connector should still show the live piecewise mapping. Drag an anchor that sits on a clip in-edge — clipout should still conform to the live anchor beat. Close the dev session.

- [ ] **Step 5: Commit**

```bash
git add src/components/CanvasTimeline.tsx
git commit -m "refactor(CanvasTimeline): route inline beatMap helpers through model"
```

---

## Task 8: Extract `snapTarget` (context-aware target builders)

The existing target-building logic in CanvasTimeline:

- **Anchor drag input space** — scenes + every region's inPoint and outPoint. Search for `if (drag.space === 'input')` inside `handleMouseMove` (~line 1572).
- **Anchor drag output space** — BPM grid clamped to smallest-visible-tick. Same handler around ~line 1582.
- **Region drag** — `clipSnapTargets(isOutput, excludeId)` closure (~line 1613): anchors (matching space) + scenes (input only) + other clips' edges + grid (output only).

The pure rule: given the snapshot data, return `SnapTarget[]` (and optional `SnapGrid`) that `computeSnap()` accepts. The smallest-visible-tick math lives in `CanvasTimeline.tsx` already (`smallestVisibleBeatGridSec`, ~line 279) and is pure — it moves into model too.

**Files:**
- Create: `src/timeline/model/snapTarget.ts`
- Test: `tests/unit/timeline/model/snapTarget.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/timeline/model/snapTarget.test.ts
import { describe, it, expect } from 'vitest'
import {
  anchorDragInputTargets,
  anchorDragOutputGrid,
  regionDragTargets,
  smallestVisibleBeatGridSec,
} from '../../../../src/timeline/model/snapTarget'
import type { Anchor } from '../../../../src/types'

describe('anchorDragInputTargets', () => {
  it('returns scene times and region edges as targets', () => {
    const targets = anchorDragInputTargets(
      [12, 18],
      [{ inPoint: 10, outPoint: 20 } as any, { inPoint: 30, outPoint: 40 } as any],
    )
    expect(targets).toEqual([
      { time: 12, source: 'scene' },
      { time: 18, source: 'scene' },
      { time: 10, source: 'scene' },
      { time: 20, source: 'scene' },
      { time: 30, source: 'scene' },
      { time: 40, source: 'scene' },
    ])
  })

  it('returns empty when no scenes and no regions', () => {
    expect(anchorDragInputTargets([], [])).toEqual([])
  })
})

describe('anchorDragOutputGrid', () => {
  it('returns null when snapInterval is 0 or unset', () => {
    expect(anchorDragOutputGrid(undefined, 0, 120, 800, 60)).toBeNull()
    expect(anchorDragOutputGrid(0.5, 0, 120, 800, 0)).toBeNull()
  })

  it('returns a grid clamped to smallest-visible-tick spacing', () => {
    // bpm 60 → beat = 1s. View span 100s in 800px → pps = 8, ppb = 8.
    // Smallest visible beat grid at this zoom is `bpb * beatSec` because
    // ppbar=32 < TARGET_PX (60), so barGroup grows: 32 → 64 (ok), so
    // result = barGroup(2)*subBarGroup(1)*bpb(4)*beatSec(1) = 8s.
    const grid = anchorDragOutputGrid(0.5, 0, 100, 800, 60)
    expect(grid).not.toBeNull()
    expect(grid!.interval).toBeGreaterThanOrEqual(0.5)
  })
})

describe('regionDragTargets', () => {
  const anchors: Anchor[] = [{ id: 1, time: 5 }]
  const beatAnchors: Anchor[] = [{ id: 1, time: 2.5 }]
  const regions = [
    { id: 'a', inPoint: 10, outPoint: 20 },
    { id: 'b', inPoint: 30, outPoint: 40 },
  ] as any[]

  it('input space includes anchors + scenes + other regions edges; excludes self', () => {
    const { targets, grid } = regionDragTargets({
      isOutput: false,
      anchors, beatAnchors,
      scenes: [50],
      regions, excludeId: 'a',
      viewSpan: 100, canvasWidth: 800, bpm: 60,
      snapInterval: 0.5, snapOffset: 0,
    })
    expect(targets).toEqual([
      { time: 5, source: 'anchor' },
      { time: 50, source: 'scene' },
      { time: 30, source: 'scene' },
      { time: 40, source: 'scene' },
    ])
    expect(grid).toBeUndefined()
  })

  it('output space uses beat anchors + other regions; excludes scenes; sets grid', () => {
    const { targets, grid } = regionDragTargets({
      isOutput: true,
      anchors, beatAnchors,
      scenes: [50],
      regions, excludeId: 'a',
      viewSpan: 100, canvasWidth: 800, bpm: 60,
      snapInterval: 0.5, snapOffset: 0,
    })
    expect(targets).toEqual([
      { time: 2.5, source: 'anchor' },
      { time: 30, source: 'scene' },
      { time: 40, source: 'scene' },
    ])
    expect(grid).not.toBeUndefined()
  })
})

describe('smallestVisibleBeatGridSec', () => {
  it('returns Infinity for invalid inputs', () => {
    expect(smallestVisibleBeatGridSec(0, 800, 60)).toBe(Number.POSITIVE_INFINITY)
    expect(smallestVisibleBeatGridSec(100, 0, 60)).toBe(Number.POSITIVE_INFINITY)
    expect(smallestVisibleBeatGridSec(100, 800, 0)).toBe(Number.POSITIVE_INFINITY)
  })

  it('returns sub-beat spacing at high zoom (large ppb)', () => {
    // bpm 60, span 10s in 1000px → pps 100, ppb 100. ppbar=400 (single bar group=1),
    // ppb/4=25 >= 6 → returns 0.25 * beatSec = 0.25
    expect(smallestVisibleBeatGridSec(10, 1000, 60)).toBeCloseTo(0.25)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/timeline/model/snapTarget.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

Copy the existing `smallestVisibleBeatGridSec` from `src/components/CanvasTimeline.tsx` (lines 279-299) into the new file. The TARGET_PX constant (60) is shared with `timeLayers` / `barsLayers`; redefine locally for now (PR3 consolidates it into a shared constants file).

```ts
// src/timeline/model/snapTarget.ts
import type { SnapTarget, SnapGrid } from '../../utils/snap'
import type { Anchor } from '../../types'

const TARGET_PX = 60

/**
 * Smallest grid spacing (seconds) currently drawn by the beat ruler at this
 * zoom. The output-space snap interval is clamped to be no finer than this
 * so we never snap to ticks the user can't see.
 */
export function smallestVisibleBeatGridSec(
  viewSpanSec: number,
  canvasW: number,
  bpm: number,
): number {
  if (bpm <= 0 || canvasW <= 0 || viewSpanSec <= 0) return Number.POSITIVE_INFINITY
  const beatSec = 60 / bpm
  const pps = canvasW / viewSpanSec
  const ppb = pps * beatSec
  const bpb = 4
  const ppbar = ppb * bpb
  let barGroup = 1
  while (ppbar * barGroup < TARGET_PX) barGroup *= 2
  if (barGroup > 4096) barGroup = 4096
  if (barGroup > 1) {
    const subBarGroup = barGroup >= 8 ? barGroup / 8 : 1
    return subBarGroup * bpb * beatSec
  }
  if (ppb / 4 >= 6) return 0.25 * beatSec
  if (ppb / 2 >= 9) return 0.5 * beatSec
  if (ppb >= 22) return 1 * beatSec
  return bpb * beatSec
}

/**
 * Snap targets for dragging an anchor in input space: every scene cut plus
 * every region's in and out point.
 */
export function anchorDragInputTargets(
  scenes: number[],
  regions: ReadonlyArray<{ inPoint: number; outPoint: number }>,
): SnapTarget[] {
  const targets: SnapTarget[] = []
  for (const t of scenes) targets.push({ time: t, source: 'scene' })
  for (const r of regions) {
    targets.push({ time: r.inPoint, source: 'scene' })
    targets.push({ time: r.outPoint, source: 'scene' })
  }
  return targets
}

/**
 * Snap grid for dragging an anchor in output (beat) space. Returns null when
 * no grid is configured. The interval is clamped so it's never finer than
 * the smallest tick spacing currently visible at the given zoom.
 */
export function anchorDragOutputGrid(
  snapInterval: number | undefined,
  snapOffset: number,
  viewSpanSec: number,
  canvasWidth: number,
  bpm: number,
): SnapGrid | null {
  if (!snapInterval || snapInterval <= 0) return null
  const minVisible = smallestVisibleBeatGridSec(viewSpanSec, canvasWidth, bpm)
  return { interval: Math.max(snapInterval, minVisible), offset: snapOffset }
}

export interface RegionDragTargetParams {
  isOutput: boolean
  anchors: Anchor[]
  beatAnchors: Anchor[]
  scenes: number[]
  /** Regions other than the one being dragged. May include the dragged one — it'll be excluded by id. */
  regions: ReadonlyArray<{ id: string; inPoint: number; outPoint: number }>
  excludeId: string
  viewSpan: number
  canvasWidth: number
  bpm: number
  snapInterval?: number
  snapOffset?: number
}

/**
 * Snap targets and optional grid for region drags. Input space: anchors +
 * scenes + other regions' edges. Output space: beat anchors + other regions'
 * edges + grid; no scenes.
 */
export function regionDragTargets(p: RegionDragTargetParams): {
  targets: SnapTarget[]
  grid?: SnapGrid
} {
  const targets: SnapTarget[] = []
  const anchorList = p.isOutput ? p.beatAnchors : p.anchors
  for (const a of anchorList) targets.push({ time: a.time, source: 'anchor' })
  if (!p.isOutput) for (const t of p.scenes) targets.push({ time: t, source: 'scene' })
  for (const r of p.regions) {
    if (r.id === p.excludeId) continue
    targets.push({ time: r.inPoint, source: 'scene' })
    targets.push({ time: r.outPoint, source: 'scene' })
  }
  let grid: SnapGrid | undefined
  if (p.isOutput && p.snapInterval && p.snapInterval > 0) {
    const minVisible = smallestVisibleBeatGridSec(p.viewSpan, p.canvasWidth, p.bpm)
    grid = { interval: Math.max(p.snapInterval, minVisible), offset: p.snapOffset ?? 0 }
  }
  return { targets, grid }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/timeline/model/snapTarget.test.ts
```

Expected: PASS — all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/timeline/model/snapTarget.ts tests/unit/timeline/model/snapTarget.test.ts
git commit -m "feat(timeline/model): extract context-aware snap target builders"
```

---

## Task 9: Route CanvasTimeline's snap-target building through model

CanvasTimeline currently builds snap targets inline inside `handleMouseMove` (around lines 1572-1610) and has a local `smallestVisibleBeatGridSec` (lines 279-299) and `clipSnapTargets` closure (~lines 1613-1631).

**Files:**
- Modify: `src/components/CanvasTimeline.tsx`

- [ ] **Step 1: Capture baseline**

```bash
npm test
```

Expected: 744/744 PASS.

- [ ] **Step 2: Add imports and replace inline targets**

Add to imports:

```ts
import {
  anchorDragInputTargets, anchorDragOutputGrid,
  regionDragTargets, smallestVisibleBeatGridSec,
} from '../timeline/model/snapTarget'
```

Delete the local `smallestVisibleBeatGridSec` definition (lines 279-299).

Find the anchor-drag input-space target building inside `handleMouseMove` (the block `if (drag.space === 'input') { for (const t of p.scenes) ... }`). Replace with:

```ts
      let targets: { time: number; source: 'scene' | 'anchor' }[] = []
      let grid: { interval: number; offset: number } | undefined
      if (drag.space === 'input') {
        targets = anchorDragInputTargets(p.scenes, p.regions) as typeof targets
      } else {
        const g = anchorDragOutputGrid(p.snapInterval, p.snapOffset ?? 0, p.view.end - p.view.start, canvasW, p.bpm)
        if (g) grid = { interval: g.interval, offset: g.offset ?? 0 }
      }
```

Find the `clipSnapTargets` local closure (the one used by region-edge and region-move drag handlers). Replace its body with a call to `regionDragTargets`:

```ts
    function clipSnapTargets(isOutput: boolean, excludeId: string): { targets: { time: number; source: 'scene' | 'anchor' }[]; grid?: { interval: number; offset: number } } {
      const canvasW = canvasRef.current?.getBoundingClientRect().width ?? 1
      const { targets, grid } = regionDragTargets({
        isOutput,
        anchors: p.anchors,
        beatAnchors: p.beatAnchors,
        scenes: p.scenes,
        regions: isOutput ? (p.regionsOutput ?? p.regions) : p.regions,
        excludeId,
        viewSpan: p.view.end - p.view.start,
        canvasWidth: canvasW,
        bpm: p.bpm,
        snapInterval: p.snapInterval,
        snapOffset: p.snapOffset ?? 0,
      })
      return { targets: targets as { time: number; source: 'scene' | 'anchor' }[], grid: grid ? { interval: grid.interval, offset: grid.offset ?? 0 } : undefined }
    }
```

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: 744/744 PASS.

- [ ] **Step 4: Smoke-test in the app**

```bash
npm run tauri dev
```

In the app: drag an anchor in input space toward a scene cut — should snap. Drag in output space with grid enabled — should snap to BPM grid. Drag a clip edge — should snap to anchors / scenes / other clips. Close the dev session.

- [ ] **Step 5: Commit**

```bash
git add src/components/CanvasTimeline.tsx
git commit -m "refactor(CanvasTimeline): route snap target building through model"
```

---

## Task 10: Move `newRegionBounds` helpers from `utils/view.ts` to `model/`

The existing `calcNewRegionBounds`, `calcNewRegionBoundsUpToNext`, `calcNewRegionBoundsFromScenes`, `calcNewRegionSpan`, and `findSurroundingScenes` all live in `src/utils/view.ts`. They're already pure and tested via `tests/bdd/regionCreation.test.ts`. Move them into `src/timeline/model/newRegionBounds.ts` and re-export from the old location so callers don't break in this PR.

**Files:**
- Create: `src/timeline/model/newRegionBounds.ts`
- Modify: `src/utils/view.ts` (re-export only)
- No new tests — covered by existing BDD scenarios.

- [ ] **Step 1: Create the new file by extracting from utils/view.ts**

Copy these functions verbatim from `src/utils/view.ts` (lines 43-166):
- `calcNewRegionSpan`
- `calcNewRegionBounds`
- `findSurroundingScenes`
- `calcNewRegionBoundsUpToNext`
- `calcNewRegionBoundsFromScenes`

Also copy the `MIN_VISIBLE` constant (line 3) since it's used by `calcNewRegionBoundsFromScenes`. Keep `MIN_VISIBLE` exported from `utils/view.ts` as well — it's used elsewhere.

Create `src/timeline/model/newRegionBounds.ts` with those function definitions and the import of `View` from `../../types` and `MIN_VISIBLE` from `../../utils/view`.

Concrete file body:

```ts
// src/timeline/model/newRegionBounds.ts
import type { View } from '../../types'
import { MIN_VISIBLE } from '../../utils/view'

/**
 * Compute the span for a newly created region: smaller of 10% of viewport or 5s
 * minimum (whichever is larger).
 */
export function calcNewRegionSpan(viewSpan: number): number {
  return Math.max(viewSpan * 0.1, 5)
}

/** Compute inPoint/outPoint for a region aligned on `cursor`, clamped to [0, duration]. */
export function calcNewRegionBounds(
  cursor: number,
  viewSpan: number,
  videoDuration: number,
): { inPoint: number; outPoint: number } {
  const span = calcNewRegionSpan(viewSpan)
  return {
    inPoint: Math.max(0, cursor),
    outPoint: Math.min(videoDuration, cursor + span),
  }
}

export function findSurroundingScenes(
  cursor: number,
  cuts: number[],
  videoDuration: number,
): { prev: number; next: number } | null {
  if (videoDuration <= 0) return null
  const sorted = [...cuts].filter(c => c > 0 && c < videoDuration).sort((a, b) => a - b)
  const boundaries = [0, ...sorted, videoDuration]
  for (let i = 0; i < boundaries.length - 1; i++) {
    const lo = boundaries[i], hi = boundaries[i + 1]
    if (cursor >= lo && cursor <= hi && hi > lo) {
      return { prev: lo, next: hi }
    }
  }
  return null
}

export function calcNewRegionBoundsUpToNext(
  playhead: number,
  viewSpan: number,
  regions: { inPoint: number }[],
  videoDuration: number,
): { inPoint: number; outPoint: number } {
  const span = calcNewRegionSpan(viewSpan)
  const nextStart = regions
    .map(r => r.inPoint)
    .filter(t => t > playhead)
    .reduce((m, t) => Math.min(m, t), videoDuration)
  const inPoint = Math.max(0, playhead)
  const outPoint = Math.min(nextStart, videoDuration, inPoint + span)
  return { inPoint, outPoint }
}

export function calcNewRegionBoundsFromScenes(
  cursor: number,
  view: View,
  cuts: number[],
  videoDuration: number,
  regions: { inPoint: number; outPoint: number }[] = [],
): { inPoint: number; outPoint: number } {
  const viewSpan = view.end - view.start

  const insideRegion = regions.find(r => cursor >= r.inPoint && cursor < r.outPoint)
  const c = insideRegion ? insideRegion.outPoint : cursor

  if (cuts.length === 0 && regions.length === 0) {
    return calcNewRegionBounds(c, viewSpan, videoDuration)
  }

  const prevCandidates: number[] = [view.start]
  for (const t of cuts) if (t >= view.start && t < c) prevCandidates.push(t)
  for (const r of regions) if (r.outPoint <= c) prevCandidates.push(r.outPoint)
  const inPoint = Math.max(0, ...prevCandidates)

  const nextCandidates: number[] = [view.end]
  for (const t of cuts) if (t > c && t <= view.end) nextCandidates.push(t)
  for (const r of regions) if (r.inPoint > c) nextCandidates.push(r.inPoint)
  const outPoint = Math.min(videoDuration, ...nextCandidates)

  if (outPoint - inPoint < MIN_VISIBLE) {
    return calcNewRegionBounds(c, viewSpan, videoDuration)
  }

  return { inPoint, outPoint }
}
```

- [ ] **Step 2: Replace the old definitions in `utils/view.ts` with re-exports**

In `src/utils/view.ts`, delete the function bodies for the five functions (and the JSDoc above each) and replace with a re-export at the bottom of the file (or keep them at the same line positions for git diff clarity — your call). The re-export form:

```ts
// src/utils/view.ts
// ... clampView, timeToViewPct, beatGridOpacity, initialView, scrollViewToTime, viewFitsRegion, calcZoomToRegion stay here ...

export {
  calcNewRegionSpan,
  calcNewRegionBounds,
  findSurroundingScenes,
  calcNewRegionBoundsUpToNext,
  calcNewRegionBoundsFromScenes,
} from '../timeline/model/newRegionBounds'
```

Keep `MIN_VISIBLE` defined here (it's exported and used in places beyond region bounds).

- [ ] **Step 3: Run existing tests**

```bash
npm test
```

Expected: 744/744 PASS. The re-export keeps all existing call sites working.

- [ ] **Step 4: Commit**

```bash
git add src/timeline/model/newRegionBounds.ts src/utils/view.ts
git commit -m "refactor(timeline/model): move newRegionBounds helpers into model/"
```

---

## Task 11: Update region-creation callers to import from model directly

Find every importer of the five moved functions and update the import path to `src/timeline/model/newRegionBounds`. This is purely a stylistic cleanup — the re-export from `utils/view.ts` keeps things working, but direct imports are clearer.

**Files:**
- Modify: every TS file importing `calcNewRegionBounds*` or `findSurroundingScenes` or `calcNewRegionSpan` from `utils/view`.

- [ ] **Step 1: Find the importers**

```bash
grep -rn "from '.*utils/view'" src tests | grep -E "calcNewRegionBounds|calcNewRegionSpan|findSurroundingScenes"
```

Then run a second search for partial imports (the function names alone might appear in import destructurings whose source path is on the previous line):

```bash
grep -rn "calcNewRegionBounds\|calcNewRegionSpan\|findSurroundingScenes" src tests
```

List the files found. Probably: `src/store/thunks/regionThunks.ts`, `src/components/Toolbar.tsx`, `src/components/WarpView.tsx`, `tests/bdd/regionCreation.test.ts`, `tests/unit/utils/view.test.ts`. Confirm by running the commands.

- [ ] **Step 2: Update each importer**

For each file, change:

```ts
import { calcNewRegionBounds, findSurroundingScenes } from '../utils/view'
```

To:

```ts
import { calcNewRegionBounds, findSurroundingScenes } from '../timeline/model/newRegionBounds'
```

Adjust relative path depth per file (`../`/`../../` etc.). Keep other unrelated imports from `utils/view` (e.g., `clampView`, `scrollViewToTime`) in their existing import statement.

For `tests/unit/utils/view.test.ts`: this test file specifically tests these functions. Rename it to `tests/unit/timeline/model/newRegionBounds.test.ts` and update its imports. Use `git mv` to preserve history:

```bash
git mv tests/unit/utils/view.test.ts tests/unit/timeline/model/newRegionBounds.test.ts
```

Update its imports to `../../../../src/timeline/model/newRegionBounds`. If the file imports other things from `utils/view` (e.g., `clampView`), leave a thin `tests/unit/utils/view.test.ts` covering just those, or move the kept-in-utils tests into a new file. Decide based on what's actually in the file.

- [ ] **Step 3: Remove the re-export shim**

In `src/utils/view.ts`, delete the `export { ... } from '../timeline/model/newRegionBounds'` block. All callers should now import directly.

- [ ] **Step 4: Run the full test suite**

```bash
npm test
```

Expected: 744/744 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/view.ts src/components/Toolbar.tsx src/components/WarpView.tsx src/store/thunks/regionThunks.ts tests/bdd/regionCreation.test.ts tests/unit/timeline/model/newRegionBounds.test.ts
git commit -m "refactor(callers): import newRegionBounds helpers from timeline/model"
```

(Adjust the `git add` list to match the files you actually modified.)

---

## Task 12: Add a README to `src/timeline/model/` documenting the layer's contract

A two-paragraph README so the next contributor knows what belongs here and what doesn't.

**Files:**
- Create: `src/timeline/model/README.md`

- [ ] **Step 1: Write the README**

```markdown
# Timeline model layer

Pure, time-domain rules that the timeline depends on. No React. No Redux.
No DOM. No mutable module state. Functions in this directory take plain
data and return plain data.

Each rule is called from two places: the live-drag path (controller / canvas)
and the discrete-event path (Redux slices, thunks). Defining the rule here
once prevents the two paths from drifting apart.

Add a file here when you find a behavior that needs to fire both live
during a gesture and again on a discrete commit. Do NOT add anything here
that depends on canvas geometry, the gesture singleton, or React state —
that's the controller's job.

## Files

- `conform.ts` — clipout edges follow anchors that sit exactly on the
  region's input edges.
- `clampRegion.ts` — region in/out reconciliation: minimum length, swap
  shifting, boundary preservation.
- `snapTarget.ts` — context-aware snap target builders (anchor input,
  anchor output grid, region drag in either space) plus
  `smallestVisibleBeatGridSec` so output grids never snap to invisible ticks.
- `beatMap.ts` — anchor-pair list, piecewise input→beat mapping,
  `anchorBeatAt` exact-match lookup.
- `newRegionBounds.ts` — viewport-aware region creation rules (10%/5s
  span, scene/region neighbor clamping, "set out before in" fallback).
```

- [ ] **Step 2: Commit**

```bash
git add src/timeline/model/README.md
git commit -m "docs(timeline/model): describe the layer contract"
```

---

## Task 13: Verify the whole PR

- [ ] **Step 1: Full test run**

```bash
npm test
```

Expected: 744/744 PASS (same baseline; no test count regression).

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run the behaviors check**

```bash
npm run behaviors
```

Expected: no unimplemented / changed behavior warnings (PR1 doesn't change behavior).

- [ ] **Step 4: Diff sanity check**

```bash
git log --oneline worktree-gesture-store-extension..HEAD
git diff --stat worktree-gesture-store-extension..HEAD
```

Expected: ~12 commits (one per task plus task 1), and the file changes you expect — new files under `src/timeline/model/` and `tests/unit/timeline/model/`, plus modifications to `regionSlice.ts`, `CanvasTimeline.tsx`, `utils/view.ts`, and the import-update files.

- [ ] **Step 5: Smoke-test the app one more time**

```bash
npm run tauri dev
```

Run through: load video → place anchors → drag anchors (input + output space) → create region → drag region edges → drag whole region → place anchor exactly on region's in edge → drag the anchor (verify clipout conforms live) → undo / redo a region resize.

Close dev. PR1 is ready to merge.

---

## Self-review notes

Spec coverage check: PR1 corresponds to "Migration order PR1" in the spec. The five model files match the five rules listed in the spec under "Rules being moved into model/". ✓

Type consistency: `clampRegionInOut` accepts/returns `{ inPoint, outPoint }`. `conformClipoutToAnchors` returns `{ inPoint, outPoint }`. `anchorDragInputTargets` returns `SnapTarget[]` from `src/utils/snap`. All consistent.

Placeholder scan: no TBDs, no "implement later" — every step has runnable code or commands. ✓

Out-of-scope reminder for the executing engineer: do NOT add controller scaffolding, feature file moves, or new feature files in this PR — those are PR2 and PR3.
