//! Stage 3 (optional) — Warp-aware RIFE replacement of the concat video.
//!
//! When `InterpMethod::Rife` + `interp_fps` is active, the concat output holds
//! only the retimed audio track — the video is regenerated from scratch by
//! sampling source frames directly at output-time positions via the time_map.
//! This stage wraps that call and re-muxes the retimed audio.

use std::path::Path;

use crate::ffmpeg::run_ffmpeg;
use crate::pipeline::time_map::TimeMap;

/// Replace the video track of `output_path` with warp-aware RIFE output, keeping
/// the existing audio. `tmp_path` is a scratch directory for the silent rife
/// pass and the mux target.
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
    progress(0.83, "Running warp-aware RIFE...");

    let rife_silent = tmp_path.join("rife_silent.mp4").to_string_lossy().into_owned();
    crate::rife::interpolate_rife_warped(
        input_path,
        time_map,
        scene_cuts,
        fps,
        &rife_silent,
        progress,
    )?;

    let muxed = tmp_path.join("rife_muxed.mp4").to_string_lossy().into_owned();
    let mux_res = run_ffmpeg(&[
        "-y", "-hide_banner", "-loglevel", "error",
        "-i", &rife_silent,
        "-i", output_path,
        "-map", "0:v:0",
        "-map", "1:a:0?",
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k",
        "-shortest",
        &muxed,
    ]);
    if mux_res.is_err() {
        // Concat output had no audio track — fall back to the silent rife video.
        std::fs::copy(&rife_silent, &muxed).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&muxed, output_path).map_err(|e| e.to_string())?;
    Ok(())
}
