import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Anchor } from "../../types";
import type { SavedVideoState } from "../../types";

/**
 * Warp slice — holds the orig and beat anchor arrays plus warp settings
 * (bpm, stretch bounds, beat-zero, selection, playhead).
 *
 * The slice is the source of truth for anchor positions. The constraint
 * graph used by the pipeline is derived from this slice on demand by
 * `buildGraphFromSlice`; pipeline writes flow back to the slice through
 * the internal `_syncAnchorPositions` reducer.
 *
 * Position-mutating call sites should NEVER write `time` fields directly —
 * they route through the entity-write thunks (see `entityWriteThunks.ts`)
 * which dispatch ops to the pipeline and let the resolver sync the slice.
 * The non-position reducers below (selection, link flag, ID-list adds/
 * removes, settings) are safe to dispatch directly.
 */
interface WarpState {
    origAnchors: Anchor[];
    beatAnchors: Anchor[];
    bpm: number;
    minStretch: number;
    maxStretch: number;
    beatZeroId: number | null;
    /** Full-video markers snapshot (used when switching between regions and full-video mode) */
    globalMarkers: SavedVideoState["defaultRegion"] | null;
    /** Selected anchor IDs in input (orig) space. An anchor is "fully selected"
     *  only when its id appears in BOTH selectedOrigIds and selectedBeatIds. */
    selectedOrigIds: number[];
    /** Selected anchor IDs in beat (output) space. */
    selectedBeatIds: number[];
    playhead: number;
}

const initialState: WarpState = {
    origAnchors: [],
    beatAnchors: [],
    bpm: 120,
    minStretch: 0.5,
    maxStretch: 2.0,
    beatZeroId: null,
    globalMarkers: null,
    selectedOrigIds: [],
    selectedBeatIds: [],
    playhead: 0,
};

let nextAnchorId = 1;
export function newAnchorId() {
    return nextAnchorId++;
}
export function bumpAnchorIdCounter(anchors: { id: number }[]) {
    for (const a of anchors) {
        if (a.id >= nextAnchorId) nextAnchorId = a.id + 1;
    }
}

