//! Stage 4 — Post-processing: loop trimming, beat-zero rearrangement, BPM
//! normalization.
//!
//! These branches all operate on the already-retimed `output_path` and mutate
//! it in place via temp files. A local `PostOptions` struct carries only the
//! subset of `WarpOptions` that matters here, so the stage stays decoupled.

use std::path::Path;

use crate::ffmpeg::{atempo_chain, run_ffmpeg, video_duration};

/// Subset of `WarpOptions` relevant to post-processing. Keeping this separate
/// from the full request makes the stage easier to test and reuse.
#[derive(Clone, Copy, Debug)]
pub struct PostOptions {
    pub bpm: f64,
    pub beat_zero_time: f64,
    pub first_beat_time: f64,
    pub add_to_end: bool,
    pub trim_to_loop: bool,
    pub loop_beats: Option<u32>,
    pub normalize_bpm: bool,
}

pub fn apply_post_processing<F>(
    output_path: &str,
    opts: PostOptions,
    tmp_path: &Path,
    progress: &F,
) -> Result<(), String>
where
    F: Fn(f64, &str) + Send,
{
    progress(0.88, "Post-processing...");

    let beat_interval = 60.0 / opts.bpm;
    let beat_zero = opts.beat_zero_time;
    let first_beat_time = opts.first_beat_time;

    if let Some(loop_beats) = opts.loop_beats {
        if loop_beats > 0 && opts.add_to_end && beat_zero > first_beat_time + 0.01 {
            let loop_duration = loop_beats as f64 * beat_interval;
            let pre_beat_dur = beat_zero - first_beat_time;

            // Trim to [first_beat_time, first_beat_time + loop_duration] then
            // rearrange so playback starts at beat_zero.
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

            let adjusted_zero = beat_zero - first_beat_time;
            rearrange_loop(output_path, adjusted_zero, pre_beat_dur, tmp_path)?;
        } else if loop_beats > 0 {
            let loop_duration = loop_beats as f64 * beat_interval;
            let trimmed = format!("{output_path}.loop.mp4");
            // Re-encode (not stream-copy) so FFmpeg decodes accurately to
            // beat_zero and makes it keyframe 0. Stream-copy would fast-seek to
            // the nearest keyframe before beat_zero and dump pre-beat frames.
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
            if Path::new(&trimmed).exists() {
                std::fs::rename(&trimmed, output_path).map_err(|e| e.to_string())?;
            }
        }
    } else if opts.add_to_end && beat_zero > first_beat_time + 0.01 {
        let pre_beat_dur = beat_zero - first_beat_time;
        rearrange_loop(output_path, beat_zero, pre_beat_dur, tmp_path)?;
    } else if opts.trim_to_loop {
        let out_dur = video_duration(output_path)?;
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
            if Path::new(&trimmed).exists() {
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

    Ok(())
}

/// Split at `beat_zero_time`, rearrange to: [beat_zero→end] + [0→beat_zero].
fn rearrange_loop(
    output_path: &str,
    beat_zero_time: f64,
    pre_beat_dur: f64,
    tmp_path: &Path,
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

    if Path::new(&rearranged).exists() {
        std::fs::rename(&rearranged, output_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
