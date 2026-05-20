import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Region } from "../../types";

/**
 * Region slice — region metadata (id, name, bpm, lockedBeats, stretch
 * bounds, defaultLinked) plus the input-space bounds (inPoint/outPoint)
 * and beat-space bounds (inBeatTime/outBeatTime).
 *
 * The slice is the source of truth for region positions. The constraint
 * pipeline derives its graph from this slice on demand; pipeline writes
 * flow back via the internal `_syncRegionPositions` / `_syncRegionMeta`
 * reducers. Direct mutation of position fields outside of the load path
 * is reserved for the entity-write thunks (see `entityWriteThunks.ts`).
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
        /** Replace the region list. Backfills `colorIndex`, `defaultLinked`,
         *  `inBeatTime`, and `outBeatTime` for any payload entry missing them
         *  so loaded snapshots are normalized at the slice boundary. */
        setRegions(state, action: PayloadAction<Region[]>) {
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
                // Coerce optional fields off of `unknown` so the backfill below
                // applies cleanly even when the payload omits them.
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
         *  commits to carry the derived beat count for lock='beats' regions. */
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
        // ── Internal: pipeline → slice projection ──────────────────────────────
        /** Internal — write region position fields from a pipeline diff.
         *  Dispatched by `dispatchPipelined` / `dispatchPipelinedReplay` after
         *  each op runs. Consumers should NEVER dispatch this directly.
         *
         *  Each entry in the payload map is a `Partial` field bag — only the
         *  keys present in the bag are written. */
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

        // ── Internal: pipeline meta → slice projection ─────────────────────────
        /** Internal — write bpm / lockedBeats from the pipeline's per-entity
         *  meta back onto the region slice. Dispatched by the pipeline dispatch
         *  helpers when the bpmDerivedConstraint updates meta during the Derive
         *  phase. Consumers should NEVER dispatch this directly. */
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

// ── Position-writing thunks re-exported under their slice-action names ────
// Position writes live in entity-write thunks so the constraint pipeline
// runs and propagates linked/conform behaviour. The aliases here let call
// sites dispatch them as if they were plain slice actions.
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
