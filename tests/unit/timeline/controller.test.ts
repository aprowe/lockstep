import { describe, it, expect } from 'vitest'
import { createTimelineController } from '../../../src/timeline/controller'
import { MINIMAP_H, buildLayout } from '../../../src/timeline/layout'
import type {
  Snapshot,
  PointerEventLike,
  HitEntry,
} from '../../../src/timeline/types'

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

const CANVAS_W = 800
const CANVAS_H = 400

function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  const tracks = buildLayout(false, CANVAS_H)
  return {
    view: { start: 0, end: 100 },
    duration: 100,
    outputDuration: 100,
    maxDuration: 100,
    anchors: [],
    beatAnchors: [],
    linkedBeatIds: new Set<number>(),
    selectedOrigAnchorIds: new Set<number>(),
    selectedBeatAnchorIds: new Set<number>(),
    regions: [],
    regionsOutput: undefined,
    regionDetails: [],
    selectedClipinIds: new Set<string>(),
    selectedClipoutIds: new Set<string>(),
    scenes: [],
    selectedSceneTimes: new Set<number>(),
    segments: [],
    bpm: 120,
    beatOffset: 0,
    snapInterval: undefined,
    snapOffset: undefined,
    followDrag: false,
    warpCollapsed: false,
    canvas: { width: CANVAS_W, height: CANVAS_H },
    tracks,
    hits: [],
    playhead: 0,
    ...overrides,
  }
}

function makePointerEvent(overrides: Partial<PointerEventLike> = {}): PointerEventLike {
  return {
    clientX: 0,
    clientY: 0,
    button: 0,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    canvasRect: { left: 0, top: 0, width: CANVAS_W, height: CANVAS_H },
    ...overrides,
  }
}

function rectHit(x: number, y: number, w: number, h: number, data: unknown): HitEntry {
  return { x, y, w, h, data }
}

// Helper: produce a hit rect that contains the given canvas-relative (x,y)
function pointHit(x: number, y: number, data: unknown): HitEntry {
  return rectHit(x - 2, y - 2, 4, 4, data)
}

// ───────────────────────────────────────────────────────────────────────────
// pointerDown — branch-by-branch
// ───────────────────────────────────────────────────────────────────────────

