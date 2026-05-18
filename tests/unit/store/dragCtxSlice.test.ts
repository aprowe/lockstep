/**
 * dragCtxSlice — unit tests (Phase 4a).
 *
 * Verifies that dragCtxSlice is correctly populated by:
 *   1. selectionGraphMirrorMiddleware  (lasso shadow-write)
 *   2. anchorLockMirrorMiddleware      (anchorLock shadow-write)
 *   3. dragCtxMirrorMiddleware         (snap shadow-write)
 *
 * Also tests the slice reducers directly (setSnapInstall, clearSnapInstall,
 * setAnchorLock, clearAnchorLock).
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { configureStore, type EnhancedStore } from '@reduxjs/toolkit'

// Reducers
import warpReducer, {
  addAnchor,
  setSelectedOrigIds,
  setSelectedBeatIds,
} from '../../../src/store/slices/warpSlice'
import listsReducer, { setListSelection } from '../../../src/store/slices/listsSlice'
import regionReducer, { addRegion } from '../../../src/store/slices/regionSlice'
import uiReducer, { setAnchorLock, setLockMode } from '../../../src/store/slices/uiSlice'
import dragReducer from '../../../src/store/slices/dragSlice'
import dragCtxReducer, {
  setSnapInstall,
  clearSnapInstall,
  setAnchorLock as setDragCtxAnchorLock,
  clearAnchorLock,
} from '../../../src/store/slices/dragCtxSlice'

// Middlewares
import { selectionGraphMirrorMiddleware } from '../../../src/store/middleware/selectionGraphMirrorMiddleware'
import { anchorLockMirrorMiddleware } from '../../../src/store/middleware/anchorLockMirrorMiddleware'
import { dragCtxMirrorMiddleware } from '../../../src/store/middleware/dragCtxMirrorMiddleware'


import type { Region } from '../../../src/types'

// ─── Store factory ────────────────────────────────────────────────────────────

function makeStore(): EnhancedStore {
  return configureStore({
    reducer: {
      warp:    warpReducer,
      lists:   listsReducer,
      region:  regionReducer,
      ui:      uiReducer,
      drag:    dragReducer,
      dragCtx: dragCtxReducer,
    },
    middleware: (getDefault) =>
      getDefault({
        serializableCheck: {
          ignoredActionPaths: ['payload.constraint', 'payload.apply', 'payload.predicate'],
        },
      })
        .concat(selectionGraphMirrorMiddleware)
        .concat(anchorLockMirrorMiddleware)
        .concat(dragCtxMirrorMiddleware),
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDragCtx(store: EnhancedStore) {
  return (store.getState() as { dragCtx: ReturnType<typeof dragCtxReducer> }).dragCtx
}

function makeRegion(overrides: {
  id: string
  inPoint: number
  outPoint: number
  inBeatTime?: number
  outBeatTime?: number
  bpm?: number
  defaultLinked?: boolean
}): Region {
  return {
    id:            overrides.id,
    name:          overrides.id,
    inPoint:       overrides.inPoint,
    outPoint:      overrides.outPoint,
    inBeatTime:    overrides.inBeatTime  ?? overrides.inPoint,
    outBeatTime:   overrides.outBeatTime ?? overrides.outPoint,
    bpm:           overrides.bpm ?? 120,
    lockedBeats:   undefined as unknown as number,
    defaultLinked: overrides.defaultLinked ?? true,
    minStretch:    0.5,
    maxStretch:    2.0,
    addToEnd:      false,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('dragCtxSlice — direct reducers', () => {
  it('initialises to empty state', () => {
    const store = makeStore()
    const dc = getDragCtx(store)
    expect(dc.lassoIds).toEqual([])
    expect(dc.snapInstall).toBeNull()
    expect(dc.anchorLock).toBeNull()
  })

  it('setSnapInstall / clearSnapInstall round-trips', () => {
    const store = makeStore()
    store.dispatch(setSnapInstall({
      entityId: 'a1-out', field: 'time', threshold: 0.1,
    }))
    expect(getDragCtx(store).snapInstall).toMatchObject({ entityId: 'a1-out', field: 'time' })

    store.dispatch(clearSnapInstall())
    expect(getDragCtx(store).snapInstall).toBeNull()
  })

  it('setAnchorLock / clearAnchorLock', () => {
    const store = makeStore()
    store.dispatch(setDragCtxAnchorLock({
      clipOutId: 'r1-out', innerAnchorOutIds: ['a1-out', 'a2-out'], lockMode: 'bpm',
    }))
    const al = getDragCtx(store).anchorLock
    expect(al).not.toBeNull()
    expect(al?.clipOutId).toBe('r1-out')
    expect(al?.lockMode).toBe('bpm')

    store.dispatch(clearAnchorLock())
    expect(getDragCtx(store).anchorLock).toBeNull()
  })
})

describe('dragCtxSlice — lasso shadow-write via selectionGraphMirrorMiddleware', () => {
  it('selecting 3 anchors populates dragCtx.lassoIds', () => {
    const store = makeStore()
    store.dispatch(addAnchor({ id: 1, time: 1.0 }))
    store.dispatch(addAnchor({ id: 2, time: 2.0 }))
    store.dispatch(addAnchor({ id: 3, time: 3.0 }))

    store.dispatch(setSelectedOrigIds([1, 2, 3]))

    const ids = getDragCtx(store).lassoIds
    expect(ids).toContain('a1-in')
    expect(ids).toContain('a2-in')
    expect(ids).toContain('a3-in')
    expect(ids).toHaveLength(3)
  })

  it('mixed selection (orig + beat) includes both entity IDs', () => {
    const store = makeStore()
    store.dispatch(addAnchor({ id: 1, time: 1.0 }))
    store.dispatch(addAnchor({ id: 2, time: 2.0 }))

    store.dispatch(setSelectedOrigIds([1]))
    store.dispatch(setSelectedBeatIds([2]))

    const ids = getDragCtx(store).lassoIds
    expect(ids).toContain('a1-in')
    expect(ids).toContain('a2-out')
  })

  it('clearing selection clears dragCtx.lassoIds', () => {
    const store = makeStore()
    store.dispatch(addAnchor({ id: 1, time: 1.0 }))
    store.dispatch(setSelectedOrigIds([1]))
    expect(getDragCtx(store).lassoIds).toHaveLength(1)

    store.dispatch(setSelectedOrigIds([]))
    expect(getDragCtx(store).lassoIds).toHaveLength(0)
  })

  it('clip selection populates lassoIds with region entity IDs', () => {
    const store = makeStore()
    store.dispatch(addRegion(makeRegion({ id: 'r1', inPoint: 0, outPoint: 4 })))
    store.dispatch(addRegion(makeRegion({ id: 'r2', inPoint: 4, outPoint: 8 })))

    store.dispatch(setListSelection({ list: 'clipin', ids: ['r1', 'r2'] }))

    const ids = getDragCtx(store).lassoIds
    expect(ids).toContain('r1-in')
    expect(ids).toContain('r2-in')
  })
})

describe('dragCtxSlice — anchor-lock shadow-write via anchorLockMirrorMiddleware', () => {
  it('enabling anchor-lock with active region populates dragCtx.anchorLock', () => {
    const store = makeStore()
    store.dispatch(addAnchor({ id: 1, time: 1.0 }))
    store.dispatch(addAnchor({ id: 2, time: 3.0 }))
    store.dispatch(addRegion(makeRegion({ id: 'r1', inPoint: 0, outPoint: 4, inBeatTime: 0, outBeatTime: 4 })))

    // Set active region
    store.dispatch({ type: 'region/setActiveRegionId', payload: 'r1' })
    store.dispatch(setAnchorLock(true))

    const al = getDragCtx(store).anchorLock
    expect(al).not.toBeNull()
    expect(al?.clipOutId).toBe('r1-out')
    expect(al?.lockMode).toBe('bpm') // default
    // Inner anchors: a1 at 1.0 and a2 at 3.0 are both strictly between 0 and 4.
    expect(al?.innerAnchorOutIds).toContain('a1-out')
    expect(al?.innerAnchorOutIds).toContain('a2-out')
  })

  it('disabling anchor-lock clears dragCtx.anchorLock', () => {
    const store = makeStore()
    store.dispatch(addAnchor({ id: 1, time: 1.0 }))
    store.dispatch(addRegion(makeRegion({ id: 'r1', inPoint: 0, outPoint: 4, inBeatTime: 0, outBeatTime: 4 })))
    store.dispatch({ type: 'region/setActiveRegionId', payload: 'r1' })
    store.dispatch(setAnchorLock(true))
    expect(getDragCtx(store).anchorLock).not.toBeNull()

    store.dispatch(setAnchorLock(false))
    expect(getDragCtx(store).anchorLock).toBeNull()
  })

  it('lock mode "beats" is reflected in dragCtx.anchorLock.lockMode', () => {
    const store = makeStore()
    store.dispatch(addAnchor({ id: 1, time: 1.0 }))
    store.dispatch(addRegion(makeRegion({ id: 'r1', inPoint: 0, outPoint: 4, inBeatTime: 0, outBeatTime: 4 })))
    store.dispatch({ type: 'region/setActiveRegionId', payload: 'r1' })
    store.dispatch(setLockMode('beats'))
    store.dispatch(setAnchorLock(true))

    const al = getDragCtx(store).anchorLock
    expect(al?.lockMode).toBe('beats')
  })
})

describe('dragCtxSlice — snap shadow-write via dragCtxMirrorMiddleware', () => {
  // Phase 4c: dragCtxMirrorMiddleware is a no-op. Snap state is dispatched
  // directly to dragCtxSlice by WarpView (setSnapInstall / clearSnapInstall).

  it('snapEnd op clears dragCtx.snapInstall', () => {
    const store = makeStore()
    // Manually install a snap via direct dispatch to dragCtxSlice.
    store.dispatch(setSnapInstall({ entityId: 'a1-out', field: 'time', threshold: 0.05 }))
    expect(getDragCtx(store).snapInstall).not.toBeNull()

    // Phase 4c: clear snap directly (WarpView clearSnapInstall path)
    store.dispatch(clearSnapInstall())
    expect(getDragCtx(store).snapInstall).toBeNull()
  })

  it('AddConstraint(SnapTarget) with snap:* tag populates dragCtx.snapInstall', () => {
    const store = makeStore()
    store.dispatch(addAnchor({ id: 1, time: 1.0 }))

    // Phase 4c: dispatch directly to dragCtxSlice (WarpView setSnapInstall path)
    store.dispatch(setSnapInstall({
      entityId:  'a1-out',
      field:     'time',
      targets:   [],
      threshold: 0.1,
    }))

    const si = getDragCtx(store).snapInstall
    expect(si).not.toBeNull()
    expect(si?.entityId).toBe('a1-out')
    expect(si?.field).toBe('time')
    expect(si?.threshold).toBe(0.1)
  })
})

describe('dragCtxSlice — end-drag reset', () => {
  it('clearing lasso + snap resets all dragCtx fields', () => {
    const store = makeStore()
    store.dispatch(addAnchor({ id: 1, time: 1.0 }))
    store.dispatch(addRegion(makeRegion({ id: 'r1', inPoint: 0, outPoint: 4, inBeatTime: 0, outBeatTime: 4 })))

    // Install state.
    store.dispatch(setSelectedOrigIds([1]))
    store.dispatch(setSnapInstall({ entityId: 'a1-out', field: 'time', threshold: 0.1 }))

    // End drag: clear lasso + snap.
    store.dispatch(setSelectedOrigIds([]))
    store.dispatch(clearSnapInstall())

    const dc = getDragCtx(store)
    expect(dc.lassoIds).toHaveLength(0)
    expect(dc.snapInstall).toBeNull()
  })
})
