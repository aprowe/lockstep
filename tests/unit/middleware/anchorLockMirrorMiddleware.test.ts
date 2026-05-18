/**
 * anchorLockMirrorMiddleware — unit tests (Phase 4c).
 *
 * Verifies that ui.anchorLock + active region lock mode are mirrored into
 * dragCtxSlice.anchorLock. The constraint pipeline reads dragCtxSlice.anchorLock
 * to build the TranslateGroup / ScaleGroup lock constraints inside buildGraphFromSlice.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { configureStore, type EnhancedStore } from '@reduxjs/toolkit'
import warpReducer, {
  addAnchor,
  loadAnchors,
} from '../../../src/store/slices/warpSlice'
import uiReducer, { setAnchorLock, setAnchorLockGestureOverride, setLockMode } from '../../../src/store/slices/uiSlice'
import regionReducer, {
  addRegion,
  setActiveRegionId,
} from '../../../src/store/slices/regionSlice'
import dragCtxReducer from '../../../src/store/slices/dragCtxSlice'
import { anchorLockMirrorMiddleware } from '../../../src/store/middleware/anchorLockMirrorMiddleware'
import type { DragCtxSliceState } from '../../../src/store/slices/dragCtxSlice'

// ── Store factory ─────────────────────────────────────────────────────────────

function makeStore(): EnhancedStore {
  return configureStore({
    reducer: {
      warp: warpReducer,
      ui: uiReducer,
      region: regionReducer,
      dragCtx: dragCtxReducer,
    },
    middleware: (getDefault) =>
      getDefault()
        .concat(anchorLockMirrorMiddleware),
  })
}

// ── Query helpers ─────────────────────────────────────────────────────────────

function getAnchorLock(store: EnhancedStore): DragCtxSliceState['anchorLock'] {
  const state = store.getState() as { dragCtx: DragCtxSliceState }
  return state.dragCtx.anchorLock
}

/** Get lock constraints as an array for tests that check count. */
function getLockConstraints(store: EnhancedStore, clipOutId: string): Array<{ kind: string; ids: string[]; driver?: string }> {
  const lock = getAnchorLock(store)
  if (!lock || lock.clipOutId !== clipOutId) return []
  // Synthesize the old constraint shape for test assertions:
  // TranslateGroup always present, ScaleGroup when lock='beats'
  const ids = [clipOutId, ...lock.innerAnchorOutIds]
  const result: Array<{ kind: string; ids: string[]; driver?: string }> = [
    { kind: 'TranslateGroup', ids, driver: clipOutId },
  ]
  if (lock.lockMode === 'beats') {
    result.push({ kind: 'ScaleGroup', ids, driver: clipOutId })
  }
  return result
}

function getTranslateLock(store: EnhancedStore, clipOutId: string) {
  return getLockConstraints(store, clipOutId).find(c => c.kind === 'TranslateGroup')
}

function getScaleLock(store: EnhancedStore, clipOutId: string) {
  return getLockConstraints(store, clipOutId).find(c => c.kind === 'ScaleGroup')
}

// ── Region fixture ────────────────────────────────────────────────────────────

