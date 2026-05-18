//! Stage 3 (optional) — Warp-aware RIFE replacement of the concat video.
//!
//! When `InterpMethod::Rife` + `interp_fps` is active, we regenerate the video
//! from scratch by sampling source frames directly at output-time positions via
//! the time_map. The result is silent — RIFE'd exports don't carry audio — and
//! overwrites the concat output. Post-processing is responsible for handling
//! the silent input.

use std::path::Path;

use crate::pipeline::time_map::TimeMap;

/// Replace `output_path` with a warp-aware RIFE video. The output has no audio
/// track; post-processing downstream must tolerate that.
pub fn apply_warp_aware_rife<F>(
    input_path: &str,
    time_map: &TimeMap,
    scene_cuts: &[f64],
    fps: u32,
    output_path: &str,
    tmp_path: &Path,
    progress: &F,
) -> Result<(), String>
where
    F: Fn(f64, &str) + Send,
{
    progress(0.83, &format!("Warp-aware RIFE → source: {input_path}"));
    progress(0.83, &format!("RIFE scratch dir: {}", tmp_path.display()));

    let rife_silent = tmp_path.join("rife_silent.mp4").to_string_lossy().into_owned();
    progress(0.83, &format!("RIFE silent video: {rife_silent}"));

    crate::rife::interpolate_rife_warped(
        input_path,
        time_map,
        scene_cuts,
        fps,
        &rife_silent,
        progress,
    )?;

    progress(0.87, &format!("Replacing concat output with RIFE video → {output_path}"));
    std::fs::rename(&rife_silent, output_path).map_err(|e| e.to_string())?;
    Ok(())
}
