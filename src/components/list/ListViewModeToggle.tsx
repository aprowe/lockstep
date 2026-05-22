import React from "react";
import type { ListViewMode } from "../../store/slices/listsSlice";
import { IconThumbNone, IconThumbList, IconThumbGrid } from "../icons";
import "./ListViewModeToggle.css";

const ORDER: ListViewMode[] = ["none", "list", "grid"];

const ICON_EL: Record<ListViewMode, React.ReactNode> = {
    none: <IconThumbNone size={16} />,
    list: <IconThumbList size={16} />,
    grid: <IconThumbGrid size={16} />,
};

const LABELS: Record<ListViewMode, string> = {
    none: "View: no thumbnails",
    list: "View: list with thumbnails",
    grid: "View: grid",
};

interface Props {
    mode: ListViewMode;
    onChange: (mode: ListViewMode) => void;
}

/** Mode-cycle button in the top-right of every list panel. Clicking walks
 *  none → list → grid → none. The icon mirrors the current mode so the
 *  affordance reads at a glance. */
export default function ListViewModeToggle({ mode, onChange }: Props) {
    const next = () => {
        const i = ORDER.indexOf(mode);
        onChange(ORDER[(i + 1) % ORDER.length]);
    };
    return (
        <button
            type="button"
            className="list-view-toggle"
            title={LABELS[mode]}
            aria-label={LABELS[mode]}
            onClick={next}
        >
            {ICON_EL[mode]}
        </button>
    );
}
