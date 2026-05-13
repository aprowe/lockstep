import type { DragState } from '../types'
import type { Anchor } from '../../types'

export type RegionBounds = { inPoint: number; outPoint: number }

/** Build a per-id map of live INPUT-SPACE region bounds from the current drag
 *  state. Covers single-region drags (region-edge / region-move) and combined
 *  drags (region-move with liveBoundsList, anchor with liveRegionBounds).
 *  Output-space drags are excluded — use liveOutputRegionOverrides for those. */
export function liveRegionOverrides(
  drag: DragState | null,
): Map<string, RegionBounds> {
  const m = new Map<string, RegionBounds>()
  if (!drag) return m

  if (drag.kind === 'region-edge' || drag.kind === 'region-move') {
    // Only apply to input-space drags here; output-space handled separately.
    if (drag.isOutput) return m
    if (drag.liveRegion) {
      m.set(drag.liveRegion.id, {
        inPoint: drag.liveRegion.inPoint,
        outPoint: drag.liveRegion.outPoint,
      })
    }
    if (drag.kind === 'region-move' && drag.liveBoundsList) {
      for (const r of drag.liveBoundsList) {
        m.set(r.id, { inPoint: r.inPoint, outPoint: r.outPoint })
      }
    }
  } else if (drag.kind === 'anchor' && drag.liveRegionBounds) {
    for (const r of drag.liveRegionBounds) {
      m.set(r.id, { inPoint: r.inPoint, outPoint: r.outPoint })
    }
  }

  return m
}

/** Build a per-id map of live OUTPUT-SPACE (beat-time) region bounds from the
 *  current drag state. Only populated when drag.isOutput is true — input-space
 *  drags return an empty map so clipin stays at slice state. */
export function liveOutputRegionOverrides(
  drag: DragState | null,
): Map<string, RegionBounds> {
  const m = new Map<string, RegionBounds>()
  if (!drag) return m

  if (drag.kind === 'region-edge' || drag.kind === 'region-move') {
    if (!drag.isOutput) return m
    if (drag.liveRegion) {
      m.set(drag.liveRegion.id, {
        inPoint: drag.liveRegion.inPoint,
        outPoint: drag.liveRegion.outPoint,
      })
    }
    if (drag.kind === 'region-move' && drag.liveBoundsList) {
      for (const r of drag.liveBoundsList) {
        m.set(r.id, { inPoint: r.inPoint, outPoint: r.outPoint })
      }
    }
  }

  return m
}

/** Return the live input-space anchors emitted by an active drag, or [] when
 *  none. Covers anchor drag (`liveAnchors`) and combined region-move with
 *  captured anchors (`liveAnchors` on region-move). */
export function liveAnchorOverrides(drag: DragState | null): Anchor[] {
  if (!drag) return []
  if (drag.kind === 'anchor') return drag.liveAnchors
  if (drag.kind === 'region-move' && drag.liveAnchors) return drag.liveAnchors
  return []
}

/** Return the live output-space (beat) anchors emitted by an active drag. */
export function liveBeatAnchorOverrides(drag: DragState | null): Anchor[] {
  if (!drag) return []
  if (drag.kind === 'anchor') return drag.liveBeatAnchors
  if (drag.kind === 'region-move' && drag.liveBeatAnchors) return drag.liveBeatAnchors
  // R4: clipout edge drag carrying a linked beat anchor.
  if (drag.kind === 'region-edge' && drag.liveBeatAnchors) return drag.liveBeatAnchors
  return []
}
