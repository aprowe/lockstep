import { type ReactNode } from "react";
import type { RowContext } from "./ListPanel";
import { IconPlay, IconTrash } from "../icons";
import Thumbnail from "../Thumbnail";

/**
 * Boilerplate every list row shares: container with active/selected
 * modifiers, click + hover wiring, optional inline thumbnail in list/grid
 * modes, and a trailing trash button. Selection is expressed purely via
 * the row's selected modifier — no per-row checkbox.
 *
 * Each row file (ClipRow, MarkerRow, SceneRow) just supplies its
 * type-specific cells as `children`. Modifier classes are namespaced via
 * the `kind` prop so per-row styling can hook them (e.g. `clip-row--active`).
 */

interface RowShellProps {
    /** Class prefix for the row, e.g. 'clip-row'. Modifiers become
     *  `${kind}--active`, `${kind}--selected`. */
    kind: string;
    ctx: RowContext;
    children: ReactNode;

    /** Aria label for the per-row trash button (defaults to "Delete item"). */
    deleteLabel?: string;
    /** When omitted, no trash button renders — for rows like the Scenes
     *  t=0 boundary that aren't deletable. */
    onDelete?: () => void;

    onDoubleClick?: () => void;
    onContextMenu?: (e: React.MouseEvent) => void;
    /** Optional override of the row's title attribute. */
    title?: string;
    /** Extra classes appended after the kind modifiers. */
    className?: string;
}

export default function RowShell({
    kind,
    ctx,
    children,
    deleteLabel = "Delete item",
    onDelete,
    onDoubleClick,
    onContextMenu,
    title,
    className,
}: RowShellProps) {
    const {
        isActive,
        isPlaying,
        isSelected,
        viewMode,
        fileHash,
        thumbnailFrame,
        onRowClick,
        onRowMouseEnter,
        onRowMouseLeave,
    } = ctx;

    const cls = [kind, isActive && `${kind}--active`, isSelected && `${kind}--selected`, className]
        .filter(Boolean)
        .join(" ");

    return (
        <div
            className={cls}
            onClick={onRowClick}
            onDoubleClick={onDoubleClick}
            onContextMenu={onContextMenu}
            onMouseEnter={onRowMouseEnter}
            onMouseLeave={onRowMouseLeave}
            title={title}
        >
            {viewMode !== "none" && (
                <div className="list-panel__row-thumb-wrap">
                    <Thumbnail
                        fileHash={fileHash}
                        frame={thumbnailFrame}
                        className="list-panel__row-thumb"
                        placeholderClassName="list-panel__row-thumb--placeholder"
                    />
                    {isPlaying && (
                        <span className="list-panel__row-thumb-play" aria-hidden>
                            <IconPlay size={20} />
                        </span>
                    )}
                </div>
            )}
            {children}
            <span className="list-panel__row-active-mark" aria-hidden>
                {isPlaying && <IconPlay size={11} />}
            </span>
            {onDelete && (
                <button
                    type="button"
                    className={`${kind}__del`}
                    title={deleteLabel}
                    aria-label={deleteLabel}
                    onClick={(e) => {
                        e.stopPropagation();
                        onDelete();
                    }}
                >
                    <IconTrash size={14} />
                </button>
            )}
        </div>
    );
}
