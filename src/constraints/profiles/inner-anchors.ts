/**
 * Inner beat-anchor lookup for anchor-lock.
 *
 * Anchor-lock semantics: beat anchors strictly inside the active
 * clipout's beat-time range translate / rescale with the clipout.
 * Boundary anchors (at exactly inBeatTime or outBeatTime) are excluded.
 *
 * Pure helper — replaces the comparable logic in
 * `anchorLockMirrorMiddleware`.
 */

import { anchorOutId } from "../ids";
import type { EntityId } from "../types";

const EPSILON = 1e-9;

export function innerBeatAnchorIds(
    beatAnchors: ReadonlyArray<{ id: number; time: number }>,
    clipoutInBeat: number,
    clipoutOutBeat: number,
): EntityId[] {
    const lo = Math.min(clipoutInBeat, clipoutOutBeat);
    const hi = Math.max(clipoutInBeat, clipoutOutBeat);
    const inner: EntityId[] = [];
    for (const a of beatAnchors) {
        if (a.time > lo + EPSILON && a.time < hi - EPSILON) {
            inner.push(anchorOutId(a.id));
        }
    }
    inner.sort();
    return inner;
}
