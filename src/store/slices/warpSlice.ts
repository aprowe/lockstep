import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { Anchor } from '../../types'
import type { SavedVideoState } from '../../types'

/**
 * Phase 1 — anchor positions live in the constraint graph
 * (`state.constraint.graph.entities[a{id}-in / a{id}-out]`). The warp slice
 * keeps the ID lists + non-position metadata. The `Anchor[]` arrays here are
 * retained for load-bootstrap purposes (the slice receives saved positions on
 * `loadAnchors`, then the loader seeds the graph via `setGraph(buildSeedGraph(…))`).
 *
 * After bootstrap the slice no longer MUTATES positions — every position write
 * routes through `constraintSlice.applyOp` (see entityWriteThunks). The
 * remaining anchor reducers below operate on the ID lists / linkage / selection
 * only.
 *
 * Selectors prefer graph entities over slice positions on read, so the slice
 * `time` fields are dead data after bootstrap and act only as a fallback for
 * test fixtures or partially-seeded states.
 */
interface WarpState {
  origAnchors: Anchor[]
  beatAnchors: Anchor[]
  bpm: number
  minStretch: number
  maxStretch: number
  beatZeroId: number | null
  /** Full-video markers snapshot (used when switching between regions and full-video mode) */
  globalMarkers: SavedVideoState['defaultRegion'] | null
  loopBeats: number | null
  trimToLoop: boolean
  addToEnd: boolean
  /** Selected anchor IDs in input (orig) space. An anchor is "fully selected"
   *  only when its id appears in BOTH selectedOrigIds and selectedBeatIds. */
  selectedOrigIds: number[]
  /** Selected anchor IDs in beat (output) space. */
  selectedBeatIds: number[]
  playhead: number
}

const initialState: WarpState = {
  origAnchors: [],
  beatAnchors: [],
  bpm: 120,
  minStretch: 0.5,
  maxStretch: 2.0,
  beatZeroId: null,
  globalMarkers: null,
  loopBeats: null,
  trimToLoop: false,
  addToEnd: false,
  selectedOrigIds: [],
  selectedBeatIds: [],
  playhead: 0,
}

let nextAnchorId = 1
export function newAnchorId() { return nextAnchorId++ }
export function bumpAnchorIdCounter(anchors: { id: number }[]) {
  for (const a of anchors) {
    if (a.id >= nextAnchorId) nextAnchorId = a.id + 1
  }
}

