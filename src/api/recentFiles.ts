import { invoke } from "@tauri-apps/api/core";

/** Return the recent-files list (most-recent first), as persisted by the Rust backend. */
export async function getRecentFiles(): Promise<string[]> {
    return invoke<string[]>("get_recent_files");
}

/** Bump `path` to the head of the recent-files list. Backend deduplicates and caps the length. */
export async function addRecentFile(path: string): Promise<void> {
    await invoke("add_recent_file", { path });
}

/** Clear the entire recent-files list. */
export async function clearRecentFiles(): Promise<void> {
    await invoke("clear_recent_files");
}
