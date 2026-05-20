/**
 * Drag-gesture profile types.
 *
 * A Handle identifies what the user grabbed (entity + which affordance).
 * A GestureProfile declares two things per handle kind:
 *   - onDrag:        delta → ops (procedural; entity-specific)
 *   - whileDragging: constraints that exist for the duration of the gesture
 *                    (declarative; merged into the graph by buildGraphFromSlice
 *                    on each pipeline dispatch where the active handle matches)
 *
 * No install/teardown ops — the constraints exist exactly while
 * `state.gesture.activeHandle` points at them.
 */

import type { Constraint, Op } from '../types'

export type Handle =
  | { kind: 'pair-drag';     pairId: number }
  | { kind: 'anchor-drag';   anchorId: number; space: 'input' | 'beat' }
  | { kind: 'clip-body';     clipId: string; space: 'input' | 'beat' }
  | { kind: 'clip-in-edge';  clipId: string; space: 'input' | 'beat' }
  | { kind: 'clip-out-edge'; clipId: string; space: 'input' | 'beat' }

export type ProfileContext = {
  /** Pre-drag slice snapshot (immutable for the duration of the drag). */
  preDrag: {
    origAnchors: ReadonlyArray<{ id: number; time: number }>
    beatAnchors: ReadonlyArray<{ id: number; time: number; linked?: boolean }>
    regions: ReadonlyArray<{
      id: string
      inPoint: number
      outPoint: number
      inBeatTime: number
      outBeatTime: number
      defaultLinked: boolean
    }>
  }
  /** UI flags that affect gesture behavior (e.g. anchor-lock, lockMode). */
  ui: {
    anchorLock: boolean
    lockMode: 'bpm' | 'beats'
  }
  /** Transient modifier-key state for the active drag. */
  modifiers: { alt: boolean }
}

export type GestureProfile = {
  onDrag: (handle: Handle, delta: number, ctx: ProfileContext) => Op[]
  whileDragging: (handle: Handle, ctx: ProfileContext) => Constraint[]
}
