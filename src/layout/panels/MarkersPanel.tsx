import { useCallback, useMemo } from "react";
import ListPanel from "../../components/list/ListPanel";
import { useFilteredItems } from "../../components/list/useFilteredItems";
import MarkerRow, { type MarkerRowData } from "./MarkerRow";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
    removeAnchors,
    setSelectedOrigIds as setSelectedOrigAnchorIds,
    setSelectedBeatIds as setSelectedBeatAnchorIds,
    resetBeatLinks,
    setBeatAnchorsFromTimeline,
} from "../../store/slices/warpSlice";
import { selectActiveRegion, selectSelectedIdsUnion } from "../../store/selectors";
import { useDockBridge } from "../DockContext";
import { snapAllToBeat } from "../../utils/quantize";
import { useGesture } from "../../store/gesture";

export default function MarkersPanel() {
    const dispatch = useAppDispatch();
    const { seek } = useDockBridge();
    const video = useAppSelector((s) => s.video.video);
    const origAnchors = useAppSelector((s) => s.warp.origAnchors);
    const beatAnchors = useAppSelector((s) => s.warp.beatAnchors);
    const warpBpm = useAppSelector((s) => s.warp.bpm);
    const beatZeroId = useAppSelector((s) => s.warp.beatZeroId);
    const gridDiv = useAppSelector((s) => s.ui.gridDiv);
    const activeRegion = useAppSelector(selectActiveRegion);
    const filterMode = useAppSelector((s) => s.lists.filterMode.markers);
    // Markers selection: union of orig + beat selected anchor ids so both
    // spaces appear highlighted in the panel. Stringified for ListPanel's
    // id contract.
    const selectedAnchorIdSet = useAppSelector(selectSelectedIdsUnion);
    const selectedIdsAsStrings = useMemo(
        () => new Set(Array.from(selectedAnchorIdSet, (n) => String(n))),
        [selectedAnchorIdSet],
    );

    const lassoSelection = useGesture((s) => s.lassoSelection);
    const selectedIdsOverride = useMemo(() => {
        if (lassoSelection) {
            // Show both orig and beat lassoed anchors in the panel.
            const merged = new Set([
                ...lassoSelection.origAnchorIds,
                ...lassoSelection.beatAnchorIds,
            ]);
            return new Set(Array.from(merged, (n) => String(n)));
        }
        return selectedIdsAsStrings;
    }, [lassoSelection, selectedIdsAsStrings]);

    // Build all rows up-front; let useFilteredItems window them by mode.
    const allItems = useMemo<MarkerRowData[]>(() => {
        if (!video) return [];
        const beatZeroAnchor =
            beatZeroId !== null ? beatAnchors.find((a) => a.id === beatZeroId) : beatAnchors[0];
        const beatZeroTime = beatZeroAnchor?.time ?? 0;
        const beatDuration = warpBpm > 0 ? 60 / warpBpm : 0;
        const sorted = [...origAnchors].sort((a, b) => a.time - b.time);
        return sorted.map((anchor, i) => {
            const beatAnchor = beatAnchors.find((b) => b.id === anchor.id);
            const next = sorted[i + 1];
            const nextBeat = next ? beatAnchors.find((b) => b.id === next.id) : null;
            let stretch: number | null = null;
            if (next && beatAnchor && nextBeat) {
                const origSpan = next.time - anchor.time;
                const beatSpan = nextBeat.time - beatAnchor.time;
                if (origSpan > 0) stretch = beatSpan / origSpan;
            }
            return {
                id: String(anchor.id),
                anchorId: anchor.id,
                index: i + 1,
                time: anchor.time,
                thumbnailTime: anchor.time,
                fps: video.fps,
                beatNumber:
                    beatAnchor && beatDuration > 0
                        ? (beatAnchor.time - beatZeroTime) / beatDuration
                        : null,
                isBeatZero: !!beatAnchor && Math.abs(beatAnchor.time - beatZeroTime) < 0.001,
                stretch,
            };
        });
    }, [video, origAnchors, beatAnchors, warpBpm, beatZeroId]);

    const items = useFilteredItems({
        items: allItems,
        filterMode,
        // Markers are points; range collapses to start === end at the anchor's time.
        getRange: useCallback((m: MarkerRowData) => ({ start: m.time, end: m.time }), []),
    });

    const onActivate = useCallback(
        (id: string) => {
            const data = items.find((r) => r.id === id);
            if (data) seek(data.time);
        },
        [items, seek],
    );

    const hasSelection = selectedAnchorIdSet.size > 0;

    const onSnap = useCallback(() => {
        if (warpBpm <= 0) return;
        const beat = 60 / warpBpm / Math.max(1, gridDiv);
        const bzAnchor =
            beatZeroId !== null ? beatAnchors.find((a) => a.id === beatZeroId) : beatAnchors[0];
        const beatOffset = bzAnchor?.time ?? 0;
        const toSnap = beatAnchors.filter((a) => selectedAnchorIdSet.has(a.id));
        const snapped = snapAllToBeat(toSnap, beat, beatOffset);
        dispatch(
            setBeatAnchorsFromTimeline(
                beatAnchors.map((a) => {
                    const s = snapped.find((sa) => sa.id === a.id);
                    return s ? { ...a, time: s.time } : a;
                }),
            ),
        );
    }, [dispatch, warpBpm, gridDiv, beatAnchors, selectedAnchorIdSet, beatZeroId]);

    const onReset = useCallback(() => {
        dispatch(resetBeatLinks([...selectedAnchorIdSet]));
    }, [dispatch, selectedAnchorIdSet]);

    const onDelete = useCallback(
        (ids: string[]) => {
            dispatch(removeAnchors(ids.map((s) => Number(s))));
            dispatch(setSelectedOrigAnchorIds([]));
            dispatch(setSelectedBeatAnchorIds([]));
        },
        [dispatch],
    );

    const onSelectionChangeOverride = useCallback(
        (ids: string[]) => {
            // Panel selection corresponds to input (orig) space anchors.
            const numIds = ids.map((s) => Number(s));
            dispatch(setSelectedOrigAnchorIds(numIds));
            dispatch(setSelectedBeatAnchorIds([]));
        },
        [dispatch],
    );

    if (!video) return <div className="vj-empty-panel">No video</div>;

    const actionsBar = (
        <div className="markers-panel__actions">
            <button
                type="button"
                className="markers-panel__action-btn"
                onClick={onSnap}
                disabled={!hasSelection}
                title="Snap selected anchors to nearest beat"
            >
                Snap
            </button>
            <button
                type="button"
                className="markers-panel__action-btn markers-panel__action-btn--secondary"
                onClick={onReset}
                disabled={!hasSelection}
                title="Reset selected anchors to source position"
            >
                Reset
            </button>
        </div>
    );

    return (
        <ListPanel
            listId="markers"
            items={items}
            onActivate={onActivate}
            onDelete={onDelete}
            selectedIdsOverride={selectedIdsOverride}
            onSelectionChangeOverride={onSelectionChangeOverride}
            subHeader={actionsBar}
            clipFilterDisabled={!activeRegion}
            emptyHint={
                filterMode === "clip" && !activeRegion
                    ? "Select a clip to scope anchors"
                    : filterMode === "clip"
                      ? "No anchors in the active clip"
                      : filterMode === "viewport"
                        ? "No anchors in view"
                        : "No anchors placed"
            }
            renderRow={(item, ctx) => (
                <MarkerRow
                    key={item.id}
                    data={item}
                    ctx={ctx}
                    dim={
                        !activeRegion ||
                        item.time < activeRegion.inPoint ||
                        item.time > activeRegion.outPoint
                    }
                    onDelete={() => dispatch(removeAnchors([item.anchorId]))}
                    onDoubleClick={() => seek(item.time)}
                />
            )}
        />
    );
}
