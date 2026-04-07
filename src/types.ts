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

export interface Segment {
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

export interface Clip {
  id: string
  name: string
  inPoint: number   // seconds in original video
  outPoint: number  // seconds in original video
  trimToLoop: boolean
  loopBeats: number | null
  addToEnd: boolean
}
