import type { Anchor } from '../../types'

const TOL = 1e-4

export interface AnchorPair {
  id: number
  /** Input-space time. */
  inT: number
  /** Output (beat) time. */
  outT: number
}

/**
 * Pair input-space anchors with beat-space anchors by id, dropping any that
 * don't have a partner. Sorted by input time so the result can be walked
 * linearly for piecewise mapping.
 */
export function buildAnchorPairs(
  anchors: Anchor[],
  beatAnchors: Anchor[],
): AnchorPair[] {
  const beatById = new Map<number, number>()
  for (const b of beatAnchors) beatById.set(b.id, b.time)
  const pairs: AnchorPair[] = []
  for (const a of anchors) {
    const outT = beatById.get(a.id)
    if (outT !== undefined) pairs.push({ id: a.id, inT: a.time, outT })
  }
  pairs.sort((a, b) => a.inT - b.inT)
  return pairs
}

/**
 * Piecewise-linear map from input time to beat time using `pairs`. Returns
 * `t` unchanged outside the covered range (or when there are fewer than
 * two pairs).
 */
export function origToBeat(t: number, pairs: AnchorPair[]): number {
  for (let i = 0; i < pairs.length - 1; i++) {
    const { inT: o0, outT: b0 } = pairs[i]
    const { inT: o1, outT: b1 } = pairs[i + 1]
    if (t >= o0 && t <= o1) {
      const frac = o1 > o0 ? (t - o0) / (o1 - o0) : 0
      return b0 + frac * (b1 - b0)
    }
  }
  return t
}

/**
 * Piecewise-linear map from beat time back to input time using `pairs`. Returns
 * `t` unchanged outside the covered range (or when there are fewer than two pairs).
 */
export function beatToOrig(t: number, pairs: AnchorPair[]): number {
  for (let i = 0; i < pairs.length - 1; i++) {
    const { inT: o0, outT: b0 } = pairs[i]
    const { inT: o1, outT: b1 } = pairs[i + 1]
    if (t >= b0 && t <= b1) {
      const frac = b1 > b0 ? (t - b0) / (b1 - b0) : 0
      return o0 + frac * (o1 - o0)
    }
  }
  return t
}

/**
 * Build anchor pairs from two pre-aligned arrays (scopedOrig / scopedBeat).
 * Unlike {@link buildAnchorPairs}, this preserves insertion order instead of
 * sorting by id, since synthetic boundary anchors (id < 0) are already in the
 * correct time order.
 */
export function buildPairsFromAligned(
  origAnchors: Anchor[],
  beatAnchors: Anchor[],
): AnchorPair[] {
  const len = Math.min(origAnchors.length, beatAnchors.length)
  const pairs: AnchorPair[] = []
  for (let i = 0; i < len; i++) {
    pairs.push({ id: origAnchors[i].id, inT: origAnchors[i].time, outT: beatAnchors[i].time })
  }
  return pairs
}

/**
 * If an input-space anchor sits within tolerance of `inputTime`, return its
 * paired beat time. Otherwise undefined.
 */
export function anchorBeatAt(
  inputTime: number,
  anchors: Anchor[],
  beatAnchors: Anchor[],
): number | undefined {
  const a = anchors.find(a => Math.abs(a.time - inputTime) < TOL)
  if (!a) return undefined
  const b = beatAnchors.find(b => b.id === a.id)
  return b?.time
}
