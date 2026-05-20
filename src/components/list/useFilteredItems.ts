import { useMemo } from "react";
import { useAppSelector } from "../../store/hooks";
import { selectActiveRegion } from "../../store/selectors";
import type { ListFilterMode } from "../../store/slices/listsSlice";

/**
 * Closed-interval window. Markers / scenes / clips all reduce to "does
 * this item overlap [start, end]?" — using closed bounds avoids the
 * inconsistent `> vs >=` choices the per-panel filters used to make.
 */
export interface ItemRange {
    start: number;
    end: number;
}

interface UseFilteredItemsOpts<T> {
    items: T[];
    filterMode: ListFilterMode;
    /** Source-time range for one item. For points (markers, scene starts)
     *  return `{ start: t, end: t }`; for spans (clips, scene boundaries)
     *  return `{ start: in, end: out }`. */
    getRange: (item: T) => ItemRange;
}

/**
 * Apply the active-list filter mode to a stream of items.
 *
 *   global    → return items as-is
 *   viewport  → keep items whose range overlaps the timeline view
 *   clip      → keep items whose range overlaps the active region;
 *               returns [] when no active region is set so the panel
 *               can render a "select a clip" hint instead of falling
 *               through to the unfiltered list.
 *
 * Reads view + active region from the store directly so callers don't
 * have to thread them in — keeps the per-panel adapter focused on its
 * own data shape.
 */
export function useFilteredItems<T>({ items, filterMode, getRange }: UseFilteredItemsOpts<T>): T[] {
    const view = useAppSelector((s) => s.ui.view);
    const activeRegion = useAppSelector(selectActiveRegion);

    return useMemo(() => {
        if (filterMode === "global") return items;
        const window =
            filterMode === "viewport"
                ? { start: view.start, end: view.end }
                : activeRegion
                  ? { start: activeRegion.inPoint, end: activeRegion.outPoint }
                  : null;
        if (!window) return [];
        return items.filter((item) => {
            const r = getRange(item);
            return r.end >= window.start && r.start <= window.end;
        });
    }, [items, filterMode, view.start, view.end, activeRegion, getRange]);
}
