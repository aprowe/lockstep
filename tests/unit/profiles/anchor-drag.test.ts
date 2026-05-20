import { describe, it, expect } from 'vitest'
import { ANCHOR_DRAG } from '../../../src/constraints/profiles/anchor-drag'
import { ConstraintKind, OpKind, Field } from '../../../src/constraints/types'
import type { ProfileContext } from '../../../src/constraints/profiles/types'

const ctx: ProfileContext = {
  preDrag: {
    origAnchors: [{ id: 1, time: 10 }],
    beatAnchors: [{ id: 1, time: 10 }],
    regions: [],
  },
  ui: { anchorLock: false, lockMode: 'bpm' },
  modifiers: { alt: false },
}

describe('ANCHOR_DRAG profile', () => {
  it('input-space onDrag emits a Move op on the orig anchor entity', () => {
    const ops = ANCHOR_DRAG.onDrag({ kind: 'anchor-drag', anchorId: 1, space: 'input' }, 3, ctx)
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ kind: OpKind.Move, id: 'a1-in', delta: 3 })
  })

  it('beat-space onDrag emits a Move op on the beat anchor entity', () => {
    const ops = ANCHOR_DRAG.onDrag({ kind: 'anchor-drag', anchorId: 1, space: 'beat' }, 3, ctx)
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ kind: OpKind.Move, id: 'a1-out', delta: 3 })
  })

  it('whileDragging installs a SnapTarget for the dragged anchor in input space', () => {
    const cs = ANCHOR_DRAG.whileDragging({ kind: 'anchor-drag', anchorId: 1, space: 'input' }, ctx)
    expect(cs).toHaveLength(1)
    const st = cs[0] as { kind: string; id: string; field: string }
    expect(st.kind).toBe(ConstraintKind.SnapTarget)
    expect(st.id).toBe('a1-in')
    expect(st.field).toBe(Field.Time)
  })

  it('whileDragging installs a SnapTarget for the dragged anchor in beat space', () => {
    const cs = ANCHOR_DRAG.whileDragging({ kind: 'anchor-drag', anchorId: 1, space: 'beat' }, ctx)
    expect(cs).toHaveLength(1)
    const st = cs[0] as { kind: string; id: string }
    expect(st.id).toBe('a1-out')
  })

  it('onDrag returns empty for non-anchor-drag handles', () => {
    const ops = ANCHOR_DRAG.onDrag({ kind: 'pair-drag', pairId: 1 }, 3, ctx)
    expect(ops).toEqual([])
  })
})
