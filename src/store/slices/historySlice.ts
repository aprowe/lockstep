import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { Anchor } from '../../types'

export interface HistoryEntry {
  origAnchors: Anchor[]
  beatAnchors: Anchor[]
  linkedBeatIds: number[]
  beatZeroId: number | null
}

interface HistoryState {
  stack: HistoryEntry[]
  index: number
}

const initialState: HistoryState = {
  stack: [{
    origAnchors: [],
    beatAnchors: [],
    linkedBeatIds: [],
    beatZeroId: null,
  }],
  index: 0,
}

const historySlice = createSlice({
  name: 'history',
  initialState,
  reducers: {
    pushSnapshot(state, action: PayloadAction<HistoryEntry>) {
      const entry = action.payload
      const cur = state.stack[state.index]
      // Skip if identical to current
      if (cur &&
          cur.origAnchors.length === entry.origAnchors.length &&
          cur.beatAnchors.length === entry.beatAnchors.length &&
          cur.beatZeroId === entry.beatZeroId &&
          cur.origAnchors.every((a, i) => a.id === entry.origAnchors[i]?.id && Math.abs(a.time - entry.origAnchors[i]?.time) < 0.0001) &&
          cur.beatAnchors.every((a, i) => a.id === entry.beatAnchors[i]?.id && Math.abs(a.time - entry.beatAnchors[i]?.time) < 0.0001)) {
        return
      }
      // Truncate future entries
      state.stack = state.stack.slice(0, state.index + 1)
      state.stack.push(entry)
      // Cap at 100 entries
      if (state.stack.length > 100) state.stack.shift()
      state.index = state.stack.length - 1
    },
    undo(state) {
      if (state.index > 0) state.index--
    },
    redo(state) {
      if (state.index < state.stack.length - 1) state.index++
    },
    resetHistory(state, action: PayloadAction<HistoryEntry>) {
      state.stack = [action.payload]
      state.index = 0
    },
  },
})

export const { pushSnapshot, undo, redo, resetHistory } = historySlice.actions
export default historySlice.reducer
