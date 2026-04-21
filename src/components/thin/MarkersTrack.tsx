import { useCallback, useEffect, useRef } from 'react'
import type { Anchor, View } from '../../types'
import { timeToViewPct } from '../../utils/view'
import { computeSnap, pixelsToSeconds, type SnapTarget } from '../../utils/snap'
import TrackRow from './TrackRow'
import './MarkersTrack.css'

interface MarkersTrackProps {
  anchors: Anchor[]
  view: View
  duration: number
  selectedIds: Set<number>
  label?: string
  /** Grid snap interval (seconds). Typically one beat. */
  snapInterval?: number
  snapOffset?: number
  /** Extra single-point snap targets (scenes, playhead, region edges, etc.). */
  snapTargets?: number[]
  onSeek?: (time: number) => void
  /** Double-click on empty background → create an anchor here. */
  onAdd?: (time: number) => void
  /** Shift-click or double-click on an existing anchor → remove. */
  onDelete?: (id: number) => void
  onSelect?: (id: number, additive: boolean) => void
  onContextMenu?: (id: number, x: number, y: number) => void
  /** Right-click on empty background — raise a global timeline menu at (time,x,y). */
  onBackgroundContextMenu?: (time: number, x: number, y: number) => void
  /** Fires during drag — caller swaps the anchor list in its store. */
  onAnchorsChange?: (next: Anchor[]) => void
  /** Fires when a marker gains/loses hover — used for through-line overlays. */
  onHoverChange?: (id: number | null) => void
  /** Report nearby snap-target times during a drag (empty array / null when idle). */
  onSnapHintsChange?: (times: number[] | null) => void
  /** Report the dragged marker's current time (null when idle). Lets callers
   *  do things like move the playhead to follow the drag. */
  onDragTimeChange?: (time: number | null) => void
}

type DragState = {
  id: number
  startX: number
  startY: number
  dragging: boolean
}

/**
 * Thin marker track — one narrow tick per anchor. Click to seek + select,
 * shift-click or double-click to remove, double-click background to create,
 * pointer-drag to move with snap + neighbor clamping.
 */
