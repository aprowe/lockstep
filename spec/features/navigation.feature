Feature: Timeline Navigation

    # @test tests/bdd/prevJumpWindow.test.ts
    # @hint Current onJumpPrev / onPrevScene filter with `< playhead - 0.05`.
    #       When `ui.playing === true`, widen that dead-zone to 0.5s so a
    #       target the playhead just rolled past is treated as "behind but
    #       still current" and skipped. When paused, keep the existing small
    #       (~0.05s) threshold so a press-and-hold at a marker still works.
    Scenario Outline: While playing, Previous skips targets within 0.5s behind the playhead
        Given there are targets at 10, 20, and 30 seconds on the <track>
        And the video is playing
        And the playhead is at 20.3 seconds
        When the user clicks Previous on the <track>
        Then the playhead moves to 10 seconds
        Examples:
            | track         |
            | marker track  |
            | scene track   |
            | region track  |

    # @test tests/bdd/prevJumpWindow.test.ts
    # @hint Beyond 0.5s past a target, Previous behaves as it always has.
    Scenario Outline: While playing, Previous still snaps to the nearest earlier target outside the 0.5s window
        Given there are targets at 10, 20, and 30 seconds on the <track>
        And the video is playing
        And the playhead is at 21.0 seconds
        When the user clicks Previous on the <track>
        Then the playhead moves to 20 seconds
        Examples:
            | track         |
            | marker track  |
            | scene track   |
            | region track  |

    # @test tests/bdd/prevJumpWindow.test.ts
    # @hint When paused, the widened window is not applied — the existing
    #       small dead-zone (~0.05s) keeps single-frame nudges stable.
    Scenario Outline: While paused, the 0.5s window does not apply to Previous
        Given there are targets at 10, 20, and 30 seconds on the <track>
        And the video is paused
        And the playhead is at 20.3 seconds
        When the user clicks Previous on the <track>
        Then the playhead moves to 20 seconds
        Examples:
            | track         |
            | marker track  |
            | scene track   |
            | region track  |
