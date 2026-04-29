import { useCallback, useRef } from 'react'
import type { Anchor, View } from '../../types'
import { timeToViewPct } from '../../utils/view'
import { computeSnap, pixelsToSeconds, type SnapTarget } from '../../utils/snap'
import { gesture, type Space } from '../../store/gesture'
import TrackRow from './TrackRow'
import type { RegionBlock } from './RegionBand'
import './MarkersTrack.css'

interface MarkersTrackProps {
  anchors: Anchor[]
  view: View
  duration: number
  selectedIds: Set<number>
  /** When provided, anchor IDs *not* in this set render hollow (transparent
   *  fill, hue-only rim). Only meaningful for Marker Out — used to flag
   *  output anchors that have no source-side partner. */
  linkedIds?: ReadonlySet<number>
  label?: string
  /** Which timeline space this track edits — drives which side of the
   *  gesture store receives snap-hint / drag-time publishes. */
  space: Space
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
  /** Regions whose footprint paints a faint hued background behind the
   *  markers, so each marker track visually inherits its parent clip's color
   *  identity. Pass the input-space regions for Marker In and the
   *  output-space regions for Marker Out. */
  regions?: ReadonlyArray<Pick<RegionBlock, 'id' | 'inPoint' | 'outPoint' | 'colorIndex'>>
}

type DragState = {
  id: number
  startX: number
  startY: number
  dragging: boolean
  /** Snapshot of all dragged markers' ids → starting times. Single-marker drags
   *  hold one entry; tandem drags (the dragged marker is in `selectedIds`) hold
   *  every selected marker. */
  startTimes: Map<number, number>
  /** Per-marker [min, max] allowable time at the current delta=0 — the
   *  clamping window derived from non-dragged neighbors. Pre-computed at
   *  drag start so we don't rebuild it every pointermove. */
  bounds: Map<number, { min: number; max: number }>
}

/**
 * Thin marker track — one narrow tick per anchor. Click to seek + select,
 * shift-click or double-click to remove, double-click background to create,
 * pointer-drag to move with snap + neighbor clamping.
 */
