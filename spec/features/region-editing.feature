Feature: Region Editing

    Scenario: A regions start bounds can be undone
        Given A region with start 10 and end 20
        When The regions start is changed to 15
        And The change is undone
        Then the regions start is 10

    Scenario: A regions end bounds can be undone
        Given A region with start 10 and end 20
        When The regions end is changed to 25
        And The change is undone
        Then the regions start is 10

    Scenario: A regions start bound being changed to after end moves region
        Given A region with start 10 and end 20
        When The regions start is changed to 25
        Then The regions moved to (25,35) so its length is unchanged

    Scenario: A regions end bound being changed to before start moves region
        Given A region with start 30 and end 40
        When The regions end is changed to 20
        Then The regions moved to (10,20) so its length is unchanged

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

    Scenario: A regions zoom action is called when double clicked
        Given A region
        When the user double clicks the handle
        Then The zoom action is called

    Scenario: A region when zoom action is called fills up the time bar
        Given A region that is not perfectly fit to the timeline
        When the user calls the zoom action into that region
        Then the zoom and bounds are set so the region is 100% of the timeline

    Scenario: A region already zoomed when zoom action is called will zoom out
        Given A region had the zoom action called on
        And zoom / pan is still centered on the region
        When the user calls the zoom action again
        Then the zoom and bounds are set to what it was when the user called the zoom action




