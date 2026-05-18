/**
 * Selection → dragCtx mirror (Phase 4c).
 *
 * Watches the four selection arrays/sets in slices:
 *   warp.selectedOrigIds     number[]   (anchor input-space selection)
 *   warp.selectedBeatIds     number[]   (anchor output-space selection)
 *   lists.selection.clipin   string[]   (region clipin selection)
 *   lists.selection.clipout  string[]   (region clipout selection)
 *
 * After any action that mutates these fields, the middleware rebuilds the
 * lasso entity ID list and writes it to dragCtxSlice.lassoIds.
 *
 * The constraint pipeline reads dragCtxSlice.lassoIds to build the
 * TranslateGroup lasso:main constraint inside buildGraphFromSlice.
 *
 * Writes to dragCtxSlice.lassoIds only.
 */

import type { Middleware } from '@reduxjs/toolkit'
import type { EntityId } from '../../constraints/types'
import {
  anchorInId,
  anchorOutId,
  regionInId,
  regionOutId,
} from '../../constraints/ids'
import { removeFromSelection } from '../slices/listsSlice'
import {
  setLassoIds,
  clearLasso as clearDragCtxLasso,
} from '../slices/dragCtxSlice'

// ── Action types that can mutate the four selection fields ────────────────

const SELECTION_ACTION_TYPES = new Set<string>([
  'warp/setSelectedOrigIds',
  'warp/setSelectedBeatIds',
  'warp/setSelectedBothIds',
  'warp/selectAll',
  'warp/deselectAll',
  'warp/removeAnchors',
  'warp/clearAnchors',
  'lists/setListSelection',
  'lists/clearListSelection',
  'lists/removeFromSelection',
])

interface SelectionState {
  warp?: {
    selectedOrigIds: number[]
    selectedBeatIds: number[]
  }
  lists?: {
    selection: {
      clipin: string[]
      clipout: string[]
    }
  }
}

interface SelectionSnapshot {
  orig:    number[]
  beat:    number[]
  clipin:  string[]
  clipout: string[]
}

function readSelection(state: SelectionState): SelectionSnapshot {
  return {
    orig:   state.warp?.selectedOrigIds  ?? [],
    beat:   state.warp?.selectedBeatIds  ?? [],
    clipin: state.lists?.selection.clipin  ?? [],
    clipout: state.lists?.selection.clipout ?? [],
  }
}

function arraysEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  return a === b || (a.length === b.length && a.every((x, i) => x === b[i]))
}

function snapshotEqual(a: SelectionSnapshot, b: SelectionSnapshot): boolean {
  return arraysEqual(a.orig, b.orig) && arraysEqual(a.beat, b.beat) &&
         arraysEqual(a.clipin, b.clipin) && arraysEqual(a.clipout, b.clipout)
}

function buildLassoIds(sel: SelectionSnapshot): EntityId[] {
  const ids: EntityId[] = []

  for (const n of sel.orig) {
    ids.push(anchorInId(n))
  }
  for (const n of sel.beat) {
    ids.push(anchorOutId(n))
  }
  for (const s of sel.clipin) {
    ids.push(regionInId(s))
  }
  for (const s of sel.clipout) {
    ids.push(regionOutId(s))
  }

  return [...new Set(ids)]
}

function emitLasso(api: { dispatch: (a: never) => unknown }, snapshot: SelectionSnapshot) {
  const ids = buildLassoIds(snapshot)
  if (ids.length > 0) {
    api.dispatch(setLassoIds(ids) as never)
  } else {
    api.dispatch(clearDragCtxLasso() as never)
  }
}

export const selectionGraphMirrorMiddleware: Middleware =
  (api) => (next) => (action) => {
    if (
      typeof action !== 'object' ||
      action === null ||
      !('type' in action)
    ) {
      return next(action)
    }

    const actionType = (action as { type: string }).type

    // Bug 2: region delete — prune the region id from clipin/clipout.
    if (actionType === 'region/deleteRegion') {
      const regionId = (action as unknown as { payload: string }).payload
      const result = next(action)
      api.dispatch(removeFromSelection(regionId) as never)
      return result
    }

    if (!SELECTION_ACTION_TYPES.has(actionType)) {
      return next(action)
    }

    const before = readSelection(api.getState() as SelectionState)
    const result = next(action)
    const after = readSelection(api.getState() as SelectionState)

    if (snapshotEqual(before, after)) return result

    emitLasso(api, after)

    return result
  }
