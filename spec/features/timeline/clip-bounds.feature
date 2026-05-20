Feature: Clip Bounds

  # A clip has two parallel sets of bounds:
  #   clipin  (input space):  inPoint, outPoint        — seconds in source video
  #   clipout (beat space):   inBeatTime, outBeatTime  — seconds in output
  #
  # Default-linked: (inBeatTime, outBeatTime) === (inPoint, outPoint).
  # Diverged:       any edit that breaks that equality.
  #
  # Three coupled clipout quantities related by:  beats = length × BPM / 60
  # `clip.lock` says which quantity absorbs a length change:
  #   lock=bpm   → BPM stays;          lockedBeats absorbs
  #   lock=beats → lockedBeats stays;  BPM absorbs
  #
  # Vocabulary:
  #   "orig anchor"    — input-space anchor (anchor.time)
  #   "beat anchor"    — beat-space anchor (paired with an orig by id)
  #   "anchor pair"    — the (orig, beat) pair; "linked" when orig === beat
  #   "edge"           — `in` or `out`; clipin in-edge = inPoint, etc.
  #   "conform"        — emergent state: orig coincides with clipin edge AND
  #                      beat coincides with clipout edge. While both hold,
  #                      the resolver's MirrorPair ties the edge to the
  #                      paired beat anchor. Purely positional — engages
  #                      and releases continuously as positions change.
  #   "anchor-lock"    — global state.ui.anchorLock (independent of clip.lock)
  #
  # Drag semantics:
  #   - Mid-drag state changes are written continuously; there is no
  #     "preview vs commit" split.
  #   - Undo does not snapshot intermediate drag frames. A completed
  #     gesture is one undo step.
  #   - Cancel (Escape / pointercancel) reverts to pre-drag state with
  #     no undo entry.

  # ── Foundational state ──────────────────────────────────────────────

  Scenario: A new clip is default-linked
    Given a clip from 10 to 20
    Then inBeatTime equals inPoint and outBeatTime equals outPoint
    And clipin and clipout render at the same x-positions
    And the clip is reported as default-linked

  Scenario: Setting either beat-space bound away from its input partner diverges the clip
    Given a default-linked clip from 10 to 20
    When inBeatTime or outBeatTime is set to a value not matching its input partner
    Then the clip is diverged
    And clipin and clipout no longer share x-positions

  # ── Clipin (input-space) bounds editing ─────────────────────────────
  # Direct manipulation of the input-space bounds. Each scenario starts
  # from `a clip from 10 to 20` for consistent numerics.

  Scenario Outline: A clipin <edge>-edge edit is undoable
    Given a clip from 10 to 20
    When the <edge>-point is changed to <new>
    And the change is undone
    Then the <edge>-point is at its original value
    Examples:
      | edge | new |
      | in   | 15  |
      | out  | 25  |

  Scenario: Setting in-point past out-point shifts the clip to preserve length
    Given a clip from 10 to 20
    When the in-point is changed to 25
    Then the clip spans 25 to 35

  Scenario Outline: Set-<Edge>-Point outside the clip creates a new clip
    Given a clip from 10 to 20
    When the Set <Edge> Point button is clicked with the playhead at <playhead>
    Then a new clip is created starting at <playhead>
    Examples:
      | Edge | playhead |
      | Out  | 5        |
      | In   | 30       |

  Scenario Outline: A clip cannot resize below the minimum length
    Given a clip from 10 to 20
    When the clip is resized to span <a> to <b>
    Then the clip spans <c> to <d>
    Examples:
      | a    | b    | c  | d  |
      | 10   | 10   | 10 | 11 |
      | 10   | 10.5 | 10 | 11 |
      | 20   | 20   | 19 | 20 |
      | 19.5 | 20   | 19 | 20 |

  Rule: Object isolation — anchors and clip edges move independently

    Background:
      Given a clip from 10 to 20

    Scenario: Dragging an anchor doesn't move a clip edge
      Given an anchor at inPoint
      When the user drags the anchor
      Then inPoint stays at 10 and only the anchor moves

    Scenario: Dragging a clip edge doesn't move an anchor
      Given an anchor at 15
      When the user drags the clipin in-edge
      Then the anchor stays at 15 and only the edge moves

    Scenario: Dragging a default-linked clipin moves its clipout too
      Given the clip is default-linked
      When the user drags the clipin so the clip spans 15 to 25
      Then the clipout spans 15 to 25

  Rule: Conform — clipout edge tracks the paired beat anchor's beat time

    Background:
      Given a default-linked clip from 10 to 20

    # Conform is the emergent state when orig coincides with the clipin
    # edge. While that input coincidence holds, the clipout edge is
    # written to the paired beat anchor's beat time (ConformVisual).
    # When ALSO the beat anchor coincides with the clipout edge, a
    # MirrorPair installs and dragging one moves the other.

    Scenario Outline: A linked anchor pair conformed at <edge> displays the clipout edge at the paired beat time
      Given an anchor pair at orig <edgeVal>, beat <beatVal>
      Then the clipout <edge>-edge displays at <beatVal>
      Examples:
        | edge | edgeVal | beatVal |
        | in   | 10      | 6       |
        | out  | 20      | 18      |

    Scenario: A clipin drag past a linked anchor temporarily conforms
      Given an anchor pair at orig 15, beat 15
      When the user drags the clipin in-edge from 12 through 15 and out to 18
      Then while the in-edge coincides with 15 the conform holds and clipout in-edge tracks 15
      And as the in-edge passes 15 the conform releases and the edge continues with the cursor
      And the anchor pair stays at orig 15, beat 15 throughout

    Scenario: An orig-anchor drag across a clip edge temporarily conforms
      Given an anchor pair at orig 8, beat 8
      When the user drags the orig anchor from 8 through 10 and out to 12
      Then while orig coincides with inPoint the conform holds
      And dragging orig past 10 releases the conform
      And the clip's inPoint stays at 10 throughout

    # Diverged anchor: orig ≠ beat. The input-side conform still writes
    # the clipout edge to the beat anchor's time when the clip's edge
    # lands on orig, but the MirrorPair guard prevents an unrelated clip
    # drag from yanking the beat anchor in output space.

    Scenario: Clipin body drag onto a diverged anchor writes clipout to the paired beat time
      Given the clip spans 10 to 30 and an anchor pair at orig 20, beat 25 diverged
      When the user drags the clipin body so inPoint sequentially reaches 15, then 20, then 22
      Then at inPoint 15 pre-anchor inBeatTime is 15 and beat anchor stays at 25
      And at inPoint 20 on-anchor inBeatTime is 25 and beat anchor stays at 25
      And at inPoint 22 past-anchor inBeatTime is 22 and beat anchor stays at 25

    Scenario Outline: Edge resize onto a diverged anchor writes only the matching clipout edge
      Given the clip spans 10 to 20 and an anchor pair at orig <origVal>, beat <beatVal> diverged
      When the user drags the clipin <edge>-edge onto <origVal>
      Then the clipout becomes <clipoutResult>
      And the anchor pair stays at orig <origVal>, beat <beatVal>
      Examples:
        | edge | origVal | beatVal | clipoutResult |
        | in   | 5       | 4       | (4, 20)       |
        | out  | 25      | 26      | (10, 26)      |

    Scenario: Clipin drag past a diverged anchor with no output coincidence does NOT pull the beat anchor
      Given the clip spans 10 to 20 and an anchor pair at orig 10, beat 15 diverged
      When the user drags the clipin body by 0.3 with the in-edge inside the snap radius of orig
      Then the beat anchor stays at 15
      # MirrorPair guard: requires BOTH input AND output coincidence; output
      # is missing here so MirrorPair never installs.

    Scenario Outline: Clipout interaction on a conformed pair carries the anchor and writes the beat-space bound
      Given an anchor pair at orig <edgeVal>, beat <beatVal> conformed at the <edge>-edge
      When the user interacts with the clipout
      Then <edge>BeatTime is written to <beatVal> at drag start
      And the paired beat anchor moves with the clipout <edge>-edge during the drag
      Examples:
        | edge | edgeVal | beatVal |
        | in   | 10      | 6       |
        | out  | 20      | 18      |

    Scenario Outline: Clipout edge drag on a fully conformed linked pair (orig=beat) moves clipout and carries the anchor
      Given an anchor pair at orig <val>, beat <val> conformed at the <edge>-edge of clip 10 to 20
      When the user drags the clipout <edge>-edge to <newVal>
      Then the clipout <edge>-edge is <newVal>
      And the beat anchor follows to <newVal>
      Examples:
        | edge | val | newVal |
        | in   | 10  | 12     |
        | out  | 20  | 22     |

  Rule: Conformed-anchor move — dragging the beat side of a conformed pair moves the clipout edge

    Scenario Outline: Conformed-anchor drag tracks the clipout edge
      Given a clip's <edge>-edge is conformed to an anchor pair
      When the user drags the paired beat anchor in output space
      Then the clipout <edge>-edge tracks the anchor's position
      And the lock-dependent value tracks accordingly
      Examples:
        | edge |
        | in   |
        | out  |

    Scenario Outline: Conformed-anchor move respects clip lock
      Given a clip with clipout length 10, BPM 120, lock=<lock>, lockedBeats 20
      And the <edge>-edge is conformed to a beat anchor at <startBeat>
      When the user drags the beat anchor to <endBeat>
      Then <edge>BeatTime updates to <endBeat>
      And the clipout length is 8
      And BPM is <newBpm> and lockedBeats is <newBeats>
      Examples:
        | edge | lock  | startBeat | endBeat | newBpm | newBeats |
        | in   | bpm   | 5         | 7       | 120    | 16       |
        | in   | beats | 5         | 7       | 150    | 20       |
        | out  | bpm   | 15        | 13      | 120    | 16       |
        | out  | beats | 15        | 13      | 150    | 20       |

    Scenario: Dragging the orig anchor of a conformed pair unconforms the edge
      Given a clip's in-edge is conformed to an anchor pair
      When the user drags the orig anchor away from the edge
      Then the in-edge is no longer conformed
      And inBeatTime, BPM, and lockedBeats are unchanged

  Rule: A clipout edge drag rescales the clipout; lock determines what absorbs the length change

    Background:
      Given a clip with clipout length 10, BPM 120, lockedBeats 20

    Scenario Outline: Clipout edge drag updates beat-time and the lock-dependent value
      Given the clip's lock is <lock>
      When the user drags the clipout <edge>-edge to make clipout length <newLen>
      Then BPM is <newBpm> and lockedBeats is <newBeats>
      And inPoint and outPoint are unchanged
      Examples:
        | edge | lock  | newLen | newBpm | newBeats |
        | in   | bpm   | 8      | 120    | 16       |
        | in   | bpm   | 12     | 120    | 24       |
        | in   | beats | 8      | 150    | 20       |
        | in   | beats | 12     | 100    | 20       |
        | out  | bpm   | 12     | 120    | 24       |

    Scenario Outline: Clipout edge drag carries its conformed anchor (inseparable while conformed)
      Given the <edge>-edge is conformed to an anchor pair
      When the user drags the clipout <edge>-edge by any nonzero amount
      Then the paired beat anchor follows the new edge position
      And the conform is preserved with clipout <edge>-edge equal to the anchor's beat time
      Examples:
        | edge |
        | in   |
        | out  |

    Scenario: Clipout edge drag snaps in output space only
      When the user drags a clipout edge
      Then the edge snaps to beat anchors, other clipout edges, and the BPM grid
      And not to scene cuts since scenes live in input space

    Scenario Outline: Clipout edge clamps
      When the user drags an edge such that <violation>
      Then the moving edge clamps to <limit>
      Examples:
        | violation                                    | limit                       |
        | the resulting length would be less than 0.1s | 0.1s from the opposite edge |
        | the edge would cross 0 or OUTPUT_MAX         | the boundary                |

  Rule: A clipout body drag translates both edges by the same delta

    Background:
      Given a clip with inBeatTime 10, outBeatTime 30, BPM 120, lockedBeats 40

    Scenario: Clipout body drag translates both edges by the drag delta
      When the user drags the clipout body by 5
      Then inBeatTime is 15 and outBeatTime is 35
      And clipout length, BPM, lockedBeats, inPoint, and outPoint are all unchanged

    Scenario: Clipout body drag carries any conformed anchors on either edge
      Given the in-edge OR out-edge is conformed to an anchor pair
      When the user drags the clipout body by any nonzero amount
      Then each conformed anchor follows the matching edge by the same delta
      And the conforms are preserved at the new positions

    @todo
    Scenario: Clipout body drag snaps symmetrically — dominant edge wins
      When the user translates the clipout body
      Then the edge with the closer snap target wins
      And the other edge translates by the same delta

    @todo
    Scenario: Clipout body drag clamps to output bounds
      When the user drags the body past [0, OUTPUT_MAX]
      Then the body clamps so both edges remain inside the bounds

  Rule: The BPM tick grid repositions in real time during gestures that change beat-space positions

    @todo
    Scenario Outline: BPM tick grid repositions
      Given a clip exists
      When the user drags <draggable>
      Then the BPM tick grid repositions to reflect the new position
      Examples:
        | draggable                     |
        | the clipin                    |
        | an anchor sitting on the edge |

  Rule: Changing lock fixes the new quantity; clipout length is untouched

    Background:
      Given a clip with BPM 120, lockedBeats 20, clipout length 10

    Scenario Outline: Changing lock fixes the new quantity; length is untouched
      Given the clip's lock is <from>
      When the user changes lock to <to>
      Then <kept> stays at its current value as the new fixed quantity
      And the other quantities and clipout length are unchanged
      Examples:
        | from  | to    | kept        |
        | bpm   | beats | lockedBeats |
        | beats | bpm   | BPM         |

    Scenario: Lock setting persists across operations
      Given the clip's lock is beats
      When the user performs any clipout edit
      Then lock remains beats afterward

    @todo
    Scenario: Lock toggled mid-drag rebases the in-progress drag
      Given a clipout-resize drag is in progress
      When the user toggles lock via UI mid-drag
      Then the drag rebases to the new lock immediately
      And subsequent cursor movement uses the new lock

  Rule: Direct BPM / beats edits use the grid model; the stretch modifier rescales length

    # Default (grid model): length stays, the lock-dependent value absorbs.
    # Stretch modifier (Alt held): length rescales to keep the OTHER
    # quantity fixed. Stretch edits always operate on the BEAT clipout —
    # when default-linked, clipin follows along; when diverged, only clipout moves.

    Scenario: Direct BPM edit uses the grid model — length stays
      Given a clip with BPM 120, lockedBeats 20, clipout length 10
      When applyBpmEdit is dispatched with newBpm 150, stretch false
      Then BPM is 150 and lockedBeats is 25
      And clipout length, inPoint, and outPoint are unchanged

    Scenario: Direct beats edit on a diverged clip changes length only on the clipout
      Given a diverged clip with BPM 120, lockedBeats 20, inBeatTime 0, outBeatTime 10
      When applyBeatsEdit is dispatched with newLockedBeats 10
      Then lockedBeats is 10 and BPM stays at 120
      And clipout length shrinks to 5
      And inPoint and outPoint stay unchanged

    Scenario Outline: Stretch-mode edit on a diverged clip rescales only the clipout
      Given a diverged clip with inPoint 10, outPoint 20, inBeatTime 5, outBeatTime 15, BPM 120, lockedBeats 20
      When <edit> is dispatched with stretch true
      Then <changed> updates, <kept> stays, and clipout length rescales to 8
      And inPoint stays at 10 and outPoint stays at 20
      And inBeatTime stays at 5; the clip remains diverged
      Examples:
        | edit                                  | changed     | kept        |
        | applyBpmEdit with newBpm 150          | BPM         | lockedBeats |
        | applyBeatsEdit with newLockedBeats 16 | lockedBeats | BPM         |

    @todo
    Scenario Outline: Stretch-mode edit on a default-linked clip rescales clipin AND clipout together
      Given a default-linked clip with inPoint 10, outPoint 20, BPM 120, lockedBeats 20
      When the user enters <newValue> while holding Alt
      Then <changed> becomes its new value and clipout length rescales to 8
      And the clip stays default-linked (inPoint stays at 10, outPoint follows to 18)
      And inner beat anchors rescale proportionally
      Examples:
        | newValue        | changed     |
        | BPM 150         | BPM         |
        | lockedBeats 16  | lockedBeats |

    @todo
    Scenario: Stretch-mode rescale considers only the active clip's anchors
      Given the active clip overlaps another in beat space
      And a beat anchor falls inside both clips' clipout windows
      When the user performs a stretch-modifier edit on the active clip
      Then the shared anchor is rescaled as part of the active clip's clipout

  Rule: Unconforming — coincidence break preserves last written beat-space coord

    Scenario Outline: Unconforming via different triggers
      Given a clip's in-edge is conformed to an anchor pair
      When <action>
      Then the in-edge is no longer conformed
      And inBeatTime keeps its last written value
      And BPM and lockedBeats are unchanged
      Examples:
        | action                                                        |
        | the user drags the orig anchor away from the edge             |
        | the user drags clipin so inPoint no longer matches the anchor |
        | the user deletes the orig anchor or its paired beat anchor    |

  Rule: Anchor-lock determines whether inner beat anchors follow clipout gestures

    # Global state (state.ui.anchorLock). Holding Alt during ANY clipout
    # gesture INVERTS the current global setting for that gesture only.
    #
    # Anchor-lock ON:
    #   RESIZE  + lock=beats → inner anchors rescale proportionally
    #   RESIZE  + lock=bpm   → inner anchors stay
    #   BODY    drag         → inner anchors translate with the body
    # Anchor-lock OFF:
    #   RESIZE  + lock=beats → inner anchors stay
    #   BODY    drag         → inner anchors stay

    Scenario Outline: Alt held during a clipout gesture inverts anchor-lock for that gesture only
      Given anchor-lock is OFF
      And the user begins a clipout <gesture> gesture
      When the user holds Alt during the drag
      Then the gesture behaves as if anchor-lock were ON for this gesture only
      And anchor-lock stays OFF after the gesture ends
      Examples:
        | gesture  |
        | resize   |
        | body-pan |

    Scenario Outline: Clipout out-edge resize × anchor-lock × lock matrix
      Given anchor-lock is <anchorLock>
      And a clip with lock=<lock>, BPM 120, lockedBeats 20, clipout length 10
      And beat anchors at 12 and 16 inside the clipout window 10..20
      When the user drags the clipout out-edge to make clipout length 8
      Then BPM is <newBpm> and lockedBeats is <newBeats>
      And the inner beat anchors <anchorBehavior>
      Examples:
        | anchorLock | lock  | newBpm | newBeats | anchorBehavior                                                  |
        | ON         | beats | 150    | 20       | rescale proportionally around inBeatTime (12 → 11.6, 16 → 14.8) |
        | OFF        | beats | 150    | 20       | stay at 12 and 16                                               |
        | ON         | bpm   | 120    | 16       | stay at 12 and 16                                               |

    Scenario Outline: Clipout body-pan × anchor-lock
      Given anchor-lock is <anchorLock>
      And a clip with inBeatTime 10, outBeatTime 30
      And beat anchors at 12, 18, and 25 inside the clipout window
      When the user drags the clipout body by 5
      Then inBeatTime is 15 and outBeatTime is 35
      And the inner beat anchors <anchorBehavior>
      And anchors outside the original window are unchanged
      Examples:
        | anchorLock | anchorBehavior            |
        | ON         | are now at 17, 23, and 30 |
        | OFF        | stay at 12, 18, and 25    |

    @todo
    Scenario: Anchor-lock affects only the active clip's anchors
      Given anchor-lock is ON and the active clip overlaps another in beat space
      And a beat anchor falls inside both clips' clipout windows
      When the user pans the active clip's clipout body
      Then the shared anchor moves with the active clip
      # Cross-clip anchor sharing will be reworked separately.

  Rule: A drag gesture is atomic — completion is one undo step; cancellation reverts state with no undo entry

    # State updates are continuous during a drag. A completed gesture
    # is a single undo step — intermediate drag frames are not separately
    # undoable. Cancel reverts to the pre-drag state with no undo entry.

    Scenario: A completed drag is one undo step
      Given a clip exists
      When the user completes a drag
      And the user presses undo
      Then the clip returns to its pre-drag state in one step

    Scenario Outline: Cancelling a drag reverts state without an undo entry
      Given a <gesture> is in progress
      When <cancel>
      Then state reverts to the pre-gesture values
      And the undo stack is unchanged
      Examples:
        | gesture                  | cancel                  |
        | orig-anchor drag         | the user presses Escape |
        | beat-anchor drag         | pointercancel fires     |
        | clipout edge drag        | the user presses Escape |
        | clipout body translation | pointercancel fires     |

  Rule: Reset Boundary returns a diverged clip to default-linked

    @todo
    Scenario: Reset Boundary clears inBeatTime and outBeatTime
      Given a diverged clip with inPoint 10, outPoint 20, inBeatTime 5, outBeatTime 18
      When the user clicks the Reset Boundary button
      Then inBeatTime and outBeatTime become undefined
      And the clip is default-linked
      And clipin and clipout render at the same x-positions

    @todo
    Scenario: Reset Boundary is disabled on a default-linked clip
      Given a default-linked clip with inBeatTime and outBeatTime undefined
      Then the Reset Boundary button is disabled

    @todo
    Scenario: Reset Boundary is undoable
      Given a diverged clip with inBeatTime 5, outBeatTime 18
      When the user clicks Reset Boundary and then undoes
      Then inBeatTime is 5, outBeatTime is 18, and the clip is diverged again

  Rule: PointerDown activates a clip; coincident-boundary hits resolve to the active clip

    # When boundary x-positions coincide between active and non-active
    # clips, the active clip's edge wins the hit.

    @todo
    Scenario Outline: PointerDown on a clip's <target> activates it before any drag
      Given clip A is the active clip and clip B is not
      When the user presses the pointer on clip B's <target>
      Then clip B becomes the active clip immediately, before any movement
      Examples:
        | target |
        | body   |
        | edge   |

    @todo
    Scenario: Active clip's edge wins a coincident-boundary hit test
      Given clip A and clip B share an x-position boundary
      When the user presses the pointer at that x-position
      Then the hit resolves to clip A's edge

    @todo
    Scenario: Non-active clip's edge wins when the active clip has no edge there
      Given clip A has no edge near x P
      And clip B has an edge at x P
      When the user presses the pointer at x P
      Then the hit resolves to clip B's edge

  Rule: A clipout edge drag with lock=beats restricts the snap target set

    # BPM grid ticks and beat anchors move with the grid as length
    # changes, so they're excluded; the self-clip's projected clipin
    # bounds become snap targets (they don't move during a clipout edit).

    @todo
    Scenario: BPM-changing clipout edge drag excludes grid ticks and beat anchors from snaps
      Given a clip with lock=beats and a clipout edge being dragged
      And a BPM grid line and a beat anchor are nearby
      Then neither the grid line nor the beat anchor appears as a snap target
      And other clips' clipout edges still appear as snap targets

    @todo
    Scenario: BPM-changing clipout edge drag adds the self-clip's clipin bounds as snap targets
      Given a clip with lock=beats, inPoint 10, outPoint 20
      And the clipout out-edge is being dragged in beat space
      Then the clip's own clipin bounds at 10 and 20 in beat-space coords are offered as snap targets

  Rule: Set-<Edge>-Point with playhead inside a clip resizes the matching edge

    @todo
    Scenario Outline: Set-<Edge>-Point moves the nearest boundary when the playhead is inside
      Given a clip from 10 to 30 and the playhead at 20
      When the Set <Edge> Point button is clicked
      Then the clip's <edge>-edge moves to 20
      And the clip spans <newSpan>
      And no new clip is created
      Examples:
        | Edge | edge | newSpan  |
        | In   | in   | 20 to 30 |
        | Out  | out  | 10 to 20 |
