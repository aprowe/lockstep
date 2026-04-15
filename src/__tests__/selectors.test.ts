import { describe, it, expect } from 'vitest'
import {
  selectSortedOrig,
  selectSortedBeat,
  selectOutputDuration,
  selectSelectedIdsSet,
  selectLinkedBeatSet,
  selectDimmedAnchorIds,
  selectWarpData,
  selectActiveRegion,
  selectClipIn,
  selectClipOut,
} from '../store/selectors'
import type { RootState } from '../store/store'
import type { Anchor, Region } from '../types'

// ── helpers ──────────────────────────────────────────────────────────────────

function makeState(overrides: {
  origAnchors?: Anchor[]
  beatAnchors?: Anchor[]
  linkedBeatIds?: number[]
  selectedIds?: number[]
  beatZeroId?: number | null
  duration?: number
  regions?: Region[]
  activeRegionId?: string | null
} = {}): RootState {
  return {
    video: {
      video: overrides.duration !== undefined
        ? { path: '', originalName: '', videoUrl: '', duration: overrides.duration, fps: 30, fileHash: '' }
        : null,
    },
    ui: {
      timelineHeight: 280, sidebarWidth: 170, clipSidebarWidth: 170, rightWidth: 280,
      sidebarCollapsed: false, gridDiv: 1, playing: false, exportOpen: false,
      view: { start: 0, end: 60 }, lastExportFolder: null,
    } as RootState['ui'],
    warp: {
      origAnchors: overrides.origAnchors ?? [],
      beatAnchors: overrides.beatAnchors ?? [],
      linkedBeatIds: overrides.linkedBeatIds ?? [],
      selectedIds: overrides.selectedIds ?? [],
      bpm: 120,
      minStretch: 0.5,
      maxStretch: 2.0,
      beatZeroId: overrides.beatZeroId ?? null,
      globalMarkers: null,
      loopBeats: null,
      trimToLoop: false,
      addToEnd: false,
      playhead: 0,
    },
    region: {
      regions: overrides.regions ?? [],
      activeRegionId: overrides.activeRegionId ?? null,
    },
    history: {
      stack: [{ origAnchors: [], beatAnchors: [], linkedBeatIds: [], beatZeroId: null }],
      index: 0,
    },
  } as unknown as RootState
}

// ── selectSortedOrig ──────────────────────────────────────────────────────────

describe('selectSortedOrig', () => {
  it('returns anchors sorted by time', () => {
    const state = makeState({
      origAnchors: [{ id: 3, time: 15 }, { id: 1, time: 5 }, { id: 2, time: 10 }],
    })
    const result = selectSortedOrig(state)
    expect(result.map(a => a.time)).toEqual([5, 10, 15])
  })

  it('does not mutate the original array', () => {
    const orig = [{ id: 2, time: 10 }, { id: 1, time: 5 }]
    const state = makeState({ origAnchors: orig })
    selectSortedOrig(state)
    expect(orig[0].id).toBe(2) // order unchanged
  })
})

// ── selectSortedBeat ──────────────────────────────────────────────────────────

describe('selectSortedBeat', () => {
  it('returns beat anchors in the same order as sorted orig', () => {
    const state = makeState({
      origAnchors: [{ id: 2, time: 10 }, { id: 1, time: 5 }],
      beatAnchors: [{ id: 1, time: 6 }, { id: 2, time: 11 }],
    })
    const result = selectSortedBeat(state)
    // Sorted orig order: id:1, id:2 → beat order should be id:1(6), id:2(11)
    expect(result[0].id).toBe(1)
    expect(result[1].id).toBe(2)
  })
})

// ── selectOutputDuration ──────────────────────────────────────────────────────

describe('selectOutputDuration', () => {
  it('returns video duration when there are no anchors', () => {
    const state = makeState({ duration: 60 })
    expect(selectOutputDuration(state)).toBe(60)
  })

  it('computes duration from last beat + remaining orig tail', () => {
    const state = makeState({
      origAnchors: [{ id: 1, time: 10 }],
      beatAnchors: [{ id: 1, time: 12 }],
      duration: 60,
    })
    // 12 + (60 - 10) = 62
    expect(selectOutputDuration(state)).toBe(62)
  })
})

// ── selectSelectedIdsSet ──────────────────────────────────────────────────────

describe('selectSelectedIdsSet', () => {
  it('returns a Set of the selectedIds', () => {
    const state = makeState({ selectedIds: [1, 3, 5] })
    const set = selectSelectedIdsSet(state)
    expect(set).toBeInstanceOf(Set)
    expect(set.has(1)).toBe(true)
    expect(set.has(3)).toBe(true)
    expect(set.has(2)).toBe(false)
  })
})

// ── selectLinkedBeatSet ───────────────────────────────────────────────────────

describe('selectLinkedBeatSet', () => {
  it('returns a Set of linkedBeatIds', () => {
    const state = makeState({ linkedBeatIds: [2, 4] })
    const set = selectLinkedBeatSet(state)
    expect(set.has(2)).toBe(true)
    expect(set.has(4)).toBe(true)
    expect(set.has(1)).toBe(false)
  })
})

