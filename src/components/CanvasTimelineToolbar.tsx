import { useEffect, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import {
    setTimelineThumbShow,
    setTimelineFollowDrag,
    setTimelineAlwaysAnchors,
    setTimelineAlwaysRegions,
    setTimelineAlwaysScenes,
    setTimelineHiddenTracks,
    toggleTimelineTrackVisibility,
    resetTimelineRowHeights,
    setAnchorLock,
} from "../store/slices/uiSlice";
import { ALL_TRACKS } from "../timeline/layout";
import {
    IconWarpToggle,
    IconAlwaysAnchors,
    IconAlwaysRegions,
    IconAlwaysScenes,
    IconThumbStrip,
    IconFollowDrag,
    IconZoomToRegion,
    IconLockClosed,
    IconTracks,
} from "./icons";
import { getUiScale } from "../uiScale";

// GRID_DIVS kept here so the toolbar can render the select without
// depending on the full CanvasTimeline module.
const GRID_DIVS = [
    { label: "1/1", value: 1 },
    { label: "1/2", value: 2 },
    { label: "1/2T", value: 3 },
    { label: "1/4", value: 4 },
    { label: "1/4T", value: 6 },
    { label: "1/8", value: 8 },
];

export interface CanvasTimelineToolbarProps {
    warpCollapsed?: boolean;
    onToggleWarp?: () => void;
    onZoomToRegion?: () => void;
    gridDiv?: number;
    onGridDivChange?: (div: number) => void;
}

export function CanvasTimelineToolbar({
    warpCollapsed = false,
    onToggleWarp,
    onZoomToRegion,
    gridDiv,
    onGridDivChange,
}: CanvasTimelineToolbarProps) {
    const dispatch = useAppDispatch();
    const alwaysAnchors = useAppSelector((s) => s.ui.timelineAlwaysAnchors);
    const alwaysRegions = useAppSelector((s) => s.ui.timelineAlwaysRegions);
    const alwaysScenes = useAppSelector((s) => s.ui.timelineAlwaysScenes);
    const followDrag = useAppSelector((s) => s.ui.timelineFollowDrag);
    const thumbMode = useAppSelector((s) => (s.ui.timelineThumbShow ? "show" : "none"));
    const anchorLock = useAppSelector((s) => s.ui.anchorLock);
    const hiddenTrackList = useAppSelector((s) => s.ui.timelineHiddenTracks);
    const hiddenTracks = new Set(hiddenTrackList);
    const hasRowHeightOverrides = useAppSelector(
        (s) => Object.keys(s.ui.timelineRowHeights).length > 0,
    );

    const [tracksMenuOpen, setTracksMenuOpen] = useState(false);
    const tracksMenuRef = useRef<HTMLDivElement>(null);
    const tracksBtnRef = useRef<HTMLButtonElement>(null);
    // Captured at open-time so the fixed-positioned popover renders at the
    // right viewport coords. Re-measured each open — the popover doesn't
    // follow the trigger during scroll, but the menu closes on outside
    // click anyway so stale rects don't survive long enough to matter.
    const [tracksMenuAnchor, setTracksMenuAnchor] = useState<{
        left: number;
        bottom: number;
    } | null>(null);
    useEffect(() => {
        if (!tracksMenuOpen) {
            setTracksMenuAnchor(null);
            return;
        }
        const rect = tracksBtnRef.current?.getBoundingClientRect();
        if (rect) {
            setTracksMenuAnchor({
                left: rect.left,
                // CSS uses `bottom` so the popover grows upward — distance
                // from the bottom of the viewport to the top of the trigger,
                // plus a 6px gap.
                bottom: window.innerHeight - rect.top + 6,
            });
        }
        const handler = (e: MouseEvent) => {
            if (
                !tracksMenuRef.current?.contains(e.target as Node) &&
                !tracksBtnRef.current?.contains(e.target as Node)
            ) {
                setTracksMenuOpen(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [tracksMenuOpen]);

    // Alt-held preview: flip the visual while Alt is held anywhere in the app.
    // Use document listeners (broader than window) + pointermove to catch Alt
    // held during pointer movement (no keydown fires in that case). Also clear
    // on window blur so stale altHeld never gets stuck when the window loses focus.
    const [altHeld, setAltHeld] = useState(false);
    useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.altKey) setAltHeld(true);
        };
        const up = (e: KeyboardEvent) => {
            if (!e.altKey) setAltHeld(false);
        };
        const move = (e: PointerEvent | MouseEvent) => {
            setAltHeld(e.altKey);
        };
        const blur = () => setAltHeld(false);
        document.addEventListener("keydown", down);
        document.addEventListener("keyup", up);
        document.addEventListener("pointermove", move);
        window.addEventListener("blur", blur);
        return () => {
            document.removeEventListener("keydown", down);
            document.removeEventListener("keyup", up);
            document.removeEventListener("pointermove", move);
            window.removeEventListener("blur", blur);
        };
    }, []);
    const displayAnchorLock = altHeld ? !anchorLock : anchorLock;

    const [uiScale, setUiScaleState] = useState<number>(() => getUiScale());
    useEffect(() => {
        const handler = (e: Event) => setUiScaleState((e as CustomEvent).detail as number);
        window.addEventListener("ui-scale-change", handler);
        return () => window.removeEventListener("ui-scale-change", handler);
    }, []);
    const iconSize = Math.round(16 * uiScale);

    return (
        <div className="canvas-timeline__toolbar">
            <button
                type="button"
                className={`ct-btn ct-btn--warp${warpCollapsed ? "" : " ct-btn--active"}`}
                onClick={onToggleWarp}
                title={warpCollapsed ? "Show warp views" : "Hide warp views"}
            >
                <IconWarpToggle size={iconSize} />
            </button>
            <button
                type="button"
                className={`ct-btn ct-btn--thumbs${thumbMode === "show" ? " ct-btn--active" : ""}`}
                onClick={() => dispatch(setTimelineThumbShow(thumbMode !== "show"))}
                title={thumbMode === "show" ? "Hide thumbnails" : "Show thumbnails"}
            >
                <IconThumbStrip size={iconSize} />
            </button>

            <span className="ct-sep" />

            <button
                type="button"
                className={`ct-btn ct-btn--zoom${onZoomToRegion ? "" : " ct-btn--disabled"}`}
                onClick={onZoomToRegion}
                disabled={!onZoomToRegion}
                title="Zoom to active clip"
            >
                <IconZoomToRegion size={iconSize} />
            </button>
            <button
                type="button"
                className={`ct-btn ct-btn--anchor-lock${displayAnchorLock ? " ct-btn--active" : ""}${altHeld ? " ct-btn--alt-preview" : ""}`}
                onClick={() => dispatch(setAnchorLock(!anchorLock))}
                title={
                    altHeld
                        ? `Alt held — anchor lock will act as ${!anchorLock ? "ON" : "OFF"} for this gesture`
                        : `Anchor lock: ${anchorLock ? "ON" : "OFF"} — beat anchors inside clip ${anchorLock ? "move with resize/pan" : "stay in place"} (Alt reverses)`
                }
            >
                <IconLockClosed size={iconSize} />
            </button>

            <span className="ct-sep" />

            <button
                type="button"
                className={`ct-btn ct-btn--follow${followDrag ? " ct-btn--active" : ""}`}
                onClick={() => dispatch(setTimelineFollowDrag(!followDrag))}
                title="Playhead follows dragged anchors"
            >
                <IconFollowDrag size={iconSize} />
            </button>

            <span className="ct-sep" />

            <button
                type="button"
                className={`ct-btn ct-btn--anchors${alwaysAnchors ? " ct-btn--active" : ""}`}
                onClick={() => dispatch(setTimelineAlwaysAnchors(!alwaysAnchors))}
                title="Always show anchor through-lines"
            >
                <IconAlwaysAnchors size={iconSize} />
            </button>
            <button
                type="button"
                className={`ct-btn ct-btn--regions${alwaysRegions ? " ct-btn--active" : ""}`}
                onClick={() => dispatch(setTimelineAlwaysRegions(!alwaysRegions))}
                title="Always show region edge through-lines"
            >
                <IconAlwaysRegions size={iconSize} />
            </button>
            <button
                type="button"
                className={`ct-btn ct-btn--scenes${alwaysScenes ? " ct-btn--active" : ""}`}
                onClick={() => dispatch(setTimelineAlwaysScenes(!alwaysScenes))}
                title="Always show scene through-lines"
            >
                <IconAlwaysScenes size={iconSize} />
            </button>

            <span className="ct-sep" />

            <div className="ct-tracks-menu">
                <button
                    ref={tracksBtnRef}
                    type="button"
                    className={`ct-btn ct-btn--tracks${tracksMenuOpen ? " ct-btn--active" : ""}${hiddenTracks.size > 0 ? " ct-btn--has-hidden" : ""}`}
                    onClick={() => setTracksMenuOpen((v) => !v)}
                    title="Toggle track visibility"
                    aria-expanded={tracksMenuOpen}
                    aria-haspopup="true"
                >
                    <IconTracks size={iconSize} />
                </button>
                {tracksMenuOpen && tracksMenuAnchor && (
                    <div
                        ref={tracksMenuRef}
                        className="ct-tracks-popover"
                        role="menu"
                        style={{
                            left: tracksMenuAnchor.left,
                            bottom: tracksMenuAnchor.bottom,
                        }}
                    >
                        <div className="ct-tracks-popover__header">
                            <span className="ct-tracks-popover__title">Tracks</span>
                        </div>
                        <div className="ct-tracks-popover__actions">
                            <button
                                type="button"
                                className="ct-tracks-popover__reset"
                                disabled={!hasRowHeightOverrides}
                                onClick={() => dispatch(resetTimelineRowHeights())}
                                title="Reset all track heights to defaults"
                            >
                                Reset sizes
                            </button>
                            <button
                                type="button"
                                className="ct-tracks-popover__reset"
                                disabled={hiddenTracks.size === 0}
                                onClick={() => dispatch(setTimelineHiddenTracks([]))}
                                title="Show all tracks"
                            >
                                Show all
                            </button>
                        </div>
                        <ul className="ct-tracks-popover__list">
                            {ALL_TRACKS.map((t) => {
                                const visible = !hiddenTracks.has(t.id);
                                return (
                                    <li key={t.id}>
                                        <label className="ct-tracks-popover__item">
                                            <input
                                                type="checkbox"
                                                checked={visible}
                                                onChange={() =>
                                                    dispatch(
                                                        toggleTimelineTrackVisibility(t.id),
                                                    )
                                                }
                                            />
                                            <span className="ct-tracks-popover__label">
                                                {t.label}
                                            </span>
                                        </label>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                )}
            </div>

            <span className="ct-sep" />

            {onGridDivChange && (
                <>
                    <span className="ct-spacer" />
                    <div className="ct-grid-group">
                        <span className="ct-grid-label">Grid</span>
                        <select
                            className="ct-select"
                            value={gridDiv ?? 1}
                            onChange={(e) => onGridDivChange(parseInt(e.target.value))}
                        >
                            {GRID_DIVS.map((g) => (
                                <option key={g.value} value={g.value}>
                                    {g.label}
                                </option>
                            ))}
                        </select>
                    </div>
                </>
            )}
        </div>
    );
}
