//! Integration tests for `commands::save_to_folder`.
//!
//! Pure filesystem — no ffmpeg, not `#[ignore]`d, runs in the normal `cargo test` pass.

use lockstep_lib::commands::{save_to_folder, SaveToFolderRequest};

fn block_on<F: std::future::Future>(f: F) -> F::Output {
    tauri::async_runtime::block_on(f)
}

// behavior: export-options::bfc3070e
#[test]
fn save_to_folder_creates_missing_parent_directories() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let src = tmp.path().join("src.bin");
    std::fs::write(&src, b"payload").unwrap();

    let nested = tmp.path().join("a").join("b").join("c");
    assert!(!nested.exists(), "precondition: nested folder must not exist yet");

    let saved = block_on(save_to_folder(SaveToFolderRequest {
        source_path: src.to_string_lossy().into_owned(),
        dest_folder: nested.to_string_lossy().into_owned(),
        file_name: "out.bin".into(),
    }))
    .expect("save_to_folder should create parents and copy");

    let expected = nested.join("out.bin");
    assert_eq!(std::path::Path::new(&saved), expected);
    assert!(expected.exists(), "output file must land at the nested path");
    assert_eq!(std::fs::read(&expected).unwrap(), b"payload");
}

#[test]
fn save_to_folder_is_noop_on_existing_folder() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let src = tmp.path().join("src.bin");
    std::fs::write(&src, b"payload").unwrap();

    let saved = block_on(save_to_folder(SaveToFolderRequest {
        source_path: src.to_string_lossy().into_owned(),
        dest_folder: tmp.path().to_string_lossy().into_owned(),
        file_name: "out.bin".into(),
    }))
    .expect("save_to_folder should succeed on existing folder");

    assert!(std::path::Path::new(&saved).exists());
}
