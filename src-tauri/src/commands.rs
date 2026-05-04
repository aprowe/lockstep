use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::ffmpeg::video_duration;
use crate::processor::{estimate_bpm, remap_video, InterpMethod, WarpOptions};
use crate::scene::{detect_cuts, ScanWindow, DEFAULT_THRESHOLD};
use crate::video::{get_video_info, VideoInfo};

/// Shared cancel flag for the currently running scene-detection job. Flipping
/// it to true asks the ffmpeg child process to stop at its next stderr line.
/// Stored in Tauri-managed state so both `start_scene_detection` and
/// `cancel_scene_detection` reach the same instance.
#[derive(Default)]
pub struct SceneDetectionState {
    pub cancel: Arc<AtomicBool>,
}

// ── Open Folder ───────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct VideoEntry {
    pub path: String,
    pub name: String,
}

#[tauri::command]
pub async fn open_folder(app: AppHandle) -> Result<Vec<VideoEntry>, String> {
    use tauri_plugin_dialog::DialogExt;

    let folder = app.dialog().file().blocking_pick_folder();

    let folder_path = match folder {
        Some(p) => p.into_path().map_err(|e| e.to_string())?,
        None => return Err("cancelled".to_string()),
    };

    log::info!("open_folder: {}", folder_path.display());

    let video_exts = ["mp4", "mov", "avi", "mkv", "webm", "m4v"];
    let mut entries = Vec::new();

    let dir = std::fs::read_dir(&folder_path).map_err(|e| {
        log::error!("open_folder: read_dir failed for {}: {e}", folder_path.display());
        e.to_string()
    })?;
    for entry in dir.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();
        if video_exts.contains(&ext.as_str()) {
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            entries.push(VideoEntry {
                path: path.to_string_lossy().to_string(),
                name,
            });
        }
    }

    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    log::info!("open_folder: {} videos found", entries.len());
    Ok(entries)
}

// ── List Folder Videos by Path (no dialog) ───────────────────────────────────

#[tauri::command]
pub async fn list_folder_videos(path: String) -> Result<Vec<VideoEntry>, String> {
    let folder_path = std::path::Path::new(&path);
    let video_exts = ["mp4", "mov", "avi", "mkv", "webm", "m4v"];
    let mut entries = Vec::new();

    let dir = std::fs::read_dir(folder_path).map_err(|e| e.to_string())?;
    for entry in dir.flatten() {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        let ext = p
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();
        if video_exts.contains(&ext.as_str()) {
            let name = p
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            entries.push(VideoEntry {
                path: p.to_string_lossy().to_string(),
                name,
            });
        }
    }

    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(entries)
}

// ── Load Video by Path ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn load_video(path: String) -> Result<VideoInfo, String> {
    log::info!("load_video: {path}");
    match get_video_info(&path) {
        Ok(info) => {
            log::info!(
                "load_video ok: {path} ({:.3}s, {:.3} fps)",
                info.duration, info.fps
            );
            Ok(info)
        }
        Err(e) => {
            log::error!("load_video failed for {path}: {e}");
            Err(e)
        }
    }
}

// ── Open Video ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn open_video(app: AppHandle) -> Result<VideoInfo, String> {
    use tauri_plugin_dialog::DialogExt;

    let file = app
        .dialog()
        .file()
        .add_filter("Video", &["mp4", "mov", "avi", "mkv", "webm", "m4v"])
        .blocking_pick_file();

    let path = match file {
        Some(p) => p.into_path().map_err(|e| e.to_string())?,
        None => return Err("cancelled".to_string()),
    };

    let path_str = path.to_string_lossy().to_string();
    log::info!("open_video: {path_str}");
    match get_video_info(&path_str) {
        Ok(info) => Ok(info),
        Err(e) => {
            log::error!("open_video failed for {path_str}: {e}");
            Err(e)
        }
    }
}

// ── Analyze Anchors (BPM estimation) ────────────────────────────────────────

#[derive(serde::Deserialize)]
pub struct AnalyzeRequest {
    anchor_times: Vec<f64>,
}

