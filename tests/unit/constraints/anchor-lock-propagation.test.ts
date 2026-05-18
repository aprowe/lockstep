/**
 * Phase 4c — anchor-lock constraint propagation tests.
 *
 * Verifies that:
 *  1. A clipout pan (commitClipoutPan) propagates to inner anchors via
 *     the directed TranslateGroup tagged lock:{clipOutId}.
 *  2. A clipout resize (commitClipoutResize) propagates rescaled anchor
 *     positions via the directed ScaleGroup tagged lock:{clipOutId}.
 *
 * In Phase 4c, we dispatch via production thunks and read from the slice.
 */

import { describe, it, expect } from 'vitest'
import warpReducer, { addAnchor } from '../../../src/store/slices/warpSlice'
import uiReducer, { setAnchorLock, setLockMode } from '../../../src/store/slices/uiSlice'
import regionReducer, { addRegion, setActiveRegionId } from '../../../src/store/slices/regionSlice'
import dragCtxReducer from '../../../src/store/slices/dragCtxSlice'
import dragReducer from '../../../src/store/slices/dragSlice'
import listsReducer from '../../../src/store/slices/listsSlice'
import { applyUpdateRegionBeatTimes } from '../../../src/store/thunks/entityWriteThunks'
import { commitClipoutPan, commitClipoutResize } from '../../../src/store/thunks/clipoutThunks'
import { configureStore, type EnhancedStore } from '@reduxjs/toolkit'
import { anchorLockMirrorMiddleware } from '../../../src/store/middleware/anchorLockMirrorMiddleware'
import { selectionGraphMirrorMiddleware } from '../../../src/store/middleware/selectionGraphMirrorMiddleware'
import type { Region } from '../../../src/types'

// Store with all middleware needed for anchor-lock tests
function makeTestStore(): EnhancedStore {
  return configureStore({
    reducer: {
      warp: warpReducer,
      ui: uiReducer,
      region: regionReducer,
      lists: listsReducer,
      dragCtx: dragCtxReducer,
      drag: dragReducer,
    },
    middleware: (getDefault) =>
      getDefault()
        .concat(selectionGraphMirrorMiddleware)
        .concat(anchorLockMirrorMiddleware),
  })
}

function getBeatAnchorTime(store: EnhancedStore, anchorId: number): number {
  const warp = (store.getState() as { warp: { beatAnchors: Array<{ id: number; time: number }> } }).warp
  const a = warp.beatAnchors.find(a => a.id === anchorId)
  if (!a) throw new Error(`beat anchor ${anchorId} not found`)
  return a.time
}

function getClipoutBounds(store: EnhancedStore, regionId: string): { in: number; out: number } {
  const region = (store.getState() as { region: { regions: Region[] } }).region.regions.find(r => r.id === regionId)
  if (!region) throw new Error(`${regionId} not found`)
  return { in: region.inBeatTime, out: region.outBeatTime }
}

const REGION_BASE = {
  name: 'Test',
  bpm: 120,
  minStretch: 0.5,
  maxStretch: 2.0,
  addToEnd: false as const,
  inBeatTime: 0,
  outBeatTime: 20,
  defaultLinked: true,
}

