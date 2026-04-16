Feature: Region Creation

  Scenario Outline: New region size is the smaller of 10% of view or 5 seconds
    Given the current viewport span is <viewSpan> seconds
    When a new region is created
    Then the region span is <expectedSpan> seconds

    Examples:
      | viewSpan | expectedSpan |
      | 20       | 2            |
      | 40       | 4            |
      | 50       | 5            |
      | 200      | 5            |

  Scenario: New region from the timeline is is aligned on the cursor position
    Given the current viewport span is 40 seconds
    And the video duration is 120 seconds
    When a new region is created at cursor position 60 seconds
    Then the region spans from 60 to 64 seconds

  Scenario: New region from the region list is aligned on the playhead
    Given the current viewport span is 40 seconds
    And the video duration is 120 seconds
    When a new region is created at playhead position 60 seconds
    Then the region spans from 60 to 64 seconds

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
