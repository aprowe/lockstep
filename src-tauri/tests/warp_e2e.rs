//! End-to-end integration tests for the warp pipeline.
//!
//! These shell out to ffmpeg/ffprobe, so they are tagged `#[ignore = "heavy"]`.
//! Run them with:  `cargo test --manifest-path src-tauri/Cargo.toml -- --ignored`
//! or via the workspace script: `npm run test:rs:heavy`.

use std::path::PathBuf;
use std::process::Command;

use lockstep_lib::processor::{remap_video, InterpMethod, WarpOptions};

// ── Helpers ──────────────────────────────────────────────────────────────────

fn fixtures_dir() -> PathBuf {
    let dir = std::env::temp_dir().join("lockstep-test-fixtures");
    std::fs::create_dir_all(&dir).expect("create fixtures dir");
    dir
}

/// Generate a 2s, 30fps test-pattern clip. Cached across test runs.
fn fixture_video() -> PathBuf {
    let path = fixtures_dir().join("testsrc_2s_30fps.mp4");
    if path.exists() {
        return path;
    }
    let status = Command::new("ffmpeg")
        .args([
            "-y", "-hide_banner", "-loglevel", "error",
            "-f", "lavfi",
            "-i", "testsrc2=duration=2:size=320x240:rate=30",
            "-pix_fmt", "yuv420p",
            path.to_str().unwrap(),
        ])
        .status()
        .expect("ffmpeg must be on PATH for heavy tests");
    assert!(status.success(), "failed to generate fixture clip");
    path
}

/// Returns (avg_frame_rate, frame_count) for the first video stream.
fn probe_video(path: &str) -> (f64, u64) {
    let out = Command::new("ffprobe")
        .args([
            "-v", "error",
            "-select_streams", "v:0",
            "-count_frames",
            "-show_entries", "stream=avg_frame_rate,nb_read_frames",
            "-of", "json",
            path,
        ])
        .output()
        .expect("ffprobe must be on PATH for heavy tests");
    assert!(out.status.success(), "ffprobe failed: {}", String::from_utf8_lossy(&out.stderr));

    let v: serde_json::Value = serde_json::from_slice(&out.stdout).expect("ffprobe json");
    let stream = &v["streams"][0];
    let afr = stream["avg_frame_rate"].as_str().unwrap_or("0/1");
    let mut parts = afr.split('/');
    let num: f64 = parts.next().unwrap().parse().unwrap_or(0.0);
    let den: f64 = parts.next().unwrap_or("1").parse().unwrap_or(1.0);
    let fps = if den == 0.0 { 0.0 } else { num / den };

    let frames: u64 = stream["nb_read_frames"]
        .as_str()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    (fps, frames)
}

/// Base warp options: 1s source → 2s output (0.5× speed), bpm 120.
fn warp_opts(interp_fps: Option<u32>) -> WarpOptions {
    WarpOptions {
        orig_times: vec![0.0, 1.0],
        beat_times: vec![0.0, 2.0],
        bpm: 120.0,
        beat_zero_time: 0.0,
        add_to_end: false,
        trim_to_loop: false,
        loop_beats: None,
        normalize_bpm: false,
        fade_at_loop: false,
        clip_in: Some(0.0),
        clip_out: Some(1.0),
        interp_fps,
        interp_method: Default::default(),
        no_smooth: false,
        trigger_mode: false,
        scene_cuts: Vec::new(),
    }
}

fn run_warp(interp_fps: Option<u32>) -> PathBuf {
    let video = fixture_video();
    let out = fixtures_dir().join(format!(
        "out_{}.mp4",
        interp_fps.map(|n| n.to_string()).unwrap_or_else(|| "pts".into()),
    ));
    let _ = std::fs::remove_file(&out);

    remap_video(
        video.to_str().unwrap(),
        &warp_opts(interp_fps),
        out.to_str().unwrap(),
        &|_p, _m| {},
    )
    .expect("remap_video");
    out
}

// ── Tests ────────────────────────────────────────────────────────────────────

// behavior: export-options::ee086472
#[test]
#[ignore = "heavy: spawns ffmpeg, ~3s"]
fn interp_fps_60_produces_constant_60fps_output() {
    let out = run_warp(Some(60));
    let (fps, _frames) = probe_video(out.to_str().unwrap());
    // Output should report ~60 fps (tolerate small rational rounding).
    assert!(
        (fps - 60.0).abs() < 0.5,
        "expected avg_frame_rate ~60, got {fps}",
    );
}

// behavior: export-options::5f05369b
#[test]
#[ignore = "heavy: spawns ffmpeg, ~3s"]
fn default_pts_warp_keeps_source_framerate() {
    let out = run_warp(None);
    let (fps, _frames) = probe_video(out.to_str().unwrap());
    // PTS-based warp: no frame interpolation, so fps stays near the source (30).
    assert!(
        (fps - 30.0).abs() < 2.0,
        "expected avg_frame_rate ~30, got {fps}",
    );
}

// behavior: export-options::ee086472
#[test]
#[ignore = "heavy: spawns rife-ncnn-vulkan, ~15s"]
fn rife_method_produces_constant_target_fps_output() {
    let video = fixture_video();
    let out = fixtures_dir().join("out_rife_60.mp4");
    let _ = std::fs::remove_file(&out);

    let mut opts = warp_opts(Some(60));
    opts.interp_method = InterpMethod::Rife;

    remap_video(
        video.to_str().unwrap(),
        &opts,
        out.to_str().unwrap(),
        &|_p, _m| {},
    )
    .expect("remap_video with RIFE");

    let (fps, _frames) = probe_video(out.to_str().unwrap());
    assert!(
        (fps - 60.0).abs() < 0.5,
        "expected avg_frame_rate ~60, got {fps}",
    );
}