describe('Phase 3 — anchor-lock constraint propagation', () => {

  // ── Pan: TranslateGroup carries inner anchors ─────────────────────────────

  it('Move on clipout (pan) translates all 3 inner anchors by the same delta', () => {
    const store = makeTestStore()

    // Region with beat bounds [0, 20]
    store.dispatch(setLockMode('beats'))
    store.dispatch(addRegion({
      id: 'r1', ...REGION_BASE, inPoint: 0, outPoint: 20,
    }))
    // Set explicit beat bounds so the clipout is at [0, 20] and defaultLinked=false
    store.dispatch(applyUpdateRegionBeatTimes({ id: 'r1', inBeatTime: 0, outBeatTime: 20 }))

    // Three inner anchors at 5, 10, 15 — strictly inside [0, 20]
    store.dispatch(addAnchor({ id: 1, time: 5 }))
    store.dispatch(addAnchor({ id: 2, time: 10 }))
    store.dispatch(addAnchor({ id: 3, time: 15 }))
    store.dispatch(setActiveRegionId('r1'))
    store.dispatch(setAnchorLock(true))

    // Pan clipout by +5 (both edges shift by delta)
    store.dispatch(commitClipoutPan({ id: 'r1', delta: 5, altKey: false }))

    // Clipout moved to [5, 25]
    expect(getClipoutBounds(store, 'r1').in).toBeCloseTo(5)
    expect(getClipoutBounds(store, 'r1').out).toBeCloseTo(25)

    // All inner anchors translated by +5
    expect(getBeatAnchorTime(store, 1)).toBeCloseTo(10)
    expect(getBeatAnchorTime(store, 2)).toBeCloseTo(15)
    expect(getBeatAnchorTime(store, 3)).toBeCloseTo(20)
  })

  it('Move on clipout does NOT move outer (non-inner) anchors', () => {
    const store = makeTestStore()

    store.dispatch(setLockMode('beats'))
    store.dispatch(addRegion({
      id: 'r1', ...REGION_BASE, inPoint: 0, outPoint: 10, outBeatTime: 10,
    }))
    store.dispatch(applyUpdateRegionBeatTimes({ id: 'r1', inBeatTime: 0, outBeatTime: 10 }))

    // Inner anchor at 5
    store.dispatch(addAnchor({ id: 1, time: 5 }))
    // Outer anchor at 15 (outside [0, 10])
    store.dispatch(addAnchor({ id: 2, time: 15 }))
    store.dispatch(setActiveRegionId('r1'))
    store.dispatch(setAnchorLock(true))

    store.dispatch(commitClipoutPan({ id: 'r1', delta: 3, altKey: false }))

    expect(getBeatAnchorTime(store, 1)).toBeCloseTo(8)   // moved: 5 + 3
    expect(getBeatAnchorTime(store, 2)).toBeCloseTo(15)  // not moved
  })

  // ── Resize: ScaleGroup rescales inner anchors ─────────────────────────────

  it('SetEdge out on clipout (resize) rescales 3 inner anchors proportionally', () => {
    const store = makeTestStore()

    // Region with beat bounds [0, 20]
    store.dispatch(setLockMode('beats'))
    store.dispatch(addRegion({
      id: 'r1', ...REGION_BASE, inPoint: 0, outPoint: 20,
    }))
    store.dispatch(applyUpdateRegionBeatTimes({ id: 'r1', inBeatTime: 0, outBeatTime: 20 }))

    // Three inner anchors at 5, 10, 15 — at 1/4, 1/2, 3/4 positions
    store.dispatch(addAnchor({ id: 1, time: 5 }))
    store.dispatch(addAnchor({ id: 2, time: 10 }))
    store.dispatch(addAnchor({ id: 3, time: 15 }))
    store.dispatch(setActiveRegionId('r1'))
    store.dispatch(setAnchorLock(true))

    // Resize: move out edge from 20 → 40 (double length), pivot at in=0
    store.dispatch(commitClipoutResize({ id: 'r1', inBeatTime: 0, outBeatTime: 40, altKey: false }))

    // Clipout is now [0, 40]
    expect(getClipoutBounds(store, 'r1').in).toBeCloseTo(0)
    expect(getClipoutBounds(store, 'r1').out).toBeCloseTo(40)

    // Inner anchors rescaled from pivot=0 by factor 2 (40/20)
    // a1: 0 + (5 - 0) * 2 = 10
    // a2: 0 + (10 - 0) * 2 = 20
    // a3: 0 + (15 - 0) * 2 = 30
    expect(getBeatAnchorTime(store, 1)).toBeCloseTo(10)
    expect(getBeatAnchorTime(store, 2)).toBeCloseTo(20)
    expect(getBeatAnchorTime(store, 3)).toBeCloseTo(30)
  })

  it('SetEdge in on clipout (resize from left) rescales anchors around out pivot', () => {
    const store = makeTestStore()

    // Region with beat bounds [0, 20]
    store.dispatch(setLockMode('beats'))
    store.dispatch(addRegion({
      id: 'r1', ...REGION_BASE, inPoint: 0, outPoint: 20,
    }))
    store.dispatch(applyUpdateRegionBeatTimes({ id: 'r1', inBeatTime: 0, outBeatTime: 20 }))

    // Inner anchor at 10 (middle)
    store.dispatch(addAnchor({ id: 1, time: 10 }))
    store.dispatch(setActiveRegionId('r1'))
    store.dispatch(setAnchorLock(true))

    // Resize: move in edge from 0 → 10 (halve length from left), pivot at out=20
    store.dispatch(commitClipoutResize({ id: 'r1', inBeatTime: 10, outBeatTime: 20, altKey: false }))

    // Clipout is now [10, 20], oldLength=20, newLength=10, pivot=20
    // a1: 20 + (10 - 20) * (10/20) = 20 + (-10 * 0.5) = 15
    expect(getBeatAnchorTime(store, 1)).toBeCloseTo(15)
  })

  // ── bpm mode: no rescale on resize ───────────────────────────────────────

  it('lock=bpm: SetEdge on clipout does NOT rescale inner anchors (no ScaleGroup)', () => {
    const store = makeTestStore()

    store.dispatch(setLockMode('bpm'))
    store.dispatch(addRegion({
      id: 'r1', ...REGION_BASE, inPoint: 0, outPoint: 20,
    }))
    store.dispatch(applyUpdateRegionBeatTimes({ id: 'r1', inBeatTime: 0, outBeatTime: 20 }))

    store.dispatch(addAnchor({ id: 1, time: 10 }))
    store.dispatch(setActiveRegionId('r1'))
    store.dispatch(setAnchorLock(true))

    // Resize — in bpm mode there is no ScaleGroup, so anchor stays put
    store.dispatch(commitClipoutResize({ id: 'r1', inBeatTime: 0, outBeatTime: 40, altKey: false }))

    // Anchor should NOT have been rescaled
    expect(getBeatAnchorTime(store, 1)).toBeCloseTo(10)
  })

  // ── anchorLock=false: no propagation at all ───────────────────────────────

  it('anchorLock=false: Move on clipout does NOT translate inner anchors', () => {
    const store = makeTestStore()

    store.dispatch(setLockMode('beats'))
    store.dispatch(addRegion({
      id: 'r1', ...REGION_BASE, inPoint: 0, outPoint: 20,
    }))
    store.dispatch(applyUpdateRegionBeatTimes({ id: 'r1', inBeatTime: 0, outBeatTime: 20 }))
    store.dispatch(addAnchor({ id: 1, time: 10 }))
    store.dispatch(setActiveRegionId('r1'))
    // anchorLock stays false (default)

    store.dispatch(commitClipoutPan({ id: 'r1', delta: 5, altKey: false }))

    // Inner anchor should NOT have moved
    expect(getBeatAnchorTime(store, 1)).toBeCloseTo(10)
  })
})
