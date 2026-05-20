import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useAppSelector } from "../store/hooks";
import { selectThumbnailPathsFor } from "../store/slices/thumbnailsSlice";
import "./ThumbnailPopup.css";

interface HoverState {
    time: number;
    /** Center x (client coords) — popup is centered horizontally on this. */
    x: number;
    /** Top y (client coords) — popup sits just above this. */
    y: number;
}

interface Ctx {
    hovered: HoverState | null;
    setHovered: (h: HoverState | null) => void;
}

const ThumbnailHoverContext = createContext<Ctx | null>(null);

export function ThumbnailHoverProvider({ children }: { children: ReactNode }) {
    const [hovered, setHovered] = useState<HoverState | null>(null);
    const value = useMemo(() => ({ hovered, setHovered }), [hovered]);
    return (
        <ThumbnailHoverContext.Provider value={value}>{children}</ThumbnailHoverContext.Provider>
    );
}

const NOOP_SET: (h: HoverState | null) => void = () => {};

export function useSetThumbnailHover() {
    const ctx = useContext(ThumbnailHoverContext);
    return ctx?.setHovered ?? NOOP_SET;
}

export default function ThumbnailPopup() {
    const ctx = useContext(ThumbnailHoverContext);
    const video = useAppSelector((s) => s.video.video);
    const thumbPaths = useAppSelector(selectThumbnailPathsFor(video?.fileHash));
    if (!ctx || !ctx.hovered || !video || video.fps <= 0) return null;
    const { hovered } = ctx;
    const frame = Math.floor(hovered.time * video.fps);
    const path = thumbPaths[frame];
    const src = path ? convertFileSrc(path) : null;
    return (
        <div
            className="thumb-popup"
            style={{
                position: "fixed",
                left: hovered.x + 12,
                top: hovered.y - 12,
                transform: "translate(0, -100%)",
                pointerEvents: "none",
            }}
        >
            {src ? (
                <img className="thumb-popup__img" src={src} alt="" draggable={false} />
            ) : (
                <div className="thumb-popup__img thumb-popup__img--placeholder" />
            )}
        </div>
    );
}
