import { createSelector } from '@reduxjs/toolkit'
import type { RootState } from './store'
import type { Anchor } from '../types'
import { computeOutputDuration } from '../utils/quantize'

// ── Region selectors ────────────────────────────────────────────────────────

export const selectActiveRegion = createSelector(
  (s: RootState) => s.region.regions,
  (s: RootState) => s.region.activeRegionId,
  (regions, id) => id ? regions.find(r => r.id === id) ?? null : null,
)

export const selectClipIn = createSelector(
  selectActiveRegion,
  (r) => r?.inPoint,
)

export const selectClipOut = createSelector(
  selectActiveRegion,
  (r) => r?.outPoint,
)

// ── Warp selectors ──────────────────────────────────────────────────────────

export const selectSortedOrig = createSelector(
  (s: RootState) => s.warp.origAnchors,
  (anchors) => [...anchors].sort((a, b) => a.time - b.time),
)

export const selectSortedBeat = createSelector(
  selectSortedOrig,
  (s: RootState) => s.warp.beatAnchors,
  (sortedOrig, beatAnchors) =>
    sortedOrig.map(oa => beatAnchors.find(ba => ba.id === oa.id)!).filter(Boolean),
)

export const selectSelectedIdsSet = createSelector(
  (s: RootState) => s.warp.selectedIds,
  (ids) => new Set(ids),
)

export const selectLinkedBeatSet = createSelector(
  (s: RootState) => s.warp.linkedBeatIds,
  (ids) => new Set(ids),
)

export const selectOutputDuration = createSelector(
  selectSortedOrig,
  selectSortedBeat,
  (s: RootState) => s.video.video?.duration ?? 60,
  (sortedOrig, sortedBeat, duration) =>
    computeOutputDuration(sortedOrig, sortedBeat, duration),
)

export const selectLinkedAnchorIds = createSelector(
  (s: RootState) => s.warp.origAnchors,
  (s: RootState) => s.warp.beatAnchors,
  (orig, beat) => {
    const ids = new Set<number>()
    for (const oa of orig) {
      const ba = beat.find(b => b.id === oa.id)
      if (ba && Math.abs(ba.time - oa.time) < 0.001) ids.add(oa.id)
    }
    return ids
  },
)

/** WarpData-compatible object for legacy components that still expect it */
export const selectWarpData = createSelector(
  (s: RootState) => s.warp,
  selectSortedOrig,
  selectSortedBeat,
  selectClipIn,
  (warp, sortedOrig, sortedBeat, clipIn) => {
    // Compute beat offset
    let beatOffset = sortedBeat[0]?.time ?? 0
    if (clipIn !== undefined) {
      if (warp.beatZeroId !== null) {
        const z = sortedBeat.find(a => a.id === warp.beatZeroId)
        if (z) beatOffset = z.time
      } else {
        beatOffset = clipIn
      }
    }
    return {
      origAnchors: warp.origAnchors,
      beatAnchors: warp.beatAnchors,
      bpm: warp.bpm,
      minStretch: warp.minStretch,
      maxStretch: warp.maxStretch,
      beatZeroTime: beatOffset,
      addToEnd: warp.addToEnd,
    }
  },
)

// ── Dimmed anchors (outside active region) ──────────────────────────────────

export const selectDimmedAnchorIds = createSelector(
  (s: RootState) => s.warp.origAnchors,
  selectClipIn,
  selectClipOut,
  (anchors, clipIn, clipOut) => {
    if (clipIn === undefined && clipOut === undefined) return undefined
    const ids = new Set<number>()
    for (const a of anchors) {
      if ((clipIn !== undefined && a.time < clipIn - 0.001) ||
          (clipOut !== undefined && a.time > clipOut + 0.001)) {
        ids.add(a.id)
      }
    }
    return ids.size > 0 ? ids : undefined
  },
)