const REGION_BASE = {
  name: 'Test',
  bpm: 120,
  minStretch: 0.5,
  maxStretch: 2.0,
  addToEnd: false as const,
  inBeatTime: 0,
  outBeatTime: 10,
  defaultLinked: true,
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('anchorLockMirrorMiddleware', () => {
  let store: EnhancedStore

  beforeEach(() => {
    store = makeStore()
    store.dispatch(setLockMode('beats'))
  })

  // ── Basic off/on ─────────────────────────────────────────────────────────

  it('no lock constraints when anchorLock is false (default)', () => {
    store.dispatch(addRegion({ id: 'r1', ...REGION_BASE, inPoint: 0, outPoint: 10 }))
    store.dispatch(addAnchor({ id: 1, time: 5 }))  // inner anchor

    const clipOutId = 'r1-out'
    expect(getLockConstraints(store, clipOutId)).toHaveLength(0)
  })

  it('lock=beats: both TranslateGroup AND ScaleGroup added when anchorLock=true', () => {
    store.dispatch(addRegion({
      id: 'r1', ...REGION_BASE, inPoint: 0, outPoint: 10 as const,
    }))
    store.dispatch(addAnchor({ id: 1, time: 5 })) // inner beat anchor at t=5

    // anchorLock off → no constraints yet
    expect(getLockConstraints(store, 'r1-out')).toHaveLength(0)

    store.dispatch(setAnchorLock(true))

    const translate = getTranslateLock(store, 'r1-out')
    const scale     = getScaleLock(store, 'r1-out')
    expect(translate).toBeDefined()
    expect(scale).toBeDefined()
    expect(translate!.driver).toBe('r1-out')
    expect(translate!.ids).toContain('r1-out')
    expect(translate!.ids).toContain('a1-out')
    expect(scale!.driver).toBe('r1-out')
    expect(scale!.ids).toContain('r1-out')
    expect(scale!.ids).toContain('a1-out')
  })

  it('lock=bpm: TranslateGroup ONLY (no ScaleGroup) when anchorLock=true', () => {
    store.dispatch(setLockMode('bpm')) // override beforeEach default of 'beats'
    store.dispatch(addRegion({
      id: 'r1', ...REGION_BASE, inPoint: 0, outPoint: 10 as const,
    }))
    store.dispatch(addAnchor({ id: 1, time: 5 }))

    store.dispatch(setAnchorLock(true))

    const translate = getTranslateLock(store, 'r1-out')
    const scale     = getScaleLock(store, 'r1-out')
    expect(translate).toBeDefined()
    expect(scale).toBeUndefined()
    expect(translate!.driver).toBe('r1-out')
  })

  // ── Toggle off removes constraints ───────────────────────────────────────

  it('toggle anchorLock true → false removes all lock:* constraints', () => {
    store.dispatch(addRegion({
      id: 'r1', ...REGION_BASE, inPoint: 0, outPoint: 10 as const,
    }))
    store.dispatch(addAnchor({ id: 1, time: 5 }))
    store.dispatch(setAnchorLock(true))

    expect(getLockConstraints(store, 'r1-out')).toHaveLength(2)

    store.dispatch(setAnchorLock(false))

    expect(getLockConstraints(store, 'r1-out')).toHaveLength(0)
  })

  // ── No active region ─────────────────────────────────────────────────────

  it('no lock constraints when anchorLock=true but no active region', () => {
    store.dispatch(addRegion({ id: 'r1', ...REGION_BASE, inPoint: 0, outPoint: 10 }))
    store.dispatch(setActiveRegionId(null))
    store.dispatch(addAnchor({ id: 1, time: 5 }))

    store.dispatch(setAnchorLock(true))

    // No active region → no lock constraints
    expect(getLockConstraints(store, 'r1-out')).toHaveLength(0)
  })

  // ── Active region change ──────────────────────────────────────────────────

  it('changing activeRegionId removes old lock and adds new lock', () => {
    store.dispatch(addRegion({
      id: 'r1', ...REGION_BASE, inPoint: 0, outPoint: 10 as const,
    }))
    store.dispatch(addRegion({
      id: 'r2', ...REGION_BASE, inPoint: 20, outPoint: 30 as const, inBeatTime: 20, outBeatTime: 30,
    }))
    store.dispatch(addAnchor({ id: 1, time: 5 }))   // inner for r1
    store.dispatch(addAnchor({ id: 2, time: 25 }))  // inner for r2
    store.dispatch(setActiveRegionId('r1'))
    store.dispatch(setAnchorLock(true))

    // r1 should have lock constraints
    expect(getLockConstraints(store, 'r1-out')).toHaveLength(2)
    expect(getLockConstraints(store, 'r2-out')).toHaveLength(0)

    // Switch active region to r2
    store.dispatch(setActiveRegionId('r2'))

    // r1's lock should be gone; r2's lock should be present
    expect(getLockConstraints(store, 'r1-out')).toHaveLength(0)
    expect(getLockConstraints(store, 'r2-out')).toHaveLength(2)
  })

  // ── Inner anchor set updates ──────────────────────────────────────────────

  it('adding a new anchor inside the active region includes it in the lock ids', () => {
    store.dispatch(addRegion({
      id: 'r1', ...REGION_BASE, inPoint: 0, outPoint: 10 as const,
    }))
    store.dispatch(setAnchorLock(true))

    // No inner anchors yet → lock group should just contain the clipout
    const translateBefore = getTranslateLock(store, 'r1-out')
    expect(translateBefore!.ids).toEqual(['r1-out'])

    // Add an anchor that falls inside [0, 10] in beat space
    store.dispatch(addAnchor({ id: 5, time: 5 }))

    const translateAfter = getTranslateLock(store, 'r1-out')
    expect(translateAfter!.ids).toContain('a5-out')
  })

  // ── Boundary anchor excluded ──────────────────────────────────────────────

  it('anchor exactly at clipout.in boundary is NOT included in inner set', () => {
    store.dispatch(addRegion({
      id: 'r1', ...REGION_BASE, inPoint: 0, outPoint: 10 as const,
    }))
    // Anchor at exactly the in-boundary of the clipout (beat time = 0)
    store.dispatch(addAnchor({ id: 10, time: 0 }))
    // Anchor strictly inside
    store.dispatch(addAnchor({ id: 11, time: 5 }))

    store.dispatch(setAnchorLock(true))

    const translate = getTranslateLock(store, 'r1-out')
    expect(translate!.ids).not.toContain('a10-out')  // boundary — excluded
    expect(translate!.ids).toContain('a11-out')       // inner — included
  })

  it('anchor exactly at clipout.out boundary is NOT included in inner set', () => {
    store.dispatch(addRegion({
      id: 'r1', ...REGION_BASE, inPoint: 0, outPoint: 10 as const,
    }))
    // Anchor at the out-boundary (beat time = 10)
    store.dispatch(addAnchor({ id: 20, time: 10 }))
    // Anchor strictly inside
    store.dispatch(addAnchor({ id: 21, time: 7 }))

    store.dispatch(setAnchorLock(true))

    const translate = getTranslateLock(store, 'r1-out')
    expect(translate!.ids).not.toContain('a20-out')  // boundary — excluded
    expect(translate!.ids).toContain('a21-out')       // inner — included
  })

  // ── Reload preserves lock state ───────────────────────────────────────────

  it('graph rebuild (loadAnchors) re-emits lock constraints', () => {
    store.dispatch(addRegion({
      id: 'r1', ...REGION_BASE, inPoint: 0, outPoint: 10 as const,
    }))
    store.dispatch(addAnchor({ id: 1, time: 5 }))
    store.dispatch(setAnchorLock(true))

    expect(getLockConstraints(store, 'r1-out')).toHaveLength(2)

    // loadAnchors changes anchor state — middleware re-emits lock
    store.dispatch(loadAnchors({
      origAnchors: [{ id: 1, time: 5 }],
      beatAnchors: [{ id: 1, time: 5 }],
    }))

    // Lock constraints should be re-emitted
    const translate = getTranslateLock(store, 'r1-out')
    const scale     = getScaleLock(store, 'r1-out')
    expect(translate).toBeDefined()
    expect(scale).toBeDefined()
    expect(translate!.ids).toContain('a1-out')
  })

  // ── Gesture override (altKey XOR) ────────────────────────────────────────

  it('gesture override=true with anchorLock=false activates lock constraints', () => {
    store.dispatch(addRegion({
      id: 'r1', ...REGION_BASE, inPoint: 0, outPoint: 10 as const,
    }))
    store.dispatch(addAnchor({ id: 1, time: 5 }))

    // ui.anchorLock stays false — gesture override inverts it
    expect(getLockConstraints(store, 'r1-out')).toHaveLength(0)

    store.dispatch(setAnchorLockGestureOverride(true))

    // Override=true → effective lock is true → both constraints present
    expect(getTranslateLock(store, 'r1-out')).toBeDefined()
    expect(getScaleLock(store, 'r1-out')).toBeDefined()

    // ui.anchorLock must NOT have changed
    const uiState = (store.getState() as { ui: { anchorLock: boolean } }).ui
    expect(uiState.anchorLock).toBe(false)
  })

  it('gesture override=false with anchorLock=true suppresses lock constraints', () => {
    store.dispatch(addRegion({
      id: 'r1', ...REGION_BASE, inPoint: 0, outPoint: 10 as const,
    }))
    store.dispatch(addAnchor({ id: 1, time: 5 }))
    store.dispatch(setAnchorLock(true))

    // Verify baseline: lock on
    expect(getLockConstraints(store, 'r1-out')).toHaveLength(2)

    // Override=false → effective lock is false → constraints removed
    store.dispatch(setAnchorLockGestureOverride(false))

    expect(getLockConstraints(store, 'r1-out')).toHaveLength(0)

    // ui.anchorLock must NOT have changed
    const uiState = (store.getState() as { ui: { anchorLock: boolean } }).ui
    expect(uiState.anchorLock).toBe(true)
  })

  it('clearing gesture override (null) reverts to anchorLock baseline', () => {
    store.dispatch(addRegion({
      id: 'r1', ...REGION_BASE, inPoint: 0, outPoint: 10 as const,
    }))
    store.dispatch(addAnchor({ id: 1, time: 5 }))
    // anchorLock=false, override=true → lock active
    store.dispatch(setAnchorLockGestureOverride(true))
    expect(getLockConstraints(store, 'r1-out')).toHaveLength(2)

    // Clear override → reverts to anchorLock=false → no lock constraints
    store.dispatch(setAnchorLockGestureOverride(null))
    expect(getLockConstraints(store, 'r1-out')).toHaveLength(0)
  })

  // ── No duplicate lock constraints ─────────────────────────────────────────

  it('only one TranslateGroup and one ScaleGroup lock:r1-out exist (no duplicates on repeated triggers)', () => {
    store.dispatch(addRegion({
      id: 'r1', ...REGION_BASE, inPoint: 0, outPoint: 10 as const,
    }))
    store.dispatch(addAnchor({ id: 1, time: 5 }))
    store.dispatch(setAnchorLock(true))
    // Trigger again (same state)
    store.dispatch(addAnchor({ id: 2, time: 7 }))

    const locks = getLockConstraints(store, 'r1-out')
    const translates = locks.filter(c => c.kind === 'TranslateGroup')
    const scales     = locks.filter(c => c.kind === 'ScaleGroup')
    expect(translates).toHaveLength(1)
    expect(scales).toHaveLength(1)
  })
})
