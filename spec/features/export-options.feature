Feature: Export Options

    # @ 
    Scenario: Interpolation Options
        Given I have a clip i would like to export
        When I check "Interpolate Frames"
        Then A panel is revealed that lets me pick the interpolation method, including minterpolate and RIFE, and the target FPS, 
            which is pre-populated with the current FPS

    # @test tests/bdd/exportOptions.test.ts
    # @hint The "Interpolate Frames" checkbox and FPS input map to the WarpRequest
    #       field `interp_fps` (Rust: Option<u32>). When checked + fps filled,
    #       the backend re-times each segment at that constant fps using
    #       ffmpeg's minterpolate filter (blend mode) instead of just setpts.
    Scenario: User Exports Frame Interpolated Video
        Given I have a clip i would like to export
        When I check "Interpolate Frames"
        And Fill in 60 FPS in the provided input
        And I click export
        Then my output video will run at 60 FPS consitently, with interpolated frames to control the variable speed

    # @test tests/bdd/exportOptions.test.ts
    # @hint Default path: interp_fps is null, so each segment uses only setpts
    #       to produce variable speed (no frame interpolation).
    Scenario: User Exports PTS set Video (Default)
        Given I have a clip i would like to export
        When I leave options as default
        And I click export
        Then my output video will run at with PTS set to control the variable speed

    # @test src-tauri/tests/export_save.rs
    # @hint save_to_folder (commands.rs) must call std::fs::create_dir_all on
    #       dest_folder before std::fs::copy. The Folder input in ExportDialog
    #       is free-text, so users can type nested paths that don't exist yet.
    Scenario: Export to a folder whose parents don't exist creates them
        Given I have a processed clip ready to save
        When I export to a folder path whose parent directories do not yet exist
        Then the missing parent directories are created
        And the output file lands at the expected nested path
