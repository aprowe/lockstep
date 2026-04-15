import { describe, it, expect, beforeEach } from 'vitest'
import warpReducer, {
  addAnchor,
  removeAnchors,
  moveOrigAnchor,
  moveBeatAnchor,
  resetBeatLinks,
  clearAnchors,
  loadAnchors,
  setOrigAnchorsFromTimeline,
  setBeatAnchorsFromTimeline,
  selectAll,
  deselectAll,
  setSelectedIds,
  setBeatZeroId,
  newAnchorId,
  bumpAnchorIdCounter,
} from '../../store/slices/warpSlice'
import type { Anchor } from '../../types'

// Helper: build initial warp state with anchors already present
function stateWithAnchors(pairs: { id: number; origTime: number; beatTime?: number }[]) {
  let state = warpReducer(undefined, { type: '@@INIT' })
  for (const { id, origTime, beatTime } of pairs) {
    state = warpReducer(state, addAnchor({ id, time: origTime }))
    if (beatTime !== undefined && beatTime !== origTime) {
      state = warpReducer(state, moveBeatAnchor({ id, time: beatTime }))
    }
  }
  return state
}

// ── addAnchor ─────────────────────────────────────────────────────────────────

describe('addAnchor', () => {
  it('appends to both orig and beat arrays', () => {
    const state = warpReducer(undefined, addAnchor({ id: 1, time: 5 }))
    expect(state.origAnchors).toHaveLength(1)
    expect(state.beatAnchors).toHaveLength(1)
    expect(state.origAnchors[0]).toEqual({ id: 1, time: 5 })
    expect(state.beatAnchors[0]).toEqual({ id: 1, time: 5 })
  })

  it('marks new anchors as linked', () => {
    const state = warpReducer(undefined, addAnchor({ id: 1, time: 5 }))
    expect(state.linkedBeatIds).toContain(1)
  })

  it('orig and beat anchors start at the same time', () => {
    const state = warpReducer(undefined, addAnchor({ id: 1, time: 7.5 }))
    expect(state.origAnchors[0].time).toBe(state.beatAnchors[0].time)
  })
})

// ── removeAnchors ─────────────────────────────────────────────────────────────

describe('removeAnchors', () => {
  it('removes from both arrays and linkedBeatIds', () => {
    let state = warpReducer(undefined, addAnchor({ id: 1, time: 5 }))
    state = warpReducer(state, addAnchor({ id: 2, time: 10 }))
    state = warpReducer(state, removeAnchors([1]))
    expect(state.origAnchors.find(a => a.id === 1)).toBeUndefined()
    expect(state.beatAnchors.find(a => a.id === 1)).toBeUndefined()
    expect(state.linkedBeatIds).not.toContain(1)
    expect(state.origAnchors).toHaveLength(1)
  })

  it('clears beatZeroId when that anchor is removed', () => {
    let state = warpReducer(undefined, addAnchor({ id: 1, time: 5 }))
    state = warpReducer(state, setBeatZeroId(1))
    state = warpReducer(state, removeAnchors([1]))
    expect(state.beatZeroId).toBeNull()
  })

  it('removes the ID from selectedIds', () => {
    let state = warpReducer(undefined, addAnchor({ id: 1, time: 5 }))
    state = warpReducer(state, setSelectedIds([1]))
    state = warpReducer(state, removeAnchors([1]))
    expect(state.selectedIds).not.toContain(1)
  })
})

// ── moveOrigAnchor ────────────────────────────────────────────────────────────

describe('moveOrigAnchor', () => {
  it('moves a linked beat anchor in sync with orig', () => {
    let state = warpReducer(undefined, addAnchor({ id: 1, time: 5 }))
    expect(state.linkedBeatIds).toContain(1)
    state = warpReducer(state, moveOrigAnchor({ id: 1, time: 8 }))
    expect(state.origAnchors[0].time).toBe(8)
    expect(state.beatAnchors[0].time).toBe(8)
  })

  it('does NOT move an unlinked beat anchor', () => {
    let state = warpReducer(undefined, addAnchor({ id: 1, time: 5 }))
    // Unlink by moving the beat anchor separately
    state = warpReducer(state, moveBeatAnchor({ id: 1, time: 9 }))
    expect(state.linkedBeatIds).not.toContain(1)
    state = warpReducer(state, moveOrigAnchor({ id: 1, time: 12 }))
    expect(state.origAnchors[0].time).toBe(12)
    expect(state.beatAnchors[0].time).toBe(9) // unchanged
  })
})

