use tauri::{AppHandle, Emitter};

use crate::ffmpeg::video_duration;
use crate::processor::{estimate_bpm, remap_video, InterpMethod, WarpOptions};
use crate::scene::{detect_cuts, DEFAULT_THRESHOLD};
use crate::video::{get_video_info, VideoInfo};

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

    let video_exts = ["mp4", "mov", "avi", "mkv", "webm", "m4v"];
    let mut entries = Vec::new();

    let dir = std::fs::read_dir(&folder_path).map_err(|e| e.to_string())?;
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
    get_video_info(&path)
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

    get_video_info(&path.to_string_lossy())
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
            Ok(Ok(())) => serde_json::json!({
                "job_id": &jid,
                "percent": 1.0,
                "status": "done",
                "output_path": &out_clone
            }),
            Ok(Err(e)) => serde_json::json!({
                "job_id": &jid,
                "status": "error",
                "error": e
            }),
            Err(e) => serde_json::json!({
                "job_id": &jid,
                "status": "error",
                "error": e.to_string()
            }),
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
            std::fs::copy(&req.source_path, &dest_path)
                .map_err(|e| format!("Save failed: {e}"))?;
            Ok(dest_path.to_string_lossy().to_string())
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
    std::fs::create_dir_all(dest_folder)
        .map_err(|e| format!("Save failed: could not create {}: {e}", dest_folder.display()))?;
    let dest = dest_folder.join(&req.file_name);
    std::fs::copy(&req.source_path, &dest)
        .map_err(|e| format!("Save failed: {e}"))?;
    Ok(dest.to_string_lossy().to_string())
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

// ── Scene Detection ──────────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
pub struct SceneDetectRequest {
    pub path: String,
    /// Optional scdet threshold. Higher = fewer, more confident cuts. Defaults to 10.
    pub threshold: Option<f64>,
}

#[tauri::command]
pub async fn start_scene_detection(
    app: AppHandle,
    req: SceneDetectRequest,
) -> Result<String, String> {
    let job_id = uuid::Uuid::new_v4().to_string();
    let threshold = req.threshold.unwrap_or(DEFAULT_THRESHOLD);

    let app_clone = app.clone();
    let jid = job_id.clone();
    let path = req.path.clone();

    tokio::spawn(async move {
        let app2 = app_clone.clone();
        let jid2 = jid.clone();
        let path_for_block = path.clone();

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
            detect_cuts(&path_for_block, threshold, duration, progress, on_cut)
        })
        .await;

        match result {
            Ok(Ok(cuts)) => {
                let _ = app_clone.emit(
                    "scene-detection-progress",
                    serde_json::json!({
                        "job_id": &jid,
                        "path": &path,
                        "percent": 1.0,
                        "status": "done",
                        "cuts": cuts,
                    }),
                );
            }
            Ok(Err(e)) => {
                let _ = app_clone.emit(
                    "scene-detection-progress",
                    serde_json::json!({
                        "job_id": &jid,
                        "path": &path,
                        "status": "error",
                        "error": e,
                    }),
                );
            }
            Err(e) => {
                let _ = app_clone.emit(
                    "scene-detection-progress",
                    serde_json::json!({
                        "job_id": &jid,
                        "path": &path,
                        "status": "error",
                        "error": e.to_string(),
                    }),
                );
            }
        }
    });

    Ok(job_id)
}
