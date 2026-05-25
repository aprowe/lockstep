import type { TrackDef, LayoutTrack } from "./types";

export const RAIL_W = 72;
export const MINIMAP_H = 24;
export const TRI_HALF = 6;
export const TRI_H = 9;
export const FONT = "ui-monospace, Consolas, monospace";

/** Sentinel `overrides` key for the minimap/overview band. Lets the minimap
 *  share the same per-row height-override map used by every other resizable
 *  track row, instead of carrying its own parallel state. */
export const MINIMAP_KEY = "__minimap__";

export type { TrackDef, LayoutTrack };

// flex weights mirror ThinTimeline's DEFAULT_FLEX — index/strip rows stay at
// their min height (flex 0), expressive rows grow to fill (flex 1).
export const ALL_TRACKS: TrackDef[] = [
    { id: "time", label: "Time", h: 20, space: "input", flex: 1 },
    { id: "scenes", label: "Scenes", h: 18, space: "input", flex: 0 },
    { id: "clipin", label: "Clip In", h: 28, space: "input", flex: 1 },
    { id: "markerin", label: "Anchor In", h: 28, space: "input", flex: 1 },
    { id: "warp", label: "Warp", h: 44, space: "warp", flex: 1 },
    { id: "markerout", label: "Anchor Out", h: 28, space: "output", flex: 1 },
    { id: "clipout", label: "Clip Out", h: 28, space: "output", flex: 0 },
    { id: "beat", label: "Beats", h: 20, space: "output", flex: 1 },
    { id: "speed", label: "Speed", h: 22, space: "output", flex: 0 },
];

export function buildLayout(
    warpCollapsed: boolean,
    totalH: number,
    overrides: Record<string, number> = {},
    hiddenTracks: ReadonlySet<string> = new Set(),
): LayoutTrack[] {
    const visible = ALL_TRACKS.filter(
        (def) => !(warpCollapsed && def.space !== "input") && !hiddenTracks.has(def.id),
    );
    const minimapH = overrides[MINIMAP_KEY] ?? MINIMAP_H;
    // 1px separator below the minimap.
    const available = Math.max(0, totalH - minimapH - 1);

    // Tally preferred (or overridden) heights and flex weights for every
    // visible track to decide between the two layout regimes below.
    let usedH = 0;
    let flexSum = 0;
    for (const t of visible) {
        const baseH = overrides[t.id] ?? t.h;
        usedH += baseH + 1; // +1 for the row separator below this track
        if (overrides[t.id] === undefined) flexSum += t.flex;
    }

    const result: LayoutTrack[] = [];
    let y = minimapH + 1;

    if (usedH <= available) {
        // Everything fits at preferred size; flex tracks split the leftover.
        const extra = available - usedH;
        for (const def of visible) {
            const overrideH = overrides[def.id];
            const baseH = overrideH ?? def.h;
            const h =
                overrideH === undefined && flexSum > 0
                    ? def.h + (def.flex / flexSum) * extra
                    : baseH;
            result.push({ ...def, h, y });
            y += h + 1;
        }
        return result;
    }

    // Tight fit: walk top → bottom giving each track its preferred height
    // while it still fits. The first track that doesn't fit at preferred
    // either gets a partial render (if it would land at ≥ 2/3 preferred) or
    // is dropped so rows never look squished. Any leftover slack is then
    // absorbed by the last surviving track so the timeline never shows an
    // empty band at the bottom.
    let remaining = available;
    for (const def of visible) {
        const baseH = overrides[def.id] ?? def.h;
        const needed = baseH + 1;
        if (remaining >= needed) {
            result.push({ ...def, h: baseH, y });
            y += baseH + 1;
            remaining -= needed;
            continue;
        }
        const minPartial = Math.ceil((baseH * 2) / 3);
        if (remaining - 1 >= minPartial) {
            result.push({ ...def, h: remaining - 1, y });
            remaining = 0;
        }
        break;
    }
    if (remaining > 0 && result.length > 0) {
        result[result.length - 1].h += remaining;
    }
    return result;
}
