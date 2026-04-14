mod commands;
mod diagnostic;
mod ffmpeg;
mod processor;
mod storage;
mod video;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::open_video,
            commands::open_folder,
            commands::list_folder_videos,
            commands::load_video,
            commands::analyze_anchors,
            commands::start_warp,
            commands::start_diagnostic,
            commands::save_output,
            storage::save_video_state,
            storage::load_video_state,
            storage::list_saved_hashes,
            storage::get_file_hash,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
