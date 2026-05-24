import type { HitEntry } from "./types";

export interface HitListBuilder {
    add(x: number, y: number, w: number, h: number, data: unknown): void;
    result(): HitEntry[];
}

export function createHitListBuilder(): HitListBuilder {
    const hits: HitEntry[] = [];
    return {
        add(x, y, w, h, data) {
            hits.push({ x, y, w, h, data });
        },
        result() {
            return hits;
        },
    };
}

/** Topmost-first hit test. Returns the most-recently-added rect that contains the point. */
export function hitAt(hits: readonly HitEntry[], px: number, py: number): unknown {
    for (let i = hits.length - 1; i >= 0; i--) {
        const h = hits[i];
        if (px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h) return h.data;
    }
    return null;
}

