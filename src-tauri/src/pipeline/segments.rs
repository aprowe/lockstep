//! Stage 2 — Segment planning (pure) + encoding/concat (I/O).
//!
//! The planner walks the time map and produces one `SegmentPlan` per interval
//! with the source-time window, output duration, and the capped setpts/atempo
//! ratio. That's pure and testable. The encoder takes plans + input/tmp paths
//! and shells out to ffmpeg; the concatter stitches the rendered pieces.

use std::path::{Path, PathBuf};

use crate::ffmpeg::{atempo_chain, run_ffmpeg};
use crate::pipeline::options::{AudioMode, InterpMethod};
use crate::pipeline::time_map::TimeMap;

/// One pre-computed segment: a slice of the source between `in_start` and
/// `in_start + in_dur`, to be retimed to `out_dur` seconds of output.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SegmentPlan {
    pub idx: usize,
    pub in_start: f64,
    pub in_dur: f64,
    pub out_dur: f64,
    /// `out_dur / in_dur`, clamped to [0.5, 2.0] to stay within atempo's range.
    /// Segments with extreme ratios will clip — callers relying on frame-exact
    /// output should densify the time map first.
    pub ratio: f64,
}

/// Walk the time map and produce one plan per interval. Skips degenerate
/// intervals silently — they'd produce zero-duration ffmpeg output and stall
/// the concat demuxer.
///
/// `min_segment_duration` is the floor (in seconds) for both the input slice
/// and the output slice. Caller passes `1.0 / source_fps` so sub-frame
/// segments — which closely-spaced markers can produce — are dropped before
/// they reach ffmpeg. Always clamped to at least 1ms so callers can pass 0
/// without disabling the legacy hard floor.
pub fn plan_segments(
    time_map: &TimeMap,
    min_segment_duration: f64,
) -> Vec<SegmentPlan> {
    let mut plans = Vec::new();
    if time_map.len() < 2 {
        return plans;
    }

    // Hard floor: a sub-millisecond interval is numerical noise and would
    // round to zero in ffmpeg's setpts/atempo, regardless of fps.
    let min_dur = min_segment_duration.max(0.001);

    for i in 0..time_map.len() - 1 {
        let (in_start, out_start) = time_map[i];
        let (in_end, out_end) = time_map[i + 1];
        let in_dur = in_end - in_start;
        let out_dur = out_end - out_start;

        if in_dur < min_dur || out_dur < min_dur {
            continue;
        }

        let ratio = (out_dur / in_dur).max(0.5).min(2.0);
        plans.push(SegmentPlan {
            idx: i,
            in_start,
            in_dur,
            out_dur,
            ratio,
        });
    }
    plans
}

