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

export type AudioMode = 'tempo' | 'pitch' | 'none'

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
  /** Source-time positions of detected scene cuts. Filtered to the job's
   *  clip window before sending. */
  sceneCuts?: number[]
  /** Audio handling: 'tempo' keeps pitch (default), 'pitch' re-pitches with
   *  speed, 'none' omits the audio track. */
  audioMode?: AudioMode
}

/** Builds the WarpRequest payload sent to the Rust backend.
 *  `interpolateFrames` toggles frame interpolation (constant fps, blended frames);
 *  when false, variable speed is encoded via PTS. */
export function buildWarpRequest(input: BuildWarpRequestInput): WarpRequest {
  const { videoPath, warpData, job, loopBeats, trimToLoop, fadeAtLoop, normalizeBpm, interpolateFrames, interpFps, interpMethod, sceneCuts, audioMode } = input

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
  const cutsInRange = (sceneCuts ?? []).filter(inRange)
  // RIFE is warp-aware — on a clip with no markers in range the time map is
  // the identity, so RIFE is pure cost with no benefit. The user wants RIFE
  // only on clips they actually warped, with no interpolation otherwise
  // (not a minterpolate fallback). Minterpolate keeps applying to every
  // clip the same as before.
  const rifeOnUnwarped = interpolateFrames
    && interpMethod === 'rife'
    && pairs.length === 0
  const useInterp = !triggerMode && interpolateFrames && !rifeOnUnwarped
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
    interp_fps: useInterp ? Math.max(1, Math.round(interpFps)) : null,
    interp_method: useInterp ? interpMethod : null,
    trigger_mode: triggerMode,
    scene_cuts: cutsInRange,
    audio_mode: audioMode ?? 'tempo',
  }
}
