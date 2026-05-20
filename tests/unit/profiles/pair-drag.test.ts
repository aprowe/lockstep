import { describe, it, expect } from 'vitest'
import { PAIR_DRAG } from '../../../src/constraints/profiles/pair-drag'
import { ConstraintKind, OpKind } from '../../../src/constraints/types'
import type { ProfileContext } from '../../../src/constraints/profiles/types'
import { emptyState } from '../../../src/constraints/resolver'

const ctx: ProfileContext = {
  preDrag: {
    origAnchors: [{ id: 1, time: 5 }],
    beatAnchors: [{ id: 1, time: 10 }],
    regions: [],
  },
  ui: { anchorLock: false, lockMode: 'bpm' },
  modifiers: { alt: false },
  pxPerUnit: 0,
}
const state = emptyState()

describe('PAIR_DRAG profile', () => {
  it('onDrag emits a single Move op on the orig anchor', () => {
    const ops = PAIR_DRAG.onDrag({ kind: 'pair-drag', pairId: 1 }, 3, ctx)
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ kind: OpKind.Move, id: 'a1-in', delta: 3 })
  })

  it('whileDragging installs a TranslateGroup over the pair', () => {
    const cs = PAIR_DRAG.whileDragging({ kind: 'pair-drag', pairId: 1 }, ctx, state)
    const tg = cs.find(c => c.kind === ConstraintKind.TranslateGroup)
    expect(tg).toBeDefined()
    expect((tg as { ids: string[] }).ids).toEqual(['a1-in', 'a1-out'])
    expect((tg as { tag?: string }).tag).toBe('gesture:pair:1')
  })

  it('onDrag is empty for non-pair-drag handles (defensive)', () => {
    const ops = PAIR_DRAG.onDrag({ kind: 'anchor-drag', anchorId: 1, space: 'input' }, 3, ctx)
    expect(ops).toEqual([])
  })
})
