import { createSelector } from '@reduxjs/toolkit'
import type { RootState } from './store'
import type { Anchor } from '../types'
import { computeOutputDuration } from '../utils/quantize'
import { effectiveBeatBounds } from '../timeline/model/effectiveBounds'
import type { EffectiveBeatBounds } from '../timeline/model/effectiveBounds'
import {
  anchorInId,
  anchorOutId,
  regionInId,
  regionOutId,
} from '../constraints/ids'
import { selectConstraintGraph } from './selectors/constraintGraph'
import { readAnchorTime, readClipBounds } from './graphBridge'

export { selectConstraintGraph }

// ── Region selectors ────────────────────────────────────────────────────────

/**
 * The active region. Position fields (inPoint/outPoint/inBeatTime/outBeatTime)
 * are read from the slice (which the pipeline keeps in sync). Non-position
 * metadata (id/name/bpm/lock/etc.) also comes from the slice.
 */
export const selectActiveRegion = createSelector(
  (s: RootState) => s.region.regions,
  (s: RootState) => s.region.activeRegionId,
  (regions, id) => {
    if (!id) return null
    const r = regions.find(r => r.id === id)
    return r ?? null
  },
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

/**
 * Anchors sorted by orig time. Reads positions directly from slice
 * (the pipeline keeps slice in sync with the constraint engine).
 */
export const selectSortedOrig = createSelector(
  (s: RootState) => s.warp.origAnchors,
  (anchors) => {
    return [...anchors].sort((a, b) => a.time - b.time)
  },
)

export const selectSortedBeat = createSelector(
  selectSortedOrig,
  (s: RootState) => s.warp.beatAnchors,
  (sortedOrig, beatAnchors) =>
    sortedOrig.map(oa => {
      const sliceBeat = beatAnchors.find(ba => ba.id === oa.id)
      return sliceBeat ?? { id: oa.id, time: oa.time }
    }),
)

export const selectSelectedOrigIdsSet = createSelector(
  (s: RootState) => s.warp.selectedOrigIds,
  (ids) => new Set(ids),
)

export const selectSelectedBeatIdsSet = createSelector(
  (s: RootState) => s.warp.selectedBeatIds,
  (ids) => new Set(ids),
)

/** Union of orig + beat selected ids — used where a single "is any space
 *  selected" query is needed (e.g. Delete key handling, region thunks). */
export const selectSelectedIdsUnion = createSelector(
  (s: RootState) => s.warp.selectedOrigIds,
  (s: RootState) => s.warp.selectedBeatIds,
  (origIds, beatIds) => new Set([...origIds, ...beatIds]),
)

export const selectOutputDuration = createSelector(
  selectSortedOrig,
  selectSortedBeat,
  (s: RootState) => s.video.video?.duration ?? 60,
  (sortedOrig, sortedBeat, duration) =>
    computeOutputDuration(sortedOrig, sortedBeat, duration),
)

/** Derive the set of linked anchor IDs from the slice.
 *  An anchor is "linked" when beatAnchors[n].linked !== false. */
export const selectLinkedAnchorIds = createSelector(
  (s: RootState) => s.warp.beatAnchors,
  (beatAnchors) => {
    const ids = new Set<number>()
    for (const a of beatAnchors) {
      if (a.linked !== false) ids.add(a.id)
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

// ── Effective beat bounds ────────────────────────────────────────────────────

/** Effective beat-space bounds for the active region: explicit inBeatTime/
 *  outBeatTime win; then input-anchor conform fills in defaults; then falls
 *  back to inPoint/outPoint. Returns null when no region is active. */
export const selectEffectiveBeatBoundsForActive = createSelector(
  selectActiveRegion,
  (s: RootState) => s.warp.origAnchors,
  (s: RootState) => s.warp.beatAnchors,
  (region, origAnchors, beatAnchors): EffectiveBeatBounds | null => {
    if (!region) return null
    return effectiveBeatBounds(region, origAnchors, beatAnchors)
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

// ── Slice-based position selectors ──────────────────────────────────────────
//
// These selectors read positions from the slice. The constraint pipeline keeps
// the slice in sync, so these values are equivalent to reading the graph.

/** Return the orig (input-space) time for a given anchor pair id. */
export const selectAnchorOrigTime = (s: RootState, anchorId: number): number | undefined =>
  s.warp.origAnchors.find(a => a.id === anchorId)?.time

/** Return the beat (output-space) time for a given anchor pair id. */
export const selectAnchorBeatTime = (s: RootState, anchorId: number): number | undefined =>
  s.warp.beatAnchors.find(a => a.id === anchorId)?.time

/** All anchors from slice, sorted by id (orig side). */
export const selectOrigAnchorsFromGraph = createSelector(
  (s: RootState) => s.warp.origAnchors,
  (sliceOrig): Anchor[] => [...sliceOrig],
)

/** All beat anchors from slice. */
export const selectBeatAnchorsFromGraph = createSelector(
  (s: RootState) => s.warp.beatAnchors,
  (sliceBeat): Anchor[] => [...sliceBeat],
)

/** Region inPoint from slice. */
export const selectRegionInPoint = (s: RootState, regionId: string): number | undefined =>
  s.region.regions.find(r => r.id === regionId)?.inPoint

export const selectRegionOutPoint = (s: RootState, regionId: string): number | undefined =>
  s.region.regions.find(r => r.id === regionId)?.outPoint

/** Region clipout `in` (beat-space) from slice. */
export const selectRegionInBeatTime = (s: RootState, regionId: string): number | undefined =>
  s.region.regions.find(r => r.id === regionId)?.inBeatTime

export const selectRegionOutBeatTime = (s: RootState, regionId: string): number | undefined =>
  s.region.regions.find(r => r.id === regionId)?.outBeatTime

// Keep graphBridge helpers re-exported for any tests that import from here
export { readAnchorTime, readClipBounds }
// Keep id helpers re-exported
export { anchorInId, anchorOutId, regionInId, regionOutId }
