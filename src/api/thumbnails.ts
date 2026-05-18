import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export interface ThumbnailPriorityRequest {
  fileHash: string
  videoPath: string
  fps: number
  duration: number
  playheadFrame: number
  regionFrames: [number, number][]
  markerFrames: number[]
  sceneFrames: number[]
  stripFrames?: number[]
  hoverFrames?: number[]
  viewportFrames: [number, number]
  thumbWidth?: number
  maxCachedFrames?: number
}

/** Replaces the priority context for the given file. Workers re-rank against it. */
export function setThumbnailPriority(r: ThumbnailPriorityRequest): Promise<void> {
  return invoke('set_thumbnail_priority', {
    req: {
      file_hash: r.fileHash,
      video_path: r.videoPath,
      fps: r.fps,
      duration: r.duration,
      playhead_frame: r.playheadFrame,
      region_frames: r.regionFrames,
      marker_frames: r.markerFrames,
      scene_frames: r.sceneFrames,
      strip_frames: r.stripFrames ?? [],
      hover_frames: r.hoverFrames ?? [],
      viewport_frames: r.viewportFrames,
      thumb_width: r.thumbWidth,
      max_cached_frames: r.maxCachedFrames,
    },
  })
}

export function getThumbnailPath(fileHash: string, frame: number): Promise<string | null> {
  return invoke<string | null>('get_thumbnail_path', { fileHash, frame })
}

export interface QueueTierStats {
  name: string
  total: number
  ready: number
  in_flight: number
  pending: number
}

export interface QueueStats {
  file_hash: string
  workers_running: number
  total_ready: number
  total_in_flight: number
  max_cached_frames: number
  max_frame: number
  tiers: QueueTierStats[]
}

export function getThumbnailQueueStats(fileHash: string): Promise<QueueStats | null> {
  return invoke<QueueStats | null>('get_thumbnail_queue_stats', { fileHash })
}

export function clearThumbnails(fileHash: string): Promise<void> {
  return invoke('clear_thumbnails', { fileHash })
}

export function clearAllThumbnails(): Promise<void> {
  return invoke('clear_all_thumbnails')
}

export interface ThumbnailReadyPayload {
  file_hash: string
  frame: number
  path: string
  duration_ms?: number
}

export function listenThumbnailReady(
  cb: (p: ThumbnailReadyPayload) => void,
): Promise<UnlistenFn> {
  return listen<ThumbnailReadyPayload>('thumbnail-ready', e => cb(e.payload))
}
