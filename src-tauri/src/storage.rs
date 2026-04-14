use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn markers_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("markers");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn state_path(app: &AppHandle, file_hash: &str) -> Result<PathBuf, String> {
    // Sanitize: only allow hex chars
    if !file_hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("invalid file hash".to_string());
    }
    Ok(markers_dir(app)?.join(format!("{file_hash}.json")))
}

#[tauri::command]
pub async fn save_video_state(
    app: AppHandle,
    file_hash: String,
    state: serde_json::Value,
) -> Result<(), String> {
    let path = state_path(&app, &file_hash)?;
    let json = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn load_video_state(
    app: AppHandle,
    file_hash: String,
) -> Result<Option<serde_json::Value>, String> {
    let path = state_path(&app, &file_hash)?;
    if !path.exists() {
        return Ok(None);
    }
    let json = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    Ok(Some(value))
}

#[tauri::command]
pub async fn list_saved_hashes(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = markers_dir(&app)?;
    let mut hashes = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |e| e == "json") {
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    hashes.push(stem.to_string());
                }
            }
        }
    }
    Ok(hashes)
}

#[tauri::command]
pub async fn get_file_hash(path: String) -> Result<String, String> {
    crate::video::file_fingerprint(&path)
}
