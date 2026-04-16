use std::process::{Command, Stdio};

/// Resolve an ffmpeg/ffprobe binary: prefer a Tauri sidecar bundled next to the
/// executable (Tauri names sidecars `<name>-<target-triple>[.exe]`), then fall
/// back to whatever is on PATH.
fn find_bin(name: &str) -> String {
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

pub fn ffprobe_json(path: &str) -> Result<serde_json::Value, String> {
    let output = Command::new(find_bin("ffprobe"))
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
        .map_err(|e| format!("ffprobe not found: {e}"))?;

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
    let status = Command::new(find_bin("ffmpeg"))
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("ffmpeg not found: {e}"))?;

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
