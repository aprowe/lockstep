import { type ReactNode, useCallback, useMemo, useRef } from "react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
    setListFilterMode,
    setListSelection,
    setListThumbnailSize,
    setListViewMode,
    type ListId,
    type ListViewMode,
} from "../../store/slices/listsSlice";
import { selectActiveRegion } from "../../store/selectors";
import { formatTime } from "../../utils/time";
import { setHover } from "../../store/slices/thumbnailsSlice";
import { ThumbnailReason, type HoverReason } from "../../api/thumbnailReason";
import { useSetThumbnailHover } from "../ThumbnailPopup";
import { IconDeselect, IconTrash } from "../icons";
import ListFilterTabs from "./ListFilterTabs";
import ListViewModeToggle from "./ListViewModeToggle";
import ListThumbnailSizeSlider from "./ListThumbnailSizeSlider";
import { useListSelection } from "./useListSelection";
import "./ListPanel.css";

/**
 * Generic list panel used by Clips / Markers / Scenes. Owns:
 *   - selection (multi-select, click + shift + ctrl)
 *   - keyboard delete
 *   - per-list view mode (none / list / grid) + thumbnail size slider
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
    /** True when this row is "currently playing" — drives the inline +
     *  thumbnail play icon. Distinct from `isActive` (visual selection) so
     *  the clips list can highlight the user-picked clip while only the
     *  region containing the playhead shows the play indicator. For
     *  scenes / markers the panel doesn't pass `playingId` so this falls
     *  back to `isActive`. */
    isPlaying: boolean;
    viewMode: ListViewMode;
    fileHash: string | null;
    thumbnailFrame: number | null;
    /** Wire onto the row's outermost element so click/keyboard semantics
     *  flow through useListSelection. */
    onRowClick: (e: React.MouseEvent) => void;
    onRowMouseEnter: (e: React.MouseEvent) => void;
    onRowMouseLeave: () => void;
}

interface ListPanelProps<T extends ListItem> {
    listId: ListId;
    items: T[];
    /** Currently-active id (single-select concept that drives the timeline,
     *  separate from the multi-selection set). */
    activeId?: string | null;
    /** Row whose range the playhead is currently inside — drives the play
     *  icon independently from `activeId`. Omit (or pass `undefined`) to
     *  let it fall back to `activeId`; pass `null` to explicitly disable
     *  the play indicator for every row. */
    playingId?: string | null;
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
    /** Header right-side action slot (e.g. an "+" add button). The view-mode
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

export default function ListPanel<T extends ListItem>({
    listId,
    items,
    activeId,
    playingId,
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
    const setPopupHover = useSetThumbnailHover();
    const video = useAppSelector((s) => s.video.video);
    const viewMode = useAppSelector((s) => s.lists.viewMode[listId]);
    const thumbnailSize = useAppSelector((s) => s.lists.thumbnailSize[listId]);
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

    const fps = video?.fps ?? 0;
    const dragActive = useAppSelector((s) => s.drag.active);

    // Freeze each row's resolved thumbnail frame while a drag is in flight.
    // Region in-points and anchor times mutate every pointer event during
    // a drag (the constraint pipeline replays them); without freezing, list
    // rows flicker to placeholder until the new frame is extracted on
    // dragEnd. Snapshot is taken once at dragStart and cleared on dragEnd.
    const frozenFramesRef = useRef<Map<string, number | null> | null>(null);
    const wasDraggingRef = useRef(false);
    if (dragActive && !wasDraggingRef.current) {
        const snap = new Map<string, number | null>();
        for (const i of items) {
            snap.set(
                i.id,
                i.thumbnailTime != null && fps > 0
                    ? Math.max(0, Math.floor(i.thumbnailTime * fps))
                    : null,
            );
        }
        frozenFramesRef.current = snap;
    } else if (!dragActive && wasDraggingRef.current) {
        frozenFramesRef.current = null;
    }
    wasDraggingRef.current = dragActive;

    const hoverReason: HoverReason | null =
        listId === "clips" ? ThumbnailReason.ClipHover :
        listId === "scenes" ? ThumbnailReason.SceneHover :
        listId === "markers" ? ThumbnailReason.AnchorHover :
        null;

    const containerRef = useRef<HTMLDivElement | null>(null);

    const multiSelectMode = selectedSet.size >= 2;

    // `playingId === undefined` means the panel didn't pass the prop — fall
    // back to `activeId` so scenes / markers (whose active row already tracks
    // the playhead) keep showing the play icon without ceremony.
    const effectivePlayingId = playingId === undefined ? (activeId ?? null) : playingId;

    const buildCtx = useCallback(
        (item: T): RowContext => {
            const isActive = activeId != null && activeId === item.id;
            const isPlaying = effectivePlayingId != null && effectivePlayingId === item.id;
            const isSelected = selectedSet.has(item.id);
            const liveFrame =
                item.thumbnailTime != null && fps > 0
                    ? Math.max(0, Math.floor(item.thumbnailTime * fps))
                    : null;
            const thumbFrame = dragActive
                ? (frozenFramesRef.current?.get(item.id) ?? liveFrame)
                : liveFrame;

            return {
                isActive,
                isPlaying,
                isSelected,
                viewMode,
                fileHash: video?.fileHash ?? null,
                thumbnailFrame: thumbFrame,
                onRowClick: (e) => handleRowClick(item.id, e),
                onRowMouseEnter: (e) => {
                    if (video && hoverReason != null && thumbFrame != null) {
                        dispatch(setHover({
                            fileHash: video.fileHash,
                            reason: hoverReason,
                            frame: thumbFrame,
                        }));
                    }
                    if (viewMode !== "none" || item.thumbnailTime == null) return;
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setPopupHover({ time: item.thumbnailTime, x: rect.right, y: rect.top });
                },
                onRowMouseLeave: () => {
                    if (video && hoverReason != null) {
                        dispatch(setHover({
                            fileHash: video.fileHash,
                            reason: hoverReason,
                            frame: null,
                        }));
                    }
                    if (viewMode === "none") setPopupHover(null);
                },
            };
        },
        [
            activeId,
            effectivePlayingId,
            selectedSet,
            viewMode,
            video,
            fps,
            handleRowClick,
            setPopupHover,
            hoverReason,
            dispatch,
            dragActive,
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
                    "--list-thumb-w": `${thumbnailSize}px`,
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
                    {viewMode !== "none" && (
                        <ListThumbnailSizeSlider
                            size={thumbnailSize}
                            onChange={(size) =>
                                dispatch(setListThumbnailSize({ list: listId, size }))
                            }
                        />
                    )}
                    <ListViewModeToggle
                        mode={viewMode}
                        onChange={(mode) => dispatch(setListViewMode({ list: listId, mode }))}
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
            <div className="list-panel__rows" data-view={viewMode}>
                {prefixRows}
                {items.map((item) => renderRow(item, buildCtx(item)))}
                {items.length === 0 && emptyHint && (
                    <div className="list-panel__empty">{emptyHint}</div>
                )}
            </div>
        </div>
    );
}
