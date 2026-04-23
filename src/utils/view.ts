import type { View } from '../types'

export const MIN_VISIBLE = 0.5

export function clampView(start: number, end: number, maxDuration: number): View {
  const span = Math.max(MIN_VISIBLE, Math.min(maxDuration, end - start))
  let s = Math.max(0, start)
  let e = s + span
  if (e > maxDuration) { e = maxDuration; s = Math.max(0, e - span) }
  return { start: s, end: e }
}

/** Convert an absolute time to a view-space percentage (can be outside 0-100 when off-screen) */
export function timeToViewPct(time: number, view: View): number {
  return ((time - view.start) / (view.end - view.start)) * 100
}

/** Compute beat line opacity based on zoom level (0 = hidden, 1 = fully visible) */
export function beatGridOpacity(view: View, bpm: number): number {
  if (!bpm || bpm <= 0) return 0
  const beat = 60 / bpm
  const beatsVisible = (view.end - view.start) / beat
  if (beatsVisible < 80) return 1
  if (beatsVisible > 120) return 0
  return (120 - beatsVisible) / 40
}

/** Compute an appropriate initial view for a given duration and BPM */
export function initialView(duration: number, bpm?: number): View {
  if (!bpm || bpm <= 0) return { start: 0, end: duration }
  const beat = 60 / bpm
  const beatsInClip = duration / beat
  // Short clips: show all
  if (beatsInClip <= 32) return { start: 0, end: duration }
  // Long clips: show first ~24 beats
  return { start: 0, end: Math.min(duration, 24 * beat) }
}

/**
 * Compute the span for a newly created region.
 * Spec (BEHAVIORS.md §3): the smaller of 10% of the current viewport or 5 seconds.
 */
export function calcNewRegionSpan(viewSpan: number): number {
  return Math.max(viewSpan * 0.1, 5)
}

/**
 * Compute inPoint/outPoint for a newly created region aligned on `cursor`.
 * The region starts at the cursor position. Clamps to [0, videoDuration].
 */
export function calcNewRegionBounds(
  cursor: number,
  viewSpan: number,
  videoDuration: number,
): { inPoint: number; outPoint: number } {
  const span = calcNewRegionSpan(viewSpan)
  return {
    inPoint: Math.max(0, cursor),
    outPoint: Math.min(videoDuration, cursor + span),
  }
}

/**
 * Given scene cuts + the video endpoints, find the two scene boundaries
 * that bracket `cursor`. Returns `null` if no sensible pair exists.
 */
export function findSurroundingScenes(
  cursor: number,
  cuts: number[],
  videoDuration: number,
): { prev: number; next: number } | null {
  if (videoDuration <= 0) return null
  const sorted = [...cuts].filter(c => c > 0 && c < videoDuration).sort((a, b) => a - b)
  const boundaries = [0, ...sorted, videoDuration]
  for (let i = 0; i < boundaries.length - 1; i++) {
    const lo = boundaries[i], hi = boundaries[i + 1]
    if (cursor >= lo && cursor <= hi && hi > lo) {
      return { prev: lo, next: hi }
    }
  }
  return null
}

/**
 * Bounds for a new region starting at `playhead`, clamped so it stops at the
 * nearest existing region start (or the end of the video). Used when the user
 * sets Out before a region's In — spawns a fresh region that fills the gap.
 */
export function calcNewRegionBoundsUpToNext(
  playhead: number,
  viewSpan: number,
  regions: { inPoint: number }[],
  videoDuration: number,
): { inPoint: number; outPoint: number } {
  const span = calcNewRegionSpan(viewSpan)
  const nextStart = regions
    .map(r => r.inPoint)
    .filter(t => t > playhead)
    .reduce((m, t) => Math.min(m, t), videoDuration)
  const inPoint  = Math.max(0, playhead)
  const outPoint = Math.min(nextStart, videoDuration, inPoint + span)
  return { inPoint, outPoint }
}

/**
 * Compute region bounds for a click/playhead at `cursor`, snapping the in /
 * out points to the closest "wall" on each side:
 *   inPoint  = max(prev scene cut, prev region's outPoint, view.start, 0)
 *   outPoint = min(next scene cut, next region's inPoint, view.end, videoDuration)
 *
 * If the cursor falls inside an existing region, the cursor is first slid to
 * that region's outPoint so the new region starts where the existing one
 * ends (consistent with "set out before in" muscle memory).
 *
 * Falls back to the simple {@link calcNewRegionBounds} 5s/10% rule only
 * when there are no scene cuts AND no other regions in scope — otherwise
 * the clamping is the desired behavior, even if the span ends up small.
 * A safety check still kicks in when adjacent scenes pinch the bounds to
 * less than {@link MIN_VISIBLE}, in which case we fall back so the result
 * is usable rather than a degenerate sliver.
 */
