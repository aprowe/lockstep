import { describe, it, expect } from 'vitest'
import gestureReducer, {
  setActiveHandle,
  setCumulativeDelta,
  setGestureModifiers,
  clearGesture,
} from '../../../src/store/slices/gestureSlice'

describe('gestureSlice', () => {
  it('starts with no active handle, zero delta, alt=false', () => {
    const s = gestureReducer(undefined, { type: '@@INIT' })
    expect(s.activeHandle).toBeNull()
    expect(s.cumulativeDelta).toBe(0)
    expect(s.modifiers).toEqual({ alt: false })
  })

  it('setActiveHandle records the handle', () => {
    const s = gestureReducer(undefined, setActiveHandle({ kind: 'pair-drag', pairId: 1 }))
    expect(s.activeHandle).toEqual({ kind: 'pair-drag', pairId: 1 })
  })

  it('setCumulativeDelta records the delta', () => {
    const s = gestureReducer(undefined, setCumulativeDelta(3.5))
    expect(s.cumulativeDelta).toBe(3.5)
  })

  it('setGestureModifiers updates only modifiers', () => {
    let s = gestureReducer(undefined, setActiveHandle({ kind: 'pair-drag', pairId: 1 }))
    s = gestureReducer(s, setGestureModifiers({ alt: true }))
    expect(s.activeHandle).toEqual({ kind: 'pair-drag', pairId: 1 })
    expect(s.modifiers.alt).toBe(true)
  })

  it('clearGesture resets to initial', () => {
    let s = gestureReducer(undefined, setActiveHandle({ kind: 'pair-drag', pairId: 1 }))
    s = gestureReducer(s, setCumulativeDelta(5))
    s = gestureReducer(s, setGestureModifiers({ alt: true }))
    s = gestureReducer(s, clearGesture())
    expect(s.activeHandle).toBeNull()
    expect(s.cumulativeDelta).toBe(0)
    expect(s.modifiers).toEqual({ alt: false })
  })
})
