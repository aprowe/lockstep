import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export interface WarpRequest {
  path: string
  orig_times: number[]
  beat_times: number[]
  bpm: number
  beat_zero_time: number
  add_to_end: boolean
  trim_to_loop: boolean
  loop_beats: number | null
  normalize_bpm: boolean
  fade_at_loop: boolean
  clip_in?: number | null
  clip_out?: number | null
}

export interface WarpProgressPayload {
  job_id: string
  percent?: number
  message?: string
  status: 'running' | 'done' | 'error'
  output_path?: string
  error?: string
}

/** Kicks off a warp job. Returns the job_id immediately (processing runs in background). */
export async function startWarp(req: WarpRequest): Promise<string> {
  return invoke<string>('start_warp', { req })
}

/** Listen for warp progress events. Call the returned function to stop listening. */
export function listenWarpProgress(
  cb: (payload: WarpProgressPayload) => void,
): Promise<UnlistenFn> {
  return listen<WarpProgressPayload>('warp-progress', e => cb(e.payload))
}

export interface AnalyzeResult {
  bpm: number | null
  beat_interval: number | null
  snap_interval: number | null
  intervals: number[]
  anchor_count: number
  message: string
}

export async function analyzeAnchors(anchorTimes: number[]): Promise<AnalyzeResult> {
  return invoke<AnalyzeResult>('analyze_anchors', { req: { anchor_times: anchorTimes } })
}

export interface SaveRequest {
  source_path: string
  suggested_name: string
}

/** Opens a native save dialog and copies the output file to the chosen location. */
export async function saveOutput(req: SaveRequest): Promise<void> {
  await invoke('save_output', { req })
}
