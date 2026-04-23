Feature: Video Loading

  Scenario: Viewport is set to the video duration on load
    When a video is loaded
    Then the viewport changes to the length of the video

  Scenario: Viewport resets when a different video is loaded
    Given a first video with a long duration is already loaded
    When a second video with a shorter duration is loaded
    Then the viewport changes to the shorter video's duration

  # @hint Regression — PanelDock used to be hidden until a video was
  #       loaded, leaving the file browser unreachable when a folder had
  #       just been opened. The dock now renders unconditionally; the
  #       empty/loading state lives inside the center column.
  Scenario: File browser is reachable before any video is loaded
    Given the application is open with no video loaded
    When the user opens a folder containing videos
    Then the Files panel lists those videos
    And the user can click one of them to load it
