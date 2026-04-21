/**
 * UI scale — sets the `--ui-scale` CSS variable on <html>, which every size
 * token in index.css multiplies against. Persisted to localStorage so the
 * choice survives reloads. Adjusted from the View menu (±, reset).
 */

const STORAGE_KEY = 'lockstep:ui-scale'
const MIN = 0.7
const MAX = 2.0
const STEP = 0.1
const DEFAULT = 1.0

function clamp(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT
  return Math.max(MIN, Math.min(MAX, Math.round(n * 10) / 10))
}

function apply(scale: number): void {
  document.documentElement.style.setProperty('--ui-scale', String(scale))
}

export function getUiScale(): number {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw === null) return DEFAULT
  const n = parseFloat(raw)
  return clamp(n)
}

export function setUiScale(scale: number): number {
  const next = clamp(scale)
  localStorage.setItem(STORAGE_KEY, String(next))
  apply(next)
  return next
}

export function stepUiScale(delta: number): number {
  return setUiScale(getUiScale() + delta)
}

export function resetUiScale(): number {
  return setUiScale(DEFAULT)
}

/** Apply the persisted scale at startup. Safe to call more than once. */
export function initUiScale(): void {
  apply(getUiScale())
}

export const UI_SCALE_STEP = STEP
