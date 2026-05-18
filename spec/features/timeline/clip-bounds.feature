Feature: Clip Bounds

    # See docs/superpowers/specs/2026-05-11-region-lock-conform-design.md.
    #
    # A region has TWO parallel sets of bounds:
    #   clipin  (input space):  region.inPoint / outPoint        — seconds in source
    #   clipout (beat space):   region.inBeatTime / outBeatTime  — seconds in output
    #
    # Default-linked: (inBeatTime, outBeatTime) === (inPoint, outPoint).
    # Diverged: any operation that breaks that equality.
    #
    # Three coupled quantities per region:
    #   beats = clipoutLength × BPM / 60
    # `region.lock` says which quantity ABSORBS a clipout-length change:
    #   lock='bpm'   → BPM stays; lockedBeats absorbs
    #   lock='beats' → lockedBeats stays; BPM absorbs

    # ── §1. Foundational state ────────────────────────────────

    Scenario: A new region is default-linked
        Given a region is freshly created from 10 to 20 seconds
        Then inBeatTime equals inPoint (10) and outBeatTime equals outPoint (20)
        And clipin and clipout render at the same horizontal positions
        And the region is reported as default-linked

    Scenario: Default-linked clipout renders at the clipin bounds
        Given a region exists in its default-linked state
        And no anchor sits on either boundary
        Then clipout's in-edge displays at inPoint
        And clipout's out-edge displays at outPoint

    Scenario: Region is diverged after any operation that breaks input/beat equality
        Given a region in its default-linked state
        When inBeatTime is set to a value different from inPoint by any path
        Then the region is reported as diverged
        And clipin and clipout no longer share horizontal positions

    # ── §2. Clipin (input-space) bounds editing ───────────────
    # @test tests/bdd/timeline/clip-bounds.test.ts

    Scenario: A region's start bound can be undone
        Given a region with start 10 and end 20
        When the region's start is changed to 15
        And the change is undone
        Then the region's start is 10

    Scenario: A region's end bound can be undone
        Given a region with start 10 and end 20
        When the region's end is changed to 25
        And the change is undone
        Then the region's start is 10

    Scenario: Setting in-point past out-point shifts the region to preserve length
        Given a region with start 10 and end 20
        When the region's start is changed to 25
        Then the region moves to (25,35) so its length is unchanged

    Scenario: Set-Out-Point with playhead before in-point creates a new region
        Given a region with start 30 and end 40
        When the Set Out Point Button is clicked when the playhead is at 20
        Then a new region is created starting at 20. 

    Scenario: Set-In-Point with playhead after out-point creates a new region
        Given a region with start 10 and end 20
        When the Set In Point Button is clicked when the playhead is at 30
        Then a new region is created starting at 30. 

    Scenario Outline: A region is prevented from being too small
        Given the current region spans from 10 to 20 seconds and min length 1
        When the region is attempted to resize to <a> to <b>
        Then the region span is now <c> to <d> seconds
        Examples:
            | a   | b    | c  | d  |
            | 10  | 10   | 10 | 11 |
            | 10  | 10.5 | 10 | 11 |
            | 20  | 20   | 19 | 20 |
            | 19.5| 20   | 19 | 20 |

    Scenario: A region's zoom action is called when double-clicked
        Given a region
        When the user double-clicks the handle
        Then the zoom action is called

    Scenario: Zoom-to-region fills the timeline
        Given a region that is not perfectly fit to the timeline
        When the user calls the zoom action on that region
        Then the zoom and bounds are set so the region is 100% of the timeline

    Scenario: Zoom-to-region a second time restores the prior view
        Given a region that had the zoom action called on it
        And zoom / pan is still centered on the region
        When the user calls the zoom action again
        Then the zoom and bounds are set to what they were before the first zoom

    # ── §3. Object isolation (anchor ↔ clip) ──────────────────
    # Dragging an anchor never moves the clip boundary; dragging a clip
    # never moves anchors. These are independent objects living in the
    # same coordinate space.

    Scenario: Dragging an anchor does not move the clip boundary
        Given a region exists from 10 to 20 seconds
        And an anchor is placed at the region's in point
        When the user drags the anchor to a new position
        Then the region's in point remains at 10 seconds
        And only the anchor moves

    Scenario: Dragging a clip in does not move anchors
        Given a region exists from 10 to 20 seconds
        And an anchor in is placed at 15 seconds
        When the user drags the clip in to a new position
        Then the anchor in remains at 15 seconds
        And only the clip boundaries move

    Scenario: Dragging a default-linked clip in also moves the clipout edges
        Given a region exists from 10 to 20 seconds
        When the user drags the clip in to 15 - 25
        Then clip out edges move as well, since they are linked

    # ── §4. Linked-to-anchor state (derived, never stored) ────
    # A clip edge can be "linked" to an anchor via either space:
    #
    #   INPUT-side link:  inputAnchor.inputTime === region.inPoint
    #                     (or outPoint)
    #   OUTPUT-side link: beatAnchor.beatTime === region.inBeatTime
    #                     (or outBeatTime)
    #
    # Both forms are DERIVED — recomputed each frame from current
    # positions, never stored. The two can coexist on the same edge:
    # an edge that was input-linked has a paired beat anchor that
    # naturally sits at the matching beat coord, so it's also
    # output-linked. They diverge when only one anchor is present
    # (e.g. an orphan beat anchor pinned to outBeatTime with no input
    # partner).

    # ── §4a. Input-side link ──

    Scenario: In-edge is input-linked while their input times coincide
        Given a region exists with inPoint at 10 seconds
        And an input anchor exists at input time 10 seconds
        Then the region's in-edge is reported as input-linked to that anchor

    Scenario: Out-edge is input-linked symmetrically
        Given a region with outPoint at 20 seconds
        And an input anchor at input time 20 seconds
        Then the region's out-edge is reported as input-linked to that anchor

    Scenario: Input-link is broken the moment coincidence is lost
        Given a region's in-edge is input-linked to an input anchor
        When the input anchor's input time changes such that it no longer equals inPoint
        Then the in-edge is no longer input-linked
        And inBeatTime keeps its last committed value (no auto-revert)

    Scenario: Any path to input-coincidence establishes the input-link
        Given a region exists with inPoint at 10 seconds
        And no input anchor sits at 10 seconds yet
        When an input anchor is created at 10 seconds by any path (drag, button, programmatic)
        Then the region's in-edge becomes input-linked to that new anchor

    Scenario: When two input anchors share an input time, the earliest pair id wins
        Given two input anchors share input time 10 seconds with pair ids 3 and 7
        And a region exists with inPoint at 10 seconds
        Then the in-edge is reported as input-linked to the anchor with pair id 3

    # ── §4b. Output-side link (symmetric) ──

    Scenario: In-edge is output-linked while a beat anchor's time equals inBeatTime
        Given a region exists with inBeatTime at 5 seconds
        And a beat anchor exists at beat time 5 seconds
        Then the region's in-edge is reported as output-linked to that beat anchor
        And the clipout's in-edge displays at the beat anchor's beat time

    Scenario: Out-edge is output-linked symmetrically
        Given a region with outBeatTime at 20 seconds
        And a beat anchor at beat time 20 seconds
        Then the region's out-edge is reported as output-linked to that beat anchor

    Scenario: Output-link is broken the moment coincidence is lost
        Given a region's out-edge is output-linked to a beat anchor
        When the beat anchor's beat time changes such that it no longer equals outBeatTime
        Then the out-edge is no longer output-linked
        And outBeatTime keeps its last committed value (no auto-revert)

    Scenario: Any path to output-coincidence establishes the output-link
        Given a region exists with outBeatTime at 20 seconds
        And no beat anchor sits at beat time 20 yet
        When a beat anchor is created at beat time 20 by any path (drag, programmatic)
        Then the region's out-edge becomes output-linked to that new beat anchor

    Scenario: When two beat anchors share a beat time, the earliest pair id wins
        Given two beat anchors share beat time 20 seconds with pair ids 3 and 7
        And a region exists with outBeatTime at 20 seconds
        Then the out-edge is reported as output-linked to the anchor with pair id 3

    Scenario: An edge can be input-linked and output-linked simultaneously
        Given a region with inPoint 10 and inBeatTime 6
        And an input anchor at input time 10 with paired beat anchor at beat time 6
        Then the in-edge is reported as input-linked to the input anchor
        And the in-edge is reported as output-linked to the paired beat anchor

    # ── §5. Conforming to markers — linking event ─────────────
    # The linking event fires the first moment a boundary coincides
    # with an anchor — input-side (§5a) or output-side (§5b).
    # ALL effects are LIVE during the drag; nothing persists until
    # pointerUp at coincidence. The linking event ALWAYS behaves
    # like lock='bpm' (BPM stays, beats absorbs), regardless of the
    # region's actual lock setting — linking is the user asserting
    # where the edge sits in beat-space.

    # ── §5a. Input-side linking event ──

    @todo @ignore
    Scenario: All linking effects are live during the drag, not yet committed
        Given a region with inPoint 10, outPoint 20, BPM 120, lock='bpm'
        And an input anchor pair with input time 12 and beat time 6
        When the user drags the input anchor toward the in-edge
        And the anchor's input time momentarily reaches 10
        Then the clipout's in-edge displays at beat time 6 (the paired beat anchor)
        And the RegionInfoPanel shows the new lockedBeats live
        And nothing has yet been committed to undoable state

    Scenario: Linking event commits on pointerUp at coincidence
        Given a region with inPoint 10, outPoint 20, BPM 120, lock='bpm'
        And an input anchor pair with input time 10 after the drag, beat time 6
        When the user releases the anchor while still at input time 10
        Then inBeatTime is set to 6
        And lockedBeats is recomputed as clipoutLength × bpm / 60
        And BPM is unchanged
        And lock is unchanged

    @todo @ignore
    Scenario: No commit if coincidence is broken before pointerUp
        Given a region with inPoint at 10
        And an input anchor passes through input time 10 during a drag
        When the user releases the anchor at input time 12 (not coincident)
        Then no commit fires
        And inBeatTime, outBeatTime, BPM, lockedBeats all match pre-drag values

    Scenario Outline: Linking event ignores lock — beats always absorbs
        Given a region with lock=<lock>, BPM 120, lockedBeats 20
        When the user drags an anchor onto the in-edge and releases at coincidence
        And the resulting clipout length is 8 seconds
        Then BPM stays at 120
        And lockedBeats becomes 16
        And lock stays at <lock>
        Examples:
            | lock  |
            | bpm   |
            | beats |

    Scenario: Symmetric for out-edge linking
        Given a region with inPoint 10, outPoint 20, BPM 120, lock='bpm'
        And an input anchor pair at input time 20, beat time 18
        When the user releases the anchor coincident with outPoint
        Then outBeatTime is set to 18
        And lockedBeats recomputes from the new clipout length
        And BPM is unchanged

    Scenario: Linking via Set-In-Point button when playhead is on an anchor
        Given an input anchor exists at input time 10 with paired beat time 6
        And the playhead is at 10
        And a region exists with inPoint 12 (currently unlinked)
        When the user clicks Set In Point
        Then inPoint becomes 10
        And inBeatTime is set to 6
        And lockedBeats recomputes
        And BPM is unchanged

    Scenario: Linking via clip body drag onto an anchor
        Given a region with inPoint 12, outPoint 22, lock='beats', lockedBeats 20
        And an input anchor pair at input time 10, beat time 6
        When the user drags the clip body so inPoint lands on 10 and releases
        Then inPoint is 10 and outPoint is 20
        And inBeatTime is set to 6
        And lockedBeats recomputes (BPM stays — even though lock='beats')

    # ── §5b. Output-side linking event ──
    # Symmetric: triggered by a BEAT anchor coinciding with a clipout
    # beat-space edge (inBeatTime / outBeatTime). Same commit rules:
    # live during drag, persists on pointerUp at coincidence, always
    # behaves like lock='bpm' (BPM stays, beats absorbs).

    Scenario: Output-side linking effects are live during the drag
        Given a region with inBeatTime 5, outBeatTime 20, BPM 120, lock='bpm'
        And a beat anchor at beat time 8 (not currently coincident with either edge)
        When the user drags the beat anchor toward the out-edge
        And the anchor's beat time momentarily reaches 20
        Then the clipout's out-edge displays at the beat anchor's live position
        And the RegionInfoPanel shows the new lockedBeats live
        And nothing has yet been committed to undoable state

    Scenario: Output-side linking commits on pointerUp at coincidence
        Given a region with inBeatTime 5, outBeatTime 20, BPM 120, lock='bpm', lockedBeats 30
        And a beat anchor whose beat time, after the drag, is 22
        When the user releases the beat anchor while its beat time equals the clipout's out-edge (i.e. outBeatTime adopts 22)
        Then outBeatTime is set to 22
        And lockedBeats is recomputed as clipoutLength × bpm / 60 (17 × 120 / 60 = 34)
        And BPM is unchanged
        And lock is unchanged

    Scenario: No output-side commit if coincidence is broken before pointerUp
        Given a region with outBeatTime at 20
        And a beat anchor passes through beat time 20 during a drag
        When the user releases the beat anchor at beat time 18 (not coincident with outBeatTime)
        Then no commit fires
        And outBeatTime, BPM, lockedBeats all match pre-drag values

    Scenario Outline: Output-side linking event ignores lock — beats always absorbs
        Given a region with lock=<lock>, BPM 120, lockedBeats 20, clipoutLength 10
        When the user drags a beat anchor onto the out-edge and releases at coincidence
        And the resulting clipout length is 8 seconds
        Then BPM stays at 120
        And lockedBeats becomes 16
        And lock stays at <lock>
        Examples:
            | lock  |
            | bpm   |
            | beats |

    Scenario: Symmetric for in-edge output-linking
        Given a region with inBeatTime 5, outBeatTime 20, BPM 120, lock='bpm'
        And a beat anchor whose beat time, after the drag, is 3
        When the user releases the beat anchor coincident with the clipout's in-edge (inBeatTime adopts 3)
        Then inBeatTime is set to 3
        And lockedBeats recomputes from the new clipout length
        And BPM is unchanged

    Scenario: Output-side linking via clipout edge drag onto a beat anchor
        Given a region with outBeatTime 20, BPM 120, lockedBeats 30
        And a beat anchor exists at beat time 22 (not currently linked to any edge)
        When the user drags the clipout out-edge until it coincides with the anchor at 22 and releases
        Then outBeatTime is 22
        And the out-edge is output-linked to that beat anchor
        And lockedBeats recomputes (BPM stays — linking event always behaves like lock='bpm')

    Scenario: Output-side linking event commits via controller-driven beat-anchor drag
        Given a region with inBeatTime 5, outBeatTime 20, BPM 120, lock bpm, lockedBeats 30 and a beat anchor at beat time 18
        When the user drags the beat anchor from beat time 18 to beat time 20 in the output track and releases
        Then the region's outBeatTime is committed to 20
        And lockedBeats recomputes to 30 from the new clipout length

    # ── §6. Linked-anchor move ────────────────────────────────
    # Once linked, dragging the BEAT anchor of the pair in output space
    # moves the boundary's beat-space coord with it. inPoint stays put
    # so the link remains intact for the duration of the drag. The
    # region's lock now decides what absorbs the length change.

    Scenario: Linked beat-anchor drag is live before commit
        Given a region's in-edge is linked to an anchor pair
        When the user drags the paired beat anchor in output space
        Then the clipout's in-edge follows the beat anchor live
        And the dependent value (BPM or lockedBeats, per lock) updates live
        And nothing is committed until pointerUp

    Scenario: Linked beat-anchor move respects lock='bpm'
        Given a region with BPM 120, lock='bpm', clipout length 10 seconds
        And the in-edge is linked to a beat anchor at beat time 5
        When the user drags the beat anchor to beat time 7 and releases
        Then inBeatTime updates to 7
        And clipout length is 8 seconds
        And BPM stays at 120
        And lockedBeats becomes 16

    Scenario: Linked beat-anchor move respects lock='beats'
        Given a region with BPM 120, lock='beats', lockedBeats 20, clipout length 10
        And the in-edge is linked to a beat anchor at beat time 5
        When the user drags the beat anchor to beat time 7 and releases
        Then inBeatTime updates
        And clipout length is 8 seconds
        And lockedBeats stays at 20
        And BPM becomes 150

    Scenario: Symmetric for out-edge linked-anchor move
        Given a region's out-edge is linked to a beat anchor
        When the user drags the paired beat anchor and releases
        Then outBeatTime tracks the new beat time
        And the lock-dependent value (BPM or lockedBeats) updates

    Scenario: Dragging the INPUT anchor while linked unlinks (no length change)
        Given a region's in-edge is linked to an input anchor
        When the user drags the input anchor away from inPoint and releases
        Then the in-edge is no longer linked
        And inBeatTime is unchanged
        And BPM and lockedBeats are unchanged

    # ── §7. Resizing the clipout (edge drag) ──────────────────
    # Direct manipulation: the user grabs the clipout's in-edge or
    # out-edge and drags it in beat space. Lock decides what absorbs
    # the length change. clipin (input bounds) is never affected.

    Scenario: Clipout in-edge drag is live before commit
        Given a region exists
        When the user begins dragging the clipout's in-edge
        Then inBeatTime updates live with the cursor
        And the lock-dependent value updates live
        And nothing is committed until pointerUp

    Scenario Outline: Clipout in-edge drag commits with lock-dependent derivation
        Given a region with BPM 120, lock=<lock>, lockedBeats 20, clipout length 10
        When the user drags the clipout in-edge to make clipout length <newLen> and releases
        Then BPM is <newBpm>
        And lockedBeats is <newBeats>
        And inPoint and outPoint are unchanged
        Examples:
            | lock  | newLen | newBpm | newBeats |
            | bpm   | 8      | 120    | 16       |
            | bpm   | 12     | 120    | 24       |
            | beats | 8      | 150    | 20       |
            | beats | 12     | 100    | 20       |

    Scenario: Clipout out-edge drag mirrors the in-edge drag
        Given a region with BPM 120, lock='bpm', clipout length 10
        When the user drags the clipout out-edge to make clipout length 12 and releases
        Then BPM stays at 120
        And lockedBeats becomes 24
        And outBeatTime updates (inBeatTime unchanged)
        And inPoint and outPoint are unchanged

    Scenario: Clipout edge drag breaks any prior link on that edge
        Given a region's in-edge is linked to an input anchor
        When the user drags the clipout's in-edge by any nonzero amount
        Then the in-edge is no longer linked (inBeatTime ≠ the anchor's beat time)

    @todo @ignore
    Scenario: Clipout edge drag snaps in output space only
        Given the user is dragging a clipout in-edge or out-edge
        Then the edge snaps to beat anchors
        And to other regions' clipout edges
        And to the BPM grid (output space only)
        And not to scene cuts (scenes live in input space)

    @todo @ignore
    Scenario: Clipout edge cannot resize below minimum length
        Given a region with clipout length 1 second
        When the user drags an edge such that the resulting length would be less than 0.1 seconds
        Then the moving edge stops at 0.1 seconds from the opposite edge

    @todo @ignore
    Scenario: Clipout edge cannot extend past output bounds
        Given a region near the start or end of the output timeline
        When the user drags an edge past [0, OUTPUT_MAX]
        Then the edge clamps to the boundary

    # ── §8. Panning the clipout (body translation) ────────────
    # Translating the whole clipout in beat space: both edges by the
    # same delta. Length is preserved → BPM and lockedBeats both stay.

    Scenario: Clipout body drag is live before commit
        Given a region exists
        When the user begins dragging the clipout body
        Then both inBeatTime and outBeatTime update live by the same delta
        And clipoutLength, BPM, and lockedBeats all stay unchanged in the preview

    Scenario: Clipout body drag commits on pointerUp
        Given a region with inBeatTime 10, outBeatTime 30, BPM 120, lockedBeats 40
        When the user drags the clipout body by +5 seconds and releases
        Then inBeatTime is 15 and outBeatTime is 35
        And clipoutLength stays at 20
        And BPM stays at 120
        And lockedBeats stays at 40
        And inPoint and outPoint are unchanged

    Scenario: Clipout body drag breaks any prior link on either edge
        Given a region's in-edge or out-edge is linked to an input anchor
        When the user drags the clipout body by any nonzero amount
        Then any linked-to-anchor state on either edge is cleared

    @todo @ignore
    Scenario: Clipout body drag snaps symmetrically
        Given the user is translating the clipout body
        Then the dominant edge (whichever has the closer snap target) wins the snap
        And the other edge translates by the same delta

    @todo @ignore
    Scenario: Clipout body drag cannot translate past output bounds
        Given a region near the start or end of the output timeline
        When the user drags the body past [0, OUTPUT_MAX]
        Then the body clamps so both edges remain inside the bounds

    # ── §9. BPM tick grid live updates ────────────────────────

    @todo @ignore
    Scenario: BPM tick grid updates live while dragging a clip
        Given a region exists
        When the user drags the clip in the clipin track
        Then the BPM tick grid repositions in real time to reflect the new clip in point

    @todo @ignore
    Scenario: BPM tick grid updates live while dragging an anchor on the clip boundary
        Given a region exists
        And an anchor sits exactly on the region's in point
        When the user drags the anchor
        Then the BPM tick grid repositions in real time to reflect the anchor's current beat position

    # ── §10. Locking and the three quantities ─────────────────
    # lock = 'bpm'   → BPM stays fixed when clipout length changes;
    #                  lockedBeats absorbs.
    # lock = 'beats' → lockedBeats stays fixed when clipout length changes;
    #                  BPM absorbs.
    # The lock setting does NOT dictate which value the user is allowed
    # to edit. The user can edit BPM or beats directly regardless of lock.

    Scenario: Changing lock from 'bpm' to 'beats' snapshots the current beat count
        Given a region with BPM 120, clipout length 10, lock='bpm'
        And lockedBeats is currently 20 (derived from current length)
        When the user changes lock to 'beats'
        Then lockedBeats becomes the snapshot of beats at the moment of switch (20)
        And BPM, lockedBeats, and clipout length are otherwise unchanged

    Scenario: Changing lock from 'beats' to 'bpm' keeps current BPM as the fixed quantity
        Given a region with lock='beats', lockedBeats 20, clipout length 10, BPM 120
        When the user changes lock to 'bpm'
        Then BPM stays at 120 (now the fixed quantity)
        And lockedBeats and clipout length are unchanged

    Scenario: Lock setting persists across operations until the user changes it
        Given a region with lock='beats'
        When the user performs any clipout edit (resize, pan, or linked-anchor move)
        Then lock remains 'beats' afterward

    @todo @ignore
    Scenario: Lock changing mid-drag rebases the live preview
        Given a clipout-resize drag is in progress with live preview visible
        When the user toggles lock via UI mid-drag
        Then the live preview rebases to the new lock setting immediately
        And the eventual commit (pointerUp) uses the lock value at commit time

    # ── §11. Direct BPM / beats input edit ────────────────────
    # Default: BPM (or beats) edit uses the GRID model — length stays,
    # the lock-dependent value absorbs. Beat anchors don't move.
    # Holding the stretch modifier (Alt) switches to the STRETCH model:
    # the clipout length rescales to keep the OTHER quantity fixed.
    #
    # KEY RULE — what stretch affects:
    # BPM/beats stretch edits ALWAYS operate on the BEAT clipout
    # (inBeatTime / outBeatTime). When DEFAULT-LINKED, the clipin
    # (inPoint / outPoint) follows along — the link is preserved.
    # When DIVERGED, only the beat clipout rescales — clipin stays
    # exactly where the user put it.

    Scenario: Direct BPM edit uses the grid model (length stays, lockedBeats absorbs)
        Given a region with BPM 120, lockedBeats 20, inBeatTime 0, outBeatTime 10
        When applyBpmEdit is dispatched with newBpm 150 and stretch false
        Then BPM becomes 150
        And clipout length stays at 10
        And lockedBeats becomes 25
        And inPoint and outPoint stay unchanged

    @todo @ignore
    Scenario: Stretch-mode BPM edit while DEFAULT-LINKED rescales clipin AND clipout together
        Given a default-linked region with inPoint 10, outPoint 20, BPM 120, lockedBeats 20
        When the user enters BPM 150 while holding the stretch modifier (Alt)
        Then BPM becomes 150
        And clipout length rescales to 8
        And the region stays default-linked (inPoint/outPoint follow to 10..18)
        And inner beat anchors rescale proportionally around inBeatTime

    Scenario: Stretch-mode BPM edit on a diverged region rescales only the clipout
        Given a diverged region with inPoint 10, outPoint 20, inBeatTime 5, outBeatTime 15, BPM 120, lockedBeats 20
        When applyBpmEdit is dispatched with newBpm 150 and stretch true
        Then BPM becomes 150
        And outBeatTime rescales to 13.33 (clipout length goes from 10 to 8)
        And inPoint stays at 10 and outPoint stays at 20
        And inBeatTime stays at 5 and the region remains diverged

    Scenario: Stretch-mode beats edit on a diverged region rescales only the clipout
        Given a diverged region with inPoint 10, outPoint 20, inBeatTime 5, outBeatTime 15, BPM 120, lockedBeats 20
        When applyBeatsEdit is dispatched with newLockedBeats 16 and stretch true
        Then lockedBeats becomes 16
        And clipout length rescales to 8 (60 x 16 / 120)
        And BPM stays at 120
        And inPoint stays at 10 and outPoint stays at 20
        And inBeatTime stays at 5 and the region remains diverged

    Scenario: Direct beats edit changes length, BPM preserved (diverged: clipout only)
        Given a diverged region with BPM 120, lockedBeats 20, inBeatTime 0, outBeatTime 10
        When applyBeatsEdit is dispatched with newLockedBeats 10
        Then lockedBeats becomes 10
        And BPM is preserved (120)
        And clipout length shrinks to 5 (10 beats × 60 / 120)
        And inPoint and outPoint stay unchanged (diverged region)

    @todo @ignore
    Scenario: Stretch-mode beats edit follows the same linked/diverged rule
        Given a default-linked region with inPoint 10, outPoint 20, BPM 120, lockedBeats 20
        When the user enters new lockedBeats 16 while holding the stretch modifier (Alt)
        Then lockedBeats becomes 16
        And clipout length rescales to 8 (60 × 16 / 120)
        And the region stays default-linked (inPoint/outPoint follow to 10..18)
        And BPM stays at 120

    @todo @ignore
    Scenario: Stretch-mode rescale only considers the ACTIVE region's anchors
        Given the active region overlaps another region in beat space
        And a beat anchor falls inside both regions' clipout windows
        When the user performs a stretch-modifier BPM edit on the active region
        Then the shared anchor is rescaled as part of the active region's clipout

    @todo @ignore
    Scenario Outline: lock × stretch-modifier matrix on BPM edit (diverged region)
        Given a diverged region with BPM 120, lockedBeats 20, clipout length 10, lock=<lock>
        When the user enters BPM 150 with modifier=<mod>
        Then clipout length becomes <newLen>
        And lockedBeats becomes <newBeats>
        And inner anchors rescale only when <anchorRescale>
        And clipin (inPoint/outPoint) stays unchanged
        Examples:
            | lock  | mod          | newLen | newBeats | anchorRescale |
            | bpm   | none         | 10     | 25       | never         |
            | bpm   | stretch(Alt) | 8      | 20       | always        |
            | beats | none         | 10     | 25       | never         |
            | beats | stretch(Alt) | 8      | 20       | always        |

    # ── §12. Unlinking semantics ──────────────────────────────
    # When coincidence is broken, the boundary's beat-space coord keeps
    # its last committed value — no auto-revert to inPoint/outPoint.

    Scenario: Input-anchor drag away from boundary unlinks without changing inBeatTime
        Given a region's in-edge is linked to an input anchor
        When the user drags the input anchor away from inPoint and releases
        Then the in-edge is no longer linked
        And inBeatTime keeps its last committed value
        And BPM and lockedBeats are unchanged

    Scenario: Clip body or edge drag away from anchor unlinks without changing inBeatTime
        Given a region's in-edge is linked to an input anchor
        When the user drags the clipin body or in-edge so inPoint no longer matches the anchor
        Then the in-edge is no longer linked
        And inBeatTime keeps its last committed value

    Scenario: Anchor deletion unlinks but leaves clipout diverged
        Given a region's in-edge is linked to an input anchor
        When the user deletes the input anchor (or its paired beat anchor)
        Then the in-edge is no longer linked
        And inBeatTime keeps its last committed value
        And no auto-revert to inPoint occurs

    Scenario: Re-linking is a fresh linking event
        Given a region whose in-edge was previously linked then unlinked, inBeatTime now diverged
        When a different input anchor's input time later coincides with inPoint
        And the user commits the gesture (pointerUp at coincidence)
        Then inBeatTime is redefined from the new anchor's paired beat time
        And lockedBeats recomputes
        And BPM is unchanged

    # ── §13. Anchor-lock mode ─────────────────────────────────
    # A global mode (state.ui.anchorLock) that changes how beat anchors
    # INSIDE a region's clipout window behave during resize and body-pan
    # gestures. Toggled persistently via a button in the canvas toolbar.
    # Engaged transiently by holding Alt during any clipout gesture (the
    # modifier INVERTS the current global setting for that gesture only).
    #
    # Anchors-lock semantics:
    #   RESIZE  + lock='beats'  → anchors STAY at their beat times
    #                             (no proportional rescale)
    #   RESIZE  + lock='bpm'    → unchanged (anchors never rescale here)
    #   BODY DRAG (pan)         → anchors MOVE WITH the clipout by the
    #                             same delta (carried along)
    #
    # Normal mode (anchor-lock OFF) behavior — for contrast:
    #   RESIZE  + lock='beats'  → anchors rescale proportionally
    #                             (because BPM changes)
    #   BODY DRAG (pan)         → anchors stay (per §8)

    @todo @ignore
    Scenario: Anchor-lock toolbar button toggles the global setting
        Given the canvas toolbar anchor-lock button shows state.ui.anchorLock=false
        When the user clicks the anchor-lock button
        Then state.ui.anchorLock becomes true
        And the button shows the active / on state
        When the user clicks the button again
        Then state.ui.anchorLock becomes false

    @todo @ignore
    Scenario: Alt-held preview inverts the anchor-lock button display
        Given state.ui.anchorLock is false
        When the user holds Alt
        Then the anchor-lock toolbar button visually displays its inverted (ON) state
        And state.ui.anchorLock is still false (no persistent change)
        When the user releases Alt
        Then the button returns to its normal (OFF) display

    @todo @ignore
    Scenario: Alt-held preview works the other way when global lock is ON
        Given state.ui.anchorLock is true
        When the user holds Alt
        Then the anchor-lock toolbar button visually displays its inverted (OFF) state
        And state.ui.anchorLock is still true (no persistent change)

    Scenario: Holding Alt during resize inverts anchor-lock for that gesture only
        Given state.ui.anchorLock is false
        And the user begins a clipout resize gesture
        When the user holds Alt during the drag
        Then the gesture behaves as if anchorLock were true for this gesture only
        And state.ui.anchorLock stays at false after pointerUp

    Scenario: Holding Alt during clipout body-pan inverts anchor-lock for that gesture only
        Given state.ui.anchorLock is false
        And the user begins a clipout body-pan gesture
        When the user holds Alt during the drag
        Then beat anchors inside the clipout window translate with the body for this gesture only
        And state.ui.anchorLock stays at false after pointerUp

    Scenario: Resize with anchor-lock ON and lock='beats' rescales anchors proportionally
        Given state.ui.anchorLock is true
        And a region with lock='beats', BPM 120, lockedBeats 20, clipout length 10
        And beat anchors at beat times 12 and 16 (inside clipout window 10..20)
        When the user drags the clipout out-edge to make clipout length 8 and releases
        Then BPM becomes 150 (length × bpm / 60 = lockedBeats → bpm = 60 × 20 / 8)
        And lockedBeats stays at 20
        And the beat anchors rescale proportionally around inBeatTime (12 → 11.6, 16 → 14.8)

    Scenario: Resize with anchor-lock OFF and lock='beats' keeps anchors in place
        Given state.ui.anchorLock is false
        And a region with lock='beats', BPM 120, lockedBeats 20, clipout length 10
        And beat anchors at beat times 12 and 16 (inside clipout window 10..20)
        When the user drags the clipout out-edge to make clipout length 8 and releases
        Then BPM becomes 150
        And lockedBeats stays at 20
        And the beat anchors stay at beat times 12 and 16 (unchanged)

    Scenario: Resize with anchor-lock ON and lock='bpm' is unchanged (anchors stay either way)
        Given state.ui.anchorLock is true
        And a region with lock='bpm', BPM 120, lockedBeats 20, clipout length 10
        And beat anchors at beat times 12 and 16
        When the user drags the clipout out-edge to make clipout length 8 and releases
        Then BPM stays at 120
        And lockedBeats becomes 16
        And the beat anchors stay at beat times 12 and 16

    Scenario: Clipout body-pan with anchor-lock ON carries all inner anchors
        Given state.ui.anchorLock is true
        And a region with inBeatTime 10, outBeatTime 30
        And beat anchors at beat times 12, 18, and 25 (all inside the clipout window)
        When the user drags the clipout body by +5 seconds and releases
        Then inBeatTime is 15 and outBeatTime is 35
        And the beat anchors are now at beat times 17, 23, and 30 (moved by +5)
        And anchors outside the original clipout window are unchanged

    Scenario: Clipout body-pan with anchor-lock OFF does not move anchors (default)
        Given state.ui.anchorLock is false
        And a region with inBeatTime 10, outBeatTime 30
        And beat anchors at beat times 12, 18, and 25
        When the user drags the clipout body by +5 seconds and releases
        Then inBeatTime is 15 and outBeatTime is 35
        And the beat anchors stay at 12, 18, and 25

    @todo @ignore
    Scenario: Anchor-lock affects only the active region's anchors
        Given state.ui.anchorLock is true
        And the active region overlaps another region in beat space
        And a beat anchor falls inside both regions' clipout windows
        When the user pans the active region's clipout body
        Then the shared anchor moves with the active region
        # Cross-region anchor sharing will be reworked in a separate effort.

    # ── §14. Cancel paths ─────────────────────────────────────
    # Standard cancel paths reset state without committing —
    # consistent with drag.feature §2.4 of TIMELINE_BEHAVIOR.md.

    Scenario Outline: Cancel during any conform / clipout gesture discards the preview
        Given a <gesture> is in progress with live preview visible
        When <cancel>
        Then all preview values revert to pre-gesture state
        And no commit enters the undo stack
        Examples:
            | gesture                     | cancel                  |
            | linking-event anchor drag   | the user presses Escape |
            | linked-anchor beat-drag     | pointercancel fires     |
            | clipout in-edge drag        | window blur fires       |
            | clipout out-edge drag       | the user presses Escape |
            | clipout body translation    | pointercancel fires     |
            | BPM input edit (uncommitted)| the user presses Escape |

    # ── §15. Reset Boundary ───────────────────────────────────
    # The Reset Boundary button returns a diverged region to default-linked
    # state by clearing inBeatTime and outBeatTime (setting them to undefined).
    # The button is disabled when the region is already default-linked.

    @todo @ignore
    Scenario: Reset Boundary button clears inBeatTime and outBeatTime
        Given a region with inPoint 10, outPoint 20, inBeatTime 5, outBeatTime 18 (diverged)
        When the user clicks the Reset Boundary button
        Then inBeatTime becomes undefined
        And outBeatTime becomes undefined
        And the region is reported as default-linked
        And clipin and clipout render at the same horizontal positions

    @todo @ignore
    Scenario: Reset Boundary is disabled when the region is already default-linked
        Given a region in its default-linked state (inBeatTime and outBeatTime are undefined)
        Then the Reset Boundary button is disabled (not clickable)

    @todo @ignore
    Scenario: Reset Boundary is undoable
        Given a region with inBeatTime 5, outBeatTime 18 (diverged)
        When the user clicks the Reset Boundary button
        And the change is undone
        Then inBeatTime is 5 and outBeatTime is 18 again
        And the region is reported as diverged

    # ── §16. Active region and hit resolution ─────────────────
    # pointerDown on a region body or any of its edges sets that region as
    # the active region before any drag gesture begins.
    # When two regions share a coincident boundary x-position, the active
    # region's edge wins the hit test over the non-active region's edge.

    @todo @ignore
    Scenario: PointerDown on a region body sets it as the active region
        Given region A is the active region
        And region B is not the active region
        When the user presses the pointer on region B's body
        Then region B becomes the active region immediately (before any movement)
        And no drag has yet committed

    @todo @ignore
    Scenario: PointerDown on a region edge sets it as the active region
        Given region A is the active region
        And region B is not the active region
        When the user presses the pointer on region B's in-edge or out-edge
        Then region B becomes the active region immediately

    @todo @ignore
    Scenario: Active region's edge wins coincident boundary hit
        Given region A (active) and region B share an x-position boundary
        And region A's out-edge and region B's in-edge are at the same screen coordinate
        When the user presses the pointer at that x-position
        Then the hit is resolved to region A's out-edge
        And region B's in-edge is not dragged

    @todo @ignore
    Scenario: Non-active region's edge wins when the active region has no edge there
        Given region A (active) has no edge near x-position P
        And region B (non-active) has an edge at x-position P
        When the user presses the pointer at x-position P
        Then the hit is resolved to region B's edge

    # ── §17. Conform visual display (input-side) ─────────────
    # When an input anchor's inputTime coincides with region.inPoint (or
    # outPoint), the clipout edge is DISPLAYED at the paired beat anchor's
    # beat time — but inBeatTime/outBeatTime are NOT written. The region
    # stays default-linked. This is purely a render-time projection.
    # Only a direct clipout interaction (edge drag or body pan) commits
    # the conformed position and carries the paired beat anchor.

    @todo @ignore
    Scenario: Conform is visual-only — inBeatTime not written during display
        Given a default-linked region with inPoint 10
        And an input anchor pair at inputTime 10, beatTime 6
        Then the clipout's in-edge displays at beat time 6 (conformed visual)
        And inBeatTime is still undefined (region is still default-linked)
        And the undo stack has no new entry

    @todo @ignore
    Scenario: Conformed-marker carry — interacting with the clipout commits and carries the anchor
        Given a default-linked region with inPoint 10
        And an input anchor pair at inputTime 10 (conformed at in-edge), beatTime 6
        When the user drags the clipout out-edge (any interaction with the clipout)
        Then inBeatTime is committed to 6 (the conformed value) at drag start
        And the paired beat anchor at beatTime 6 moves with the clipout out-edge during the drag
        And the commit enters the undo stack at pointerUp

    @todo @ignore
    Scenario: Conformed-marker carry is symmetric for the out-edge
        Given a default-linked region with outPoint 20
        And an input anchor pair at inputTime 20 (conformed at out-edge), beatTime 18
        When the user drags the clipout body (any interaction with the clipout)
        Then outBeatTime is committed to 18 at drag start
        And the paired beat anchor at beatTime 18 carries with the clipout body translation

    # ── §18. Snap targets during grid-changing clipout ops ────
    # During clipout gestures that change the BPM grid (edge drag with
    # lock='beats'), the snap target set is restricted:
    #   - BPM grid ticks are excluded (they move as the grid changes)
    #   - Beat anchors are excluded (they may rescale)
    #   - Self-region's OWN projected clipin bounds are ADDED as snap targets

    @todo @ignore
    Scenario: Clipout edge drag with lock='beats' excludes BPM grid and beat anchors from snaps
        Given a region with lock='beats' and a clipout out-edge being dragged
        And a BPM grid line and a beat anchor are nearby
        Then neither the BPM grid line nor the beat anchor appears as a snap target
        And other regions' clipout edges still appear as snap targets

    @todo @ignore
    Scenario: Clipout edge drag with lock='beats' adds self-region clipin bounds as snap targets
        Given a region with lock='beats', inPoint 10, outPoint 20
        And the clipout out-edge is being dragged in beat space
        Then the region's own clipin projected bounds (10 and 20, in beat-space coords) are offered as snap targets

    # ── §19. Set In/Out Point resize path ────────────────────
    # setInPointToPlayhead and setOutPointToPlayhead have two branches:
    #   SPAWN:  playhead is outside the region (before inPoint or after outPoint)
    #           → a new region is created (covered in §2)
    #   RESIZE: playhead is inside the region
    #           → the nearest boundary (in or out) is moved to the playhead

    @todo @ignore
    Scenario: Set-In-Point with playhead inside the region moves the in-point
        Given a region with start 10 and end 30
        And the playhead is at 20 (inside the region)
        When the Set In Point Button is clicked
        Then the region's start moves to 20
        And the region now spans 20 to 30
        And no new region is created

    @todo @ignore
    Scenario: Set-Out-Point with playhead inside the region moves the out-point
        Given a region with start 10 and end 30
        And the playhead is at 20 (inside the region)
        When the Set Out Point Button is clicked
        Then the region's end moves to 20
        And the region now spans 10 to 20
        And no new region is created