export default function MarkersTrack({
  anchors, view, duration,
  selectedIds,
  label = 'Markers',
  snapInterval, snapOffset = 0, snapTargets,
  onSeek, onAdd, onDelete, onSelect, onContextMenu, onBackgroundContextMenu, onAnchorsChange, onHoverChange,
  onSnapHintsChange, onDragTimeChange,
}: MarkersTrackProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const anchorsRef = useRef(anchors); anchorsRef.current = anchors

  // rAF-coalesce drag dispatches. Pointer-move events can fire at 120+Hz on
  // high-refresh displays, but we only need one dispatch per repaint. The
  // pending snapshot holds the latest computed {time, hints} to commit on the
  // next animation frame.
  const rafRef = useRef<number | null>(null)
  const pendingRef = useRef<{ nextAnchors: Anchor[]; snapped: number; hints: number[] } | null>(null)
  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
  }, [])

  const xToTime = useCallback((clientX: number): number => {
    const el = bodyRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    const pct = (clientX - rect.left) / rect.width
    return view.start + pct * (view.end - view.start)
  }, [view.start, view.end])

  const trySnap = useCallback((raw: number, excludeId: number): { snapped: number; hints: number[] } => {
    const el = bodyRef.current
    if (!el) return { snapped: raw, hints: [] }
    const rect = el.getBoundingClientRect()
    const thresholdSec = pixelsToSeconds(8, rect.width, view.end - view.start)
    const hintThresholdSec = pixelsToSeconds(24, rect.width, view.end - view.start)
    const targets: SnapTarget[] = []
    for (const a of anchorsRef.current) {
      if (a.id === excludeId) continue
      targets.push({ time: a.time, source: 'anchor', id: a.id })
    }
    if (snapTargets) for (const t of snapTargets) targets.push({ time: t, source: 'scene' })
    const grid = snapInterval && snapInterval > 0 ? { interval: snapInterval, offset: snapOffset } : undefined
    const { delta } = computeSnap({ subjects: [raw], targets, grid, thresholdSec })

    const hints: number[] = []
    for (const t of targets) {
      if (Math.abs(t.time - raw) <= hintThresholdSec) hints.push(t.time)
    }
    if (grid) {
      const offs = grid.offset ?? 0
      const nearest = offs + Math.round((raw - offs) / grid.interval) * grid.interval
      if (Math.abs(nearest - raw) <= hintThresholdSec) hints.push(nearest)
    }
    return { snapped: raw + delta, hints }
  }, [view.end, view.start, snapInterval, snapOffset, snapTargets])

  const handleBgDoubleClick = useCallback((pct: number) => {
    if (!onAdd) return
    const t = view.start + pct * (view.end - view.start)
    if (t >= 0 && t <= duration) onAdd(t)
  }, [onAdd, view.start, view.end, duration])

  const onMarkerPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>, a: Anchor) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { id: a.id, startX: e.clientX, startY: e.clientY, dragging: false }
  }, [])

  const onMarkerPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current
    if (!d) return
    if (!d.dragging) {
      if (Math.abs(e.clientX - d.startX) < 4 && Math.abs(e.clientY - d.startY) < 4) return
      d.dragging = true
    }
    if (!onAnchorsChange) return
    const raw = xToTime(e.clientX)
    const EPS = 0.001
    const sorted = [...anchorsRef.current].sort((a, b) => a.time - b.time)
    const idx = sorted.findIndex(a => a.id === d.id)
    const minT = idx > 0 ? sorted[idx - 1].time + EPS : 0
    const maxT = idx < sorted.length - 1 ? sorted[idx + 1].time - EPS : duration
    const clamped = Math.max(minT, Math.min(maxT, raw))
    const snap = trySnap(clamped, d.id)
    const snapped = Math.max(minT, Math.min(maxT, snap.snapped))
    pendingRef.current = {
      nextAnchors: anchorsRef.current.map(a => a.id === d.id ? { ...a, time: snapped } : a),
      snapped,
      hints: snap.hints,
    }
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const p = pendingRef.current
      if (!p) return
      pendingRef.current = null
      onAnchorsChange(p.nextAnchors)
      onSnapHintsChange?.(p.hints)
      onDragTimeChange?.(p.snapped)
    })
  }, [xToTime, trySnap, duration, onAnchorsChange, onSnapHintsChange, onDragTimeChange])

  // Pointer-up handles cleanup (flush queued updates, clear snap hints +
  // drag-time indicators) because `onClick` is suppressed by the browser when
  // the pointer moved far enough to be considered a drag — leaving hints
  // stuck on screen. Pointer-up always fires regardless of drag distance.
  const onMarkerPointerUp = useCallback((_e: React.PointerEvent<HTMLButtonElement>) => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      const p = pendingRef.current
      pendingRef.current = null
      if (p) onAnchorsChange?.(p.nextAnchors)
    }
    onSnapHintsChange?.(null)
    onDragTimeChange?.(null)
  }, [onAnchorsChange, onSnapHintsChange, onDragTimeChange])

  const onMarkerClick = useCallback((e: React.MouseEvent<HTMLButtonElement>, a: Anchor) => {
    const wasDragging = dragRef.current?.dragging ?? false
    dragRef.current = null
    if (wasDragging) return
    e.stopPropagation()
    if (e.shiftKey && onDelete) { onDelete(a.id); return }
    onSelect?.(a.id, e.ctrlKey || e.metaKey)
    onSeek?.(a.time)
  }, [onDelete, onSelect, onSeek])

  const onMarkerDoubleClick = useCallback((e: React.MouseEvent<HTMLButtonElement>, a: Anchor) => {
    e.stopPropagation()
    onDelete?.(a.id)
  }, [onDelete])

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
      label={label}
      kind="markers"
      onBackgroundDoubleClick={handleBgDoubleClick}
      onBackgroundContextMenu={handleBgContextMenu}
    >
      <div
        ref={bodyRef}
        className="thin-markers__body"
      >
        {anchors.map(a => {
          const x = timeToViewPct(a.time, view)
          if (x < -1 || x > 101) return null
          const selected = selectedIds.has(a.id)
          return (
            <button
              key={a.id}
              type="button"
              className={`thin-marker${selected ? ' thin-marker--selected' : ''}`}
              style={{ left: `${x}%` }}
              title={`Marker @ ${a.time.toFixed(3)}s`}
              onPointerDown={(e) => onMarkerPointerDown(e, a)}
              onPointerMove={onMarkerPointerMove}
              onPointerUp={onMarkerPointerUp}
              onPointerCancel={onMarkerPointerUp}
              onClick={(e) => onMarkerClick(e, a)}
              onDoubleClick={(e) => onMarkerDoubleClick(e, a)}
              onMouseEnter={() => onHoverChange?.(a.id)}
              onMouseLeave={() => onHoverChange?.(null)}
              onContextMenu={(e) => {
                if (!onContextMenu) return
                e.preventDefault(); e.stopPropagation()
                onContextMenu(a.id, e.clientX, e.clientY)
              }}
            />
          )
        })}
      </div>
    </TrackRow>
  )
}
