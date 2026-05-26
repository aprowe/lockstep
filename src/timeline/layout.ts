import type { TrackDef, LayoutTrack } from "./types";

export const RAIL_W = 72;
export const MINIMAP_H = 24;
export const TRI_HALF = 6;
export const TRI_H = 9;
export const FONT = "ui-monospace, Consolas, monospace";

export type { TrackDef, LayoutTrack };

// flex weights mirror ThinTimeline's DEFAULT_FLEX — index/strip rows stay at
// their min height (flex 0), expressive rows grow to fill (flex 1).
export const ALL_TRACKS: TrackDef[] = [
    { id: "time", label: "Time", h: 20, space: "input", flex: 1 },
    { id: "scenes", label: "Scenes", h: 18, space: "input", flex: 0 },
    { id: "scene-thumbs", label: "Scene Thumbnails", h: 40, space: "input", flex: 0 },
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
): LayoutTrack[] {
    const visible = ALL_TRACKS.filter((def) => !(warpCollapsed && def.space !== "input"));
    const available = totalH - MINIMAP_H - 1 - visible.length; // gaps between rows

    let usedH = 0;
    let flexSum = 0;
    for (const t of visible) {
        if (overrides[t.id] !== undefined) usedH += overrides[t.id];
        else {
            usedH += t.h;
            flexSum += t.flex;
        }
    }
    const extra = Math.max(0, available - usedH);

    const result: LayoutTrack[] = [];
    let y = MINIMAP_H + 1;
    for (const def of visible) {
        let h: number;
        if (overrides[def.id] !== undefined) h = overrides[def.id];
        else h = def.h + (flexSum > 0 ? (def.flex / flexSum) * extra : 0);
        result.push({ ...def, h, y });
        y += h + 1;
    }
    return result;
}
