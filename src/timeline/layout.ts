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
    // gaps between rows + 1px sep below the minimap.
    const available = Math.max(0, totalH - minimapH - 1 - visible.length);

    let usedH = 0;
    let flexSum = 0;
    for (const t of visible) {
        if (overrides[t.id] !== undefined) usedH += overrides[t.id];
        else {
            usedH += t.h;
            flexSum += t.flex;
        }
    }
    // When the canvas is too small to satisfy the preferred / overridden
    // heights, scale everything down proportionally so no track spills off
    // the bottom. Otherwise, give the flex tracks the leftover space.
    const tightFit = usedH > available && usedH > 0;
    const scale = tightFit ? available / usedH : 1;
    const extra = tightFit ? 0 : available - usedH;

    const result: LayoutTrack[] = [];
    let y = minimapH + 1;
    for (const def of visible) {
        const overrideH = overrides[def.id];
        const baseH = overrideH ?? def.h;
        let h: number;
        if (tightFit) {
            h = baseH * scale;
        } else if (overrideH === undefined && flexSum > 0) {
            // Flex track at preferred size — also gets its share of the slack.
            h = def.h + (def.flex / flexSum) * extra;
        } else {
            // Overridden track, or non-flex track at preferred size.
            h = baseH;
        }
        result.push({ ...def, h, y });
        y += h + 1;
    }
    return result;
}
