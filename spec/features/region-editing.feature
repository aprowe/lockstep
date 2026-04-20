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




