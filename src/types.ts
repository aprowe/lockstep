/**
 * Loaded-video metadata surfaced to the UI. Returned by the `open_video`,
 * `load_video`, and `extract_frame` Tauri command surfaces.
 */
export interface VideoInfo {
    /** Absolute filesystem path. Pass this to any Tauri command that takes a video. */
    path: string;
    originalName: string;
    /** `convertFileSrc(path)` — `tauri://localhost/...` URL for the `<video>` element. */
    videoUrl: string;
    duration: number;
    fps: number;
    /** Stable content fingerprint (see `video.rs::file_fingerprint`). Key for sidecar storage. */
    fileHash: string;
    /** ── Stream metadata reported by ffprobe ───────────────────────────── */
    width?: number;
    height?: number;
    videoCodec?: string;
    container?: string;
    fileSize?: number;
    bitrate?: number;
    audioCodec?: string;
    audioChannels?: number;
    audioSampleRate?: number;
}

/**
 * Beat-marker anchor. Exists once on the orig side and once on the beat side
 * with a shared `id` — the pair links the two timelines.
 */
export interface Anchor {
    id: number;
    /** Time in seconds (orig-space on `warp.origAnchors`, beat-space on `warp.beatAnchors`). */
    time: number;
    /** Persisted link flag. `true` (default when absent) means the beat-side anchor
     *  tracks the orig-side (the `pair:a{id}-in` MirrorPair constraint is installed).
     *  `false` means the user diverged the pair so the two sides move independently. */
    linked?: boolean;
}

export interface QuantizedAnchor {
    id: number;
    origTime: number;
    quantTime: number;
}

/** A single stretch segment between two adjacent anchor pairs. */
export interface WarpSegment {
    /** Left edge in orig-space, as a percentage of original duration (0-100). */
    origLeft: number;
    origRight: number;
    /** Left edge in beat-space, as a percentage of output duration (0-100). */
    quantLeft: number;
    quantRight: number;
    /** `quantSpan / origSpan` — values > 1 stretch (slow), < 1 compress (fast). */
    stretchRatio: number;
}

/** Coloured band overlay rendered on the timeline track. */
export interface Band {
    /** Left edge as percentage within the timeline's full duration. */
    left: number;
    right: number;
    stretchRatio: number;
}

/** Visible time window of the timeline (both bounds in seconds). */
export interface View {
    start: number;
    end: number;
}

/** Bundle of warp state passed to the export pipeline and a few legacy consumers. */
export interface WarpData {
    origAnchors: Anchor[];
    beatAnchors: Anchor[];
    bpm: number;
    minStretch: number;
    maxStretch: number;
}

/**
 * A user-defined sub-region of a video, with its own BPM and beat-space bounds.
 * Markers are global to the video — the region just defines a view window.
 * Beat zero is always the region's `inPoint`.
 */
export interface Region {
    id: string;
    name: string;
    /** Orig-space start in seconds; also serves as beat zero. */
    inPoint: number;
    /** Orig-space end in seconds. */
    outPoint: number;
    bpm: number;
    minStretch: number;
    maxStretch: number;
    /** Beat-space time for the in boundary. */
    inBeatTime: number;
    /** Beat-space time for the out boundary. */
    outBeatTime: number;
    /** When true, the clipout follows the clipin (structural DirectedPair installed).
     *  When false, the user owns the clipout's beat-space anchoring (diverged). */
    defaultLinked: boolean;
    /** Snapshot of beat count under the global `beats` lock mode — used to
     *  re-derive BPM when an edge is resized. */
    lockedBeats?: number;
    /** Stable seed for the palette swatch (mod 8 → `clip-overlay--color-N`).
     *  Captured at creation time so deletions and reorderings don't shuffle colors. */
    colorIndex?: number;
}

/** A clip block overlaid on the timeline track at the same zoom level. */
export interface ClipOverlay {
    id: string;
    name: string;
    inPoint: number;
    outPoint: number;
    active: boolean;
    /** Member of the multi-select set in the clips list — drawn with an accent
     *  outline on the timeline so the user can see which clips a bulk action
     *  would touch. */
    selected?: boolean;
    /** 0-based index for color cycling (optional, defaults to 0). */
    colorIndex?: number;
    /** Beat-space in boundary (matches `region.inBeatTime`; set when cloned from a Region). */
    inBeatTime?: number;
    /** Beat-space out boundary (matches `region.outBeatTime`; set when cloned from a Region). */
    outBeatTime?: number;
}

/** Multi-selection state for markers. */
export interface SelectionState {
    selectedIds: Set<number>;
    lastClickedId: number | null;
}

/**
 * Per-video project state persisted as a sidecar JSON next to the source file.
 * Read/written by the persistence middleware via the Tauri sidecar commands.
 */
export interface SavedVideoState {
    version: 2 | 3;
    /** Relative path from the JSON file to the video. Lets a project JSON resolve
     *  its video when opened from a different location than where it was saved. */
    videoPath?: string;
    defaultRegion: {
        origAnchors: Anchor[];
        beatAnchors: Anchor[];
        bpm: number;
        minStretch: number;
        maxStretch: number;
    };
    regions: Region[];
    /** Cached scene-detection output keyed to the threshold it was computed at.
     *  `minGap` is the per-video min-spacing setting; persists independently of
     *  `cuts` so a freshly opened video remembers it without re-running detection.
     *  `userCuts` are operator-placed boundaries that bypass min-gap filtering. */
    scenes?: {
        threshold: number;
        cuts: number[];
        minGap?: number;
        userCuts?: number[];
    };
}
