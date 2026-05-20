import { invoke } from '@tauri-apps/api/core'
import { convertFileSrc } from '@tauri-apps/api/core'
import type { VideoInfo } from '../types'

export interface RawVideoInfo {
  path: string
  original_name: string
  duration: number
  fps: number
  file_hash: string
  width?: number
  height?: number
  video_codec?: string
  container?: string
  file_size?: number
  bitrate?: number
  audio_codec?: string
  audio_channels?: number
  audio_sample_rate?: number
}

export interface VideoEntry {
  path: string
  name: string
}

export function rawToVideoInfo(raw: RawVideoInfo): VideoInfo {
  return {
    path: raw.path,
    originalName: raw.original_name,
    videoUrl: convertFileSrc(raw.path),
    duration: raw.duration,
    fps: raw.fps,
    fileHash: raw.file_hash,
    width: raw.width,
    height: raw.height,
    videoCodec: raw.video_codec,
    container: raw.container,
    fileSize: raw.file_size,
    bitrate: raw.bitrate,
    audioCodec: raw.audio_codec,
    audioChannels: raw.audio_channels,
    audioSampleRate: raw.audio_sample_rate,
  }
}

/**
 * Opens a native file picker and returns VideoInfo.
 * Returns null if the user cancelled.
 */
export async function openVideo(): Promise<VideoInfo | null> {
  try {
    const raw = await invoke<RawVideoInfo>('open_video')
    return rawToVideoInfo(raw)
  } catch (e: any) {
    if (e === 'cancelled' || String(e).includes('cancelled')) return null
    throw e
  }
}

/**
 * Opens a native folder picker and returns the list of video files inside it.
 * Returns null if the user cancelled.
 */
export async function openFolder(): Promise<VideoEntry[] | null> {
  try {
    return await invoke<VideoEntry[]>('open_folder')
  } catch (e: any) {
    if (e === 'cancelled' || String(e).includes('cancelled')) return null
    throw e
  }
}

/**
 * Loads VideoInfo from a known file path (no dialog).
 */
export async function loadVideoFromPath(path: string): Promise<VideoInfo> {
  const raw = await invoke<RawVideoInfo>('load_video', { path })
  return rawToVideoInfo(raw)
}

/**
 * Lists video files in a folder by path (no dialog).
 */
export async function listFolderVideos(path: string): Promise<VideoEntry[]> {
  return invoke<VideoEntry[]>('list_folder_videos', { path })
}