describe('controller.pointerDown', () => {
  it('clicking inside the minimap recenters the view and sets minimap drag state', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({ view: { start: 40, end: 60 }, maxDuration: 200, duration: 200, outputDuration: 200 })
    // x = 400 (middle) → recenter at t = 100; span = 20, so newView ≈ {90, 110}
    const intents = c.pointerDown(
      makePointerEvent({ clientX: 400, clientY: MINIMAP_H / 2 }),
      snap,
    )
    expect(intents.length).toBe(1)
    const vc = intents[0]
    expect(vc.kind).toBe('viewChange')
    if (vc.kind === 'viewChange') {
      expect(vc.view.start).toBeCloseTo(90)
      expect(vc.view.end).toBeCloseTo(110)
    }
    const ds = c.getDragState()
    expect(ds?.kind).toBe('minimap')
  })

  it('clicking on an anchor (input) sets anchor drag and defers anchorSelect to pointerUp', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      anchors: [{ id: 7, time: 12.5 }],
      hits: [pointHit(100, 200, { kind: 'anchor', id: 7, space: 'input' })],
    })
    // pointerDown emits dragStart — selection is deferred to
    // pointerUp so dragging never changes selection. A pure click (pointerUp
    // without movement past the 4 px threshold) flushes anchorSelect.
    const intents = c.pointerDown(
      makePointerEvent({ clientX: 100, clientY: 200 }),
      snap,
    )
    // Clean single-anchor drag → profile path; emits beginDrag(anchor-drag).
    expect(intents).toEqual([{
      kind: 'beginDrag',
      handle: { kind: 'anchor-drag', anchorId: 7, space: 'input' },
    }])
    const ds = c.getDragState()
    expect(ds?.kind).toBe('anchor')
    if (ds?.kind === 'anchor') {
      expect(ds.id).toBe(7)
      expect(ds.space).toBe('input')
      expect(ds.origTime).toBe(12.5)
      expect(ds.capturedSpaces).toEqual({ input: true, beat: false })
      expect(ds.profileHandle).toEqual({ kind: 'anchor-drag', anchorId: 7, space: 'input' })
      // Pending select is the additive-aware anchorSelect that fires on
      // pointerUp click.
      expect(ds.pendingSelect).toEqual([{ kind: 'anchorSelect', id: 7, additive: false }])
      expect(ds.moved).toBe(false)
    }
    // Verifying the click branch end-to-end: pointerUp without any move
    // should emit anchorSelect.
    const up = c.pointerUp(snap)
    expect(up.find(i => i.kind === 'anchorSelect')).toEqual({
      kind: 'anchorSelect', id: 7, additive: false,
    })
  })

  it('clicking on a beat anchor sets anchor drag and defers beatAnchorSelect to pointerUp', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      beatAnchors: [{ id: 9, time: 4 }],
      hits: [pointHit(150, 200, { kind: 'anchor', id: 9, space: 'output' })],
    })
    // Use metaKey (not shiftKey) for additive selection — shiftKey now pans.
    const intents = c.pointerDown(
      makePointerEvent({ clientX: 150, clientY: 200, metaKey: true }),
      snap,
    )
    expect(intents).toEqual([{
      kind: 'beginDrag',
      handle: { kind: 'anchor-drag', anchorId: 9, space: 'beat' },
    }])
    const ds = c.getDragState()
    expect(ds?.kind).toBe('anchor')
    if (ds?.kind === 'anchor') {
      expect(ds.space).toBe('output')
      expect(ds.origTime).toBe(4)
      expect(ds.profileHandle).toEqual({ kind: 'anchor-drag', anchorId: 9, space: 'beat' })
      expect(ds.pendingSelect).toEqual([{ kind: 'beatAnchorSelect', id: 9, additive: true }])
    }
    const up = c.pointerUp(snap)
    expect(up.find(i => i.kind === 'beatAnchorSelect')).toEqual({
      kind: 'beatAnchorSelect', id: 9, additive: true,
    })
  })

  it('shiftKey drag pans the timeline regardless of what is under the pointer', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      beatAnchors: [{ id: 9, time: 4 }],
      anchors: [{ id: 7, time: 12.5 }],
      hits: [pointHit(150, 200, { kind: 'anchor', id: 9, space: 'output' })],
      view: { start: 0, end: 60 },
    })
    // Shift+pointerDown over an anchor should arm pan, not anchor drag.
    const intents = c.pointerDown(
      makePointerEvent({ clientX: 150, clientY: 200, shiftKey: true }),
      snap,
    )
    expect(intents).toEqual([])
    const ds = c.getDragState()
    expect(ds?.kind).toBe('pan')
  })

  it('clicking on a region-edge sets region-edge drag and defers regionSelect to pointerUp', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      regions: [{ id: 'r1', inPoint: 10, outPoint: 30 }],
      hits: [pointHit(100, 200, { kind: 'region-edge', id: 'r1', edge: 'out', isOutput: false })],
    })
    const intents = c.pointerDown(
      makePointerEvent({ clientX: 100, clientY: 200 }),
      snap,
    )
    // Clipin out-edge → CLIP_EDGE_DRAG profile (clip-out-edge handle).
    expect(intents).toEqual([{
      kind: 'beginDrag',
      handle: { kind: 'clip-out-edge', clipId: 'r1', space: 'input' },
    }])
    const ds = c.getDragState()
    expect(ds?.kind).toBe('region-edge')
    if (ds?.kind === 'region-edge') {
      expect(ds.id).toBe('r1')
      expect(ds.edge).toBe('out')
      expect(ds.isOutput).toBe(false)
      expect(ds.origIn).toBe(10)
      expect(ds.origOut).toBe(30)
      expect(ds.profileHandle).toEqual({ kind: 'clip-out-edge', clipId: 'r1', space: 'input' })
      expect(ds.pendingSelect).toEqual([{ kind: 'regionSelect', id: 'r1' }])
    }
    const up = c.pointerUp(snap)
    expect(up.find(i => i.kind === 'regionSelect')).toEqual({ kind: 'regionSelect', id: 'r1' })
  })

  it('clicking on a region body sets region-move drag and defers regionSelect to pointerUp', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      regions: [{ id: 'r2', inPoint: 5, outPoint: 20 }],
      hits: [pointHit(120, 200, { kind: 'region', id: 'r2', isOutput: false })],
    })
    const intents = c.pointerDown(
      makePointerEvent({ clientX: 120, clientY: 200 }),
      snap,
    )
    // Clean single-clipin body drag → CLIP_BODY_DRAG profile.
    expect(intents).toEqual([{
      kind: 'beginDrag',
      handle: { kind: 'clip-body', clipId: 'r2', space: 'input' },
    }])
    const ds = c.getDragState()
    expect(ds?.kind).toBe('region-move')
    if (ds?.kind === 'region-move') {
      expect(ds.id).toBe('r2')
      expect(ds.origIn).toBe(5)
      expect(ds.origOut).toBe(20)
      expect(ds.anchorX).toBe(120)
      expect(ds.isOutput).toBe(false)
      expect(ds.profileHandle).toEqual({ kind: 'clip-body', clipId: 'r2', space: 'input' })
      expect(ds.pendingSelect).toEqual([{ kind: 'regionSelect', id: 'r2' }])
    }
    const up = c.pointerUp(snap)
    expect(up.find(i => i.kind === 'regionSelect')).toEqual({ kind: 'regionSelect', id: 'r2' })
  })

  it('region-edge on output uses regionsOutput when present', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      regions: [{ id: 'r3', inPoint: 0, outPoint: 99 }],
      regionsOutput: [{ id: 'r3', inPoint: 1, outPoint: 2 }],
      hits: [pointHit(100, 200, { kind: 'region-edge', id: 'r3', edge: 'in', isOutput: true })],
    })
    c.pointerDown(makePointerEvent({ clientX: 100, clientY: 200 }), snap)
    const ds = c.getDragState()
    expect(ds?.kind).toBe('region-edge')
    if (ds?.kind === 'region-edge') {
      expect(ds.isOutput).toBe(true)
      // Should use regionsOutput entry (1, 2), not regions entry (0, 99)
      expect(ds.origIn).toBe(1)
      expect(ds.origOut).toBe(2)
    }
  })

  it('alt-click sets pan drag and emits no intents', () => {
    const c = createTimelineController()
    const snap = makeSnapshot()
    const intents = c.pointerDown(
      makePointerEvent({ clientX: 200, clientY: 200, altKey: true }),
      snap,
    )
    expect(intents).toEqual([])
    const ds = c.getDragState()
    expect(ds?.kind).toBe('pan')
    if (ds?.kind === 'pan') {
      expect(ds.startClientX).toBe(200)
      expect(ds.startView).toBe(snap.view)
    }
  })

  it('middle-button click sets pan drag', () => {
    const c = createTimelineController()
    const snap = makeSnapshot()
    const intents = c.pointerDown(
      makePointerEvent({ clientX: 300, clientY: 200, button: 1 }),
      snap,
    )
    expect(intents).toEqual([])
    expect(c.getDragState()?.kind).toBe('pan')
  })

  it('click on the time ruler emits seek and sets seek drag (space=input)', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({ view: { start: 0, end: 100 }, duration: 80 })
    // Find the time track's y to land inside it
    const timeTrack = snap.tracks.find(t => t.id === 'time')!
    const cy = timeTrack.y + timeTrack.h / 2
    // x=400, view 0..100, canvas 800 → t = 50
    const intents = c.pointerDown(
      makePointerEvent({ clientX: 400, clientY: cy }),
      snap,
    )
    expect(intents.length).toBe(1)
    const seek = intents[0]
    expect(seek.kind).toBe('seek')
    if (seek.kind === 'seek') expect(seek.time).toBeCloseTo(50)
    const ds = c.getDragState()
    expect(ds?.kind).toBe('seek')
    if (ds?.kind === 'seek') expect(ds.space).toBe('input')
  })

  it('click on the time ruler past duration is clamped to MAX', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({ view: { start: 0, end: 100 }, duration: 20 })
    const timeTrack = snap.tracks.find(t => t.id === 'time')!
    const cy = timeTrack.y + timeTrack.h / 2
    const intents = c.pointerDown(
      makePointerEvent({ clientX: 700, clientY: cy }),
      snap,
    )
    const seek = intents[0]
    expect(seek.kind).toBe('seek')
    if (seek.kind === 'seek') expect(seek.time).toBe(20)
  })

  it('click on the beat ruler emits seekBeat (space=output)', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({ view: { start: 0, end: 100 }, outputDuration: 80 })
    const beatTrack = snap.tracks.find(t => t.id === 'beat')!
    const cy = beatTrack.y + beatTrack.h / 2
    const intents = c.pointerDown(
      makePointerEvent({ clientX: 200, clientY: cy }),
      snap,
    )
    expect(intents.length).toBe(1)
    const seek = intents[0]
    expect(seek.kind).toBe('seekBeat')
    if (seek.kind === 'seekBeat') expect(seek.time).toBeCloseTo(25)
    const ds = c.getDragState()
    expect(ds?.kind).toBe('seek')
    if (ds?.kind === 'seek') expect(ds.space).toBe('output')
  })

  it('click in an empty area arms a non-active lasso with empty initial sets', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      selectedOrigAnchorIds: new Set([1, 2]),
      selectedBeatAnchorIds: new Set([1]),
      selectedClipinIds: new Set(['c1']),
      selectedSceneTimes: new Set([3.5]),
    })
    // Click in the warp track (not a ruler, not a hit)
    const warp = snap.tracks.find(t => t.id === 'warp')!
    const cy = warp.y + warp.h / 2
    const intents = c.pointerDown(
      makePointerEvent({ clientX: 300, clientY: cy }),
      snap,
    )
    expect(intents).toEqual([])
    const ds = c.getDragState()
    expect(ds?.kind).toBe('lasso')
    if (ds?.kind === 'lasso') {
      expect(ds.active).toBe(false)
      expect(ds.additive).toBe(false)
      expect(ds.startX).toBe(300)
      expect(ds.startY).toBe(cy)
      expect(ds.curX).toBe(300)
      expect(ds.curY).toBe(cy)
      // Non-additive: initial selection sets are empty
      expect(ds.initialOrigAnchorIds.size).toBe(0)
      expect(ds.initialBeatAnchorIds.size).toBe(0)
      expect(ds.initialClipinIds.size).toBe(0)
      expect(ds.initialClipoutIds.size).toBe(0)
      expect(ds.initialSceneTimes.size).toBe(0)
    }
  })

  it('ctrl/cmd-click in an empty area arms an additive lasso seeded with current selection', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      selectedOrigAnchorIds: new Set([1, 2]),
      selectedBeatAnchorIds: new Set([2]),
      selectedClipinIds: new Set(['c1']),
      selectedClipoutIds: new Set(['c1']),
      selectedSceneTimes: new Set([3.5]),
    })
    const warp = snap.tracks.find(t => t.id === 'warp')!
    const cy = warp.y + warp.h / 2
    const intents = c.pointerDown(
      makePointerEvent({ clientX: 300, clientY: cy, ctrlKey: true }),
      snap,
    )
    expect(intents).toEqual([])
    const ds = c.getDragState()
    expect(ds?.kind).toBe('lasso')
    if (ds?.kind === 'lasso') {
      expect(ds.additive).toBe(true)
      expect(ds.initialOrigAnchorIds).toEqual(new Set([1, 2]))
      expect(ds.initialBeatAnchorIds).toEqual(new Set([2]))
      expect(ds.initialClipinIds).toEqual(new Set(['c1']))
      expect(ds.initialClipoutIds).toEqual(new Set(['c1']))
      expect(ds.initialSceneTimes).toEqual(new Set([3.5]))
    }
  })

  it('translates client coords through canvasRect.left/top', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      hits: [pointHit(50, 200, { kind: 'anchor', id: 1, space: 'input' })],
      anchors: [{ id: 1, time: 0 }],
    })
    // canvasRect offset by (10, 5); clientX=60, clientY=205 → canvas (50, 200)
    // pointerDown should arm an anchor drag for id=1 (no select intent — that
    // fires on pointerUp click). The hit-test reads canvas-relative coords.
    c.pointerDown(
      makePointerEvent({
        clientX: 60, clientY: 205,
        canvasRect: { left: 10, top: 5, width: CANVAS_W, height: CANVAS_H },
      }),
      snap,
    )
    const ds = c.getDragState()
    expect(ds?.kind).toBe('anchor')
    if (ds?.kind === 'anchor') expect(ds.id).toBe(1)
  })

  // ── Combined-selection drag capture ───────────────────────────────────────

  it('clicking a SELECTED anchor with regions selected captures regions for combined drag', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      anchors: [{ id: 1, time: 10 }, { id: 2, time: 50 }],
      selectedOrigAnchorIds: new Set([1, 2]),
      regions: [
        { id: 'r1', inPoint: 30, outPoint: 40 },
        { id: 'r2', inPoint: 60, outPoint: 70 },
      ],
      selectedClipinIds: new Set(['r1', 'r2']),
      hits: [pointHit(80, 200, { kind: 'anchor', id: 1, space: 'input' })],
    })
    // Drag a SELECTED anchor — no modifier — no anchorSelect should fire
    // (selection preserved) and the drag state captures all selected anchors
    // and regions.
    const intents = c.pointerDown(
      makePointerEvent({ clientX: 80, clientY: 200 }),
      snap,
    )
    expect(intents.find(i => i.kind === 'anchorSelect')).toBeUndefined()
    const ds = c.getDragState()
    expect(ds?.kind).toBe('anchor')
    if (ds?.kind === 'anchor') {
      expect(ds.groupIds?.size).toBe(2)
      expect(ds.capturedSpaces.input).toBe(true)
      expect(ds.regionGroupIds?.size).toBe(2)
      expect(ds.origRegionBounds?.get('r1')).toEqual({ inPoint: 30, outPoint: 40 })
      expect(ds.origRegionBounds?.get('r2')).toEqual({ inPoint: 60, outPoint: 70 })
    }
  })

  it('clicking an UNSELECTED anchor (no modifier) defers replace-select to pointerUp and captures only that id', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      anchors: [{ id: 1, time: 10 }, { id: 2, time: 50 }],
      selectedOrigAnchorIds: new Set([1]),
      regions: [{ id: 'r1', inPoint: 30, outPoint: 40 }],
      selectedClipinIds: new Set(['r1']),
      // Hit is on anchor id=2 (not in selection).
      hits: [pointHit(400, 200, { kind: 'anchor', id: 2, space: 'input' })],
    })
    const intents = c.pointerDown(
      makePointerEvent({ clientX: 400, clientY: 200 }),
      snap,
    )
    // pointerDown emits NO selection intent.
    expect(intents.find(i => i.kind === 'anchorSelect')).toBeUndefined()
    const ds = c.getDragState()
    expect(ds?.kind).toBe('anchor')
    if (ds?.kind === 'anchor') {
      // Only id=2 captured — the prior selection (anchor 1, region r1) is
      // NOT pulled into this drag. The new contract: dragging an unselected
      // object is a single-object drag; only that object moves and the
      // existing selection stays unchanged.
      expect(ds.groupIds?.size).toBe(1)
      expect(ds.groupIds?.has(2)).toBe(true)
      expect(ds.regionGroupIds).toBeUndefined()
      // Pending select (additive=false) fires on pointerUp click.
      expect(ds.pendingSelect).toEqual([{ kind: 'anchorSelect', id: 2, additive: false }])
    }
  })

  it('shift-clicking an unselected anchor defers additive-select to pointerUp and does NOT capture old selection', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      anchors: [{ id: 1, time: 10 }, { id: 2, time: 50 }],
      selectedOrigAnchorIds: new Set([1]),
      hits: [pointHit(400, 200, { kind: 'anchor', id: 2, space: 'input' })],
    })
    const intents = c.pointerDown(
      makePointerEvent({ clientX: 400, clientY: 200, shiftKey: true }),
      snap,
    )
    expect(intents.find(i => i.kind === 'anchorSelect')).toBeUndefined()
    const ds = c.getDragState()
    if (ds?.kind === 'anchor') {
      expect(ds.groupIds?.has(2)).toBe(true)
      expect(ds.groupIds?.has(1)).toBe(false)
      // Pending additive select; fires on pointerUp click.
      expect(ds.pendingSelect).toEqual([{ kind: 'anchorSelect', id: 2, additive: true }])
    }
  })

  it('clicking a warp-line defers both anchorSelect and beatAnchorSelect to pointerUp and arms a pair-capture anchor drag', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      anchors: [{ id: 5, time: 10 }],
      beatAnchors: [{ id: 5, time: 20 }],
      // Warp line hit registered at x=100.
      hits: [pointHit(100, 200, { kind: 'warp-line', id: 5 })],
    })
    const intents = c.pointerDown(
      makePointerEvent({ clientX: 100, clientY: 200 }),
      snap,
    )
    // pointerDown emits NO selection intents.
    expect(intents.find(i => i.kind === 'anchorSelect')).toBeUndefined()
    expect(intents.find(i => i.kind === 'beatAnchorSelect')).toBeUndefined()

    const ds = c.getDragState()
    expect(ds?.kind).toBe('anchor')
    if (ds?.kind === 'anchor') {
      // BOTH partners captured — both spaces participate as a pair drag,
      // and the pointerMove branch routes to the cursor-pixel-delta path
      // (input-space targets + output-space grid compete for the closest
      // hit, winning delta applied to both partners).
      expect(ds.capturedSpaces).toEqual({ input: true, beat: true })
      expect(ds.partnerOrigTime).toBe(20)
      expect(ds.origTime).toBe(10)
      expect(ds.isPair).toBe(true)
      // Both pair-select intents queued for pointerUp click.
      expect(ds.pendingSelect.length).toBe(2)
      expect(ds.pendingSelect.find(s => s.kind === 'anchorSelect')).toEqual(
        { kind: 'anchorSelect', id: 5, additive: false },
      )
      expect(ds.pendingSelect.find(s => s.kind === 'beatAnchorSelect')).toEqual(
        { kind: 'beatAnchorSelect', id: 5, additive: false },
      )
    }
  })

  it('clicking a warp-line for an id without a beat partner does not arm any drag', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      anchors: [{ id: 42, time: 50 }],
      // No beat anchor with id 42.
      hits: [pointHit(100, 200, { kind: 'warp-line', id: 42 })],
    })
    const intents = c.pointerDown(
      makePointerEvent({ clientX: 100, clientY: 200 }),
      snap,
    )
    // Defensive scenario: hit falls through. No anchor drag, no select.
    expect(intents.find(i => i.kind === 'anchorSelect')).toBeUndefined()
    expect(intents.find(i => i.kind === 'beatAnchorSelect')).toBeUndefined()
    const ds = c.getDragState()
    expect(ds?.kind).not.toBe('anchor')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// cancel
// ───────────────────────────────────────────────────────────────────────────

describe('controller.cancel', () => {
  it('with no drag state returns just pubClearGesture', () => {
    const c = createTimelineController()
    expect(c.cancel()).toEqual([{ kind: 'pubClearGesture' }])
    expect(c.getDragState()).toBeNull()
  })

  it('clears active drag state without emitting any commits', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      anchors: [{ id: 1, time: 1 }],
      hits: [pointHit(50, 200, { kind: 'anchor', id: 1, space: 'input' })],
    })
    c.pointerDown(makePointerEvent({ clientX: 50, clientY: 200 }), snap)
    expect(c.getDragState()?.kind).toBe('anchor')
    const out = c.cancel()
    expect(out).toEqual([{ kind: 'pubClearGesture' }, { kind: 'dragCancel' }])
    expect(c.getDragState()).toBeNull()
  })
})

// ───────────────────────────────────────────────────────────────────────────
// pointerUp — commits + state cleanup
// ───────────────────────────────────────────────────────────────────────────