/// Encode all segments, returning the list of produced files in order.
/// Progress is reported in the range `[0.02, 0.80]` for compatibility with the
/// legacy `remap_video` progress mapping.
///
/// `audio_mode` selects how the audio track is processed:
///   * `Tempo` — `atempo` keeps pitch fixed while length matches the new video.
///   * `Pitch` — `asetrate=sample_rate/ratio,aresample=sample_rate` re-pitches
///     the audio with the speed change (turntable-style).
///   * `None`  — `-an`; output has no audio stream.
/// `sample_rate` is only consulted in `Pitch` mode; pass the source's native
/// rate (or 44100 if unknown) so the resampler restores it after asetrate.
pub fn encode_segments<F>(
    input_path: &str,
    plans: &[SegmentPlan],
    interp_fps: Option<u32>,
    interp_method: InterpMethod,
    audio_mode: AudioMode,
    sample_rate: u32,
    tmp_path: &Path,
    progress: &F,
) -> Result<Vec<PathBuf>, String>
where
    F: Fn(f64, &str) + Send,
{
    progress(0.02, "Building segments...");
    let mut files: Vec<PathBuf> = Vec::new();
    let n = plans.len();
    if n == 0 {
        return Err("No segments were created".to_string());
    }

    // minterpolate is applied per-segment (cheap filter). RIFE is deferred to a
    // single post-concat pass (expensive, needs frame extraction).
    let inline_interp = interp_fps.filter(|_| interp_method == InterpMethod::Minterpolate);

    for (i, plan) in plans.iter().enumerate() {
        let seg_out = tmp_path.join(format!("seg_{:04}.mp4", plan.idx));
        let seg_out_str = seg_out.to_string_lossy().to_string();

        // Build video filter: retime + optional inline interp.
        let vf = match inline_interp {
            Some(fps) => format!("setpts={:.6}*PTS,minterpolate=fps={fps}:mi_mode=blend", plan.ratio),
            None => format!("setpts={:.6}*PTS", plan.ratio),
        };

        // Build audio filter from the chosen mode. `Tempo` keeps pitch fixed
        // via atempo; `Pitch` re-pitches with speed via asetrate; `None` has
        // no audio filter (we use `-an` below).
        let af_opt: Option<String> = match audio_mode {
            AudioMode::None => None,
            AudioMode::Tempo => Some(atempo_chain(1.0 / plan.ratio)),
            AudioMode::Pitch => {
                // setpts uses ratio = out_dur/in_dur (slowdown when > 1). The
                // matching audio expression scales the sample rate by 1/ratio
                // so the audio plays at the same speed as the video, then
                // resample back to the original rate so the muxer is happy.
                let new_rate = (sample_rate as f64 / plan.ratio).max(1.0);
                Some(format!("asetrate={new_rate:.0},aresample={sample_rate}"))
            }
        };

        let ss = format!("{}", plan.in_start);
        let t = format!("{}", plan.in_dur);
        let fps_args: Vec<&str> = match inline_interp {
            Some(_) => vec!["-vsync", "cfr"],
            None => vec![],
        };

        let result = if let Some(af) = af_opt.as_deref() {
            // Try with audio first.
            let mut args = vec![
                "-y", "-hide_banner", "-loglevel", "error",
                "-ss", &ss, "-t", &t, "-i", input_path,
                "-vf", &vf,
                "-af", af,
                "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                "-c:a", "aac", "-b:a", "192k",
                "-avoid_negative_ts", "make_zero",
            ];
            args.extend_from_slice(&fps_args);
            args.push(&seg_out_str);
            run_ffmpeg(&args)
        } else {
            Err("audio disabled".to_string())
        };

        if result.is_err() {
            // Fallback: no audio (either user requested it or the source
            // segment has no audio track to filter).
            let mut args_na = vec![
                "-y", "-hide_banner", "-loglevel", "error",
                "-ss", &ss, "-t", &t, "-i", input_path,
                "-vf", &vf,
                "-an",
                "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                "-avoid_negative_ts", "make_zero",
            ];
            args_na.extend_from_slice(&fps_args);
            args_na.push(&seg_out_str);
            run_ffmpeg(&args_na).map_err(|e| format!("Segment {} failed: {e}", plan.idx))?;
        }

        if seg_out.exists() {
            files.push(seg_out);
        }

        progress(
            0.02 + 0.78 * (i + 1) as f64 / n as f64,
            &format!("Segment {}/{}", i + 1, n),
        );
    }

    if files.is_empty() {
        return Err("No segments were created".to_string());
    }
    Ok(files)
}

