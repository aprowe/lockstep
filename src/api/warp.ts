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
  fade_at_loop: boolean
  clip_in?: number | null
  clip_out?: number | null
  /** When set, output is re-timed at this constant fps with blended interpolated frames.
   *  When null, variable speed is encoded via PTS (default). */
  interp_fps?: number | null
  /** "minterpolate" (default) | "rife". Only consulted when interp_fps is set. */
  interp_method?: 'minterpolate' | 'rife' | null
  /** When true, play each anchor interval at 1.0x (truncate or freeze-pad)
   *  instead of time-warping. Forces interp_fps=null on the backend. */
  trigger_mode?: boolean
  /** Source-time positions (seconds) of hard scene cuts. RIFE uses these
   *  to avoid blending frames across a cut. Optional. */
  scene_cuts?: number[]
  /** How the audio is muxed into the output:
   *  - 'tempo' (default) — atempo preserves pitch while length matches video
   *  - 'pitch' — asetrate re-pitches with speed (turntable-style)
   *  - 'none' — strip audio entirely (`-an`)
   */
  audio_mode?: 'tempo' | 'pitch' | 'none' | null
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

/** Asks the backend to abort the warp job with `job_id`. The worker checks
 *  the cancel flag at stage boundaries inside `remap_video`, so the actual
 *  termination may lag by up to one stage. */
export async function cancelWarp(jobId: string): Promise<void> {
  return invoke<void>('cancel_warp', { jobId })
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

/** Opens a native save dialog and copies the output file to the chosen location. Returns the saved path. */
export async function saveOutput(req: SaveRequest): Promise<string> {
  return invoke<string>('save_output', { req })
}

/** Opens a native folder picker and returns the selected path. */
export async function pickExportFolder(): Promise<string> {
  return invoke<string>('pick_export_folder')
}

export interface SaveToFolderRequest {
  source_path: string
  dest_folder: string
  file_name: string
}

/** Copies a temp output file directly to a folder without a save dialog. */
export async function saveToFolder(req: SaveToFolderRequest): Promise<string> {
  return invoke<string>('save_to_folder', { req })
}

/** Opens the given folder path in the OS file manager. */
export async function revealInFolder(path: string): Promise<void> {
  return invoke('reveal_in_folder', { path })
}

/** Opens the OS file manager with the given file selected. Falls back to
 *  opening the parent directory on Linux (no universal reveal verb). */
export async function showInFolder(path: string): Promise<void> {
  return invoke('show_in_folder', { path })
}

/** Writes a text file (e.g. JSON metadata) to a given path. */
export async function writeTextFile(path: string, content: string): Promise<void> {
  return invoke('write_text_file', { req: { path, content } })
}

// ── Video Sidecar ─────────────────────────────────────────────────────────────

/** Returns the JSON string from <video_stem>.json next to the source video, or null. */
export async function checkVideoSidecar(videoPath: string): Promise<string | null> {
  return invoke<string | null>('check_video_sidecar', { videoPath })
}

/** Writes JSON to <video_stem>.json next to the source video. */
export async function writeVideoSidecar(videoPath: string, content: string): Promise<void> {
  return invoke('write_video_sidecar', { videoPath, content })
}

/** Deletes <video_stem>.json next to the source video if it exists. */
export async function deleteVideoSidecar(videoPath: string): Promise<void> {
  return invoke('delete_video_sidecar', { videoPath })
}

export interface JsonFileResult {
  jsonContent: string
  videoPath: string
}

/** Opens a native JSON file picker, returns the JSON content and path to sibling video. */
export async function openJsonFile(): Promise<JsonFileResult> {
  const raw = await invoke<{ json_content: string; video_path: string }>('open_json_file')
  return { jsonContent: raw.json_content, videoPath: raw.video_path }
}

/** Reads a .json sidecar at the given path and finds the sibling video. */
export async function readJsonSidecarForVideo(jsonPath: string): Promise<JsonFileResult> {
  const raw = await invoke<{ json_content: string; video_path: string }>('read_json_sidecar_for_video', { jsonPath })
  return { jsonContent: raw.json_content, videoPath: raw.video_path }
}

// ── LosslessCut (.llc) project import ────────────────────────────────────────

export interface LlcSegment {
  start: number
  end: number
  name: string
}

export interface LlcProject {
  videoPath: string
  cutSegments: LlcSegment[]
}

/** Parse a LosslessCut .llc project file (JSON5) and resolve its referenced video. */
export async function loadLlcProject(llcPath: string): Promise<LlcProject> {
  const raw = await invoke<{ video_path: string; cut_segments: LlcSegment[] }>(
    'load_llc_project', { llcPath },
  )
  return { videoPath: raw.video_path, cutSegments: raw.cut_segments }
}