describe('controller.pointerUp', () => {
  it('anchor (input) drag: emits drag lifecycle (profile path) then clears state', () => {
    // Clean single-anchor drag → ANCHOR_DRAG profile. pointerUp emits
    // endDrag. ANCHOR_DRAG.onDrag dispatches the Move op via the drag
    // intent during pointerMove. No legacy anchorEntityMove or whole-array
    // anchorsChanged.
    const c = createTimelineController()
    const snap = makeSnapshot({
      anchors: [{ id: 1, time: 0 }],
      hits: [pointHit(0, 200, { kind: 'anchor', id: 1, space: 'input' })],
    })
    const down = c.pointerDown(makePointerEvent({ clientX: 0, clientY: 200 }), snap)
    expect(down.some(i => i.kind === 'beginDrag')).toBe(true)
    const move = c.pointerMove(makePointerEvent({ clientX: 400, clientY: 200 }), snap)
    expect(move.some(i => i.kind === 'drag')).toBe(true)
    const intents = c.pointerUp(snap)
    expect(intents.some(i => i.kind === 'endDrag')).toBe(true)
    expect(intents.some(i => i.kind === 'anchorEntityMove')).toBe(false)
    expect(intents.some(i => i.kind === 'anchorsChanged')).toBe(false)
    expect(intents.some(i => i.kind === 'pubClearGesture')).toBe(true)
    expect(intents.some(i => i.kind === 'cursor')).toBe(true)
    expect(intents.some(i => i.kind === 'redraw')).toBe(true)
    expect(c.getDragState()).toBeNull()
  })

  it('anchor (input) drag never moves the same-id beat partner, even when linkedBeatIds includes the id', () => {
    // Profile-driven single-anchor drag — only the primary anchor's entity
    // is targeted by the Move op inside ANCHOR_DRAG.onDrag. The beat
    // partner is unaffected at the controller level; the resolver's
    // DirectedPair handles linked propagation downstream.
    const c = createTimelineController()
    const snap = makeSnapshot({
      anchors: [{ id: 1, time: 10 }],
      beatAnchors: [{ id: 1, time: 5 }],
      linkedBeatIds: new Set([1]),
      hits: [pointHit(80, 200, { kind: 'anchor', id: 1, space: 'input' })],
    })
    c.pointerDown(makePointerEvent({ clientX: 80, clientY: 200 }), snap)
    c.pointerMove(makePointerEvent({ clientX: 400, clientY: 200 }), snap)
    const intents = c.pointerUp(snap)
    expect(intents.some(i => i.kind === 'endDrag')).toBe(true)
    expect(intents.some(i => i.kind === 'anchorEntityMove')).toBe(false)
    expect(intents.some(i => i.kind === 'anchorsChanged')).toBe(false)
    expect(intents.some(i => i.kind === 'beatAnchorsChanged')).toBe(false)
  })

  it('anchor (output) drag never moves the same-id input partner, even when linkedBeatIds includes the id', () => {
    // Profile-driven beat-anchor drag — onDrag's Move op targets only a7-out.
    const c = createTimelineController()
    const snap = makeSnapshot({
      anchors: [{ id: 7, time: 8 }],
      beatAnchors: [{ id: 7, time: 12 }],
      linkedBeatIds: new Set([7]),
      hits: [pointHit(96, 200, { kind: 'anchor', id: 7, space: 'output' })],
    })
    c.pointerDown(makePointerEvent({ clientX: 96, clientY: 200 }), snap)
    c.pointerMove(makePointerEvent({ clientX: 400, clientY: 200 }), snap)
    const intents = c.pointerUp(snap)
    expect(intents.some(i => i.kind === 'endDrag')).toBe(true)
    expect(intents.some(i => i.kind === 'anchorEntityMove')).toBe(false)
    expect(intents.some(i => i.kind === 'anchorsChanged')).toBe(false)
    expect(intents.some(i => i.kind === 'beatAnchorsChanged')).toBe(false)
  })

  it('warp-line drag uses profile lifecycle (beginDrag/drag/endDrag) — no anchorEntityMove', () => {
    // Pair drag is profile-driven: pointerDown emits beginDrag(pair-drag),
    // pointerMove emits drag({ delta }), pointerUp emits endDrag. The
    // PAIR_DRAG profile's onDrag dispatches a Move on the orig; the
    // gesture-scoped TranslateGroup carries beat. No legacy
    // anchorEntityMove or whole-array intents.
    const c = createTimelineController()
    const tracks = buildLayout(false, CANVAS_H)
    const warp = tracks.find(t => t.id === 'warp')!
    const warpY = warp.y + warp.h / 2
    const snap = makeSnapshot({
      anchors: [{ id: 1, time: 10 }],
      beatAnchors: [{ id: 1, time: 5 }],
      hits: [pointHit(80, warpY, { kind: 'warp-line', id: 1 })],
    })
    const down = c.pointerDown(makePointerEvent({ clientX: 80, clientY: warpY }), snap)
    expect(down.some(i => i.kind === 'beginDrag')).toBe(true)
    const move = c.pointerMove(makePointerEvent({ clientX: 400, clientY: warpY }), snap)
    expect(move.some(i => i.kind === 'drag')).toBe(true)
    const up = c.pointerUp(snap)
    expect(up.some(i => i.kind === 'endDrag')).toBe(true)
    const all = [...down, ...move, ...up]
    expect(all.some(i => i.kind === 'anchorEntityMove')).toBe(false)
    expect(all.some(i => i.kind === 'anchorsChanged')).toBe(false)
    expect(all.some(i => i.kind === 'beatAnchorsChanged')).toBe(false)
  })

  it('warp-line drag is inert when the id has no partner in one of the spaces', () => {
    const c = createTimelineController()
    const tracks = buildLayout(false, CANVAS_H)
    const warp = tracks.find(t => t.id === 'warp')!
    const warpY = warp.y + warp.h / 2
    // Input anchor exists but no beat partner with id=42.
    const snap = makeSnapshot({
      anchors: [{ id: 42, time: 50 }],
      beatAnchors: [],
      hits: [pointHit(400, warpY, { kind: 'warp-line', id: 42 })],
    })
    c.pointerDown(makePointerEvent({ clientX: 400, clientY: warpY }), snap)
    c.pointerMove(makePointerEvent({ clientX: 600, clientY: warpY }), snap)
    const intents = c.pointerUp(snap)
    expect(intents.some(i => i.kind === 'anchorsChanged')).toBe(false)
    expect(intents.some(i => i.kind === 'beatAnchorsChanged')).toBe(false)
  })

  it('unpaired input anchor drag drives ANCHOR_DRAG profile (no beat partner emitted)', () => {
    // Anchor id 1 has no beat-space partner. Clean single-anchor drag →
    // profile path. Only `drag` / `endDrag` lifecycle; ANCHOR_DRAG's
    // onDrag targets only a1-in.
    const c = createTimelineController()
    const snap = makeSnapshot({
      anchors: [{ id: 1, time: 0 }],
      beatAnchors: [{ id: 99, time: 50 }],
      hits: [pointHit(0, 200, { kind: 'anchor', id: 1, space: 'input' })],
    })
    c.pointerDown(makePointerEvent({ clientX: 0, clientY: 200 }), snap)
    c.pointerMove(makePointerEvent({ clientX: 400, clientY: 200 }), snap)
    const intents = c.pointerUp(snap)
    expect(intents.some(i => i.kind === 'endDrag')).toBe(true)
    expect(intents.some(i => i.kind === 'anchorEntityMove')).toBe(false)
    expect(intents.some(i => i.kind === 'anchorsChanged')).toBe(false)
    expect(intents.some(i => i.kind === 'beatAnchorsChanged')).toBe(false)
  })

  it('anchor (output) drag drives ANCHOR_DRAG profile (beat-space)', () => {
    // Clean single beat-anchor drag → profile path.
    const c = createTimelineController()
    const snap = makeSnapshot({
      beatAnchors: [{ id: 9, time: 0 }],
      hits: [pointHit(0, 200, { kind: 'anchor', id: 9, space: 'output' })],
    })
    const down = c.pointerDown(makePointerEvent({ clientX: 0, clientY: 200 }), snap)
    expect(down.some(i =>
      i.kind === 'beginDrag' &&
      i.handle.kind === 'anchor-drag' &&
      i.handle.anchorId === 9 &&
      i.handle.space === 'beat',
    )).toBe(true)
    c.pointerMove(makePointerEvent({ clientX: 400, clientY: 200 }), snap)
    const intents = c.pointerUp(snap)
    expect(intents.some(i => i.kind === 'endDrag')).toBe(true)
    expect(intents.some(i => i.kind === 'anchorEntityMove')).toBe(false)
    expect(intents.some(i => i.kind === 'beatAnchorsChanged')).toBe(false)
    expect(c.getDragState()).toBeNull()
  })

  it('region-edge drag (clipin): emits drag lifecycle (profile path)', () => {
    // CLIP_EDGE_DRAG profile path for clipin edge drag (input space).
    // pointerUp emits a final drag intent with the cumulative delta plus
    // endDrag. origOut=30, new edge target=50 → delta=20.
    const c = createTimelineController()
    const snap = makeSnapshot({
      regions: [{ id: 'r1', inPoint: 10, outPoint: 30 }],
      hits: [pointHit(240, 200, { kind: 'region-edge', id: 'r1', edge: 'out', isOutput: false })],
    })
    c.pointerDown(makePointerEvent({ clientX: 240, clientY: 200 }), snap)
    c.pointerMove(makePointerEvent({ clientX: 400, clientY: 200 }), snap)
    const intents = c.pointerUp(snap)
    const dragFinal = intents.find(i => i.kind === 'drag') as Extract<Intent, { kind: 'drag' }> | undefined
    expect(dragFinal).toBeDefined()
    expect(dragFinal!.delta).toBeCloseTo(20)
    expect(intents.some(i => i.kind === 'endDrag')).toBe(true)
    expect(intents.some(i => i.kind === 'regionResize')).toBe(false)
    expect(c.getDragState()).toBeNull()
  })

  it('region-move drag: emits drag lifecycle (profile path)', () => {
    // CLIP_BODY_DRAG profile path: pointerUp emits a final drag with the
    // cumulative delta (so beginReplayFrame's reset is followed by the
    // final state) plus endDrag.
    const c = createTimelineController()
    const snap = makeSnapshot({
      regions: [{ id: 'r1', inPoint: 10, outPoint: 30 }],
      hits: [pointHit(160, 200, { kind: 'region', id: 'r1', isOutput: false })],
    })
    c.pointerDown(makePointerEvent({ clientX: 160, clientY: 200 }), snap)
    // clientX 160→400 = +240px in 800px canvas over 100s view = +30s delta.
    c.pointerMove(makePointerEvent({ clientX: 400, clientY: 200 }), snap)
    const intents = c.pointerUp(snap)
    const dragFinal = intents.find(i => i.kind === 'drag') as Extract<Intent, { kind: 'drag' }> | undefined
    expect(dragFinal).toBeDefined()
    expect(dragFinal!.delta).toBeCloseTo(30)
    expect(intents.some(i => i.kind === 'endDrag')).toBe(true)
    expect(intents.some(i => i.kind === 'regionEntityMove')).toBe(false)
  })

  it('lasso (active) drag: emits clip/scene/connector selection changes', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      anchors: [{ id: 7, time: 50 }],
      regions: [{ id: 'a', inPoint: 30, outPoint: 60 }],
      scenes: [50],
    })
    // Drag spans markerin + clipin + scenes via large vertical range
    const scenes = snap.tracks.find(t => t.id === 'scenes')!
    const clipin = snap.tracks.find(t => t.id === 'clipin')!
    const markerin = snap.tracks.find(t => t.id === 'markerin')!
    const startY = scenes.y + 1
    const endY = markerin.y + markerin.h - 1
    c.pointerDown(makePointerEvent({ clientX: 200, clientY: startY }), snap)
    // Activate + cover both rows
    c.pointerMove(makePointerEvent({ clientX: 600, clientY: endY }), snap)
    void clipin
    const intents = c.pointerUp(snap)
    const conn = intents.find(i => i.kind === 'connectorSelectionChange')!
    const clips = intents.find(i => i.kind === 'clipsSelectionChange')!
    const scs = intents.find(i => i.kind === 'scenesSelectionChange')!
    expect(conn).toBeDefined()
    expect(clips).toBeDefined()
    expect(scs).toBeDefined()
    if (conn.kind === 'connectorSelectionChange') expect(conn.origIds.has(7)).toBe(true)
    if (clips.kind === 'clipsSelectionChange') expect(clips.clipinIds.has('a')).toBe(true)
    if (scs.kind === 'scenesSelectionChange') expect(scs.times.has(50)).toBe(true)
    expect(c.getDragState()).toBeNull()
  })

  it('lasso click-without-drag (not additive): emits timelineDeselect + seek', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({ duration: 100, view: { start: 0, end: 100 } })
    const warp = snap.tracks.find(t => t.id === 'warp')!
    const cy = warp.y + warp.h / 2
    c.pointerDown(makePointerEvent({ clientX: 240, clientY: cy }), snap)
    // No pointerMove: lasso never activates
    const intents = c.pointerUp(snap)
    expect(intents.some(i => i.kind === 'timelineDeselect')).toBe(true)
    const seek = intents.find(i => i.kind === 'seek')!
    if (seek.kind === 'seek') expect(seek.time).toBeCloseTo(30)
    expect(c.getDragState()).toBeNull()
  })

  it('lasso click-without-drag (additive): no timelineDeselect, still seeks', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({ duration: 100, view: { start: 0, end: 100 } })
    const warp = snap.tracks.find(t => t.id === 'warp')!
    const cy = warp.y + warp.h / 2
    c.pointerDown(makePointerEvent({ clientX: 240, clientY: cy, ctrlKey: true }), snap)
    const intents = c.pointerUp(snap)
    expect(intents.some(i => i.kind === 'timelineDeselect')).toBe(false)
    expect(intents.some(i => i.kind === 'seek')).toBe(true)
  })

  it('seek/pan/minimap drags: no commit intents, just cleanup', () => {
    // seek
    {
      const c = createTimelineController()
      const snap = makeSnapshot()
      const tt = snap.tracks.find(t => t.id === 'time')!
      c.pointerDown(makePointerEvent({ clientX: 200, clientY: tt.y + tt.h / 2 }), snap)
      const intents = c.pointerUp(snap)
      const commits = intents.filter(i =>
        i.kind === 'anchorsChanged' || i.kind === 'beatAnchorsChanged' ||
        i.kind === 'regionResize' || i.kind === 'regionMove' ||
        i.kind === 'clipsSelectionChange' || i.kind === 'scenesSelectionChange' ||
        i.kind === 'connectorSelectionChange' || i.kind === 'seek' ||
        i.kind === 'timelineDeselect')
      expect(commits.length).toBe(0)
      expect(intents.some(i => i.kind === 'pubClearGesture')).toBe(true)
    }
    // pan
    {
      const c = createTimelineController()
      const snap = makeSnapshot()
      c.pointerDown(makePointerEvent({ clientX: 200, clientY: 200, altKey: true }), snap)
      const intents = c.pointerUp(snap)
      expect(intents.some(i => i.kind === 'anchorsChanged')).toBe(false)
      expect(intents.some(i => i.kind === 'pubClearGesture')).toBe(true)
    }
    // minimap
    {
      const c = createTimelineController()
      const snap = makeSnapshot()
      c.pointerDown(makePointerEvent({ clientX: 200, clientY: MINIMAP_H / 2 }), snap)
      const intents = c.pointerUp(snap)
      expect(intents.some(i => i.kind === 'anchorsChanged')).toBe(false)
      expect(intents.some(i => i.kind === 'pubClearGesture')).toBe(true)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// wheel
// ───────────────────────────────────────────────────────────────────────────

describe('controller.wheel', () => {
  it('ctrl+wheel zooms around cursor X', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({ view: { start: 0, end: 100 }, maxDuration: 200 })
    const intents = c.wheel(
      { ...makePointerEvent({ clientX: 400 }), ctrlKey: true, deltaX: 0, deltaY: -100 },
      snap,
    )
    expect(intents.length).toBe(1)
    const vc = intents[0]
    expect(vc.kind).toBe('viewChange')
    if (vc.kind === 'viewChange') {
      // Zooming in shrinks span; cursor centered at t=50 stays put
      const newSpan = vc.view.end - vc.view.start
      expect(newSpan).toBeLessThan(100)
      const cursorT = vc.view.start + (400 / CANVAS_W) * newSpan
      expect(cursorT).toBeCloseTo(50)
    }
  })

  it('plain wheel pans the view', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({ view: { start: 20, end: 40 }, maxDuration: 200 })
    const intents = c.wheel(
      { ...makePointerEvent({ clientX: 400, clientY: 100 }), deltaX: 80, deltaY: 0 },
      snap,
    )
    expect(intents.length).toBe(1)
    const vc = intents[0]
    if (vc.kind === 'viewChange') {
      // span=20, delta = 80/800*20 = 2 → view shifts right by 2
      expect(vc.view.start).toBeCloseTo(22)
      expect(vc.view.end).toBeCloseTo(42)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// doubleClick
// ───────────────────────────────────────────────────────────────────────────

describe('controller.doubleClick', () => {
  it('on input anchor: emits anchorDelete', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      anchors: [{ id: 5, time: 10 }],
      hits: [pointHit(100, 200, { kind: 'anchor', id: 5, space: 'input' })],
    })
    expect(c.doubleClick(makePointerEvent({ clientX: 100, clientY: 200 }), snap))
      .toEqual([{ kind: 'anchorDelete', id: 5 }])
  })

  it('on output anchor: emits beatAnchorDelete', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      beatAnchors: [{ id: 6, time: 12 }],
      hits: [pointHit(100, 200, { kind: 'anchor', id: 6, space: 'output' })],
    })
    expect(c.doubleClick(makePointerEvent({ clientX: 100, clientY: 200 }), snap))
      .toEqual([{ kind: 'beatAnchorDelete', id: 6 }])
  })

  it('on region: emits regionZoom', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      regions: [{ id: 'r9', inPoint: 0, outPoint: 10 }],
      hits: [pointHit(100, 200, { kind: 'region', id: 'r9', isOutput: false })],
    })
    expect(c.doubleClick(makePointerEvent({ clientX: 100, clientY: 200 }), snap))
      .toEqual([{ kind: 'regionZoom', id: 'r9' }])
  })

  it('on scene: emits sceneDelete', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      scenes: [22],
      hits: [pointHit(200, 50, { kind: 'scene', time: 22 })],
    })
    expect(c.doubleClick(makePointerEvent({ clientX: 200, clientY: 50 }), snap))
      .toEqual([{ kind: 'sceneDelete', time: 22 }])
  })

  it('on empty scenes track: emits sceneAdd', () => {
    const c = createTimelineController()
    const snap = makeSnapshot()
    const scenes = snap.tracks.find(t => t.id === 'scenes')!
    const cy = scenes.y + scenes.h / 2
    const intents = c.doubleClick(makePointerEvent({ clientX: 400, clientY: cy }), snap)
    expect(intents.length).toBe(1)
    expect(intents[0].kind).toBe('sceneAdd')
    if (intents[0].kind === 'sceneAdd') expect(intents[0].time).toBeCloseTo(50)
  })

  it('on empty clipin track: emits regionAdd', () => {
    const c = createTimelineController()
    const snap = makeSnapshot()
    const clipin = snap.tracks.find(t => t.id === 'clipin')!
    const cy = clipin.y + clipin.h / 2
    const intents = c.doubleClick(makePointerEvent({ clientX: 400, clientY: cy }), snap)
    expect(intents[0].kind).toBe('regionAdd')
  })

  it('on empty markerin track: emits anchorAdd', () => {
    const c = createTimelineController()
    const snap = makeSnapshot()
    const markerin = snap.tracks.find(t => t.id === 'markerin')!
    const cy = markerin.y + markerin.h / 2
    const intents = c.doubleClick(makePointerEvent({ clientX: 400, clientY: cy }), snap)
    expect(intents[0].kind).toBe('anchorAdd')
  })

  it('on time/warp/other rows: emits nothing', () => {
    const c = createTimelineController()
    const snap = makeSnapshot()
    const warp = snap.tracks.find(t => t.id === 'warp')!
    const cy = warp.y + warp.h / 2
    expect(c.doubleClick(makePointerEvent({ clientX: 400, clientY: cy }), snap)).toEqual([])
  })
})

