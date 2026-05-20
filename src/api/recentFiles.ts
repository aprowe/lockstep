import { invoke } from '@tauri-apps/api/core'

export async function getRecentFiles(): Promise<string[]> {
  return invoke<string[]>('get_recent_files')
}

export async function addRecentFile(path: string): Promise<void> {
  await invoke('add_recent_file', { path })
}

export async function clearRecentFiles(): Promise<void> {
  await invoke('clear_recent_files')
}
