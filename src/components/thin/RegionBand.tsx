import { useCallback, useRef } from 'react'
import type { View } from '../../types'
import { timeToViewPct } from '../../utils/view'
import { computeSnap, pixelsToSeconds, type SnapTarget } from '../../utils/snap'
import { gesture } from '../../store/gesture'
import TrackRow from './TrackRow'
import './RegionBand.css'

export interface RegionBlock {
  id: string
  inPoint: number
  outPoint: number
  colorIndex?: number
  /** Drives the timeline view (single). */
  active?: boolean
  /** Member of the multi-select set (independent of active). */
  selected?: boolean
  label?: string
}

interface RegionBandProps {
  label?: string
  kind: 'input' | 'output'
  regions: RegionBlock[]
  view: View
  /** Maximum time (seconds) for clamping drag / resize. Without this, a
   *  region can be moved past the end of the video or resized below 0. */
  duration?: number
  /** If true, hide the per-region name label (e.g. on the output band). */
  hideLabels?: boolean
  /** Single-point snap targets (scenes, playhead, anchor times, etc.). */
  snapTargets?: number[]
  /** Beat-grid snap (seconds per division). */
  snapInterval?: number
  snapOffset?: number
  onSelect?: (id: string) => void
  onContextMenu?: (id: string, x: number, y: number) => void
  /** Fired while dragging — caller swaps region state. */
  onResize?: (id: string, inPoint: number, outPoint: number) => void
  onMove?: (id: string, inPoint: number, outPoint: number) => void
  /** Double-click on a region — caller zooms the view to the region. */
  onZoom?: (id: string) => void
  /** Double-click on empty band background — create a new region at time. */
  onBackgroundAdd?: (time: number) => void
  /** Right-click on empty band background — global timeline menu. */
  onBackgroundContextMenu?: (time: number, x: number, y: number) => void
}

type Gesture =
  | null
  | { type: 'potential'; id: string; startX: number; startY: number }
  | { type: 'resize-l' | 'resize-r' | 'move'; id: string; startX: number; startInP: number; startOutP: number }

const HANDLE_WIDTH_PX = 6
const MIN_WIDTH_SEC = 0.05

/**
 * Thin region band — colored blocks with name labels, edge-resize handles,
 * drag-to-move, and snap-aware cursor feedback. Stacked twice in ThinTimeline:
 * once for input (source) regions and once for their output (beat-space) spans.
 */