/// Concatenate rendered segments into `output_path`. Tries stream-copy first
/// (fast, lossless) and falls back to a re-encode if codec/timing mismatch
/// trips the concat demuxer.
pub fn concat_segments<F>(
    segments: &[PathBuf],
    tmp_path: &Path,
    output_path: &str,
    progress: &F,
) -> Result<(), String>
where
    F: Fn(f64, &str) + Send,
{
    progress(0.82, "Concatenating segments...");

    // Concat demuxer wants forward slashes even on Windows.
    let concat_path = tmp_path.join("concat.txt");
    let concat_content: String = segments
        .iter()
        .map(|p| format!("file '{}'\n", p.to_string_lossy().replace('\\', "/")))
        .collect();
    std::fs::write(&concat_path, &concat_content).map_err(|e| e.to_string())?;
    let concat_str = concat_path.to_string_lossy().to_string();

    let copy_res = run_ffmpeg(&[
        "-y", "-hide_banner", "-loglevel", "error",
        "-f", "concat", "-safe", "0",
        "-i", &concat_str,
        "-c", "copy",
        output_path,
    ]);

    if copy_res.is_err() {
        run_ffmpeg(&[
            "-y", "-hide_banner", "-loglevel", "error",
            "-f", "concat", "-safe", "0",
            "-i", &concat_str,
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac",
            output_path,
        ])
        .map_err(|_| "FFmpeg concat failed".to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Default min: 1ms, matching the legacy hard floor before issue #14.
    /// Tests that exercise the fps-derived floor pass it explicitly.
    const MIN_DUR_MS: f64 = 0.001;

    #[test]
    fn empty_or_single_point_map_produces_no_plans() {
        assert!(plan_segments(&vec![], MIN_DUR_MS).is_empty());
        assert!(plan_segments(&vec![(0.0, 0.0)], MIN_DUR_MS).is_empty());
    }

    #[test]
    fn ratio_is_out_over_in() {
        // 1s source → 2s output = 2× stretch.
        let plans = plan_segments(&vec![(0.0, 0.0), (1.0, 2.0)], MIN_DUR_MS);
        assert_eq!(plans.len(), 1);
        assert!((plans[0].ratio - 2.0).abs() < 1e-9);
        assert!((plans[0].in_dur - 1.0).abs() < 1e-9);
        assert!((plans[0].out_dur - 2.0).abs() < 1e-9);
    }

    #[test]
    fn extreme_ratios_are_clamped_to_atempo_range() {
        // 4× and 0.25× both exceed atempo's 0.5–2.0 window.
        let fast = plan_segments(&vec![(0.0, 0.0), (1.0, 0.25)], MIN_DUR_MS);
        let slow = plan_segments(&vec![(0.0, 0.0), (1.0, 4.0)], MIN_DUR_MS);
        assert!((fast[0].ratio - 0.5).abs() < 1e-9);
        assert!((slow[0].ratio - 2.0).abs() < 1e-9);
    }

    #[test]
    fn submillisecond_intervals_are_skipped() {
        let plans = plan_segments(
            &vec![
                (0.0, 0.0),
                (0.0005, 0.001), // skipped: in_dur < 0.001
                (1.0, 1.5),
            ],
            MIN_DUR_MS,
        );
        assert_eq!(plans.len(), 1);
        assert_eq!(plans[0].idx, 1);
    }

    #[test]
    fn plan_idx_tracks_source_interval_not_filtered_index() {
        // Two clean intervals with one tiny gap in between.
        let plans = plan_segments(
            &vec![
                (0.0, 0.0),
                (1.0, 1.5),
                (1.0005, 1.5005),
                (2.0, 3.0),
            ],
            MIN_DUR_MS,
        );
        assert_eq!(plans.iter().map(|p| p.idx).collect::<Vec<_>>(), vec![0, 2]);
    }

    #[test]
    fn subframe_input_intervals_are_skipped_at_24fps() {
        // 24fps → 1/24 ≈ 41.67ms minimum. The middle interval is 30ms wide
        // on the input side, which is sub-frame and would round to a
        // zero-frame intermediate file.
        let one_frame_at_24 = 1.0 / 24.0;
        let plans = plan_segments(
            &vec![
                (0.000, 0.000),
                (0.500, 0.500),
                (0.530, 0.560), // 30ms input — sub-frame at 24fps, drop
                (1.500, 1.700),
            ],
            one_frame_at_24,
        );
        let idxs: Vec<usize> = plans.iter().map(|p| p.idx).collect();
        assert_eq!(idxs, vec![0, 2], "sub-frame middle segment must be filtered out");
    }

    #[test]
    fn subframe_output_intervals_are_skipped() {
        // Input is fine but the output interval is sub-frame at 24fps —
        // the segment would still produce zero frames after retiming.
        let one_frame_at_24 = 1.0 / 24.0;
        let plans = plan_segments(
            &vec![
                (0.000, 0.000),
                (0.500, 0.020), // out_dur = 20ms, sub-frame → drop
                (1.000, 1.000),
            ],
            one_frame_at_24,
        );
        assert_eq!(plans.len(), 1);
        assert_eq!(plans[0].idx, 1);
    }

    #[test]
    fn frame_threshold_below_legacy_floor_does_not_disable_it() {
        // Caller passes 0 (or anything < 1ms). The 1ms hard floor must
        // still apply — sub-millisecond intervals aren't safe regardless.
        let plans = plan_segments(
            &vec![
                (0.0, 0.0),
                (0.0005, 0.0005), // 0.5ms, below hard floor
                (1.0, 1.0),
            ],
            0.0,
        );
        assert_eq!(plans.len(), 1);
        assert_eq!(plans[0].idx, 1);
    }

}
