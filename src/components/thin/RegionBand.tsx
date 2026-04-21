import { useCallback, useRef } from 'react'
import type { View } from '../../types'
import { timeToViewPct } from '../../utils/view'
import { computeSnap, pixelsToSeconds, type SnapTarget } from '../../utils/snap'
import TrackRow from './TrackRow'
import './RegionBand.css'

export interface RegionBlock {
  id: string
  inPoint: number
  outPoint: number
  colorIndex?: number
  active?: boolean
  label?: string
}

interface RegionBandProps {
  label?: string
  kind: 'input' | 'output'
  regions: RegionBlock[]
  view: View
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
  /** Hover reporting — used to render through-lines at region edges. */
  onHoverChange?: (id: string | null) => void
  /** Report nearby snap-target times during a resize/move drag (null when idle). */
  onSnapHintsChange?: (times: number[] | null) => void
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
  label, kind, regions, view, hideLabels,
  snapTargets, snapInterval, snapOffset = 0,
  onSelect, onContextMenu, onResize, onMove, onZoom, onHoverChange, onSnapHintsChange,
}: RegionBandProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const gestureRef = useRef<Gesture>(null)

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

  const emitHints = useCallback((subjects: number[], ctx: ReturnType<typeof buildSnapContext>) => {
    if (!onSnapHintsChange || !ctx) return
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
    onSnapHintsChange(hints)
  }, [onSnapHintsChange])

  const trySnap = useCallback((raw: number, excludeId: string): number => {
    const ctx = buildSnapContext(excludeId)
    if (!ctx) return raw
    const { delta } = computeSnap({ subjects: [raw], targets: ctx.targets, grid: ctx.grid, thresholdSec: ctx.thresholdSec })
    emitHints([raw], ctx)
    return raw + delta
  }, [buildSnapContext, emitHints])

  const trySnapMove = useCallback((rawIn: number, rawOut: number, excludeId: string): number => {
    const ctx = buildSnapContext(excludeId)
    if (!ctx) return 0
    const { delta } = computeSnap({ subjects: [rawIn, rawOut], targets: ctx.targets, grid: ctx.grid, thresholdSec: ctx.thresholdSec })
    emitHints([rawIn, rawOut], ctx)
    return delta
  }, [buildSnapContext, emitHints])

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
    if (g.type === 'resize-l' && onResize) {
      const rawIn = g.startInP + dt
      const snapped = trySnap(rawIn, g.id)
      const clamped = Math.min(snapped, g.startOutP - MIN_WIDTH_SEC)
      onResize(g.id, clamped, g.startOutP)
    } else if (g.type === 'resize-r' && onResize) {
      const rawOut = g.startOutP + dt
      const snapped = trySnap(rawOut, g.id)
      const clamped = Math.max(snapped, g.startInP + MIN_WIDTH_SEC)
      onResize(g.id, g.startInP, clamped)
    } else if (g.type === 'move' && onMove) {
      const rawIn = g.startInP + dt
      const rawOut = g.startOutP + dt
      const snapDelta = trySnapMove(rawIn, rawOut, g.id)
      onMove(g.id, rawIn + snapDelta, rawOut + snapDelta)
    }
  }, [xToTime, trySnap, trySnapMove, onResize, onMove, regions])

  const onRegionPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>, r: RegionBlock) => {
    const g = gestureRef.current
    gestureRef.current = null
    onSnapHintsChange?.(null)
    if (g?.type === 'potential') {
      onSelect?.(r.id)
    }
  }, [onSelect, onSnapHintsChange])

  return (
    <TrackRow label={label ?? (kind === 'input' ? 'Regions' : 'Out')} kind={`region-${kind}`}>
      <div className="thin-region-band__body" ref={bodyRef}>
        {regions.map(r => {
          if (r.outPoint <= r.inPoint) return null
          const left = timeToViewPct(r.inPoint, view)
          const right = timeToViewPct(r.outPoint, view)
          if (right < -1 || left > 101) return null
          const width = Math.max(0.5, right - left)
          return (
            <div
              key={r.id}
              className={`thin-region clip-overlay--color-${(r.colorIndex ?? 0) % 8}${r.active ? ' thin-region--active' : ''}`}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={r.label ?? `${r.inPoint.toFixed(2)}s → ${r.outPoint.toFixed(2)}s`}
              onMouseEnter={() => onHoverChange?.(r.id)}
              onMouseLeave={() => onHoverChange?.(null)}
              onContextMenu={(e) => {
                if (!onContextMenu) return
                e.preventDefault(); e.stopPropagation()
                onContextMenu(r.id, e.clientX, e.clientY)
              }}
              onDoubleClick={(e) => {
                if (!onZoom) return
                e.stopPropagation()
                onZoom(r.id)
              }}
              onPointerDown={(e) => onRegionPointerDown(e, r, 'middle')}
              onPointerMove={onRegionPointerMove}
              onPointerUp={(e) => onRegionPointerUp(e, r)}
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
                  />
                  <div
                    className="thin-region__handle thin-region__handle--r"
                    style={{ width: `${HANDLE_WIDTH_PX}px` }}
                    onPointerDown={(e) => onRegionPointerDown(e, r, 'right')}
                    onPointerMove={onRegionPointerMove}
                    onPointerUp={(e) => onRegionPointerUp(e, r)}
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
