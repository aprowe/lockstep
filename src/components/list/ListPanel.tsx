import { type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
    setListFilterMode,
    setListSelection,
    setListThumbnailMode,
    type ListId,
    type ListThumbnailMode,
} from "../../store/slices/listsSlice";
import { selectActiveRegion } from "../../store/selectors";
import { formatTime } from "../../utils/time";
import { setStripFrames, selectThumbnailPathsFor } from "../../store/slices/thumbnailsSlice";
import { useSetThumbnailHover } from "../ThumbnailPopup";
import { IconDeselect, IconTrash } from "../icons";
import ListFilterTabs from "./ListFilterTabs";
import ListThumbnailToggle from "./ListThumbnailToggle";
import { useListSelection } from "./useListSelection";
import "./ListPanel.css";

/**
 * Generic list panel used by Clips / Markers / Scenes. Owns:
 *   - selection (multi-select, click + shift + ctrl)
 *   - keyboard delete
 *   - per-list thumbnail mode (none / hover / always)
 *   - hover popup wiring + always-on inline thumbnail rendering
 *
 * The caller supplies type-specific row content via `renderRow`. Anything
 * not covered here (in-row editing, swatches, in/out fields) lives there.
 */

export interface ListItem {
    id: string;
    /** Source-time (seconds) used for thumbnail extraction. The same value is
     *  passed to the hover popup so backend prioritisation is consistent. */
    thumbnailTime?: number;
}

export interface RowContext {
    isActive: boolean;
    isSelected: boolean;
    thumbnailMode: ListThumbnailMode;
    thumbnailSrc: string | null;
    /** True when more than one item is currently selected — rows can use this
     *  to surface a checkbox affordance only when the user is actively in a
     *  multi-select gesture, instead of cluttering single-select layouts. */
    multiSelectMode: boolean;
    /** Wire onto the row's outermost element so click/keyboard semantics
     *  flow through useListSelection. */
    onRowClick: (e: React.MouseEvent) => void;
    onRowMouseEnter: (e: React.MouseEvent) => void;
    onRowMouseLeave: () => void;
    /** Toggle this row in/out of the selection without activating it.
     *  Drives the per-row checkbox in multi-select mode. */
    onToggleSelection: () => void;
}

interface ListPanelProps<T extends ListItem> {
    listId: ListId;
    items: T[];
    /** Currently-active id (single-select concept that drives the timeline,
     *  separate from the multi-selection set). */
    activeId?: string | null;
    onActivate?: (id: string) => void;
    onDelete?: (ids: string[]) => void;
    /** Render the row content. The wrapping div + classes are provided. */
    renderRow: (item: T, ctx: RowContext) => ReactNode;
    /** Optional rows rendered above the dynamic items (e.g. a "Full Video"
     *  virtual entry that isn't part of `items`). They receive a stub
     *  RowContext where selection is always false. */
    prefixRows?: ReactNode;
    /** Empty-state hint when items.length === 0. */
    emptyHint?: ReactNode;
    /** Header right-side action slot (e.g. an "+" add button). The thumbnail
     *  toggle is always rendered; this sits to its left. */
    headerActions?: ReactNode;
    /** Optional block rendered between the header bar and the scrollable
     *  rows — used for panel-specific controls (e.g. Scenes' threshold +
     *  min-gap inputs) that shouldn't scroll out of view. */
    subHeader?: ReactNode;

    /** Optional external selection store. When provided, the panel reads /
     *  writes selection through these instead of `lists.selection[listId]`.
     *  Used to mirror lists into existing slices (e.g. markers reuse
     *  `warp.selectedIds` so the timeline lasso and the list stay in sync). */
    selectedIdsOverride?: ReadonlySet<string>;
    onSelectionChangeOverride?: (ids: string[]) => void;

    /** Hide the "Clip" filter tab — used by the clips list itself, where
     *  scoping by active clip would be a tautology. */
    hideClipFilter?: boolean;
    /** Disable the "Clip" filter tab when no active clip is set. */
    clipFilterDisabled?: boolean;
}

