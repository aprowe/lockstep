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
