import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { Anchor } from '../../types'
import type { SavedVideoState } from '../../types'

interface WarpState {
  origAnchors: Anchor[]
  beatAnchors: Anchor[]
  /** IDs of anchors whose beat position tracks their orig position (not manually adjusted) */
  linkedBeatIds: number[]
  bpm: number
  minStretch: number
  maxStretch: number
  beatZeroId: number | null
  /** Full-video markers snapshot (used when switching between regions and full-video mode) */
  globalMarkers: SavedVideoState['defaultRegion'] | null
  loopBeats: number | null
  trimToLoop: boolean
  addToEnd: boolean
  selectedIds: number[]
  playhead: number
}

const initialState: WarpState = {
  origAnchors: [],
  beatAnchors: [],
  linkedBeatIds: [],
  bpm: 120,
  minStretch: 0.5,
  maxStretch: 2.0,
  beatZeroId: null,
  globalMarkers: null,
  loopBeats: null,
  trimToLoop: false,
  addToEnd: false,
  selectedIds: [],
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
    // ── Anchor mutations ──────────────────────────────────────────────────
    setOrigAnchors(state, action: PayloadAction<Anchor[]>) {
      state.origAnchors = action.payload
    },
    setBeatAnchors(state, action: PayloadAction<Anchor[]>) {
      state.beatAnchors = action.payload
    },
    /** Add a new anchor at the given time. Creates a linked beat anchor at the same position. */
    addAnchor(state, action: PayloadAction<{ id: number; time: number }>) {
      const { id, time } = action.payload
      state.origAnchors.push({ id, time })
      state.beatAnchors.push({ id, time })
      state.linkedBeatIds.push(id)
    },
    /** Remove anchors by ID */
    removeAnchors(state, action: PayloadAction<number[]>) {
      const ids = new Set(action.payload)
      state.origAnchors = state.origAnchors.filter(a => !ids.has(a.id))
      state.beatAnchors = state.beatAnchors.filter(a => !ids.has(a.id))
      state.linkedBeatIds = state.linkedBeatIds.filter(id => !ids.has(id))
      state.selectedIds = state.selectedIds.filter(id => !ids.has(id))
      if (state.beatZeroId !== null && ids.has(state.beatZeroId)) {
        state.beatZeroId = null
      }
    },
    /** Move an orig anchor. If linked, moves the corresponding beat anchor too. */
    moveOrigAnchor(state, action: PayloadAction<{ id: number; time: number }>) {
      const { id, time } = action.payload
      const oa = state.origAnchors.find(a => a.id === id)
      if (oa) oa.time = time
      if (state.linkedBeatIds.includes(id)) {
        const ba = state.beatAnchors.find(a => a.id === id)
        if (ba) ba.time = time
      }
    },
    /** Update multiple orig anchors at once (used by Timeline drag) */
    setOrigAnchorsFromTimeline(state, action: PayloadAction<Anchor[]>) {
      const next = action.payload
      const prevIds = new Set(state.origAnchors.map(a => a.id))
      const nextIds = new Set(next.map(a => a.id))

      // Find added, removed, moved
      const added = next.filter(a => !prevIds.has(a.id))
      const removedIds = [...prevIds].filter(id => !nextIds.has(id))
      const moved = next.filter(a => {
        const prev = state.origAnchors.find(p => p.id === a.id)
        return prev && prev.time !== a.time
      })

      // Add new anchors as linked
      for (const a of added) {
        state.beatAnchors.push({ id: a.id, time: a.time })
        state.linkedBeatIds.push(a.id)
      }

      // Remove deleted anchors
      for (const id of removedIds) {
        state.beatAnchors = state.beatAnchors.filter(a => a.id !== id)
        state.linkedBeatIds = state.linkedBeatIds.filter(i => i !== id)
        if (state.beatZeroId === id) state.beatZeroId = null
      }

      // Move linked beat anchors to match
      for (const m of moved) {
        if (state.linkedBeatIds.includes(m.id)) {
          const ba = state.beatAnchors.find(a => a.id === m.id)
          if (ba) ba.time = m.time
        }
      }

      state.origAnchors = next
    },
    /** Move a beat anchor (unlinking it from orig) */
    moveBeatAnchor(state, action: PayloadAction<{ id: number; time: number }>) {
      const { id, time } = action.payload
      const ba = state.beatAnchors.find(a => a.id === id)
      if (ba) ba.time = time
      state.linkedBeatIds = state.linkedBeatIds.filter(i => i !== id)
    },
    /** Update all beat anchors from the beat timeline */
    setBeatAnchorsFromTimeline(state, action: PayloadAction<Anchor[]>) {
      for (const a of action.payload) {
        const prev = state.beatAnchors.find(b => b.id === a.id)
        if (prev && prev.time !== a.time) {
          state.linkedBeatIds = state.linkedBeatIds.filter(i => i !== a.id)
        }
      }
      state.beatAnchors = action.payload
    },
    /** Reset beat anchor(s) to their orig position (re-link) */
    resetBeatLinks(state, action: PayloadAction<number[]>) {
      for (const id of action.payload) {
        const orig = state.origAnchors.find(a => a.id === id)
        const beat = state.beatAnchors.find(a => a.id === id)
        if (orig && beat) {
          beat.time = orig.time
          if (!state.linkedBeatIds.includes(id)) state.linkedBeatIds.push(id)
        }
      }
    },
    clearAnchors(state) {
      state.origAnchors = []
      state.beatAnchors = []
      state.linkedBeatIds = []
      state.selectedIds = []
      state.beatZeroId = null
    },
    /** Bulk-set both anchor arrays + linked IDs (used for import, undo/redo) */
    loadAnchors(state, action: PayloadAction<{
      origAnchors: Anchor[]
      beatAnchors: Anchor[]
      linkedBeatIds?: number[]
      beatZeroId?: number | null
    }>) {
      state.origAnchors = action.payload.origAnchors
      state.beatAnchors = action.payload.beatAnchors
      state.linkedBeatIds = action.payload.linkedBeatIds ?? []
      if (action.payload.beatZeroId !== undefined) {
        state.beatZeroId = action.payload.beatZeroId
      }
      bumpAnchorIdCounter(action.payload.origAnchors)
      bumpAnchorIdCounter(action.payload.beatAnchors)
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
    setSelectedIds(state, action: PayloadAction<number[]>) {
      state.selectedIds = action.payload
    },
    selectAll(state) {
      state.selectedIds = state.origAnchors.map(a => a.id)
    },
    deselectAll(state) {
      state.selectedIds = []
    },

    // ── Playhead ──────────────────────────────────────────────────────────
    setPlayhead(state, action: PayloadAction<number>) {
      state.playhead = action.payload
    },
  },
})

export const {
  setOrigAnchors,
  setBeatAnchors,
  addAnchor,
  removeAnchors,
  moveOrigAnchor,
  setOrigAnchorsFromTimeline,
  moveBeatAnchor,
  setBeatAnchorsFromTimeline,
  resetBeatLinks,
  clearAnchors,
  loadAnchors,
  setBpm,
  setMinStretch,
  setMaxStretch,
  setBeatZeroId,
  setGlobalMarkers,
  setLoopBeats,
  setTrimToLoop,
  setAddToEnd,
  setSelectedIds,
  selectAll,
  deselectAll,
  setPlayhead,
} = warpSlice.actions

export default warpSlice.reducer
