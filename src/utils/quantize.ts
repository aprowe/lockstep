import type { Anchor, WarpSegment, Band } from '../types'

/** Snap a time value to the nearest beat */
export function snapToBeat(time: number, bpm: number): number {
  const beat = 60 / bpm
  return Math.round(time / beat) * beat
}

/**
 * Snaps all beat anchors to the nearest beat grid, resolving conflicts so no
 * two anchors land on the same beat. Uses greedy closest-first assignment, then
 * enforces strictly-increasing order to match orig anchor ordering.
 *
 * @param anchors  Beat anchors to snap (need not be sorted)
 * @param beat     Beat interval in seconds (60 / bpm)
 * @param beatOffset  Phase offset of beat grid (first-beat time)
 */
export function snapAllToBeat(
  anchors: Anchor[],
  beat: number,
  beatOffset: number,
): Anchor[] {
  if (!beat || beat <= 0 || anchors.length === 0) return anchors

  // Compute ideal beat K-index for each anchor
  const candidates = anchors.map(a => {
    const k = Math.round((a.time - beatOffset) / beat)
    return { id: a.id, time: a.time, idealK: k, dist: Math.abs(a.time - (beatOffset + k * beat)) }
  })

  // Priority: closest anchor gets its ideal beat first
  const byDist = [...candidates].sort((a, b) => a.dist - b.dist)

  const claimedKs = new Set<number>()
  const assignment = new Map<number, number>() // anchor.id → beat time

  for (const c of byDist) {
    if (!claimedKs.has(c.idealK)) {
      claimedKs.add(c.idealK)
      assignment.set(c.id, beatOffset + c.idealK * beat)
    } else {
      // Search outward from idealK for nearest unclaimed beat
      let foundK: number | null = null
      for (let d = 1; d <= 500; d++) {
        const kUp = c.idealK + d
        const kDown = c.idealK - d
        const upFree = !claimedKs.has(kUp)
        const downFree = !claimedKs.has(kDown)
        if (upFree && downFree) {
          const dUp = Math.abs(c.time - (beatOffset + kUp * beat))
          const dDown = Math.abs(c.time - (beatOffset + kDown * beat))
          foundK = dUp <= dDown ? kUp : kDown
          break
        } else if (upFree) { foundK = kUp; break }
        else if (downFree) { foundK = kDown; break }
      }
      if (foundK !== null) {
        claimedKs.add(foundK)
        assignment.set(c.id, beatOffset + foundK * beat)
      }
    }
  }

  // Enforce strictly-increasing order in the same sequence as original anchors
  // (Beat anchors are ordered to match orig anchor ordering.)
  const ordered = [...anchors].sort((a, b) => a.time - b.time).map(a => ({
    id: a.id,
    beatTime: assignment.get(a.id) ?? beatOffset + Math.round((a.time - beatOffset) / beat) * beat,
  }))

  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].beatTime <= ordered[i - 1].beatTime) {
      const prevK = Math.round((ordered[i - 1].beatTime - beatOffset) / beat)
      ordered[i].beatTime = beatOffset + (prevK + 1) * beat
    }
  }

  const resultMap = new Map(ordered.map(o => [o.id, o.beatTime]))
  return anchors.map(a => ({ ...a, time: resultMap.get(a.id) ?? a.time }))
}

/**
 * Build warp segments from parallel orig/beat anchor arrays (same length, same IDs).
 * Edge segments are included (before first anchor, after last anchor).
 */
export function buildSegments(
  origAnchors: Anchor[],  // sorted by time
  beatAnchors: Anchor[],  // sorted by time, 1:1 with origAnchors
  origDuration: number,
  outputDuration: number,
): WarpSegment[] {
  const origBounds = [0, ...origAnchors.map(a => a.time), origDuration]
  const beatBounds = [0, ...beatAnchors.map(a => a.time), outputDuration]
  const segs: WarpSegment[] = []

  for (let i = 0; i < origBounds.length - 1; i++) {
    const origSpan = origBounds[i + 1] - origBounds[i]
    const beatSpan = beatBounds[i + 1] - beatBounds[i]
    segs.push({
      origLeft: (origBounds[i] / origDuration) * 100,
      origRight: (origBounds[i + 1] / origDuration) * 100,
      quantLeft: (beatBounds[i] / outputDuration) * 100,
      quantRight: (beatBounds[i + 1] / outputDuration) * 100,
      stretchRatio: origSpan > 0 ? beatSpan / origSpan : 1,
    })
  }
  return segs
}

export function computeOutputDuration(
  origAnchors: Anchor[],
  beatAnchors: Anchor[],
  origDuration: number,
): number {
  if (beatAnchors.length === 0) return origDuration
  const lastBeat = beatAnchors[beatAnchors.length - 1].time
  const lastOrig = origAnchors[origAnchors.length - 1].time
  return lastBeat + (origDuration - lastOrig)
}

export function origBands(segments: WarpSegment[]): Band[] {
  return segments.map(s => ({ left: s.origLeft, right: s.origRight, stretchRatio: s.stretchRatio }))
}

export function quantBands(segments: WarpSegment[]): Band[] {
  return segments.map(s => ({ left: s.quantLeft, right: s.quantRight, stretchRatio: s.stretchRatio }))
}

export function stretchColor(ratio: number): string {
  if (ratio > 2.0) return 'rgba(239, 68, 68, 0.22)'
  if (ratio > 1.3) return 'rgba(245, 158, 11, 0.16)'
  if (ratio < 0.5) return 'rgba(59, 130, 246, 0.22)'
  if (ratio < 0.75) return 'rgba(96, 165, 250, 0.14)'
  return 'rgba(75, 85, 99, 0.12)'
}
