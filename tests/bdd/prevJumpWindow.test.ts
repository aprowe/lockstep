import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect } from 'vitest'
import { findPreviousTarget } from '../../src/utils/navigation'

const feature = await loadFeature('./spec/features/navigation.feature')

const TARGETS = [10, 20, 30]

/** All three tracks (markers, scenes, regions) route through findPreviousTarget
 *  in App.tsx — they share window semantics, so a single utility-level test
 *  covers all three Examples rows of each ScenarioOutline. */
const trackForLog = (variables: Record<string, string>) => String(variables.track)

describeFeature(feature, ({ ScenarioOutline }) => {
  // @behavior timeline-navigation::2e61d3bc
  ScenarioOutline('While playing, Previous skips targets within 0.5s behind the playhead', ({ Given, And, When, Then }, variables) => {
    const state = { playhead: 0, playing: false, result: undefined as number | undefined, track: '' }

    Given('there are targets at 10, 20, and 30 seconds on the <track>', () => {
      state.track = trackForLog(variables)
    })
    And('the video is playing', () => { state.playing = true })
    And('the playhead is at 20.3 seconds', () => { state.playhead = 20.3 })
    When('the user clicks Previous on the <track>', () => {
      state.result = findPreviousTarget(TARGETS, state.playhead, state.playing)
    })
    Then('the playhead moves to 10 seconds', () => {
      // 20 is within 0.5s behind 20.3 (20 > 19.8) → skipped → 10 wins.
      expect(state.result).toBe(10)
    })
  })

  // @behavior timeline-navigation::4363a7f7
  ScenarioOutline('While playing, Previous still snaps to the nearest earlier target outside the 0.5s window', ({ Given, And, When, Then }, variables) => {
    const state = { playhead: 0, playing: false, result: undefined as number | undefined, track: '' }

    Given('there are targets at 10, 20, and 30 seconds on the <track>', () => {
      state.track = trackForLog(variables)
    })
    And('the video is playing', () => { state.playing = true })
    And('the playhead is at 21.0 seconds', () => { state.playhead = 21.0 })
    When('the user clicks Previous on the <track>', () => {
      state.result = findPreviousTarget(TARGETS, state.playhead, state.playing)
    })
    Then('the playhead moves to 20 seconds', () => {
      // 20 is outside the 0.5s window (20 < 21.0 - 0.5 = 20.5) → 20 wins.
      expect(state.result).toBe(20)
    })
  })

  // @behavior timeline-navigation::030aad8c
  ScenarioOutline('While paused, the 0.5s window does not apply to Previous', ({ Given, And, When, Then }, variables) => {
    const state = { playhead: 0, playing: false, result: undefined as number | undefined, track: '' }

    Given('there are targets at 10, 20, and 30 seconds on the <track>', () => {
      state.track = trackForLog(variables)
    })
    And('the video is paused', () => { state.playing = false })
    And('the playhead is at 20.3 seconds', () => { state.playhead = 20.3 })
    When('the user clicks Previous on the <track>', () => {
      state.result = findPreviousTarget(TARGETS, state.playhead, state.playing)
    })
    Then('the playhead moves to 20 seconds', () => {
      // Paused: small dead-zone (~0.05s) keeps 20 visible (20 < 20.25).
      expect(state.result).toBe(20)
    })
  })
})
