import type { Anchor } from '../types'

/** Synthetic id used for the clip-in boundary anchor. */
export const CLIP_IN_BOUNDARY_ID = -9998
/** Synthetic id used for the clip-out boundary anchor. */
export const CLIP_OUT_BOUNDARY_ID = -9999
/** Tolerance for merging a real anchor at the boundary with the synthetic one. */
export const BOUNDARY_EPS = 0.01

/**
 * Augment a sorted anchor array with synthetic boundary anchors at `clipIn`
 * and/or `clipOut`, when the existing endpoints don't already sit within
 * `BOUNDARY_EPS` of those positions.
 *
 * Returns a new array; never mutates the input. When both `clipIn` and
 * `clipOut` are undefined, returns the input as-is.
 */
export function augmentBoundaryAnchors(
  sorted: Anchor[],
  clipIn?: number,
  clipOut?: number,
): Anchor[] {
  if (clipIn === undefined && clipOut === undefined) return sorted
  const aug = [...sorted]
  if (clipIn !== undefined && (aug.length === 0 || aug[0].time - clipIn > BOUNDARY_EPS)) {
    aug.unshift({ id: CLIP_IN_BOUNDARY_ID, time: clipIn })
  }
  if (clipOut !== undefined && (aug.length === 0 || clipOut - aug[aug.length - 1].time > BOUNDARY_EPS)) {
    aug.push({ id: CLIP_OUT_BOUNDARY_ID, time: clipOut })
  }
  return aug
}

/**
 * Paired version of {@link augmentBoundaryAnchors}: decides whether to prepend
 * or append a boundary anchor based on the `orig` array, then mirrors the same
 * insertions into the matched `beat` array using the supplied beat-space
 * boundary times. The two input arrays must be index-paired (same length,
 * matched per index).
 */
export function augmentBoundaryAnchorsPaired(
  orig: Anchor[],
  beat: Anchor[],
  clipIn?: number,
  clipOut?: number,
  clipInBeatTime?: number,
  clipOutBeatTime?: number,
): { orig: Anchor[]; beat: Anchor[] } {
  if (clipIn === undefined && clipOut === undefined) return { orig, beat }
  const augOrig = [...orig]
  const augBeat = [...beat]
  if (clipIn !== undefined && (augOrig.length === 0 || augOrig[0].time - clipIn > BOUNDARY_EPS)) {
    augOrig.unshift({ id: CLIP_IN_BOUNDARY_ID, time: clipIn })
    augBeat.unshift({ id: CLIP_IN_BOUNDARY_ID, time: clipInBeatTime ?? clipIn })
  }
  if (clipOut !== undefined && (augOrig.length === 0 || clipOut - augOrig[augOrig.length - 1].time > BOUNDARY_EPS)) {
    augOrig.push({ id: CLIP_OUT_BOUNDARY_ID, time: clipOut })
    augBeat.push({ id: CLIP_OUT_BOUNDARY_ID, time: clipOutBeatTime ?? clipOut })
  }
  return { orig: augOrig, beat: augBeat }
}
