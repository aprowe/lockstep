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
 * Compute region bounds from scene cuts when the next scene is inside the
 * visible view; otherwise fall back to {@link calcNewRegionBounds}.
 * Also falls back when the resulting span would be essentially zero.
 */
export function calcNewRegionBoundsFromScenes(
  cursor: number,
  view: View,
  cuts: number[],
  videoDuration: number,
): { inPoint: number; outPoint: number } {
  const viewSpan = view.end - view.start
  const fallback = () => calcNewRegionBounds(cursor, viewSpan, videoDuration)
  const surrounding = findSurroundingScenes(cursor, cuts, videoDuration)
  if (!surrounding) return fallback()
  // Per spec: retain current behavior when the end isn't in view.
  if (surrounding.next > view.end || surrounding.next < view.start) return fallback()
  if (surrounding.next - surrounding.prev < MIN_VISIBLE) return fallback()
  return { inPoint: surrounding.prev, outPoint: surrounding.next }
}

/** Center `view` on `time` if `time` falls outside it; returns unchanged view otherwise. */
export function ensureTimeInView(view: View, time: number, videoDuration: number): View {
  if (time >= view.start && time <= view.end) return view
  const span = view.end - view.start
  const ns = time - span / 2
  return clampView(ns, ns + span, videoDuration)
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