export default function RegionBand({
  label, kind, regions, view, duration, hideLabels,
  snapTargets, snapInterval, snapOffset = 0,
  onSelect, onContextMenu, onResize, onMove, onZoom,
  onBackgroundAdd, onBackgroundContextMenu,
}: RegionBandProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const gestureRef = useRef<Gesture>(null)
  const space = kind === 'input' ? 'input' : 'output'

  // rAF-coalesce drag dispatches — see MarkersTrack for rationale. Snap hints
  // publish into the shared gesture store, which is cleared globally on
  // pointer-up; no per-component unmount cleanup needed for hints.
  type PendingUpdate =
    | { kind: 'resize' | 'move'; id: string; inPoint: number; outPoint: number }
  const rafRef = useRef<number | null>(null)
  const pendingRef = useRef<PendingUpdate | null>(null)
  const pendingHintsRef = useRef<number[] | null>(null)
  /** Edge position the drag is currently snapped to (matches a hint), or null. */
  const pendingDragTimeRef = useRef<number | null>(null)

  const flushPending = useCallback(() => {
    const p = pendingRef.current
    const h = pendingHintsRef.current
    const dt = pendingDragTimeRef.current
    pendingRef.current = null
    pendingHintsRef.current = null
    pendingDragTimeRef.current = null
    if (p && p.kind === 'resize' && onResize) onResize(p.id, p.inPoint, p.outPoint)
    else if (p && p.kind === 'move' && onMove) onMove(p.id, p.inPoint, p.outPoint)
    if (h !== null) gesture.setSnapHints(space, h)
    gesture.setDragTime(space, dt)
  }, [onResize, onMove, space])

  /** True when a numeric value matches one of the snap-hint times (within float epsilon). */
  const matchHint = (value: number, hints: number[]): number | null => {
    const SNAP_EPS = 1e-6
    for (const h of hints) if (Math.abs(h - value) < SNAP_EPS) return h
    return null
  }

  const scheduleFlush = useCallback(() => {
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      flushPending()
    })
  }, [flushPending])

  const xToTime = useCallback((clientX: number): number => {
    const el = bodyRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    const pct = (clientX - rect.left) / rect.width
    return view.start + pct * (view.end - view.start)
  }, [view.start, view.end])

  const buildSnapContext = useCallback((excludeId: string) => {
    const el = bodyRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const thresholdSec = pixelsToSeconds(8, rect.width, view.end - view.start)
    const hintThresholdSec = pixelsToSeconds(24, rect.width, view.end - view.start)
    const targets: SnapTarget[] = []
    for (const r of regions) {
      if (r.id === excludeId) continue
      targets.push({ time: r.inPoint, source: 'region-edge', id: r.id })
      targets.push({ time: r.outPoint, source: 'region-edge', id: r.id })
    }
    if (snapTargets) for (const t of snapTargets) targets.push({ time: t, source: 'custom' })
    const grid = snapInterval && snapInterval > 0 ? { interval: snapInterval, offset: snapOffset } : undefined
    return { targets, grid, thresholdSec, hintThresholdSec }
  }, [view.start, view.end, snapTargets, snapInterval, snapOffset, regions])

  const computeHints = useCallback((subjects: number[], ctx: ReturnType<typeof buildSnapContext>): number[] => {
    if (!ctx) return []
    const hints: number[] = []
    for (const s of subjects) {
      for (const t of ctx.targets) {
        if (Math.abs(t.time - s) <= ctx.hintThresholdSec) hints.push(t.time)
      }
      if (ctx.grid) {
        const offs = ctx.grid.offset ?? 0
        const nearest = offs + Math.round((s - offs) / ctx.grid.interval) * ctx.grid.interval
        if (Math.abs(nearest - s) <= ctx.hintThresholdSec) hints.push(nearest)
      }
    }
    return hints
  }, [])

  const trySnap = useCallback((raw: number, excludeId: string): { snapped: number; hints: number[] } => {
    const ctx = buildSnapContext(excludeId)
    if (!ctx) return { snapped: raw, hints: [] }
    const { delta } = computeSnap({ subjects: [raw], targets: ctx.targets, grid: ctx.grid, thresholdSec: ctx.thresholdSec })
    return { snapped: raw + delta, hints: computeHints([raw], ctx) }
  }, [buildSnapContext, computeHints])

  const trySnapMove = useCallback((rawIn: number, rawOut: number, excludeId: string): { delta: number; hints: number[] } => {
    const ctx = buildSnapContext(excludeId)
    if (!ctx) return { delta: 0, hints: [] }
    const { delta } = computeSnap({ subjects: [rawIn, rawOut], targets: ctx.targets, grid: ctx.grid, thresholdSec: ctx.thresholdSec })
    return { delta, hints: computeHints([rawIn, rawOut], ctx) }
  }, [buildSnapContext, computeHints])

  const onRegionPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, r: RegionBlock, zone: 'left' | 'right' | 'middle') => {
      if (e.button !== 0) return
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      if (zone === 'left' && onResize) {
        gestureRef.current = { type: 'resize-l', id: r.id, startX: e.clientX, startInP: r.inPoint, startOutP: r.outPoint }
      } else if (zone === 'right' && onResize) {
        gestureRef.current = { type: 'resize-r', id: r.id, startX: e.clientX, startInP: r.inPoint, startOutP: r.outPoint }
      } else {
        // Middle zone (or any other) starts as "potential" so a quick
        // click-release becomes a selection; promoted to "move" once the
        // drag threshold is crossed (see onRegionPointerMove).
        gestureRef.current = { type: 'potential', id: r.id, startX: e.clientX, startY: e.clientY }
      }
    },
    [onResize, onMove],
  )

  const onRegionPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current
    if (!g) return
    if (g.type === 'potential') {
      if (Math.abs(e.clientX - g.startX) < 4 && Math.abs(e.clientY - g.startY) < 4) return
      // Promote to move if allowed.
      const r = regions.find(x => x.id === g.id)
      if (!r || !onMove) return
      gestureRef.current = { type: 'move', id: g.id, startX: g.startX, startInP: r.inPoint, startOutP: r.outPoint }
      return
    }
    const tNow = xToTime(e.clientX)
    const tStart = xToTime(g.startX)
    const dt = tNow - tStart
    // Hard upper bound for any edit. Falls back to +∞ when no duration is
    // supplied so the existing min-width clamp still wins for callers that
    // don't pass it.
    const maxT = duration ?? Number.POSITIVE_INFINITY
    if (g.type === 'resize-l' && onResize) {
      const rawIn = g.startInP + dt
      const s = trySnap(rawIn, g.id)
      // Clamp in-point to [0, outPoint - MIN_WIDTH] so the left handle can't
      // cross zero or collide with the right edge.
      const clamped = Math.max(0, Math.min(s.snapped, g.startOutP - MIN_WIDTH_SEC))
      pendingRef.current = { kind: 'resize', id: g.id, inPoint: clamped, outPoint: g.startOutP }
      pendingHintsRef.current = s.hints
      pendingDragTimeRef.current = matchHint(clamped, s.hints)
    } else if (g.type === 'resize-r' && onResize) {
      const rawOut = g.startOutP + dt
      const s = trySnap(rawOut, g.id)
      // Clamp out-point to [inPoint + MIN_WIDTH, duration].
      const clamped = Math.min(maxT, Math.max(s.snapped, g.startInP + MIN_WIDTH_SEC))
      pendingRef.current = { kind: 'resize', id: g.id, inPoint: g.startInP, outPoint: clamped }
      pendingHintsRef.current = s.hints
      pendingDragTimeRef.current = matchHint(clamped, s.hints)
    } else if (g.type === 'move' && onMove) {
      const rawIn = g.startInP + dt
      const rawOut = g.startOutP + dt
      const s = trySnapMove(rawIn, rawOut, g.id)
      // Apply the snap delta first, then clamp so the entire region stays
      // inside [0, duration] without changing its length. Compute the move
      // amount from the start position, then bound it on both sides.
      const desiredIn = rawIn + s.delta
      const span = g.startOutP - g.startInP
      const minDelta = -g.startInP                    // can't push in below 0
      const maxDelta = maxT - g.startOutP             // can't push out past end
      const moveDelta = Math.max(minDelta, Math.min(maxDelta, desiredIn - g.startInP))
      const newIn = g.startInP + moveDelta
      const newOut = newIn + span
      pendingRef.current = { kind: 'move', id: g.id, inPoint: newIn, outPoint: newOut }
      pendingHintsRef.current = s.hints
      // For a move, either edge may have landed on a hint — pick whichever did.
      pendingDragTimeRef.current = matchHint(newIn, s.hints) ?? matchHint(newOut, s.hints)
    } else {
      return
    }
    scheduleFlush()
  }, [xToTime, trySnap, trySnapMove, onResize, onMove, regions, scheduleFlush])

  const endGesture = useCallback(() => {
    gestureRef.current = null
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      flushPending()
    }
    pendingHintsRef.current = null
    // Global pointerup listener in gesture store clears snap hints; no
    // local-callback clear needed.
  }, [flushPending])

  const onRegionPointerUp = useCallback((_e: React.PointerEvent<HTMLDivElement>, r: RegionBlock) => {
    const g = gestureRef.current
    endGesture()
    if (g?.type === 'potential') {
      onSelect?.(r.id)
    }
  }, [onSelect, endGesture])

  const onRegionPointerCancel = useCallback(() => {
    endGesture()
  }, [endGesture])

  const handleBgDoubleClick = useCallback(
    (pct: number) => {
      if (!onBackgroundAdd) return
      const t = view.start + pct * (view.end - view.start)
      onBackgroundAdd(t)
    },
    [onBackgroundAdd, view.start, view.end],
  )

  const handleBgContextMenu = useCallback(
    (pct: number, x: number, y: number) => {
      if (!onBackgroundContextMenu) return
      const t = view.start + pct * (view.end - view.start)
      onBackgroundContextMenu(t, x, y)
    },
    [onBackgroundContextMenu, view.start, view.end],
  )

  return (
    <TrackRow
      label={label ?? (kind === 'input' ? 'Regions' : 'Out')}
      kind={`region-${kind}`}
      onBackgroundDoubleClick={handleBgDoubleClick}
      onBackgroundContextMenu={handleBgContextMenu}
    >
      <div
        className="thin-region-band__body"
        ref={bodyRef}
      >
        {regions.map(r => {
          if (r.outPoint <= r.inPoint) return null
          const left = timeToViewPct(r.inPoint, view)
          const right = timeToViewPct(r.outPoint, view)
          // Keep the region being dragged mounted even if it scrolls out of
          // view — unmount would release pointer capture and strand the rAF,
          // leaving snap hints stuck in the parent until the next pointerup.
          const g = gestureRef.current
          const isDragged = g !== null && g.id === r.id
          if (!isDragged && (right < -1 || left > 101)) return null
          const width = Math.max(0.5, right - left)
          return (
            <div
              key={r.id}
              className={[
                'thin-region',
                `clip-overlay--color-${(r.colorIndex ?? 0) % 8}`,
                r.active && 'thin-region--active',
                r.selected && 'thin-region--selected',
              ].filter(Boolean).join(' ')}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={r.label ?? `${r.inPoint.toFixed(2)}s → ${r.outPoint.toFixed(2)}s`}
              onMouseEnter={() => gesture.setHoveredRegion(r.id)}
              onMouseLeave={() => gesture.setHoveredRegion(null)}
              onContextMenu={(e) => {
                if (!onContextMenu) return
                e.preventDefault(); e.stopPropagation()
                onContextMenu(r.id, e.clientX, e.clientY)
              }}
              onDoubleClick={(e) => {
                // Always stop — otherwise dblclick bubbles up to the TrackRow
                // background handler and creates a new region at the cursor.
                e.stopPropagation()
                if (onZoom) onZoom(r.id)
              }}
              onPointerDown={(e) => onRegionPointerDown(e, r, 'middle')}
              onPointerMove={onRegionPointerMove}
              onPointerUp={(e) => onRegionPointerUp(e, r)}
              onPointerCancel={onRegionPointerCancel}
            >
              {r.label && !hideLabels && <span className="thin-region__label">{r.label}</span>}
              {onResize && (
                <>
                  <div
                    className="thin-region__handle thin-region__handle--l"
                    style={{ width: `${HANDLE_WIDTH_PX}px` }}
                    onPointerDown={(e) => onRegionPointerDown(e, r, 'left')}
                    onPointerMove={onRegionPointerMove}
                    onPointerUp={(e) => onRegionPointerUp(e, r)}
                    onPointerCancel={onRegionPointerCancel}
                  />
                  <div
                    className="thin-region__handle thin-region__handle--r"
                    style={{ width: `${HANDLE_WIDTH_PX}px` }}
                    onPointerDown={(e) => onRegionPointerDown(e, r, 'right')}
                    onPointerMove={onRegionPointerMove}
                    onPointerUp={(e) => onRegionPointerUp(e, r)}
                    onPointerCancel={onRegionPointerCancel}
                  />
                </>
              )}
            </div>
          )
        })}
      </div>
    </TrackRow>
  )
}
