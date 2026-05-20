import { createListenerMiddleware, isAnyOf } from "@reduxjs/toolkit";
import type { RootState } from "../store";
import { pushSnapshot, undo, redo, type HistoryEntry } from "../slices/historySlice";
import { dragEnd } from "../slices/dragSlice";
import {
    loadAnchors,
    loadWarpSettings,
    setOrigAnchors,
    setBeatAnchors,
    addAnchor,
    removeAnchors,
    resetBeatLinks,
    clearAnchors,
    setBeatZeroId,
    setBpm,
    setMinStretch,
    setMaxStretch,
} from "../slices/warpSlice";
import {
    setRegions,
    addRegion,
    deleteRegion,
    renameRegion,
    updateRegionBpm,
    updateRegionLockedBeats,
    updateRegionStretch,
} from "../slices/regionSlice";
import { setLockMode } from "../slices/uiSlice";
import { _syncAnchorPositions } from "../slices/warpSlice";
import { _syncRegionPositions, _syncRegionMeta } from "../slices/regionSlice";

/**
 * Undo/redo middleware. Listens for undo-worthy slice mutations, debounces
 * 400ms, then pushes a snapshot of the full undoable state. Also handles
 * `undo` / `redo` actions by restoring the snapshot at the current history
 * index, and snapshots immediately on `dragEnd` to capture each gesture as
 * a single history entry.
 */
export const historyMiddleware = createListenerMiddleware();

/**
 * Actions that trigger a debounced snapshot. Excluded on purpose:
 *  - `loadAnchors`, `loadWarpSettings`, `setRegions` — bulk-restore actions
 *    used BY undo/redo, must not snapshot recursively.
 *  - `dragEnd` — has its own immediate listener below so each gesture is one
 *    history entry rather than the trailing edge of a debounce window.
 *  - Selection, playhead, active-region-id, view, UI layout — not undoable.
 *
 * The pipeline writes slice diffs through `_syncAnchorPositions` /
 * `_syncRegionPositions` / `_syncRegionMeta`, so those are the triggers for
 * position-change snapshots.
 */
const snapshotTriggers = isAnyOf(
    // Warp anchors (slice ID-list / metadata mutations)
    setOrigAnchors,
    setBeatAnchors,
    addAnchor,
    removeAnchors,
    resetBeatLinks,
    clearAnchors,
    setBeatZeroId,
    // Warp settings
    setBpm,
    setMinStretch,
    setMaxStretch,
    // Regions (slice metadata mutations)
    addRegion,
    deleteRegion,
    updateRegionLockedBeats,
    renameRegion,
    updateRegionBpm,
    updateRegionStretch,
    // Global lock mode
    setLockMode,
    // Pipeline slice writes — position mutations.
    _syncAnchorPositions,
    _syncRegionPositions,
    _syncRegionMeta,
);

/** Build a `HistoryEntry` from the current root state — the set of fields
 *  that participate in undo/redo. */
export function snapshotFromState(state: RootState): HistoryEntry {
    return {
        origAnchors: state.warp.origAnchors,
        beatAnchors: state.warp.beatAnchors,
        beatZeroId: state.warp.beatZeroId,
        bpm: state.warp.bpm,
        minStretch: state.warp.minStretch,
        maxStretch: state.warp.maxStretch,
        regions: state.region.regions,
    };
}

// ── Snapshot on drag end: fires immediately, no debounce ────────────────────

historyMiddleware.startListening({
    actionCreator: dragEnd,
    effect: (_action, listenerApi) => {
        const state = listenerApi.getState() as RootState;
        listenerApi.dispatch(pushSnapshot(snapshotFromState(state)));
    },
});

// ── Snapshot recording: debounced 400ms after any undo-worthy mutation ─────

historyMiddleware.startListening({
    matcher: snapshotTriggers,
    effect: async (_action, listenerApi) => {
        listenerApi.cancelActiveListeners();
        await listenerApi.delay(400);
        const state = listenerApi.getState() as RootState;
        // Gate: skip if still dragging (rapid pointer-move commits should not flood history).
        if (state.drag.active) return;
        listenerApi.dispatch(pushSnapshot(snapshotFromState(state)));
    },
});

// ── Undo / Redo: restore the snapshot at the current history index ────────

function restoreEntry(entry: HistoryEntry, dispatch: (a: unknown) => void) {
    dispatch(
        loadAnchors({
            origAnchors: entry.origAnchors,
            beatAnchors: entry.beatAnchors,
            beatZeroId: entry.beatZeroId,
        }),
    );
    dispatch(
        loadWarpSettings({
            bpm: entry.bpm,
            minStretch: entry.minStretch,
            maxStretch: entry.maxStretch,
        }),
    );
    dispatch(setRegions(entry.regions));
    // The constraint graph is rebuilt from the slice on next read by the
    // pipeline — no separate graph restore needed.
}

historyMiddleware.startListening({
    actionCreator: undo,
    effect: (_action, listenerApi) => {
        const state = listenerApi.getState() as RootState;
        const entry = state.history.stack[state.history.index];
        if (!entry) return;
        restoreEntry(entry, listenerApi.dispatch);
    },
});

historyMiddleware.startListening({
    actionCreator: redo,
    effect: (_action, listenerApi) => {
        const state = listenerApi.getState() as RootState;
        const entry = state.history.stack[state.history.index];
        if (!entry) return;
        restoreEntry(entry, listenerApi.dispatch);
    },
});
