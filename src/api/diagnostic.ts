import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { UnlistenFn } from '@tauri-apps/api/event'

export interface DiagnosticProgressPayload {
  job_id: string
  mode: 'diagnostic' | 'overlay'
  percent: number
  message?: string
  status: 'running' | 'done' | 'error'
  output_path?: string
  error?: string
}

export async function startDiagnostic(params: {
  path: string
  bpm: number
  beat_zero_time: number
  mode: 'diagnostic' | 'overlay'
}): Promise<string> {
  return invoke<string>('start_diagnostic', { req: params })
}

export async function listenDiagnosticProgress(
  cb: (payload: DiagnosticProgressPayload) => void,
): Promise<UnlistenFn> {
  return listen<DiagnosticProgressPayload>('diagnostic-progress', e => cb(e.payload))
}
