import { createSelector } from "@reduxjs/toolkit";
import type { RootState } from "./store";
import type { Anchor } from "../types";
import { computeOutputDuration } from "../utils/quantize";
import { effectiveBeatBounds } from "../timeline/model/effectiveBounds";
import type { EffectiveBeatBounds } from "../timeline/model/effectiveBounds";
import { anchorInId, anchorOutId, regionInId, regionOutId } from "../constraints/ids";
import { selectConstraintGraph } from "./selectors/constraintGraph";
import { readAnchorTime, readClipBounds } from "./graphBridge";

export { selectConstraintGraph };

// ── Region selectors ────────────────────────────────────────────────────────

/**
 * The active region (or null when none is active). Reads from the region
 * slice, which the constraint pipeline keeps in sync.
 */
export const selectActiveRegion = createSelector(
    (s: RootState) => s.region.regions,
    (s: RootState) => s.region.activeRegionId,
    (regions, id) => {
        if (!id) return null;
        const r = regions.find((r) => r.id === id);
        return r ?? null;
    },
);

export const selectClipIn = createSelector(selectActiveRegion, (r) => r?.inPoint);

export const selectClipOut = createSelector(selectActiveRegion, (r) => r?.outPoint);

// ── Warp selectors ──────────────────────────────────────────────────────────

/**
 * Orig anchors sorted ascending by `time`.
 */
export const selectSortedOrig = createSelector(
    (s: RootState) => s.warp.origAnchors,
    (anchors) => {
        return [...anchors].sort((a, b) => a.time - b.time);
    },
);

export const selectSortedBeat = createSelector(
    selectSortedOrig,
    (s: RootState) => s.warp.beatAnchors,
    (sortedOrig, beatAnchors) =>
        sortedOrig.map((oa) => {
            const sliceBeat = beatAnchors.find((ba) => ba.id === oa.id);
            return sliceBeat ?? { id: oa.id, time: oa.time };
        }),
);

export const selectSelectedOrigIdsSet = createSelector(
    (s: RootState) => s.warp.selectedOrigIds,
    (ids) => new Set(ids),
);

export const selectSelectedBeatIdsSet = createSelector(
    (s: RootState) => s.warp.selectedBeatIds,
    (ids) => new Set(ids),
);

/** Union of orig + beat selected ids — used where a single "is any space
 *  selected" query is needed (e.g. Delete key handling, region thunks). */
export const selectSelectedIdsUnion = createSelector(
    (s: RootState) => s.warp.selectedOrigIds,
    (s: RootState) => s.warp.selectedBeatIds,
    (origIds, beatIds) => new Set([...origIds, ...beatIds]),
);

export const selectOutputDuration = createSelector(
    selectSortedOrig,
    selectSortedBeat,
    (s: RootState) => s.video.video?.duration ?? 60,
    (sortedOrig, sortedBeat, duration) => computeOutputDuration(sortedOrig, sortedBeat, duration),
);

/** Derive the set of linked anchor IDs from the slice.
 *  An anchor is "linked" when beatAnchors[n].linked !== false. */
export const selectLinkedAnchorIds = createSelector(
    (s: RootState) => s.warp.beatAnchors,
    (beatAnchors) => {
        const ids = new Set<number>();
        for (const a of beatAnchors) {
            if (a.linked !== false) ids.add(a.id);
        }
        return ids;
    },
);

/** WarpData-shaped projection for components that consume the bundle as a
 *  single object (anchors + bpm + stretch bounds). */
export const selectWarpData = createSelector(
    (s: RootState) => s.warp,
    (warp) => ({
        origAnchors: warp.origAnchors,
        beatAnchors: warp.beatAnchors,
        bpm: warp.bpm,
        minStretch: warp.minStretch,
        maxStretch: warp.maxStretch,
    }),
);

// ── Effective beat bounds ────────────────────────────────────────────────────

/** Effective beat-space bounds for the active region: explicit inBeatTime/
 *  outBeatTime win; then input-anchor conform fills in defaults; then falls
 *  back to inPoint/outPoint. Returns null when no region is active. */
export const selectEffectiveBeatBoundsForActive = createSelector(
    selectActiveRegion,
    (s: RootState) => s.warp.origAnchors,
    (s: RootState) => s.warp.beatAnchors,
    (region, origAnchors, beatAnchors): EffectiveBeatBounds | null => {
        if (!region) return null;
        return effectiveBeatBounds(region, origAnchors, beatAnchors);
    },
);

// ── Dimmed anchors (outside active region) ──────────────────────────────────

export const selectDimmedAnchorIds = createSelector(
    (s: RootState) => s.warp.origAnchors,
    selectClipIn,
    selectClipOut,
    (anchors, clipIn, clipOut) => {
        if (clipIn === undefined && clipOut === undefined) return undefined;
        const ids = new Set<number>();
        for (const a of anchors) {
            if (
                (clipIn !== undefined && a.time < clipIn - 0.001) ||
                (clipOut !== undefined && a.time > clipOut + 0.001)
            ) {
                ids.add(a.id);
            }
        }
        return ids.size > 0 ? ids : undefined;
    },
);

// ── Per-id position lookups ─────────────────────────────────────────────────

/** Return the orig (input-space) time for a given anchor pair id. */
export const selectAnchorOrigTime = (s: RootState, anchorId: number): number | undefined =>
    s.warp.origAnchors.find((a) => a.id === anchorId)?.time;

/** Return the beat (output-space) time for a given anchor pair id. */
export const selectAnchorBeatTime = (s: RootState, anchorId: number): number | undefined =>
    s.warp.beatAnchors.find((a) => a.id === anchorId)?.time;

/** Defensive copy of the orig anchor list. */
export const selectOrigAnchorsFromGraph = createSelector(
    (s: RootState) => s.warp.origAnchors,
    (sliceOrig): Anchor[] => [...sliceOrig],
);

/** Defensive copy of the beat anchor list. */
export const selectBeatAnchorsFromGraph = createSelector(
    (s: RootState) => s.warp.beatAnchors,
    (sliceBeat): Anchor[] => [...sliceBeat],
);

/** Region inPoint by id. */
export const selectRegionInPoint = (s: RootState, regionId: string): number | undefined =>
    s.region.regions.find((r) => r.id === regionId)?.inPoint;

export const selectRegionOutPoint = (s: RootState, regionId: string): number | undefined =>
    s.region.regions.find((r) => r.id === regionId)?.outPoint;

/** Region clipout `in` (beat-space) by id. */
export const selectRegionInBeatTime = (s: RootState, regionId: string): number | undefined =>
    s.region.regions.find((r) => r.id === regionId)?.inBeatTime;

export const selectRegionOutBeatTime = (s: RootState, regionId: string): number | undefined =>
    s.region.regions.find((r) => r.id === regionId)?.outBeatTime;

// Convenience re-exports — graphBridge read helpers and entity-id builders.
export { readAnchorTime, readClipBounds };
export { anchorInId, anchorOutId, regionInId, regionOutId };
