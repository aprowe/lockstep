import type { Anchor, Region } from '../../types'

// Tolerance for "coincident" — 1e-4 seconds matches existing usage in
// conform.ts and clipoutProjection.ts.
export const LINK_EPSILON = 1e-4

/** Pair of input anchor + paired beat anchor (matched by id). Beat partner
 *  may be missing if pairings get torn. Most call sites only need both. */
export interface AnchorPair {
  input: Anchor | undefined
  beat: Anchor | undefined
}

/** Edge-level link state for one region. Each side is either the matched
 *  pair (when within tolerance) or undefined. */
export interface RegionLinkState {
  inputIn: AnchorPair | undefined
  inputOut: AnchorPair | undefined
  outputIn: AnchorPair | undefined
  outputOut: AnchorPair | undefined
}

/**
 * Whether the region's clipout coincides with its clipin (within tolerance
 * on BOTH edges). When `false`, region is in diverged state per design §1.2.
 *
 * inBeatTime / outBeatTime default to inPoint / outPoint when absent
 * (the region hasn't had explicit beat bounds set, so it is default-linked).
 */
export function isDefaultLinked(region: Region): boolean {
  const inBeatTime = region.inBeatTime ?? region.inPoint
  const outBeatTime = region.outBeatTime ?? region.outPoint
  return (
    Math.abs(inBeatTime - region.inPoint) <= LINK_EPSILON &&
    Math.abs(outBeatTime - region.outPoint) <= LINK_EPSILON
  )
}

/**
 * Among anchors that match `time` within LINK_EPSILON, pick the one with
 * the smallest id (degenerate case: two anchors at the same time).
 */
function findAnchorAt(time: number, anchors: readonly Anchor[]): Anchor | undefined {
  let best: Anchor | undefined
  for (const a of anchors) {
    if (Math.abs(a.time - time) <= LINK_EPSILON) {
      if (best === undefined || a.id < best.id) {
        best = a
      }
    }
  }
  return best
}

/**
 * Detect input-side link state: input anchors whose `time` matches
 * region.inPoint / region.outPoint.
 *
 * For each matching input anchor, the beat partner is looked up by id
 * in beatAnchors (may be undefined if pairing is torn).
 */
export function detectInputLinks(
  region: Region,
  anchors: readonly Anchor[],
  beatAnchors: readonly Anchor[],
): Pick<RegionLinkState, 'inputIn' | 'inputOut'> {
  const beatById = new Map<number, Anchor>()
  for (const b of beatAnchors) beatById.set(b.id, b)

  function makePair(time: number): AnchorPair | undefined {
    const input = findAnchorAt(time, anchors)
    if (input === undefined) return undefined
    return { input, beat: beatById.get(input.id) }
  }

  return {
    inputIn: makePair(region.inPoint),
    inputOut: makePair(region.outPoint),
  }
}

/**
 * Detect output-side link state: beat anchors whose `time` matches
 * region.inBeatTime / region.outBeatTime.
 *
 * For each matching beat anchor, the input partner is looked up by id
 * in anchors (may be undefined if pairing is torn).
 *
 * When inBeatTime / outBeatTime are absent on the region, falls back to
 * inPoint / outPoint (identity / default-linked state).
 *
 * Note: AnchorPair.input may be undefined when pairing is torn (the
 * beat anchor exists but its input partner was removed). The cast to
 * `Anchor` in the return is intentional — callers must guard when
 * anchorLock or other torn-pairing scenarios are possible.
 */
export function detectOutputLinks(
  region: Region,
  anchors: readonly Anchor[],
  beatAnchors: readonly Anchor[],
): Pick<RegionLinkState, 'outputIn' | 'outputOut'> {
  const inputById = new Map<number, Anchor>()
  for (const a of anchors) inputById.set(a.id, a)

  const inBeatTime = region.inBeatTime ?? region.inPoint
  const outBeatTime = region.outBeatTime ?? region.outPoint

  function makePair(time: number): AnchorPair | undefined {
    const beat = findAnchorAt(time, beatAnchors)
    if (beat === undefined) return undefined
    return { input: inputById.get(beat.id), beat }
  }

  return {
    outputIn: makePair(inBeatTime),
    outputOut: makePair(outBeatTime),
  }
}

/**
 * Combine both sides. Convenience for callers that need the full picture.
 */
export function detectLinkState(
  region: Region,
  anchors: readonly Anchor[],
  beatAnchors: readonly Anchor[],
): RegionLinkState {
  return {
    ...detectInputLinks(region, anchors, beatAnchors),
    ...detectOutputLinks(region, anchors, beatAnchors),
  }
}