export function calcNewRegionBoundsFromScenes(
  cursor: number,
  view: View,
  cuts: number[],
  videoDuration: number,
  regions: { inPoint: number; outPoint: number }[] = [],
): { inPoint: number; outPoint: number } {
  const viewSpan = view.end - view.start

  // If the cursor sits inside an existing region, treat it as if the user
  // had clicked just past that region's out — the new region then fills the
  // next gap rather than colliding with the existing one.
  const insideRegion = regions.find(r => cursor >= r.inPoint && cursor < r.outPoint)
  const c = insideRegion ? insideRegion.outPoint : cursor

  // No scenes AND no other regions → simple 5s/10% span at the cursor.
  if (cuts.length === 0 && regions.length === 0) {
    return calcNewRegionBounds(c, viewSpan, videoDuration)
  }

  // Previous-side candidates. view.start is always a candidate (the spec
  // explicitly clamps to the viewport); scenes within view contribute when
  // they're left of the cursor; every region whose outPoint is left of (or
  // at) the cursor contributes its outPoint.
  const prevCandidates: number[] = [view.start]
  for (const t of cuts) if (t >= view.start && t < c) prevCandidates.push(t)
  for (const r of regions) if (r.outPoint <= c) prevCandidates.push(r.outPoint)
  const inPoint = Math.max(0, ...prevCandidates)

  // Next-side candidates: viewport end + scenes/regions strictly to the
  // right of the cursor. Clamped to videoDuration as a final ceiling.
  const nextCandidates: number[] = [view.end]
  for (const t of cuts) if (t > c && t <= view.end) nextCandidates.push(t)
  for (const r of regions) if (r.inPoint > c) nextCandidates.push(r.inPoint)
  const outPoint = Math.min(videoDuration, ...nextCandidates)

  // Degenerate-pinch safety: two scenes very close to each other on either
  // side of the cursor would yield an unusable sliver. Keep callers happy
  // with the legacy 5s/10% fallback in that case.
  if (outPoint - inPoint < MIN_VISIBLE) {
    return calcNewRegionBounds(c, viewSpan, videoDuration)
  }

  return { inPoint, outPoint }
}

/**
 * Shift `view` just enough to bring `time` back on-screen, preserving the
 * current zoom. A small margin (10% of span, min 0.25s) stops the target from
 * landing glued to the edge.
 *
 * Returns the view by reference if `time` is already inside, so callers can
 * short-circuit a dispatch with `next !== view`.
 */
export function scrollViewToTime(view: View, time: number, videoDuration: number): View {
  if (time >= view.start && time <= view.end) return view
  const span = view.end - view.start
  const margin = Math.max(span * 0.1, 0.25)
  const start = time < view.start ? time - margin : time + margin - span
  return clampView(start, start + span, videoDuration)
}

const ZOOM_EPS = 0.001

/** Return true when `view` is already fitted to `[regionIn, regionOut]`. */
export function viewFitsRegion(view: View, regionIn: number, regionOut: number): boolean {
  return Math.abs(view.start - regionIn) < ZOOM_EPS
      && Math.abs(view.end - regionOut) < ZOOM_EPS
}

/**
 * Compute the next view for a "zoom to region" action, toggling in/out.
 *
 * - When the current view is NOT already fit to [regionIn, regionOut], the
 *   region fills the timeline. Returns { nextView: region, previousView: current }
 *   so the caller can stash the previous view for later restoration.
 * - When the current view IS already fit, returns the previously-stored view
 *   (passed as `restore`), restoring the prior zoom. `previousView` is null.
 */
export function calcZoomToRegion(
  currentView: View,
  regionIn: number,
  regionOut: number,
  restore: View | null,
): { nextView: View; previousView: View | null } {
  const fits = viewFitsRegion(currentView, regionIn, regionOut)
  if (!fits) {
    return { nextView: { start: regionIn, end: regionOut }, previousView: currentView }
  }
  // Already zoomed to this region — restore previous view if available
  return { nextView: restore ?? currentView, previousView: null }
}