// ───────────────────────────────────────────────────────────────────────────
// contextMenu
// ───────────────────────────────────────────────────────────────────────────

describe('controller.contextMenu', () => {
  it('on input anchor: emits anchorContextMenu with client coords', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      anchors: [{ id: 3, time: 12 }],
      hits: [pointHit(100, 200, { kind: 'anchor', id: 3, space: 'input' })],
    })
    const intents = c.contextMenu(
      makePointerEvent({ clientX: 100, clientY: 200 }),
      snap,
    )
    expect(intents).toEqual([{ kind: 'anchorContextMenu', id: 3, x: 100, y: 200 }])
  })

  it('on beat anchor: emits beatAnchorContextMenu (BUG FIX — was silently dropped)', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      beatAnchors: [{ id: 4, time: 8 }],
      hits: [pointHit(100, 200, { kind: 'anchor', id: 4, space: 'output' })],
    })
    const intents = c.contextMenu(
      makePointerEvent({ clientX: 100, clientY: 200 }),
      snap,
    )
    expect(intents).toEqual([{ kind: 'beatAnchorContextMenu', id: 4, x: 100, y: 200 }])
  })

  it('on region: emits regionContextMenu', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      regions: [{ id: 'r1', inPoint: 0, outPoint: 10 }],
      hits: [pointHit(100, 200, { kind: 'region', id: 'r1', isOutput: false })],
    })
    const intents = c.contextMenu(
      makePointerEvent({ clientX: 100, clientY: 200 }),
      snap,
    )
    expect(intents).toEqual([{ kind: 'regionContextMenu', id: 'r1', x: 100, y: 200 }])
  })

  it('on scene: emits sceneContextMenu', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      scenes: [33],
      hits: [pointHit(200, 50, { kind: 'scene', time: 33 })],
    })
    const intents = c.contextMenu(
      makePointerEvent({ clientX: 200, clientY: 50 }),
      snap,
    )
    expect(intents).toEqual([{ kind: 'sceneContextMenu', time: 33, x: 200, y: 50 }])
  })

  it('on empty area: emits timelineContextMenu with time', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({ view: { start: 0, end: 100 } })
    const intents = c.contextMenu(
      makePointerEvent({ clientX: 400, clientY: 200 }),
      snap,
    )
    expect(intents.length).toBe(1)
    expect(intents[0].kind).toBe('timelineContextMenu')
    if (intents[0].kind === 'timelineContextMenu') {
      expect(intents[0].time).toBeCloseTo(50)
      expect(intents[0].x).toBe(400)
      expect(intents[0].y).toBe(200)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// keyDown
// ───────────────────────────────────────────────────────────────────────────

describe('controller.keyDown', () => {
  function keyEvent(overrides: Partial<{ key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }>) {
    return {
      key: '',
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      ...overrides,
    }
  }

  it('Delete → timelineDelete', () => {
    const c = createTimelineController()
    expect(c.keyDown(keyEvent({ key: 'Delete' }))).toEqual([{ kind: 'timelineDelete' }])
  })

  it('Backspace → timelineDelete', () => {
    const c = createTimelineController()
    expect(c.keyDown(keyEvent({ key: 'Backspace' }))).toEqual([{ kind: 'timelineDelete' }])
  })

  it('Cmd+D → timelineDeselect', () => {
    const c = createTimelineController()
    expect(c.keyDown(keyEvent({ key: 'd', metaKey: true }))).toEqual([{ kind: 'timelineDeselect' }])
  })

  it('Ctrl+D → timelineDeselect', () => {
    const c = createTimelineController()
    expect(c.keyDown(keyEvent({ key: 'D', ctrlKey: true }))).toEqual([{ kind: 'timelineDeselect' }])
  })

  it('Cmd+Shift+D does nothing', () => {
    const c = createTimelineController()
    expect(c.keyDown(keyEvent({ key: 'd', metaKey: true, shiftKey: true }))).toEqual([])
  })

  it('Other keys do nothing', () => {
    const c = createTimelineController()
    expect(c.keyDown(keyEvent({ key: 'a' }))).toEqual([])
    expect(c.keyDown(keyEvent({ key: 'Enter' }))).toEqual([])
  })
})

// ───────────────────────────────────────────────────────────────────────────
// pointerMove — branch-by-branch
// ───────────────────────────────────────────────────────────────────────────

describe('controller.pointerMove — hover (no drag)', () => {
  it('emits hovered publishes + cursor "" when over empty area', () => {
    const c = createTimelineController()
    const snap = makeSnapshot()
    const intents = c.pointerMove(makePointerEvent({ clientX: 300, clientY: 200 }), snap)
    const kinds = intents.map(i => i.kind)
    expect(kinds).toContain('pubHoveredAnchor')
    expect(kinds).toContain('pubHoveredRegion')
    expect(kinds).toContain('pubHoveredScene')
    expect(kinds).toContain('cursor')
    const cur = intents.find(i => i.kind === 'cursor')!
    if (cur.kind === 'cursor') expect(cur.cursor).toBe('')
  })

  it('emits cursor "grab" + pubHoveredAnchor over an anchor hit', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      anchors: [{ id: 7, time: 12.5 }],
      hits: [pointHit(100, 200, { kind: 'anchor', id: 7, space: 'input' })],
    })
    const intents = c.pointerMove(makePointerEvent({ clientX: 100, clientY: 200 }), snap)
    const cur = intents.find(i => i.kind === 'cursor')!
    if (cur.kind === 'cursor') expect(cur.cursor).toBe('grab')
    const hov = intents.find(i => i.kind === 'pubHoveredAnchor')!
    if (hov.kind === 'pubHoveredAnchor') expect(hov.id).toBe(7)
  })

  it('emits cursor "ew-resize" over a region-edge hit', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      regions: [{ id: 'r1', inPoint: 10, outPoint: 30 }],
      hits: [pointHit(100, 200, { kind: 'region-edge', id: 'r1', edge: 'out', isOutput: false })],
    })
    const intents = c.pointerMove(makePointerEvent({ clientX: 100, clientY: 200 }), snap)
    const cur = intents.find(i => i.kind === 'cursor')!
    if (cur.kind === 'cursor') expect(cur.cursor).toBe('ew-resize')
    const hov = intents.find(i => i.kind === 'pubHoveredRegion')!
    if (hov.kind === 'pubHoveredRegion') expect(hov.id).toBe('r1')
  })

  it('emits cursor "pointer" + thumbnailHover payload over a scene hit', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      scenes: [25],
      hits: [pointHit(200, 50, { kind: 'scene', time: 25 })],
    })
    const intents = c.pointerMove(makePointerEvent({ clientX: 200, clientY: 50 }), snap)
    const cur = intents.find(i => i.kind === 'cursor')!
    if (cur.kind === 'cursor') expect(cur.cursor).toBe('pointer')
    const th = intents.find(i => i.kind === 'thumbnailHover')!
    if (th.kind === 'thumbnailHover') {
      expect(th.payload).not.toBeNull()
      expect(th.payload!.time).toBe(25)
    }
  })
})

