Feature: Video Loading

  Scenario: Viewport is set to the video duration on load
    When a video is loaded
    Then the viewport changes to the length of the video

  Scenario: Viewport resets when a different video is loaded
    Given a first video with a long duration is already loaded
    When a second video with a shorter duration is loaded
    Then the viewport changes to the shorter video's duration
