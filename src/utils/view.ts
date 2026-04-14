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
