//! RIFE frame interpolation via the rife-ncnn-vulkan standalone binary.
//!
//! The binary is bundled as a sidecar under src-tauri/binaries/ with the
//! rife-v4.6 model folder alongside it. See scripts/setup-binaries.mjs.
//!
//! Two entry points:
//!
//! `interpolate_rife` — legacy uniform-timestep pass over a pre-rendered video.
//! Kept for non-warp interpolation (constant-speed fps up-conversion).
//!
//! `interpolate_rife_warped` — warp-aware. Given the piecewise-linear time_map
//! (t_src → t_out) and a target fps, produces each output frame at the exact
//! t_src position dictated by the warp: bracketing source frames A, B plus
//! α = (idx - floor(idx)), fed to rife with `-s α` per pair. Output is silent;
//! caller muxes the retimed audio track.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tempfile::TempDir;

use crate::ffmpeg::{ffprobe_json, run_ffmpeg};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const MODEL_NAME: &str = "rife-v4.6";

/// Locate (rife-ncnn-vulkan exe, rife-v4.6 model dir).
/// Prefers a sidecar next to the running executable, falls back to PATH.
fn find_rife() -> Result<(String, PathBuf), String> {
    let mut search_dirs: Vec<PathBuf> = Vec::new();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            search_dirs.push(dir.to_path_buf());
        }
    }

    // Dev-mode: src-tauri/binaries/ relative to CARGO_MANIFEST_DIR.
    if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
        search_dirs.push(PathBuf::from(&manifest).join("binaries"));
    }
    // Fallback relative to cwd for tests invoked from repo root.
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

/// Read source fps using ffprobe (r_frame_rate).
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

/// Run rife-ncnn-vulkan with a specific timestep. Produces one interleaved
/// [src, interp] frame pair per consecutive source pair in `out_dir`.
fn run_rife_timestep(
    exe: &str,
    src_dir: &Path,
    out_dir: &Path,
    model_dir: &Path,
    timestep: f64,
) -> Result<(), String> {
    let src = src_dir.to_string_lossy().into_owned();
    let out = out_dir.to_string_lossy().into_owned();
    let model = model_dir.to_string_lossy().into_owned();
    let ts = format!("{timestep:.6}");

    let mut cmd = Command::new(exe);
    cmd.args(["-i", &src, "-o", &out, "-s", &ts, "-m", &model, "-g", "1"])
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd
        .output()
        .map_err(|e| format!("rife-ncnn-vulkan failed to spawn: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "rife-ncnn-vulkan exited with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
                .lines()
                .filter(|l| !l.trim().is_empty())
                .last()
                .unwrap_or("unknown error")
        ));
    }
    Ok(())
}

/// Run rife-ncnn-vulkan in two-file mode at a specific α, producing exactly
/// one interpolated frame between `a_png` and `b_png`. Unlike directory mode
/// (`-i`/`-o`), the two-file mode (`-0`/`-1`) actually honors `-s` — in
/// directory mode it is silently ignored and every pair is interpolated at α=0.5.
fn run_rife_pair(
    exe: &str,
    a_png: &Path,
    b_png: &Path,
    out_png: &Path,
    model_dir: &Path,
    alpha: f64,
) -> Result<(), String> {
    let a = a_png.to_string_lossy().into_owned();
    let b = b_png.to_string_lossy().into_owned();
    let o = out_png.to_string_lossy().into_owned();
    let model = model_dir.to_string_lossy().into_owned();
    let ts = format!("{alpha:.6}");

    let mut cmd = Command::new(exe);
    cmd.args(["-0", &a, "-1", &b, "-o", &o, "-s", &ts, "-m", &model, "-g", "1"])
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd
        .output()
        .map_err(|e| format!("rife-ncnn-vulkan failed to spawn: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "rife-ncnn-vulkan (pair, α={alpha:.4}) exited with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
                .lines()
                .filter(|l| !l.trim().is_empty())
                .last()
                .unwrap_or("unknown error")
        ));
    }
    Ok(())
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

