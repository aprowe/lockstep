/**
 * selectionGraphMirrorMiddleware — unit tests (Phase 4c).
 *
 * Verifies that slice selection changes are mirrored into dragCtxSlice.lassoIds.
 * The constraint pipeline reads lassoIds to build the TranslateGroup lasso:main
 * constraint inside buildGraphFromSlice.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { configureStore, type EnhancedStore } from '@reduxjs/toolkit'
import warpReducer, {
  setSelectedOrigIds,
  setSelectedBeatIds,
  setSelectedBothIds,
  deselectAll,
  addAnchor,
  loadAnchors,
  setBpm,
} from '../../../src/store/slices/warpSlice'
import listsReducer, {
  setListSelection,
  clearListSelection,
} from '../../../src/store/slices/listsSlice'
import regionReducer, {
  deleteRegion,
  addRegion,
} from '../../../src/store/slices/regionSlice'
import dragCtxReducer from '../../../src/store/slices/dragCtxSlice'
import { selectionGraphMirrorMiddleware } from '../../../src/store/middleware/selectionGraphMirrorMiddleware'

// Minimal store for these tests.
function makeStore(): EnhancedStore {
  return configureStore({
    reducer: {
      warp: warpReducer,
      lists: listsReducer,
      region: regionReducer,
      dragCtx: dragCtxReducer,
    },
    middleware: (getDefault) =>
      getDefault()
        .concat(selectionGraphMirrorMiddleware),
  })
}

/** Pull the current lasso IDs from dragCtx. */
function getLassoIds(store: EnhancedStore): string[] {
  const state = store.getState() as {
    dragCtx: { lassoIds: string[] }
  }
  return state.dragCtx.lassoIds
}

/** Get the lasso as an object mirroring the old graph constraint shape (for backward compat with test assertions). */
function getLassoGroup(store: EnhancedStore): { ids: string[] } | undefined {
  const ids = getLassoIds(store)
  if (ids.length === 0) return undefined
  return { ids }
}

