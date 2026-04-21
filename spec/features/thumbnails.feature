Feature: Thumbnail scrolling

    Scenario: Thumbnails start generating when a video loads
        Given an empty project
        When [a video is loaded]
        Then thumbnail generation starts in the background

    Scenario: Thumbnails near the playhead are generated first
        Given [a video is loaded]
        When the playhead jumps to a new position
        Then thumbnails near the playhead are generated before thumbnails elsewhere

    Scenario: Thumbnails inside a region are generated first
        Given [a video is loaded]
        When a [region] is created or updated
        Then thumbnails for frames inside that region are generated first

    Scenario: Scrubbing the [input ruler] updates the thumbnail viewer
        Given [a video is loaded]
        When the [input ruler] is [scrubbed]
        Then the thumbnail viewer shows the playhead frame plus as many surrounding frames as fit in the viewer

    Scenario: Filmstrip center slot equals the toolbar frame counter
        Given [a video is loaded]
        When the playhead is at a time whose frame conversion is ambiguous due to floating-point error
        Then the center slot of the filmstrip shows exactly the frame displayed by the toolbar frame counter
        And the slot immediately right of center shows that frame plus one
        And the slot immediately left of center shows that frame minus one

    Scenario: Missing thumbnails show a placeholder
        Given the thumbnail viewer is active and visible
        When a thumbnail is requested for a frame whose thumbnail has not been generated yet
        Then a placeholder is shown in its place until the real thumbnail is available

    Scenario: Hovering a scene marker shows a thumbnail popup
        Given [a video is loaded]
        And the [scene strip] is populated
        And the [scene strip] is not expanded
        When the user hovers over a scene marker
        Then a thumbnail of the frame at that scene change appears in a popup

    Scenario: Expanded scene strip shows one thumbnail per marker
        Given [a video is loaded]
        And the [scene strip] is populated
        When the [scene strip] is expanded
        Then a thumbnail of each scene marker's frame is shown inline inside the scene strip
