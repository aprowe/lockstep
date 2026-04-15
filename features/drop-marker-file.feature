Feature: Drop a matching marker file onto a loaded clip

  Scenario: Markers are replaced when a matching sidecar is dropped
    Given a video is loaded with in-progress marker state
    And a sidecar file exists in the same folder with saved markers
    When the user drops the JSON file onto the app window
    Then the video does not change
    And all current in-memory markers are replaced with those from the sidecar

  Scenario: Undo reverts the sidecar load
    Given a sidecar file is loaded over in-progress markers
    When the user dispatches undo
    Then the markers revert to the state directly before loading

  Scenario: No sibling video found results in silent error
    Given a JSON file is dropped with no sibling video next to it
    When the app tries to resolve the sibling
    Then the error is logged silently
    And the current state is unchanged

  Scenario: A different sibling video loads with its markers
    Given a JSON file is dropped whose sibling video differs from the currently loaded one
    When the sidecar is resolved
    Then the sibling video loads replacing the current video
    And the sibling's markers are applied
