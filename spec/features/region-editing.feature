Feature: Region Editing

    # @test tests/bdd/regionEditing.test.ts
    # @hint dispatch updateRegionInOut, then undo, assert store state
    Scenario: A regions start bounds can be undone
        Given A region with start 10 and end 20
        When The regions start is changed to 15
        And The change is undone
        Then the regions start is 10

    # @test tests/bdd/regionEditing.test.ts
    # @hint dispatch updateRegionInOut, then undo, assert store state
    Scenario: A regions end bounds can be undone
        Given A region with start 10 and end 20
        When The regions end is changed to 25
        And The change is undone
        Then the regions start is 10

    # @test tests/bdd/regionEditing.test.ts
    # @hint dispatch updateRegionInOut with inPoint > outPoint, assert region shifts to preserve length
    Scenario: A regions start bound being changed to after end moves region
        Given A region with start 10 and end 20
        When The regions start is changed to 25
        Then The regions moved to (25,35) so its length is unchanged

    # @test tests/bdd/regionEditing.test.ts
    # @hint dispatch updateRegionInOut with outPoint < inPoint, assert region shifts
    Scenario: Out point set for region before beginning point creates a new region
        Given a region with start 30 and end 40
        When the Set Out Point Button is clicked when the playhead is at 20
        Then a new region is created starting at 20. The region is 10% of the viewport, minimum 5 seconds, max up to the next region,

    # @test tests/bdd/regionEditing.test.ts
    # @hint mirror of the out-before-in scenario; uses calcNewRegionBoundsUpToNext
    Scenario: In point set for region after end point creates a new region
        Given a region with start 10 and end 20
        When the Set In Point Button is clicked when the playhead is at 30
        Then a new region is created starting at 30. The region is 10% of the viewport, minimum 5 seconds, max up to the next region or end of video

    # @test tests/bdd/regionEditing.test.ts
    # @hint use Scenario Outline examples as test.each; dispatch updateRegionInOut, assert clamped result
    Scenario Outline: A region is prevented from being too small
        Given the current region spans from 10 to 20 seconds and min length 1
        When the region is attempet to resize to <a> to <b>
        Then the region span is now <c> to <d> seconds
        Examples:
            | a  | b  | c  | d  |
            | 10 | 10 | 10 | 11 |
            | 10 |10.5| 10 | 11 |
            | 20 | 20 | 19 | 20 |
            |19.5| 20 | 19 | 20 |

    # @test tests/bdd/regionZoom.test.tsx
    # @hint render Timeline with clip overlay via tests/harnesses/timeline.tsx,
    #       fireEvent.doubleClick on .clip-overlay__bar, assert onClipOverlayZoom spy called with region id
    Scenario: A regions zoom action is called when double clicked
        Given A region
        When the user double clicks the handle
        Then The zoom action is called

    # @test tests/bdd/regionZoom.test.tsx
    # @hint call calcZoomToRegion(currentView, regionIn, regionOut, null),
    #       assert nextView equals { start: regionIn, end: regionOut }
    Scenario: A region when zoom action is called fills up the time bar
        Given A region that is not perfectly fit to the timeline
        When the user calls the zoom action into that region
        Then the zoom and bounds are set so the region is 100% of the timeline

    # @test tests/bdd/regionZoom.test.tsx
    # @hint call calcZoomToRegion with current view matching region (viewFitsRegion=true),
    #       pass savedView as restore param, assert nextView equals savedView and previousView is null
    Scenario: A region already zoomed when zoom action is called will zoom out
        Given A region had the zoom action called on
        And zoom / pan is still centered on the region
        When the user calls the zoom action again
        Then the zoom and bounds are set to what it was when the user called the zoom action

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
            | timeline overlay  |

    # @test tests/bdd/regionClickSeek.test.tsx
    # @hint Clicking an already-active region still re-seeks to inPoint.
    Scenario: Clicking the already-active region still seeks to its start
        Given a region spans from 30 to 45 seconds and is the active region
        And the playhead is at 40 seconds
        When the user clicks the same region again
        Then the playhead moves to 30 seconds

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




