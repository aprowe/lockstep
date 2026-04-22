export interface VideoInfo {
  /** Local filesystem path — used for Tauri commands */
  path: string
  originalName: string
  /** convertFileSrc(path) — used for the HTML5 video element */
  videoUrl: string
  duration: number
  fps: number
  /** Stable content fingerprint — used as localStorage key for markers */
  fileHash: string
}

export interface Anchor {
  id: number
  time: number // seconds
}

export interface QuantizedAnchor {
  id: number
  origTime: number
  quantTime: number
}

export interface WarpSegment {
  origLeft: number  // % of original duration (0-100)
  origRight: number
  quantLeft: number // % of output duration (0-100)
  quantRight: number
  stretchRatio: number // quantSpan / origSpan — >1 means stretched, <1 compressed
}

export interface Band {
  left: number  // % within this timeline's full duration
  right: number
  stretchRatio: number
}

export interface View {
  start: number // seconds
  end: number
}

export interface WarpData {
  origAnchors: Anchor[]
  beatAnchors: Anchor[]
  bpm: number
  minStretch: number
  maxStretch: number
  /** Beat-time of the designated beat-zero anchor in the output */
  beatZeroTime: number
  /** When true, the pre-beat-zero section is appended to the end of the output */
  addToEnd: boolean
}

/** A user-defined sub-region of a video.
 *  Markers are global to the video — the region just defines a view window.
 *  Beat zero is always the region's inPoint. */
export interface Region {
  id: string
  name: string
  inPoint: number              // seconds in original video — also beat zero
  outPoint: number             // seconds in original video
  bpm: number
  minStretch: number
  maxStretch: number
  addToEnd: boolean
  /** Beat-space time for the in boundary (defaults to inPoint = linked/identity) */
  inBeatTime?: number
  /** Beat-space time for the out boundary (defaults to outPoint = linked/identity) */
  outBeatTime?: number
  /** Which value stays fixed when region is resized: 'bpm' (default) or 'beats' */
  lock?: 'bpm' | 'beats'
  /** Snapshot of beat count when lock='beats' (used to derive BPM on resize) */
  lockedBeats?: number
  /** When true, export plays each anchor interval at 1.0x (truncating source or
   *  padding with a freeze-frame) instead of time-warping. No frame interp. */
  triggerMode?: boolean
}

/** A clip block overlaid on the timeline track at the same zoom level */
export interface ClipOverlay {
  id: string
  name: string
  inPoint: number
  outPoint: number
  active: boolean
  /** 0-based index for color cycling (optional, defaults to 0) */
  colorIndex?: number
}

/** Multi-selection state for markers */
export interface SelectionState {
  selectedIds: Set<number>
  lastClickedId: number | null
}

/** Persisted per-video state */
export interface SavedVideoState {
  version: 2 | 3
  defaultRegion: {
    origAnchors: Anchor[]
    beatAnchors: Anchor[]
    bpm: number
    minStretch: number
    maxStretch: number
    beatZeroAnchorTime: number | null
    loopBeats?: number | null
    trimToLoop?: boolean
    addToEnd?: boolean
  }
  regions: Region[]
  /** Cached scene detection output — keyed to the threshold it was computed at.
   *  `minGap` is the per-video min-spacing setting; persists independently of
   *  cuts so a freshly opened video remembers it without re-running detection. */
  scenes?: {
    threshold: number
    cuts: number[]
    minGap?: number
  }
}
