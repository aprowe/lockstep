/**
 * Effective beat-space bounds for a region.
 *
 * The clipout always carries explicit beat-space values, so this is a direct
 * read of the region's `inBeatTime` / `outBeatTime`. `origAnchors` and
 * `beatAnchors` are accepted but ignored — kept on the signature for call
 * sites that still pass them.
 */

export interface EffectiveBeatBounds {
    inBeatTime: number;
    outBeatTime: number;
}

/**
 * Return the region's beat-space in/out as `{ inBeatTime, outBeatTime }`.
 *
 * @param region   Object carrying explicit `inBeatTime` and `outBeatTime`.
 * @returns        The same two values wrapped in an `EffectiveBeatBounds`.
 */
export function effectiveBeatBounds(
    region: { inBeatTime: number; outBeatTime: number },

    _origAnchors?: readonly unknown[],

    _beatAnchors?: readonly unknown[],
): EffectiveBeatBounds {
    return { inBeatTime: region.inBeatTime, outBeatTime: region.outBeatTime };
}
