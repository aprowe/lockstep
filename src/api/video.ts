import { invoke } from '@tauri-apps/api/core'
import { convertFileSrc } from '@tauri-apps/api/core'
import type { VideoInfo } from '../types'

interface RawVideoInfo {
  path: string
  original_name: string
  duration: number
  fps: number
  file_hash: string
}

/**
 * Opens a native file picker and returns VideoInfo.
 * Returns null if the user cancelled.
 */
export async function openVideo(): Promise<VideoInfo | null> {
  try {
    const raw = await invoke<RawVideoInfo>('open_video')
    return {
      path: raw.path,
      originalName: raw.original_name,
      videoUrl: convertFileSrc(raw.path),
      duration: raw.duration,
      fps: raw.fps,
      fileHash: raw.file_hash,
    }
  } catch (e: any) {
    if (e === 'cancelled' || String(e).includes('cancelled')) return null
    throw e
  }
}