describe('controller.pointerMove — seek drag', () => {
  it('seek (input) emits pubScrubTime + seek with clamped time', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({ view: { start: 0, end: 100 }, duration: 80 })
    const timeTrack = snap.tracks.find(t => t.id === 'time')!
    const cy = timeTrack.y + timeTrack.h / 2
    c.pointerDown(makePointerEvent({ clientX: 400, clientY: cy }), snap)
    // Drag past duration → clamped
    const intents = c.pointerMove(makePointerEvent({ clientX: 700, clientY: cy }), snap)
    const scrub = intents.find(i => i.kind === 'pubScrubTime')!
    if (scrub.kind === 'pubScrubTime') expect(scrub.time).toBe(80)
    const seek = intents.find(i => i.kind === 'seek')!
    if (seek.kind === 'seek') expect(seek.time).toBe(80)
  })

  it('seek (output) emits seekBeat with clamping to outputDuration', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({ view: { start: 0, end: 100 }, outputDuration: 40 })
    const beatTrack = snap.tracks.find(t => t.id === 'beat')!
    const cy = beatTrack.y + beatTrack.h / 2
    c.pointerDown(makePointerEvent({ clientX: 100, clientY: cy }), snap)
    const intents = c.pointerMove(makePointerEvent({ clientX: 800, clientY: cy }), snap)
    const beat = intents.find(i => i.kind === 'seekBeat')!
    if (beat.kind === 'seekBeat') expect(beat.time).toBe(40)
  })
})

describe('controller.pointerMove — pan drag', () => {
  it('emits viewChange shifted by pixel delta', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({ view: { start: 20, end: 40 }, maxDuration: 200, duration: 200 })
    c.pointerDown(makePointerEvent({ clientX: 200, clientY: 200, altKey: true }), snap)
    // Move 80px right → span=20 over W=800 → delta = 80/800*20 = 2 → view shifts LEFT (drag right pans content right)
    const intents = c.pointerMove(makePointerEvent({ clientX: 280, clientY: 200, altKey: true }), snap)
    const vc = intents.find(i => i.kind === 'viewChange')!
    if (vc.kind === 'viewChange') {
      expect(vc.view.start).toBeCloseTo(18)
      expect(vc.view.end).toBeCloseTo(38)
    }
  })
})

describe('controller.pointerMove — minimap drag', () => {
  it('emits viewChange recentered around cursor x', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({ view: { start: 40, end: 60 }, maxDuration: 200, duration: 200, outputDuration: 200 })
    c.pointerDown(makePointerEvent({ clientX: 200, clientY: MINIMAP_H / 2 }), snap)
    const intents = c.pointerMove(makePointerEvent({ clientX: 600, clientY: MINIMAP_H / 2 }), snap)
    const vc = intents.find(i => i.kind === 'viewChange')!
    // x=600 in canvas W=800; t = 600/800 * 200 = 150; span=20 → view {140,160}
    if (vc.kind === 'viewChange') {
      expect(vc.view.start).toBeCloseTo(140)
      expect(vc.view.end).toBeCloseTo(160)
    }
  })
})

describe('controller.pointerMove — anchor drag', () => {
  it('emits drag({ delta }) plus pubDragTime + pubSnapHints + redraw (input space, profile path)', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      anchors: [{ id: 1, time: 0 }],
      hits: [pointHit(0, 200, { kind: 'anchor', id: 1, space: 'input' })],
    })
    c.pointerDown(makePointerEvent({ clientX: 0, clientY: 200 }), snap)
    // Move to x=400 → raw time = 50; delta = 50 - 0 = 50
    const intents = c.pointerMove(makePointerEvent({ clientX: 400, clientY: 200 }), snap)
    const t = intents.find(i => i.kind === 'pubDragTime')!
    if (t.kind === 'pubDragTime') {
      expect(t.space).toBe('input')
      expect(t.time).toBeCloseTo(50)
    }
    expect(intents.some(i => i.kind === 'pubSnapHints')).toBe(true)
    expect(intents.some(i => i.kind === 'redraw')).toBe(true)
    const dragIntent = intents.find(i => i.kind === 'drag')!
    if (dragIntent.kind === 'drag') expect(dragIntent.delta).toBeCloseTo(50)
    expect(intents.some(i => i.kind === 'anchorEntityMove')).toBe(false)
  })

  it('publishes raw drag time (snap is handled by resolver, not controller)', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      // view 0..100, W=800 → 1 px = 0.125 s
      anchors: [{ id: 1, time: 0 }],
      scenes: [50.5],
      hits: [pointHit(0, 200, { kind: 'anchor', id: 1, space: 'input' })],
    })
    c.pointerDown(makePointerEvent({ clientX: 0, clientY: 200 }), snap)
    // Move to x=400 → raw=50; controller shows raw (resolver snaps on dispatch)
    const intents = c.pointerMove(makePointerEvent({ clientX: 400, clientY: 200 }), snap)
    const t = intents.find(i => i.kind === 'pubDragTime')!
    if (t.kind === 'pubDragTime') expect(t.time).toBeCloseTo(50)
    // pubSnapHints is published (empty without constraintGraph in snapshot)
    const hints = intents.find(i => i.kind === 'pubSnapHints')!
    expect(hints).toBeDefined()
  })

  it('output-space drag emits seekBeat when followDrag is on', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      beatAnchors: [{ id: 2, time: 0 }],
      hits: [pointHit(0, 200, { kind: 'anchor', id: 2, space: 'output' })],
      followDrag: true,
    })
    c.pointerDown(makePointerEvent({ clientX: 0, clientY: 200 }), snap)
    const intents = c.pointerMove(makePointerEvent({ clientX: 400, clientY: 200 }), snap)
    expect(intents.some(i => i.kind === 'seekBeat')).toBe(true)
    // Also publishes output-space pubDragTime
    const t = intents.find(i => i.kind === 'pubDragTime')!
    if (t.kind === 'pubDragTime') expect(t.space).toBe('output')
  })
})

describe('controller.pointerMove — region-edge drag', () => {
  it('emits drag intent on edge drag (input, edge=out) — profile path', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      regions: [{ id: 'r1', inPoint: 10, outPoint: 30 }],
      hits: [pointHit(240, 200, { kind: 'region-edge', id: 'r1', edge: 'out', isOutput: false })],
    })
    c.pointerDown(makePointerEvent({ clientX: 240, clientY: 200 }), snap)
    // Move to x=400 → raw=50; origOut=30 → delta=20
    const intents = c.pointerMove(makePointerEvent({ clientX: 400, clientY: 200 }), snap)
    const dragIntent = intents.find(i => i.kind === 'drag')
    expect(dragIntent).toBeDefined()
    if (dragIntent?.kind === 'drag') {
      expect(dragIntent.delta).toBeCloseTo(20)
    }
    expect(intents.some(i => i.kind === 'regionResize')).toBe(false)
  })

  it('publishes raw drag time for edge (snap is handled by resolver)', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      regions: [{ id: 'r1', inPoint: 0, outPoint: 30 }],
      anchors: [{ id: 1, time: 49.6 }],
      hits: [pointHit(240, 200, { kind: 'region-edge', id: 'r1', edge: 'out', isOutput: false })],
    })
    c.pointerDown(makePointerEvent({ clientX: 240, clientY: 200 }), snap)
    // Move to x=400 → raw=50; origOut=30 → delta=50
    const intents = c.pointerMove(makePointerEvent({ clientX: 400, clientY: 200 }), snap)
    const dragIntent = intents.find(i => i.kind === 'drag')
    expect(dragIntent).toBeDefined()
    if (dragIntent?.kind === 'drag') {
      expect(dragIntent.delta).toBeCloseTo(20)
    }
  })

  it('output region-edge emits regionResize with isOutput=true', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      regions: [{ id: 'r1', inPoint: 0, outPoint: 30 }],
      regionsOutput: [{ id: 'r1', inPoint: 0, outPoint: 30 }],
      hits: [pointHit(240, 200, { kind: 'region-edge', id: 'r1', edge: 'out', isOutput: true })],
    })
    c.pointerDown(makePointerEvent({ clientX: 240, clientY: 200 }), snap)
    const intents = c.pointerMove(makePointerEvent({ clientX: 400, clientY: 200 }), snap)
    const resize = intents.find(i => i.kind === 'regionResize')!
    if (resize.kind === 'regionResize') {
      expect(resize.id).toBe('r1')
      expect(resize.inPoint).toBe(0)
      expect(resize.outPoint).toBeCloseTo(50)
      expect(resize.isOutput).toBe(true)
    }
    const t = intents.find(i => i.kind === 'pubDragTime')!
    if (t.kind === 'pubDragTime') expect(t.space).toBe('output')
  })
})

