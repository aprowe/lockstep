/**
 * Collapse clusters of closely-spaced scene cuts.
 *
 * Drops a cut if it's less than `minGap` seconds after the previous *input*
 * cut, so a dense cluster collapses to its first marker. A new boundary only
 * appears after a gap of at least `minGap` seconds. Pass-through if minGap ≤ 0.
 */
export function filterCutsByMinGap(cuts: number[], minGap: number): number[] {
  if (minGap <= 0 || cuts.length === 0) return cuts
  const out: number[] = []
  let prev = -Infinity
  for (const t of cuts) {
    if (t - prev >= minGap) out.push(t)
    prev = t
  }
  return out
}
