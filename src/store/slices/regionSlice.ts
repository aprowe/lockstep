import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { Region } from '../../types'
import { clampRegionInOut } from '../../timeline/model/clampRegion'
import { conformedRegionUpdate } from '../../timeline/model/conformedRegionUpdate'
import { commitLinkingEvent } from '../../timeline/model/linkingEvent'
import { effectiveBeatBounds } from '../../timeline/model/effectiveBounds'

interface RegionState {
  regions: Region[]
  activeRegionId: string | null
}

const initialState: RegionState = {
  regions: [],
  activeRegionId: null,
}

/** Next colorIndex above any existing one — monotonic so deleting a region
 *  doesn't free up a slot another region could collide with on next add.
 *  Wraps to 0 only when the entire i64 space is exhausted (i.e. never). */
function nextColorIndex(regions: Region[]): number {
  let max = -1
  for (const r of regions) {
    if (typeof r.colorIndex === 'number' && r.colorIndex > max) max = r.colorIndex
  }
  return max + 1
}

const regionSlice = createSlice({
  name: 'region',
  initialState,
  reducers: {
    setRegions(state, action: PayloadAction<Region[]>) {
      // Backfill colorIndex for any region loaded from a save predating
      // the field. Using array position keeps existing palette assignments
      // stable for a single load; persistence will write them back.
      const seen = new Set<number>()
      for (const r of action.payload) {
        if (typeof r.colorIndex === 'number') seen.add(r.colorIndex)
      }
      let next = 0
      const filled = action.payload.map(r => {
        if (typeof r.colorIndex === 'number') return r
        while (seen.has(next)) next++
        seen.add(next)
        return { ...r, colorIndex: next++ }
      })
      state.regions = filled
    },
    addRegion(state, action: PayloadAction<Region>) {
      const r = action.payload
      const withColor = typeof r.colorIndex === 'number'
        ? r
        : { ...r, colorIndex: nextColorIndex(state.regions) }
      state.regions.push(withColor)
      state.activeRegionId = withColor.id
    },
    deleteRegion(state, action: PayloadAction<string>) {
      state.regions = state.regions.filter(r => r.id !== action.payload)
      if (state.activeRegionId === action.payload) {
        state.activeRegionId = null
      }
    },
    setActiveRegionId(state, action: PayloadAction<string | null>) {
      state.activeRegionId = action.payload
    },
    updateRegionInOut(state, action: PayloadAction<{ id: string; inPoint: number; outPoint: number }>) {
      const r = state.regions.find(r => r.id === action.payload.id)
      if (!r) return
      const next = clampRegionInOut(
        { inPoint: r.inPoint, outPoint: r.outPoint },
        { inPoint: action.payload.inPoint, outPoint: action.payload.outPoint },
      )
      r.inPoint = next.inPoint
      r.outPoint = next.outPoint
      // Preserve diverged beat-space bounds (inBeatTime/outBeatTime). When the
      // region was in its default-linked state (both undefined), they stay
      // undefined (clipout renders linked to the new input bounds). When the
      // user had already diverged them, they stay where they were — dragging
      // clipin only moves the input bounds.
    },
    updateRegionBeatTimes(state, action: PayloadAction<{ id: string; inBeatTime?: number; outBeatTime?: number }>) {
      const r = state.regions.find(r => r.id === action.payload.id)
      if (r) {
        r.inBeatTime = action.payload.inBeatTime
        r.outBeatTime = action.payload.outBeatTime
      }
    },
    updateRegionLock(state, action: PayloadAction<{ id: string; lock: 'bpm' | 'beats'; lockedBeats?: number }>) {
      const r = state.regions.find(r => r.id === action.payload.id)
      if (r) {
        r.lock = action.payload.lock
        if (action.payload.lockedBeats !== undefined) r.lockedBeats = action.payload.lockedBeats
      }
    },
    renameRegion(state, action: PayloadAction<{ id: string; name: string }>) {
      const r = state.regions.find(r => r.id === action.payload.id)
      if (r) r.name = action.payload.name
    },
    updateRegionBpm(state, action: PayloadAction<{ id: string; bpm: number }>) {
      const r = state.regions.find(r => r.id === action.payload.id)
      if (r) r.bpm = action.payload.bpm
    },
    updateRegionStretch(state, action: PayloadAction<{ id: string; minStretch?: number; maxStretch?: number }>) {
      const r = state.regions.find(r => r.id === action.payload.id)
      if (r) {
        if (action.payload.minStretch !== undefined) r.minStretch = action.payload.minStretch
        if (action.payload.maxStretch !== undefined) r.maxStretch = action.payload.maxStretch
      }
    },
    updateRegionTriggerMode(state, action: PayloadAction<{ id: string; triggerMode: boolean }>) {
      const r = state.regions.find(r => r.id === action.payload.id)
      if (r) r.triggerMode = action.payload.triggerMode
    },
    /** Commit a boundary-coincidence linking event (design §3.2, §5a/§5b).
     *  The edge that was linked snaps its beat-space bound to beatAnchorTime;
     *  the other edge is preserved. lockedBeats is recomputed from the new
     *  clipout length × bpm / 60 — always lock='bpm' semantics (lock-bypass
     *  design §3.2: bpm stays, lockedBeats absorbs the change regardless of
     *  region.lock setting). r.bpm and r.lock are NOT overwritten — they are
     *  echoed unchanged by commitLinkingEvent. */
    applyLinkingEvent(state, action: PayloadAction<{
      id: string
      edge: 'in' | 'out'
      side: 'input' | 'output'
      /** Beat-space time of the paired BEAT anchor at the moment of pointerUp.
       *  (Caller resolves the AnchorPair via linkState; only the beatAnchor
       *  is needed downstream.) */
      beatAnchorTime: number
      /** Current input (orig) anchors — forwarded to commitLinkingEvent so the
       *  effective bound for the NON-linked edge accounts for input-anchor
       *  conform. Pass empty arrays when anchor conform is not relevant. */
      origAnchors?: readonly { id: number; time: number }[]
      /** Current beat anchors — paired with origAnchors above. */
      beatAnchors?: readonly { id: number; time: number }[]
    }>) {
      const r = state.regions.find(r => r.id === action.payload.id)
      if (!r) return
      // Build a synthetic Anchor for the committer (id is informational here —
      // commitLinkingEvent only reads `time`).
      const beatAnchor = { id: -1, time: action.payload.beatAnchorTime }
      const result = commitLinkingEvent({
        region: r,
        edge: action.payload.edge,
        side: action.payload.side,
        beatAnchor,
        origAnchors: action.payload.origAnchors ?? [],
        beatAnchors: action.payload.beatAnchors ?? [],
      })
      r.inBeatTime = result.inBeatTime
      r.outBeatTime = result.outBeatTime
      r.lockedBeats = result.lockedBeats
      // r.bpm and r.lock are explicitly NOT overwritten — commitLinkingEvent
      // echoes them unchanged (lock-bypass design §3.2: bpm stays, lockedBeats
      // absorbs the change, regardless of region.lock setting).
    },
    /** Direct BPM edit with grid-vs-stretch branching (design §6.4 / §11).
     *  stretch=false (grid model): clipout length stays, lockedBeats recomputes.
     *  stretch=true  (stretch model): length rescales to keep lockedBeats fixed;
     *    anchor rescale is OUT OF SCOPE — the caller is responsible for
     *    dispatching warp-slice anchor updates via stretchRescale.
     *
     *  `origAnchors` / `beatAnchors` are used to compute the effective beat
     *  bounds so that input-anchor conform is reflected in the current length. */
    applyBpmEdit(state, action: PayloadAction<{
      id: string
      newBpm: number
      /** true = stretch model (length rescales, lockedBeats preserved).
       *  false = grid model (length stays, lockedBeats recomputes). */
      stretch: boolean
      origAnchors?: readonly { id: number; time: number }[]
      beatAnchors?: readonly { id: number; time: number }[]
    }>) {
      const r = state.regions.find(r => r.id === action.payload.id)
      if (!r) return
      const { newBpm, stretch } = action.payload
      const { inBeatTime, outBeatTime } = effectiveBeatBounds(
        r,
        action.payload.origAnchors ?? [],
        action.payload.beatAnchors ?? [],
      )
      if (stretch) {
        const oldLength = outBeatTime - inBeatTime
        const lockedBeats = r.lockedBeats ?? (oldLength * r.bpm) / 60
        // Stretch: length = 60 × lockedBeats / bpm; lockedBeats unchanged.
        const newLength = (60 * lockedBeats) / newBpm
        r.bpm = newBpm
        r.lockedBeats = lockedBeats
        r.inBeatTime = inBeatTime
        r.outBeatTime = inBeatTime + newLength
      } else {
        // Grid: length stays, lockedBeats recomputes from new bpm.
        const length = outBeatTime - inBeatTime
        r.bpm = newBpm
        r.lockedBeats = (length * newBpm) / 60
      }
    },

    /** Direct beats edit with grid-vs-stretch branching (design §6.4 / §11).
     *  stretch=false (grid model): clipout length stays, bpm recomputes.
     *  stretch=true  (stretch model): length rescales to keep bpm fixed.
     *
     *  `origAnchors` / `beatAnchors` are used to compute the effective beat
     *  bounds so that input-anchor conform is reflected in the current length. */
    applyBeatsEdit(state, action: PayloadAction<{
      id: string
      newLockedBeats: number
      stretch: boolean
      origAnchors?: readonly { id: number; time: number }[]
      beatAnchors?: readonly { id: number; time: number }[]
    }>) {
      const r = state.regions.find(r => r.id === action.payload.id)
      if (!r) return
      const { newLockedBeats, stretch } = action.payload
      const { inBeatTime, outBeatTime } = effectiveBeatBounds(
        r,
        action.payload.origAnchors ?? [],
        action.payload.beatAnchors ?? [],
      )
      if (stretch) {
        // Stretch: length rescales to keep bpm constant.
        const newLength = (60 * newLockedBeats) / r.bpm
        r.lockedBeats = newLockedBeats
        r.inBeatTime = inBeatTime
        r.outBeatTime = inBeatTime + newLength
      } else {
        // Grid: length stays, bpm recomputes.
        const length = outBeatTime - inBeatTime
        r.lockedBeats = newLockedBeats
        r.bpm = (60 * newLockedBeats) / length
      }
    },

    /** Commit a conform event: the clipout's beat-space bounds change because
     *  an anchor was moved onto / off / across the clip boundary, or the user
     *  dragged the clipout edge directly. Diverges beat-space from input-space
     *  and updates whichever of {bpm, lockedBeats} the region's lock says
     *  should derive from the new clipout length. The clipin input bounds
     *  (inPoint/outPoint) are NOT touched — clipin stays where the user put it.
     *
     *  `origAnchors` / `beatAnchors` are forwarded to `conformedRegionUpdate`
     *  so the effective pre-conform length accounts for input-anchor conform
     *  (used only for the `lock='beats'` / no-snapshot fallback path). */
    /** Reset a region's beat-space boundaries back to the default-linked state
     *  (inBeatTime = undefined, outBeatTime = undefined). lockedBeats is
     *  intentionally left unchanged — it represents the user's beat-count
     *  setting and should not be discarded by a boundary reset. */
    resetRegionBoundary(state, action: PayloadAction<{ id: string }>) {
      const r = state.regions.find(r => r.id === action.payload.id)
      if (!r) return
      r.inBeatTime = undefined
      r.outBeatTime = undefined
    },
    applyConformedClipout(state, action: PayloadAction<{
      id: string
      inBeatTime: number
      outBeatTime: number
      origAnchors?: readonly { id: number; time: number }[]
      beatAnchors?: readonly { id: number; time: number }[]
    }>) {
      const r = state.regions.find(r => r.id === action.payload.id)
      if (!r) return
      const newLength = action.payload.outBeatTime - action.payload.inBeatTime
      if (newLength <= 0) return
      const update = conformedRegionUpdate(
        r,
        action.payload.inBeatTime,
        action.payload.outBeatTime,
        action.payload.origAnchors ?? [],
        action.payload.beatAnchors ?? [],
      )
      r.inBeatTime = action.payload.inBeatTime
      r.outBeatTime = action.payload.outBeatTime
      if (update.bpm !== undefined) r.bpm = update.bpm
      if (update.lockedBeats !== undefined) r.lockedBeats = update.lockedBeats
    },
  },
})

export const {
  setRegions,
  addRegion,
  deleteRegion,
  setActiveRegionId,
  updateRegionInOut,
  updateRegionBeatTimes,
  updateRegionLock,
  renameRegion,
  updateRegionBpm,
  updateRegionStretch,
  updateRegionTriggerMode,
  applyLinkingEvent,
  resetRegionBoundary,
  applyConformedClipout,
  applyBpmEdit,
  applyBeatsEdit,
} = regionSlice.actions

export default regionSlice.reducer
