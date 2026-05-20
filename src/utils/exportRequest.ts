import type { WarpRequest } from "../api/warp";
import type { WarpData } from "../types";

export interface ExportJobInput {
    label: string;
    clipIn: number | null;
    clipOut: number | null;
    bpm: number;
    /** Beat-space time for the clip's in boundary. Used to inject a synthetic
     *  boundary anchor so the time map always encodes the intended stretch. */
    inBeatTime?: number;
    /** Beat-space time for the clip's out boundary. */
    outBeatTime?: number;
}

export type AudioMode = "tempo" | "pitch" | "none";

export interface BuildWarpRequestInput {
    videoPath: string;
    warpData: WarpData | null;
    job: ExportJobInput;
    interpolateFrames: boolean;
    interpFps: number;
    interpMethod: "minterpolate" | "rife";
    /** Source-time positions of detected scene cuts. Filtered to the job's
     *  clip window before sending. */
    sceneCuts?: number[];
    /** Audio handling: 'tempo' keeps pitch (default), 'pitch' re-pitches with
     *  speed, 'none' omits the audio track. */
    audioMode?: AudioMode;
}

/** Builds the WarpRequest payload sent to the Rust backend.
 *  `interpolateFrames` toggles frame interpolation (constant fps, blended frames);
 *  when false, variable speed is encoded via PTS. */
export function buildWarpRequest(input: BuildWarpRequestInput): WarpRequest {
    const {
        videoPath,
        warpData,
        job,
        interpolateFrames,
        interpFps,
        interpMethod,
        sceneCuts,
        audioMode,
    } = input;

    const hasMarkers = !!warpData && warpData.origAnchors.length >= 1;
    const clipIn = job.clipIn;
    const clipOut = job.clipOut;
    const eps = 1e-6;
    const inRange = (t: number) =>
        (clipIn == null || t >= clipIn - eps) && (clipOut == null || t <= clipOut + eps);
    const atBoundary = (t: number) =>
        (clipIn != null && Math.abs(t - clipIn) < eps) ||
        (clipOut != null && Math.abs(t - clipOut) < eps);

    // Filter real anchors to clip window, excluding boundary positions
    // (we always inject those from the region's beat times below).
    let pairs = hasMarkers
        ? [...warpData!.origAnchors]
              .sort((a, b) => a.time - b.time)
              .filter((oa) => inRange(oa.time) && !atBoundary(oa.time))
              .map((oa) => ({
                  orig: oa.time,
                  beat: warpData!.beatAnchors.find((ba) => ba.id === oa.id)?.time ?? oa.time,
              }))
        : [];

    // Always inject clip boundary anchors from the region's beat-space positions.
    // The front-end constraint system guarantees these are correct; we trust them
    // over any real anchor that might sit at the same source time.
    // Identity case (no stretch): inBeatTime === clipIn and outBeatTime === clipOut.
    if (clipIn != null && job.inBeatTime != null) {
        pairs = [{ orig: clipIn, beat: job.inBeatTime }, ...pairs];
    }
    if (clipOut != null && job.outBeatTime != null) {
        pairs = [...pairs, { orig: clipOut, beat: job.outBeatTime }];
    }

    const cutsInRange = (sceneCuts ?? []).filter(inRange);
    const rifeOnUnwarped = interpolateFrames && interpMethod === "rife" && pairs.length === 0;
    const useInterp = interpolateFrames && !rifeOnUnwarped;
    return {
        path: videoPath,
        orig_times: pairs.map((p) => p.orig),
        beat_times: pairs.map((p) => p.beat),
        bpm: job.bpm,
        clip_in: job.clipIn ?? null,
        clip_out: job.clipOut ?? null,
        interp_fps: useInterp ? Math.max(1, Math.round(interpFps)) : null,
        interp_method: useInterp ? interpMethod : null,
        scene_cuts: cutsInRange,
        audio_mode: audioMode ?? "tempo",
    };
}
