/**
 * Regression: dragging a clipin edge ONTO a diverged anchor commits the
 * conform (clipout edge writes to the paired beat time, region diverges).
 * After release, nudging the clipin edge slightly past that anchor must
 * NOT yank the beat anchor — it must stay at its diverged beat time.
 *
 * Setup:
 *   - Clip default-linked [10, 20]
 *   - Anchor pair (orig=25, beat=30) — diverged
 *
 * Actions:
 *   1. Drag clipin out-edge from 20 to 25 (lands on orig anchor). Conform
 *      writes clipout.out = 30 (the beat anchor's time).
 *   2. Release the drag.
 *   3. Nudge clipin out-edge by less than the snap radius (e.g. +0.3),
 *      so it's at 25.3 — no longer coincident with orig=25.
 *
 * Expected: beat anchor stays at 30 throughout. The bug version yanks
 * the beat anchor to follow the clipin out-edge.
 */

import { describe, it, expect } from 'vitest'
import { makeStore } from '../../helpers/setup'
import { addRegion, setActiveRegionId } from '../../../src/store/slices/regionSlice'
import { addAnchor, moveBeatAnchor } from '../../../src/store/slices/warpSlice'
import { moveRegionBounds } from '../../../src/store/thunks/regionThunks'
import { beginDrag, drag, endDrag } from '../../../src/store/thunks/dragThunks'
import type { Region } from '../../../src/types'

function setup(): ReturnType<typeof makeStore> {
  const store = makeStore()
  const region: Region = {
    id: 'r', name: 'r',
    inPoint: 10, outPoint: 20,
    inBeatTime: 10, outBeatTime: 20, defaultLinked: true,
    bpm: 120, lockedBeats: 20,
    minStretch: 0.5, maxStretch: 2.0,
  }
  store.dispatch(addRegion(region))
  store.dispatch(setActiveRegionId('r'))
  // Diverged anchor: orig=25, beat=30.
  store.dispatch(addAnchor({ id: 1, time: 25 }))
  store.dispatch(moveBeatAnchor({ id: 1, time: 30 }))
  return store
}

describe('Conform via clipin edge drag onto diverged anchor, then nudge past — beat anchor stays put', () => {
  it('drag clipin out-edge to anchor (25), release, nudge to 25.3: beat anchor still 30', () => {
    const store = setup()

    // ── Step 1: drag clipin out-edge from 20 to 25 (lands on orig anchor).
    store.dispatch(beginDrag({
      handle: { kind: 'clip-out-edge', clipId: 'r', space: 'input' },
      pxPerUnit: 16,
    }))
    store.dispatch(drag({ delta: 5, modifiers: { alt: false } })) // clipin.out: 20 → 25

    {
      const s = store.getState()
      const r = s.region.regions[0]
      // Clipin out-edge at 25 (on anchor's orig).
      expect(r.outPoint, 'after drag: clipin.out at 25').toBeCloseTo(25, 6)
      // Conform fired: clipout.out written to beat anchor's time (30).
      expect(r.outBeatTime, 'after conform: clipout.out at 30').toBeCloseTo(30, 6)
      // Beat anchor unchanged.
      expect(s.warp.beatAnchors.find(a => a.id === 1)!.time, 'beat anchor still 30').toBeCloseTo(30, 6)
    }

    // ── Step 2: release the drag.
    store.dispatch(endDrag())

    // ── Step 3: nudge clipin out-edge by less than the snap radius.
    // Snap radius at pxPerUnit=16 is 0.5 (= 8/16). Move to 25.3 — past
    // coincidence but well inside snap radius of orig=25.
    store.dispatch(beginDrag({
      handle: { kind: 'clip-out-edge', clipId: 'r', space: 'input' },
      pxPerUnit: 16,
    }))
    store.dispatch(drag({ delta: 0.3, modifiers: { alt: false } })) // clipin.out: 25 → 25.3
    store.dispatch(endDrag())

    // ── Expected: clipin.out stays snapped at 25; beat anchor unchanged at 30.
    // Within snap radius, the edge stays pinned to orig=25. The beat anchor
    // must NOT be yanked by the raw cursor — it stays at its diverged time.
    const end = store.getState()
    const r = end.region.regions[0]
    expect(r.outPoint, 'clipin.out stays snapped at 25').toBeCloseTo(25, 6)
    expect(
      end.warp.beatAnchors.find(a => a.id === 1)!.time,
      'beat anchor must stay at 30 after the conform releases',
    ).toBeCloseTo(30, 6)
  })

  it('using moveRegionBounds (toolbar-style edit) instead of drag: same invariant', () => {
    const store = setup()

    // Step 1: drag clipin out-edge to 25 via moveRegionBounds.
    store.dispatch(moveRegionBounds({ id: 'r', inPoint: 10, outPoint: 25 }))
    {
      const r = store.getState().region.regions[0]
      expect(r.outBeatTime, 'conform fires on the bulk write too').toBeCloseTo(30, 6)
    }

    // Step 2: nudge to 25.3 (no explicit "release" — moveRegionBounds is atomic).
    store.dispatch(moveRegionBounds({ id: 'r', inPoint: 10, outPoint: 25.3 }))

    const end = store.getState()
    expect(end.region.regions[0].outPoint).toBeCloseTo(25.3, 6)
    expect(
      end.warp.beatAnchors.find(a => a.id === 1)!.time,
      'beat anchor stays at 30 after the conform breaks',
    ).toBeCloseTo(30, 6)
  })
})
