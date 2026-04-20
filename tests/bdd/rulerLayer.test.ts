import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'

const feature = await loadFeature('./spec/features/ruler-layer.feature')

describeFeature(feature, ({ Scenario }) => {
  // @behavior ruler-layer::0b84503c
  Scenario('input ruler is scrubbed', ({ Given, When, Then, And }) => {
    Given('[a video is loaded]', () => {})
    When('the mouse is dragged horizontally along the [input ruler]', () => {})
    Then('the playhead scrubs along with the mouse movement', () => {})
    And('the video frame updates to match the playhead position', () => {})
  })
})
