import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'

const feature = await loadFeature('./spec/features/timeline_tracks.feature')

describeFeature(feature, ({ Scenario, ScenarioOutline }) => {
  // @behavior timeline-tracks::6eef362f
  Scenario('Right-click on the timeline opens a three-section context menu', ({ Given, When, Then, And }) => {
    Given('[a video is loaded]', () => {})
    When('the user right-clicks anywhere in the timeline area', () => {})
    Then('a context menu appears with three sections: target-specific, track-specific, and global timeline actions', () => {})
    And('global actions may be promoted to track-specific when the context calls for it', () => {})
  })

  // @behavior timeline-tracks::eff9cde8
  Scenario('Lasso drag within a single track selects its objects', ({ Given, And, When, Then }) => {
    Given('[a video is loaded]', () => {})
    And('markers are placed on the current track', () => {})
    When('the user drags across an empty area of the track', () => {})
    Then('the dragged area is highlighted as a lasso within that track', () => {})
    When('the mouse is released', () => {})
    Then('the objects inside the lasso are selected', () => {})
  })

  // @behavior timeline-tracks::da3524a2
  Scenario('Lasso drag expands across tracks when the mouse leaves the starting track', ({ Given, And, When, Then }) => {
    Given('[a video is loaded]', () => {})
    And('markers are placed on the current track', () => {})
    When('the user drags across an empty area of the track', () => {})
    And('the drag enters another track', () => {})
    Then('the lasso leaves single-track mode and can span multiple object types', () => {})
    When('the mouse is released', () => {})
    Then('all objects inside the lasso are selected', () => {})
  })

  // @behavior timeline-tracks::6cee313c
  Scenario('Lasso across both boundaries of a clip selects that clip', ({ Given, And, When, Then }) => {
    Given('[a video is loaded]', () => {})
    And('clip 1 exists', () => {})
    When('the user drags across both boundaries of the clip', () => {})
    Then('the clip is selected', () => {})
  })

  // @behavior timeline-tracks::e840fcd6
  ScenarioOutline("Double-click in a track's empty area creates a new object", ({ Given, And, When, Then }) => {
    Given('[a video is loaded]', () => {})
    And('the mouse is over an empty area on a <layer>', () => {})
    When('the user double-clicks', () => {})
    Then('the track creates a new <object> at the cursor position', () => {})
  })

  // @behavior timeline-tracks::bb2839e1
  ScenarioOutline('Double-click on an object in a track performs its primary action', ({ Given, And, When, Then }) => {
    Given('[a video is loaded]', () => {})
    And('the mouse is over an <object> on a <layer>', () => {})
    When('the user double-clicks', () => {})
    Then('the track performs <action> for the <object> under the cursor', () => {})
  })

  // @behavior timeline-tracks::9fced362
  ScenarioOutline('Right-click on an object shows object-specific actions above track and global options', ({ Given, And, When, Then }) => {
    Given('[a video is loaded]', () => {})
    And('the mouse is over a <object> in <layer>', () => {})
    When('the user right-clicks', () => {})
    Then('the context menu shows <actions> above the track and global options', () => {})
  })

  // @behavior timeline-tracks::89de8324
  ScenarioOutline('Right-click on an empty track shows track-specific create actions', ({ Given, And, When, Then }) => {
    Given('[a video is loaded]', () => {})
    And('the mouse is inside <layer>', () => {})
    When('the user right-clicks', () => {})
    Then('the context menu shows <actions> above the track and global options', () => {})
  })
})
