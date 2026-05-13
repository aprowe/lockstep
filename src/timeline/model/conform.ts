import type { Anchor } from '../../types'

const TOL = 1e-4

function anchorBeatAt(
  t: number,
  anchors: Anchor[],
  beatById: Map<number, number>,
): number | undefined {
  const a = anchors.find(a => Math.abs(a.time - t) < TOL)
  return a ? beatById.get(a.id) : undefined
}

/**
 * Given a region's input bounds and the anchor set, compute the beat-space
 * bounds the clipout track should display.
 *
 * Rule: each edge is conformed independently. If an anchor sits exactly on
 * the input-in edge (within 1e-4 s), the clipout in edge moves to that
 * anchor's beat time. Likewise for the input-out edge. An edge with no
 * matching anchor stays vertical (equal to the input bound). When neither
 * edge has an anchor, the region is returned unchanged.
 *
 * Sticky boundary match (live drag): callers pass the ORIGINAL input
 * anchors as `anchors` so the boundary lookup stays stable when the user
 * drags an anchor off the boundary. The LIVE beat positions are then used
 * (via the matched id) to drive the clipout's edge — so an input-only drag
 * leaves the clipout at the original beat, and a warp-line drag moves it
 * with the beat partner. An optional `liveAnchors` array covers the
 * symmetric case where the user drags an anchor that wasn't originally
 * at the boundary ONTO it; the lookup falls back to the live array when
 * the original lookup misses.
 */
export function conformClipoutToAnchors(
  inputIn: number,
  inputOut: number,
  anchors: Anchor[],
  beatAnchors: Anchor[],
  liveAnchors?: Anchor[],
): { inPoint: number; outPoint: number } {
  const beatById = new Map<number, number>()
  for (const b of beatAnchors) beatById.set(b.id, b.time)
  // Dual lookup: try the original anchors first (sticky during-drag), then
  // fall back to the live array (drag-onto-boundary). The same anchor id
  // drives the beat lookup either way.
  const lookup = (t: number): number | undefined => {
    const fromOrig = anchorBeatAt(t, anchors, beatById)
    if (fromOrig !== undefined) return fromOrig
    return liveAnchors ? anchorBeatAt(t, liveAnchors, beatById) : undefined
  }
  const inBeat = lookup(inputIn)
  const outBeat = lookup(inputOut)
  // Each edge is conformed independently. Return unchanged only when neither
  // edge has a matching anchor.
  if (inBeat === undefined && outBeat === undefined)
    return { inPoint: inputIn, outPoint: inputOut }
  return { inPoint: inBeat ?? inputIn, outPoint: outBeat ?? inputOut }
}

/**
 * Merge a conform result with live drag bounds. Each edge takes the conformed
 * value if conform actually moved it; otherwise it follows the live input bound.
 *
 * Used when a clip is being dragged: the boundary anchor lookup runs against
 * the original (pre-drag) bounds, but the non-conformed edges follow the live
 * clip position so the clipout tracks the drag.
 */
export function mergeConformWithLive(
  orig: { inPoint: number; outPoint: number },
  conformed: { inPoint: number; outPoint: number },
  live: { inPoint: number; outPoint: number },
): { inPoint: number; outPoint: number } {
  return {
    inPoint: conformed.inPoint !== orig.inPoint ? conformed.inPoint : live.inPoint,
    outPoint: conformed.outPoint !== orig.outPoint ? conformed.outPoint : live.outPoint,
  }
}

/**
 * Symmetric counterpart for the OUTPUT side: when a BEAT anchor sits on the
 * clipout's explicit beat-space boundary (beatIn / beatOut), the clipout
 * displays the anchor's beat time at that edge.
 *
 * Drives live conform while the user drags a beat anchor onto a clipout
 * boundary — the clipout follows the dragged anchor's current beat position.
 *
 * Tolerance: 1e-4 s, matching conformClipoutToAnchors. Each edge is
 * conformed independently — a single anchor on `beatIn` only affects the in
 * edge; the out edge stays at `beatOut`. When no beat anchor matches either
 * edge, the inputs are returned unchanged.
 */
export function conformClipoutToBeatAnchors(
  beatIn: number,
  beatOut: number,
  beatAnchors: Anchor[],
): { inPoint: number; outPoint: number } {
  const inMatch = beatAnchors.find(b => Math.abs(b.time - beatIn) < TOL)
  const outMatch = beatAnchors.find(b => Math.abs(b.time - beatOut) < TOL)
  return {
    inPoint: inMatch ? inMatch.time : beatIn,
    outPoint: outMatch ? outMatch.time : beatOut,
  }
}
