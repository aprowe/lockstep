/**
 * Profile-driven anchor drag link bookkeeping.
 *
 * Regressions caught from production:
 *
 *   1. After dragging the beat side via the ANCHOR_DRAG profile, the
 *      pair must be marked `linked: false` if beat diverged from orig.
 *      Without this, a subsequent orig drag would propagate via the
 *      still-installed `pair:N` DirectedPair (orig→beat) and pull the
 *      diverged beat back.
 *
 *   2. selectConstraintGraph must include `gesture` slice in its
 *      memoization keys so that gesture-scoped constraints
 *      (whileDragging) appear in the snapshot graph used for snap-hint
 *      computation. (Covered by the SnapTarget assertions in
 *      scenario-gesture-while-dragging — this file focuses on bug #1.)
 */

import { describe, it, expect } from 'vitest'
import { makeStore } from '../../helpers/setup'
import { addAnchor } from '../../../src/store/slices/warpSlice'
import { beginDrag, drag, endDrag } from '../../../src/store/thunks/dragThunks'

describe('profile-driven beat-anchor drag updates linked flag', () => {

  it('beat drag away from orig: linked flips to false', () => {
    const store = makeStore()
    store.dispatch(addAnchor({ id: 1, time: 10 }))

    store.dispatch(beginDrag({ handle: { kind: 'anchor-drag', anchorId: 1, space: 'beat' } }))
    store.dispatch(drag({ delta: 5, modifiers: { alt: false } }))
    store.dispatch(endDrag())

    const beat = store.getState().warp.beatAnchors.find(a => a.id === 1)
    expect(beat?.time).toBeCloseTo(15, 6)
    expect(beat?.linked).toBe(false)
  })

  it('beat drag back onto orig (after diverged): linked flips to true', () => {
    const store = makeStore()
    store.dispatch(addAnchor({ id: 1, time: 10 }))

    // First drag: beat 10 → 15 (diverged).
    store.dispatch(beginDrag({ handle: { kind: 'anchor-drag', anchorId: 1, space: 'beat' } }))
    store.dispatch(drag({ delta: 5, modifiers: { alt: false } }))
    store.dispatch(endDrag())
    expect(store.getState().warp.beatAnchors.find(a => a.id === 1)?.linked).toBe(false)

    // Second drag: beat 15 → 10 (re-linked).
    store.dispatch(beginDrag({ handle: { kind: 'anchor-drag', anchorId: 1, space: 'beat' } }))
    store.dispatch(drag({ delta: -5, modifiers: { alt: false } }))
    store.dispatch(endDrag())

    const beat = store.getState().warp.beatAnchors.find(a => a.id === 1)
    expect(beat?.time).toBeCloseTo(10, 6)
    expect(beat?.linked).not.toBe(false)
  })

  it('orig drag does NOT touch linked flag (only beat drags do bookkeeping)', () => {
    const store = makeStore()
    store.dispatch(addAnchor({ id: 1, time: 10 }))

    store.dispatch(beginDrag({ handle: { kind: 'anchor-drag', anchorId: 1, space: 'input' } }))
    store.dispatch(drag({ delta: 5, modifiers: { alt: false } }))
    store.dispatch(endDrag())

    // Linked pair: orig drag pulls beat via DirectedPair → both at 15 → linked.
    const orig = store.getState().warp.origAnchors.find(a => a.id === 1)
    const beat = store.getState().warp.beatAnchors.find(a => a.id === 1)
    expect(orig?.time).toBeCloseTo(15, 6)
    expect(beat?.time).toBeCloseTo(15, 6)
    expect(beat?.linked).not.toBe(false)
  })

  it('after beat-drag unlinks, subsequent orig drag does NOT pull beat (DirectedPair gone)', () => {
    // The end-to-end of bug #1: the unlink-on-end-of-drag step is what
    // prevents the diverged beat from being yanked back when the orig
    // is later dragged.
    //
    // Beat is dragged far enough (delta=20) that the new ANCHOR_DRAG
    // snap (which now considers anchor-in → anchor-out as a snap pair
    // via SNAP_RULES) doesn't accidentally pull orig onto beat during
    // the second drag — orig ends up at 13, ~17 units from beat=30,
    // well outside the snap radius.
    const store = makeStore()
    store.dispatch(addAnchor({ id: 1, time: 10 }))

    // Unlink via beat drag — beat goes 10 → 30.
    store.dispatch(beginDrag({ handle: { kind: 'anchor-drag', anchorId: 1, space: 'beat' } }))
    store.dispatch(drag({ delta: 20, modifiers: { alt: false } }))
    store.dispatch(endDrag())
    expect(store.getState().warp.beatAnchors.find(a => a.id === 1)?.linked).toBe(false)
    expect(store.getState().warp.beatAnchors.find(a => a.id === 1)?.time).toBeCloseTo(30, 6)

    // Now drag the orig from 10 → 13 — beat must STAY at 30, not follow.
    store.dispatch(beginDrag({ handle: { kind: 'anchor-drag', anchorId: 1, space: 'input' } }))
    store.dispatch(drag({ delta: 3, modifiers: { alt: false } }))
    store.dispatch(endDrag())

    expect(store.getState().warp.origAnchors.find(a => a.id === 1)?.time).toBeCloseTo(13, 6)
    expect(store.getState().warp.beatAnchors.find(a => a.id === 1)?.time, 'beat must stay diverged').toBeCloseTo(30, 6)
  })
})