// ── selectDimmedAnchorIds ─────────────────────────────────────────────────────

describe('selectDimmedAnchorIds', () => {
  it('returns undefined when no active region', () => {
    const state = makeState({
      origAnchors: [{ id: 1, time: 5 }],
    })
    expect(selectDimmedAnchorIds(state)).toBeUndefined()
  })

  it('dims anchors outside the active region in/out range', () => {
    const region: Region = {
      id: 'r1', name: 'R', inPoint: 10, outPoint: 20,
      bpm: 120, minStretch: 0.5, maxStretch: 2, addToEnd: false,
    }
    const state = makeState({
      origAnchors: [
        { id: 1, time: 5 },   // before inPoint → dimmed
        { id: 2, time: 15 },  // inside → not dimmed
        { id: 3, time: 25 },  // after outPoint → dimmed
      ],
      regions: [region],
      activeRegionId: 'r1',
    })
    const dimmed = selectDimmedAnchorIds(state)
    expect(dimmed).toBeDefined()
    expect(dimmed!.has(1)).toBe(true)
    expect(dimmed!.has(2)).toBe(false)
    expect(dimmed!.has(3)).toBe(true)
  })

  it('returns undefined when all anchors are inside the region', () => {
    const region: Region = {
      id: 'r1', name: 'R', inPoint: 0, outPoint: 60,
      bpm: 120, minStretch: 0.5, maxStretch: 2, addToEnd: false,
    }
    const state = makeState({
      origAnchors: [{ id: 1, time: 5 }, { id: 2, time: 30 }],
      regions: [region],
      activeRegionId: 'r1',
    })
    expect(selectDimmedAnchorIds(state)).toBeUndefined()
  })
})

// ── selectActiveRegion / selectClipIn / selectClipOut ─────────────────────────

describe('selectActiveRegion', () => {
  it('returns null when no active region', () => {
    expect(selectActiveRegion(makeState())).toBeNull()
  })

  it('returns the active region', () => {
    const region: Region = {
      id: 'r1', name: 'Test', inPoint: 5, outPoint: 25,
      bpm: 120, minStretch: 0.5, maxStretch: 2, addToEnd: false,
    }
    const state = makeState({ regions: [region], activeRegionId: 'r1' })
    expect(selectActiveRegion(state)?.id).toBe('r1')
  })
})

describe('selectClipIn / selectClipOut', () => {
  it('returns undefined with no active region', () => {
    expect(selectClipIn(makeState())).toBeUndefined()
    expect(selectClipOut(makeState())).toBeUndefined()
  })

  it('returns the region in/out points', () => {
    const region: Region = {
      id: 'r1', name: 'Test', inPoint: 8, outPoint: 22,
      bpm: 120, minStretch: 0.5, maxStretch: 2, addToEnd: false,
    }
    const state = makeState({ regions: [region], activeRegionId: 'r1' })
    expect(selectClipIn(state)).toBe(8)
    expect(selectClipOut(state)).toBe(22)
  })
})

// ── selectWarpData ────────────────────────────────────────────────────────────

describe('selectWarpData', () => {
  it('includes bpm and stretch limits', () => {
    const state = makeState()
    const data = selectWarpData(state)
    expect(data.bpm).toBe(120)
    expect(data.minStretch).toBe(0.5)
    expect(data.maxStretch).toBe(2.0)
  })

  it('uses the first beat anchor time as beatZeroTime when no region or beatZeroId', () => {
    const state = makeState({
      origAnchors: [{ id: 1, time: 5 }, { id: 2, time: 10 }],
      beatAnchors: [{ id: 1, time: 6 }, { id: 2, time: 11 }],
    })
    // First beat anchor (sorted by orig) has id:1, time:6
    expect(selectWarpData(state).beatZeroTime).toBe(6)
  })

  it('uses the clipIn as beatZeroTime when a region is active but no beatZeroId', () => {
    const region: Region = {
      id: 'r1', name: 'R', inPoint: 10, outPoint: 40,
      bpm: 120, minStretch: 0.5, maxStretch: 2, addToEnd: false,
    }
    const state = makeState({
      origAnchors: [{ id: 1, time: 15 }],
      beatAnchors: [{ id: 1, time: 16 }],
      regions: [region],
      activeRegionId: 'r1',
    })
    expect(selectWarpData(state).beatZeroTime).toBe(10) // clipIn
  })

  it('uses the designated beatZeroId anchor time when set', () => {
    const region: Region = {
      id: 'r1', name: 'R', inPoint: 10, outPoint: 40,
      bpm: 120, minStretch: 0.5, maxStretch: 2, addToEnd: false,
    }
    const state = makeState({
      origAnchors: [{ id: 1, time: 15 }, { id: 2, time: 20 }],
      beatAnchors: [{ id: 1, time: 16 }, { id: 2, time: 21 }],
      beatZeroId: 2,
      regions: [region],
      activeRegionId: 'r1',
    })
    expect(selectWarpData(state).beatZeroTime).toBe(21)
  })
})
