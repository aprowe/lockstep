//! Warp orchestrator: chains the pipeline stages in `crate::pipeline` into the
//! single `remap_video` entry point. Also houses the standalone BPM estimator
//! and the legacy constant-fps `interpolate_video` helper which aren't part of
//! the warp pipeline proper.

use tempfile::TempDir;

use crate::ffmpeg::video_duration;
use crate::pipeline::{
    post::{apply_post_processing, PostOptions},
    rife_pass::apply_warp_aware_rife,
    segments::{concat_segments, encode_segments, plan_segments},
    time_map::build_time_map,
};

// Backward-compat re-exports: callers (commands, cli, tests) import these via
// `crate::processor::`. Keep the surface stable during refactors.
pub use crate::pipeline::options::{InterpMethod, WarpOptions};

// ── BPM Estimation ──────────────────────────────────────────────────────────

/// Returns (bpm, beat_interval, snap_interval).
/// Ported directly from frames2/backend/processor.py::estimate_bpm
pub fn estimate_bpm(anchor_times: &[f64]) -> (f64, f64, f64) {
    if anchor_times.len() < 2 {
        return (120.0, 0.5, 0.5);
    }

    let mut sorted = anchor_times.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());

    let intervals: Vec<f64> = sorted.windows(2).map(|w| w[1] - w[0]).collect();

    let mut sorted_intervals = intervals.clone();
    sorted_intervals.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let median_interval = sorted_intervals[sorted_intervals.len() / 2];

    if median_interval <= 0.0 {
        return (120.0, 0.5, 0.5);
    }

    let clean: Vec<f64> = intervals
        .iter()
        .filter(|&&x| x > 0.0 && x < median_interval * 2.5)
        .copied()
        .collect();

    let clean = if clean.is_empty() {
        intervals.iter().filter(|&&x| x > 0.0).copied().collect::<Vec<_>>()
    } else {
        clean
    };

    if clean.is_empty() {
        return (120.0, 0.5, 0.5);
    }

    let avg_interval = clean.iter().sum::<f64>() / clean.len() as f64;

    let divisors: &[f64] = &[1.0, 2.0, 0.5, 4.0, 0.25, 3.0, 1.0 / 3.0];
    let mut best_bpm: Option<f64> = None;
    let mut best_interval = avg_interval;

    for &divisor in divisors {
        if divisor <= 0.0 {
            continue;
        }
        let candidate_interval = avg_interval / divisor;
        if candidate_interval <= 0.0 {
            continue;
        }
        let candidate_bpm = 60.0 / candidate_interval;
        if best_bpm.is_none() && (60.0..=180.0).contains(&candidate_bpm) {
            best_bpm = Some(candidate_bpm);
            best_interval = candidate_interval;
        }
    }

    let (best_bpm, best_interval) = match best_bpm {
        Some(bpm) => (bpm, best_interval),
        None => (60.0 / avg_interval, avg_interval),
    };

    ((best_bpm * 100.0).round() / 100.0, best_interval, avg_interval)
}

// ── Orchestrator ────────────────────────────────────────────────────────────

/// Main time-warp entry point. Builds the time map, renders & concatenates
/// retimed segments, optionally swaps the video for warp-aware RIFE output,
/// then applies post-processing. Each stage lives in its own module under
/// `crate::pipeline` so it can be tested and validated independently.
pub fn remap_video<F>(
    input_path: &str,
    opts: &WarpOptions,
    output_path: &str,
    progress: &F,
) -> Result<(), String>
where
    F: Fn(f64, &str) + Send,
{
    // ── Stage 1: Time map ──
    let duration = video_duration(input_path)?;
    let clip_start = opts.clip_in.unwrap_or(0.0).max(0.0);
    let clip_end = opts.clip_out.unwrap_or(duration).min(duration);

    if opts.no_smooth {
        eprintln!("[warp] PCHIP smoothing disabled; using raw piecewise-linear time map");
    }
    let time_map = build_time_map(
        &opts.orig_times,
        &opts.beat_times,
        clip_start,
        clip_end,
        !opts.no_smooth,
    );

    // ── Stage 2: Segments ──
    let tmp_dir = TempDir::new().map_err(|e| e.to_string())?;
    let tmp_path = tmp_dir.path();

    let plans = plan_segments(&time_map);
    let segment_files = encode_segments(
        input_path,
        &plans,
        opts.interp_fps,
        opts.interp_method,
        tmp_path,
        progress,
    )?;

    // ── Stage 3: Concat ──
    concat_segments(&segment_files, tmp_path, output_path, progress)?;

    // ── Stage 4 (optional): warp-aware RIFE, replacing the video track ──
    if let (Some(fps), InterpMethod::Rife) = (opts.interp_fps, opts.interp_method) {
        apply_warp_aware_rife(input_path, &time_map, fps, output_path, tmp_path, progress)?;
    }

    // ── Stage 5: Post-processing ──
    let first_beat_time = opts.beat_times.iter().copied().reduce(f64::min).unwrap_or(0.0);
    apply_post_processing(
        output_path,
        PostOptions {
            bpm: opts.bpm,
            beat_zero_time: opts.beat_zero_time,
            first_beat_time,
            add_to_end: opts.add_to_end,
            trim_to_loop: opts.trim_to_loop,
            loop_beats: opts.loop_beats,
            normalize_bpm: opts.normalize_bpm,
        },
        tmp_path,
        progress,
    )?;

    progress(1.0, "Done");
    Ok(())
}

// ── Constant-fps interpolation (legacy, not part of the warp pipeline) ──────

/// Re-encode `input_path` at a constant `fps` using blend-mode frame interpolation.
/// Frames that don't align with a source frame are blended from the two nearest.
pub fn interpolate_video<F>(
    input_path: &str,
    fps: u32,
    output_path: &str,
    progress: &F,
) -> Result<(), String>
where
    F: Fn(f64, &str) + Send,
{
    progress(0.0, &format!("Interpolating to {fps} fps..."));

    let fps_str = fps.to_string();
    let vf = format!("minterpolate=fps={fps}:mi_mode=blend");

    crate::ffmpeg::run_ffmpeg(&[
        "-y",
        "-i", input_path,
        "-vf", &vf,
        "-r", &fps_str,
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "18",
        "-c:a", "copy",
        output_path,
    ])?;

    progress(1.0, "Done");
    Ok(())
}
