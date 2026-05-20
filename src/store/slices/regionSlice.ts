import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Region } from "../../types";

/**
 * Phase 1 — region positions (inPoint / outPoint / inBeatTime / outBeatTime)
 * live in the constraint graph (`state.constraint.graph.entities[{id}-in / {id}-out]`).
 * The region slice keeps the metadata and ID list. Position fields on
 * `state.region.regions[i]` are retained for load-bootstrap purposes (the
 * loader writes the saved positions onto the slice, then seeds the graph via
 * `setGraph(buildSeedGraph(…))`). After bootstrap the slice no longer MUTATES
 * positions — every position write routes through `constraintSlice.applyOp`
 * (see `entityWriteThunks`). Selectors prefer graph entities over slice
 * positions on read.
 */
interface RegionState {
    regions: Region[];
    activeRegionId: string | null;
}

const initialState: RegionState = {
    regions: [],
    activeRegionId: null,
};

/**
 * Payload type for `_syncRegionPositions`. A partial field bag per region ID —
 * only keys that are present in the bag are written to the slice. Use a named
 * alias so nested-generic `>>` doesn't trip the oxc parser used by vite/vitest.
 */
type RegionPosDiff = Record<
    string,
    Partial<{
        inPoint: number;
        outPoint: number;
        inBeatTime: number;
        outBeatTime: number;
        defaultLinked: boolean;
    }>
>;

/** Payload type for `_syncRegionMeta`. A partial meta bag per region ID —
 *  only keys that are present in the bag are written. */
type RegionMetaDiff = Record<
    string,
    Partial<{
        bpm: number;
        lockedBeats: number;
    }>
>;

/** Next colorIndex above any existing one — monotonic so deleting a region
 *  doesn't free up a slot another region could collide with on next add.
 *  Wraps to 0 only when the entire i64 space is exhausted (i.e. never). */
function nextColorIndex(regions: Region[]): number {
    let max = -1;
    for (const r of regions) {
        if (typeof r.colorIndex === "number" && r.colorIndex > max) max = r.colorIndex;
    }
    return max + 1;
}

