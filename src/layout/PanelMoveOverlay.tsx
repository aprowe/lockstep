import { useEffect, useMemo, useRef, useState } from "react";
import type { DockviewApi } from "dockview";
import "./PanelMoveOverlay.css";

// ── Types ────────────────────────────────────────────────────────────────────

type Position = "top" | "bottom" | "left" | "right" | "center";

interface GroupTarget {
    groupId: string;
    rect: DOMRect;
    /** Polygon points (in group-local pixels) for each drop zone. */
    zones: Record<Position, string>;
    isSourceGroup: boolean;
}

interface PanelMoveOverlayProps {
    api: DockviewApi;
    panelId: string;
    onExit: () => void;
}

// ── Geometry ─────────────────────────────────────────────────────────────────
//
// Split each group rect into a Voronoi-style "+" with a center square:
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
//
// The center box is INSET * width/height; the four triangles fill the rest.
const INSET = 0.3;

function buildZones(w: number, h: number): Record<Position, string> {
    const cx0 = w * INSET;
    const cx1 = w * (1 - INSET);
    const cy0 = h * INSET;
    const cy1 = h * (1 - INSET);
    const pt = (x: number, y: number) => `${x},${y}`;
    return {
        center: [pt(cx0, cy0), pt(cx1, cy0), pt(cx1, cy1), pt(cx0, cy1)].join(" "),
        top: [pt(0, 0), pt(w, 0), pt(cx1, cy0), pt(cx0, cy0)].join(" "),
        right: [pt(w, 0), pt(w, h), pt(cx1, cy1), pt(cx1, cy0)].join(" "),
        bottom: [pt(w, h), pt(0, h), pt(cx0, cy1), pt(cx1, cy1)].join(" "),
        left: [pt(0, h), pt(0, 0), pt(cx0, cy0), pt(cx0, cy1)].join(" "),
    };
}

// ── Component ────────────────────────────────────────────────────────────────

export default function PanelMoveOverlay({ api, panelId, onExit }: PanelMoveOverlayProps) {
    const panel = api.getPanel(panelId);
    const sourceGroupId = panel?.group.id;
    const sourceTitle = panel?.title ?? panelId;

    // Cursor position drives the ghost label. Initialize off-screen so the
    // first paint doesn't flash at (0,0).
    const [cursor, setCursor] = useState<{ x: number; y: number }>({ x: -9999, y: -9999 });

    // Hovered drop target (groupId + position). The mouseup handler needs
    // the latest value synchronously, so we mirror it into a ref — React
    // state alone would stale-close the listener.
    const [hover, setHover] = useState<{ groupId: string; position: Position } | null>(null);
    const hoverRef = useRef<{ groupId: string; position: Position } | null>(null);
    hoverRef.current = hover;

    // Group rects + zone polygons, recomputed when the overlay mounts and on
    // window resize. We deliberately don't recompute on every mousemove —
    // layout doesn't shift during move-mode.
    const [version, setVersion] = useState(0);
    const targets = useMemo<GroupTarget[]>(() => {
        // Skip the locked center (player) group — it can't accept drops.
        return api.groups
            .filter((g) => g.locked !== "no-drop-target")
            .map((g) => {
                const rect = g.element.getBoundingClientRect();
                return {
                    groupId: g.id,
                    rect,
                    zones: buildZones(rect.width, rect.height),
                    isSourceGroup: g.id === sourceGroupId,
                };
            });
        // `version` forces a recompute when the window resizes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, sourceGroupId, version]);

    const overlayRef = useRef<HTMLDivElement>(null);

    // Stable `dispatchMove` ref so the mouseup listener doesn't restart on
    // every render — `panel` and `api` are captured fresh on each call.
    const dispatchMoveRef = useRef<(groupId: string, position: Position) => void>(() => {});
    dispatchMoveRef.current = (groupId, position) => {
        const targetGroup = api.groups.find((g) => g.id === groupId);
        if (!targetGroup) {
            onExit();
            return;
        }
        // Dropping into the source group's center is a no-op — the panel is
        // already there. Exit cleanly instead of calling moveTo with no work.
        if (targetGroup.id === sourceGroupId && position === "center") {
            onExit();
            return;
        }
        if (!panel) {
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
        // Pointer release IS the drop. If a zone is hovered, commit the move;
        // otherwise cancel. We swallow the event so the click that would
        // normally follow doesn't switch tabs underneath us.
        const onUp = (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const target = hoverRef.current;
            if (target) {
                dispatchMoveRef.current(target.groupId, target.position);
            } else {
                onExit();
            }
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp, true);
        window.addEventListener("keydown", onKey, true);
        window.addEventListener("resize", onResize);
        window.addEventListener("contextmenu", onContext, true);
        return () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp, true);
            window.removeEventListener("keydown", onKey, true);
            window.removeEventListener("resize", onResize);
            window.removeEventListener("contextmenu", onContext, true);
        };
    }, [onExit]);

    if (!panel) {
        // Panel vanished while overlay was open — bail.
        return null;
    }

    return (
        <div ref={overlayRef} className="panel-move-overlay">
            {targets.map((t) => (
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
                    {/* Subtle outline so the targetable group is visible. */}
                    <rect
                        x={0.5}
                        y={0.5}
                        width={t.rect.width - 1}
                        height={t.rect.height - 1}
                        className="panel-move-overlay__group-outline"
                    />
                    {(["top", "bottom", "left", "right", "center"] as Position[]).map((pos) => {
                        const isHover =
                            hover?.groupId === t.groupId && hover.position === pos;
                        const isSourceCenter = t.isSourceGroup && pos === "center";
                        return (
                            <polygon
                                key={pos}
                                points={t.zones[pos]}
                                className={[
                                    "panel-move-overlay__zone",
                                    isHover ? "panel-move-overlay__zone--hover" : "",
                                    isSourceCenter ? "panel-move-overlay__zone--source" : "",
                                ]
                                    .filter(Boolean)
                                    .join(" ")}
                                onMouseEnter={() => setHover({ groupId: t.groupId, position: pos })}
                                onMouseLeave={() =>
                                    setHover((h) =>
                                        h?.groupId === t.groupId && h.position === pos ? null : h,
                                    )
                                }
                            />
                        );
                    })}
                </svg>
            ))}

            {/* Cursor-anchored ghost — small badge that follows the pointer so
                the user can see what they're placing. Offset so it doesn't sit
                under the cursor and steal hover from drop zones. */}
            <div
                className="panel-move-overlay__ghost"
                style={{ left: cursor.x + 14, top: cursor.y + 14 }}
            >
                {sourceTitle}
            </div>
        </div>
    );
}
