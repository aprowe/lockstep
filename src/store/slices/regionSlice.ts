import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { Region } from '../../types'

interface RegionState {
  regions: Region[]
  activeRegionId: string | null
}

const initialState: RegionState = {
  regions: [],
  activeRegionId: null,
}

const regionSlice = createSlice({
  name: 'region',
  initialState,
  reducers: {
    setRegions(state, action: PayloadAction<Region[]>) {
      state.regions = action.payload
    },
    addRegion(state, action: PayloadAction<Region>) {
      state.regions.push(action.payload)
      state.activeRegionId = action.payload.id
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
      let { inPoint: newIn, outPoint: newOut } = action.payload
      const length = r.outPoint - r.inPoint
      const MIN_LENGTH = 1

      if (newIn > r.outPoint) {
        // Start moved past the original end → shift end to preserve length
        newOut = newIn + length
      } else if (newOut < r.inPoint) {
        // End moved before the original start → shift start to preserve length
        newIn = newOut - length
      } else if (newOut - newIn < MIN_LENGTH) {
        // Span is below minimum: clamp whichever boundary moved
        if (newIn !== r.inPoint) {
          newIn = newOut - MIN_LENGTH  // start moved too close → pull start back
        } else {
          newOut = newIn + MIN_LENGTH  // end moved too close → push end forward
        }
      }

      r.inPoint = newIn
      r.outPoint = newOut
      r.inBeatTime = undefined
      r.outBeatTime = undefined
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
        r.lockedBeats = action.payload.lockedBeats
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
} = regionSlice.actions

export default regionSlice.reducer
