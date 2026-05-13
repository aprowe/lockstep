import type { Anchor } from '../../types'
import type { RegionBlock } from '../types'
import {
  conformClipoutToAnchors,
  conformClipoutToBeatAnchors,
  mergeConformWithLive,
} from './conform'

export interface ProjectClipoutInput {
  /** Input-space regions (canonical). */
  regions: RegionBlock[]
  /** Beat-space regions from slice (mapped from inBeatTime / outBeatTime). */
  regionsOutput?: RegionBlock[]
  /** Pre-drag input-space anchor identities (p.anchors). */
  origAnchors: Anchor[]
  /** LIVE beat-space anchors. */
  beatAnchors: Anchor[]
  /** LIVE input-space anchors. */
  liveInputAnchors: Anchor[]
  /** Per-id live bounds from an active multi-region drag. */
  liveRegionMap: ReadonlyMap<string, { inPoint: number; outPoint: number }>
  /** True when any anchor (input or beat) is currently being dragged. */
  anchorsDragging: boolean
}

/**
 * Compute the projected clipout-track regions given the input-space and
 * beat-space region lists plus the current drag state.
 *
 * Returns `undefined` when `regionsOutput` is absent (clipout track hidden).
 *
 * The projection applies two independent conform passes:
 *  1. **Input-side conform** (`conformClipoutToAnchors`): if an original
 *     anchor sits on a region's input-in edge, the clipout in-edge moves to
 *     the matched anchor's current beat time.  The sticky boundary match uses
 *     `origAnchors` so a live drag off the boundary doesn't break the conform.
 *  2. **Beat-side conform** (`conformClipoutToBeatAnchors`): if a beat anchor
 *     sits on the clipout's explicit beat-space boundary (within 1e-4 s), the
 *     clipout edge moves to the anchor's current beat time.  This is additive —
 *     it only overrides an edge when the beat-anchor match actually moved it.
 *
 * Multi-region drag (`liveRegionMap` non-empty): each captured region's
 * boundary anchor lookup runs against its ORIGINAL bounds (anchors don't
 * follow the clip during a drag).  Non-conformed edges follow the LIVE input
 * bound so the clipout tracks the drag.  Non-captured regions preserve
 * single-region semantics.
 *
 * `anchorsDragging` true + no live region map: only the active region gets
 * full input-side conform; non-active regions fall back to the verbatim
 * input-space bounds (beat-side conform still applies to all).
 */
