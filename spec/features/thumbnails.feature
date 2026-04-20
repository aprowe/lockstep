Feature: Thumbnail scrolling

    @todo
    Scenario: Thumbnails loaded
        Given an empty project
        When [a video is loaded]
        Then thumbnails in the background start being generated

    @todo
    Scenario: Thumbnails prioritized for frames near playhead
        Given [a video is loaded]
        When the playhead jumps to a new position
        Then the thumbnails for frames near the playhead are generated first, and thumbnails nearby are quickly generated

    @todo
    Scenario: Regions get thumbnails generated for them
         Given [a video is loaded]
         When a [region] is created or updated
         Then thumbnails for frames in that region are quickly generated

    @todo
    Scenario: The thumbnails appear when [scrubbing] on the [input ruler]
        Given [a video is loaded]
        When the [input ruler] is [scrubbed]
        Then the thumbnail viewer will show the current frame the playhead is on and X frames before and after,
            where X is the number of thumbnails that can fit in the thumbnail viewer

    @todo
    Scenario: the thumbnails show a thumbnail placeholder when thumbnails are not loaded
        Given The thumbnail viewer is active and visible
        When a thumbnail is shown for a frame that has not had its thumbnail generated yet
        Then a placeholder thumbnail is shown until the thumbnail for that frame is generated

    @todo
    Scenario: A thumbnail appears in a pop up when scene changes are hovered over
        Given [a video is loaded]
        And the [scene strip] is populated
        And the [scene_strip] is not expanded
        When the user hovers over a scene marker
        Then a thumbnail of the frame at the scene change is shown in a pop up

    @todo
    Scenario: A thumbnails appear of scene markers in the expanded [scene strip]
        Given [a video is loaded]
        And the scene strip is populated
        When the scene strip is expanded
        Then thumbnails are shown of the different markers, in an area contained in the scene strip