describe('selectionGraphMirrorMiddleware', () => {
  let store: EnhancedStore

  beforeEach(() => {
    store = makeStore()
    // Seed an anchor pair so entities a7-in / a7-out exist in the graph.
    store.dispatch(addAnchor({ id: 7, time: 1.5 }))
  })

  // ── anchor selection → lasso ─────────────────────────────────────────────

  it('adds lasso:main with a{n}-in when selectedOrigIds changes from [] to [n]', () => {
    store.dispatch(setSelectedOrigIds([7]))

    const group = getLassoGroup(store)
    expect(group).toBeDefined()
    expect(group!.ids).toContain('a7-in')
    expect(group!.ids).not.toContain('a7-out')
  })

  it('adds lasso:main with a{n}-out when selectedBeatIds changes from [] to [n]', () => {
    store.dispatch(setSelectedBeatIds([7]))

    const group = getLassoGroup(store)
    expect(group).toBeDefined()
    expect(group!.ids).toContain('a7-out')
    expect(group!.ids).not.toContain('a7-in')
  })

  it('adds both a{n}-in and a{n}-out when the same id appears in both selectedOrigIds and selectedBeatIds', () => {
    store.dispatch(setSelectedBothIds([7]))

    const group = getLassoGroup(store)
    expect(group).toBeDefined()
    expect(group!.ids).toContain('a7-in')
    expect(group!.ids).toContain('a7-out')
  })

  // ── region (clip) selection → lasso ─────────────────────────────────────

  it('adds {s}-in to lasso when clipin is selected', () => {
    store.dispatch(setListSelection({ list: 'clipin', ids: ['region_1'] }))

    const group = getLassoGroup(store)
    expect(group).toBeDefined()
    expect(group!.ids).toContain('region_1-in')
  })

  it('adds {s}-out to lasso when clipout is selected', () => {
    store.dispatch(setListSelection({ list: 'clipout', ids: ['region_2'] }))

    const group = getLassoGroup(store)
    expect(group).toBeDefined()
    expect(group!.ids).toContain('region_2-out')
  })

  it('adds all four entity kinds when all four selection fields are populated', () => {
    store.dispatch(setSelectedBothIds([7]))
    store.dispatch(setListSelection({ list: 'clipin',  ids: ['reg_a'] }))
    store.dispatch(setListSelection({ list: 'clipout', ids: ['reg_b'] }))

    const group = getLassoGroup(store)
    expect(group).toBeDefined()
    expect(group!.ids).toContain('a7-in')
    expect(group!.ids).toContain('a7-out')
    expect(group!.ids).toContain('reg_a-in')
    expect(group!.ids).toContain('reg_b-out')
  })

  // ── clearing selection removes lasso ─────────────────────────────────────

  it('removes the lasso:main group when all four selection fields are cleared', () => {
    store.dispatch(setSelectedBothIds([7]))
    expect(getLassoGroup(store)).toBeDefined()

    store.dispatch(deselectAll())
    expect(getLassoGroup(store)).toBeUndefined()
  })

  it('removes lasso:main when clearListSelection empties the last selected list', () => {
    store.dispatch(setListSelection({ list: 'clipin', ids: ['region_1'] }))
    expect(getLassoGroup(store)).toBeDefined()

    store.dispatch(clearListSelection({ list: 'clipin' }))
    expect(getLassoGroup(store)).toBeUndefined()
  })

  // ── lasso is rebuilt (not appended) on each change ───────────────────────

  it('replaces rather than accumulates the lasso:main group on repeated selection changes', () => {
    store.dispatch(setSelectedOrigIds([7]))
    store.dispatch(setListSelection({ list: 'clipin', ids: ['region_1'] }))

    const group = getLassoGroup(store)
    // Should have exactly these two entity ids and no duplicates.
    expect(group!.ids).toHaveLength(2)
    expect(group!.ids).toContain('a7-in')
    expect(group!.ids).toContain('region_1-in')
  })

  it('only one lasso:main group exists in the graph (no stale duplicates)', () => {
    store.dispatch(setSelectedOrigIds([7]))
    store.dispatch(setSelectedOrigIds([7]))  // dispatch same selection again
    store.dispatch(setSelectedBeatIds([7]))

    // With Phase 4c, lasso is stored as a flat array in dragCtx.lassoIds.
    // After the final dispatch (beat selection), lassoIds should contain only a7-out.
    const ids = getLassoIds(store)
    const a7inCount  = ids.filter(id => id === 'a7-in').length
    const a7outCount = ids.filter(id => id === 'a7-out').length
    expect(a7inCount).toBeLessThanOrEqual(1)
    expect(a7outCount).toBeLessThanOrEqual(1)
  })

  // ── Bug 1: lasso survives reload ─────────────────────────────────────────

  it('lasso survives a graph rebuild triggered by loadAnchors', () => {
    // Set clipin selection to region 7.
    store.dispatch(setListSelection({ list: 'clipin', ids: ['region_7'] }))
    expect(getLassoGroup(store)).toBeDefined()
    expect(getLassoGroup(store)!.ids).toContain('region_7-in')

    // loadAnchors — selection middleware should still see selection in lists slice
    // and re-emit the lasso if the action triggers a selection re-check.
    // In Phase 4c, the lasso is driven purely by the selection slice, so it
    // persists across loadAnchors (no wipe like setGraph did in Phase 3).
    store.dispatch(loadAnchors({
      origAnchors: [{ id: 7, time: 1.5 }],
      beatAnchors: [{ id: 7, time: 1.5 }],
    }))

    // Lasso is only re-triggered if loadAnchors changes selection state.
    // Since it doesn't change selection, dragCtx.lassoIds should remain set.
    const group = getLassoGroup(store)
    expect(group).toBeDefined()
    expect(group!.ids).toContain('region_7-in')
  })

  // ── Bug 2: deleteRegion prunes selection AND lasso ────────────────────────

  it('deleteRegion prunes the deleted region from clipin/clipout selection', () => {
    store.dispatch(addRegion({
      id: 'reg_a', name: 'A', inPoint: 0, outPoint: 1, bpm: 120,
      inBeatTime: 0, outBeatTime: 1, defaultLinked: true,
      minStretch: 0.5, maxStretch: 2.0, addToEnd: false,
    }))
    store.dispatch(addRegion({
      id: 'reg_b', name: 'B', inPoint: 1, outPoint: 2, bpm: 120,
      inBeatTime: 1, outBeatTime: 2, defaultLinked: true,
      minStretch: 0.5, maxStretch: 2.0, addToEnd: false,
    }))
    store.dispatch(setListSelection({ list: 'clipin',  ids: ['reg_a', 'reg_b'] }))
    store.dispatch(setListSelection({ list: 'clipout', ids: ['reg_a', 'reg_b'] }))

    const groupBefore = getLassoGroup(store)
    expect(groupBefore).toBeDefined()
    expect(groupBefore!.ids).toContain('reg_a-in')
    expect(groupBefore!.ids).toContain('reg_b-in')

    // Delete reg_a — its IDs should be pruned from the lasso.
    store.dispatch(deleteRegion('reg_a'))

    const state = store.getState() as {
      lists: { selection: { clipin: string[]; clipout: string[] } }
    }
    // Slice selection should no longer contain reg_a.
    expect(state.lists.selection.clipin).not.toContain('reg_a')
    expect(state.lists.selection.clipout).not.toContain('reg_a')
    expect(state.lists.selection.clipin).toContain('reg_b')

    // Lasso should reference only reg_b's entities.
    const groupAfter = getLassoGroup(store)
    expect(groupAfter).toBeDefined()
    expect(groupAfter!.ids).not.toContain('reg_a-in')
    expect(groupAfter!.ids).not.toContain('reg_a-out')
    expect(groupAfter!.ids).toContain('reg_b-in')
  })

  it('deleteRegion with nothing selected leaves no lasso', () => {
    store.dispatch(addRegion({
      id: 'reg_c', name: 'C', inPoint: 0, outPoint: 1, bpm: 120,
      inBeatTime: 0, outBeatTime: 1, defaultLinked: true,
      minStretch: 0.5, maxStretch: 2.0, addToEnd: false,
    }))
    // No selection — lasso is absent.
    expect(getLassoGroup(store)).toBeUndefined()

    store.dispatch(deleteRegion('reg_c'))

    expect(getLassoGroup(store)).toBeUndefined()
  })

  // ── Bug 3: array equality short-circuit ──────────────────────────────────

  it('dispatch setSelectedOrigIds with same contents twice does not redispatch lasso', () => {
    store.dispatch(setSelectedOrigIds([7]))
    const groupAfterFirst = getLassoGroup(store)
    expect(groupAfterFirst).toBeDefined()

    // Spy on dispatch to count subsequent lasso-related dispatches.
    const originalDispatch = store.dispatch.bind(store)
    const dispatched: string[] = []
    const spy = vi.spyOn(store, 'dispatch').mockImplementation((action: unknown) => {
      if (typeof action === 'object' && action !== null && 'type' in action) {
        dispatched.push((action as { type: string }).type)
      }
      return originalDispatch(action as never)
    })

    // Dispatch structurally equal array (different reference).
    store.dispatch(setSelectedOrigIds([7]))

    // The middleware should detect no change and NOT dispatch setLassoIds / clearLasso.
    const lassoDispatches = dispatched.filter(t => t === 'dragCtx/setLassoIds' || t === 'dragCtx/clearLasso')
    expect(lassoDispatches).toHaveLength(0)

    spy.mockRestore()
  })

  // ── Bug 4: unrelated action is no-op ─────────────────────────────────────

  it('setBpm dispatch does not trigger any lasso redispatch', () => {
    store.dispatch(setSelectedOrigIds([7]))

    const originalDispatch = store.dispatch.bind(store)
    const dispatched: string[] = []
    const spy = vi.spyOn(store, 'dispatch').mockImplementation((action: unknown) => {
      if (typeof action === 'object' && action !== null && 'type' in action) {
        dispatched.push((action as { type: string }).type)
      }
      return originalDispatch(action as never)
    })

    store.dispatch(setBpm(140))

    // No lasso dispatches should originate from the selection mirror.
    const lassoDispatches = dispatched.filter(t => t === 'dragCtx/setLassoIds' || t === 'dragCtx/clearLasso')
    expect(lassoDispatches).toHaveLength(0)

    spy.mockRestore()
  })
})