/// Interpolate `input` to a constant `target_fps` using RIFE. Output includes audio.
pub fn interpolate_rife<F>(
    input: &str,
    target_fps: u32,
    output: &str,
    progress: &F,
) -> Result<(), String>
where
    F: Fn(f64, &str) + Send,
{
    let (exe, model_dir) = find_rife()?;
    progress(0.02, "Probing source fps...");

    let src_fps = source_fps(input)?;
    if src_fps <= 0.0 {
        return Err("source fps <= 0".into());
    }

    // Multiplier: at least 2x, integer, round target/src. Final fps resampling
    // to exact target_fps happens at encode.
    let multiplier: u32 = ((target_fps as f64 / src_fps).round() as i64).max(2) as u32;

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
    if src_frames.len() < 2 {
        return Err(format!(
            "need ≥2 source frames to interpolate, got {}",
            src_frames.len()
        ));
    }
    let n_pairs = src_frames.len() - 1;
    let expected_interleaved = 2 * (n_pairs + 1);

    // One rife pass per intermediate timestep.
    let timesteps: Vec<f64> = (1..multiplier)
        .map(|k| k as f64 / multiplier as f64)
        .collect();

    let rife_start = 0.15;
    let rife_end = 0.82;
    let mut interp_by_ts: Vec<Vec<PathBuf>> = Vec::with_capacity(timesteps.len());

    for (i, &t) in timesteps.iter().enumerate() {
        let out_dir = tmp.path().join(format!("ts_{i}"));
        std::fs::create_dir(&out_dir).map_err(|e| e.to_string())?;

        progress(
            rife_start + i as f64 / timesteps.len() as f64 * (rife_end - rife_start),
            &format!("RIFE pass {}/{} (t={:.3})", i + 1, timesteps.len(), t),
        );

        run_rife_timestep(&exe, &src_dir, &out_dir, &model_dir, t)?;

        let mut frames = list_pngs(&out_dir)?;
        if frames.len() == expected_interleaved {
            // [src_0, interp_01, src_1, interp_12, ..., src_N-1, src_N-1_dup]
            // Keep odd indices (interp slots), drop the trailing duplicate.
            frames = frames
                .into_iter()
                .enumerate()
                .filter(|(idx, _)| idx % 2 == 1)
                .map(|(_, p)| p)
                .take(n_pairs)
                .collect();
        } else if frames.len() != n_pairs {
            return Err(format!(
                "rife pass t={t:.3}: expected {n_pairs} frames, got {}",
                frames.len()
            ));
        }
        interp_by_ts.push(frames);
    }

    progress(rife_end, "Interleaving frames...");

    // Interleave into time order: [src_i, ts0_i, ts1_i, ..., src_{i+1}, ...].
    let final_dir = tmp.path().join("final");
    std::fs::create_dir(&final_dir).map_err(|e| e.to_string())?;
    let mut out_idx: u64 = 1;
    for (pair_idx, src) in src_frames.iter().enumerate() {
        let dest = final_dir.join(format!("frame_{out_idx:08}.png"));
        std::fs::copy(src, &dest).map_err(|e| e.to_string())?;
        out_idx += 1;
        if pair_idx < n_pairs {
            for ts_frames in &interp_by_ts {
                if let Some(f) = ts_frames.get(pair_idx) {
                    let dest = final_dir.join(format!("frame_{out_idx:08}.png"));
                    std::fs::copy(f, &dest).map_err(|e| e.to_string())?;
                    out_idx += 1;
                }
            }
        }
    }

    progress(0.85, "Encoding + muxing...");

    let achieved_fps = src_fps * multiplier as f64;
    let pattern = final_dir.join("frame_%08d.png").to_string_lossy().into_owned();
    let noaudio = tmp.path().join("noaudio.mp4").to_string_lossy().into_owned();
    let vf = format!("fps={target_fps}");

    // Encode RIFE frames at the achieved fps, resampling to exact target_fps.
    let framerate = format!("{achieved_fps:.6}");
    let target_r = target_fps.to_string();
    run_ffmpeg(&[
        "-y", "-hide_banner", "-loglevel", "error",
        "-framerate", &framerate,
        "-i", &pattern,
        "-vf", &vf,
        "-r", &target_r,
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-pix_fmt", "yuv420p",
        &noaudio,
    ])?;

    // Mux audio from the source. Use ? on the audio map so it's optional.
    let mux_res = run_ffmpeg(&[
        "-y", "-hide_banner", "-loglevel", "error",
        "-i", &noaudio,
        "-i", input,
        "-map", "0:v:0",
        "-map", "1:a:0?",
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k",
        "-shortest",
        output,
    ]);
    if mux_res.is_err() {
        // No audio in source — just copy the video-only mp4.
        std::fs::copy(&noaudio, output).map_err(|e| e.to_string())?;
    }

    progress(1.0, "Done");
    Ok(())
}

// ── Warp-aware RIFE ──────────────────────────────────────────────────────────

/// Invert the piecewise-linear time_map (t_src, t_out) at the given output time.
/// Entries must be sorted by t_out (same as t_src since the map is monotonic).
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

/// Warp-aware RIFE. For each output frame at n/target_fps, computes t_src via
/// the inverse time_map, finds bracketing source frames A, B, and runs rife
/// once per pair with the exact α = frac(t_src * src_fps). Output has no audio —
/// caller is expected to mux the retimed audio track from another source.
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

    let rife_start = 0.10;
    let rife_end = 0.85;

    eprintln!(
        "[rife-warped] src_fps={src_fps:.4} target_fps={target_fps} n_out={n_out} \
         t_out_min={t_out_min:.6} t_out_max={t_out_max:.6} src_frames={}",
        src_frames.len()
    );
    eprintln!("[rife-warped] frame_times: n | t_out | t_src | idx_f | a | b | alpha");

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

        let dest = final_dir.join(format!("frame_{:08}.png", n + 1));

        // Two-file mode (-0/-1): required because rife-ncnn-vulkan silently
        // ignores `-s` in directory mode and always produces α=0.5 frames there,
        // which was the source of the "pair" artefact in the output.
        let t_a = a as f64 / src_fps;
        let t_b = b as f64 / src_fps;
        let straddles_cut = scene_cuts.iter().any(|&c| c > t_a && c <= t_b);
        if a == b {
            // Degenerate: only one source frame available; just emit it.
            std::fs::copy(&src_frames[a], &dest).map_err(|e| e.to_string())?;
        } else if straddles_cut {
            // Don't blend across a hard cut — the two frames are unrelated and
            // RIFE would melt them together. Hold the closer source frame.
            let pick = if alpha < 0.5 { a } else { b };
            std::fs::copy(&src_frames[pick], &dest).map_err(|e| e.to_string())?;
        } else {
            // Clamp α to the open interval — rife-ncnn-vulkan is undefined at 0/1.
            let alpha_clamped = alpha.max(1e-3).min(1.0 - 1e-3);
            run_rife_pair(&exe, &src_frames[a], &src_frames[b], &dest, &model_dir, alpha_clamped)?;
        }

        if n % 8 == 0 || n + 1 == n_out {
            let frac = (n + 1) as f64 / n_out as f64;
            progress(
                rife_start + frac * (rife_end - rife_start),
                &format!("RIFE frame {}/{}", n + 1, n_out),
            );
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
