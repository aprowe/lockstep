import type { Anchor, Segment, Band } from '../types'

/** Snap a time value to the nearest beat */
export function snapToBeat(time: number, bpm: number): number {
  const beat = 60 / bpm
  return Math.round(time / beat) * beat
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
): Segment[] {
  const origBounds = [0, ...origAnchors.map(a => a.time), origDuration]
  const beatBounds = [0, ...beatAnchors.map(a => a.time), outputDuration]
  const segs: Segment[] = []

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

export function origBands(segments: Segment[]): Band[] {
  return segments.map(s => ({ left: s.origLeft, right: s.origRight, stretchRatio: s.stretchRatio }))
}

export function quantBands(segments: Segment[]): Band[] {
  return segments.map(s => ({ left: s.quantLeft, right: s.quantRight, stretchRatio: s.stretchRatio }))
}

export function stretchColor(ratio: number): string {
  if (ratio > 2.0) return 'rgba(239, 68, 68, 0.22)'
  if (ratio > 1.3) return 'rgba(245, 158, 11, 0.16)'
  if (ratio < 0.5) return 'rgba(59, 130, 246, 0.22)'
  if (ratio < 0.75) return 'rgba(96, 165, 250, 0.14)'
  return 'rgba(75, 85, 99, 0.12)'
}
