use tauri::{AppHandle, Emitter};

use crate::processor::{estimate_bpm, remap_video, WarpOptions};
use crate::video::{get_video_info, VideoInfo};

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
}

#[tauri::command]
pub async fn start_warp(app: AppHandle, req: WarpRequest) -> Result<String, String> {
    let job_id = uuid::Uuid::new_v4().to_string();

    let out_dir = std::env::temp_dir().join("vj-toolkit");
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

// ── Save Output ──────────────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
pub struct SaveRequest {
    pub source_path: String,
    pub suggested_name: String,
}

#[tauri::command]
pub async fn save_output(app: AppHandle, req: SaveRequest) -> Result<(), String> {
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
            Ok(())
        }
        None => Err("cancelled".to_string()),
    }
}
