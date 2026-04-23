Feature: Region Creation

  Scenario Outline: New region size is the larger of 10% of view or 5 seconds
    Given the current viewport span is <viewSpan> seconds
    When a new region is created
    Then the region span is <expectedSpan> seconds

    Examples:
      | viewSpan | expectedSpan |
      | 20       | 5            |
      | 40       | 5            |
      | 50       | 5            |
      | 200      | 20           |

  Scenario: New region from the timeline is is aligned on the cursor position
    Given the current viewport span is 40 seconds
    And the video duration is 120 seconds
    When a new region is created at cursor position 60 seconds
    Then the region spans from 60 to 65 seconds

  Scenario: New region from the region list is aligned on the playhead
    Given the current viewport span is 40 seconds
    And the video duration is 120 seconds
    When a new region is created at playhead position 60 seconds
    Then the region spans from 60 to 65 seconds

  Scenario: Region is clamped to the start of the video
    Given the current viewport span is 40 seconds
    And the video duration is 120 seconds
    When a new region is created at cursor position -0.5 seconds
    Then the region in-point is 0

  Scenario: Region is clamped to the end of the video
    Given the current viewport span is 40 seconds
    And the video duration is 120 seconds
    When a new region is created at cursor position 119.5 seconds
    Then the region out-point is 120

  Scenario: Region is selected when created
    Given Region A is selected
    When Region B is created
    Then Region B is selected
    And the viewport has not changed

  # Scene- and region-aware bounds. With scene markers present, a new region
  # fills the gap around the cursor: in-point = latest of (prev scene, end of
  # prev region, viewport start); out-point = earliest of (next scene, start of
  # next region, viewport end). Clamped to [0, video duration].

  Scenario: No scene markers at all — falls back to 5s / 10% rule
    Given the viewport is from 50 to 90 seconds
    And the video duration is 120 seconds
    And there are no scene markers
    And there are no other regions
    When a new region is created at cursor position 60 seconds
    Then the region spans from 60 to 65 seconds

  Scenario: Snaps between surrounding scene markers when both are in view
    Given the viewport is from 50 to 90 seconds
    And the video duration is 120 seconds
    And there is a scene marker at 55 seconds
    And there is a scene marker at 70 seconds
    And there are no other regions
    When a new region is created at cursor position 60 seconds
    Then the region spans from 55 to 70 seconds

  Scenario: No next scene marker in view — out-point stops at the viewport end
    Given the viewport is from 50 to 90 seconds
    And the video duration is 120 seconds
    And there is a scene marker at 55 seconds
    And there are no other regions
    When a new region is created at cursor position 60 seconds
    Then the region spans from 55 to 90 seconds

  Scenario: No previous scene marker in view — in-point starts at the viewport start
    Given the viewport is from 50 to 90 seconds
    And the video duration is 120 seconds
    And there is a scene marker at 80 seconds
    And there are no other regions
    When a new region is created at cursor position 60 seconds
    Then the region spans from 50 to 80 seconds

  Scenario: No scene markers in view — region fills the viewport around the cursor
    Given the viewport is from 50 to 90 seconds
    And the video duration is 120 seconds
    And there is a scene marker at 10 seconds
    And there is a scene marker at 110 seconds
    And there are no other regions
    When a new region is created at cursor position 60 seconds
    Then the region spans from 50 to 90 seconds

  Scenario: Previous region out-point takes precedence over an earlier scene marker
    Given the viewport is from 50 to 100 seconds
    And the video duration is 120 seconds
    And there is a scene marker at 55 seconds
    And there is a region from 60 to 70 seconds
    When a new region is created at cursor position 80 seconds
    Then the region spans from 70 to 100 seconds

  Scenario: Next region in-point takes precedence over a later scene marker
    Given the viewport is from 50 to 100 seconds
    And the video duration is 120 seconds
    And there is a scene marker at 95 seconds
    And there is a region from 80 to 90 seconds
    When a new region is created at cursor position 60 seconds
    Then the region spans from 50 to 80 seconds

  Scenario: Cursor inside an existing region — behaves as if the playhead is just past the region's out
    Given the viewport is from 50 to 100 seconds
    And the video duration is 120 seconds
    And there is a region from 60 to 70 seconds
    And there is a scene marker at 80 seconds
    When a new region is created at cursor position 65 seconds
    Then the region spans from 70 to 80 seconds
