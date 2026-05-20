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

/// Returns the container duration in seconds as reported by ffprobe.
fn probe_duration(path: &str) -> f64 {
    let out = Command::new("ffprobe")
        .args([
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "json",
            path,
        ])
        .output()
        .expect("ffprobe must be on PATH for heavy tests");
    assert!(out.status.success(), "ffprobe failed: {}", String::from_utf8_lossy(&out.stderr));
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).expect("ffprobe json");
    v["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0.0)
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
        clip_in: Some(0.0),
        clip_out: Some(1.0),
        interp_fps,
        interp_method: Default::default(),
        no_smooth: false,
        scene_cuts: Vec::new(),
        audio_mode: Default::default(),
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

// ── Boundary anchor injection: output-duration × BPM checks ─────────────────
//
// These four tests exercise the same four cases as the time_map unit tests,
// but run the full ffmpeg pipeline so the measured duration accounts for muxer
// rounding, container overhead, and codec timing. Tolerance is ±100 ms (3
// frames at 30 fps).

const DURATION_TOL: f64 = 0.1; // seconds
const BPM_120: f64 = 120.0;

fn beats_at_120(secs: f64) -> f64 { secs * BPM_120 / 60.0 }

/// Case 1 — Identity: inBeatTime == inPoint, outBeatTime == outPoint.
/// No stretch; output duration must equal the source clip length.
#[test]
#[ignore = "heavy: spawns ffmpeg, ~3s"]
fn boundary_identity_output_duration_matches_source_clip() {
    let video = fixture_video();
    let out = fixtures_dir().join("boundary_identity.mp4");
    let _ = std::fs::remove_file(&out);

    // Boundary anchors at 0 and 2 s with identical beat times — pure identity.
    remap_video(
        video.to_str().unwrap(),
        &WarpOptions {
            orig_times: vec![0.0, 2.0],
            beat_times: vec![0.0, 2.0],
            bpm: BPM_120,
            clip_in: Some(0.0),
            clip_out: Some(2.0),
            interp_fps: None,
            interp_method: Default::default(),
            no_smooth: true,
            scene_cuts: vec![],
            audio_mode: Default::default(),
        },
        out.to_str().unwrap(),
        &|_p, _m| {},
    )
    .expect("remap_video");

    let expected_secs = 2.0_f64; // inBeatTime=0, outBeatTime=2
    let actual_secs = probe_duration(out.to_str().unwrap());
    assert!(
        (actual_secs - expected_secs).abs() < DURATION_TOL,
        "identity: expected ~{expected_secs}s ({}b @ {BPM_120}bpm), got {actual_secs:.3}s",
        beats_at_120(expected_secs),
    );
}

/// Case 2 — No real markers, clip warped via boundary anchors only.
/// Source 0–1 s stretched to 2 s (0.5× speed, 4 beats at 120 bpm).
#[test]
#[ignore = "heavy: spawns ffmpeg, ~3s"]
fn boundary_no_markers_clip_warp_output_duration_matches_beat_span() {
    let video = fixture_video();
    let out = fixtures_dir().join("boundary_no_markers.mp4");
    let _ = std::fs::remove_file(&out);

    remap_video(
        video.to_str().unwrap(),
        &WarpOptions {
            orig_times: vec![0.0, 1.0],
            beat_times: vec![0.0, 2.0],
            bpm: BPM_120,
            clip_in: Some(0.0),
            clip_out: Some(1.0),
            interp_fps: None,
            interp_method: Default::default(),
            no_smooth: true,
            scene_cuts: vec![],
            audio_mode: Default::default(),
        },
        out.to_str().unwrap(),
        &|_p, _m| {},
    )
    .expect("remap_video");

    let expected_secs = 2.0_f64; // outBeatTime - inBeatTime = 4 beats
    let actual_secs = probe_duration(out.to_str().unwrap());
    assert!(
        (actual_secs - expected_secs).abs() < DURATION_TOL,
        "no-markers warp: expected ~{expected_secs}s ({}b @ {BPM_120}bpm), got {actual_secs:.3}s",
        beats_at_120(expected_secs),
    );
}

/// Case 3 — Real markers covering the full clip, no artificial clip restriction.
/// Variable stretch; the boundary anchors pin the total output span to 3 s (6 beats).
#[test]
#[ignore = "heavy: spawns ffmpeg, ~3s"]
fn boundary_markers_full_clip_output_duration_matches_beat_span() {
    let video = fixture_video();
    let out = fixtures_dir().join("boundary_markers_full.mp4");
    let _ = std::fs::remove_file(&out);

    // Marker at 1 s → 1.5 s (slower first half); boundary anchors at 0 and 2 s.
    remap_video(
        video.to_str().unwrap(),
        &WarpOptions {
            orig_times: vec![0.0, 1.0, 2.0],
            beat_times: vec![0.0, 1.5, 3.0],
            bpm: BPM_120,
            clip_in: Some(0.0),
            clip_out: Some(2.0),
            interp_fps: None,
            interp_method: Default::default(),
            no_smooth: true,
            scene_cuts: vec![],
            audio_mode: Default::default(),
        },
        out.to_str().unwrap(),
        &|_p, _m| {},
    )
    .expect("remap_video");

    let expected_secs = 3.0_f64; // outBeatTime - inBeatTime = 6 beats
    let actual_secs = probe_duration(out.to_str().unwrap());
    assert!(
        (actual_secs - expected_secs).abs() < DURATION_TOL,
        "markers full clip: expected ~{expected_secs}s ({}b @ {BPM_120}bpm), got {actual_secs:.3}s",
        beats_at_120(expected_secs),
    );
}

/// Case 4 — Real markers inside a clip window, plus boundary anchors.
/// Non-linear stretch (one internal marker); total span must equal outBeatTime − inBeatTime.
#[test]
#[ignore = "heavy: spawns ffmpeg, ~3s"]
fn boundary_markers_plus_clip_warp_output_duration_matches_beat_span() {
    let video = fixture_video();
    let out = fixtures_dir().join("boundary_markers_clip.mp4");
    let _ = std::fs::remove_file(&out);

    // Boundary: (0→0, 2→3) = 1.5× average; internal marker at 1 s → 1.2 s.
    remap_video(
        video.to_str().unwrap(),
        &WarpOptions {
            orig_times: vec![0.0, 1.0, 2.0],
            beat_times: vec![0.0, 1.2, 3.0],
            bpm: BPM_120,
            clip_in: Some(0.0),
            clip_out: Some(2.0),
            interp_fps: None,
            interp_method: Default::default(),
            no_smooth: true,
            scene_cuts: vec![],
            audio_mode: Default::default(),
        },
        out.to_str().unwrap(),
        &|_p, _m| {},
    )
    .expect("remap_video");

    let expected_secs = 3.0_f64; // outBeatTime - inBeatTime = 6 beats
    let actual_secs = probe_duration(out.to_str().unwrap());
    assert!(
        (actual_secs - expected_secs).abs() < DURATION_TOL,
        "markers + clip warp: expected ~{expected_secs}s ({}b @ {BPM_120}bpm), got {actual_secs:.3}s",
        beats_at_120(expected_secs),
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

