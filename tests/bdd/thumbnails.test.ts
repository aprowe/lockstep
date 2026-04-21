import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'

const feature = await loadFeature('./spec/features/thumbnails.feature')

describeFeature(feature, ({ Scenario }) => {
  // @behavior thumbnail-scrolling::90ecf3d8
  Scenario('Thumbnails start generating when a video loads', ({ Given, When, Then }) => {
    Given('an empty project', () => {})
    When('[a video is loaded]', () => {})
    Then('thumbnail generation starts in the background', () => {})
  })

  // @behavior thumbnail-scrolling::38691341
  Scenario('Thumbnails near the playhead are generated first', ({ Given, When, Then }) => {
    Given('[a video is loaded]', () => {})
    When('the playhead jumps to a new position', () => {})
    Then('thumbnails near the playhead are generated before thumbnails elsewhere', () => {})
  })

  // @behavior thumbnail-scrolling::56235449
  Scenario('Thumbnails inside a region are generated first', ({ Given, When, Then }) => {
    Given('[a video is loaded]', () => {})
    When('a [region] is created or updated', () => {})
    Then('thumbnails for frames inside that region are generated first', () => {})
  })

  // @behavior thumbnail-scrolling::ecab2b8f
  Scenario('Scrubbing the [input ruler] updates the thumbnail viewer', ({ Given, When, Then }) => {
    Given('[a video is loaded]', () => {})
    When('the [input ruler] is [scrubbed]', () => {})
    Then('the thumbnail viewer shows the playhead frame plus as many surrounding frames as fit in the viewer', () => {})
  })

  // @behavior thumbnail-scrolling::76f18ec6
  Scenario('Missing thumbnails show a placeholder', ({ Given, When, Then }) => {
    Given('the thumbnail viewer is active and visible', () => {})
    When('a thumbnail is requested for a frame whose thumbnail has not been generated yet', () => {})
    Then('a placeholder is shown in its place until the real thumbnail is available', () => {})
  })

  // @behavior thumbnail-scrolling::10c1de68
  Scenario('Hovering a scene marker shows a thumbnail popup', ({ Given, And, When, Then }) => {
    Given('[a video is loaded]', () => {})
    And('the [scene strip] is populated', () => {})
    And('the [scene strip] is not expanded', () => {})
    When('the user hovers over a scene marker', () => {})
    Then('a thumbnail of the frame at that scene change appears in a popup', () => {})
  })

  // @behavior thumbnail-scrolling::07eab3fa
  Scenario('Expanded scene strip shows one thumbnail per marker', ({ Given, And, When, Then }) => {
    Given('[a video is loaded]', () => {})
    And('the [scene strip] is populated', () => {})
    When('the [scene strip] is expanded', () => {})
    Then('a thumbnail of each scene marker\'s frame is shown inline inside the scene strip', () => {})
  })
})
