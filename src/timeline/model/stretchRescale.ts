import type { Region, Anchor } from '../../types'

export interface StretchRescaleInput {
  region: Region
  /** Either newBpm OR newLockedBeats must be provided. The other derives.
   *  Providing both or neither is a caller bug and will throw. */
  newBpm?: number
  newLockedBeats?: number
  /** Beat anchors in the warp — only those whose `time` falls inside the
   *  region's existing beat-space window will be rescaled. */
  beatAnchors: readonly Anchor[]
}

export interface StretchRescaleResult {
  /** New beat-space length (= 60 × lockedBeats / bpm). */
  newClipoutLength: number
  /** New outBeatTime: inBeatTime + newClipoutLength. inBeatTime stays put. */
  newOutBeatTime: number
  /** Updated beat-space anchor positions for anchors INSIDE the region's
   *  beat-space window. Anchors outside the window are absent from this map
   *  (caller leaves them untouched). Empty map when no anchors are inside. */
  rescaledBeatAnchors: ReadonlyMap<number, number>
  /** Final bpm after the edit. */
  bpm: number
  /** Final lockedBeats after the edit. */
  lockedBeats: number
}

/**
 * Pure stretch-model BPM/beats edit (design §6.1, §11).
 *
 * Computes the new clipout length and proportionally-rescaled beat anchor
 * positions for a stretch-model BPM or locked-beats edit.
 *
 * Stretch model invariant:
 *  - BPM edit   → lockedBeats stays fixed; clipoutLength = 60 × lockedBeats / newBpm
 *  - Beats edit  → BPM stays fixed;        clipoutLength = 60 × newLockedBeats / bpm
 *
 * Beat anchors INSIDE the region's beat-space window [inBeatTime, outBeatTime]
 * are rescaled proportionally around inBeatTime.  Anchors outside the window
 * are excluded from `rescaledBeatAnchors` — the caller leaves them untouched.
 *
 * NOTE: This function does NOT touch input-space clip bounds (inPoint /
 * outPoint).  For the default-linked case (inPoint === inBeatTime) the caller
 * is responsible for propagating the beat-space length change to the input
 * side if desired.
 */
export function stretchRescale(input: StretchRescaleInput): StretchRescaleResult {
  const { region, beatAnchors } = input
  const hasBpm    = input.newBpm          !== undefined
  const hasBeats  = input.newLockedBeats  !== undefined

  if (hasBpm && hasBeats) {
    throw new Error(
      'stretchRescale: provide exactly one of newBpm or newLockedBeats, not both.',
    )
  }
  if (!hasBpm && !hasBeats) {
    throw new Error(
      'stretchRescale: exactly one of newBpm or newLockedBeats must be provided.',
    )
  }

  // Resolve beat-space boundaries — fall back to input-space if not diverged.
  const inBeatTime  = region.inBeatTime  ?? region.inPoint
  const outBeatTime = region.outBeatTime ?? region.outPoint

  const currentBpm = region.bpm
  const oldLength  = outBeatTime - inBeatTime

  // Derive lockedBeats from the region (or compute from the current window).
  const currentLockedBeats =
    region.lockedBeats ?? (oldLength * currentBpm) / 60

  let bpm: number
  let lockedBeats: number

  if (hasBpm) {
    // BPM edit: lockedBeats stays, clipout rescales.
    bpm         = input.newBpm!
    lockedBeats = currentLockedBeats
  } else {
    // Beats edit: BPM stays, clipout rescales to fit new beat count.
    bpm         = currentBpm
    lockedBeats = input.newLockedBeats!
  }

  const newClipoutLength = (60 * lockedBeats) / bpm
  const newOutBeatTime   = inBeatTime + newClipoutLength

  // Rescale anchors inside the beat-space window proportionally around
  // inBeatTime.  Handle zero-length defensively (scaleFactor = 1).
  const scaleFactor = oldLength === 0 ? 1 : newClipoutLength / oldLength

  const rescaledBeatAnchors = new Map<number, number>()
  for (const a of beatAnchors) {
    if (a.time >= inBeatTime && a.time <= outBeatTime) {
      const newTime = inBeatTime + (a.time - inBeatTime) * scaleFactor
      rescaledBeatAnchors.set(a.id, newTime)
    }
  }

  return {
    newClipoutLength,
    newOutBeatTime,
    rescaledBeatAnchors,
    bpm,
    lockedBeats,
  }
}
