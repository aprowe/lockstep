import "./HudChip.css";

interface HudChipProps {
    label: string;
    /** Optional muted descriptor shown before the label. */
    title?: string;
    visible: boolean;
    position?: "top-center" | "top-right" | "top-left" | "bottom-right" | "bottom-left";
    /** Use fixed positioning (viewport-relative) instead of absolute. */
    fixed?: boolean;
}

export default function HudChip({
    label,
    title,
    visible,
    position = "bottom-right",
    fixed = false,
}: HudChipProps) {
    return (
        <div
            className={`hud-chip hud-chip--${position}${fixed ? " hud-chip--fixed" : ""}${visible ? " hud-chip--visible" : ""}`}
            aria-hidden="true"
        >
            {title && <span className="hud-chip__title">{title}</span>}
            <span className="hud-chip__label">{label}</span>
        </div>
    );
}
