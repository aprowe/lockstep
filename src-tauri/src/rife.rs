//! Warp-aware RIFE frame interpolation via the rife-ncnn-vulkan standalone
//! binary (aprowe fork — adds `-M manifest.json` batch mode).
//!
//! Entry point: `interpolate_rife_warped`. Given the piecewise-linear time_map
//! (t_src → t_out) and a target fps, it decides for each output frame whether
//! to copy a source frame (degenerate or scene-cut bracket) or to interpolate.
//! All interpolation entries are packed into a single manifest and fed to
//! rife-ncnn-vulkan in ONE invocation — previously we spawned rife once per
//! frame, which paid model-load + vulkan-init overhead for every single frame.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tempfile::TempDir;

use crate::ffmpeg::{ffprobe_json, run_ffmpeg};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const MODEL_NAME: &str = "rife-v4.6";

fn find_rife() -> Result<(String, PathBuf), String> {
    let mut search_dirs: Vec<PathBuf> = Vec::new();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            search_dirs.push(dir.to_path_buf());
        }
    }

    if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
        search_dirs.push(PathBuf::from(&manifest).join("binaries"));
    }
    search_dirs.push(PathBuf::from("src-tauri").join("binaries"));

    #[cfg(target_os = "windows")]
    let exe_names = vec![
        "rife-ncnn-vulkan-x86_64-pc-windows-msvc.exe",
        "rife-ncnn-vulkan.exe",
    ];
    #[cfg(target_os = "macos")]
    let exe_names = vec![
        "rife-ncnn-vulkan-aarch64-apple-darwin",
        "rife-ncnn-vulkan-x86_64-apple-darwin",
        "rife-ncnn-vulkan",
    ];
    #[cfg(target_os = "linux")]
    let exe_names = vec![
        "rife-ncnn-vulkan-x86_64-unknown-linux-gnu",
        "rife-ncnn-vulkan",
    ];

    for dir in &search_dirs {
        for name in &exe_names {
            let exe = dir.join(name);
            let model = dir.join(MODEL_NAME);
            if exe.exists() && model.is_dir() {
                return Ok((exe.to_string_lossy().into_owned(), model));
            }
        }
    }

    Err(format!(
        "rife-ncnn-vulkan not found. Run `npm run setup` to install it, or copy \
        the binary + {MODEL_NAME}/ model folder into src-tauri/binaries/."
    ))
}

fn source_fps(input: &str) -> Result<f64, String> {
    let info = ffprobe_json(input)?;
    let streams = info["streams"].as_array().ok_or("ffprobe: no streams")?;
    let v = streams
        .iter()
        .find(|s| s["codec_type"].as_str() == Some("video"))
        .ok_or("ffprobe: no video stream")?;
    let rate = v["r_frame_rate"].as_str().ok_or("ffprobe: no r_frame_rate")?;
    let (num, den) = rate.split_once('/').ok_or("ffprobe: bad r_frame_rate")?;
    let num: f64 = num.parse().map_err(|e| format!("fps parse: {e}"))?;
    let den: f64 = den.parse().map_err(|e| format!("fps parse: {e}"))?;
    if den <= 0.0 {
        return Err("ffprobe: r_frame_rate denominator is zero".into());
    }
    Ok(num / den)
}

fn list_pngs(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut frames: Vec<PathBuf> = std::fs::read_dir(dir)
        .map_err(|e| format!("read_dir {}: {e}", dir.display()))?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("png"))
        .collect();
    frames.sort();
    Ok(frames)
}

