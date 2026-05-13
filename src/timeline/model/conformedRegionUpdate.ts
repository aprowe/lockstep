import type { Region, Anchor } from '../../types'
import { effectiveBeatBounds } from './effectiveBounds'

export interface ConformedRegionUpdate {
  /** New BPM when the region's lock is 'beats' — keep beat count fixed. */
  bpm?: number
  /** New beat count when lock is 'bpm' — keep BPM fixed. */
  lockedBeats?: number
}

/**
 * When a region's clipout (beat-space) length changes because of a conform
 * event (anchor dropped on a clip boundary, or clipout edge dragged), derive
 * which of {bpm, lockedBeats} should update — depending on the region's
 * lock mode — to keep the playback contract consistent.
 *
 *   lock='bpm':   BPM stays fixed; new beat count = (newLength * BPM) / 60
 *   lock='beats': beat count stays fixed; new BPM = 60 * lockedBeats / newLength
 *
 * Pure: takes the region snapshot + new beat-space bounds + current anchor
 * arrays, returns the patch shape. Returns {} when newLength <= 0 (degenerate
 * — caller should ignore).
 *
 * `origAnchors` / `beatAnchors` are used only to derive the current effective
 * beat-space length for the `lock='beats'` fallback (when `lockedBeats` is
 * absent). Pass empty arrays when you know `region.lockedBeats` is set.
 */
export function conformedRegionUpdate(
  region: Region,
  conformedInBeat: number,
  conformedOutBeat: number,
  origAnchors: readonly Anchor[] = [],
  beatAnchors: readonly Anchor[] = [],
): ConformedRegionUpdate {
  const newLength = conformedOutBeat - conformedInBeat
  if (newLength <= 0) return {}

  const lock = region.lock ?? 'bpm'

  if (lock === 'beats') {
    // Keep beat count fixed. If no snapshot exists, derive from the region's
    // current effective beat-space length (accounting for input-anchor conform).
    const { inBeatTime, outBeatTime } = effectiveBeatBounds(region, origAnchors, beatAnchors)
    const beats = region.lockedBeats ?? ((outBeatTime - inBeatTime) * region.bpm) / 60
    return { bpm: (60 * beats) / newLength }
  }

  // lock = 'bpm' (default). Keep BPM fixed, derive new beat count.
  return { lockedBeats: (newLength * region.bpm) / 60 }
}
