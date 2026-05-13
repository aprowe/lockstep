import type { Region, Anchor } from '../../types'
import { detectInputLinks } from './linkState'

/** Compute the effective beat-space bounds for a region, accounting for
 *  visual conform from coincident input anchors. The slice stores
 *  inBeatTime/outBeatTime only when the user explicitly diverged via
 *  clipout drag/resize; for default-linked regions, this helper checks
 *  for input-anchor coincidence and returns the paired beat anchor's
 *  beat time as the effective boundary.
 *
 *  Priority order per edge:
 *    1. region.inBeatTime / outBeatTime (explicit commit) wins.
 *    2. Input-anchor conform (input anchor at inPoint/outPoint → paired
 *       beat anchor's beat time) when undefined above.
 *    3. Fallback to inPoint / outPoint (treat input-space coord as
 *       beat-space — matches existing default-linked semantics for
 *       non-warp contexts where input ≈ beat).
 */
export interface EffectiveBeatBounds {
  inBeatTime: number
  outBeatTime: number
}

export function effectiveBeatBounds(
  region: Region,
  origAnchors: readonly Anchor[],
  beatAnchors: readonly Anchor[],
): EffectiveBeatBounds {
  // Priority 1: both explicit — fast path, no anchor lookup needed.
  if (region.inBeatTime !== undefined && region.outBeatTime !== undefined) {
    return { inBeatTime: region.inBeatTime, outBeatTime: region.outBeatTime }
  }

  // Priority 2: input-anchor conform — check whether an input anchor sits at
  // inPoint / outPoint and, if so, use its paired beat anchor's beat time.
  const inLinks = detectInputLinks(region, origAnchors, beatAnchors)

  const inBeatTime =
    region.inBeatTime ?? inLinks.inputIn?.beat?.time ?? region.inPoint
  const outBeatTime =
    region.outBeatTime ?? inLinks.inputOut?.beat?.time ?? region.outPoint

  return { inBeatTime, outBeatTime }
}