// ── moveBeatAnchor ────────────────────────────────────────────────────────────

describe('moveBeatAnchor', () => {
  it('unlinks the beat anchor when moved independently', () => {
    let state = warpReducer(undefined, addAnchor({ id: 1, time: 5 }))
    expect(state.linkedBeatIds).toContain(1)
    state = warpReducer(state, moveBeatAnchor({ id: 1, time: 8 }))
    expect(state.linkedBeatIds).not.toContain(1)
  })

  it('updates the beat anchor time', () => {
    let state = warpReducer(undefined, addAnchor({ id: 1, time: 5 }))
    state = warpReducer(state, moveBeatAnchor({ id: 1, time: 7 }))
    expect(state.beatAnchors[0].time).toBe(7)
  })

  it('leaves orig anchor time unchanged', () => {
    let state = warpReducer(undefined, addAnchor({ id: 1, time: 5 }))
    state = warpReducer(state, moveBeatAnchor({ id: 1, time: 7 }))
    expect(state.origAnchors[0].time).toBe(5)
  })
})

// ── resetBeatLinks ────────────────────────────────────────────────────────────

describe('resetBeatLinks', () => {
  it('restores beat anchor to orig position and re-links', () => {
    let state = warpReducer(undefined, addAnchor({ id: 1, time: 5 }))
    state = warpReducer(state, moveBeatAnchor({ id: 1, time: 9 }))
    expect(state.linkedBeatIds).not.toContain(1)
    state = warpReducer(state, resetBeatLinks([1]))
    expect(state.beatAnchors[0].time).toBe(5) // restored to orig
    expect(state.linkedBeatIds).toContain(1)
  })

  it('is idempotent when anchor is already linked', () => {
    let state = warpReducer(undefined, addAnchor({ id: 1, time: 5 }))
    state = warpReducer(state, resetBeatLinks([1]))
    expect(state.beatAnchors[0].time).toBe(5)
    expect(state.linkedBeatIds).toContain(1)
  })
})

// ── clearAnchors ──────────────────────────────────────────────────────────────

describe('clearAnchors', () => {
  it('empties all anchor arrays and selection', () => {
    let state = stateWithAnchors([{ id: 1, origTime: 5 }, { id: 2, origTime: 10 }])
    state = warpReducer(state, setSelectedIds([1]))
    state = warpReducer(state, setBeatZeroId(1))
    state = warpReducer(state, clearAnchors())
    expect(state.origAnchors).toHaveLength(0)
    expect(state.beatAnchors).toHaveLength(0)
    expect(state.linkedBeatIds).toHaveLength(0)
    expect(state.selectedIds).toHaveLength(0)
    expect(state.beatZeroId).toBeNull()
  })
})

// ── setOrigAnchorsFromTimeline ─────────────────────────────────────────────────

describe('setOrigAnchorsFromTimeline', () => {
  it('adds a new anchor as linked', () => {
    let state = warpReducer(undefined, { type: '@@INIT' })
    state = warpReducer(state, setOrigAnchorsFromTimeline([{ id: 10, time: 5 }]))
    expect(state.origAnchors).toHaveLength(1)
    expect(state.beatAnchors).toHaveLength(1)
    expect(state.linkedBeatIds).toContain(10)
  })

  it('removes anchors not in the next array', () => {
    let state = stateWithAnchors([{ id: 1, origTime: 5 }, { id: 2, origTime: 10 }])
    state = warpReducer(state, setOrigAnchorsFromTimeline([{ id: 1, time: 5 }]))
    expect(state.origAnchors).toHaveLength(1)
    expect(state.beatAnchors.find(a => a.id === 2)).toBeUndefined()
  })

  it('clears beatZeroId when that anchor is removed via timeline update', () => {
    let state = stateWithAnchors([{ id: 1, origTime: 5 }])
    state = warpReducer(state, setBeatZeroId(1))
    state = warpReducer(state, setOrigAnchorsFromTimeline([]))
    expect(state.beatZeroId).toBeNull()
  })

  it('moves a linked beat anchor when orig anchor moves', () => {
    let state = stateWithAnchors([{ id: 1, origTime: 5 }])
    expect(state.linkedBeatIds).toContain(1)
    state = warpReducer(state, setOrigAnchorsFromTimeline([{ id: 1, time: 8 }]))
    expect(state.beatAnchors[0].time).toBe(8)
  })

  it('does NOT move an unlinked beat anchor when orig anchor moves', () => {
    let state = stateWithAnchors([{ id: 1, origTime: 5, beatTime: 9 }])
    expect(state.linkedBeatIds).not.toContain(1)
    state = warpReducer(state, setOrigAnchorsFromTimeline([{ id: 1, time: 12 }]))
    expect(state.beatAnchors[0].time).toBe(9) // unchanged
  })
})