#[tauri::command]
pub async fn analyze_anchors(req: AnalyzeRequest) -> serde_json::Value {
    if req.anchor_times.len() < 2 {
        return serde_json::json!({
            "bpm": null,
            "beat_interval": null,
            "message": "Need at least 2 anchors to estimate BPM"
        });
    }

    let (bpm, beat_interval, snap_interval) = estimate_bpm(&req.anchor_times);

    let mut sorted = req.anchor_times.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let intervals: Vec<f64> = sorted
        .windows(2)
        .map(|w| (w[1] - w[0]) * 1000.0)
        .map(|ms| ms.round() / 1000.0)
        .collect();

    serde_json::json!({
        "bpm": (bpm * 100.0).round() / 100.0,
        "beat_interval": (beat_interval * 10000.0).round() / 10000.0,
        "snap_interval": (snap_interval * 10000.0).round() / 10000.0,
        "intervals": intervals,
        "anchor_count": req.anchor_times.len(),
        "message": format!("Estimated BPM: {}", (bpm * 100.0).round() / 100.0)
    })
}

// ── Start Warp Job ───────────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
pub struct WarpRequest {
    pub path: String,
    pub orig_times: Vec<f64>,
    pub beat_times: Vec<f64>,
    pub bpm: f64,
    pub beat_zero_time: f64,
    pub add_to_end: bool,
    pub trim_to_loop: bool,
    pub loop_beats: Option<u32>,
    pub normalize_bpm: bool,
    pub fade_at_loop: bool,
    pub clip_in: Option<f64>,
    pub clip_out: Option<f64>,
    pub interp_fps: Option<u32>,
    /// "minterpolate" (default, ffmpeg blend) or "rife" (neural, via rife-ncnn-vulkan).
    pub interp_method: Option<String>,
    #[serde(default)]
    pub no_smooth: bool,
    #[serde(default)]
    pub trigger_mode: bool,
    #[serde(default)]
    pub scene_cuts: Vec<f64>,
}

#[tauri::command]
pub async fn start_warp(app: AppHandle, req: WarpRequest) -> Result<String, String> {
    let job_id = uuid::Uuid::new_v4().to_string();

    let out_dir = std::env::temp_dir().join("lockstep");
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    let out_path = out_dir.join(format!("warped_{}.mp4", &job_id));
    let out_path_str = out_path.to_string_lossy().to_string();

    log::info!(
        "start_warp[{job_id}]: path={} bpm={:.3} anchors={} clip={:?}→{:?} interp={:?}@{:?} normalize_bpm={} trim_to_loop={} trigger={}",
        req.path,
        req.bpm,
        req.orig_times.len(),
        req.clip_in,
        req.clip_out,
        req.interp_method,
        req.interp_fps,
        req.normalize_bpm,
        req.trim_to_loop,
        req.trigger_mode,
    );

    let app_clone = app.clone();
    let job_id_clone = job_id.clone();
    let out_path_clone = out_path_str.clone();

    tokio::spawn(async move {
        let app2 = app_clone.clone();
        let jid = job_id_clone.clone();
        let out = out_path_clone.clone();

        let opts = WarpOptions {
            orig_times: req.orig_times,
            beat_times: req.beat_times,
            bpm: req.bpm,
            beat_zero_time: req.beat_zero_time,
            add_to_end: req.add_to_end,
            trim_to_loop: req.trim_to_loop,
            loop_beats: req.loop_beats,
            normalize_bpm: req.normalize_bpm,
            fade_at_loop: req.fade_at_loop,
            clip_in: req.clip_in,
            clip_out: req.clip_out,
            interp_fps: req.interp_fps,
            interp_method: InterpMethod::from_str(req.interp_method.as_deref()),
            no_smooth: req.no_smooth,
            trigger_mode: req.trigger_mode,
            scene_cuts: req.scene_cuts,
        };

        let result = tokio::task::spawn_blocking(move || {
            let progress = {
                let app = app2.clone();
                let jid = jid.clone();
                move |percent: f64, msg: &str| {
                    let _ = app.emit(
                        "warp-progress",
                        serde_json::json!({
                            "job_id": &jid,
                            "percent": percent,
                            "message": msg,
                            "status": "running"
                        }),
                    );
                }
            };
            remap_video(&req.path, &opts, &out, &progress)
        })
        .await;

        match result {
            Ok(Ok(())) => {
                log::info!("start_warp[{job_id_clone}]: done → {out_path_clone}");
                let _ = app_clone.emit(
                    "warp-progress",
                    serde_json::json!({
                        "job_id": &job_id_clone,
                        "percent": 1.0,
                        "status": "done",
                        "output_path": &out_path_clone
                    }),
                );
            }
            Ok(Err(e)) => {
                log::error!("start_warp[{job_id_clone}]: failed: {e}");
                let _ = app_clone.emit(
                    "warp-progress",
                    serde_json::json!({
                        "job_id": &job_id_clone,
                        "status": "error",
                        "error": e
                    }),
                );
            }
            Err(e) => {
                log::error!("start_warp[{job_id_clone}]: panicked: {e}");
                let _ = app_clone.emit(
                    "warp-progress",
                    serde_json::json!({
                        "job_id": &job_id_clone,
                        "status": "error",
                        "error": e.to_string()
                    }),
                );
            }
        }
    });

    Ok(job_id)
}

