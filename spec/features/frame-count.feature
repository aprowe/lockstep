Feature: Frame count display
  As a user editing video
  I want to see the current frame number alongside the timecode
  So that I can precisely align markers to video frames

  Scenario: Frame count shown next to timecode
    Given a 30fps video is loaded
    When the playhead is at 2.5 seconds
    Then the toolbar displays "75f" next to the timecode

  Scenario: Step forward increments the frame count
    Given a 30fps video is loaded
    And the playhead is at frame 75
    When the user presses step-forward
    Then the toolbar displays "76f"

  Scenario: Step backward decrements the frame count
    Given a 30fps video is loaded
    And the playhead is at frame 75
    When the user presses step-back
    Then the toolbar displays "74f"

  Scenario: Frame count rounds to nearest integer
    Given a 30fps video is loaded
    When the playhead is at 2.533 seconds
    Then the toolbar displays "76f"

  Scenario: Frame count at time zero
    Given a 30fps video is loaded
    When the playhead is at 0 seconds
    Then the toolbar displays "0f"

  Scenario: Frame count can be edited
    Given a 30fps video is loaded
    When the user clicks the frame count display
    And enters "100"
    Then the playhead moves to frame 100
    And the toolbar displays "100f"

