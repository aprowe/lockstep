use std::path::PathBuf;
use tempfile::TempDir;

use crate::ffmpeg::{atempo_chain, ffprobe_json, run_ffmpeg};
use crate::pchip::smooth_time_map;

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

// ── Time Map ────────────────────────────────────────────────────────────────

/// Piecewise-linear time map: orig_time → output_time.
/// Ported from frames2/backend/processor.py::_direct_time_map
/// clip_start/clip_end define the range of the source video to process.
fn direct_time_map(
    orig_times: &[f64],
    beat_times: &[f64],
    clip_start: f64,
    clip_end: f64,
) -> Vec<(f64, f64)> {
    let mut pairs: Vec<(f64, f64)> = orig_times
        .iter()
        .zip(beat_times.iter())
        .map(|(&o, &b)| (o, b))
        .collect();
    pairs.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());

    // First sentinel: clip start maps to output time 0
    let mut control_points: Vec<(f64, f64)> = vec![(clip_start, 0.0)];

    for (orig_t, beat_t) in &pairs {
        if *orig_t > control_points.last().unwrap().0 + 1e-6 {
            control_points.push((*orig_t, *beat_t));
        }
    }

    let (last_orig, last_beat) = *control_points.last().unwrap();
    if clip_end > last_orig + 0.001 {
        let tail_out = last_beat + (clip_end - last_orig);
        control_points.push((clip_end, tail_out));
    }

    control_points
}

/// Build the PCHIP-smoothed time map from raw anchor arrays and clip bounds.
/// Returns densified `(orig_time, output_time)` control points ready for segmenting.
pub fn build_smooth_time_map(
    orig_times: &[f64],
    beat_times: &[f64],
    clip_start: f64,
    clip_end: f64,
) -> Vec<(f64, f64)> {
    let linear = direct_time_map(orig_times, beat_times, clip_start, clip_end);
    smooth_time_map(&linear, 0.5)
}

// ── Video Duration ───────────────────────────────────────────────────────────

