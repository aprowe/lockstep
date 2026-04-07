mod commands;
mod ffmpeg;
mod processor;
mod video;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::open_video,
            commands::analyze_anchors,
            commands::start_warp,
            commands::save_output,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