/// Spawn rife-ncnn-vulkan in manifest mode and stream its stderr, forwarding
/// `progress N/total` lines to the caller.
fn run_rife_manifest<F>(
    exe: &str,
    src_dir: &Path,
    out_dir: &Path,
    model_dir: &Path,
    manifest_path: &Path,
    total: usize,
    progress_start: f64,
    progress_end: f64,
    progress: &F,
) -> Result<(), String>
where
    F: Fn(f64, &str) + Send,
{
    let src = src_dir.to_string_lossy().into_owned();
    let out = out_dir.to_string_lossy().into_owned();
    let model = model_dir.to_string_lossy().into_owned();
    let manifest = manifest_path.to_string_lossy().into_owned();

    let mut cmd = Command::new(exe);
    cmd.args([
        "-i", &src,
        "-o", &out,
        "-M", &manifest,
        "-m", &model,
        "-g", "1",
    ])
    .stdout(Stdio::null())
    .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("rife-ncnn-vulkan failed to spawn: {e}"))?;

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "rife-ncnn-vulkan stderr unavailable".to_string())?;
    let reader = BufReader::new(stderr);
    let mut last_error_line = String::new();
    for line in reader.lines().map_while(Result::ok) {
        if let Some(rest) = line.strip_prefix("progress ") {
            if let Some((done_str, _)) = rest.split_once('/') {
                if let Ok(done) = done_str.parse::<usize>() {
                    let frac = if total == 0 {
                        1.0
                    } else {
                        (done as f64 / total as f64).clamp(0.0, 1.0)
                    };
                    progress(
                        progress_start + frac * (progress_end - progress_start),
                        &format!("RIFE frame {done}/{total}"),
                    );
                }
            }
        } else if !line.trim().is_empty() {
            last_error_line = line;
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("rife-ncnn-vulkan wait failed: {e}"))?;
    if !status.success() {
        return Err(format!(
            "rife-ncnn-vulkan manifest exited with status {status}: {last_error_line}"
        ));
    }
    Ok(())
}

/// Invert the piecewise-linear time_map (t_src, t_out) at the given output time.
fn invert_time_map(time_map: &[(f64, f64)], t_out: f64) -> f64 {
    if time_map.is_empty() {
        return 0.0;
    }
    if t_out <= time_map[0].1 {
        return time_map[0].0;
    }
    let last = time_map.last().unwrap();
    if t_out >= last.1 {
        return last.0;
    }
    let mut lo = 0usize;
    let mut hi = time_map.len() - 1;
    while hi - lo > 1 {
        let mid = (lo + hi) / 2;
        if time_map[mid].1 <= t_out { lo = mid; } else { hi = mid; }
    }
    let (s0, o0) = time_map[lo];
    let (s1, o1) = time_map[hi];
    if (o1 - o0).abs() <= 1e-9 {
        return s0;
    }
    let a = (t_out - o0) / (o1 - o0);
    s0 + a * (s1 - s0)
}

enum Plan {
    Copy(usize),
    Interp(usize, f64),
}

