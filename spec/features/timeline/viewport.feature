Feature: Timeline Viewport

    # PR3 extracts the controller; PR4 adds the BDD steps that drive these.
    # Behaviors are documented here so they're part of the spec inventory.

    Scenario: Wheel scroll pans the viewport horizontally
        Given [a video is loaded]
        When the user scrolls the mouse wheel with no modifier keys
        Then the viewport pans horizontally
        And the viewport zoom span stays the same

    Scenario: Shift + wheel pans horizontally even when deltaY is 0
        Given [a video is loaded]
        When the user scrolls the mouse wheel while holding Shift
        Then the viewport pans horizontally regardless of deltaX

    Scenario: Ctrl/Cmd + wheel zooms around the cursor
        Given [a video is loaded]
        And the cursor is at horizontal position X on the timeline
        When the user scrolls the mouse wheel while holding Ctrl or Cmd
        Then the viewport zooms in or out
        And the time at horizontal position X stays at horizontal position X

    Scenario: Alt + click + drag pans the viewport
        Given [a video is loaded]
        When the user holds Alt and drags the timeline
        Then the viewport pans by the drag delta

    Scenario: Middle-mouse drag pans the viewport
        Given [a video is loaded]
        When the user drags the timeline with the middle mouse button
        Then the viewport pans by the drag delta

    Scenario: Clicking the minimap recenters the viewport
        Given [a video is loaded]
        When the user clicks at a position on the minimap
        Then the viewport recenters on the clicked time
        And the viewport span is preserved

    Scenario: Dragging across the minimap recenters continuously
        Given [a video is loaded]
        When the user drags the mouse across the minimap
        Then the viewport recenters continuously to follow the cursor

    Scenario: Zoom is clamped to a minimum span of 0.1 seconds
        Given [a video is loaded]
        When the user attempts to zoom in past the minimum span
        Then the viewport span stops at 0.1 seconds

    Scenario: Zoom is clamped to a maximum of twice the video duration
        Given [a video is loaded]
        When the user attempts to zoom out past the maximum span
        Then the viewport span stops at twice the video duration

    Scenario: Viewport is always clamped to the video duration
        Given [a video is loaded]
        When the viewport would extend before 0 or past the video duration
        Then the viewport edges are clamped to [0, videoDuration]

    Scenario: Zoom-to-region toggles back to the previous view on a second invoke
        Given [a video is loaded]
        And a region exists
        When the user invokes Zoom-to-region once
        Then the viewport zooms to the region
        When the user invokes Zoom-to-region again on the same region
        Then the viewport restores the previous view