describe('controller.pointerMove — region-move drag', () => {
  it('emits drag intent with delta preserving duration (profile path)', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      regions: [{ id: 'r1', inPoint: 10, outPoint: 30 }],
      hits: [pointHit(160, 200, { kind: 'region', id: 'r1', isOutput: false })],
    })
    // anchorX = 160 (= t=20 in view 0..100, W=800)
    c.pointerDown(makePointerEvent({ clientX: 160, clientY: 200 }), snap)
    // Drag to x=400 (t=50) → delta=30
    const intents = c.pointerMove(makePointerEvent({ clientX: 400, clientY: 200 }), snap)
    const dragIntent = intents.find(i => i.kind === 'drag')
    expect(dragIntent).toBeDefined()
    if (dragIntent?.kind === 'drag') {
      expect(dragIntent.delta).toBeCloseTo(30)
    }
    expect(intents.some(i => i.kind === 'regionEntityMove')).toBe(false)
  })

  it('publishes raw drag position (snap is handled by resolver)', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      regions: [{ id: 'r1', inPoint: 10, outPoint: 30 }],
      scenes: [40.4],
      hits: [pointHit(160, 200, { kind: 'region', id: 'r1', isOutput: false })],
    })
    c.pointerDown(makePointerEvent({ clientX: 160, clientY: 200 }), snap)
    // Move so rawIn=40; controller emits raw (resolver snaps on dispatch)
    const intents = c.pointerMove(makePointerEvent({ clientX: 400, clientY: 200 }), snap)
    const t = intents.find(i => i.kind === 'pubDragTime')!
    if (t.kind === 'pubDragTime') expect(t.time).toBeCloseTo(40)
  })
})

describe('controller.pointerMove — lasso drag', () => {
  it('below threshold returns [] (lasso not yet active)', () => {
    const c = createTimelineController()
    const snap = makeSnapshot()
    const warp = snap.tracks.find(t => t.id === 'warp')!
    const cy = warp.y + warp.h / 2
    c.pointerDown(makePointerEvent({ clientX: 300, clientY: cy }), snap)
    // Move only 2px → dx²+dy² < 16 → no activation
    const intents = c.pointerMove(makePointerEvent({ clientX: 302, clientY: cy }), snap)
    expect(intents).toEqual([])
    const ds = c.getDragState()
    if (ds?.kind === 'lasso') expect(ds.active).toBe(false)
  })

  it('crossing threshold activates lasso, selects covered anchors + emits pubLasso', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      // view 0..100, W=800 → x=200..600 is t=25..75
      anchors: [{ id: 7, time: 50 }, { id: 8, time: 90 }],
    })
    // markerin track row
    const markerin = snap.tracks.find(t => t.id === 'markerin')!
    const cy1 = markerin.y + markerin.h / 2
    c.pointerDown(makePointerEvent({ clientX: 200, clientY: cy1 }), snap)
    const intents = c.pointerMove(makePointerEvent({ clientX: 600, clientY: cy1 }), snap)
    const lassos = intents.filter(i => i.kind === 'pubLasso')
    const lasso = lassos[lassos.length - 1]!
    if (lasso.kind === 'pubLasso') {
      // Lasso started in markerin row → selects orig-space anchors.
      expect(lasso.origAnchorIds.has(7)).toBe(true)
      expect(lasso.origAnchorIds.has(8)).toBe(false)
    }
    const ds = c.getDragState()
    if (ds?.kind === 'lasso') {
      expect(ds.active).toBe(true)
      expect(ds.curX).toBe(600)
    } else {
      throw new Error('Expected lasso drag state')
    }
  })

  it('lasso over clipin track selects regions whose extents overlap', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      regions: [
        { id: 'a', inPoint: 30, outPoint: 60 },
        { id: 'b', inPoint: 80, outPoint: 90 },
      ],
    })
    const clipin = snap.tracks.find(t => t.id === 'clipin')!
    const cy = clipin.y + clipin.h / 2
    c.pointerDown(makePointerEvent({ clientX: 200, clientY: cy }), snap)
    const intents = c.pointerMove(makePointerEvent({ clientX: 600, clientY: cy }), snap)
    const lassos = intents.filter(i => i.kind === 'pubLasso')
    const lasso = lassos[lassos.length - 1]!
    if (lasso.kind === 'pubLasso') {
      // x=200..600 → t=25..75 — region 'a' (30..60) overlaps; 'b' (80..90) does not
      // lasso over clipin track → appears in clipinIds
      expect(lasso.clipinIds.has('a')).toBe(true)
      expect(lasso.clipinIds.has('b')).toBe(false)
    }
  })

  it('lasso over scenes selects covered scene times', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      scenes: [50, 90],
    })
    const scenes = snap.tracks.find(t => t.id === 'scenes')!
    const cy = scenes.y + scenes.h / 2
    c.pointerDown(makePointerEvent({ clientX: 200, clientY: cy }), snap)
    const intents = c.pointerMove(makePointerEvent({ clientX: 600, clientY: cy }), snap)
    const lassos = intents.filter(i => i.kind === 'pubLasso')
    const lasso = lassos[lassos.length - 1]!
    if (lasso.kind === 'pubLasso') {
      expect(lasso.sceneTimes.has(50)).toBe(true)
      expect(lasso.sceneTimes.has(90)).toBe(false)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// pubModifierKeys — §13 Shift modifier detection
// ───────────────────────────────────────────────────────────────────────────

describe('controller pubModifierKeys', () => {
  it('pointerMove during a region-move drag emits pubModifierKeys with shift=true', () => {
    const c = createTimelineController()
    // Place a region and its hit rect so pointerDown arms a region-move drag
    const snap = makeSnapshot({
      regions: [{ id: 'clip1', inPoint: 20, outPoint: 40 }],
      hits: [pointHit(400, 200, { kind: 'region', id: 'clip1', isOutput: false })],
    })
    c.pointerDown(makePointerEvent({ clientX: 400, clientY: 200 }), snap)
    // Confirm drag is active
    expect(c.getDragState()?.kind).toBe('region-move')

    const moveIntents = c.pointerMove(
      makePointerEvent({ clientX: 420, clientY: 200, shiftKey: true }),
      snap,
    )
    const mod = moveIntents.find(i => i.kind === 'pubModifierKeys')
    expect(mod).toBeDefined()
    if (mod?.kind === 'pubModifierKeys') {
      expect(mod.shift).toBe(true)
    }
  })

  it('pointerMove with no active drag does NOT emit pubModifierKeys', () => {
    const c = createTimelineController()
    const snap = makeSnapshot()
    // No pointerDown — no drag state
    const intents = c.pointerMove(
      makePointerEvent({ clientX: 400, clientY: 200, shiftKey: true }),
      snap,
    )
    const mod = intents.find(i => i.kind === 'pubModifierKeys')
    expect(mod).toBeUndefined()
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Clipout (output-space) region drag — Bug B regression guard
// ───────────────────────────────────────────────────────────────────────────

describe('controller — clipout (isOutput=true) region drag', () => {
  it('clicking a clipout region BODY (isOutput=true) arms a region-move drag using regionsOutput bounds', () => {
    // This test would FAIL before the Bug B fix: CanvasTimeline called
    // drawRegions(..., draggable=false) for the clipout track, so no
    // { kind: 'region', isOutput: true } hits were ever registered.
    // After the fix (draggable=true), the hit reaches the controller.
    // Here we inject the hit directly to verify the controller's handling.
    const c = createTimelineController()
    const snap = makeSnapshot({
      regions: [{ id: 'ro', inPoint: 0, outPoint: 60 }],
      regionsOutput: [{ id: 'ro', inPoint: 2, outPoint: 5 }],
      hits: [pointHit(200, 200, { kind: 'region', id: 'ro', isOutput: true })],
    })
    const intents = c.pointerDown(makePointerEvent({ clientX: 200, clientY: 200 }), snap)
    // pointerDown emits dragStart (selection is deferred to pointerUp click)
    expect(intents).toEqual([{ kind: 'dragStart' }])
    const ds = c.getDragState()
    expect(ds?.kind).toBe('region-move')
    if (ds?.kind === 'region-move') {
      expect(ds.id).toBe('ro')
      expect(ds.isOutput).toBe(true)
      // Uses regionsOutput bounds, not regions bounds
      expect(ds.origIn).toBe(2)
      expect(ds.origOut).toBe(5)
    }
  })

  it('clipout body drag: pointerMove + pointerUp commits a regionEntityMove with isOutput=true and correct delta', () => {
    // Phase 2.5: pointerUp emits single-entity regionEntityMove (with delta)
    // instead of the whole-per-region regionMove. isOutput=true marks output-space.
    const c = createTimelineController()
    const snap = makeSnapshot({
      view: { start: 0, end: 10 },
      outputDuration: 10,
      // Region with duration 2 so there's room to drag within outputDuration=10
      regions: [{ id: 'ro', inPoint: 0, outPoint: 2 }],
      regionsOutput: [{ id: 'ro', inPoint: 0, outPoint: 2 }],
      hits: [pointHit(0, 200, { kind: 'region', id: 'ro', isOutput: true })],
    })
    c.pointerDown(makePointerEvent({ clientX: 0, clientY: 200 }), snap)
    // Move 400px right in an 800px canvas over a 10s view → +5 s delta
    // newIn = Math.max(0, Math.min(10-2=8, 0+5)) = 5; newOut = 7
    c.pointerMove(makePointerEvent({ clientX: 400, clientY: 200 }), snap)
    const intents = c.pointerUp(snap)
    const commit = intents.find(i => i.kind === 'regionEntityMove' && i.id === 'ro')
    expect(commit).toBeDefined()
    if (commit?.kind === 'regionEntityMove') {
      expect(commit.id).toBe('ro')
      expect(commit.isOutput).toBe(true)
      expect(commit.delta).toBeCloseTo(5)
    }
    expect(intents.some(i => i.kind === 'regionMove')).toBe(false)
  })

  it('clicking a clipout region EDGE (isOutput=true) arms a region-edge drag', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      regions: [{ id: 're', inPoint: 0, outPoint: 99 }],
      regionsOutput: [{ id: 're', inPoint: 1.0, outPoint: 4.0 }],
      hits: [pointHit(150, 200, { kind: 'region-edge', id: 're', edge: 'out', isOutput: true })],
    })
    c.pointerDown(makePointerEvent({ clientX: 150, clientY: 200 }), snap)
    const ds = c.getDragState()
    expect(ds?.kind).toBe('region-edge')
    if (ds?.kind === 'region-edge') {
      expect(ds.id).toBe('re')
      expect(ds.isOutput).toBe(true)
      expect(ds.edge).toBe('out')
      // Uses regionsOutput bounds
      expect(ds.origIn).toBe(1.0)
      expect(ds.origOut).toBe(4.0)
    }
  })

  it('clipout body drag: dragState carries isOutput=true liveRegion (live preview)', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      view: { start: 0, end: 10 },
      outputDuration: 10,
      regions: [{ id: 'ro', inPoint: 0, outPoint: 2 }],
      regionsOutput: [{ id: 'ro', inPoint: 0, outPoint: 2 }],
      hits: [pointHit(0, 200, { kind: 'region', id: 'ro', isOutput: true })],
    })
    c.pointerDown(makePointerEvent({ clientX: 0, clientY: 200 }), snap)
    // Move 400px right in an 800px canvas over a 10s view → +5 s delta
    // newIn = clamp(0 + 5, 0, 10-2) = 5; newOut = 7
    const intents = c.pointerMove(makePointerEvent({ clientX: 400, clientY: 200 }), snap)
    const ds = c.getDragState()
    expect(ds?.kind).toBe('region-move')
    if (ds?.kind === 'region-move') expect(ds.isOutput).toBe(true)
    const move = intents.find(i => i.kind === 'regionEntityMove' && i.id === 'ro')!
    if (move.kind === 'regionEntityMove') {
      expect(move.isOutput).toBe(true)
      expect(move.delta).toBeCloseTo(5)
    }
  })

  it('clipout edge drag: emits regionResize with isOutput=true', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      view: { start: 0, end: 10 },
      outputDuration: 10,
      regions: [{ id: 're', inPoint: 0, outPoint: 99 }],
      regionsOutput: [{ id: 're', inPoint: 1.0, outPoint: 4.0 }],
      hits: [pointHit(320, 200, { kind: 'region-edge', id: 're', edge: 'out', isOutput: true })],
    })
    c.pointerDown(makePointerEvent({ clientX: 320, clientY: 200 }), snap)
    // Move to x=560 → t = 560/800 * 10 = 7.0 in a 10s view
    const intents = c.pointerMove(makePointerEvent({ clientX: 560, clientY: 200 }), snap)
    const resize = intents.find(i => i.kind === 'regionResize')!
    if (resize.kind === 'regionResize') {
      expect(resize.id).toBe('re')
      expect(resize.inPoint).toBe(1.0)
      expect(resize.outPoint).toBeCloseTo(7.0)
      expect(resize.isOutput).toBe(true)
    }
  })

  it('clipout drag does NOT emit input-space region commit (clipin stays put)', () => {
    // Verifies the detach invariant: during an output-space drag, no input-space
    // regionMove / regionResize is emitted — the clipin track stays at slice state.
    const c = createTimelineController()
    const snap = makeSnapshot({
      view: { start: 0, end: 10 },
      outputDuration: 10,
      regions: [{ id: 'ro', inPoint: 0, outPoint: 2 }],
      regionsOutput: [{ id: 'ro', inPoint: 0, outPoint: 2 }],
      hits: [pointHit(0, 200, { kind: 'region', id: 'ro', isOutput: true })],
    })
    c.pointerDown(makePointerEvent({ clientX: 0, clientY: 200 }), snap)
    const intents = c.pointerMove(makePointerEvent({ clientX: 400, clientY: 200 }), snap)
    // Only output-space commits should exist; no input-space regionMove with isOutput=false
    const inputMoves = intents.filter(i =>
      (i.kind === 'regionMove' || i.kind === 'regionResize') && !i.isOutput
    )
    expect(inputMoves).toHaveLength(0)
    // dragState is output-space
    const ds = c.getDragState()
    if (ds?.kind === 'region-move') expect(ds.isOutput).toBe(true)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// R4 (new design) — clipout edge drag: conformed-marker carry handled in thunk
// The controller no longer carries linked beat anchors itself. It simply
// emits regionResize; the commitClipoutResize thunk handles anchor movement.
// ───────────────────────────────────────────────────────────────────────────

describe('controller — R4 (new): clipout edge drag does NOT carry linked beat anchor in controller', () => {
  /**
   * Setup:
   *  - Region 'r1': inBeatTime = 0, outBeatTime = 20 (beat-space coords in regionsOutput)
   *  - Beat anchor id=5 at time=20 — exactly at the out-edge (output-linked).
   *  - Canvas: view 0..100, width=800 → 1s = 8px.
   *  - Drag the out-edge from t=20 (x=160) to t=25 (x=200).
   */
  function makeR4Snap() {
    return makeSnapshot({
      view: { start: 0, end: 100 },
      outputDuration: 100,
      regions: [{ id: 'r1', inPoint: 0, outPoint: 20 }],
      regionsOutput: [{ id: 'r1', inPoint: 0, outPoint: 20 }],
      anchors: [{ id: 5, time: 0 }],
      beatAnchors: [{ id: 5, time: 20 }],
      hits: [pointHit(160, 200, { kind: 'region-edge', id: 'r1', edge: 'out', isOutput: true })],
    })
  }

  it('pointerDown on output-linked out-edge does NOT capture linkedBeatAnchorId (removed)', () => {
    const c = createTimelineController()
    const snap = makeR4Snap()
    c.pointerDown(makePointerEvent({ clientX: 160, clientY: 200 }), snap)
    const ds = c.getDragState()
    expect(ds?.kind).toBe('region-edge')
    if (ds?.kind === 'region-edge') {
      // linkedBeatAnchorId no longer exists — conformed carry moved to thunk
      expect((ds as Record<string, unknown>).linkedBeatAnchorId).toBeUndefined()
      // Output-space edge drag captures beat-anchor pre-drag times for Slice-B rescale.
      expect(ds.origBeatAnchorTimes).toBeDefined()
    }
  })

  it('pointerUp emits regionResize but NOT a separate beatAnchorsChanged (carry in thunk)', () => {
    const c = createTimelineController()
    const snap = makeR4Snap()
    c.pointerDown(makePointerEvent({ clientX: 160, clientY: 200 }), snap)
    c.pointerMove(makePointerEvent({ clientX: 200, clientY: 200 }), snap)
    const intents = c.pointerUp(snap)

    // Region resize commit still fires
    const resizeIntent = intents.find(i => i.kind === 'regionResize')
    expect(resizeIntent).toBeDefined()
    if (resizeIntent?.kind === 'regionResize') {
      expect(resizeIntent.id).toBe('r1')
      expect(resizeIntent.isOutput).toBe(true)
      expect(resizeIntent.outPoint).toBeCloseTo(25)
    }

    // No beatAnchorsChanged from the controller — the thunk handles it
    expect(intents.some(i => i.kind === 'beatAnchorsChanged')).toBe(false)
  })

  it('non-linked clipout edge drag does NOT emit beatAnchorsChanged', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      view: { start: 0, end: 100 },
      outputDuration: 100,
      regions: [{ id: 'r1', inPoint: 0, outPoint: 20 }],
      regionsOutput: [{ id: 'r1', inPoint: 0, outPoint: 20 }],
      beatAnchors: [{ id: 7, time: 15 }],
      anchors: [],
      hits: [pointHit(160, 200, { kind: 'region-edge', id: 'r1', edge: 'out', isOutput: true })],
    })
    c.pointerDown(makePointerEvent({ clientX: 160, clientY: 200 }), snap)
    c.pointerMove(makePointerEvent({ clientX: 200, clientY: 200 }), snap)
    const intents = c.pointerUp(snap)
    expect(intents.some(i => i.kind === 'beatAnchorsChanged')).toBe(false)
  })

  it('input-space (non-output) edge drag does NOT have liveBeatAnchors', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      view: { start: 0, end: 100 },
      regions: [{ id: 'r1', inPoint: 0, outPoint: 20 }],
      beatAnchors: [{ id: 5, time: 20 }],
      anchors: [],
      hits: [pointHit(160, 200, { kind: 'region-edge', id: 'r1', edge: 'out', isOutput: false })],
    })
    c.pointerDown(makePointerEvent({ clientX: 160, clientY: 200 }), snap)
    const ds = c.getDragState()
    if (ds?.kind === 'region-edge') {
      // Input-space edge drag does not capture beat-anchor origs.
      expect(ds.origBeatAnchorTimes).toBeUndefined()
    }
    c.pointerMove(makePointerEvent({ clientX: 200, clientY: 200 }), snap)
    const intents = c.pointerUp(snap)
    expect(intents.some(i => i.kind === 'beatAnchorsChanged')).toBe(false)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Slice A — live BPM / lockedBeats preview during clipout edge drag
