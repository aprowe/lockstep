//! Stage 4 — Post-processing: loop trimming and beat-zero rearrangement.
//!
//! These branches all operate on the already-retimed `output_path` and mutate
//! it in place via temp files. A local `PostOptions` struct carries only the
//! subset of `WarpOptions` that matters here, so the stage stays decoupled.

use std::path::Path;

use crate::ffmpeg::{has_audio_stream, run_ffmpeg, video_duration};

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
    progress(0.88, &format!("Post-processing → {output_path}"));

    let beat_interval = 60.0 / opts.bpm;
    let beat_zero = opts.beat_zero_time;
    let first_beat_time = opts.first_beat_time;

    // RIFE'd videos are silent; every ffmpeg branch below has to know so it can
    // drop `-c:a aac`, swap `atempo` for `-an`, and use the video-only concat
    // filter. Otherwise ffmpeg errors out on the missing audio stream
    // (historically surfaced as a "mux packet" error).
    let has_audio = has_audio_stream(output_path);
    progress(
        0.88,
        &format!("Input has audio: {has_audio} ({output_path})"),
    );

    if let Some(loop_beats) = opts.loop_beats {
        if loop_beats > 0 && opts.add_to_end && beat_zero > first_beat_time + 0.01 {
            let loop_duration = loop_beats as f64 * beat_interval;
            let pre_beat_dur = beat_zero - first_beat_time;

            // Trim to [first_beat_time, first_beat_time + loop_duration] then
            // rearrange so playback starts at beat_zero.
            let trimmed = format!("{output_path}.trim.mp4");
            let ss = format!("{first_beat_time}");
            let dur = format!("{loop_duration}");
            let mut args: Vec<&str> = vec![
                "-y", "-hide_banner", "-loglevel", "error",
                "-ss", &ss,
                "-t", &dur,
                "-i", output_path,
                "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            ];
            if has_audio {
                args.extend_from_slice(&["-c:a", "aac", "-b:a", "192k"]);
            } else {
                args.push("-an");
            }
            args.push(&trimmed);
            run_ffmpeg(&args)?;
            std::fs::rename(&trimmed, output_path).map_err(|e| e.to_string())?;

            let adjusted_zero = beat_zero - first_beat_time;
            rearrange_loop(output_path, adjusted_zero, pre_beat_dur, tmp_path, has_audio)?;
        } else if loop_beats > 0 {
            let loop_duration = loop_beats as f64 * beat_interval;
            let trimmed = format!("{output_path}.loop.mp4");
            let ss = format!("{beat_zero}");
            let dur = format!("{loop_duration}");
            let mut args: Vec<&str> = vec![
                "-y", "-hide_banner", "-loglevel", "error",
                "-ss", &ss,
                "-t", &dur,
                "-i", output_path,
                "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            ];
            if has_audio {
                args.extend_from_slice(&["-c:a", "aac", "-b:a", "192k"]);
            } else {
                args.push("-an");
            }
            args.extend_from_slice(&["-avoid_negative_ts", "make_zero", &trimmed]);
            // Re-encode (not stream-copy) so FFmpeg decodes accurately to
            // beat_zero and makes it keyframe 0. Stream-copy would fast-seek to
            // the nearest keyframe before beat_zero and dump pre-beat frames.
            run_ffmpeg(&args)?;
            if Path::new(&trimmed).exists() {
                std::fs::rename(&trimmed, output_path).map_err(|e| e.to_string())?;
            }
        }
    } else if opts.add_to_end && beat_zero > first_beat_time + 0.01 {
        let pre_beat_dur = beat_zero - first_beat_time;
        rearrange_loop(output_path, beat_zero, pre_beat_dur, tmp_path, has_audio)?;
    } else if opts.trim_to_loop {
        let out_dur = video_duration(output_path)?;
        let beats_in = ((out_dur - beat_zero) / beat_interval).floor() as u32;
        if beats_in > 0 {
            let trim_end = beat_zero + beats_in as f64 * beat_interval;
            let trimmed = format!("{output_path}.trim.mp4");
            let ss = format!("{beat_zero}");
            let to = format!("{trim_end}");
            let r = run_ffmpeg(&[
                "-y", "-hide_banner", "-loglevel", "error",
                "-ss", &ss,
                "-to", &to,
                "-i", output_path,
                "-c", "copy",
                &trimmed,
            ]);
            if r.is_err() {
                let mut args: Vec<&str> = vec![
                    "-y", "-hide_banner", "-loglevel", "error",
                    "-ss", &ss,
                    "-to", &to,
                    "-i", output_path,
                    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                ];
                if has_audio {
                    args.extend_from_slice(&["-c:a", "aac"]);
                } else {
                    args.push("-an");
                }
                args.push(&trimmed);
                run_ffmpeg(&args)?;
            }
            if Path::new(&trimmed).exists() {
                std::fs::rename(&trimmed, output_path).map_err(|e| e.to_string())?;
            }
        }
    }

    Ok(())
}

/// Split at `beat_zero_time`, rearrange to: [beat_zero→end] + [0→beat_zero].
/// `has_audio` is threaded through so the concat filter drops the audio pads
/// when the input is silent (e.g. post-RIFE output).
#[allow(unreachable_code, unused_variables)]
fn rearrange_loop(
    output_path: &str,
    beat_zero_time: f64,
    pre_beat_dur: f64,
    tmp_path: &Path,
    has_audio: bool,
) -> Result<(), String> {
    // Temporarily disabled — caller still wires add_to_end through but we skip
    // the actual split/concat until we revisit this path. Re-enable by
    // deleting this early return.
    return Ok(());

    if pre_beat_dur <= 0.01 {
        return Ok(());
    }

    let part_b = tmp_path.join("loop_b.mp4").to_string_lossy().to_string();
    let part_a = tmp_path.join("loop_a.mp4").to_string_lossy().to_string();

    let mut enc: Vec<&str> = vec!["-c:v", "libx264", "-preset", "fast", "-crf", "23"];
    if has_audio {
        enc.extend_from_slice(&["-c:a", "aac", "-b:a", "192k"]);
    } else {
        enc.push("-an");
    }

    let beat_zero_fmt = format!("{beat_zero_time}");
    let pre_beat_fmt = format!("{pre_beat_dur}");

    let mut args_b: Vec<&str> = vec![
        "-y", "-hide_banner", "-loglevel", "error",
        "-ss", &beat_zero_fmt, "-i", output_path,
    ];
    args_b.extend_from_slice(&enc);
    args_b.push(&part_b);
    run_ffmpeg(&args_b)?;

    let mut args_a: Vec<&str> = vec![
        "-y", "-hide_banner", "-loglevel", "error",
        "-ss", "0", "-t", &pre_beat_fmt, "-i", output_path,
    ];
    args_a.extend_from_slice(&enc);
    args_a.extend_from_slice(&["-t", &pre_beat_fmt, &part_a]);
    run_ffmpeg(&args_a)?;

    let rearranged = format!("{output_path}.loop.mp4");
    if has_audio {
        run_ffmpeg(&[
            "-y", "-hide_banner", "-loglevel", "error",
            "-i", &part_b, "-i", &part_a,
            "-filter_complex", "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]",
            "-map", "[v]", "-map", "[a]",
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac", "-b:a", "192k",
            &rearranged,
        ])?;
    } else {
        run_ffmpeg(&[
            "-y", "-hide_banner", "-loglevel", "error",
            "-i", &part_b, "-i", &part_a,
            "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]",
            "-map", "[v]",
            "-an",
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            &rearranged,
        ])?;
    }

    if Path::new(&rearranged).exists() {
        std::fs::rename(&rearranged, output_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
