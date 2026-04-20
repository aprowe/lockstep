//! Stage 2 — Segment planning (pure) + encoding/concat (I/O).
//!
//! The planner walks the time map and produces one `SegmentPlan` per interval
//! with the source-time window, output duration, and the capped setpts/atempo
//! ratio. That's pure and testable. The encoder takes plans + input/tmp paths
//! and shells out to ffmpeg; the concatter stitches the rendered pieces.

use std::path::{Path, PathBuf};

use crate::ffmpeg::{atempo_chain, run_ffmpeg};
use crate::pipeline::options::InterpMethod;
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
    /// Freeze-frame + silence seconds appended after the source slice. Used by
    /// trigger mode when the output interval is longer than the source window;
    /// 0.0 in warp mode.
    pub pad_dur: f64,
}

/// Walk the time map and produce one plan per interval. Skips degenerate
/// (sub-millisecond) intervals silently — they'd produce zero-duration ffmpeg
/// output and stall the concat demuxer.
///
/// When `trigger_mode` is true, segments play at 1.0x from `in_start` until the
/// next anchor trigger fires: the source is truncated if the output interval is
/// shorter, or extended via `pad_dur` if longer. Otherwise the existing warp
/// behaviour (ratio-stretched to fill `out_dur`) applies and `pad_dur` is 0.
pub fn plan_segments(time_map: &TimeMap, trigger_mode: bool) -> Vec<SegmentPlan> {
    let mut plans = Vec::new();
    if time_map.len() < 2 {
        return plans;
    }

    for i in 0..time_map.len() - 1 {
        let (in_start, out_start) = time_map[i];
        let (in_end, out_end) = time_map[i + 1];
        let in_dur = in_end - in_start;
        let out_dur = out_end - out_start;

        if in_dur <= 0.001 || out_dur <= 0.001 {
            continue;
        }

        if trigger_mode {
            let in_dur_capped = in_dur.min(out_dur);
            let pad_dur = (out_dur - in_dur_capped).max(0.0);
            plans.push(SegmentPlan {
                idx: i,
                in_start,
                in_dur: in_dur_capped,
                out_dur,
                ratio: 1.0,
                pad_dur,
            });
        } else {
            let ratio = (out_dur / in_dur).max(0.5).min(2.0);
            plans.push(SegmentPlan {
                idx: i,
                in_start,
                in_dur,
                out_dur,
                ratio,
                pad_dur: 0.0,
            });
        }
    }
    plans
}

/// Encode all segments, returning the list of produced files in order.
/// Progress is reported in the range `[0.02, 0.80]` for compatibility with the
/// legacy `remap_video` progress mapping.
pub fn encode_segments<F>(
    input_path: &str,
    plans: &[SegmentPlan],
    interp_fps: Option<u32>,
    interp_method: InterpMethod,
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

        // Build video filter: retime, optional inline interp, optional freeze-pad.
        let mut vf = match inline_interp {
            Some(fps) => format!("setpts={:.6}*PTS,minterpolate=fps={fps}:mi_mode=blend", plan.ratio),
            None => format!("setpts={:.6}*PTS", plan.ratio),
        };
        if plan.pad_dur > 0.001 {
            vf.push_str(&format!(",tpad=stop_duration={:.6}:stop_mode=clone", plan.pad_dur));
        }

        // Build audio filter: retime via atempo, optional silence pad.
        let mut af = atempo_chain(1.0 / plan.ratio);
        if plan.pad_dur > 0.001 {
            af.push_str(&format!(",apad=pad_dur={:.6}", plan.pad_dur));
        }
        let atempo = af;
        let ss = format!("{}", plan.in_start);
        let t = format!("{}", plan.in_dur);
        let fps_args: Vec<&str> = match inline_interp {
            Some(_) => vec!["-vsync", "cfr"],
            None => vec![],
        };

        // Try with audio first.
        let mut args = vec![
            "-y", "-hide_banner", "-loglevel", "error",
            "-ss", &ss, "-t", &t, "-i", input_path,
            "-vf", &vf,
            "-af", &atempo,
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac", "-b:a", "192k",
            "-avoid_negative_ts", "make_zero",
        ];
        args.extend_from_slice(&fps_args);
        args.push(&seg_out_str);

        if run_ffmpeg(&args).is_err() {
            // Fallback: no audio (source segment may have no audio track).
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

    #[test]
    fn empty_or_single_point_map_produces_no_plans() {
        assert!(plan_segments(&vec![], false).is_empty());
        assert!(plan_segments(&vec![(0.0, 0.0)], false).is_empty());
    }

    #[test]
    fn ratio_is_out_over_in() {
        // 1s source → 2s output = 2× stretch.
        let plans = plan_segments(&vec![(0.0, 0.0), (1.0, 2.0)], false);
        assert_eq!(plans.len(), 1);
        assert!((plans[0].ratio - 2.0).abs() < 1e-9);
        assert!((plans[0].in_dur - 1.0).abs() < 1e-9);
        assert!((plans[0].out_dur - 2.0).abs() < 1e-9);
        assert_eq!(plans[0].pad_dur, 0.0);
    }

    #[test]
    fn extreme_ratios_are_clamped_to_atempo_range() {
        // 4× and 0.25× both exceed atempo's 0.5–2.0 window.
        let fast = plan_segments(&vec![(0.0, 0.0), (1.0, 0.25)], false);
        let slow = plan_segments(&vec![(0.0, 0.0), (1.0, 4.0)], false);
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
            false,
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
            false,
        );
        assert_eq!(plans.iter().map(|p| p.idx).collect::<Vec<_>>(), vec![0, 2]);
    }

    #[test]
    fn trigger_mode_truncates_source_when_output_shorter() {
        // 2s source interval → 1s output. Trigger mode plays 1s at 1.0x, no pad.
        let plans = plan_segments(&vec![(0.0, 0.0), (2.0, 1.0)], true);
        assert_eq!(plans.len(), 1);
        assert_eq!(plans[0].ratio, 1.0);
        assert!((plans[0].in_dur - 1.0).abs() < 1e-9);
        assert_eq!(plans[0].pad_dur, 0.0);
    }

    #[test]
    fn trigger_mode_pads_when_output_longer() {
        // 1s source interval → 2s output. Trigger mode plays 1s at 1.0x, pads 1s.
        let plans = plan_segments(&vec![(0.0, 0.0), (1.0, 2.0)], true);
        assert_eq!(plans.len(), 1);
        assert_eq!(plans[0].ratio, 1.0);
        assert!((plans[0].in_dur - 1.0).abs() < 1e-9);
        assert!((plans[0].pad_dur - 1.0).abs() < 1e-9);
    }
}
