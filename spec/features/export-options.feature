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

    # @test tests/bdd/batchExport.test.ts
    # @hint In ExportDialog.process(), the dest-folder copy currently runs after
    #       the whole jobs loop finishes. Move saveToFolder() inside the job loop
    #       so each finished clip is copied to destFolder before the next warp starts.
    Scenario: Batch export saves each clip to the destination as it finishes
        Given I have three clips selected for batch export
        And a destination folder is set
        When the export begins
        Then each clip is written into the destination folder the moment its render completes
        And the next clip's render does not have to finish before earlier clips are saved

    # @test tests/bdd/batchExport.test.ts
    # @hint Wrap the per-job save+render in try/catch that logs and continues,
    #       rather than the current early `return` on error. Already-saved clips
    #       must be left in place.
    Scenario: Batch export continues past a failed clip
        Given I have three clips selected for batch export
        And a destination folder is set
        When the second clip fails to render
        Then the first clip is already in the destination folder and is not removed
        And the third clip is still rendered and saved
        And the failure is reported in the export log without aborting the batch

    # @test tests/bdd/exportFilename.test.ts
    # @hint applyPattern() currently passes `beats: loopBeats` for every job.
    #       For region jobs, pass the region's beat count (computed from its
    #       warped span, e.g. round((outPoint - inPoint) * bpm / 60)). Falls
    #       back to loopBeats only when there is no region context.
    Scenario: The {beats} token in the filename pattern resolves to the clip's beat count
        Given the filename pattern contains the {beats} token
        And a region with 32 beats is being exported
        When the export filename is generated for that region
        Then {beats} is replaced with 32
        And the token is not left blank or replaced with the global loop-beats value

    # @test tests/bdd/exportProgress.test.tsx
    # @hint Add a "Show folder" button in the ExportDialog header/progress area
    #       that is visible while status === 'processing' (and after) whenever
    #       destFolder is set. It invokes the `reveal_in_folder` Tauri command
    #       against destFolder, not against a finished output file.
    Scenario: Show Folder button appears on the progress screen as soon as export begins
        Given a destination folder is set
        When I click Export and processing starts
        Then a "Show Folder" button is visible on the progress screen
        And clicking it opens the destination folder in the OS file manager
        And the button remains available for the rest of the export and after it finishes
