import type { RootState, AppDispatch } from '../store'
import { setBeatAnchorsFromTimeline } from '../slices/warpSlice'
import { applyConformedClipout } from '../slices/regionSlice'
import { detectInputLinks } from '../../timeline/model/linkState'
import { effectiveBeatBounds } from '../../timeline/model/effectiveBounds'
import { LINK_EPSILON } from '../../timeline/model/linkState'
import type { Anchor, Region } from '../../types'

/**
 * Detect beat anchors that are "conformed" at the clipout boundaries via
 * INPUT-SIDE coincidence only (input anchor at region.inPoint/outPoint).
 *
 * Output-side coincidence (beat anchor already at inBeatTime/outBeatTime)
 * is intentionally excluded: an anchor that merely sits at the clipout edge
 * in beat space should NOT be carried when the user resizes/pans the clipout,
 * only when the anchor is genuinely conformed via an input-side link.
 *
 * Deduplicates by anchorId so each anchor appears at most once.
 */
function detectConformedMoves(
  region: { inPoint: number; outPoint: number; inBeatTime?: number; outBeatTime?: number },
  inputAnchors: readonly Anchor[],
  beatAnchors: readonly Anchor[],
  newInBeatTime: number,
  newOutBeatTime: number,
): Array<{ anchorId: number; to: number }> {
  const moves = new Map<number, number>()

  // Input-side links: beat anchor moves to the new clipout edge it was paired with.
  const inLinks = detectInputLinks(
    region as Parameters<typeof detectInputLinks>[0],
    inputAnchors,
    beatAnchors,
  )
  if (inLinks.inputIn?.beat) {
    moves.set(inLinks.inputIn.beat.id, newInBeatTime)
  }
  if (inLinks.inputOut?.beat) {
    moves.set(inLinks.inputOut.beat.id, newOutBeatTime)
  }

  return Array.from(moves.entries()).map(([anchorId, to]) => ({ anchorId, to }))
}

/**
 * Commit a clipout RESIZE — edge dragged.
 *
 * - Detects conformed beat anchors at the old clipout boundaries and moves
 *   each to its corresponding new boundary position (carry-with-edge).
 * - Computes effectiveAnchorLock = ui.anchorLock XOR altKey.
 * - If effectiveAnchorLock AND region.lock === 'beats': rescales inner beat
 *   anchors proportionally around the new inBeatTime (separate from conformed
 *   marker carry — apply carry first, then rescale only non-carried anchors).
 *   Pan-side does the same without the region.lock check — translation makes
 *   sense for either lock mode; rescale only makes sense when beats are the
 *   fixed quantity (length changes → anchors scale with the new length).
 * - Always: applyConformedClipout({ id, inBeatTime, outBeatTime }).
 *
 * This is the single authoritative place for the resize anchor-lock decision.
 * WarpView and §13 BDD tests both dispatch this thunk.
 */
export const commitClipoutResize =
  (payload: { id: string; inBeatTime: number; outBeatTime: number; altKey: boolean }) =>
  (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState()
    const region = state.region.regions.find(r => r.id === payload.id)
    if (!region) return

    const inputAnchors = state.warp.origAnchors
    const beatAnchors = state.warp.beatAnchors
    const { inBeatTime: oldInBeat, outBeatTime: oldOutBeat } =
      effectiveBeatBounds(region, inputAnchors, beatAnchors)

    // 1. Detect conformed markers and carry them to the new edge positions.
    const conformedMoves = detectConformedMoves(
      region, inputAnchors, beatAnchors, payload.inBeatTime, payload.outBeatTime,
    )
    const conformedIds = new Set(conformedMoves.map(m => m.anchorId))

    // 2. Anchor-lock rescale for non-carried anchors.
    const effectiveAnchorLock = state.ui.anchorLock !== payload.altKey // XOR
    const shouldRescale = effectiveAnchorLock && region.lock === 'beats'

    let nextBeatAnchors = beatAnchors as Anchor[]

    if (conformedMoves.length > 0 || shouldRescale) {
      const oldLength = oldOutBeat - oldInBeat
      const newLength = payload.outBeatTime - payload.inBeatTime
      const scaleFactor = (shouldRescale && oldLength > 1e-9 && newLength > 1e-9)
        ? newLength / oldLength
        : null

      nextBeatAnchors = beatAnchors.map(a => {
        // Conformed-marker carry takes priority.
        const carry = conformedMoves.find(m => m.anchorId === a.id)
        if (carry) return { ...a, time: carry.to }
        // Proportional rescale for non-carried anchors inside the old bounds.
        if (scaleFactor !== null && a.time >= oldInBeat && a.time <= oldOutBeat && !conformedIds.has(a.id)) {
          return { ...a, time: payload.inBeatTime + (a.time - oldInBeat) * scaleFactor }
        }
        return a
      })
      dispatch(setBeatAnchorsFromTimeline(nextBeatAnchors))
    }

    dispatch(applyConformedClipout({
      id: payload.id,
      inBeatTime: payload.inBeatTime,
      outBeatTime: payload.outBeatTime,
      origAnchors: inputAnchors,
      beatAnchors,
    }))
  }

