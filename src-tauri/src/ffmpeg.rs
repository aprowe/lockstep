use std::process::{Command, Stdio};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

// Prevents ffmpeg/ffprobe from opening a console window on Windows.
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Resolve an ffmpeg/ffprobe binary: prefer a Tauri sidecar bundled next to the
/// executable (Tauri names sidecars `<name>-<target-triple>[.exe]`), then fall
/// back to whatever is on PATH.
pub fn find_bin(name: &str) -> String {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let mut candidates: Vec<String> = Vec::new();

            #[cfg(target_os = "macos")]
            {
                candidates.push(format!("{name}-x86_64-apple-darwin"));
                candidates.push(format!("{name}-aarch64-apple-darwin"));
            }
            #[cfg(target_os = "windows")]
            {
                candidates.push(format!("{name}-x86_64-pc-windows-msvc.exe"));
                candidates.push(format!("{name}.exe"));
            }
            #[cfg(target_os = "linux")]
            {
                candidates.push(format!("{name}-x86_64-unknown-linux-gnu"));
            }

            for candidate in &candidates {
                let path = dir.join(candidate);
                if path.exists() {
                    return path.to_string_lossy().into_owned();
                }
            }
        }
    }
    name.to_string()
}

/// Read the video's container duration (seconds) via ffprobe.
pub fn video_duration(path: &str) -> Result<f64, String> {
    let info = ffprobe_json(path)?;
    info["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse::<f64>().ok())
        .ok_or_else(|| "ffprobe: missing duration".to_string())
}

/// Read the video's frame rate (fps) via ffprobe. Falls back to 30.0 if the
/// stream doesn't report `r_frame_rate` or the value can't be parsed —
/// matches the fallback in `video::get_video_info` so the two agree.
pub fn video_fps(path: &str) -> Result<f64, String> {
    let info = ffprobe_json(path)?;
    let stream = info["streams"]
        .as_array()
        .and_then(|streams| streams.iter().find(|s| s["codec_type"] == "video"));
    let fps = stream
        .and_then(|s| s["r_frame_rate"].as_str())
        .and_then(parse_frame_rate)
        .unwrap_or(30.0);
    Ok(fps)
}

fn parse_frame_rate(r: &str) -> Option<f64> {
    let parts: Vec<&str> = r.split('/').collect();
    if parts.len() == 2 {
        let num: f64 = parts[0].parse().ok()?;
        let den: f64 = parts[1].parse().ok()?;
        if den > 0.0 { Some(num / den) } else { None }
    } else {
        r.parse().ok()
    }
}

/// True if `path` contains at least one audio stream. RIFE'd videos are silent,
/// so post-processing has to branch on this before asking ffmpeg for audio.
pub fn has_audio_stream(path: &str) -> bool {
    let Ok(info) = ffprobe_json(path) else { return false };
    info["streams"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .any(|s| s["codec_type"].as_str() == Some("audio"))
        })
        .unwrap_or(false)
}

/// Sample rate of the first audio stream, in Hz. Falls back to 44100 when the
/// file has no audio or ffprobe can't read it. Pitched-audio mode needs this
/// so `asetrate=SR/ratio,aresample=SR` can keep the output stream at the
/// source's native rate after pitch-shifting.
pub fn audio_sample_rate(path: &str) -> u32 {
    let Ok(info) = ffprobe_json(path) else { return 44100 };
    info["streams"]
        .as_array()
        .and_then(|arr| arr.iter().find(|s| s["codec_type"].as_str() == Some("audio")))
        .and_then(|s| s["sample_rate"].as_str())
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(44100)
}

pub fn ffprobe_json(path: &str) -> Result<serde_json::Value, String> {
    let bin = find_bin("ffprobe");
    let mut cmd = Command::new(&bin);
    cmd.args([
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            path,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = cmd.output()
        .map_err(|e| format!("ffprobe spawn failed at `{bin}`: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "ffprobe failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("ffprobe JSON parse error: {e}"))
}

/// Build a chain of atempo filters that handles ratios outside 0.5–2.0 range.
pub fn atempo_chain(mut rate: f64) -> String {
    let mut filters = Vec::new();
    rate = rate.max(0.01);
    while rate < 0.5 {
        filters.push("atempo=0.5".to_string());
        rate /= 0.5;
    }
    while rate > 2.0 {
        filters.push("atempo=2.0".to_string());
        rate /= 2.0;
    }
    filters.push(format!("atempo={rate:.6}"));
    filters.join(",")
}

/// Run ffmpeg with the given args. Returns Ok(()) on success, Err with stderr on failure.
pub fn run_ffmpeg(args: &[&str]) -> Result<(), String> {
    let bin = find_bin("ffmpeg");
    let mut cmd = Command::new(&bin);
    cmd.args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let status = cmd.output()
        .map_err(|e| format!("ffmpeg spawn failed at `{bin}`: {e}"))?;

    if status.status.success() {
        Ok(())
    } else {
        Err(format!(
            "ffmpeg error: {}",
            String::from_utf8_lossy(&status.stderr)
                .lines()
                .filter(|l| !l.trim().is_empty())
                .last()
                .unwrap_or("unknown error")
        ))
    }
}
