/**
 * Anchor-lock → dragCtx mirror.
 *
 * Watches ui.anchorLock, ui.lockMode, region.activeRegionId, warp.beatAnchors.
 *
 * After any relevant action, computes the set of "inner" beat anchors
 * (those strictly between clipout in/out) and writes the anchor-lock state
 * to dragCtxSlice.anchorLock. The constraint pipeline reads dragCtxSlice.anchorLock
 * to build the TranslateGroup / ScaleGroup lock constraints inside buildGraphFromSlice.
 *
 * Writes to dragCtxSlice.anchorLock only.
 */

import type { Middleware } from '@reduxjs/toolkit'
import type { EntityId } from '../../constraints/types'
import { anchorOutId, regionOutId } from '../../constraints/ids'
import { setAnchorLock, clearAnchorLock } from '../slices/dragCtxSlice'

// ── Action types that can affect lock state ───────────────────────────────────

const LOCK_WATCH_TYPES = new Set<string>([
  'ui/setAnchorLock',
  'ui/setAnchorLockGestureOverride',
  'region/setActiveRegionId',
  'region/addRegion',
  'region/deleteRegion',
  'region/_syncRegionPositions',
  'ui/setLockMode',
  'warp/setBeatAnchors',
  'warp/setBeatAnchorsFromTimeline',
  'warp/loadAnchors',
  'warp/clearAnchors',
  'warp/addAnchor',
  'warp/removeAnchors',
  'warp/setOrigAnchors',
  'warp/_syncAnchorPositions',
])

// ── State shape ───────────────────────────────────────────────────────────────

interface LockMirrorState {
  ui?: { anchorLock: boolean; anchorLockGestureOverride?: boolean | null; lockMode?: 'bpm' | 'beats' }
  region?: {
    activeRegionId: string | null
    regions: Array<{
      id: string
      inBeatTime: number
      outBeatTime: number
    }>
  }
  warp?: { beatAnchors: Array<{ id: number; time: number }> }
}

interface LockSnapshot {
  anchorLock: boolean
  activeRegionId: string | null
  lockMode: string
  innerOutIds: string
  clipoutIn: number
  clipoutOut: number
}

const EMPTY_SNAPSHOT: LockSnapshot = {
  anchorLock: false,
  activeRegionId: null,
  lockMode: '',
  innerOutIds: '[]',
  clipoutIn: 0,
  clipoutOut: 0,
}

function readSnapshot(state: LockMirrorState): LockSnapshot {
  const gestureOverride = state.ui?.anchorLockGestureOverride ?? null
  const anchorLock = gestureOverride !== null ? gestureOverride : (state.ui?.anchorLock ?? false)
  const activeRegionId = state.region?.activeRegionId ?? null
  const region = activeRegionId
    ? state.region?.regions.find(r => r.id === activeRegionId)
    : undefined

  if (!anchorLock || !region) {
    return { anchorLock, activeRegionId, lockMode: '', innerOutIds: '[]', clipoutIn: 0, clipoutOut: 0 }
  }

  const lockMode = state.ui?.lockMode ?? 'bpm'
  const clipoutIn  = region.inBeatTime
  const clipoutOut = region.outBeatTime

  const EPSILON = 1e-9
  const beatAnchors = state.warp?.beatAnchors ?? []
  const inner: EntityId[] = []
  for (const a of beatAnchors) {
    if (a.time > clipoutIn + EPSILON && a.time < clipoutOut - EPSILON) {
      inner.push(anchorOutId(a.id))
    }
  }
  inner.sort()

  return {
    anchorLock,
    activeRegionId,
    lockMode,
    innerOutIds: JSON.stringify(inner),
    clipoutIn,
    clipoutOut,
  }
}

function snapshotEqual(a: LockSnapshot, b: LockSnapshot): boolean {
  return a.anchorLock    === b.anchorLock    &&
         a.activeRegionId === b.activeRegionId &&
         a.lockMode       === b.lockMode       &&
         a.innerOutIds    === b.innerOutIds    &&
         a.clipoutIn      === b.clipoutIn      &&
         a.clipoutOut     === b.clipoutOut
}

function emitLock(
  api: { dispatch: (a: never) => unknown },
  snapshot: LockSnapshot,
) {
  const { anchorLock, activeRegionId, lockMode, innerOutIds } = snapshot

  if (!anchorLock || !activeRegionId) {
    api.dispatch(clearAnchorLock() as never)
    return
  }

  const clipOutEntityId = regionOutId(activeRegionId)
  const innerIds: EntityId[] = JSON.parse(innerOutIds)

  api.dispatch(setAnchorLock({
    clipOutId:          clipOutEntityId,
    innerAnchorOutIds:  innerIds,
    lockMode:           lockMode as 'bpm' | 'beats',
  }) as never)
}

// ── Middleware ────────────────────────────────────────────────────────────────

export const anchorLockMirrorMiddleware: Middleware = (api) => {
  let lastSnapshot: LockSnapshot = EMPTY_SNAPSHOT

  return (next) => (action) => {
    if (
      typeof action !== 'object' ||
      action === null ||
      !('type' in action)
    ) {
      return next(action)
    }

    const actionType = (action as { type: string }).type

    if (!LOCK_WATCH_TYPES.has(actionType)) {
      return next(action)
    }

    const before = readSnapshot(api.getState() as LockMirrorState)
    const result = next(action)
    const after = readSnapshot(api.getState() as LockMirrorState)

    if (snapshotEqual(before, after) && snapshotEqual(after, lastSnapshot)) {
      return result
    }

    // If active region changed, clear old region's lock first.
    if (before.activeRegionId && before.activeRegionId !== after.activeRegionId) {
      api.dispatch(clearAnchorLock() as never)
    }

    emitLock(api, after)
    lastSnapshot = after

    return result
  }
}