const warpSlice = createSlice({
  name: 'warp',
  initialState,
  reducers: {
    // ── Anchor ID-list / bootstrap mutations ──────────────────────────────
    // The reducers below accept legacy `Anchor` payloads (with `time`) so test
    // fixtures and load paths can seed positions in the same call. They do NOT
    // make position changes coherent across the system — every real position
    // write must go through `constraintSlice.applyOp` to update the graph.

    setOrigAnchors(state, action: PayloadAction<Anchor[]>) {
      state.origAnchors = action.payload
    },
    setBeatAnchors(state, action: PayloadAction<Anchor[]>) {
      state.beatAnchors = action.payload
    },
    /** Add a new anchor ID. Beat side is auto-linked (pair marker DeleteGroup
     *  installed by graphMirrorMiddleware). The position arrives via the
     *  matching `applyOp(AddAnchor)` dispatched by the entity-write thunk;
     *  this reducer only manages the slice ID list. */
    addAnchor(state, action: PayloadAction<{ id: number; time: number }>) {
      const { id, time } = action.payload
      state.origAnchors.push({ id, time })
      state.beatAnchors.push({ id, time })
    },
    /** Remove anchor pair(s) by ID. */
    removeAnchors(state, action: PayloadAction<number[]>) {
      const ids = new Set(action.payload)
      state.origAnchors = state.origAnchors.filter(a => !ids.has(a.id))
      state.beatAnchors = state.beatAnchors.filter(a => !ids.has(a.id))
      state.selectedOrigIds = state.selectedOrigIds.filter(id => !ids.has(id))
      state.selectedBeatIds = state.selectedBeatIds.filter(id => !ids.has(id))
      if (state.beatZeroId !== null && ids.has(state.beatZeroId)) {
        state.beatZeroId = null
      }
    },
    /** Reset beat anchor(s) to "linked" (matching orig). The slice's beat
     *  `time` is updated to mirror orig so test fixtures stay coherent;
     *  the live position is updated in the graph and the pair marker
     *  (DeleteGroup) is re-installed by `applyResetBeatLinks`. */
    resetBeatLinks(state, action: PayloadAction<number[]>) {
      for (const id of action.payload) {
        const orig = state.origAnchors.find(a => a.id === id)
        const beat = state.beatAnchors.find(a => a.id === id)
        if (orig && beat) {
          beat.time = orig.time
          // Re-link: clear the diverged marker so linked !== false.
          delete beat.linked
        }
      }
    },
    clearAnchors(state) {
      state.origAnchors = []
      state.beatAnchors = []
      state.selectedOrigIds = []
      state.selectedBeatIds = []
      state.beatZeroId = null
    },
    /** Bulk-set both anchor arrays (used for import, undo/redo).
     *  Positions are accepted here so load paths can hand the slice the
     *  saved values verbatim; the graph is re-seeded separately by the loader
     *  via `setGraph(buildSeedGraph(…))`.
     *
     *  The `linked` boolean on each Anchor in `beatAnchors` is the persistence
     *  flag used by graphMirrorMiddleware to decide which pairs get
     *  `initAnchorPair` constraints installed (true/absent = linked, false = diverged). */
    loadAnchors(state, action: PayloadAction<{
      origAnchors: Anchor[]
      beatAnchors: Anchor[]
      beatZeroId?: number | null
    }>) {
      state.origAnchors = action.payload.origAnchors
      state.beatAnchors = action.payload.beatAnchors
      if (action.payload.beatZeroId !== undefined) {
        state.beatZeroId = action.payload.beatZeroId
      }
      bumpAnchorIdCounter(action.payload.origAnchors)
      bumpAnchorIdCounter(action.payload.beatAnchors)
    },
    /**
     * Bulk-apply warp settings during undo/redo without triggering the history
     * matcher. The granular setters (setBpm, setMinStretch, …) are all in the
     * matcher so user-initiated edits snapshot; this action is excluded so it
     * can replay them during restore without recording a fresh snapshot.
     */
    loadWarpSettings(state, action: PayloadAction<{
      bpm: number
      minStretch: number
      maxStretch: number
      loopBeats: number | null
      trimToLoop: boolean
      addToEnd: boolean
    }>) {
      state.bpm = action.payload.bpm
      state.minStretch = action.payload.minStretch
      state.maxStretch = action.payload.maxStretch
      state.loopBeats = action.payload.loopBeats
      state.trimToLoop = action.payload.trimToLoop
      state.addToEnd = action.payload.addToEnd
    },

    // ── Settings ──────────────────────────────────────────────────────────
    setBpm(state, action: PayloadAction<number>) {
      state.bpm = action.payload
    },
    setMinStretch(state, action: PayloadAction<number>) {
      state.minStretch = action.payload
    },
    setMaxStretch(state, action: PayloadAction<number>) {
      state.maxStretch = action.payload
    },
    setBeatZeroId(state, action: PayloadAction<number | null>) {
      state.beatZeroId = action.payload
    },
    setGlobalMarkers(state, action: PayloadAction<SavedVideoState['defaultRegion'] | null>) {
      state.globalMarkers = action.payload
    },
    setLoopBeats(state, action: PayloadAction<number | null>) {
      state.loopBeats = action.payload
    },
    setTrimToLoop(state, action: PayloadAction<boolean>) {
      state.trimToLoop = action.payload
    },
    setAddToEnd(state, action: PayloadAction<boolean>) {
      state.addToEnd = action.payload
    },

    // ── Selection ─────────────────────────────────────────────────────────
    /** Set selected IDs in input (orig) space only. */
    setSelectedOrigIds(state, action: PayloadAction<number[]>) {
      state.selectedOrigIds = action.payload
    },
    /** Set selected IDs in beat (output) space only. */
    setSelectedBeatIds(state, action: PayloadAction<number[]>) {
      state.selectedBeatIds = action.payload
    },
    /** Set selected IDs in both spaces simultaneously (e.g. warp-line click). */
    setSelectedBothIds(state, action: PayloadAction<number[]>) {
      state.selectedOrigIds = action.payload
      state.selectedBeatIds = action.payload
    },
    selectAll(state) {
      const ids = state.origAnchors.map(a => a.id)
      state.selectedOrigIds = ids
      state.selectedBeatIds = ids
    },
    deselectAll(state) {
      state.selectedOrigIds = []
      state.selectedBeatIds = []
    },

    // ── Playhead ──────────────────────────────────────────────────────────
    setPlayhead(state, action: PayloadAction<number>) {
      state.playhead = action.payload
    },

    // ── Internal: pipeline → slice projection ────────────────────────────────
    /** Internal — sync the slice's `time` fields from a pipeline diff.
     *  Dispatched by dispatchPipelined after every pipelined op.
     *  Consumers should NEVER dispatch this directly. */
    _syncAnchorPositions(state, action: PayloadAction<{ orig: Record<number, number>; beat: Record<number, number> }>) {
      for (const a of state.origAnchors) {
        const t = action.payload.orig[a.id]
        if (t !== undefined) a.time = t
      }
      for (const a of state.beatAnchors) {
        const t = action.payload.beat[a.id]
        if (t !== undefined) a.time = t
      }
    },
    /** Set the linked flag for a beat anchor. true = linked (beat tracks orig),
     *  false = diverged (beat is independently positioned). The absence of the
     *  flag is treated as true. Dispatched by thunks when an anchor is
     *  explicitly unlinked (diverged) or re-linked (reset). */
    setAnchorLinked(state, action: PayloadAction<{ id: number; linked: boolean }>) {
      const a = state.beatAnchors.find(a => a.id === action.payload.id)
      if (a) {
        if (action.payload.linked) {
          delete a.linked
        } else {
          a.linked = false
        }
      }
    },
  },
})

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
  setLoopBeats,
  setTrimToLoop,
  setAddToEnd,
  setSelectedOrigIds,
  setSelectedBeatIds,
  setSelectedBothIds,
  selectAll,
  deselectAll,
  setPlayhead,
  _syncAnchorPositions,
  setAnchorLinked,
} = warpSlice.actions

// ── Back-compat re-exports for the position-writing thunks ───────────────
// These used to be slice reducers; Phase 1 moved them into entity-write
// thunks so the constraint graph is the source of truth for position writes.
export {
  applyMoveOrigAnchor             as moveOrigAnchor,
  applyMoveBeatAnchor             as moveBeatAnchor,
  applyOrigAnchorsFromTimeline    as setOrigAnchorsFromTimeline,
  applyBeatAnchorsFromTimeline    as setBeatAnchorsFromTimeline,
} from '../thunks/entityWriteThunks'

export default warpSlice.reducer
