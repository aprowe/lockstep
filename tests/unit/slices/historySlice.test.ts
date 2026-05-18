import { describe, it, expect } from 'vitest'
import historyReducer, {
  pushSnapshot,
  undo,
  redo,
  resetHistory,
  type HistoryEntry,
} from '../../../src/store/slices/historySlice'

function entry(origTimes: number[], beatTimes?: number[]): HistoryEntry {
  const bt = beatTimes ?? origTimes
  return {
    origAnchors: origTimes.map((t, i) => ({ id: i + 1, time: t })),
    beatAnchors: bt.map((t, i) => ({ id: i + 1, time: t })),
    beatZeroId: null,
    bpm: 120,
    minStretch: 0.5,
    maxStretch: 2.0,
    loopBeats: null,
    trimToLoop: false,
    addToEnd: false,
    regions: [],
  }
}

describe('pushSnapshot', () => {
  it('appends a new entry beyond the initial snapshot', () => {
    let state = historyReducer(undefined, pushSnapshot(entry([5])))
    expect(state.stack).toHaveLength(2)
    expect(state.index).toBe(1)
  })

  it('skips identical consecutive snapshots', () => {
    let state = historyReducer(undefined, pushSnapshot(entry([5])))
    state = historyReducer(state, pushSnapshot(entry([5])))
    expect(state.stack).toHaveLength(2)
  })

  it('truncates future entries when a new snapshot is pushed after undo', () => {
    let state = historyReducer(undefined, { type: '@@INIT' })
    state = historyReducer(state, pushSnapshot(entry([5])))
    state = historyReducer(state, pushSnapshot(entry([10])))
    state = historyReducer(state, undo())
    state = historyReducer(state, pushSnapshot(entry([7])))
    expect(state.stack).toHaveLength(3)
    expect(state.stack[2].origAnchors[0].time).toBe(7)
  })

  it('caps the stack at 100 entries', () => {
    let state = historyReducer(undefined, { type: '@@INIT' })
    for (let i = 0; i < 101; i++) {
      state = historyReducer(state, pushSnapshot(entry([i])))
    }
    expect(state.stack.length).toBeLessThanOrEqual(100)
  })
})

describe('undo', () => {
  it('decrements index', () => {
    let state = historyReducer(undefined, pushSnapshot(entry([5])))
    expect(state.index).toBe(1)
    state = historyReducer(state, undo())
    expect(state.index).toBe(0)
  })

  it('does not go below 0', () => {
    let state = historyReducer(undefined, { type: '@@INIT' })
    state = historyReducer(state, undo())
    expect(state.index).toBe(0)
  })
})

describe('redo', () => {
  it('increments index after an undo', () => {
    let state = historyReducer(undefined, pushSnapshot(entry([5])))
    state = historyReducer(state, undo())
    state = historyReducer(state, redo())
    expect(state.index).toBe(1)
  })

  it('does not go past the end of the stack', () => {
    let state = historyReducer(undefined, pushSnapshot(entry([5])))
    state = historyReducer(state, redo())
    expect(state.index).toBe(1)
  })
})

describe('resetHistory', () => {
  it('replaces the stack with a single entry at index 0', () => {
    let state = historyReducer(undefined, pushSnapshot(entry([5])))
    state = historyReducer(state, pushSnapshot(entry([10])))
    state = historyReducer(state, resetHistory(entry([99])))
    expect(state.stack).toHaveLength(1)
    expect(state.index).toBe(0)
    expect(state.stack[0].origAnchors[0].time).toBe(99)
  })
})
