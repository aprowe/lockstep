import type { WarpRequest } from '../api/warp'
import type { WarpData } from '../types'

export interface ExportJobInput {
  label: string
  clipIn: number | null
  clipOut: number | null
  bpm: number
  addToEnd: boolean
}

export interface BuildWarpRequestInput {
  videoPath: string
  warpData: WarpData | null
  job: ExportJobInput
  loopBeats: number | null
  trimToLoop: boolean
  fadeAtLoop: boolean
  normalizeBpm: boolean
  interpolateFrames: boolean
  interpFps: number
}

/** Builds the WarpRequest payload sent to the Rust backend.
 *  `interpolateFrames` toggles frame interpolation (constant fps, blended frames);
 *  when false, variable speed is encoded via PTS. */
export function buildWarpRequest(input: BuildWarpRequestInput): WarpRequest {
  const { videoPath, warpData, job, loopBeats, trimToLoop, fadeAtLoop, normalizeBpm, interpolateFrames, interpFps } = input

  const hasMarkers = !!warpData && warpData.origAnchors.length >= 1
  const pairs = hasMarkers
    ? [...warpData!.origAnchors]
        .sort((a, b) => a.time - b.time)
        .map(oa => ({
          orig: oa.time,
          beat: warpData!.beatAnchors.find(ba => ba.id === oa.id)?.time ?? oa.time,
        }))
    : []

  return {
    path: videoPath,
    orig_times: pairs.map(p => p.orig),
    beat_times: pairs.map(p => p.beat),
    bpm: job.bpm,
    beat_zero_time: warpData?.beatZeroTime ?? 0,
    add_to_end: job.addToEnd,
    fade_at_loop: fadeAtLoop && job.addToEnd,
    trim_to_loop: trimToLoop,
    loop_beats: loopBeats ?? null,
    normalize_bpm: normalizeBpm,
    clip_in: job.clipIn ?? null,
    clip_out: job.clipOut ?? null,
    interp_fps: interpolateFrames ? Math.max(1, Math.round(interpFps)) : null,
  }
}