const regionSlice = createSlice({
    name: "region",
    initialState,
    reducers: {
        setRegions(state, action: PayloadAction<Region[]>) {
            // Backfill colorIndex for any region loaded from a save predating
            // the field. Using array position keeps existing palette assignments
            // stable for a single load; persistence will write them back.
            // Also backfill defaultLinked / inBeatTime / outBeatTime for saves
            // predating this migration (pre-release: inBeatTime/outBeatTime may be
            // absent or undefined in old JSON).
            const seen = new Set<number>();
            for (const r of action.payload) {
                if (typeof r.colorIndex === "number") seen.add(r.colorIndex);
            }
            let next = 0;
            const filled = action.payload.map((r) => {
                let colorIndex = r.colorIndex;
                if (typeof colorIndex !== "number") {
                    while (seen.has(next)) next++;
                    colorIndex = next;
                    seen.add(next++);
                }
                // Cast to `unknown` first so we can safely coerce missing fields from
                // JSON that predates this migration (pre-release; no shim needed).
                const raw = r as unknown as {
                    defaultLinked?: boolean;
                    inBeatTime?: number;
                    outBeatTime?: number;
                };
                const out: Region = {
                    ...r,
                    colorIndex,
                    defaultLinked: raw.defaultLinked ?? true,
                    inBeatTime: raw.inBeatTime ?? r.inPoint,
                    outBeatTime: raw.outBeatTime ?? r.outPoint,
                };
                return out;
            });
            state.regions = filled;
        },
        addRegion(state, action: PayloadAction<Region>) {
            const r = action.payload;
            const colorIndex =
                typeof r.colorIndex === "number" ? r.colorIndex : nextColorIndex(state.regions);
            const withColor: Region = { ...r, colorIndex };
            state.regions.push(withColor);
            state.activeRegionId = withColor.id;
        },
        deleteRegion(state, action: PayloadAction<string>) {
            state.regions = state.regions.filter((r) => r.id !== action.payload);
            if (state.activeRegionId === action.payload) {
                state.activeRegionId = null;
            }
        },
        setActiveRegionId(state, action: PayloadAction<string | null>) {
            state.activeRegionId = action.payload;
        },
        renameRegion(state, action: PayloadAction<{ id: string; name: string }>) {
            const r = state.regions.find((r) => r.id === action.payload.id);
            if (r) r.name = action.payload.name;
        },
        updateRegionBpm(state, action: PayloadAction<{ id: string; bpm: number }>) {
            const r = state.regions.find((r) => r.id === action.payload.id);
            if (r) r.bpm = action.payload.bpm;
        },
        /** Update lockedBeats only. Used by linking-event / conformed-clipout
         *  commits — the graph holds the beat-space positions; this carries the
         *  derived beat count for lock='beats' regions. */
        updateRegionLockedBeats(state, action: PayloadAction<{ id: string; lockedBeats: number }>) {
            const r = state.regions.find((r) => r.id === action.payload.id);
            if (r) r.lockedBeats = action.payload.lockedBeats;
        },
        updateRegionStretch(
            state,
            action: PayloadAction<{ id: string; minStretch?: number; maxStretch?: number }>,
        ) {
            const r = state.regions.find((r) => r.id === action.payload.id);
            if (r) {
                if (action.payload.minStretch !== undefined)
                    r.minStretch = action.payload.minStretch;
                if (action.payload.maxStretch !== undefined)
                    r.maxStretch = action.payload.maxStretch;
            }
        },
        // ── Internal: graph → slice projection ─────────────────────────────────
        /** Internal — sync position fields from a graph snapshot.
         *  Dispatched by graphMirrorMiddleware after every `applyOp` / `setGraph`.
         *  Consumers should NEVER dispatch this directly. Position ownership lives
         *  in the constraint graph; the slice is a downstream view.
         *
         *  Each entry in the payload map is a `Partial` field bag — only the keys
         *  that are PRESENT in the bag are written. */
        _syncRegionPositions(state, action: PayloadAction<RegionPosDiff>) {
            for (const r of state.regions) {
                const fields = action.payload[r.id];
                if (!fields) continue;
                if ("inPoint" in fields && fields.inPoint !== undefined) r.inPoint = fields.inPoint;
                if ("outPoint" in fields && fields.outPoint !== undefined)
                    r.outPoint = fields.outPoint;
                if ("inBeatTime" in fields && fields.inBeatTime !== undefined)
                    r.inBeatTime = fields.inBeatTime;
                if ("outBeatTime" in fields && fields.outBeatTime !== undefined)
                    r.outBeatTime = fields.outBeatTime;
                if ("defaultLinked" in fields && fields.defaultLinked !== undefined)
                    r.defaultLinked = fields.defaultLinked;
            }
        },

        // ── Internal: graph meta → slice projection ────────────────────────────
        /** Internal — sync bpm / lockedBeats from the constraint graph's per-entity
         *  meta back onto the region slice. Dispatched by graphMirrorMiddleware after
         *  every `applyOp` / `setGraph` when the bpmDerivedConstraint updates meta.
         *  Consumers should NEVER dispatch this directly. */
        _syncRegionMeta(state, action: PayloadAction<RegionMetaDiff>) {
            for (const r of state.regions) {
                const fields = action.payload[r.id];
                if (!fields) continue;
                if ("bpm" in fields && fields.bpm !== undefined) r.bpm = fields.bpm;
                if ("lockedBeats" in fields && fields.lockedBeats !== undefined)
                    r.lockedBeats = fields.lockedBeats;
            }
        },
    },
});

export const {
    setRegions,
    addRegion,
    deleteRegion,
    setActiveRegionId,
    updateRegionLockedBeats,
    renameRegion,
    updateRegionBpm,
    updateRegionStretch,
    _syncRegionPositions,
    _syncRegionMeta,
} = regionSlice.actions;

// ── Back-compat re-exports for the position-writing thunks ───────────────
// These used to be slice reducers; Phase 1 moved them into entity-write
// thunks so the constraint graph is the source of truth for position writes.
// Re-exported under their original names so existing call sites only need
// to swap `dispatch(updateRegionInOut(...))` for `dispatch(updateRegionInOut(...))`
// with no other change — the dispatch target is now a thunk, but call shape
// is identical.
export {
    applyUpdateRegionInOut as updateRegionInOut,
    applyUpdateRegionBeatTimes as updateRegionBeatTimes,
    applyResetRegionBoundary as resetRegionBoundary,
    applyLinkingEvent,
    applyConformedClipout,
    applyBpmEdit,
    applyBeatsEdit,
} from "../thunks/entityWriteThunks";

export default regionSlice.reducer;
