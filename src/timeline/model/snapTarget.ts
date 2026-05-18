const TARGET_PX = 60

/**
 * Smallest grid spacing (seconds) currently drawn by the beat ruler at this
 * zoom. The output-space snap interval is clamped to be no finer than this
 * so we never snap to ticks the user can't see.
 */
export function smallestVisibleBeatGridSec(
  viewSpanSec: number,
  canvasW: number,
  bpm: number,
): number {
  if (bpm <= 0 || canvasW <= 0 || viewSpanSec <= 0) return Number.POSITIVE_INFINITY
  const beatSec = 60 / bpm
  const pps = canvasW / viewSpanSec
  const ppb = pps * beatSec
  const bpb = 4
  const ppbar = ppb * bpb
  let barGroup = 1
  while (ppbar * barGroup < TARGET_PX) barGroup *= 2
  if (barGroup > 4096) barGroup = 4096
  if (barGroup > 1) {
    const subBarGroup = barGroup >= 8 ? barGroup / 8 : 1
    return subBarGroup * bpb * beatSec
  }
  if (ppb / 4 >= 6) return 0.25 * beatSec
  if (ppb / 2 >= 9) return 0.5 * beatSec
  if (ppb >= 22) return 1 * beatSec
  return bpb * beatSec
}
