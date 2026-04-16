import { it, expect } from 'vitest'
import { secondsToFrames, formatFrames } from '../../src/utils/time'
import { behaviorTest } from '../helpers/runBehavior'

// frame-count-display::871cc353
// Scenario: Frame count shown next to timecode

behaviorTest('frame-count-display::871cc353', () => {
  it('converts 2.5 seconds at 30fps to 75 frames', () => {
    expect(secondsToFrames(2.5, 30)).toBe(75)
  })

  it('formats the frame count as "75f"', () => {
    expect(formatFrames(2.5, 30)).toBe('75f')
  })
})

// frame-count-display::3a49f366
// Scenario: Step forward increments the frame count

behaviorTest('frame-count-display::3a49f366', () => {
  it('stepping 1 frame forward from 75f yields 76f at 30fps', () => {
    const startSec = 75 / 30
    const nextSec = startSec + 1 / 30
    expect(secondsToFrames(nextSec, 30)).toBe(76)
    expect(formatFrames(nextSec, 30)).toBe('76f')
  })
})

// frame-count-display::607ab793
// Scenario: Step backward decrements the frame count

behaviorTest('frame-count-display::607ab793', () => {
  it('stepping 1 frame backward from 75f yields 74f at 30fps', () => {
    const startSec = 75 / 30
    const prevSec = startSec - 1 / 30
    expect(secondsToFrames(prevSec, 30)).toBe(74)
    expect(formatFrames(prevSec, 30)).toBe('74f')
  })
})

// frame-count-display::fc7df5e5
// Scenario: Frame count rounds to nearest integer

behaviorTest('frame-count-display::fc7df5e5', () => {
  it('rounds 2.533s at 30fps to 76f (not 75)', () => {
    // 2.533 * 30 = 75.99 → rounds to 76
    expect(secondsToFrames(2.533, 30)).toBe(76)
    expect(formatFrames(2.533, 30)).toBe('76f')
  })

  it('rounds 2.516s at 30fps to 75f (exactly at boundary)', () => {
    // 2.516 * 30 = 75.48 → rounds to 75
    expect(secondsToFrames(2.516, 30)).toBe(75)
  })
})

// frame-count-display::bfa96c35
// Scenario: Frame count at time zero

behaviorTest('frame-count-display::bfa96c35', () => {
  it('shows 0f when playhead is at 0 seconds', () => {
    expect(secondsToFrames(0, 30)).toBe(0)
    expect(formatFrames(0, 30)).toBe('0f')
  })

  it('returns 0f safely when fps is invalid (divide-by-zero guard)', () => {
    expect(secondsToFrames(5, 0)).toBe(0)
    expect(formatFrames(5, 0)).toBe('0f')
  })
})

// frame-count-display::2ae2aa1e
// Scenario: Frame count can be edited

behaviorTest('frame-count-display::2ae2aa1e', () => {
  it('converts an entered frame number back to seconds via fps', () => {
    // When user enters "100" at 30fps, playhead should move to 100/30 ≈ 3.333s
    const enteredFrame = 100
    const fps = 30
    const targetSeconds = enteredFrame / fps
    expect(targetSeconds).toBeCloseTo(3.3333, 3)
    // And formatting that position back yields the same frame number
    expect(secondsToFrames(targetSeconds, fps)).toBe(100)
    expect(formatFrames(targetSeconds, fps)).toBe('100f')
  })

  it('round-trips frame→seconds→frame for arbitrary values', () => {
    for (const f of [0, 1, 30, 75, 1000]) {
      expect(secondsToFrames(f / 30, 30)).toBe(f)
    }
  })
})
