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
            commands::pick_export_folder,
            commands::save_to_folder,
            commands::write_text_file,
            commands::reveal_in_folder,
            commands::check_video_sidecar,
            commands::write_video_sidecar,
            commands::delete_video_sidecar,
            commands::open_json_file,
            commands::read_json_sidecar_for_video,
            storage::save_video_state,
            storage::load_video_state,
            storage::list_saved_hashes,
            storage::get_file_hash,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
