@todo @ignore
Feature: Ruler Layer

    Scenario: input ruler is scrubbed
        Given [a video is loaded]
        When the mouse is dragged horizontally along the [input ruler]
        Then the playhead scrubs along with the mouse movement
        And the video frame updates to match the playhead position