// ───────────────────────────────────────────────────────────────────────────

describe('controller — Slice A: live regionResize emitted during clipout edge drag', () => {
  // Live BPM / lockedBeats are now in the slice (via commitClipoutResize →
  // applyConformedClipout on every pointerMove). The controller's job is to
  // emit a regionResize intent with the correct live beat-space bounds so the
  // slice can update immediately.
  //
  // Canvas: view 0..100, width=800 → 1px = 100/800 = 0.125s
  // Region output: inPoint=0, outPoint=20 (beat-space, length=20)
  // Drag out-edge from x=160 (t=20) to x=200 (t=25)

  it('lock=bpm: pointerMove emits regionResize with isOutput=true + correct bounds', () => {
    // Downstream: applyConformedClipout with lock='bpm' → lockedBeats = 25*120/60 = 50
    const c = createTimelineController()
    const snap = makeSnapshot({
      view: { start: 0, end: 100 },
      outputDuration: 100,
      regions: [{ id: 'rA', inPoint: 0, outPoint: 20 }],
      regionsOutput: [{ id: 'rA', inPoint: 0, outPoint: 20 }],
      bpm: 120,
      clipLock: 'bpm',
      hits: [pointHit(160, 200, { kind: 'region-edge', id: 'rA', edge: 'out', isOutput: true })],
    })
    c.pointerDown(makePointerEvent({ clientX: 160, clientY: 200 }), snap)
    // Drag out-edge from t=20 to t=25 (x=200)
    const intents = c.pointerMove(makePointerEvent({ clientX: 200, clientY: 200 }), snap)
    const resize = intents.find(i => i.kind === 'regionResize' && i.isOutput)
    expect(resize).toBeDefined()
    if (resize?.kind === 'regionResize') {
      expect(resize.id).toBe('rA')
      expect(resize.isOutput).toBe(true)
      expect(resize.inPoint).toBeCloseTo(0)
      expect(resize.outPoint).toBeCloseTo(25)
    }
  })

  it('lock=beats: pointerMove emits regionResize with isOutput=true + correct bounds', () => {
    // Downstream: applyConformedClipout with lock='beats' → bpm = 60*40/25 = 96
    const c = createTimelineController()
    const snap = makeSnapshot({
      view: { start: 0, end: 100 },
      outputDuration: 100,
      regions: [{ id: 'rB', inPoint: 0, outPoint: 20 }],
      regionsOutput: [{ id: 'rB', inPoint: 0, outPoint: 20 }],
      bpm: 120,
      clipLock: 'beats',
      clipLockedBeats: 40,
      hits: [pointHit(160, 200, { kind: 'region-edge', id: 'rB', edge: 'out', isOutput: true })],
    })
    c.pointerDown(makePointerEvent({ clientX: 160, clientY: 200 }), snap)
    // Drag out-edge from t=20 to t=25 (x=200)
    const intents = c.pointerMove(makePointerEvent({ clientX: 200, clientY: 200 }), snap)
    const resize = intents.find(i => i.kind === 'regionResize' && i.isOutput)
    expect(resize).toBeDefined()
    if (resize?.kind === 'regionResize') {
      expect(resize.id).toBe('rB')
      expect(resize.isOutput).toBe(true)
      expect(resize.outPoint).toBeCloseTo(25)
    }
  })

  it('no clipLock in snapshot → regionResize still emitted (no lock-dependent derivation)', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      view: { start: 0, end: 100 },
      outputDuration: 100,
      regions: [{ id: 'rC', inPoint: 0, outPoint: 20 }],
      regionsOutput: [{ id: 'rC', inPoint: 0, outPoint: 20 }],
      bpm: 120,
      // clipLock intentionally absent
      hits: [pointHit(160, 200, { kind: 'region-edge', id: 'rC', edge: 'out', isOutput: true })],
    })
    c.pointerDown(makePointerEvent({ clientX: 160, clientY: 200 }), snap)
    const intents = c.pointerMove(makePointerEvent({ clientX: 200, clientY: 200 }), snap)
    // No BPM/beats gesture-store intents emitted (they've been removed)
    expect(intents.some(i => i.kind === 'pubLiveBpm' as string)).toBe(false)
    expect(intents.some(i => i.kind === 'pubLiveLockedBeats' as string)).toBe(false)
    // But output regionResize is still emitted so the slice stays live
    expect(intents.some(i => i.kind === 'regionResize' && i.isOutput)).toBe(true)
  })

  it('input-space (non-output) edge drag does NOT emit output regionResize', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      view: { start: 0, end: 100 },
      regions: [{ id: 'rD', inPoint: 0, outPoint: 20 }],
      bpm: 120,
      clipLock: 'bpm',
      hits: [pointHit(160, 200, { kind: 'region-edge', id: 'rD', edge: 'out', isOutput: false })],
    })
    c.pointerDown(makePointerEvent({ clientX: 160, clientY: 200 }), snap)
    const intents = c.pointerMove(makePointerEvent({ clientX: 200, clientY: 200 }), snap)
    // No output-space commit for input-space drag
    expect(intents.some(i => i.kind === 'regionResize' && i.isOutput)).toBe(false)
  })

  it('pointerUp clears via pubClearGesture (no separate clear intents needed)', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      view: { start: 0, end: 100 },
      outputDuration: 100,
      regions: [{ id: 'rE', inPoint: 0, outPoint: 20 }],
      regionsOutput: [{ id: 'rE', inPoint: 0, outPoint: 20 }],
      bpm: 120,
      clipLock: 'bpm',
      hits: [pointHit(160, 200, { kind: 'region-edge', id: 'rE', edge: 'out', isOutput: true })],
    })
    c.pointerDown(makePointerEvent({ clientX: 160, clientY: 200 }), snap)
    c.pointerMove(makePointerEvent({ clientX: 200, clientY: 200 }), snap)
    const upIntents = c.pointerUp(snap)
    expect(upIntents.some(i => i.kind === 'pubClearGesture')).toBe(true)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Slice B — live beat-anchor rescale/translate during clipout drags