pub fn get_video_duration(path: &str) -> Result<f64, String> {
    let info = ffprobe_json(path)?;
    info["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse::<f64>().ok())
        .ok_or_else(|| "ffprobe: missing duration".to_string())
}

// ── Remap Video ─────────────────────────────────────────────────────────────

pub struct WarpOptions {
    pub orig_times: Vec<f64>,
    pub beat_times: Vec<f64>,
    pub bpm: f64,
    pub beat_zero_time: f64,
    pub add_to_end: bool,
    pub trim_to_loop: bool,
    pub loop_beats: Option<u32>,
    pub normalize_bpm: bool,
    pub fade_at_loop: bool,
    /// Start of clip in source video (seconds). None = 0.0
    pub clip_in: Option<f64>,
    /// End of clip in source video (seconds). None = video duration
    pub clip_out: Option<f64>,
    /// When set, each segment is encoded at this constant fps with blend interpolation.
    pub interp_fps: Option<u32>,
}

/// Main time-warp pipeline. Ported from frames2/backend/processor.py::remap_video
pub fn remap_video<F>(
    input_path: &str,
    opts: &WarpOptions,
    output_path: &str,
    progress: &F,
) -> Result<(), String>
where
    F: Fn(f64, &str) + Send,
{
    let duration = get_video_duration(input_path)?;

    let clip_start = opts.clip_in.unwrap_or(0.0).max(0.0);
    let clip_end = opts.clip_out.unwrap_or(duration).min(duration);
    let linear_map = direct_time_map(&opts.orig_times, &opts.beat_times, clip_start, clip_end);
    // Densify with PCHIP so speed transitions smoothly between anchor points
    // rather than snapping to a new constant ratio at each boundary.
    let time_map = smooth_time_map(&linear_map, 0.5);

    let tmp_dir = TempDir::new().map_err(|e| e.to_string())?;
    let tmp_path = tmp_dir.path();

    progress(0.02, "Building segments...");

    let n_segs = time_map.len().saturating_sub(1);
    let mut segment_files: Vec<PathBuf> = Vec::new();

    for i in 0..n_segs {
        let (in_start, _) = time_map[i];
        let (in_end, _) = time_map[i + 1];
        let (_, out_start) = time_map[i];
        let (_, out_end) = time_map[i + 1];

        let seg_in_dur = in_end - in_start;
        let seg_out_dur = out_end - out_start;

        if seg_in_dur <= 0.001 || seg_out_dur <= 0.001 {
            continue;
        }
       
        // Dont hard code these
        let ratio = (seg_out_dur / seg_in_dur).max(0.5).min(2.0);

        let seg_out = tmp_path.join(format!("seg_{i:04}.mp4"));
        let seg_out_str = seg_out.to_string_lossy().to_string();

        let atempo = atempo_chain(1.0 / ratio);
        let vf = match opts.interp_fps {
            Some(fps) => format!("setpts={ratio:.6}*PTS,minterpolate=fps={fps}:mi_mode=blend"),
            None      => format!("setpts={ratio:.6}*PTS"),
        };
        let ss = format!("{in_start}");
        let t = format!("{seg_in_dur}");
        let fps_args: Vec<&str> = match opts.interp_fps {
            Some(_) => vec!["-vsync", "cfr"],
            None    => vec![],
        };

        // Try with audio first
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

        let result = run_ffmpeg(&args);

        if result.is_err() {
            // Fallback: no audio
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
            run_ffmpeg(&args_na)
                .map_err(|e| format!("Segment {i} failed: {e}"))?;
        }

        if seg_out.exists() {
            segment_files.push(seg_out);
        }

        progress(
            0.02 + 0.78 * (i + 1) as f64 / n_segs as f64,
            &format!("Segment {}/{}", i + 1, n_segs),
        );
    }

    if segment_files.is_empty() {
        return Err("No segments were created".to_string());
    }

    // Build concat list — forward slashes required on Windows too
    let concat_path = tmp_path.join("concat.txt");
    let concat_content: String = segment_files
        .iter()
        .map(|p| format!("file '{}'\n", p.to_string_lossy().replace('\\', "/")))
        .collect();
    std::fs::write(&concat_path, &concat_content).map_err(|e| e.to_string())?;

    progress(0.82, "Concatenating segments...");

    let concat_str = concat_path.to_string_lossy().to_string();

    let concat_result = run_ffmpeg(&[
        "-y", "-hide_banner", "-loglevel", "error",
        "-f", "concat", "-safe", "0",
        "-i", &concat_str,
        "-c", "copy",
        output_path,
    ]);

    if concat_result.is_err() {
        // Re-encode fallback
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

    progress(0.88, "Post-processing...");

    let beat_interval = 60.0 / opts.bpm;

    // Determine first beat time from first beat anchor
    let first_beat_time = opts.beat_times.iter().copied().reduce(f64::min).unwrap_or(0.0);
    let beat_zero = opts.beat_zero_time;

    if let Some(loop_beats) = opts.loop_beats {
        if loop_beats > 0 && opts.add_to_end && beat_zero > first_beat_time + 0.01 {
            let loop_duration = loop_beats as f64 * beat_interval;
            let pre_beat_dur = beat_zero - first_beat_time;

            // Trim to [first_beat_time, first_beat_time + loop_duration]
            let trimmed = format!("{output_path}.trim.mp4");
            run_ffmpeg(&[
                "-y", "-hide_banner", "-loglevel", "error",
                "-ss", &format!("{first_beat_time}"),
                "-t", &format!("{loop_duration}"),
                "-i", output_path,
                "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                "-c:a", "aac", "-b:a", "192k",
                &trimmed,
            ])?;
            std::fs::rename(&trimmed, output_path).map_err(|e| e.to_string())?;

            // Rearrange: [beat_zero→end] + [first_beat→beat_zero]
            let adjusted_zero = beat_zero - first_beat_time;
            rearrange_loop(output_path, adjusted_zero, pre_beat_dur, tmp_path)?;
        } else if loop_beats > 0 {
            let loop_duration = loop_beats as f64 * beat_interval;
            let trimmed = format!("{output_path}.loop.mp4");
            // Re-encode (not stream-copy) so FFmpeg decodes accurately to beat_zero
            // and makes it keyframe 0.  Stream-copy would fast-seek to the nearest
            // keyframe *before* beat_zero and dump those pre-beat frames with PTS=0.
            run_ffmpeg(&[
                "-y", "-hide_banner", "-loglevel", "error",
                "-ss", &format!("{beat_zero}"),
                "-t", &format!("{loop_duration}"),
                "-i", output_path,
                "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                "-c:a", "aac", "-b:a", "192k",
                "-avoid_negative_ts", "make_zero",
                &trimmed,
            ])?;
            if std::path::Path::new(&trimmed).exists() {
                std::fs::rename(&trimmed, output_path).map_err(|e| e.to_string())?;
            }
        }
    } else if opts.add_to_end && beat_zero > first_beat_time + 0.01 {
        let pre_beat_dur = beat_zero - first_beat_time;
        rearrange_loop(output_path, beat_zero, pre_beat_dur, tmp_path)?;
    } else if opts.trim_to_loop {
        // Trim to last complete beat from beat_zero
        let out_dur = get_video_duration(output_path)?;
        let beats_in = ((out_dur - beat_zero) / beat_interval).floor() as u32;
        if beats_in > 0 {
            let trim_end = beat_zero + beats_in as f64 * beat_interval;
            let trimmed = format!("{output_path}.trim.mp4");
            let r = run_ffmpeg(&[
                "-y", "-hide_banner", "-loglevel", "error",
                "-ss", &format!("{beat_zero}"),
                "-to", &format!("{trim_end}"),
                "-i", output_path,
                "-c", "copy",
                &trimmed,
            ]);
            if r.is_err() {
                run_ffmpeg(&[
                    "-y", "-hide_banner", "-loglevel", "error",
                    "-ss", &format!("{beat_zero}"),
                    "-to", &format!("{trim_end}"),
                    "-i", output_path,
                    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                    "-c:a", "aac",
                    &trimmed,
                ])?;
            }
            if std::path::Path::new(&trimmed).exists() {
                std::fs::rename(&trimmed, output_path).map_err(|e| e.to_string())?;
            }
        }
    }

    if opts.normalize_bpm && (opts.bpm - 120.0).abs() > 0.01 {
        let speed = 120.0 / opts.bpm;
        let normed = format!("{output_path}.norm.mp4");
        let atempo = atempo_chain(speed);
        run_ffmpeg(&[
            "-y", "-hide_banner", "-loglevel", "error",
            "-i", output_path,
            "-vf", &format!("setpts=PTS/{speed:.6}"),
            "-af", &atempo,
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac", "-b:a", "192k",
            &normed,
        ])?;
        std::fs::rename(&normed, output_path).map_err(|e| e.to_string())?;
    }

    progress(1.0, "Done");
    Ok(())
}

/// Split output at beat_zero_time, rearrange to: [beat_zero→end] + [0→beat_zero]
fn rearrange_loop(
    output_path: &str,
    beat_zero_time: f64,
    pre_beat_dur: f64,
    tmp_path: &std::path::Path,
) -> Result<(), String> {
    if pre_beat_dur <= 0.01 {
        return Ok(());
    }

    let part_b = tmp_path.join("loop_b.mp4").to_string_lossy().to_string();
    let part_a = tmp_path.join("loop_a.mp4").to_string_lossy().to_string();
    let enc = &["-c:v", "libx264", "-preset", "fast", "-crf", "23", "-c:a", "aac", "-b:a", "192k"];

    run_ffmpeg(&[
        &["-y", "-hide_banner", "-loglevel", "error",
          "-ss", &format!("{beat_zero_time}"), "-i", output_path],
        enc.as_slice(),
        &[&part_b],
    ].concat())?;

    run_ffmpeg(&[
        &["-y", "-hide_banner", "-loglevel", "error",
          "-ss", "0", "-t", &format!("{pre_beat_dur}"), "-i", output_path],
        enc.as_slice(),
        &["-t", &format!("{pre_beat_dur}"), &part_a],
    ].concat())?;

    let rearranged = format!("{output_path}.loop.mp4");
    run_ffmpeg(&[
        "-y", "-hide_banner", "-loglevel", "error",
        "-i", &part_b, "-i", &part_a,
        "-filter_complex", "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]",
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac", "-b:a", "192k",
        &rearranged,
    ])?;

    if std::path::Path::new(&rearranged).exists() {
        std::fs::rename(&rearranged, output_path).map_err(|e| e.to_string())?;
    }

    Ok(())
}

// ── Frame Interpolation ──────────────────────────────────────────────────────

/// Re-encode `input_path` at a constant `fps` using blend-mode frame interpolation.
/// Frames that don't align with a source frame are blended from the two nearest ones.
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
