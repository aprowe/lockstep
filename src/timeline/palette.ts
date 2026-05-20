/** Shared clip color palette — used by CanvasTimeline and WarpView. */
export const CLIP_PALETTE = [
    { h: 0, s: 75, l: 55 },
    { h: 30, s: 80, l: 52 },
    { h: 58, s: 80, l: 48 },
    { h: 115, s: 65, l: 45 },
    { h: 183, s: 65, l: 42 },
    { h: 213, s: 70, l: 55 },
    { h: 270, s: 60, l: 55 },
    { h: 305, s: 65, l: 52 },
];

/** Return an `hsl()` or `hsla()` string for a clip index. */
export function clipHsl(idx: number, alpha: number | null = null, lAdj = 0): string {
    const c = CLIP_PALETTE[(idx ?? 0) % CLIP_PALETTE.length];
    const l = Math.max(0, Math.min(100, c.l + lAdj));
    return alpha == null ? `hsl(${c.h},${c.s}%,${l}%)` : `hsla(${c.h},${c.s}%,${l}%,${alpha})`;
}