const HEIGHT_FOR_MODE: Record<ListThumbnailMode, number> = {
    none: 0,
    small: 36,
    large: 54,
};

export default function ListPanel<T extends ListItem>({
    listId,
    items,
    activeId,
    onActivate,
    onDelete,
    renderRow,
    prefixRows,
    emptyHint,
    headerActions,
    subHeader,
    selectedIdsOverride,
    onSelectionChangeOverride,
    hideClipFilter,
    clipFilterDisabled,
}: ListPanelProps<T>) {
    const dispatch = useAppDispatch();
    const setHover = useSetThumbnailHover();
    const video = useAppSelector((s) => s.video.video);
    const thumbPaths = useAppSelector(selectThumbnailPathsFor(video?.fileHash));
    const thumbnailMode = useAppSelector((s) => s.lists.thumbnailMode[listId]);
    const filterMode = useAppSelector((s) => s.lists.filterMode[listId]);
    const view = useAppSelector((s) => s.ui.view);
    const activeRegion = useAppSelector(selectActiveRegion);
    // Pull colorIndex from the region itself instead of computing from
    // array position — array index would shuffle on reorder, and a stale
    // findIndex during a delete/active-id race could return -1, which then
    // produces "clip-overlay--color--1" (no rule, no color).
    const activeColorIndex = activeRegion?.colorIndex ?? null;
    const defaultSelectionIds = useAppSelector((s) => s.lists.selection[listId]);
    const selectedSet = useMemo(
        () => selectedIdsOverride ?? new Set(defaultSelectionIds),
        [selectedIdsOverride, defaultSelectionIds],
    );

    const itemIds = useMemo(() => items.map((i) => i.id), [items]);

    const onSelectionChange = useCallback(
        (ids: string[]) => {
            if (onSelectionChangeOverride) onSelectionChangeOverride(ids);
            else dispatch(setListSelection({ list: listId, ids }));
        },
        [dispatch, listId, onSelectionChangeOverride],
    );

    const { handleRowClick, handleKeyDown } = useListSelection({
        itemIds,
        selectedIds: selectedSet,
        onSelectionChange,
        onActivate,
        onDelete,
    });

    // ── Always-on thumbnail wiring ────────────────────────────────────────
    // When mode === 'always', push every item's frame to the backend
    // thumbnail queue so the strip-tier scoring covers them. Hover mode
    // doesn't push anything; the hover popup uses the standard score.
    const fps = video?.fps ?? 0;
    const stripFrames = useMemo(() => {
        if (thumbnailMode === "none" || fps <= 0) return [];
        return items
            .map((i) => i.thumbnailTime)
            .filter((t): t is number => typeof t === "number")
            .map((t) => Math.max(0, Math.floor(t * fps)));
    }, [items, thumbnailMode, fps]);

    // Push the always-on frames into the thumbnail strip queue so the
    // backend prioritises them. Hover mode pushes nothing — the popup hits
    // the standard scoring path. Source-keyed so each list panel doesn't
    // overwrite the others' contributions, and clears its source on unmount
    // so closing a panel via View → Panels stops polluting the cache.
    useEffect(() => {
        if (!video) return;
        const fileHash = video.fileHash;
        const source = `list:${listId}`;
        dispatch(setStripFrames({ fileHash, source, frames: stripFrames }));
        return () => {
            dispatch(setStripFrames({ fileHash, source, frames: [] }));
        };
    }, [video, stripFrames, dispatch, listId]);

    const containerRef = useRef<HTMLDivElement | null>(null);

    const multiSelectMode = selectedSet.size >= 2;

    const toggleSelection = useCallback(
        (id: string) => {
            const next = new Set(selectedSet);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            onSelectionChange([...next]);
        },
        [selectedSet, onSelectionChange],
    );

    const buildCtx = useCallback(
        (item: T): RowContext => {
            const isActive = activeId != null && activeId === item.id;
            const isSelected = selectedSet.has(item.id);
            const thumbFrame =
                item.thumbnailTime != null && fps > 0
                    ? Math.max(0, Math.floor(item.thumbnailTime * fps))
                    : -1;
            const thumbPath = thumbFrame >= 0 ? thumbPaths[thumbFrame] : undefined;
            const thumbnailSrc = thumbPath ? convertFileSrc(thumbPath) : null;

            return {
                isActive,
                isSelected,
                thumbnailMode,
                thumbnailSrc,
                multiSelectMode,
                onRowClick: (e) => handleRowClick(item.id, e),
                onRowMouseEnter: (e) => {
                    if (thumbnailMode !== "none" || item.thumbnailTime == null) return;
                    // Anchor the popup to the row's right edge so it doesn't hide the
                    // list while hovering — keeps the click target visible.
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setHover({ time: item.thumbnailTime, x: rect.right, y: rect.top });
                },
                onRowMouseLeave: () => {
                    if (thumbnailMode === "none") setHover(null);
                },
                onToggleSelection: () => toggleSelection(item.id),
            };
        },
        [
            activeId,
            selectedSet,
            thumbnailMode,
            thumbPaths,
            fps,
            handleRowClick,
            setHover,
            multiSelectMode,
            toggleSelection,
        ],
    );

    return (
        <div
            ref={containerRef}
            className="list-panel"
            tabIndex={0}
            onKeyDown={(e) => {
                if (handleKeyDown(e)) e.preventDefault();
            }}
            style={
                {
                    "--list-row-min-height": `${HEIGHT_FOR_MODE[thumbnailMode]}px`,
                } as React.CSSProperties
            }
        >
            {subHeader && <div className="list-panel__subheader">{subHeader}</div>}
            <div className="list-panel__header">
                <div className="list-panel__header-left">
                    <ListFilterTabs
                        mode={filterMode}
                        onChange={(mode) => dispatch(setListFilterMode({ list: listId, mode }))}
                        hideClipOption={hideClipFilter}
                        clipDisabled={clipFilterDisabled}
                    />
                    {multiSelectMode && (
                        <div className="list-panel__selection">
                            <span className="list-panel__selection-count">
                                {selectedSet.size} selected
                            </span>
                            <button
                                type="button"
                                className="list-panel-add"
                                title="Clear selection"
                                onClick={() => onSelectionChange([])}
                            >
                                <IconDeselect size={16} />
                            </button>
                            <button
                                type="button"
                                className="list-panel-add"
                                title="Delete selected"
                                onClick={() => onDelete?.([...selectedSet])}
                            >
                                <IconTrash size={16} />
                            </button>
                        </div>
                    )}
                </div>
                <div className="list-panel__header-actions">
                    {headerActions}
                    <ListThumbnailToggle
                        mode={thumbnailMode}
                        onChange={(mode) => dispatch(setListThumbnailMode({ list: listId, mode }))}
                    />
                </div>
            </div>
            {filterMode === "viewport" && (
                <div className="list-panel__filter-context" title="Current timeline view">
                    {formatTime(view.start)} – {formatTime(view.end)}
                </div>
            )}
            {filterMode === "clip" && activeRegion && (
                <div className="list-panel__filter-context" title={activeRegion.name}>
                    <span
                        className={`list-panel__filter-context-swatch${
                            activeColorIndex !== null
                                ? ` clip-overlay--color-${activeColorIndex % 8}`
                                : ""
                        }`}
                    />
                    <span className="list-panel__filter-context-name">{activeRegion.name}</span>
                </div>
            )}
            <div className="list-panel__rows">
                {prefixRows}
                {items.map((item) => renderRow(item, buildCtx(item)))}
                {items.length === 0 && emptyHint && (
                    <div className="list-panel__empty">{emptyHint}</div>
                )}
            </div>
        </div>
    );
}