/**
 * Compute the set of beat-anchor ids STRICTLY INSIDE the pre-drag region's
 * beat-space window, mirroring the logic in panClipinBounds / computeInnerAnchorIds.
 * Boundary anchors (within LINK_EPSILON of the effective bounds) are excluded so
 * conformed-edge anchors are handled by detectConformedMoves, not here.
 */
function computeInnerBeatAnchorIds(
  region: Region,
  origAnchors: readonly Anchor[],
  beatAnchors: readonly Anchor[],
): Set<number> {
  const { inBeatTime, outBeatTime } = effectiveBeatBounds(region, origAnchors, beatAnchors)
  const out = new Set<number>()
  for (const a of beatAnchors) {
    if (a.time > inBeatTime + LINK_EPSILON && a.time < outBeatTime - LINK_EPSILON) {
      out.add(a.id)
    }
  }
  return out
}

/**
 * Commit a clipout BODY PAN — region body translated. Length unchanged.
 *
 * - Detects conformed beat anchors at the old clipout boundaries and translates
 *   them by the same delta as the pan (carry-with-edges).
 * - Computes effectiveAnchorLock = ui.anchorLock XOR altKey.
 * - If effectiveAnchorLock: translates ALL inner beat anchors (not just conformed
 *   ones) by delta.
 * - Always: applyConformedClipout({ id, inBeatTime, outBeatTime }).
 *
 * This is the single authoritative place for the pan anchor-lock decision.
 * WarpView and §13 BDD tests both dispatch this thunk.
 */
export const commitClipoutPan =
  (payload: { id: string; inBeatTime: number; outBeatTime: number; altKey: boolean }) =>
  (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState()
    const region = state.region.regions.find(r => r.id === payload.id)
    if (!region) return

    const inputAnchors = state.warp.origAnchors
    const beatAnchors = state.warp.beatAnchors
    const effectiveAnchorLock = state.ui.anchorLock !== payload.altKey // XOR

    // Use the pre-drag snapshot to determine which anchors were inside the region
    // at drag start. This prevents anchors panned ACROSS the boundary from being
    // picked up mid-drag — only anchors inside at drag start are translated.
    const preDragRegion    = state.drag.preDrag?.regions.find(r => r.id === payload.id) ?? region
    const preDragOrigAnchors = state.drag.preDrag?.origAnchors ?? inputAnchors
    const preDragBeatAnchors = state.drag.preDrag?.beatAnchors ?? beatAnchors

    const { inBeatTime: preDragInBeat } =
      effectiveBeatBounds(preDragRegion, preDragOrigAnchors, preDragBeatAnchors)
    const totalDelta = payload.inBeatTime - preDragInBeat

    // 1. Detect conformed markers at the PRE-DRAG edges (carry-with-edges).
    const conformedMoves = detectConformedMoves(
      preDragRegion, preDragOrigAnchors, preDragBeatAnchors, payload.inBeatTime, payload.outBeatTime,
    )
    const conformedIds = new Set(conformedMoves.map(m => m.anchorId))

    const needsDispatch = (effectiveAnchorLock && Math.abs(totalDelta) > 1e-9) || conformedMoves.length > 0

    if (needsDispatch) {
      // Compute the frozen inner-anchor set from the pre-drag snapshot.
      const innerIds = effectiveAnchorLock
        ? computeInnerBeatAnchorIds(preDragRegion, preDragOrigAnchors, preDragBeatAnchors)
        : new Set<number>()

      const translated = beatAnchors.map(a => {
        // Conformed-marker carry takes priority.
        if (conformedIds.has(a.id)) {
          const carry = conformedMoves.find(m => m.anchorId === a.id)!
          return { ...a, time: carry.to }
        }
        // AnchorLock translate for anchors that were STRICTLY INSIDE at drag start.
        // Apply total delta to the pre-drag anchor position (drift-free).
        if (effectiveAnchorLock && Math.abs(totalDelta) > 1e-9 && innerIds.has(a.id)) {
          const preDragTime = preDragBeatAnchors.find(p => p.id === a.id)?.time ?? a.time
          return { ...a, time: preDragTime + totalDelta }
        }
        return a
      })
      dispatch(setBeatAnchorsFromTimeline(translated))
    }

    dispatch(applyConformedClipout({
      id: payload.id,
      inBeatTime: payload.inBeatTime,
      outBeatTime: payload.outBeatTime,
      origAnchors: inputAnchors,
      beatAnchors,
    }))
  }
