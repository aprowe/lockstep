import { createSelector } from "@reduxjs/toolkit";
import type { RootState } from "../store";
import type { Anchor } from "../../types";
import {
    selectSortedOrig,
    selectSortedBeat,
    selectActiveRegion,
    selectClipIn,
    selectClipOut,
    selectLinkedAnchorIds,
    selectSelectedIdsUnion,
} from "../selectors";
import { augmentBoundaryAnchors } from "../../utils/anchorAugment";

/**
 * Memoized timeline-display derivations. Keeps `WarpView` and other timeline
 * surfaces as pure wiring — every non-trivial slice derivation lives here.
 */

/** Beat anchors as `{ id, time }[]`, ordered by orig-anchor sort order. */
export const selectQuantAnchors = createSelector(selectSortedBeat, (sortedBeat): Anchor[] =>
    sortedBeat.map((a) => ({ id: a.id, time: a.time })),
);

/** Input-space snap targets derived from slice state — the orig-anchor times.
 *  Callers union this with scene cuts where applicable. */
export const selectSnapTargetsInput = createSelector(
    (s: RootState) => s.warp.origAnchors,
    (origAnchors): number[] => origAnchors.map((a) => a.time),
);

/** Output-space snap targets: beat-anchor times, plus the active region's
 *  beat-space edges when a clip is active. */
export const selectSnapTargetsOutput = createSelector(
    selectQuantAnchors,
    selectClipIn,
    selectActiveRegion,
    (quantAnchors, clipIn, activeRegion): number[] => {
        const beatTimes = quantAnchors.map((a) => a.time);
        if (clipIn === undefined) return beatTimes;
        const beatIn = activeRegion?.inBeatTime ?? clipIn;
        const beatOut = activeRegion?.outBeatTime ?? clipIn;
        return [...beatTimes, beatIn, beatOut];
    },
);

/** Augmented orig-anchor array used as the segment boundary set: real
 *  orig anchors plus synthetic boundary entries (id < 0) at clipIn / clipOut
 *  when an active region's edges aren't already covered by a real anchor. */
export const selectSegmentAnchors = createSelector(
    selectSortedOrig,
    selectClipIn,
    selectClipOut,
    (sortedOrig, clipIn, clipOut): Anchor[] => augmentBoundaryAnchors(sortedOrig, clipIn, clipOut),
);

/** Per-segment-anchor boolean: true when the anchor is a synthetic boundary
 *  (id < 0) OR its beat partner is linked. Drives the warp-connector display. */
export const selectLinkedBoundaries = createSelector(
    selectSegmentAnchors,
    selectLinkedAnchorIds,
    (segmentAnchors, linkedAnchorIds): boolean[] =>
        segmentAnchors.map((a) => a.id < 0 || linkedAnchorIds.has(a.id)),
);

/** Per-segment-anchor boolean: true when the anchor's id is in the union
 *  selected set (orig or beat). */
export const selectSelectedBoundaries = createSelector(
    selectSegmentAnchors,
    selectSelectedIdsUnion,
    (segmentAnchors, selectedIds): boolean[] => segmentAnchors.map((a) => selectedIds.has(a.id)),
);

/** Beat-grid origin (offset):
 *   - no clip active → first beat anchor's time
 *   - clip active + `beatZeroId` set → that beat anchor's time
 *   - clip active + no beatZero → active region's inBeatTime (or clipIn). */
export const selectBeatOffset = createSelector(
    selectClipIn,
    selectActiveRegion,
    (s: RootState) => s.warp.beatZeroId,
    selectSortedBeat,
    (clipIn, activeRegion, beatZeroId, sortedBeat): number => {
        if (clipIn === undefined) return sortedBeat[0]?.time ?? 0;
        if (beatZeroId !== null) {
            const z = sortedBeat.find((a) => a.id === beatZeroId);
            if (z) return z.time;
        }
        return activeRegion?.inBeatTime ?? clipIn;
    },
);
