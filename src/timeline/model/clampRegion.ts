export const MIN_REGION_LENGTH = 1;

export interface RegionBoundsInput {
    inPoint: number;
    outPoint: number;
}

export interface ClampOptions {
    /** Minimum allowed span (seconds). Defaults to MIN_REGION_LENGTH. */
    minLength?: number;
}

/**
 * Reconcile a requested region in/out against the region's current bounds,
 * preserving length when the requested values cross over each other, and
 * enforcing a minimum span otherwise.
 *
 * The "which boundary moved" detection compares `requested` against
 * `current` — if `requested.inPoint !== current.inPoint`, in moved; else
 * out moved.
 */
export function clampRegionInOut(
    current: RegionBoundsInput,
    requested: RegionBoundsInput,
    opts: ClampOptions = {},
): RegionBoundsInput {
    const minLength = opts.minLength ?? MIN_REGION_LENGTH;
    let { inPoint: newIn, outPoint: newOut } = requested;
    const length = current.outPoint - current.inPoint;

    if (newIn > current.outPoint) {
        newOut = newIn + length;
    } else if (newOut < current.inPoint) {
        newIn = newOut - length;
    } else if (newOut - newIn < minLength) {
        if (newIn !== current.inPoint) {
            newIn = newOut - minLength;
        } else {
            newOut = newIn + minLength;
        }
    }

    return { inPoint: newIn, outPoint: newOut };
}
