import { invoke } from '@tauri-apps/api/core'
import type { SavedVideoState } from '../types'

export async function saveVideoState(fileHash: string, state: SavedVideoState): Promise<void> {
  await invoke('save_video_state', { fileHash, state })
}

export async function loadVideoState(fileHash: string): Promise<SavedVideoState | null> {
  return await invoke<SavedVideoState | null>('load_video_state', { fileHash })
}

export async function listSavedHashes(): Promise<string[]> {
  return await invoke<string[]>('list_saved_hashes')
}

export async function getFileHash(path: string): Promise<string> {
  return await invoke<string>('get_file_hash', { path })
}
