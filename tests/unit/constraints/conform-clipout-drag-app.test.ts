/**
 * Live-app repro: dragging a conformed clipout must move the paired anchor
 * by the same delta. This goes through the full store + thunks (not the bare
 * pipeline) so it exercises the same path as user gestures in the app.
 */

import { describe, it, expect } from 'vitest'
import { makeStore } from '../../helpers/setup'
import { addRegion } from '../../../src/store/slices/regionSlice'
import { addAnchor } from '../../../src/store/slices/warpSlice'
import { commitClipoutPan, commitClipoutResize } from '../../../src/store/thunks/clipoutThunks'
import type { Region } from '../../../src/types'

function makeConformedSetup() {
  const store = makeStore()
  // Default-linked region at [10,20] with bpm=120, lockedBeats=20.
  const region: Region = {
    id: 'r', name: 'r', inPoint: 10, outPoint: 20,
    inBeatTime: 10, outBeatTime: 20, defaultLinked: true,
    bpm: 120, lockedBeats: 20,
    minStretch: 0.5, maxStretch: 2.0, addToEnd: false,
  }
  store.dispatch(addRegion(region))
  // Linked anchor at time=10 — both spaces coincide with clipin.in and clipout.in.
  store.dispatch(addAnchor({ id: 1, time: 10 }))
  return store
}

describe('Live-app conform: clipout drag must carry the anchor', () => {

  it('commitClipoutPan body drag by +5 → clipout AND anchor both move +5', () => {
    const store = makeConformedSetup()

    // Pre-conditions: aligned at 10.
    const pre = store.getState()
    expect(pre.region.regions[0].inBeatTime).toBe(10)
    expect(pre.warp.beatAnchors.find(a => a.id === 1)?.time).toBe(10)

    // Body pan: shift inBeatTime 10 → 15, outBeatTime 20 → 25.
    store.dispatch(commitClipoutPan({
      id: 'r', inBeatTime: 15, outBeatTime: 25, altKey: false,
    }))

    const post = store.getState()
    // Clipout MUST advance with the drag.
    expect(post.region.regions[0].inBeatTime).toBeCloseTo(15, 6)
    expect(post.region.regions[0].outBeatTime).toBeCloseTo(25, 6)
    // Conformed anchor MUST follow the same delta.
    expect(post.warp.beatAnchors.find(a => a.id === 1)?.time).toBeCloseTo(15, 6)
  })

  it('commitClipoutResize edge drag (in-edge 10 → 12) → clipout AND anchor both move', () => {
    const store = makeConformedSetup()

    store.dispatch(commitClipoutResize({
      id: 'r', inBeatTime: 12, outBeatTime: 20, altKey: false,
    }))

    const post = store.getState()
    expect(post.region.regions[0].inBeatTime).toBeCloseTo(12, 6)
    expect(post.region.regions[0].outBeatTime).toBeCloseTo(20, 6)
    expect(post.warp.beatAnchors.find(a => a.id === 1)?.time).toBeCloseTo(12, 6)
  })

  it('commitClipoutPan delta variant (+5) → both edges and anchor shift +5', () => {
    const store = makeConformedSetup()

    store.dispatch(commitClipoutPan({ id: 'r', delta: 5, altKey: false }))

    const post = store.getState()
    expect(post.region.regions[0].inBeatTime).toBeCloseTo(15, 6)
    expect(post.region.regions[0].outBeatTime).toBeCloseTo(25, 6)
    expect(post.warp.beatAnchors.find(a => a.id === 1)?.time).toBeCloseTo(15, 6)
  })
})