// ── Diagnostic / Overlay Video ──────────────────────────────────────────────

#[derive(serde::Deserialize)]
pub struct DiagnosticRequest {
    pub path: String,
    pub bpm: f64,
    pub beat_zero_time: f64,
    /// "diagnostic" or "overlay"
    pub mode: String,
}

#[tauri::command]
pub async fn start_diagnostic(app: AppHandle, req: DiagnosticRequest) -> Result<String, String> {
    let job_id = uuid::Uuid::new_v4().to_string();

    let out_dir = std::env::temp_dir().join("lockstep");
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    let suffix = if req.mode == "overlay" { "overlay" } else { "diagnostic" };
    let out_path = out_dir.join(format!("{suffix}_{}.mp4", &job_id));
    let out_path_str = out_path.to_string_lossy().to_string();

    log::info!(
        "start_diagnostic[{job_id}]: mode={} path={} bpm={:.3} beat_zero={:.3}",
        req.mode, req.path, req.bpm, req.beat_zero_time
    );

    let app_clone = app.clone();
    let jid = job_id.clone();
    let out_clone = out_path_str.clone();

    tokio::spawn(async move {
        let app2 = app_clone.clone();
        let jid2 = jid.clone();
        let out2 = out_clone.clone();
        let mode = req.mode.clone();

        let result = tokio::task::spawn_blocking(move || {
            let progress = {
                let app = app2.clone();
                let j = jid2.clone();
                let m = mode.clone();
                move |percent: f64, msg: &str| {
                    let _ = app.emit(
                        "diagnostic-progress",
                        serde_json::json!({
                            "job_id": &j,
                            "mode": &m,
                            "percent": percent,
                            "message": msg,
                            "status": "running"
                        }),
                    );
                }
            };

            if req.mode == "overlay" {
                crate::diagnostic::generate_overlay_video(
                    &req.path, &out2, req.bpm, req.beat_zero_time, &progress,
                )
            } else {
                crate::diagnostic::generate_diagnostic_video(
                    &req.path, &out2, req.bpm, req.beat_zero_time, &progress,
                )
            }
        })
        .await;

        let status_payload = match result {
            Ok(Ok(())) => {
                log::info!("start_diagnostic[{jid}]: done → {out_clone}");
                serde_json::json!({
                    "job_id": &jid,
                    "percent": 1.0,
                    "status": "done",
                    "output_path": &out_clone
                })
            }
            Ok(Err(e)) => {
                log::error!("start_diagnostic[{jid}]: failed: {e}");
                serde_json::json!({
                    "job_id": &jid,
                    "status": "error",
                    "error": e
                })
            }
            Err(e) => {
                log::error!("start_diagnostic[{jid}]: panicked: {e}");
                serde_json::json!({
                    "job_id": &jid,
                    "status": "error",
                    "error": e.to_string()
                })
            }
        };
        let _ = app_clone.emit("diagnostic-progress", status_payload);
    });

    Ok(job_id)
}

// ── Save Output ──────────────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
pub struct SaveRequest {
    pub source_path: String,
    pub suggested_name: String,
}

#[tauri::command]
pub async fn save_output(app: AppHandle, req: SaveRequest) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    let dest = app
        .dialog()
        .file()
        .set_file_name(&req.suggested_name)
        .add_filter("MP4 Video", &["mp4"])
        .blocking_save_file();

    match dest {
        Some(path) => {
            let dest_path = path.into_path().map_err(|e| e.to_string())?;
            std::fs::copy(&req.source_path, &dest_path).map_err(|e| {
                log::error!(
                    "save_output: copy {} → {} failed: {e}",
                    req.source_path,
                    dest_path.display()
                );
                format!("Save failed: {e}")
            })?;
            let dest_str = dest_path.to_string_lossy().to_string();
            log::info!("save_output: {} → {dest_str}", req.source_path);
            Ok(dest_str)
        }
        None => Err("cancelled".to_string()),
    }
}