export default function MarkersTrack({
  anchors, view, duration,
  selectedIds,
  linkedIds,
  label = 'Markers',
  space,
  snapInterval, snapOffset = 0, snapTargets,
  onSeek, onAdd, onDelete, onSelect, onContextMenu, onBackgroundContextMenu, onAnchorsChange,
  regions,
}: MarkersTrackProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const anchorsRef = useRef(anchors); anchorsRef.current = anchors

  // rAF-coalesce drag dispatches. Pointer-move events can fire at 120+Hz on
  // high-refresh displays, but we only need one dispatch per repaint. The
  // pending snapshot holds the latest computed {time, hints} to commit on the
  // next animation frame. Snap hints + drag time publish into the shared
  // gesture store; the store's window-level pointerup listener clears them
  // even if this component unmounts mid-drag.
  const rafRef = useRef<number | null>(null)
  const pendingRef = useRef<{ nextAnchors: Anchor[]; snapped: number; hints: number[] } | null>(null)

  const xToTime = useCallback((clientX: number): number => {
    const el = bodyRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    const pct = (clientX - rect.left) / rect.width
    return view.start + pct * (view.end - view.start)
  }, [view.start, view.end])

  const trySnap = useCallback((raw: number, excludeIds: Set<number>): { snapped: number; hints: number[] } => {
    const el = bodyRef.current
    if (!el) return { snapped: raw, hints: [] }
    const rect = el.getBoundingClientRect()
    const thresholdSec = pixelsToSeconds(8, rect.width, view.end - view.start)
    const hintThresholdSec = pixelsToSeconds(24, rect.width, view.end - view.start)
    const targets: SnapTarget[] = []
    for (const a of anchorsRef.current) {
      if (excludeIds.has(a.id)) continue
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

    // Build the set of markers moving together. If the user pressed on a
    // marker that's part of a multi-selection, the whole selection drags in
    // tandem; otherwise it's a solo drag.
    const dragIds = selectedIds.has(a.id) && selectedIds.size > 1
      ? new Set<number>(selectedIds)
      : new Set<number>([a.id])

    const startTimes = new Map<number, number>()
    for (const anch of anchorsRef.current) {
      if (dragIds.has(anch.id)) startTimes.set(anch.id, anch.time)
    }

    // Per-marker bounds: each dragged marker is clamped between its nearest
    // non-dragged neighbors (or 0 / duration at the ends). Precomputed once
    // so pointermove stays cheap.
    const EPS = 0.001
    const nonDragged = anchorsRef.current.filter(x => !dragIds.has(x.id))
                                         .map(x => x.time)
                                         .sort((p, q) => p - q)
    const bounds = new Map<number, { min: number; max: number }>()
    for (const [id, t] of startTimes) {
      let lo = 0, hi = duration
      for (const nt of nonDragged) {
        if (nt < t && nt > lo) lo = nt
        if (nt > t && nt < hi) hi = nt
      }
      bounds.set(id, { min: lo + EPS, max: hi - EPS })
    }

    dragRef.current = {
      id: a.id,
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
      startTimes,
      bounds,
    }
  }, [selectedIds, duration])

  const onMarkerPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current
    if (!d) return
    if (!d.dragging) {
      if (Math.abs(e.clientX - d.startX) < 4 && Math.abs(e.clientY - d.startY) < 4) return
      d.dragging = true
    }
    if (!onAnchorsChange) return
    const raw = xToTime(e.clientX)
    const leaderStart = d.startTimes.get(d.id) ?? 0

    // Tandem-delta clamp: the largest & smallest delta that keeps every
    // dragged marker inside its own bounds window. Apply this to the leader
    // before snap so we don't snap past a neighbor.
    let deltaMin = -Infinity, deltaMax = Infinity
    for (const [id, t] of d.startTimes) {
      const b = d.bounds.get(id)
      if (!b) continue
      deltaMin = Math.max(deltaMin, b.min - t)
      deltaMax = Math.min(deltaMax, b.max - t)
    }
    const rawDelta = raw - leaderStart
    const clampedDelta = Math.max(deltaMin, Math.min(deltaMax, rawDelta))
    const leaderClamped = leaderStart + clampedDelta
    const dragIdSet = new Set<number>(d.startTimes.keys())
    const snap = trySnap(leaderClamped, dragIdSet)
    const snappedDelta = Math.max(deltaMin, Math.min(deltaMax, snap.snapped - leaderStart))
    const snappedLeader = leaderStart + snappedDelta

    const nextAnchors = anchorsRef.current.map(anch => {
      const s = d.startTimes.get(anch.id)
      return s !== undefined ? { ...anch, time: s + snappedDelta } : anch
    })

    pendingRef.current = {
      nextAnchors,
      snapped: snappedLeader,
      hints: snap.hints,
    }
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const p = pendingRef.current
      if (!p) return
      pendingRef.current = null
      onAnchorsChange(p.nextAnchors)
      gesture.setSnapHints(space, p.hints)
      gesture.setDragTime(space, p.snapped)
    })
  }, [xToTime, trySnap, onAnchorsChange, space])

  // Pointer-up flushes any queued rAF update. The global gesture listener
  // (window pointerup) clears snap hints + drag time, so local cleanup only
  // has to deal with pending anchor updates.
  const onMarkerPointerUp = useCallback((_e: React.PointerEvent<HTMLButtonElement>) => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      const p = pendingRef.current
      pendingRef.current = null
      if (p) onAnchorsChange?.(p.nextAnchors)
    }
  }, [onAnchorsChange])

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
        className={`thin-markers__body thin-markers__body--${space}`}
      >
        {regions && regions.map(r => {
          const left = timeToViewPct(r.inPoint, view)
          const right = timeToViewPct(r.outPoint, view)
          if (right < -1 || left > 101) return null
          return (
            <div
              key={`bg-${r.id}`}
              className={`thin-markers__region-bg clip-overlay--color-${(r.colorIndex ?? 0) % 8}`}
              style={{ left: `${left}%`, width: `${right - left}%` }}
            />
          )
        })}
        {anchors.map(a => {
          const x = timeToViewPct(a.time, view)
          // Keep any marker being dragged mounted even if it scrolls out of
          // view — unmounting releases pointer capture and strands any rAF
          // that was about to fire, which in turn strands snap hints in the
          // parent's state with no pointerup ever arriving to clear them.
          const isDragged = dragRef.current?.startTimes.has(a.id) ?? false
          if (!isDragged && (x < -1 || x > 101)) return null
          const selected = selectedIds.has(a.id)
          const unlinked = linkedIds !== undefined && !linkedIds.has(a.id)
          return (
            <button
              key={a.id}
              type="button"
              className={`thin-marker${selected ? ' thin-marker--selected' : ''}${unlinked ? ' thin-marker--unlinked' : ''}`}
              style={{ left: `${x}%` }}
              title={`Marker @ ${a.time.toFixed(3)}s`}
              onPointerDown={(e) => onMarkerPointerDown(e, a)}
              onPointerMove={onMarkerPointerMove}
              onPointerUp={onMarkerPointerUp}
              onPointerCancel={onMarkerPointerUp}
              onClick={(e) => onMarkerClick(e, a)}
              onDoubleClick={(e) => onMarkerDoubleClick(e, a)}
              onMouseEnter={() => gesture.setHoveredAnchor(a.id)}
              onMouseLeave={() => gesture.setHoveredAnchor(null)}
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
