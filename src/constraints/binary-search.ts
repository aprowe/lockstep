/**
 * Binary-search helpers for sorted numeric sequences.
 *
 * Hot path: `evaluateSnap` (in `resolver.ts`) uses these to find the
 * snap-radius window inside a value-sorted target list — turning the
 * per-call cost from O(N) to O(log N + k). Lifted out of the resolver
 * because the logic is generic and worth testing on its own.
 *
 * Two flavours:
 *
 *   - `lowerBoundNumber`  — for `Float64Array` or `number[]`.
 *   - `lowerBoundBy<T>`   — for object arrays sorted by a numeric field;
 *                           the value accessor stays inline at the call
 *                           site, which avoids the function-call overhead
 *                           a fully generic comparator would impose in a
 *                           tight loop.
 *
 * Both return the smallest index `i` such that the value at `arr[i]` is
 * `>= target`, or `arr.length` if no such index exists.
 */

/** Lower bound on an `ArrayLike<number>` (covers `Float64Array` and
 *  `number[]`). */
export function lowerBoundNumber(arr: ArrayLike<number>, target: number): number {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (arr[mid] < target) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/** Lower bound on an array of objects, with the comparison value extracted
 *  by `getValue`. The accessor is invoked once per probe (≤ log₂ N times)
 *  — fine even in tight loops. */
export function lowerBoundBy<T>(
    arr: ArrayLike<T>,
    target: number,
    getValue: (item: T) => number,
): number {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (getValue(arr[mid]) < target) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}
