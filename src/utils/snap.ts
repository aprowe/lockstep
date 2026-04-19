/**
 * Proximity snapping for interactive drags.
 *
 * Callers describe what's being dragged (one or more `subjects` — e.g. a
 * single anchor, or the in/out edges of a region moving rigidly together)
 * and what it could snap to (`targets` + optional periodic `grid`). The
 * function returns a single `delta` to apply to every subject so that the
 * closest (subject, target) pair lines up — or 0 if nothing is within
 * `thresholdSec`.
 *
 * Per-source toggles live in `enabledSources`: callers pass a set and any
 * target whose `source` isn't in it is ignored. Leaving it undefined
 * enables every source.
 */
export type SnapSource =
  | 'beat-grid'
  | 'anchor'
  | 'region-edge'
  | 'playhead'
  | 'scene'
  | 'custom'

export interface SnapTarget {
  /** Absolute time (seconds) this target sits at. */
  time: number
  /** Logical source — filtered against `enabledSources` and returned in `hit`. */
  source: SnapSource
  /** Opaque id the caller can correlate against its own data (anchor id, clip id, …). */
  id?: string | number
}

/** A periodic grid described by interval + phase offset (e.g. the beat grid). */
export interface SnapGrid {
  /** Spacing in seconds. Non-positive intervals are treated as "no grid". */
  interval: number
  /** Phase offset in seconds (default 0). The grid hits `offset + k * interval`. */
  offset?: number
  /** Source label for the grid. Defaults to `'beat-grid'`. */
  source?: SnapSource
}

export interface SnapRequest {
  /**
   * Current position(s) of the thing being dragged, in seconds.
   * Length ≥ 1. Single subject = `[rawTime]`. Rigid region move = `[inPoint, outPoint]`.
   */
  subjects: number[]
  /** Discrete point targets. */
  targets?: SnapTarget[]
  /** Optional periodic grid. Each subject snaps to its own nearest grid line. */
  grid?: SnapGrid
  /** Maximum distance (seconds) between a subject and a target that still counts as a snap. */
  thresholdSec: number
  /**
   * If provided, only targets whose source is in the set are considered.
   * Applies to both discrete `targets` and the `grid`. Leave undefined to
   * enable every source.
   */
  enabledSources?: Set<SnapSource>
}

export interface SnapHit {
  /** Index into `subjects` of the subject that won the snap. */
  subjectIndex: number
  /** Target the winning subject snapped to. */
  target: SnapTarget
}

export interface SnapResult {
  /** Delta (seconds) to add to every subject. `0` if nothing snapped. */
  delta: number
  /** Which (subject, target) pair won, or `null` if nothing snapped. */
  hit: SnapHit | null
}

const NO_SNAP: SnapResult = { delta: 0, hit: null }

/** Compute the snap delta for a drag gesture. See module doc for full contract. */
export function computeSnap(req: SnapRequest): SnapResult {
  const { subjects, targets, grid, thresholdSec, enabledSources } = req
  if (subjects.length === 0 || !(thresholdSec > 0)) return NO_SNAP

  const isEnabled = (s: SnapSource) => !enabledSources || enabledSources.has(s)

  let bestDist = thresholdSec
  let bestDelta = 0
  let bestHit: SnapHit | null = null

  // Discrete point targets: O(subjects × targets)
  if (targets && targets.length > 0) {
    for (let i = 0; i < subjects.length; i++) {
      const s = subjects[i]
      for (const t of targets) {
        if (!isEnabled(t.source)) continue
        const d = Math.abs(s - t.time)
        if (d < bestDist) {
          bestDist = d
          bestDelta = t.time - s
          bestHit = { subjectIndex: i, target: t }
        }
      }
    }
  }

  // Periodic grid: each subject snaps to its own nearest grid line
  if (grid && grid.interval > 0) {
    const source = grid.source ?? 'beat-grid'
    if (isEnabled(source)) {
      const offset = grid.offset ?? 0
      for (let i = 0; i < subjects.length; i++) {
        const s = subjects[i]
        const nearest = offset + Math.round((s - offset) / grid.interval) * grid.interval
        const d = Math.abs(s - nearest)
        if (d < bestDist) {
          bestDist = d
          bestDelta = nearest - s
          bestHit = { subjectIndex: i, target: { time: nearest, source } }
        }
      }
    }
  }

  return bestHit ? { delta: bestDelta, hit: bestHit } : NO_SNAP
}

/** Convert a pixel threshold to a time threshold using the current view span. */
export function pixelsToSeconds(pixels: number, pixelWidth: number, visibleSpan: number): number {
  if (pixelWidth <= 0) return 0
  return (pixels / pixelWidth) * visibleSpan
}
