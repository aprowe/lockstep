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

/**
 * Visible cut list = min-gap-filtered detected cuts ∪ user-placed cuts.
 *
 * User-placed cuts always survive: if the operator explicitly dropped a
 * marker there, the min-gap collapse would override their intent. The two
 * pools are merged, sorted, and de-duped within 1ms (float drift) before
 * returning, so downstream code can treat the result as a clean number[].
 */
export function visibleSceneCuts(
  detected: number[],
  user: number[],
  minGap: number,
): number[] {
  const filtered = filterCutsByMinGap(detected, minGap)
  if (user.length === 0) return filtered
  const merged = [...filtered, ...user].sort((a, b) => a - b)
  const out: number[] = []
  for (const t of merged) {
    if (out.length === 0 || Math.abs(out[out.length - 1] - t) >= 1e-3) {
      out.push(t)
    }
  }
  return out
}
