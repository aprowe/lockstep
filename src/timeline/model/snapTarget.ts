import type { SnapTarget, SnapGrid } from '../../utils/snap'
import type { Anchor } from '../../types'

const TARGET_PX = 60

/**
 * Smallest grid spacing (seconds) currently drawn by the beat ruler at this
 * zoom. The output-space snap interval is clamped to be no finer than this
 * so we never snap to ticks the user can't see.
 */
export function smallestVisibleBeatGridSec(
  viewSpanSec: number,
  canvasW: number,
  bpm: number,
): number {
  if (bpm <= 0 || canvasW <= 0 || viewSpanSec <= 0) return Number.POSITIVE_INFINITY
  const beatSec = 60 / bpm
  const pps = canvasW / viewSpanSec
  const ppb = pps * beatSec
  const bpb = 4
  const ppbar = ppb * bpb
  let barGroup = 1
  while (ppbar * barGroup < TARGET_PX) barGroup *= 2
  if (barGroup > 4096) barGroup = 4096
  if (barGroup > 1) {
    const subBarGroup = barGroup >= 8 ? barGroup / 8 : 1
    return subBarGroup * bpb * beatSec
  }
  if (ppb / 4 >= 6) return 0.25 * beatSec
  if (ppb / 2 >= 9) return 0.5 * beatSec
  if (ppb >= 22) return 1 * beatSec
  return bpb * beatSec
}

/**
 * Snap targets for dragging an anchor in input space: every scene cut plus
 * every region's in and out point.
 */
export function anchorDragInputTargets(
  scenes: number[],
  regions: ReadonlyArray<{ inPoint: number; outPoint: number }>,
): SnapTarget[] {
  const targets: SnapTarget[] = []
  for (const t of scenes) targets.push({ time: t, source: 'scene' })
  for (const r of regions) {
    targets.push({ time: r.inPoint, source: 'scene' })
    targets.push({ time: r.outPoint, source: 'scene' })
  }
  return targets
}

/**
 * Snap grid for dragging an anchor in output (beat) space. Returns null when
 * no grid is configured. The interval is clamped so it's never finer than
 * the smallest tick spacing currently visible at the given zoom.
 */
export function anchorDragOutputGrid(
  snapInterval: number | undefined,
  snapOffset: number,
  viewSpanSec: number,
  canvasWidth: number,
  bpm: number,
): SnapGrid | null {
  if (!snapInterval || snapInterval <= 0) return null
  const minVisible = smallestVisibleBeatGridSec(viewSpanSec, canvasWidth, bpm)
  if (!Number.isFinite(minVisible)) return null
  return { interval: Math.max(snapInterval, minVisible), offset: snapOffset }
}

export interface RegionDragTargetParams {
  isOutput: boolean
  anchors: Anchor[]
  beatAnchors: Anchor[]
  scenes: number[]
  /** Regions including the one being dragged — the dragged region is excluded by id. */
  regions: ReadonlyArray<{ id: string; inPoint: number; outPoint: number }>
  excludeId: string
  viewSpan: number
  canvasWidth: number
  bpm: number
  snapInterval?: number
  snapOffset?: number
  /**
   * When true, the drag mutates the BPM grid (e.g. output-space body pan or
   * output-space edge resize with lock='beats'). In this mode the BPM grid and
   * beat anchors are excluded from snap targets — only other clips' in/out
   * boundaries are valid targets.
   */
  gridChanging?: boolean
  /**
   * The in/out points of the region being dragged, in input (original) space.
   * When `gridChanging` is true, these are appended as snap targets directly
   * so the clipout drag can snap to the clipin boundaries without any
   * projection through the warp map.
   */
  selfRegion?: { inPoint: number; outPoint: number }
}

/**
 * Snap targets and optional grid for region drags. Input space: anchors +
 * scenes + other regions' edges. Output space: beat anchors + other regions'
 * edges + grid; no scenes.
 *
 * When `gridChanging` is true (output-space drags that mutate the BPM grid),
 * beat anchors and the BPM grid are excluded — only other clips' boundaries
 * are valid snap targets.
 */
export function regionDragTargets(p: RegionDragTargetParams): {
  targets: SnapTarget[]
  grid?: SnapGrid
} {
  const targets: SnapTarget[] = []
  // Grid-changing output drags skip the beat-anchor targets and grid so the
  // user isn't snapping to a grid that is itself in motion.
  if (!p.gridChanging) {
    const anchorList = p.isOutput ? p.beatAnchors : p.anchors
    for (const a of anchorList) targets.push({ time: a.time, source: 'anchor' })
  }
  if (!p.isOutput) for (const t of p.scenes) targets.push({ time: t, source: 'scene' })
  for (const r of p.regions) {
    if (r.id === p.excludeId) continue
    targets.push({ time: r.inPoint, source: 'scene' })
    targets.push({ time: r.outPoint, source: 'scene' })
  }
  // When the drag is grid-changing and the self region is known, add its
  // input-space inPoint/outPoint directly as snap targets. These are raw
  // canonical Region values (no warp-map projection), so they remain stable
  // as the BPM grid mutates during the drag.
  if (p.gridChanging && p.selfRegion) {
    targets.push({ time: p.selfRegion.inPoint,  source: 'region-edge' })
    targets.push({ time: p.selfRegion.outPoint, source: 'region-edge' })
  }
  let grid: SnapGrid | undefined
  if (!p.gridChanging && p.isOutput && p.snapInterval && p.snapInterval > 0) {
    const minVisible = smallestVisibleBeatGridSec(p.viewSpan, p.canvasWidth, p.bpm)
    grid = { interval: Math.max(p.snapInterval, minVisible), offset: p.snapOffset ?? 0 }
  }
  return { targets, grid }
}

/**
 * Visual snap-candidate hints for a drag in progress.
 *
 * Given the dragged subjects (anchor time, or region in/out edges), the
 * candidate targets, and an optional grid, return the nearby target times
 * the user might still snap to (within `thresholdSec`). The result is
 * trimmed to the two closest hits on each side of the subjects' centroid
 * so the on-canvas hints stay legible.
 *
 * Distinct from `computeSnap`: `computeSnap` chooses the single winning
 * snap to apply now; `snapCandidates` returns the broader set the ruler
 * draws so the user can see what's available.
 */
export function snapCandidates(
  subjects: readonly number[],
  targets: readonly { time: number }[],
  grid: { interval: number; offset: number } | undefined,
  thresholdSec: number,
): number[] {
  const seen = new Set<number>()
  for (const t of targets) {
    for (const s of subjects) {
      if (Math.abs(t.time - s) <= thresholdSec) { seen.add(t.time); break }
    }
  }
  if (grid && grid.interval > 0) {
    for (const s of subjects) {
      const lo = Math.ceil((s - thresholdSec - grid.offset) / grid.interval)
      const hi = Math.floor((s + thresholdSec - grid.offset) / grid.interval)
      for (let i = lo; i <= hi; i++) seen.add(grid.offset + i * grid.interval)
    }
  }
  const center = subjects.reduce((a, b) => a + b, 0) / Math.max(1, subjects.length)
  const all = Array.from(seen)
  const left  = all.filter(t => t <  center).sort((a, b) => b - a).slice(0, 2)
  const right = all.filter(t => t >= center).sort((a, b) => a - b).slice(0, 2)
  return [...left, ...right]
}
