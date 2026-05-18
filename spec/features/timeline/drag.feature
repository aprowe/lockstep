Feature: Timeline Drag Gestures

    # PR3 extracts the controller; PR4 adds the BDD steps that drive these.

    Scenario: Lasso arms on pointerdown in an empty area
        Given [a video is loaded]
        When the user presses the mouse in an empty area of the timeline
        Then the controller arms a lasso gesture but does not yet activate it

    Scenario: Lasso activates after 4 pixels of movement
        Given a lasso gesture is armed
        When the pointer moves more than 4 pixels from the start position
        Then the lasso activates and begins updating selection

    Scenario: Lasso released before threshold becomes a click
        Given a lasso gesture is armed but never crossed the 4 pixel threshold
        When the user releases the pointer with no modifier keys held
        Then a regular click is dispatched at that position

    Scenario: Lasso released before threshold with Ctrl held only seeks
        Given a lasso gesture is armed with Ctrl held but never crossed the threshold
        When the user releases the pointer
        Then the playhead seeks to the click position
        And selections are not cleared

    Scenario: Lasso vertical coverage decides which selection sets update
        Given a lasso gesture is active
        When the lasso vertically covers a markerin or markerout row
        Then anchor selection updates
        When the lasso vertically covers a clipin or clipout row
        Then clip selection updates
        When the lasso vertically covers the scenes row
        Then scene selection updates

    Scenario: Ctrl-held at lasso start makes the lasso additive
        Given an existing selection
        When the user starts a lasso with Ctrl or Cmd held
        Then the lasso adds to the existing selection rather than replacing it

    Scenario: Anchor drag input-space snaps to scenes and clip boundaries
        Given an anchor exists on the input track
        When the user drags the anchor close to a scene cut or clip edge
        Then the anchor snaps to that target
        And no BPM grid snapping applies in input space

    Scenario: Anchor drag output-space snaps to BPM grid clamped to smallest visible tick
        Given an anchor exists on the output track
        And a snap interval is configured
        When the user drags the anchor
        Then the anchor snaps to the BPM grid
        And the effective grid spacing is never finer than the smallest visible tick

    Scenario: Snap hint candidates published during anchor drag input
        Given the user is dragging an anchor in input space
        Then up to 2 snap candidates on each side of the cursor are published
        And the timeline highlights them as preview hints

    Scenario: Only the active snap hint publishes during anchor drag output
        Given the user is dragging an anchor in output space
        Then only the currently snapping target is published as a hint

    Scenario: Region edge drag snaps to anchors, scenes, other regions, and grid (output only)
        Given a region exists
        When the user drags one edge of the region
        Then the edge snaps to anchors in the matching space
        And scenes only when in input space
        And other regions' edges in either space
        And the BPM grid only in output space

    Scenario: Region-move publishes drag time for whichever edge wins the snap
        Given a region is being moved
        When one of its edges wins a snap
        Then the published drag time corresponds to that edge

    Scenario: Region edge clamp — minimum 0.1 second span
        Given a region is being resized
        When the resize would shrink the region below 0.1 seconds
        Then the edge stops at 0.1 seconds from the opposite edge

    Scenario: Region edge clamp — region stays inside [0, MAX]
        Given a region is being resized
        When the resize would push an edge outside [0, MAX]
        Then the edge stops at the boundary

    Scenario: Follow-drag mode also seeks the playhead while dragging an anchor
        Given Follow-drag is enabled
        When the user drags an anchor
        Then the playhead also seeks to the anchor's current time

    Scenario: Scrub during ruler drag publishes scrubTime
        Given the user is dragging on the ruler
        Then the controller publishes scrubTime continuously
        And consumers (timecode, thin minimap) see the live time

    Scenario: pointercancel during drag resets state without committing
        Given a drag is in progress
        When the OS sends pointercancel
        Then the drag state resets
        And no commit intent fires

    Scenario: Window blur during drag resets state without committing
        Given a drag is in progress
        When the window loses focus
        Then the drag state resets
        And no commit intent fires

    Scenario: Escape key during drag resets state without committing
        Given a drag is in progress
        When the user presses Escape
        Then the drag state resets
        And no commit intent fires

    Scenario Outline: Cursor changes by hit kind
        Given the user hovers over <hit>
        Then the cursor becomes <cursor>
        Examples:
            | hit                          | cursor    |
            | an anchor                    | grab      |
            | a region body                | grab      |
            | a region edge                | ew-resize |
            | a scene marker               | pointer   |

    Scenario: Cursor becomes grabbing while dragging an anchor or region
        Given the user is dragging an anchor or region body
        Then the cursor is grabbing for the duration of the drag

    Scenario Outline: Right-click dispatches by hit kind
        Given the user right-clicks <hit>
        Then the controller emits <intent>
        Examples:
            | hit                       | intent                    |
            | an anchor (input)         | anchorContextMenu         |
            | a beat anchor (output)    | beatAnchorContextMenu     |
            | a region                  | regionContextMenu         |
            | a scene marker            | sceneContextMenu          |
            | an empty area             | timelineContextMenu(time) |

    Scenario Outline: Double-click dispatches by hit kind
        Given the user double-clicks <hit>
        Then the controller emits <intent>
        Examples:
            | hit             | intent       |
            | an anchor       | anchorDelete |
            | a region        | regionZoom   |
            | a scene marker  | sceneDelete  |

    Scenario Outline: Double-click on an empty track creates the right object
        Given the user double-clicks on an empty area of <row>
        Then the controller emits <intent>
        Examples:
            | row        | intent     |
            | scenes     | sceneAdd   |
            | clipin     | regionAdd  |
            | markerin   | anchorAdd  |

    Scenario: Delete or Backspace fires timelineDelete
        When the user presses Delete or Backspace with the timeline focused
        Then the controller emits timelineDelete

    Scenario: Cmd/Ctrl+D fires timelineDeselect
        When the user presses Cmd/Ctrl + D with the timeline focused
        Then the controller emits timelineDeselect

    Scenario: Hovering a scene drives the scene-thumbnail popup
        Given a scene marker exists
        When the user hovers over the diamond
        Then the global scene-thumbnail popup positions itself at the diamond
        When the user hovers off the diamond
        Then the popup hides

    # ── Multi-select drag + linked-pair drag (TODO: not yet implemented) ──

    Scenario: Multiple selected objects drag together
        Given several timeline objects of the same kind are selected
        When the user drags any one of the selected objects
        Then every selected object moves by the same time delta
        And the relative spacing between them is preserved

    Scenario: Mixed-type multi-select drags coherently
        Given an anchor and a clip and a scene marker are all selected
        When the user drags any one of the selected objects
        Then all three move together by the same time delta
        And each stays in its own track

    Scenario: Dragging an input anchor moves only the input anchor
        Given an input anchor and an output beat anchor share the same pair id
        When the user drags the input anchor
        Then only the input anchor moves
        And the beat partner's time is unchanged

    Scenario: Dragging an output anchor moves only the output anchor
        Given an input anchor and an output beat anchor share the same pair id
        When the user drags the output anchor in beat space
        Then only the beat anchor moves
        And the input partner's time is unchanged

    Scenario: Dragging a warp line moves both paired anchors by the same delta
        Given an input anchor and an output beat anchor share the same pair id
        When the user drags the warp line connecting that pair
        Then both the input anchor and the beat anchor move by the same delta
        And no other anchors are affected

    Scenario: Dragging a warp line for a pair without a partner does nothing
        Given an input anchor with no beat-space partner of the same id
        When the user attempts to drag the warp line at that anchor
        Then no anchor moves
        And no commit intent fires

    Scenario: Dragging a clip with linked in/out moves both bounds together
        Given a region whose inBeatTime equals inPoint and outBeatTime equals outPoint (default-linked)
        When the user drags the clipin track on the region body
        Then both the input bounds and the beat-space bounds move by the same delta
        And the linked state is preserved

    Scenario: Dragging a clip after its bounds diverged moves only the input bounds
        Given a region whose inBeatTime or outBeatTime has diverged from the input bounds (no longer linked)
        When the user drags the clipin track on the region body
        Then only the input bounds (inPoint / outPoint) move
        And the beat-space bounds (inBeatTime / outBeatTime) stay where they were

    # ── Combined-selection drag (cross-kind) + warp-row click selects pair ──

    Scenario: Combined-selection drag moves all selected objects by the same delta
        Given multiple objects of mixed kinds (anchors, regions, scenes) are selected
        When the user drags any one of the selected objects
        Then every selected object moves by the same time delta
        And objects that were not selected do not move

    Scenario: Combined-selection drag captures both spaces when input and output anchors are selected
        Given an input anchor and a beat anchor are both in the current selection
        When the user drags any selected anchor
        Then the input anchor and the beat anchor both move by the same time delta
        And no warp-line gesture is needed — the selection already pairs them

    Scenario: Clicking a warp line selects both paired anchors (no drag)
        Given an input anchor and an output beat anchor share the same pair id
        When the user clicks the warp line connecting them without dragging
        Then both the input anchor id and the beat anchor id are added to their respective selections on pointerUp
        And no anchor moves

    Scenario: Dragging a warp line moves the pair without changing selection
        Given an input anchor and an output beat anchor share the same pair id
        When the user clicks and drags the warp line in one continuous gesture
        Then both partner anchors move by the same time delta as the drag
        And no selection intent fires (drag does not change selection)

    Scenario: Hovering over a warp connector publishes a hovered state for the pair
        Given an input anchor and an output beat anchor share the same pair id
        When the user moves the mouse over the warp connector line
        Then the controller publishes a hovered-warp-line intent for that pair id
        And the cursor becomes grab

    Scenario: Hover state clears when the mouse leaves the warp connector
        Given the user is hovering a warp connector
        When the mouse moves off the connector onto an empty area
        Then the hovered-warp-line is published as null
        And the cursor returns to its default

    Scenario: Dragging a warp connector or a paired anchor selection snaps to BOTH input and output targets
        Given a paired pointer drag is active — either started from a warp connector OR from a selection containing both partner ids
        And there is a scene cut in input space and a BPM grid line in output space
        When the user drags the pair
        Then the snap considers both the input-space targets AND the output-space targets
        And the winning delta aligns whichever side has the closest target

    Scenario: Pair drag live-updates both anchors during pointerMove
        Given a pair drag is in progress
        When the pointer moves
        Then the live input anchor time and the live beat anchor time both update by the current drag delta
        And pubDragTime publishes the drag time for at least one of the two spaces (or both, controller choice)

    # ── Combined drag publishes live state for EVERY captured item ──
    # These guarantee that the gesture-store broadcast and the canvas draw
    # reflect every captured object during the drag (not just one), so
    # downstream panels (RegionInfoPanel, etc.) and the canvas visualize all
    # moving items live.

    Scenario: Combined drag publishes live positions for every captured region
        Given two regions are both in the current selection
        When the user drags one of them
        Then the gesture store publishes live in/out points for both regions during the drag
        And the gesture store's "most recent" singular dragRegion remains addressable for legacy consumers

    Scenario: Combined anchor+region drag publishes live region positions for every captured region
        Given an anchor and two regions are all in the current selection
        When the user drags the anchor
        Then the gesture store publishes live in/out points for both captured regions during the drag

    # ── Drag does not affect selection — click on pointerUp instead ──
    # pointerDown never emits a select intent. It just arms the drag.
    # pointerUp WITHOUT movement emits *Select (additive when shift/ctrl/cmd).
    # pointerUp AFTER movement emits no *Select (the drag committed its move).
    # Dragging an UN-selected object does single-object drag (only that object
    # moves); the existing selection is left alone.

    Scenario: Clicking an unselected object selects it on pointerUp (not pointerDown)
        Given an unselected anchor exists
        When the user presses and releases on the anchor without moving
        Then the anchor becomes selected on pointerUp
        And no selection intent fired on pointerDown

    Scenario: Dragging an unselected object moves only that object and does not change selection
        Given an unselected anchor exists
        And there is an unrelated selection elsewhere
        When the user presses on the anchor and drags it
        Then only the dragged anchor moves
        And the unrelated selection is unchanged
        And no selection intent fires during or after the drag

    Scenario: Dragging a selected object performs a combined drag and does not change selection
        Given an anchor is selected
        And another anchor is also selected
        When the user presses on the first anchor and drags
        Then both anchors move by the same delta (combined drag)
        And the selection set is unchanged after pointerUp

    Scenario: Clicking an unselected region selects it on pointerUp
        Given an unselected region exists
        When the user presses and releases on the region without moving
        Then the region becomes selected on pointerUp
        And no regionSelect intent fired on pointerDown

    Scenario: Dragging an unselected region moves only that region and does not change selection
        Given an unselected region exists
        And there is an unrelated selection elsewhere
        When the user presses on the region and drags it
        Then only the dragged region moves
        And the unrelated selection is unchanged
        And no regionSelect intent fires during or after the drag

    Scenario: Clicking a region-edge selects the region on pointerUp
        Given a region exists
        When the user presses and releases on the region's edge without moving
        Then the region becomes selected on pointerUp
        And no regionSelect intent fired on pointerDown

    Scenario: Clicking a warp-line defers select to pointerUp
        Given an input anchor and an output beat anchor share the same pair id
        When the user presses and releases on the warp line without moving
        Then both partners get selected on pointerUp
        And no selection intent fired on pointerDown

    # ── Warp-line drag delta from cursor, not from anchor ──
    # The warp line spans diagonally between an input anchor and a beat anchor.
    # The grab point can be anywhere along the line — the drag must translate
    # both anchors by exactly the cursor pixel delta, NOT realign to the
    # input-anchor's time coordinate.

    Scenario: Dragging a warp connector translates anchors by cursor pixel delta, not by input-anchor alignment
        Given an input anchor at 10 seconds and a beat anchor at 20 seconds share the same pair id
        And the user grabs the warp connector midway between the two
        When the user moves the cursor by 50 pixels (which in the current view equals 5 seconds)
        Then the input anchor moves to 15 seconds
        And the beat anchor moves to 25 seconds
        And the pair did not "snap" to align with the initial grab point

