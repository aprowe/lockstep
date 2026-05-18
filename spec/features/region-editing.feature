Feature: Region Editing

    # @test tests/bdd/regionClickSeek.test.tsx
    # @hint Applies to both the ClipSidebar row click and the timeline region
    #       overlay bar click. On selection, seek the player to region.inPoint.
    #       Do NOT toggle playing state — if the video was playing, it keeps
    #       playing from the new position; if paused, it stays paused.
    Scenario Outline: Clicking a region moves the playhead to its start
        Given a region spans from 30 to 45 seconds
        And the playhead is at 50 seconds
        When the user clicks the region in the <surface>
        Then the playhead moves to 30 seconds
        And the playback state is unchanged
        Examples:
            | surface           |
            | clip sidebar      |

    # @test tests/bdd/clipSidebarRename.test.tsx
    # @hint ClipSidebar row needs an onContextMenu handler that opens the
    #       existing ContextMenu with a "Rename" item. Selecting it calls the
    #       same handleStartRename(region) path the double-click already uses.
    Scenario: Right-clicking a clip in the sidebar opens a menu with Rename
        Given a clip named "Verse" in the clip sidebar
        When the user right-clicks the clip row
        Then a context menu appears with a Rename option
        When the user selects Rename
        Then the clip name becomes an inline editable input with the current name selected
        And committing the edit updates the clip's name
