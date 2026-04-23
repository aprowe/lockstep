Feature: List Selection

    # Spec-only for now — every concrete scenario below carries
    # `@todo @ignore` so coverage doesn't gate on tests we haven't
    # written yet. The behaviour is still being ironed out (per the
    # Open Questions block at the bottom); once it solidifies, drop
    # the @ignore tag and bind a test.

    # Click + keyboard semantics shared by every list panel (clips, markers,
    # scenes). The "active item" concept is currently distinct from
    # selection — only clips have an explicit single-item active that
    # drives the timeline; for markers/scenes the active is implicit (a
    # plain click also seeks the playhead).

    # @hint click → selection becomes [id]; activate fires for callers that
    #       map it to seek / set-active-region / etc.
    Scenario Outline: Plain click selects one row and activates it
        Given a populated <list> list
        When the user clicks a row with no modifier keys
        Then only that row is in the list's selection
        And the row's activate handler fires once for that id
        Examples:
            | list    |
            | clips   |
            | markers |
            | scenes  |

    # @hint shift extends from the anchor (last plain-clicked id) to the
    #       clicked id; rows in between are unioned with the prior selection.
    Scenario Outline: Shift-click range-extends the selection without activating
        Given a populated <list> list with one row already selected
        When the user shift-clicks a different row
        Then the selection now contains every row between the anchor and the clicked row, inclusive
        And the activate handler is not called

        Examples:
            | list    |
            | clips   |
            | markers |
            | scenes  |

    # @hint ctrl/cmd toggles the clicked id in the existing set; never activates.
    Scenario Outline: Ctrl-click toggles a single row in the selection
        Given a populated <list> list with one row selected
        When the user ctrl-clicks an unselected row
        Then both rows are in the selection
        And the activate handler is not called
        When the user ctrl-clicks one of the selected rows
        Then that row is removed from the selection
        And the other selected rows remain selected

        Examples:
            | list    |
            | clips   |
            | markers |
            | scenes  |

    # ── Multi-select chrome ──────────────────────────────────────────────────

    Scenario: Selection bar appears when 2+ rows are selected
        Given a populated list with two rows selected
        Then the panel header shows "2 selected"
        And a clear-selection (deselect) button is visible
        And a bulk-delete (trash) button is visible

    Scenario: Per-row checkboxes appear when 2+ rows are selected
        Given a populated list with two rows selected
        Then every visible row shows a checkbox
        And the checkbox is checked for currently-selected rows
        And the checkbox is unchecked for unselected rows

    Scenario: Single selection has no checkboxes or bulk-action chrome
        Given a populated list with exactly one row selected
        Then no per-row checkboxes are rendered
        And the selection bar is hidden

    Scenario: Checkbox click toggles selection without activating
        Given a populated list with two rows selected
        When the user clicks an unselected row's checkbox
        Then that row joins the selection
        And the activate handler is not called

    # ── Per-row vs bulk delete ───────────────────────────────────────────────

    Scenario: Per-row trash removes only that row
        Given a populated list with three rows selected
        When the user clicks the trash button on a different (unselected) row
        Then only that row is removed
        And the original three-row selection is unchanged

    Scenario: Header trash removes the entire selection
        Given a populated list with three rows selected
        When the user clicks the trash button in the selection header
        Then all three selected rows are removed
        And the selection is cleared

    # @hint Bound at the panel root via onKeyDown — caller's onDelete fires
    #       with the full selection id list, then the selection is cleared.
    Scenario: Delete key on focused list removes selection
        Given a populated list with focus and a non-empty selection
        When the user presses Delete
        Then every selected row is removed
        And the selection is cleared

    # ── Active vs selected (clips-specific) ──────────────────────────────────

    Scenario: Plain click on a clip sets both active and selection
        Given the clips list
        When the user clicks a clip row with no modifier keys
        Then that clip becomes the only selected clip
        And it becomes the active region
        And the player seeks to its in-point

    Scenario: Modifier-clicks on clips don't change the active region
        Given the clips list with clip A active and selected
        When the user shift-clicks or ctrl-clicks clip B
        Then clip A remains the active region
        And the selection now includes both clips A and B

    # ── Mirroring between list and timeline ──────────────────────────────────

    # @hint Clip lasso writes lists.selection.clips; the clips list reads
    #       from the same store, so the timeline outline + the list
    #       checkboxes update in lockstep.
    @todo @ignore
    Scenario: Lasso on the timeline selects clips in the list
        Given the timeline with several clips
        When the user lassos across the clip band
        Then every clip whose [in, out] overlaps the lasso range is added to the clip selection
        And those clips show an accent outline on the timeline
        And the clips list shows checkboxes on each selected row

    # @hint Markers list selection is wired to warp.selectedIds via
    #       MarkersPanel's selectedIdsOverride — the timeline lasso has
    #       always written there, so list + timeline mirror automatically.
    @todo @ignore
    Scenario: Lasso on the timeline mirrors marker selection in the list
        Given the timeline with several markers
        When the user lassos across the marker track
        Then every marker inside the lasso range is added to the marker selection
        And the markers list shows checkboxes on each selected row

    @todo @ignore
    Scenario: Selecting in the list highlights on the timeline
        Given the clips list with two clips selected via shift-click
        Then those two clips show the accent outline on the timeline overlays

    # ── Cross-list independence ──────────────────────────────────────────────

    Scenario: Selecting in one list does not affect another list
        Given a clip is selected in the clips list
        And a marker is selected in the markers list
        When the user selects another clip
        Then the marker selection is unchanged

    # ── Filter independence ──────────────────────────────────────────────────

    Scenario: Selection survives a filter change
        Given a list with three rows selected
        When the user switches the list filter from All to View
        And the filter hides one of the selected rows
        Then the hidden row remains in the selection
        And the rows still visible remain selected and checked

    # ── Lasso details ────────────────────────────────────────────────────────

    # @hint Plain drag clears selection before adding lasso hits;
    #       Ctrl/Cmd+drag is additive (snapshot-then-merge).
    Scenario: Plain lasso replaces the existing selection
        Given a populated list with two rows selected
        When the user lassos a different range with no modifier keys
        Then the selection contains only the lassoed items

    Scenario: Ctrl+lasso adds to the existing selection
        Given a populated list with two rows selected
        When the user ctrl+lassos a different range
        Then the selection contains both the original and lassoed items

    Scenario: Single-track lasso scopes to that track's items only
        Given the timeline with both clips and markers
        When the user lassos starting and ending inside the marker track
        Then only marker items are selected

    Scenario: Cross-track lasso selects items on every track it crosses
        Given the timeline with both clips and markers
        When the user starts a lasso on the marker track and drags into the clip band
        Then both marker and clip selections are updated

    # ── Open questions / behavior to nail down ───────────────────────────────

    @todo @ignore
    Scenario: Active region persists when filter hides it
        # If the active clip is outside the viewport filter, should the
        # active stay (and just not be visible in the list) or be cleared?

    @todo @ignore
    Scenario: Marker activate semantics
        # Plain click on a marker currently seeks the playhead. Should
        # markers also have a persistent "active" concept, or is seek the
        # only side-effect?

    @todo @ignore
    Scenario: Scene activate semantics
        # Plain click on a scene seeks + ensures the start is in view.
        # Is "active scene" a useful concept (e.g. drives Inspector when
        # built), or is the implicit last-selected enough?

    @todo @ignore
    Scenario: Inspector follows last-selected across all lists
        # Inspector panel is not built yet; lists.lastSelected is wired
        # but unread. Once Inspector exists, switching lists should not
        # silently lose the inspected item.

    @todo @ignore
    Scenario: Bulk delete that removes the active region
        # Edge case: bulk delete includes the active clip → activeRegionId
        # becomes null. Should we promote the next clip to active, or
        # leave the timeline in "Full Video" mode?

    @todo @ignore
    Scenario: Selection persistence across video reloads
        # Per-list selection lives in Redux but isn't written to the
        # saved JSON. Reloading a video clears it. Intended?

    # ── Implemented click + keyboard semantics (test-bound) ─────────────────

    # @hint Adobe-style "replace-then-act": opening a context menu on a
    #       row that isn't already in the selection first replaces
    #       selection with [id] + sets it active, so menu actions hit
    #       what the user visually targeted.
    Scenario: Right-click on an unselected clip pre-selects it
        Given the clips list with two clips and clip A is selected
        When the user right-clicks clip B
        Then clip B is the only selected clip
        And clip B becomes the active region
        And the context menu is shown for clip B

    # @hint Right-click on an *already-selected* row leaves the multi-
    #       selection alone — bulk actions in the menu still target every
    #       selected clip.
    Scenario: Right-click on an already-selected clip preserves the multi-selection
        Given the clips list with three clips all selected
        When the user right-clicks one of them
        Then all three clips are still selected

    # @hint Cmd/Ctrl+A bound on the focused list panel via
    #       useListSelection.handleKeyDown. Scope is the visible-items
    #       list — respects whatever filter is active.
    Scenario: Cmd+A in the clips list selects every visible row
        Given the clips list with three clips and none selected
        When the user presses Cmd+A with the clips list focused
        Then all three clips are selected

    # @hint Cmd/Ctrl+D clears the focused list's selection. Other lists'
    #       selections are untouched (focus-scoping rule).
    Scenario: Cmd+D in the clips list clears its selection only
        Given the clips list with two clips selected
        And the markers list also has selected markers
        When the user presses Cmd+D with the clips list focused
        Then the clips selection is cleared
        And the markers selection is unchanged

    # ── Timeline-focused keyboard + empty-click deselect ────────────────────
    # Bound via tests/harnesses/thinTimeline.tsx — renders the full
    # ThinTimeline alongside a CenterColumn-mirroring composition of the
    # cross-slice handlers, so tests can drive the real keyboard /
    # pointer paths and assert against the resulting store state.

    Scenario: Timeline Delete removes the union of clip + marker selections
        Given the timeline has two selected clips and three selected markers
        When the user presses Delete with the timeline focused
        Then the two clips are removed
        And the three markers are removed
        And both selections are cleared

    Scenario: Timeline Cmd+D clears every timeline-side selection
        Given the timeline has selected clips and selected markers
        When the user presses Cmd+D with the timeline focused
        Then the clips selection is cleared
        And the markers selection is cleared
        And no items are deleted

    # @hint Policy B from docs/INTERACTION_DESIGN.md — a plain click on the
    #       empty timeline body (no drag, no modifier) clears every
    #       timeline-side selection. Modifier-clicks are ignored so the
    #       user can ctrl-click without losing the lasso snapshot.
    Scenario: Plain click on empty timeline clears every timeline-side selection
        Given the timeline has selected clips and selected markers
        And the active clip is set
        When the user clicks the empty timeline body with no modifier keys and no drag
        Then both timeline selections are cleared
        And the active clip is unchanged

    Scenario: Modifier-click on empty timeline does not clear selection
        Given the timeline has selected clips and selected markers
        When the user ctrl-clicks the empty timeline body with no drag
        Then both selections are unchanged

    # ── Scene-cut selection on the timeline ─────────────────────────────────
    # Scene cuts on the timeline get their own selection set, separate from
    # the panel scene-segment selection (different concept — cuts vs the
    # segments between them). Lasso writes scene.selectedCutTimes; the same
    # focus-scoped Delete / Cmd+D / empty-click semantics apply.

    # @hint Selected diamonds draw with an accent ring + a brighter
    #       through-line so the user can pick them out at a glance even
    #       when the always-show-scene-lines toggle is off.
    Scenario: Timeline Delete also removes selected scene cuts
        Given the timeline has two selected scene cuts
        When the user presses Delete with the timeline focused
        Then the selected cuts are removed from the scene list
        And the scene-cut selection is cleared

    Scenario: Timeline Cmd+D also clears the scene-cut selection
        Given the timeline has two selected scene cuts
        When the user presses Cmd+D with the timeline focused
        Then the scene-cut selection is cleared
        And the cuts themselves remain

    Scenario: Plain click on empty timeline clears the scene-cut selection
        Given the timeline has two selected scene cuts
        When the user clicks the empty timeline body with no modifier keys and no drag
        Then the scene-cut selection is cleared
