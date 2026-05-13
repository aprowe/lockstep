Feature: Timeline Tracks

    # Track-level UI semantics: clicks on empty area, context menus,
    # lasso selection, and double-click create/delete.
    #
    # Clipin/clipout bounds, conform/link behavior, lock/BPM editing,
    # and BPM-tick-grid updates live in clip-bounds.feature.
    # Pointer state machine, anchor/region drag mechanics, snap, and
    # warp connector behavior live in drag.feature.

    Scenario: Click on empty area when nothing is selected
        Given [a video is loaded]
        When the user clicks on an empty area of the timeline
        Then the playhead jumps to the clicked time

    Scenario: Click on empty area when something is selected
        Given [a video is loaded]
        And there is a non empty selection of objects
        When the user clicks on an empty area of the timeline
        Then the playhead stays where it is
        And selection is cleared

    Scenario: Right-click on the timeline opens a three-section context menu
        Given [a video is loaded]
        When the user right-clicks anywhere in the timeline area
        Then a context menu appears with three sections: target-specific, track-specific, and global timeline actions
        And global actions may be promoted to track-specific when the context calls for it

    Scenario: Lasso drag within a single track selects its objects
        Given [a video is loaded]
        And markers are placed on the current track
        When the user drags across an empty area of the track
        Then the dragged area is highlighted as a lasso within that track
        When the mouse is released
        Then the objects inside the lasso are selected

    Scenario: Lasso drag expands across tracks when the mouse leaves the starting track
        Given [a video is loaded]
        And markers are placed on the current track
        When the user drags across an empty area of the track
        And the drag enters another track
        Then the lasso leaves single-track mode and can span multiple object types
        When the mouse is released
        Then all objects inside the lasso are selected

    Scenario: Lasso across both boundaries of a clip selects that clip
        Given [a video is loaded]
        And clip 1 exists
        When the user drags across both boundaries of the clip
        Then the clip is selected

    Scenario Outline: Double-click in a track's empty area creates a new object
        Given [a video is loaded]
        And the mouse is over an empty area on a <layer>
        When the user double-clicks
        Then the track creates a new <object> at the cursor position
        Examples:
            | layer          | object       |
            | input_timeline | marker       |
            | scene_strip    | scene marker |
            | region_strip   | clip         |

    Scenario Outline: Double-click on an object in a track performs its primary action
        Given [a video is loaded]
        And the mouse is over an <object> on a <layer>
        When the user double-clicks
        Then the track performs <action> for the <object> under the cursor
        Examples:
            | layer          | object       | action |
            | input_timeline | marker       | delete |
            | scene_strip    | scene marker | delete |
            | region_strip   | clip         | zoom   |

    Scenario Outline: Right-click on an object shows object-specific actions above track and global options
        Given [a video is loaded]
        And the mouse is over a <object> in <layer>
        When the user right-clicks
        Then the context menu shows <actions> above the track and global options
        Examples:
            | layer          | object           | actions                                              |
            | input_timeline | marker           | delete,snap,seek,reset link                          |
            | input_timeline | marker selection | delete,snap,seek,reset link,create clip from markers |
            | multiple       | mixed            | delete                                               |
            | scene_strip    | scene marker     | delete,rename                                        |
            | region_strip   | clip             | delete,rename,export,zoom                            |

    Scenario Outline: Right-click on an empty track shows track-specific create actions
        Given [a video is loaded]
        And the mouse is inside <layer>
        When the user right-clicks
        Then the context menu shows <actions> above the track and global options
        Examples:
            | layer          | actions    |
            | input_timeline | new marker |
            | scene_strip    | new scene  |
            | region_strip   | new region |
