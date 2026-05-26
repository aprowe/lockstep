import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useAppSelector } from "../store/hooks";
import Thumbnail from "./Thumbnail";
import "./ThumbnailPopup.css";

interface HoverState { time: number; x: number; y: number; }
interface Ctx { hovered: HoverState | null; setHovered: (h: HoverState | null) => void; }

const ThumbnailHoverContext = createContext<Ctx | null>(null);

export function ThumbnailHoverProvider({ children }: { children: ReactNode }) {
    const [hovered, setHovered] = useState<HoverState | null>(null);
    const value = useMemo(() => ({ hovered, setHovered }), [hovered]);
    return (
        <ThumbnailHoverContext.Provider value={value}>{children}</ThumbnailHoverContext.Provider>
    );
}

const NOOP_SET: (h: HoverState | null) => void = () => {};

// eslint-disable-next-line react-refresh/only-export-components
export function useSetThumbnailHover() {
    const ctx = useContext(ThumbnailHoverContext);
    return ctx?.setHovered ?? NOOP_SET;
}

export default function ThumbnailPopup() {
    const ctx = useContext(ThumbnailHoverContext);
    const video = useAppSelector((s) => s.video.video);
    if (!ctx || !ctx.hovered || !video || video.fps <= 0) return null;
    const { hovered } = ctx;
    const frame = Math.floor(hovered.time * video.fps);
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
            <Thumbnail
                fileHash={video.fileHash}
                frame={frame}
                className="thumb-popup__img"
                placeholderClassName="thumb-popup__img thumb-popup__img--placeholder"
            />
        </div>
    );
}