const warpSlice = createSlice({
    name: "warp",
    initialState,
    reducers: {
        // ── Anchor ID-list / bootstrap mutations ──────────────────────────────
        // The reducers below accept `Anchor` payloads (with `time`) so test
        // fixtures and load paths can seed positions in the same call. Direct
        // position changes outside of bootstrap/load should go through the
        // entity-write thunks so the constraint pipeline runs.

        setOrigAnchors(state, action: PayloadAction<Anchor[]>) {
            state.origAnchors = action.payload;
        },
        setBeatAnchors(state, action: PayloadAction<Anchor[]>) {
            state.beatAnchors = action.payload;
        },
        /** Add a new anchor ID with `time` seeded for both orig and beat sides.
         *  Beat side defaults to linked (absence of the `linked` flag). */
        addAnchor(state, action: PayloadAction<{ id: number; time: number }>) {
            const { id, time } = action.payload;
            state.origAnchors.push({ id, time });
            state.beatAnchors.push({ id, time });
        },
        /** Remove anchor pair(s) by ID. */
        removeAnchors(state, action: PayloadAction<number[]>) {
            const ids = new Set(action.payload);
            state.origAnchors = state.origAnchors.filter((a) => !ids.has(a.id));
            state.beatAnchors = state.beatAnchors.filter((a) => !ids.has(a.id));
            state.selectedOrigIds = state.selectedOrigIds.filter((id) => !ids.has(id));
            state.selectedBeatIds = state.selectedBeatIds.filter((id) => !ids.has(id));
            if (state.beatZeroId !== null && ids.has(state.beatZeroId)) {
                state.beatZeroId = null;
            }
        },
        /** Reset beat anchor(s) to "linked" (matching orig). Snaps the beat
         *  `time` back onto orig and clears the diverged-marker flag. The
         *  matching pair constraint is re-installed by `applyResetBeatLinks`. */
        resetBeatLinks(state, action: PayloadAction<number[]>) {
            for (const id of action.payload) {
                const orig = state.origAnchors.find((a) => a.id === id);
                const beat = state.beatAnchors.find((a) => a.id === id);
                if (orig && beat) {
                    beat.time = orig.time;
                    // Re-link: clear the diverged marker so linked !== false.
                    delete beat.linked;
                }
            }
        },
        clearAnchors(state) {
            state.origAnchors = [];
            state.beatAnchors = [];
            state.selectedOrigIds = [];
            state.selectedBeatIds = [];
            state.beatZeroId = null;
        },
        /** Bulk-set both anchor arrays (used for import, undo/redo). Positions
         *  are written directly so the slice reflects the saved snapshot; the
         *  pipeline rebuilds its derived graph from the slice on the next read.
         *
         *  The `linked` boolean on each beat anchor is the persistence flag
         *  used when `buildGraphFromSlice` installs `initAnchorPair`
         *  constraints (true/absent = linked, false = diverged). */
        loadAnchors(
            state,
            action: PayloadAction<{
                origAnchors: Anchor[];
                beatAnchors: Anchor[];
                beatZeroId?: number | null;
            }>,
        ) {
            state.origAnchors = action.payload.origAnchors;
            state.beatAnchors = action.payload.beatAnchors;
            if (action.payload.beatZeroId !== undefined) {
                state.beatZeroId = action.payload.beatZeroId;
            }
            bumpAnchorIdCounter(action.payload.origAnchors);
            bumpAnchorIdCounter(action.payload.beatAnchors);
        },
        /**
         * Bulk-apply warp settings during undo/redo without triggering the history
         * matcher. The granular setters (setBpm, setMinStretch, …) are all in the
         * matcher so user-initiated edits snapshot; this action is excluded so it
         * can replay them during restore without recording a fresh snapshot.
         */
        loadWarpSettings(
            state,
            action: PayloadAction<{
                bpm: number;
                minStretch: number;
                maxStretch: number;
            }>,
        ) {
            state.bpm = action.payload.bpm;
            state.minStretch = action.payload.minStretch;
            state.maxStretch = action.payload.maxStretch;
        },

        // ── Settings ──────────────────────────────────────────────────────────
        setBpm(state, action: PayloadAction<number>) {
            state.bpm = action.payload;
        },
        setMinStretch(state, action: PayloadAction<number>) {
            state.minStretch = action.payload;
        },
        setMaxStretch(state, action: PayloadAction<number>) {
            state.maxStretch = action.payload;
        },
        setBeatZeroId(state, action: PayloadAction<number | null>) {
            state.beatZeroId = action.payload;
        },
        setGlobalMarkers(state, action: PayloadAction<SavedVideoState["defaultRegion"] | null>) {
            state.globalMarkers = action.payload;
        },
        // ── Selection ─────────────────────────────────────────────────────────
        /** Set selected IDs in input (orig) space only. */
        setSelectedOrigIds(state, action: PayloadAction<number[]>) {
            state.selectedOrigIds = action.payload;
        },
        /** Set selected IDs in beat (output) space only. */
        setSelectedBeatIds(state, action: PayloadAction<number[]>) {
            state.selectedBeatIds = action.payload;
        },
        /** Set selected IDs in both spaces simultaneously (e.g. warp-line click). */
        setSelectedBothIds(state, action: PayloadAction<number[]>) {
            state.selectedOrigIds = action.payload;
            state.selectedBeatIds = action.payload;
        },
        selectAll(state) {
            const ids = state.origAnchors.map((a) => a.id);
            state.selectedOrigIds = ids;
            state.selectedBeatIds = ids;
        },
        deselectAll(state) {
            state.selectedOrigIds = [];
            state.selectedBeatIds = [];
        },

        // ── Playhead ──────────────────────────────────────────────────────────
        setPlayhead(state, action: PayloadAction<number>) {
            state.playhead = action.payload;
        },

        // ── Internal: pipeline → slice projection ────────────────────────────────
        /** Internal — write the slice's `time` fields from a pipeline diff.
         *  Dispatched by `dispatchPipelined` / `dispatchPipelinedReplay` after
         *  every pipelined op. Consumers should NEVER dispatch this directly. */
        _syncAnchorPositions(
            state,
            action: PayloadAction<{ orig: Record<number, number>; beat: Record<number, number> }>,
        ) {
            for (const a of state.origAnchors) {
                const t = action.payload.orig[a.id];
                if (t !== undefined) a.time = t;
            }
            for (const a of state.beatAnchors) {
                const t = action.payload.beat[a.id];
                if (t !== undefined) a.time = t;
            }
        },
        /** Set the linked flag for a beat anchor. true = linked (beat tracks orig),
         *  false = diverged (beat is independently positioned). Absence of the
         *  flag means linked. Dispatched by thunks when an anchor is explicitly
         *  unlinked (diverged) or re-linked (reset). */
        setAnchorLinked(state, action: PayloadAction<{ id: number; linked: boolean }>) {
            const a = state.beatAnchors.find((a) => a.id === action.payload.id);
            if (a) {
                if (action.payload.linked) {
                    delete a.linked;
                } else {
                    a.linked = false;
                }
            }
        },
    },
});

export const {
    setOrigAnchors,
    setBeatAnchors,
    addAnchor,
    removeAnchors,
    resetBeatLinks,
    clearAnchors,
    loadAnchors,
    loadWarpSettings,
    setBpm,
    setMinStretch,
    setMaxStretch,
    setBeatZeroId,
    setGlobalMarkers,
    setSelectedOrigIds,
    setSelectedBeatIds,
    setSelectedBothIds,
    selectAll,
    deselectAll,
    setPlayhead,
    _syncAnchorPositions,
    setAnchorLinked,
} = warpSlice.actions;

// ── Position-writing thunks re-exported under their slice-action names ────
// Position writes live in entity-write thunks so the constraint pipeline
// runs and propagates linked/conform behaviour. The aliases here let call
// sites dispatch them as if they were plain slice actions.
export {
    applyMoveOrigAnchor as moveOrigAnchor,
    applyMoveBeatAnchor as moveBeatAnchor,
    applyOrigAnchorsFromTimeline as setOrigAnchorsFromTimeline,
    applyBeatAnchorsFromTimeline as setBeatAnchorsFromTimeline,
} from "../thunks/entityWriteThunks";

export default warpSlice.reducer;
