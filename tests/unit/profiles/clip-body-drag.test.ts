import { describe, it, expect } from 'vitest'
import { CLIP_BODY_DRAG } from '../../../src/constraints/profiles/clip-body-drag'
import { ConstraintKind, OpKind } from '../../../src/constraints/types'
import type { ProfileContext } from '../../../src/constraints/profiles/types'

const ctx: ProfileContext = {
  preDrag: {
    origAnchors: [],
    beatAnchors: [],
    regions: [{
      id: 'r1', inPoint: 10, outPoint: 20,
      inBeatTime: 10, outBeatTime: 20, defaultLinked: true,
    }],
  },
  ui: { anchorLock: false, lockMode: 'bpm' },
  modifiers: { alt: false },
}

describe('CLIP_BODY_DRAG profile', () => {
  it('onDrag (input space) emits Move op on the clipin entity', () => {
    const ops = CLIP_BODY_DRAG.onDrag({ kind: 'clip-body', clipId: 'r1', space: 'input' }, 3, ctx)
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ kind: OpKind.Move, id: 'r1-in', delta: 3 })
  })

  it('onDrag (beat space) emits Move op on the clipout entity', () => {
    const ops = CLIP_BODY_DRAG.onDrag({ kind: 'clip-body', clipId: 'r1', space: 'beat' }, 3, ctx)
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ kind: OpKind.Move, id: 'r1-out', delta: 3 })
  })

  it('whileDragging installs a body-mode SnapTarget on the dragged clip', () => {
    const cs = CLIP_BODY_DRAG.whileDragging({ kind: 'clip-body', clipId: 'r1', space: 'input' }, ctx)
    expect(cs).toHaveLength(1)
    const st = cs[0] as { kind: string; id: string; mode: string }
    expect(st.kind).toBe(ConstraintKind.SnapTarget)
    expect(st.id).toBe('r1-in')
    expect(st.mode).toBe('body')
  })

  it('onDrag is empty for non-clip-body handles', () => {
    const ops = CLIP_BODY_DRAG.onDrag({ kind: 'pair-drag', pairId: 1 }, 3, ctx)
    expect(ops).toEqual([])
  })
})
