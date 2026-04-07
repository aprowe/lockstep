use std::process::{Command, Stdio};

pub fn ffprobe_json(path: &str) -> Result<serde_json::Value, String> {
    let output = Command::new("ffprobe")
        .args([
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            path,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("ffprobe not found in PATH: {e}"))?;

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
    let status = Command::new("ffmpeg")
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("ffmpeg not found in PATH: {e}"))?;

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