export function projectClipoutRegions(
  p: ProjectClipoutInput,
): RegionBlock[] | undefined {
  if (!p.regionsOutput) return undefined

  // Symmetric beat-side conform: when a beat anchor sits on the clipout's
  // explicit beat-space boundary (within 1e-4 s), the clipout edge moves
  // to the anchor's current beat time. This pulls the clipout LIVE while
  // the user drags a beat anchor onto/off the boundary, mirroring the
  // input-side conform that the clipin track gets.
  //
  // The original beat-space bounds come from `p.regionsOutput[i]`
  // (mapped from `inBeatTime` / `outBeatTime` on the slice), so we
  // consult those — not the input bounds — for the beat-anchor match.
  function applyBeatConform(
    r: RegionBlock,
    base: { inPoint: number; outPoint: number },
  ): RegionBlock {
    const origBeatIn  = r.inPoint
    const origBeatOut = r.outPoint
    const beatConformed = conformClipoutToBeatAnchors(origBeatIn, origBeatOut, p.beatAnchors)
    // Only override an edge when the beat-anchor match actually moved
    // the edge. Otherwise keep `base` (the input-side conform / verbatim
    // result) — the beat conform should be additive, not destructive.
    const inPoint  = beatConformed.inPoint  !== origBeatIn  ? beatConformed.inPoint  : base.inPoint
    const outPoint = beatConformed.outPoint !== origBeatOut ? beatConformed.outPoint : base.outPoint
    return { ...r, inPoint, outPoint }
  }

  function clipoutFor(inputIn: number, inputOut: number, r: RegionBlock): RegionBlock {
    // Sticky boundary match: identify the anchor by its ORIGINAL time
    // (`origAnchors`) so a live anchor drag off the boundary doesn't break
    // the conform. The LIVE beat positions (`beatAnchors`) drive the
    // clipout edge — input-only drag keeps the original beat; warp-line
    // drag moves both partners. Fall back to LIVE inputs (`liveInputAnchors`)
    // for the symmetric "drag anchor onto boundary" case.
    const { inPoint: conformedIn, outPoint: conformedOut } = conformClipoutToAnchors(
      inputIn, inputOut,
      p.origAnchors,
      p.beatAnchors,
      p.liveInputAnchors,
    )
    // When the anchor conform actually moved an edge, use the conform result
    // (anchor's beat time). When no anchor matched, fall back to r.inPoint /
    // r.outPoint — the beat-space boundary from the slice (inBeatTime /
    // outBeatTime). Using the raw input-space value here discards any
    // explicit beat position the user set via a clipout drag/commit.
    return applyBeatConform(r, {
      inPoint:  conformedIn  !== inputIn  ? conformedIn  : r.inPoint,
      outPoint: conformedOut !== inputOut ? conformedOut : r.outPoint,
    })
  }

  // Multi-region drag: every captured region in `liveRegionMap` projects
  // to output space. For each captured region the boundary anchor lookup
  // runs against the ORIGINAL bounds (anchors don't follow the clip
  // during a drag), so a conform that engaged on an edge keeps its beat
  // position. Non-conformed edges fall back to the LIVE input bound so
  // the clipout tracks the drag (vertical case). Non-captured regions
  // preserve the original single-region semantics.
  if (p.liveRegionMap.size > 0) {
    return p.regionsOutput.map(r => {
      const inputR = p.regions.find(ri => ri.id === r.id)
      if (!inputR) return r
      const live = p.liveRegionMap.get(r.id)
      if (live) {
        // Conform lookup runs against the LIVE clip position (not the
        // original) so the clipout edge snaps to a beat anchor when the
        // live edge is on one, and follows the drag freely otherwise.
        // Using the original here caused the clipout to stay frozen at
        // the pre-drag anchor beat while the clip was being dragged away.
        const conformed = conformClipoutToAnchors(
          live.inPoint, live.outPoint,
          p.origAnchors, p.beatAnchors, p.liveInputAnchors,
        )
        // When conform didn't match an edge (returns the raw live input
        // coordinate), fall back to r.inPoint / r.outPoint — the beat-space
        // bound committed to the slice (inBeatTime / outBeatTime). Without
        // this fallback, a default-linked or conformed-but-not-committed
        // region would use live.inPoint (input-space) as the clipout
        // position, making the clipout "follow" the clipin drag live and
        // snap straight until release.
        return applyBeatConform(r, {
          inPoint:  conformed.inPoint  !== live.inPoint  ? conformed.inPoint  : r.inPoint,
          outPoint: conformed.outPoint !== live.outPoint ? conformed.outPoint : r.outPoint,
        })
      }
      // Non-captured region (B, C when only A is being dragged): apply the
      // full input-side conform so they continue to display their visually-
      // conformed clipout. clipoutFor falls back to r.inPoint / r.outPoint
      // (the committed beat-space bound) when no anchor matches, so explicit
      // inBeatTime / outBeatTime values are preserved.
      return clipoutFor(inputR.inPoint, inputR.outPoint, r)
    })
  }
  if (p.anchorsDragging) {
    // During an anchor drag every region (active or not) should receive the
    // full input-side conform check so the clipout updates live as the dragged
    // anchor approaches the region's inPoint/outPoint. The active-only guard
    // was appropriate for clipin region drags (where non-active regions keep
    // their slice bounds to avoid clipout following clipin), but for anchor
    // drags ALL regions should detect coincidence in real time.
    return p.regionsOutput.map(r => {
      const inputR = p.regions.find(ri => ri.id === r.id)
      if (!inputR) return r
      return clipoutFor(inputR.inPoint, inputR.outPoint, r)
    })
  }
  return p.regionsOutput.map(r => {
    const inputR = p.regions.find(ri => ri.id === r.id)
    if (!inputR) return r
    return clipoutFor(inputR.inPoint, inputR.outPoint, r)
  })
}
