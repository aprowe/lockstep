import type { HitEntry, Snapshot } from "./types";

export type CondensedHit =
    | { kind: "anchor"; id: number; space: "input" }
    | { kind: "region-edge"; id: string; edge: "in" | "out"; isOutput: false }
    | { kind: "region"; id: string; isOutput: false }
    | { kind: "sceneCut"; time: number }
    | { kind: "empty" };

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

/** Condensed-mode hit test. The condensed timeline overlays anchors, regions,
 *  and scene cuts onto a single input-space row, so the rectangle-based hit
 *  list isn't built; we resolve directly from the snapshot with explicit
 *  priority: anchor > region-edge > region > sceneCut > empty. */
export function hitAtCondensed(x: number, y: number, snap: Snapshot): CondensedHit {
    const track = snap.tracks.find((t) => t.id === "condensed");
    if (!track || y < track.y || y > track.y + track.h) return { kind: "empty" };

    const span = snap.view.end - snap.view.start;
    if (span <= 0 || snap.canvas.width <= 0) return { kind: "empty" };
    const xAtT = (t: number) => ((t - snap.view.start) / span) * snap.canvas.width;
    const tAtX = (px: number) => snap.view.start + (px / snap.canvas.width) * span;

    const ANCHOR_PX = 6;
    const EDGE_PX = 5;
    const SCENE_PX = 3;

    for (const a of snap.anchors) {
        if (Math.abs(xAtT(a.time) - x) <= ANCHOR_PX) {
            return { kind: "anchor", id: a.id, space: "input" };
        }
    }
    for (const r of snap.regions) {
        if (Math.abs(xAtT(r.inPoint) - x) <= EDGE_PX) {
            return { kind: "region-edge", id: r.id, edge: "in", isOutput: false };
        }
        if (Math.abs(xAtT(r.outPoint) - x) <= EDGE_PX) {
            return { kind: "region-edge", id: r.id, edge: "out", isOutput: false };
        }
    }
    const t = tAtX(x);
    for (const r of snap.regions) {
        if (t >= r.inPoint && t <= r.outPoint) {
            return { kind: "region", id: r.id, isOutput: false };
        }
    }
    for (const s of snap.scenes) {
        if (Math.abs(xAtT(s) - x) <= SCENE_PX) return { kind: "sceneCut", time: s };
    }
    return { kind: "empty" };
}
