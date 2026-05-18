/** Effective beat-space bounds for a region.
 *
 *  After the sentinel removal (inBeatTime/outBeatTime are required numbers,
 *  never undefined), this is a trivial read of the slice fields. The old
 *  anchor-conform fallback chain is gone — the clipout always carries explicit
 *  beat-space values. Callers that pass origAnchors / beatAnchors are safe;
 *  the arguments are accepted but ignored for backwards-compatibility until
 *  all call sites are updated.
 */

export interface EffectiveBeatBounds {
  inBeatTime: number
  outBeatTime: number
}

export function effectiveBeatBounds(
  region: { inBeatTime: number; outBeatTime: number },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _origAnchors?: readonly unknown[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _beatAnchors?: readonly unknown[],
): EffectiveBeatBounds {
  return { inBeatTime: region.inBeatTime, outBeatTime: region.outBeatTime }
}
