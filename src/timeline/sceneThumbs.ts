export interface SceneThumbSlot {
    time: number;
    x: number;
    /** Drawn width. Clamped to `naturalW` when the next scene is far enough
     *  away, otherwise shrunk to the gap so the next cut is never overlapped. */
    width: number;
    /** The aspect-preserving width the slot would have if the next scene
     *  weren't in the way. Consumers use it to crop the image source rect when
     *  `width < naturalW` so the left edge stays flush with the cut. */
    naturalW: number;
}

/** Minimum drawn width — narrower slivers don't read as a thumbnail at all. */
const MIN_SLOT_W = 3;

/**
 * Compute pixel positions and widths for scene thumbnails. Each thumbnail is
 * anchored at its scene cut (left edge = `sceneX(time)`) and extends up to
 * `naturalW` pixels. When the next scene is closer than that, the slot is
 * shrunk to the gap — the consumer is expected to source-crop the image to
 * keep the left edge aligned with the cut. Slivers under `MIN_SLOT_W` and
 * fully off-canvas slots are dropped.
 */
export function visibleSceneThumbs(
    sceneTimes: number[],
    sceneX: (time: number) => number,
    naturalW: number,
    viewportW: number,
): SceneThumbSlot[] {
    if (naturalW <= 0) return [];
    const sorted = [...sceneTimes].sort((a, b) => a - b);
    const slots: SceneThumbSlot[] = [];
    for (let i = 0; i < sorted.length; i++) {
        const x = sceneX(sorted[i]);
        const nextX = i + 1 < sorted.length ? sceneX(sorted[i + 1]) : Number.POSITIVE_INFINITY;
        const gap = nextX - x;
        const width = Math.min(naturalW, gap);
        if (width < MIN_SLOT_W) continue;
        if (x + width < 0 || x > viewportW) continue;
        slots.push({ time: sorted[i], x, width, naturalW });
    }
    return slots;
}