// ── setBeatAnchorsFromTimeline ─────────────────────────────────────────────────

describe('setBeatAnchorsFromTimeline', () => {
  it('unlinks anchors whose beat time changes', () => {
    let state = stateWithAnchors([{ id: 1, origTime: 5 }])
    expect(state.linkedBeatIds).toContain(1)
    state = warpReducer(state, setBeatAnchorsFromTimeline([{ id: 1, time: 7 }]))
    expect(state.linkedBeatIds).not.toContain(1)
  })

  it('keeps the link when beat time is unchanged', () => {
    let state = stateWithAnchors([{ id: 1, origTime: 5 }])
    state = warpReducer(state, setBeatAnchorsFromTimeline([{ id: 1, time: 5 }]))
    expect(state.linkedBeatIds).toContain(1)
  })
})

// ── loadAnchors ──────────────────────────────────────────────────────────────

describe('loadAnchors', () => {
  it('replaces all anchors and metadata', () => {
    let state = stateWithAnchors([{ id: 1, origTime: 5 }])
    const payload = {
      origAnchors: [{ id: 7, time: 20 }] as Anchor[],
      beatAnchors: [{ id: 7, time: 22 }] as Anchor[],
      linkedBeatIds: [] as number[],
      beatZeroId: 7,
    }
    state = warpReducer(state, loadAnchors(payload))
    expect(state.origAnchors).toEqual(payload.origAnchors)
    expect(state.beatAnchors).toEqual(payload.beatAnchors)
    expect(state.linkedBeatIds).toEqual([])
    expect(state.beatZeroId).toBe(7)
  })
})

// ── selection ────────────────────────────────────────────────────────────────

describe('selection', () => {
  it('selectAll selects all orig anchor IDs', () => {
    let state = stateWithAnchors([{ id: 1, origTime: 5 }, { id: 2, origTime: 10 }])
    state = warpReducer(state, selectAll())
    expect(state.selectedIds).toEqual(expect.arrayContaining([1, 2]))
    expect(state.selectedIds).toHaveLength(2)
  })

  it('deselectAll clears selection', () => {
    let state = stateWithAnchors([{ id: 1, origTime: 5 }])
    state = warpReducer(state, selectAll())
    state = warpReducer(state, deselectAll())
    expect(state.selectedIds).toHaveLength(0)
  })

  it('setSelectedIds sets an explicit list', () => {
    let state = stateWithAnchors([{ id: 1, origTime: 5 }, { id: 2, origTime: 10 }])
    state = warpReducer(state, setSelectedIds([2]))
    expect(state.selectedIds).toEqual([2])
  })
})

// ── newAnchorId / bumpAnchorIdCounter ─────────────────────────────────────────

describe('newAnchorId', () => {
  it('returns a positive integer and increments on each call', () => {
    const a = newAnchorId()
    const b = newAnchorId()
    expect(typeof a).toBe('number')
    expect(b).toBe(a + 1)
  })
})

describe('bumpAnchorIdCounter', () => {
  it('ensures subsequent newAnchorId calls do not collide with provided anchors', () => {
    bumpAnchorIdCounter([{ id: 9999 }])
    const next = newAnchorId()
    expect(next).toBeGreaterThan(9999)
  })
})