/// Warp-aware RIFE. For each output frame at n/target_fps, computes t_src via
/// the inverse time_map, finds bracketing source frames A, B, and emits either
/// a held source frame (degenerate or scene-cut straddling) or an interpolated
/// frame. All interpolations run through a single rife-ncnn-vulkan invocation
/// using `-M manifest.json`. Output has no audio — caller muxes the retimed
/// audio track.
pub fn interpolate_rife_warped<F>(
    input: &str,
    time_map: &[(f64, f64)],
    scene_cuts: &[f64],
    target_fps: u32,
    output: &str,
    progress: &F,
) -> Result<(), String>
where
    F: Fn(f64, &str) + Send,
{
    if time_map.len() < 2 {
        return Err("time_map must have at least 2 control points".into());
    }
    let (exe, model_dir) = find_rife()?;
    progress(0.02, "Probing source fps...");

    let src_fps = source_fps(input)?;
    if src_fps <= 0.0 {
        return Err("source fps <= 0".into());
    }

    let tmp = TempDir::new().map_err(|e| format!("tempdir: {e}"))?;
    let src_dir = tmp.path().join("src");
    std::fs::create_dir(&src_dir).map_err(|e| e.to_string())?;

    progress(0.05, "Extracting source frames...");
    run_ffmpeg(&[
        "-y", "-hide_banner", "-loglevel", "error",
        "-i", input,
        &src_dir.join("%08d.png").to_string_lossy(),
    ])?;

    let src_frames = list_pngs(&src_dir)?;
    if src_frames.is_empty() {
        return Err("no source frames extracted".into());
    }
    let last_src_idx = (src_frames.len() - 1) as f64;

    let t_out_min = time_map[0].1;
    let t_out_max = time_map.last().unwrap().1;
    let out_dur = (t_out_max - t_out_min).max(0.0);
    let n_out = ((out_dur * target_fps as f64).round() as u64).max(1);

    let final_dir = tmp.path().join("final");
    std::fs::create_dir(&final_dir).map_err(|e| e.to_string())?;

    eprintln!(
        "[rife-warped] src_fps={src_fps:.4} target_fps={target_fps} n_out={n_out} \
         t_out_min={t_out_min:.6} t_out_max={t_out_max:.6} src_frames={}",
        src_frames.len()
    );
    eprintln!("[rife-warped] frame_times: n | t_out | t_src | idx_f | a | b | alpha");

    let mut plans: Vec<Plan> = Vec::with_capacity(n_out as usize);
    for n in 0..n_out {
        let t_out = t_out_min + n as f64 / target_fps as f64;
        let t_src = invert_time_map(time_map, t_out);
        let idx_f = (t_src * src_fps).max(0.0).min(last_src_idx);
        let a = idx_f.floor() as usize;
        let b = (a + 1).min(src_frames.len() - 1);
        let alpha = idx_f - a as f64;

        eprintln!(
            "[rife-warped] {n:4} | t_out={t_out:.6} | t_src={t_src:.6} | idx_f={idx_f:.4} | a={a} | b={b} | α={alpha:.4}"
        );

        let t_a = a as f64 / src_fps;
        let t_b = b as f64 / src_fps;
        let straddles_cut = scene_cuts.iter().any(|&c| c > t_a && c <= t_b);

        if a == b {
            plans.push(Plan::Copy(a));
        } else if straddles_cut {
            plans.push(Plan::Copy(if alpha < 0.5 { a } else { b }));
        } else {
            // rife rejects α=0 and α=1; clamp to the open interval.
            let alpha_clamped = alpha.max(1e-3).min(1.0 - 1e-3);
            plans.push(Plan::Interp(a, alpha_clamped));
        }
    }

    let interp_plan_indices: Vec<usize> = plans
        .iter()
        .enumerate()
        .filter_map(|(i, p)| matches!(p, Plan::Interp(_, _)).then_some(i))
        .collect();

    let rife_start = 0.10;
    let rife_end = 0.85;

    if !interp_plan_indices.is_empty() {
        let rife_out_dir = tmp.path().join("rife_out");
        std::fs::create_dir(&rife_out_dir).map_err(|e| e.to_string())?;

        // Manifest entries are 1-based: integer part = left source frame index + 1.
        let manifest_body = {
            let entries: Vec<String> = interp_plan_indices
                .iter()
                .map(|&i| match plans[i] {
                    Plan::Interp(a, alpha) => format!("{:.6}", (a + 1) as f64 + alpha),
                    _ => unreachable!(),
                })
                .collect();
            format!("[{}]", entries.join(","))
        };
        let manifest_path = tmp.path().join("manifest.json");
        std::fs::write(&manifest_path, manifest_body)
            .map_err(|e| format!("write manifest: {e}"))?;

        progress(
            rife_start,
            &format!("RIFE manifest: {} frames", interp_plan_indices.len()),
        );

        run_rife_manifest(
            &exe,
            &src_dir,
            &rife_out_dir,
            &model_dir,
            &manifest_path,
            interp_plan_indices.len(),
            rife_start,
            rife_end,
            progress,
        )?;

        let rife_frames = list_pngs(&rife_out_dir)?;
        if rife_frames.len() != interp_plan_indices.len() {
            return Err(format!(
                "rife manifest: expected {} frames, got {}",
                interp_plan_indices.len(),
                rife_frames.len()
            ));
        }

        for (rife_idx, &plan_idx) in interp_plan_indices.iter().enumerate() {
            let dest = final_dir.join(format!("frame_{:08}.png", plan_idx + 1));
            std::fs::copy(&rife_frames[rife_idx], &dest).map_err(|e| e.to_string())?;
        }
    }

    for (plan_idx, p) in plans.iter().enumerate() {
        if let Plan::Copy(src_idx) = *p {
            let dest = final_dir.join(format!("frame_{:08}.png", plan_idx + 1));
            std::fs::copy(&src_frames[src_idx], &dest).map_err(|e| e.to_string())?;
        }
    }

    progress(rife_end, "Encoding...");

    let pattern = final_dir.join("frame_%08d.png").to_string_lossy().into_owned();
    let fps_str = target_fps.to_string();
    run_ffmpeg(&[
        "-y", "-hide_banner", "-loglevel", "error",
        "-framerate", &fps_str,
        "-i", &pattern,
        "-an",
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-pix_fmt", "yuv420p",
        output,
    ])?;

    progress(1.0, "Done");
    Ok(())
}