// ───────────────────────────────────────────────────────────────────────────

describe('controller — Slice B: live beat-anchor rescale during clipout edge drag', () => {
  // Canvas: view 0..100, width=800 → 1px = 0.125s
  // Region output: origIn=0, origOut=20 (beat-space, length=20)
  // Two anchors at t=5 and t=15 (both inside [0,20])
  // Drag out-edge from x=160 (t=20) to x=200 (t=25) → newLength=25

  function makeSliceBEdgeSnap(clipAnchorLock: boolean, clipLock: 'bpm' | 'beats') {
    return makeSnapshot({
      view: { start: 0, end: 100 },
      outputDuration: 100,
      regions: [{ id: 'sB', inPoint: 0, outPoint: 20 }],
      regionsOutput: [{ id: 'sB', inPoint: 0, outPoint: 20 }],
      beatAnchors: [{ id: 10, time: 5 }, { id: 11, time: 15 }],
      bpm: 120,
      clipLock,
      clipAnchorLock,
      hits: [pointHit(160, 200, { kind: 'region-edge', id: 'sB', edge: 'out', isOutput: true })],
    })
  }

  it('anchorLock=true, lock=beats → emits beatAnchorsChanged with rescaled anchors', () => {
    // scaleFactor = 25/20 = 1.25
    // anchor 10: 0 + (5-0)*1.25 = 6.25
    // anchor 11: 0 + (15-0)*1.25 = 18.75
    const c = createTimelineController()
    const snap = makeSliceBEdgeSnap(true, 'beats')
    c.pointerDown(makePointerEvent({ clientX: 160, clientY: 200 }), snap)
    const intents = c.pointerMove(makePointerEvent({ clientX: 200, clientY: 200 }), snap)
    const beatChange = intents.find(i => i.kind === 'beatAnchorsChanged')!
    expect(beatChange).toBeDefined()
    if (beatChange.kind === 'beatAnchorsChanged') {
      const a10 = beatChange.next.find(a => a.id === 10)
      const a11 = beatChange.next.find(a => a.id === 11)
      expect(a10?.time).toBeCloseTo(6.25)
      expect(a11?.time).toBeCloseTo(18.75)
    }
  })

  it('anchorLock=false, lock=beats → no beatAnchorsChanged emitted (no Slice-B rescale)', () => {
    const c = createTimelineController()
    const snap = makeSliceBEdgeSnap(false, 'beats')
    c.pointerDown(makePointerEvent({ clientX: 160, clientY: 200 }), snap)
    const intents = c.pointerMove(makePointerEvent({ clientX: 200, clientY: 200 }), snap)
    expect(intents.some(i => i.kind === 'beatAnchorsChanged')).toBe(false)
  })

  it('anchorLock=true, lock=bpm → no beatAnchorsChanged (only beats-lock triggers Slice-B rescale)', () => {
    const c = createTimelineController()
    const snap = makeSliceBEdgeSnap(true, 'bpm')
    c.pointerDown(makePointerEvent({ clientX: 160, clientY: 200 }), snap)
    const intents = c.pointerMove(makePointerEvent({ clientX: 200, clientY: 200 }), snap)
    expect(intents.some(i => i.kind === 'beatAnchorsChanged')).toBe(false)
  })

  it('altKey XOR anchorLock=false flips effectiveAnchorLock to true → beatAnchorsChanged RESCALE', () => {
    const c = createTimelineController()
    const snap = makeSliceBEdgeSnap(false, 'beats')
    c.pointerDown(makePointerEvent({ clientX: 160, clientY: 200 }), snap)
    // altKey=true XOR anchorLock=false → effectiveAnchorLock=true → rescale
    const intents = c.pointerMove(makePointerEvent({ clientX: 200, clientY: 200, altKey: true }), snap)
    const beatChange = intents.find(i => i.kind === 'beatAnchorsChanged')!
    expect(beatChange).toBeDefined()
    if (beatChange.kind === 'beatAnchorsChanged') {
      const a10 = beatChange.next.find(a => a.id === 10)
      const a11 = beatChange.next.find(a => a.id === 11)
      expect(a10?.time).toBeCloseTo(6.25)
      expect(a11?.time).toBeCloseTo(18.75)
    }
  })

  it('anchor outside [origIn, origOut] is NOT rescaled', () => {
    // anchor at t=30 is outside [0, 20]
    const c = createTimelineController()
    const snap = makeSnapshot({
      view: { start: 0, end: 100 },
      outputDuration: 100,
      regions: [{ id: 'sBO', inPoint: 0, outPoint: 20 }],
      regionsOutput: [{ id: 'sBO', inPoint: 0, outPoint: 20 }],
      beatAnchors: [{ id: 20, time: 30 }],
      bpm: 120,
      clipLock: 'beats',
      clipAnchorLock: true,
      hits: [pointHit(160, 200, { kind: 'region-edge', id: 'sBO', edge: 'out', isOutput: true })],
    })
    c.pointerDown(makePointerEvent({ clientX: 160, clientY: 200 }), snap)
    const intents = c.pointerMove(makePointerEvent({ clientX: 200, clientY: 200 }), snap)
    // The lone anchor is outside region bounds → unchanged → no beatAnchorsChanged emitted.
    expect(intents.some(i => i.kind === 'beatAnchorsChanged')).toBe(false)
  })
})

// Slice B body-pan tests removed: they inspected the controller's deleted
// `liveBeatAnchors` mirror field. The controller no longer rescales beat
// anchors during a region-move drag (that's the commitClipoutPan thunk's
// responsibility — anchor translation flows through the slice). The behavior
// is still covered end-to-end by the slice/thunk tests.

// ───────────────────────────────────────────────────────────────────────────
// Slice C — live anchor commit during anchor drag (linking-event via slice)
// ───────────────────────────────────────────────────────────────────────────

describe('controller — Slice C: anchorsChanged emitted live during anchor drag', () => {
  // Linking events (lockedBeats updates) now happen in the slice via moveAnchors
  // thunk (called by the fixture's anchorsChanged handler). The controller's
  // responsibility is to emit anchorsChanged with the live anchor position on
  // every pointerMove after the move threshold is crossed.
  //
  // Canvas: view 0..100, width=800 → 1px = 0.125s
  // Region: inPoint=10, outPoint=20, bpm=120, lock='bpm' (active, has `active: true`)
  // Anchors: input anchor id=1 at t=5, beat anchor id=1 at beat=3
  // Drag input anchor from x=40 (t=5) to x=80 (t=10 = inPoint) → linking event via slice

  function makeSliceCInputSnap() {
    return makeSnapshot({
      view: { start: 0, end: 100 },
      anchors: [{ id: 1, time: 5 }],
      beatAnchors: [{ id: 1, time: 3 }],
      regions: [{ id: 'sc', inPoint: 10, outPoint: 20, active: true }],
      regionDetails: [
        {
          id: 'sc', name: 'sc',
          inPoint: 10, outPoint: 20,
          inBeatTime: 10, outBeatTime: 20, defaultLinked: true,
          bpm: 120,
          minStretch: 0.5, maxStretch: 2,
        },
      ],
      hits: [pointHit(40, 200, { kind: 'anchor', id: 1, space: 'input' })],
    })
  }

  it('input anchor dragged to coincide with region inPoint emits drag intent with live delta', () => {
    // ANCHOR_DRAG profile (clean single-anchor drag, not pre-conformed at
    // pointerDown). drag intent carries the cumulative delta; the resolver
    // applies the Move through ANCHOR_DRAG.onDrag at dispatch time.
    const c = createTimelineController()
    const snap = makeSliceCInputSnap()
    c.pointerDown(makePointerEvent({ clientX: 40, clientY: 200 }), snap)
    // Move to x=80 → t=10; delta = 10 - 5 = 5
    const intents = c.pointerMove(makePointerEvent({ clientX: 80, clientY: 200 }), snap)
    const dragIntent = intents.find(i => i.kind === 'drag')
    expect(dragIntent).toBeDefined()
    if (dragIntent?.kind === 'drag') {
      expect(dragIntent.delta).toBeCloseTo(5)
    }
    expect(intents.some(i => i.kind === 'anchorEntityMove')).toBe(false)
  })

  it('input anchor NOT coincident with region boundary → drag intent still emitted with live delta', () => {
    const c = createTimelineController()
    const snap = makeSliceCInputSnap()
    c.pointerDown(makePointerEvent({ clientX: 40, clientY: 200 }), snap)
    // Move to x=200 → t=25; delta = 25 - 5 = 20
    const intents = c.pointerMove(makePointerEvent({ clientX: 200, clientY: 200 }), snap)
    const dragIntent = intents.find(i => i.kind === 'drag')
    expect(dragIntent).toBeDefined()
    if (dragIntent?.kind === 'drag') {
      expect(dragIntent.delta).toBeCloseTo(20)
    }
    expect(intents.some(i => i.kind === 'anchorEntityMove')).toBe(false)
  })

  it('input anchor dragged to coincide with region outPoint emits drag intent with live delta', () => {
    const c = createTimelineController()
    const snap = makeSnapshot({
      view: { start: 0, end: 100 },
      anchors: [{ id: 2, time: 5 }],
      beatAnchors: [{ id: 2, time: 25 }],
      regions: [{ id: 'sc2', inPoint: 10, outPoint: 20, active: true }],
      regionDetails: [
        {
          id: 'sc2', name: 'sc2',
          inPoint: 10, outPoint: 20,
          inBeatTime: 10, outBeatTime: 20, defaultLinked: true,
          bpm: 120,
          minStretch: 0.5, maxStretch: 2,
        },
      ],
      hits: [pointHit(40, 200, { kind: 'anchor', id: 2, space: 'input' })],
    })
    c.pointerDown(makePointerEvent({ clientX: 40, clientY: 200 }), snap)
    // Move to x=160 → t=20; delta = 20 - 5 = 15
    const intents = c.pointerMove(makePointerEvent({ clientX: 160, clientY: 200 }), snap)
    const dragIntent = intents.find(i => i.kind === 'drag')
    expect(dragIntent).toBeDefined()
    if (dragIntent?.kind === 'drag') {
      expect(dragIntent.delta).toBeCloseTo(15)
    }
  })

  it('output anchor dragged to coincide with inBeatTime emits drag intent with live delta', () => {
    // Profile-driven beat-anchor drag (clean single-anchor).
    const c = createTimelineController()
    const snap = makeSnapshot({
      view: { start: 0, end: 20 },
      anchors: [],
      beatAnchors: [{ id: 3, time: 10 }],
      regions: [{ id: 'sc3', inPoint: 0, outPoint: 10, active: true }],
      regionDetails: [
        {
          id: 'sc3', name: 'sc3',
          inPoint: 0, outPoint: 10,
          inBeatTime: 5, outBeatTime: 15, defaultLinked: false,
          bpm: 120,
          minStretch: 0.5, maxStretch: 2,
        },
      ],
      // Beat anchor at beat=10 → pixel = (10/20)*800 = 400
      hits: [pointHit(400, 200, { kind: 'anchor', id: 3, space: 'output' })],
    })
    c.pointerDown(makePointerEvent({ clientX: 400, clientY: 200 }), snap)
    // Move to beat=5 → pixel = (5/20)*800 = 200; delta = 5 - 10 = -5
    const intents = c.pointerMove(makePointerEvent({ clientX: 200, clientY: 200 }), snap)
    const dragIntent = intents.find(i => i.kind === 'drag')
    expect(dragIntent).toBeDefined()
    if (dragIntent?.kind === 'drag') {
      expect(dragIntent.delta).toBeCloseTo(-5)
    }
  })
})
