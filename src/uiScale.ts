/**
 * UI scale — sets the `--ui-scale` CSS variable on <html>, which every size
 * token in index.css multiplies against. Persisted to localStorage so the
 * choice survives reloads. Adjusted from the View menu (±, reset).
 */

const STORAGE_KEY = "lockstep:ui-scale";
const MIN = 0.7;
const MAX = 2.0;
const STEP = 0.1;
const DEFAULT = 1.0;

function clamp(n: number): number {
    if (!Number.isFinite(n)) return DEFAULT;
    return Math.max(MIN, Math.min(MAX, Math.round(n * 10) / 10));
}

function apply(scale: number): void {
    document.documentElement.style.setProperty("--ui-scale", String(scale));
    window.dispatchEvent(new CustomEvent("ui-scale-change", { detail: scale }));
}

/** Read the persisted UI scale (clamped to the allowed range). Falls back to 1.0×. */
export function getUiScale(): number {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT;
    const n = parseFloat(raw);
    return clamp(n);
}

/**
 * Persist `scale` (clamped to 0.7–2.0 in 0.1 steps), apply it to `<html>`,
 * and fire `ui-scale-change`. Returns the value that was actually applied.
 */
export function setUiScale(scale: number): number {
    const next = clamp(scale);
    localStorage.setItem(STORAGE_KEY, String(next));
    apply(next);
    return next;
}

/** Add `delta` to the current scale and apply the result. */
export function stepUiScale(delta: number): number {
    return setUiScale(getUiScale() + delta);
}

/** Reset the UI scale to 1.0× and apply it. */
export function resetUiScale(): number {
    return setUiScale(DEFAULT);
}

/** Apply the persisted scale at startup. Safe to call more than once. */
export function initUiScale(): void {
    apply(getUiScale());
}

export const UI_SCALE_STEP = STEP;
