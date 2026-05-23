import { useEffect, useMemo, useRef, useState } from "react";
import type { DockviewApi } from "dockview";
import "./PanelMoveOverlay.css";

// ── Types ────────────────────────────────────────────────────────────────────

type Position = "top" | "bottom" | "left" | "right" | "center";
type EdgePosition = Exclude<Position, "center">;

interface Rect {
    left: number;
    top: number;
    width: number;
    height: number;
}

interface EdgeInsets {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

interface GroupTarget {
    groupId: string;
    rect: DOMRect;
    /** Polygon points (in group-local pixels) for each drop zone. */
    zones: Record<Position, string>;
    /** True for groups locked with `"no-drop-target"` — they accept edge
     *  drops (which create a new sibling) but not center drops (which would
     *  tab into the locked group). */
    centerDisabled: boolean;
}

interface PanelMoveOverlayProps {
    api: DockviewApi;
    panelId: string;
    onExit: () => void;
}

// ── Geometry ─────────────────────────────────────────────────────────────────
//
// Each group is split into a Voronoi-style "+" with a center square:
//
//   ┌──────────────────────┐
//   │   ╲      top      ╱  │
//   │     ╲          ╱     │
//   │       ┌──────┐       │
//   │  left │center│ right │
//   │       └──────┘       │
//   │     ╱          ╲     │
//   │   ╱    bottom    ╲   │
//   └──────────────────────┘

/** Trapezoid depth as a fraction of the usable dimension, capped in pixels. */
const INSET = 0.2;
const MAX_DEPTH = 60;

/** Width of the outer-perimeter trapezoids around the whole dock. Group
 *  edges that touch the dock perimeter are inset by this much so per-group
 *  hit zones never overlap the perimeter ones. */
const PERIMETER = 24;

/** Inner edge highlights fill half the group on the hovered side (dockview
 *  convention — previews the split landing site). */
const INNER_HIGHLIGHT_RATIO = 0.5;

/** Outer edge highlights draw a thin strip flush against the dock edge,
 *  matched in thickness to the perimeter trapezoid so the highlight sits
 *  exactly inside the hit zone. */
const OUTER_HIGHLIGHT_RATIO = 0.1;
const OUTER_HIGHLIGHT_MAX = PERIMETER;

/** Sentinel `groupId` used by perimeter polygons. Distinguishes "drop at
 *  the dock's outer edge" from "drop into a specific group" so dispatch can
 *  route to dockview's root-edge `addGroup` path (mirroring its built-in
 *  `dv-drop-target-edge`) instead of the per-group `moveTo` path. */
const EDGE_TARGET = "__edge__";

function buildZones(w: number, h: number, insets: EdgeInsets): Record<Position, string> {
    const x0 = insets.left;
    const y0 = insets.top;
    const x1 = w - insets.right;
    const y1 = h - insets.bottom;
    const usableW = Math.max(0, x1 - x0);
    const usableH = Math.max(0, y1 - y0);
    // Top/bottom take their depth from height, left/right from width — so a
    // tall-narrow panel gets a normal left/right zone and a shallow top/bottom
    // (and vice versa) rather than collapsing to the shorter axis.
    const depthX = Math.min(usableW * INSET, MAX_DEPTH);
    const depthY = Math.min(usableH * INSET, MAX_DEPTH);
    const cx0 = x0 + depthX;
    const cx1 = x1 - depthX;
    const cy0 = y0 + depthY;
    const cy1 = y1 - depthY;
    const pt = (x: number, y: number) => `${x},${y}`;
    return {
        center: [pt(cx0, cy0), pt(cx1, cy0), pt(cx1, cy1), pt(cx0, cy1)].join(" "),
        top: [pt(x0, y0), pt(x1, y0), pt(cx1, cy0), pt(cx0, cy0)].join(" "),
        right: [pt(x1, y0), pt(x1, y1), pt(cx1, cy1), pt(cx1, cy0)].join(" "),
        bottom: [pt(x1, y1), pt(x0, y1), pt(cx0, cy1), pt(cx1, cy1)].join(" "),
        left: [pt(x0, y1), pt(x0, y0), pt(cx0, cy0), pt(cx0, cy1)].join(" "),
    };
}

/** Hovered drop zone → on-screen highlight rectangle. Center fills the
 *  whole rect; inner edges fill half; outer edges draw a thin border strip. */
function highlightRect(rect: Rect, position: Position, isOuter: boolean): Rect {
    if (position === "center") return rect;
    const ratio = isOuter ? OUTER_HIGHLIGHT_RATIO : INNER_HIGHLIGHT_RATIO;
    const cap = isOuter ? OUTER_HIGHLIGHT_MAX : Infinity;
    switch (position) {
        case "top": {
            const h = Math.min(rect.height * ratio, cap);
            return { left: rect.left, top: rect.top, width: rect.width, height: h };
        }
        case "bottom": {
            const h = Math.min(rect.height * ratio, cap);
            return { left: rect.left, top: rect.top + rect.height - h, width: rect.width, height: h };
        }
        case "left": {
            const w = Math.min(rect.width * ratio, cap);
            return { left: rect.left, top: rect.top, width: w, height: rect.height };
        }
        case "right": {
            const w = Math.min(rect.width * ratio, cap);
            return { left: rect.left + rect.width - w, top: rect.top, width: w, height: rect.height };
        }
    }
}

// ── Component ────────────────────────────────────────────────────────────────

export default function PanelMoveOverlay({ api, panelId, onExit }: PanelMoveOverlayProps) {
    const panel = api.getPanel(panelId);
    const sourceGroupId = panel?.group.id;
    const sourceTitle = panel?.title ?? panelId;

    // Cursor position drives the ghost label. Off-screen initial value so the
    // first paint doesn't flash at (0,0).
    const [cursor, setCursor] = useState<{ x: number; y: number }>({ x: -9999, y: -9999 });

    // Hovered zone for the highlight overlay only. The drop itself reads from
    // `elementFromPoint` at mouseup, so React batching of hover state past a
    // fast release can't cause a missed drop.
    const [hover, setHover] = useState<{ groupId: string; position: Position } | null>(null);

    // Group rects + zone polygons recomputed on mount and on window resize —
    // not on mousemove, since layout doesn't shift during move-mode.
    const [version, setVersion] = useState(0);
    const { targets, perimeterBBox } = useMemo<{
        targets: GroupTarget[];
        perimeterBBox: { minX: number; minY: number; maxX: number; maxY: number } | null;
    }>(() => {
        // Include locked groups (e.g. the player's center group) — they
        // accept edge drops, which create a new sibling rather than tabbing
        // into the locked group. Only the center zone is suppressed for them.
        const groups = api.groups;
        if (groups.length === 0) return { targets: [], perimeterBBox: null };
        const rects = groups.map((g) => g.element.getBoundingClientRect());
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const r of rects) {
            if (r.left < minX) minX = r.left;
            if (r.top < minY) minY = r.top;
            if (r.right > maxX) maxX = r.right;
            if (r.bottom > maxY) maxY = r.bottom;
        }
        // Sub-pixel tolerance — sibling DOMRects can round inconsistently.
        const EPS = 1;
        const built: GroupTarget[] = groups.map((g, i) => {
            const rect = rects[i];
            const insets: EdgeInsets = {
                top: Math.abs(rect.top - minY) < EPS ? PERIMETER : 0,
                right: Math.abs(rect.right - maxX) < EPS ? PERIMETER : 0,
                bottom: Math.abs(rect.bottom - maxY) < EPS ? PERIMETER : 0,
                left: Math.abs(rect.left - minX) < EPS ? PERIMETER : 0,
            };
            return {
                groupId: g.id,
                rect,
                zones: buildZones(rect.width, rect.height, insets),
                centerDisabled: g.locked === "no-drop-target",
            };
        });
        return { targets: built, perimeterBBox: { minX, minY, maxX, maxY } };
        // `version` is intentional — it forces a recompute on window resize.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, sourceGroupId, version]);

    // Latest dispatch closure kept on a ref so the global mouseup listener
    // doesn't reinstall on every render (which could drop a fast release).
    const dispatchMoveRef = useRef<(groupId: string, position: Position) => void>(() => {});
    dispatchMoveRef.current = (groupId, position) => {
        if (!panel) {
            onExit();
            return;
        }
        if (groupId === EDGE_TARGET) {
            // Mirror dockview's root drop target: addGroup with a direction
            // and no reference hits the same orthogonalize(position) path
            // internally, producing a new root-level sibling rather than a
            // split inside one of the existing groups.
            if (position === "center") {
                onExit();
                return;
            }
            const direction =
                position === "top" ? "above" : position === "bottom" ? "below" : position;
            const newGroup = api.addGroup({ direction });
            panel.api.moveTo({ group: newGroup });
            onExit();
            return;
        }
        const targetGroup = api.groups.find((g) => g.id === groupId);
        if (!targetGroup) {
            onExit();
            return;
        }
        // Dropping into the source group's center is a no-op.
        if (targetGroup.id === sourceGroupId && position === "center") {
            onExit();
            return;
        }
        panel.api.moveTo({ group: targetGroup, position });
        onExit();
    };

    // Mouse tracking + drop + cancel keys.
    useEffect(() => {
        const onMove = (e: MouseEvent) => setCursor({ x: e.clientX, y: e.clientY });
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                onExit();
            }
        };
        const onResize = () => setVersion((v) => v + 1);
        // Right-click anywhere cancels.
        const onContext = (e: MouseEvent) => {
            e.preventDefault();
            onExit();
        };
        // Pointer release IS the drop. Hit-test via elementFromPoint rather
        // than reading hover state — DOM hit-tests are always current.
        const onUp = (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const el = document.elementFromPoint(e.clientX, e.clientY);
            const poly = el && el.tagName.toLowerCase() === "polygon" ? el : null;
            const groupId = poly?.getAttribute("data-group-id");
            const position = poly?.getAttribute("data-position") as Position | null;
            if (groupId && position) {
                dispatchMoveRef.current(groupId, position);
            } else {
                onExit();
            }
        };
        // Window blur (release over OS chrome, alt-tab, etc.) may never
        // deliver mouseup — cancel so the overlay isn't stuck open.
        const onBlur = () => onExit();
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp, true);
        window.addEventListener("keydown", onKey, true);
        window.addEventListener("resize", onResize);
        window.addEventListener("contextmenu", onContext, true);
        window.addEventListener("blur", onBlur);
        return () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp, true);
            window.removeEventListener("keydown", onKey, true);
            window.removeEventListener("resize", onResize);
            window.removeEventListener("contextmenu", onContext, true);
            window.removeEventListener("blur", onBlur);
        };
    }, [onExit]);

    if (!panel) {
        // Panel vanished while overlay was open — bail.
        return null;
    }

    const setHoverTo = (groupId: string, position: Position) =>
        setHover({ groupId, position });
    const clearHoverIf = (groupId: string, position: Position) =>
        setHover((h) => (h?.groupId === groupId && h.position === position ? null : h));

    // Highlight base rect resolved once for the current hover.
    const highlight: { rect: Rect; isOuter: boolean } | null = (() => {
        if (!hover) return null;
        // Source-center is a no-op drop — don't preview it.
        if (hover.groupId === sourceGroupId && hover.position === "center") return null;
        const isOuter = hover.groupId === EDGE_TARGET;
        if (isOuter) {
            if (!perimeterBBox) return null;
            const base: Rect = {
                left: perimeterBBox.minX,
                top: perimeterBBox.minY,
                width: perimeterBBox.maxX - perimeterBBox.minX,
                height: perimeterBBox.maxY - perimeterBBox.minY,
            };
            return { rect: highlightRect(base, hover.position, true), isOuter };
        }
        const target = targets.find((t) => t.groupId === hover.groupId);
        if (!target) return null;
        const base: Rect = {
            left: target.rect.left,
            top: target.rect.top,
            width: target.rect.width,
            height: target.rect.height,
        };
        return { rect: highlightRect(base, hover.position, false), isOuter };
    })();

    return (
        <div className="panel-move-overlay">
            {/* Per-group hit zones (invisible polygons). */}
            {targets.map((t) => {
                const positions: Position[] = t.centerDisabled
                    ? ["top", "bottom", "left", "right"]
                    : ["top", "bottom", "left", "right", "center"];
                return (
                    <svg
                        key={t.groupId}
                        className="panel-move-overlay__group"
                        style={{
                            left: t.rect.left,
                            top: t.rect.top,
                            width: t.rect.width,
                            height: t.rect.height,
                        }}
                        viewBox={`0 0 ${t.rect.width} ${t.rect.height}`}
                        preserveAspectRatio="none"
                    >
                        {positions.map((pos) => (
                            <polygon
                                key={pos}
                                points={t.zones[pos]}
                                data-group-id={t.groupId}
                                data-position={pos}
                                className="panel-move-overlay__zone"
                                onMouseEnter={() => setHoverTo(t.groupId, pos)}
                                onMouseLeave={() => clearHoverIf(t.groupId, pos)}
                            />
                        ))}
                    </svg>
                );
            })}

            {/* Outer-perimeter hit zones — drops here place the panel as a
                root-level sibling (e.g. a new column right of a horizontally
                split row) rather than inside any existing group. */}
            {perimeterBBox && (() => {
                const w = perimeterBBox.maxX - perimeterBBox.minX;
                const h = perimeterBBox.maxY - perimeterBBox.minY;
                const d = PERIMETER;
                const pt = (x: number, y: number) => `${x},${y}`;
                const strips: Array<{ pos: EdgePosition; points: string }> = [
                    { pos: "top",    points: [pt(0, 0), pt(w, 0), pt(w - d, d), pt(d, d)].join(" ") },
                    { pos: "right",  points: [pt(w, 0), pt(w, h), pt(w - d, h - d), pt(w - d, d)].join(" ") },
                    { pos: "bottom", points: [pt(w, h), pt(0, h), pt(d, h - d), pt(w - d, h - d)].join(" ") },
                    { pos: "left",   points: [pt(0, h), pt(0, 0), pt(d, d), pt(d, h - d)].join(" ") },
                ];
                return (
                    <svg
                        className="panel-move-overlay__perimeter"
                        style={{ left: perimeterBBox.minX, top: perimeterBBox.minY, width: w, height: h }}
                        viewBox={`0 0 ${w} ${h}`}
                        preserveAspectRatio="none"
                    >
                        {strips.map(({ pos, points }) => (
                            <polygon
                                key={pos}
                                points={points}
                                data-group-id={EDGE_TARGET}
                                data-position={pos}
                                className="panel-move-overlay__zone"
                                onMouseEnter={() => setHoverTo(EDGE_TARGET, pos)}
                                onMouseLeave={() => clearHoverIf(EDGE_TARGET, pos)}
                            />
                        ))}
                    </svg>
                );
            })()}

            {/* Single highlight rectangle for the current hover. */}
            {highlight && (
                <div
                    className="panel-move-overlay__highlight"
                    style={{
                        left: highlight.rect.left,
                        top: highlight.rect.top,
                        width: highlight.rect.width,
                        height: highlight.rect.height,
                    }}
                />
            )}

            {/* Cursor-anchored label showing what's being placed. Offset so
                it doesn't sit under the cursor and steal hover from zones. */}
            <div
                className="panel-move-overlay__ghost"
                style={{ left: cursor.x + 14, top: cursor.y + 14 }}
            >
                {sourceTitle}
            </div>
        </div>
    );
}
