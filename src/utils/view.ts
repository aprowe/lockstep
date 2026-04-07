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