// ── Pick Export Folder ────────────────────────────────────────────────────────

/// Opens a native folder picker and returns the selected path.
#[tauri::command]
pub async fn pick_export_folder(app: AppHandle) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app.dialog().file().blocking_pick_folder();
    match folder {
        Some(path) => path.into_path()
            .map(|p| p.to_string_lossy().to_string())
            .map_err(|e| e.to_string()),
        None => Err("cancelled".to_string()),
    }
}

// ── Save to Folder ────────────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
pub struct SaveToFolderRequest {
    pub source_path: String,
    pub dest_folder: String,
    pub file_name: String,
}

/// Copies a temp output file directly to a folder without a save dialog.
/// Creates `dest_folder` and any missing parent directories if they don't exist.
#[tauri::command]
pub async fn save_to_folder(req: SaveToFolderRequest) -> Result<String, String> {
    let dest_folder = std::path::Path::new(&req.dest_folder);
    std::fs::create_dir_all(dest_folder).map_err(|e| {
        log::error!("save_to_folder: create {} failed: {e}", dest_folder.display());
        format!("Save failed: could not create {}: {e}", dest_folder.display())
    })?;
    let dest = dest_folder.join(&req.file_name);
    std::fs::copy(&req.source_path, &dest).map_err(|e| {
        log::error!(
            "save_to_folder: copy {} → {} failed: {e}",
            req.source_path,
            dest.display()
        );
        format!("Save failed: {e}")
    })?;
    let dest_str = dest.to_string_lossy().to_string();
    log::info!("save_to_folder: {} → {dest_str}", req.source_path);
    Ok(dest_str)
}

// ── Write Text File ───────────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
pub struct WriteTextFileRequest {
    pub path: String,
    pub content: String,
}

/// Writes a text file (e.g. JSON metadata) to the given path.
#[tauri::command]
pub async fn write_text_file(req: WriteTextFileRequest) -> Result<(), String> {
    std::fs::write(&req.path, &req.content)
        .map_err(|e| format!("Write failed: {e}"))
}

// ── Extract single frame as JPEG (for the AI assistant) ──────────────────────

#[derive(serde::Deserialize)]
pub struct ExtractFrameRequest {
    pub path: String,
    pub time: f64,
    /// Scale longest edge to this many pixels (0 / missing = source size).
    pub max_width: Option<u32>,
}

#[derive(serde::Serialize)]
pub struct ExtractFrameResult {
    /// Standard base64 (RFC 4648) of the JPEG bytes — drop straight into a
    /// `data:image/jpeg;base64,…` URL or an Anthropic vision content block.
    pub base64: String,
    pub mime_type: String,
    pub bytes: usize,
}

/// Extract a single frame at `time` seconds from `path` and return it as a
/// base64 JPEG. The assistant tools use this to feed frames into vision-capable
/// models without going through the regular thumbnail cache (which is sized
/// for the timeline UI, not for analysis).
#[tauri::command]
pub async fn extract_frame(req: ExtractFrameRequest) -> Result<ExtractFrameResult, String> {
    let path = req.path;
    let time = req.time.max(0.0);
    let max_width = req.max_width.unwrap_or(640);

    let bytes = tokio::task::spawn_blocking(move || run_extract_frame(&path, time, max_width))
        .await
        .map_err(|e| format!("extract_frame join: {e}"))??;

    Ok(ExtractFrameResult {
        bytes: bytes.len(),
        base64: encode_base64(&bytes),
        mime_type: "image/jpeg".into(),
    })
}

