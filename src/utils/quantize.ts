import type { Anchor, WarpSegment, Band } from '../types'

/** Snap a time value to the nearest beat */
export function snapToBeat(time: number, bpm: number): number {
  const beat = 60 / bpm
  return Math.round(time / beat) * beat
}

/**
 * Snaps beat anchors to the nearest beat grid position.
 * Closest anchor wins when two anchors want the same beat — the other
 * keeps its original time (no outward pushing to force every anchor onto a beat).
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

  // Closest anchor claims its beat first; conflicts are left unsnapped
  const byDist = [...candidates].sort((a, b) => a.dist - b.dist)
  const claimedKs = new Set<number>()
  const assignment = new Map<number, number>() // anchor.id → snapped time

  for (const c of byDist) {
    if (!claimedKs.has(c.idealK)) {
      claimedKs.add(c.idealK)
      assignment.set(c.id, beatOffset + c.idealK * beat)
    }
    // Conflict: don't snap — anchor keeps its original time
  }

  return anchors.map(a => ({ ...a, time: assignment.get(a.id) ?? a.time }))
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

/** Interpolate between neutral and the warm (slow / ratio > 1) or
 *  cool (fast / ratio < 1) stretch color, using log-space distance so
 *  doubling and halving feel equivalent. `maxAlpha` is reached at 2× / 0.5×. */
function interpolateStretch(ratio: number, maxAlpha: number): string {
  if (!isFinite(ratio) || ratio <= 0) ratio = 1
  const d = Math.log2(ratio) // 0 at neutral, ±1 at 2×/0.5×
  const t = Math.min(1, Math.abs(d))
  const alpha = t * maxAlpha
  // Warm target: rgb(239, 68, 68). Cool target: rgb(59, 130, 246).
  const [r, g, b] = d >= 0 ? [239, 68, 68] : [59, 130, 246]
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`
}

export function stretchColor(ratio: number): string {
  return interpolateStretch(ratio, 0.22)
}

/** Bolder variant of stretchColor for foreground bars that need to read
 *  clearly on their own (e.g. the per-segment speed strip under the trapezoids). */
export function stretchBarColor(ratio: number): string {
  return interpolateStretch(ratio, 0.35)
}
