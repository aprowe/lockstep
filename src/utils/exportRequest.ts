import type { WarpRequest } from '../api/warp'
import type { WarpData } from '../types'

export interface ExportJobInput {
  label: string
  clipIn: number | null
  clipOut: number | null
  bpm: number
  addToEnd: boolean
  triggerMode?: boolean
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
  interpMethod: 'minterpolate' | 'rife'
}

/** Builds the WarpRequest payload sent to the Rust backend.
 *  `interpolateFrames` toggles frame interpolation (constant fps, blended frames);
 *  when false, variable speed is encoded via PTS. */
export function buildWarpRequest(input: BuildWarpRequestInput): WarpRequest {
  const { videoPath, warpData, job, loopBeats, trimToLoop, fadeAtLoop, normalizeBpm, interpolateFrames, interpFps, interpMethod } = input

  const hasMarkers = !!warpData && warpData.origAnchors.length >= 1
  // Per-region export jobs must only carry anchors that fall within this
  // region's source-time window. Otherwise anchors from elsewhere in the video
  // bloat the time map (one segment per adjacent pair) and the exported region
  // ends up sliced into hundreds of tiny re-encodes instead of 1–2 clean cuts.
  const clipIn = job.clipIn
  const clipOut = job.clipOut
  const inRange = (t: number) =>
    (clipIn == null || t >= clipIn - 1e-6) && (clipOut == null || t <= clipOut + 1e-6)
  const pairs = hasMarkers
    ? [...warpData!.origAnchors]
        .sort((a, b) => a.time - b.time)
        .filter(oa => inRange(oa.time))
        .map(oa => ({
          orig: oa.time,
          beat: warpData!.beatAnchors.find(ba => ba.id === oa.id)?.time ?? oa.time,
        }))
    : []

  const triggerMode = !!job.triggerMode
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
    // Trigger mode plays at 1.0x; frame interpolation makes no sense there.
    interp_fps: !triggerMode && interpolateFrames ? Math.max(1, Math.round(interpFps)) : null,
    interp_method: !triggerMode && interpolateFrames ? interpMethod : null,
    trigger_mode: triggerMode,
  }
}