fn run_extract_frame(path: &str, time: f64, max_width: u32) -> Result<Vec<u8>, String> {
    use std::process::{Command, Stdio};
    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;
    #[cfg(target_os = "windows")]
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let bin = crate::ffmpeg::find_bin("ffmpeg");
    let mut cmd = Command::new(&bin);
    let mut args: Vec<String> = vec![
        "-loglevel".into(), "error".into(),
        "-ss".into(), format!("{:.3}", time),
        "-i".into(), path.into(),
        "-frames:v".into(), "1".into(),
    ];
    if max_width > 0 {
        args.push("-vf".into());
        args.push(format!("scale='min({max_width},iw)':-2"));
    }
    args.extend([
        "-f".into(), "image2".into(),
        "-vcodec".into(), "mjpeg".into(),
        "-q:v".into(), "4".into(),
        "pipe:1".into(),
    ]);

    cmd.args(&args).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd.output().map_err(|e| format!("ffmpeg spawn failed: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "ffmpeg frame extract failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    if output.stdout.is_empty() {
        return Err("ffmpeg produced no frame data".to_string());
    }
    Ok(output.stdout)
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn encode_base64(input: &[u8]) -> String {
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    let mut i = 0;
    while i + 3 <= input.len() {
        let n = ((input[i] as u32) << 16) | ((input[i + 1] as u32) << 8) | (input[i + 2] as u32);
        out.push(B64[((n >> 18) & 0x3f) as usize] as char);
        out.push(B64[((n >> 12) & 0x3f) as usize] as char);
        out.push(B64[((n >> 6) & 0x3f) as usize] as char);
        out.push(B64[(n & 0x3f) as usize] as char);
        i += 3;
    }
    let rem = input.len() - i;
    if rem == 1 {
        let n = (input[i] as u32) << 16;
        out.push(B64[((n >> 18) & 0x3f) as usize] as char);
        out.push(B64[((n >> 12) & 0x3f) as usize] as char);
        out.push('=');
        out.push('=');
    } else if rem == 2 {
        let n = ((input[i] as u32) << 16) | ((input[i + 1] as u32) << 8);
        out.push(B64[((n >> 18) & 0x3f) as usize] as char);
        out.push(B64[((n >> 12) & 0x3f) as usize] as char);
        out.push(B64[((n >> 6) & 0x3f) as usize] as char);
        out.push('=');
    }
    out
}

#[cfg(test)]
mod base64_tests {
    use super::encode_base64;

    #[test]
    fn matches_known_vectors() {
        assert_eq!(encode_base64(b""),       "");
        assert_eq!(encode_base64(b"f"),      "Zg==");
        assert_eq!(encode_base64(b"fo"),     "Zm8=");
        assert_eq!(encode_base64(b"foo"),    "Zm9v");
        assert_eq!(encode_base64(b"foob"),   "Zm9vYg==");
        assert_eq!(encode_base64(b"fooba"),  "Zm9vYmE=");
        assert_eq!(encode_base64(b"foobar"), "Zm9vYmFy");
    }
}

// ── Video Sidecar (<video_stem>.json next to source video) ───────────────────

/// Returns the JSON content of `<video_stem>.json` if it exists next to the video, or null.
#[tauri::command]
pub async fn check_video_sidecar(video_path: String) -> Result<Option<String>, String> {
    let path = std::path::Path::new(&video_path);
    let sidecar = path.with_extension("json");
    if sidecar.exists() {
        let content = std::fs::read_to_string(&sidecar).map_err(|e| e.to_string())?;
        Ok(Some(content))
    } else {
        Ok(None)
    }
}

/// Writes JSON content to `<video_stem>.json` next to the source video.
#[tauri::command]
pub async fn write_video_sidecar(video_path: String, content: String) -> Result<(), String> {
    let path = std::path::Path::new(&video_path);
    let sidecar = path.with_extension("json");
    std::fs::write(&sidecar, &content).map_err(|e| e.to_string())
}

/// Deletes `<video_stem>.json` next to the source video, if it exists.
#[tauri::command]
pub async fn delete_video_sidecar(video_path: String) -> Result<(), String> {
    let path = std::path::Path::new(&video_path);
    let sidecar = path.with_extension("json");
    if sidecar.exists() {
        std::fs::remove_file(&sidecar).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(serde::Serialize)]
pub struct JsonFileResult {
    pub json_content: String,
    pub video_path: String,
}

/// Opens a native JSON file picker, reads the file, and finds the sibling video by stem.
#[tauri::command]
pub async fn open_json_file(app: AppHandle) -> Result<JsonFileResult, String> {
    use tauri_plugin_dialog::DialogExt;

    let file = app
        .dialog()
        .file()
        .add_filter("Marker JSON", &["json"])
        .blocking_pick_file();

    let json_path = match file {
        Some(p) => p.into_path().map_err(|e| e.to_string())?,
        None => return Err("cancelled".to_string()),
    };

    let content = std::fs::read_to_string(&json_path).map_err(|e| e.to_string())?;

    let video_exts = ["mp4", "mov", "avi", "mkv", "webm", "m4v"];
    let stem = json_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    let parent = json_path
        .parent()
        .unwrap_or(std::path::Path::new("."));

    for ext in &video_exts {
        let candidate = parent.join(format!("{stem}.{ext}"));
        if candidate.exists() {
            return Ok(JsonFileResult {
                json_content: content,
                video_path: candidate.to_string_lossy().to_string(),
            });
        }
    }

    Err(format!("No video file found for '{stem}' in the same folder"))
}

// ── Reveal in OS file manager ─────────────────────────────────────────────────

/// Opens the given folder path in the OS file manager (Explorer / Finder / Nautilus).
#[tauri::command]
pub async fn reveal_in_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Opens the OS file manager *with the given file selected*.
/// On Windows uses `explorer /select,<path>`, on macOS `open -R <path>`,
/// on Linux falls back to opening the parent directory (no universal
/// "show in folder" verb).
#[tauri::command]
pub async fn show_in_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // explorer parses the comma-joined arg as `/select,<path>` and
        // highlights the file in its containing folder.
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", path))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        // No standard reveal verb — open the parent directory instead.
        let parent = std::path::Path::new(&path)
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.clone());
        std::process::Command::new("xdg-open")
            .arg(&parent)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Reads the JSON sidecar at the given path directly (e.g. drag-dropped .json file).
#[tauri::command]
pub async fn read_json_sidecar_for_video(json_path: String) -> Result<JsonFileResult, String> {
    let path = std::path::Path::new(&json_path);
    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;

    let video_exts = ["mp4", "mov", "avi", "mkv", "webm", "m4v"];
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    let parent = path.parent().unwrap_or(std::path::Path::new("."));

    for ext in &video_exts {
        let candidate = parent.join(format!("{stem}.{ext}"));
        if candidate.exists() {
            return Ok(JsonFileResult {
                json_content: content,
                video_path: candidate.to_string_lossy().to_string(),
            });
        }
    }

    Err(format!("No video file found for '{stem}' in the same folder"))
}

// ── LosslessCut (.llc) project import ─────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct LlcSegment {
    pub start: f64,
    pub end: f64,
    pub name: String,
}

#[derive(serde::Serialize)]
pub struct LlcProject {
    pub video_path: String,
    pub cut_segments: Vec<LlcSegment>,
}

#[derive(serde::Deserialize)]
struct LlcRaw {
    #[serde(rename = "mediaFileName")]
    media_file_name: Option<String>,
    #[serde(rename = "cutSegments", default)]
    cut_segments: Vec<LlcRawSegment>,
}

#[derive(serde::Deserialize)]
struct LlcRawSegment {
    #[serde(default)]
    start: Option<f64>,
    #[serde(default)]
    end: Option<f64>,
    #[serde(default)]
    name: Option<String>,
}

/// Read a LosslessCut project file (.llc — JSON5), resolve its referenced
/// media file relative to the project file's directory, and return the
/// video path + converted cut segments. The caller maps segments to regions
/// on the TS side; no .llc state is persisted.
#[tauri::command]
pub async fn load_llc_project(llc_path: String) -> Result<LlcProject, String> {
    let path = std::path::Path::new(&llc_path);
    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let raw: LlcRaw = json5::from_str(&content).map_err(|e| format!("Parse .llc: {}", e))?;

    let media = raw
        .media_file_name
        .ok_or_else(|| "Missing mediaFileName in .llc file".to_string())?;
    let parent = path.parent().unwrap_or(std::path::Path::new("."));
    let video = parent.join(&media);
    if !video.exists() {
        return Err(format!(
            "Referenced video not found: {}",
            video.display()
        ));
    }

    let cut_segments = raw
        .cut_segments
        .into_iter()
        .filter_map(|s| match (s.start, s.end) {
            (Some(start), Some(end)) if end > start => Some(LlcSegment {
                start,
                end,
                name: s.name.unwrap_or_default(),
            }),
            _ => None,
        })
        .collect();

    Ok(LlcProject {
        video_path: video.to_string_lossy().to_string(),
        cut_segments,
    })
}

// ── Scene Detection ──────────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
pub struct SceneDetectRequest {
    pub path: String,
    /// Optional scdet threshold. Higher = fewer, more confident cuts. Defaults to 10.
    pub threshold: Option<f64>,
    /// Optional scan window (source-time seconds). When both are provided and
    /// `end > start`, scdet only sees this slice and reported cut times are
    /// shifted back into source time before they reach the UI.
    pub start: Option<f64>,
    pub end: Option<f64>,
}

#[tauri::command]
pub async fn start_scene_detection(
    app: AppHandle,
    req: SceneDetectRequest,
) -> Result<String, String> {
    let job_id = uuid::Uuid::new_v4().to_string();
    let threshold = req.threshold.unwrap_or(DEFAULT_THRESHOLD);
    let window = match (req.start, req.end) {
        (Some(s), Some(e)) if e > s => Some(ScanWindow { start: s.max(0.0), end: e }),
        _ => None,
    };

    log::info!(
        "start_scene_detection[{job_id}]: path={} threshold={threshold} window={:?}",
        req.path, window
    );

    // Reset the cancel flag for this run. If a previous job is still winding
    // down, it sees its own stale reference via Arc::clone below and bails.
    let cancel_flag = {
        let state: State<'_, SceneDetectionState> = app.state::<SceneDetectionState>();
        state.cancel.store(false, Ordering::Relaxed);
        state.cancel.clone()
    };

    let app_clone = app.clone();
    let jid = job_id.clone();
    let path = req.path.clone();

    tokio::spawn(async move {
        let app2 = app_clone.clone();
        let jid2 = jid.clone();
        let path_for_block = path.clone();
        let cancel_for_block = cancel_flag.clone();

        let result = tokio::task::spawn_blocking(move || {
            let duration = video_duration(&path_for_block).ok();
            let progress = {
                let app = app2.clone();
                let j = jid2.clone();
                let p = path_for_block.clone();
                move |fraction: f64| {
                    let _ = app.emit(
                        "scene-detection-progress",
                        serde_json::json!({
                            "job_id": &j,
                            "path": &p,
                            "percent": fraction,
                            "status": "running"
                        }),
                    );
                }
            };
            let on_cut = {
                let app = app2.clone();
                let j = jid2.clone();
                let p = path_for_block.clone();
                move |cut: f64| {
                    let _ = app.emit(
                        "scene-detection-progress",
                        serde_json::json!({
                            "job_id": &j,
                            "path": &p,
                            "status": "running",
                            "cut": cut,
                        }),
                    );
                }
            };
            detect_cuts(&path_for_block, threshold, duration, window, progress, on_cut, cancel_for_block)
        })
        .await;

        // Echo the scan window back on the terminal events so the frontend
        // can merge windowed results into existing cuts (replacing only the
        // cuts that fell inside the scanned range).
        let window_json = window.map(|w| serde_json::json!({ "start": w.start, "end": w.end }));

        match result {
            Ok(Ok(cuts)) => {
                log::info!(
                    "start_scene_detection[{jid}]: done, {} cut(s) in {}",
                    cuts.len(),
                    path
                );
                let _ = app_clone.emit(
                    "scene-detection-progress",
                    serde_json::json!({
                        "job_id": &jid,
                        "path": &path,
                        "percent": 1.0,
                        "status": "done",
                        "cuts": cuts,
                        "window": window_json,
                    }),
                );
            }
            Ok(Err(e)) => {
                let status = if e == "cancelled" { "cancelled" } else { "error" };
                if status == "cancelled" {
                    log::info!("start_scene_detection[{jid}]: cancelled");
                } else {
                    log::error!("start_scene_detection[{jid}]: failed: {e}");
                }
                let _ = app_clone.emit(
                    "scene-detection-progress",
                    serde_json::json!({
                        "job_id": &jid,
                        "path": &path,
                        "status": status,
                        "error": e,
                        "window": window_json,
                    }),
                );
            }
            Err(e) => {
                log::error!("start_scene_detection[{jid}]: panicked: {e}");
                let _ = app_clone.emit(
                    "scene-detection-progress",
                    serde_json::json!({
                        "job_id": &jid,
                        "path": &path,
                        "status": "error",
                        "error": e.to_string(),
                        "window": window_json,
                    }),
                );
            }
        }
    });

    Ok(job_id)
}

/// Asks the currently running scene-detection job to stop. Safe to call when
/// no job is running; the flag is simply reset next time one starts.
#[tauri::command]
pub async fn cancel_scene_detection(
    state: State<'_, SceneDetectionState>,
) -> Result<(), String> {
    state.cancel.store(true, Ordering::Relaxed);
    Ok(())
}
