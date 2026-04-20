import { useCallback, useEffect, useRef, useState } from 'react'
import type { Anchor, Band, View } from '../types'
import { stretchColor } from '../utils/quantize'
import { clampView, MIN_VISIBLE, beatGridOpacity } from '../utils/view'
import { formatTime } from '../utils/time'
import { computeSnap, pixelsToSeconds, type SnapTarget } from '../utils/snap'
import { newAnchorId, bumpAnchorIdCounter } from '../store/slices/warpSlice'
import './Timeline.css'

export { newAnchorId, bumpAnchorIdCounter }

export interface TimelineProps {
  duration: number
  bpm?: number
  anchors: Anchor[]
  onAnchorsChange?: (anchors: Anchor[]) => void
  /** Snap dragged anchors to this interval — only within snapThresholdPx */
  snapInterval?: number
  /** Phase offset for snap grid and beat lines (default 0) */
  snapOffset?: number
  /** Pixel radius to engage snap. Default: 8 */
  snapThresholdPx?: number
  noAdd?: boolean
  noRemove?: boolean
  /** Called on double-click instead of the default remove behavior */
  onAnchorDblClick?: (id: number) => void
  /** Extra time bounds per anchor (on top of neighbor clamping) */
  getBounds?: (id: number) => { min: number; max: number }
  bands?: Band[]
  label?: string
  /** Controlled view. If omitted, Timeline manages its own. */
  view?: View
  onViewChange?: (v: View) => void
  /** Used for clamping when controlled. Defaults to duration. */
  maxDuration?: number
  /** Playhead position in seconds — rendered as a line in the track */
  playhead?: number
  /** Called when user clicks the ruler (for seek) */
  onRulerClick?: (time: number) => void
  /** Called when user clicks (not drags) an anchor */
  onAnchorClick?: (time: number) => void
  /** If set, darkens the region from this time to duration (trim preview) */
  trimAt?: number
  /** Use measure.beat.subbeat ruler instead of wall-clock time */
  musicalRuler?: boolean
  /** Beats per measure for musical ruler (default 4) */
  beatsPerMeasure?: number
  /** ID of the anchor that is the beat-zero reference */
  anchorZeroId?: number
  /** Called when user clicks the "set as beat 0" button on an anchor */
  onAnchorSetZero?: (id: number) => void
  /** Beat grid subdivision divisor: 1=quarter, 2=8th, 3=triplet, 4=16th, etc. */
  gridDiv?: number
  /** Flip layout: track on top, ruler below, label at bottom. No minimap. */
  flip?: boolean
  /** Set of currently selected anchor IDs */
  selectedIds?: Set<number>
  /** Called when selection changes (click, shift-click, ctrl-click, lasso) */
  onSelectionChange?: (ids: Set<number>) => void
  /** Clip in point — shades the region before this time */
  clipIn?: number
  /** Clip out point — shades the region after this time */
  clipOut?: number
  /** Right-click on an anchor */
  onAnchorContextMenu?: (id: number, x: number, y: number) => void
  /** Right-click on empty track space */
  onTrackContextMenu?: (time: number, x: number, y: number) => void
  /** If a click lands within this many px of an existing anchor, update that anchor instead of adding a new one. Future: expose as user setting. Default: 10 */
  mergeMarginPx?: number
  /** Clip blocks to render as shaded overlays on this track (same zoom as timeline) */
  clipOverlays?: ClipOverlay[]
  /** Called when the user clicks a clip overlay */
  onClipOverlaySelect?: (id: string) => void
  /** Called when the user draws a new clip by dragging on empty track space */
  onClipOverlayCreate?: (inPoint: number, outPoint: number) => void
  /** Called while the user resizes a clip overlay edge */
  onClipOverlayResize?: (id: string, inPoint: number, outPoint: number) => void
  /** Called while the user drags a clip overlay by its handle bar */
  onClipOverlayMove?: (id: string, inPoint: number, outPoint: number) => void
  /** Right-click on a clip overlay bar */
  onClipOverlayContextMenu?: (id: string, x: number, y: number) => void
  /** Double-click on clip bar — caller handles zoom toggle. If not provided, zooms directly. */
  onClipOverlayZoom?: (id: string) => void
  /** Only render beat grid lines within this time range */
  beatRangeStart?: number
  beatRangeEnd?: number
  /** When true, clicking empty track space seeks instead of placing a marker */
  scrubOnTrackClick?: boolean
  /** Called when scrubbing on the track body (requires scrubOnTrackClick) */
  onTrackScrub?: (time: number) => void
  /** IDs of anchors that are linked to clip boundaries — rendered with a distinct style */
  boundaryAnchorIds?: Set<number>
  /** Color (CSS color string) used for boundary anchor handles/lines. Defaults to blue. */
  boundaryColor?: string
  /** IDs of anchors whose beat position matches orig (unmanually adjusted) — shown with link indicator */
  linkedAnchorIds?: Set<number>
  /** IDs of anchors to dim (outside active region) */
  dimmedAnchorIds?: Set<number>
  /** When false, selection uses a dimmer highlight (selected from the other timeline) */
  primarySelection?: boolean
  /** Extra snap targets for clip resize (e.g. identity boundary positions) */
  clipResizeSnapTargets?: number[]
  /** When true, clip resize skips beat-grid snapping (smooth drag) */
  clipResizeNoGridSnap?: boolean
  /** Regions to show as colored bars in the minimap */
  minimapRegions?: ClipOverlay[]
  /** Extra content rendered directly below the ruler (between ruler and track in
   *  non-flipped mode; between ruler and label in flipped mode). */
  belowRulerContent?: React.ReactNode
  /** Times (seconds) at which to draw hairline dashed vertical guide lines
   *  spanning the body of the timeline (track + ruler + belowRulerContent). */
  throughlines?: number[]
  /** If provided, only throughlines whose time is in this set are shown; others
   *  fade out. Undefined = all throughlines shown (default). */
  activeThroughlines?: number[]
  /** Extra times (seconds) to snap dragged anchors to. */
  snapTargets?: number[]
  /** Fires during active drags (anchors, groups, clip overlays) with the pointer time,
   *  and with `null` when the drag ends. Used by the parent to show contextual UI. */
  onDragPositionChange?: (time: number | null) => void
  /** Per-layer labels shown on a left-side rail next to each row. */
  rowLabels?: {
    minimap?: React.ReactNode
    ruler?: React.ReactNode
    belowRuler?: React.ReactNode
    track?: React.ReactNode
  }
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

type GestureState =
  | null
  | { type: 'potential'; x: number; y: number; time: number; anchorId?: number; clipId?: string; clipInPoint?: number; clipOutPoint?: number; ctrlKey?: boolean; shiftKey?: boolean }
  | { type: 'panning'; lastX: number }
  | { type: 'anchor-drag'; id: number }
  | { type: 'group-drag'; ids: number[]; startTimes: Map<number, number>; lastX: number }
  | { type: 'lasso'; startX: number; startTime: number; currentX: number; currentTime: number }
  | { type: 'clip-create'; startTime: number; currentTime: number }
  | { type: 'clip-resize'; id: string; edge: 'left' | 'right'; inPoint: number; outPoint: number }
  | { type: 'clip-move'; id: string; startTime: number; inPoint: number; outPoint: number }
  | { type: 'scrub' }

function rulerTicks(viewStart: number, viewEnd: number) {
  const span = viewEnd - viewStart
  const targets = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120]
  const minorInterval = targets.find(t => span / t <= 60) ?? 120
  const majorEvery = 5
  const ticks: { time: number; major: boolean; label: string }[] = []
  const first = Math.ceil(viewStart / minorInterval) * minorInterval
  for (let t = first; t <= viewEnd + 1e-9; t += minorInterval) {
    const idx = Math.round(t / minorInterval)
    const major = idx % majorEvery === 0
    ticks.push({ time: t, major, label: major ? formatTime(t) : '' })
  }
  return ticks
}

type MusicalTick = { time: number; type: 'measure' | 'beat' | 'sub'; label: string }

function musicalTicks(
  viewStart: number, viewEnd: number,
  beat: number, beatOffset: number,
  beatsPerMeasure: number,
): MusicalTick[] {
  const span = viewEnd - viewStart
  const BPM = beatsPerMeasure
  const measure = beat * BPM
  const candidates = [beat / 16, beat / 8, beat / 4, beat / 2, beat, measure, measure * 2, measure * 4, measure * 8, measure * 16, measure * 32]
  // Tick marks: at most ~40 in view so subdivisions can show when zoomed in
  const interval = candidates.find(t => t > 0 && span / t <= 40) ?? candidates[candidates.length - 1]
  // Labels: at most ~10 in view — find the coarsest interval that keeps ≤10
  const labelInterval = candidates.find(t => t > 0 && t >= beat && span / t <= 10) ?? candidates[candidates.length - 1]

  const first = beatOffset + Math.ceil((viewStart - beatOffset) / interval) * interval
  const ticks: MusicalTick[] = []

  for (let t = first; t <= viewEnd + 1e-9; t += interval) {
    const rawBeat = (t - beatOffset) / beat
    const beatIdx = Math.round(rawBeat)
    const onBeat = Math.abs(rawBeat - beatIdx) < 0.01
    const beatInMeasure = ((beatIdx % BPM) + BPM) % BPM
    const onMeasure = onBeat && beatInMeasure === 0

    const m = Math.floor(beatIdx / BPM)
    const b = beatInMeasure
    const type: MusicalTick['type'] = onMeasure ? 'measure' : onBeat ? 'beat' : 'sub'

    // Show label only at labelInterval spacing (and never on sub-beats)
    const elapsed = t - beatOffset
    const showLabel = onBeat && Math.abs(elapsed - Math.round(elapsed / labelInterval) * labelInterval) < beat * 0.01
    const label = showLabel ? (onMeasure ? String(m) : `${m}.${b}`) : ''

    ticks.push({ time: t, type, label })
  }
  return ticks
}

type BeatLine = { time: number; measure: boolean; onBeat: boolean }

export default function Timeline({
  duration,
  bpm,
  anchors,
  onAnchorsChange,
  snapInterval,
  snapOffset = 0,
  snapThresholdPx = 8,
  noAdd = false,
  noRemove = false,
  onAnchorDblClick: onAnchorDblClickProp,
  getBounds,
  bands,
  label,
  view: controlledView,
  onViewChange,
  maxDuration,
  playhead,
  onRulerClick,
  onAnchorClick,
  trimAt,
  musicalRuler = false,
  beatsPerMeasure = 4,
  anchorZeroId,
  onAnchorSetZero,
  gridDiv = 1,
  flip = false,
  selectedIds,
  onSelectionChange,
  clipIn,
  clipOut,
  onAnchorContextMenu,
  onTrackContextMenu,
  mergeMarginPx = 10,
  clipOverlays,
  onClipOverlaySelect,
  onClipOverlayCreate,
  onClipOverlayResize,
  onClipOverlayMove,
  onClipOverlayContextMenu,
  onClipOverlayZoom,
  beatRangeStart,
  beatRangeEnd,
  scrubOnTrackClick = false,
  onTrackScrub,
  boundaryAnchorIds,
  boundaryColor,
  linkedAnchorIds,
  dimmedAnchorIds,
  primarySelection = true,
  clipResizeSnapTargets,
  clipResizeNoGridSnap,
  minimapRegions,
  belowRulerContent,
  throughlines,
  activeThroughlines,
  snapTargets,
  onDragPositionChange,
  rowLabels,
}: TimelineProps) {
  const [internalView, setInternalView] = useState<View>({ start: 0, end: duration })
  const isControlled = controlledView !== undefined

  const view = isControlled ? controlledView : internalView
  const clampMax = maxDuration ?? duration

  const setView = useCallback((v: View) => {
    const clamped = clampView(v.start, v.end, clampMax)
    if (isControlled) onViewChange?.(clamped)
    else setInternalView(clamped)
  }, [isControlled, onViewChange, clampMax])

  const [rulerHover, setRulerHover] = useState<number | null>(null)
  const [lassoRect, setLassoRect] = useState<{ left: number; width: number } | null>(null)

  const trackRef = useRef<HTMLDivElement>(null)
  const rulerRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<GestureState>(null)
  const anchorClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectionRef = useRef(selectedIds); selectionRef.current = selectedIds
  const minimapDrag = useRef<{ lastX: number; rect: DOMRect } | null>(null)
  const minimapRef = useRef<HTMLDivElement>(null)
  const minimapScrollTarget = useRef<number | null>(null)
  const minimapRafRef = useRef<number | null>(null)
  const viewRef = useRef(view); viewRef.current = view

  const visibleSpan = view.end - view.start
  const isZoomed = visibleSpan < clampMax - 1e-9 || view.start > 1e-9
  const canInteract = !!onAnchorsChange

  const timeToPercent = useCallback(
    (t: number) => ((t - view.start) / visibleSpan) * 100,
    [view.start, visibleSpan],
  )

  const xToTime = useCallback(
    (clientX: number) => {
      const rect = trackRef.current!.getBoundingClientRect()
      return view.start + ((clientX - rect.left) / rect.width) * visibleSpan
    },
    [view.start, visibleSpan],
  )

  /** Proximity snap for anchor drag: beat grid + clip-overlay edges + playhead + scene throughlines. */
  const trySnap = useCallback(
    (rawTime: number): number => {
      const rect = trackRef.current?.getBoundingClientRect()
      const thresholdSec = rect ? pixelsToSeconds(snapThresholdPx, rect.width, visibleSpan) : MIN_VISIBLE
      const targets: SnapTarget[] = []
      if (clipOverlays) {
        for (const c of clipOverlays) {
          targets.push({ time: c.inPoint, source: 'region-edge', id: c.id })
          targets.push({ time: c.outPoint, source: 'region-edge', id: c.id })
        }
      }
      if (playhead !== undefined) targets.push({ time: playhead, source: 'playhead' })
      if (snapTargets) {
        for (const t of snapTargets) targets.push({ time: t, source: 'scene' })
      }
      const grid = snapInterval && snapInterval > 0 ? { interval: snapInterval, offset: snapOffset } : undefined
      const { delta } = computeSnap({ subjects: [rawTime], targets, grid, thresholdSec })
      return rawTime + delta
    },
    [snapInterval, snapOffset, snapThresholdPx, visibleSpan, clipOverlays, playhead, snapTargets],
  )

  // Keep a ref to the latest zoom state so the wheel handler never goes stale
  const zoomRef = useRef({ viewStart: view.start, visibleSpan, setView })
  zoomRef.current = { viewStart: view.start, visibleSpan, setView }

  // Register a non-passive wheel listener so preventDefault() actually works in
  // Tauri's WebView2 / WebKit — React's synthetic onWheel is passive in some runtimes.
  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const { viewStart, visibleSpan: span, setView: sv } = zoomRef.current
      const rect = el.getBoundingClientRect()
      const cursorTime = viewStart + ((e.clientX - rect.left) / rect.width) * span
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15
      const newSpan = span * factor
      const ratio = (cursorTime - viewStart) / span
      const ns = cursorTime - ratio * newSpan
      sv({ start: ns, end: ns + newSpan })
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, []) // only on mount — state is accessed via zoomRef

  useEffect(() => {
    const el = minimapRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const { visibleSpan: span } = zoomRef.current
      const raw = e.deltaX !== 0 ? e.deltaX : e.deltaY
      const step = Math.sign(raw) * span * 0.15
      minimapScrollTarget.current = (minimapScrollTarget.current ?? viewRef.current.start) + step

      if (minimapRafRef.current === null) {
        const animate = () => {
          const target = minimapScrollTarget.current
          if (target === null) return
          const { viewStart, visibleSpan: sp, setView: sv } = zoomRef.current
          const diff = target - viewStart
          if (Math.abs(diff) < 0.001) {
            sv({ start: target, end: target + sp })
            minimapScrollTarget.current = null
            minimapRafRef.current = null
            return
          }
          const next = viewStart + diff * 0.2
          sv({ start: next, end: next + sp })
          minimapRafRef.current = requestAnimationFrame(animate)
        }
        minimapRafRef.current = requestAnimationFrame(animate)
      }
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => {
      el.removeEventListener('wheel', handler)
      if (minimapRafRef.current !== null) {
        cancelAnimationFrame(minimapRafRef.current)
        minimapRafRef.current = null
      }
    }
  }, [duration])

  const handleTrackPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('.anchor')) return
      // Middle mouse button → pan
      if (e.button === 1) {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        gesture.current = { type: 'panning', lastX: e.clientX }
        return
      }
      if (e.button !== 0) return
      // Clip overlay bar interaction — resize handles or move
      const barEl = target.closest<HTMLElement>('.clip-overlay__bar')
      if (barEl) {
        const overlayEl = barEl.closest<HTMLElement>('.clip-overlay')
        const id = overlayEl?.dataset.clipId
        if (id) {
          const clip = clipOverlays?.find(c => c.id === id)
          if (clip) {
            e.stopPropagation()
            e.currentTarget.setPointerCapture(e.pointerId)
            const resizeHandle = target.closest<HTMLElement>('.clip-overlay__handle')
            if (resizeHandle) {
              const edge = resizeHandle.classList.contains('clip-overlay__handle--left') ? 'left' : 'right'
              gesture.current = { type: 'clip-resize', id, edge, inPoint: clip.inPoint, outPoint: clip.outPoint }
            } else {
              // Click or drag on bar body — start as potential, resolve on move/up
              gesture.current = { type: 'potential', x: e.clientX, y: e.clientY, time: xToTime(e.clientX), clipId: id, clipInPoint: clip.inPoint, clipOutPoint: clip.outPoint }
            }
            return
          }
        }
      }
      // Clip overlay body is background — clicks pass through to track
      if (!canInteract && !scrubOnTrackClick) return
      e.currentTarget.setPointerCapture(e.pointerId)
      gesture.current = { type: 'potential', x: e.clientX, y: e.clientY, time: xToTime(e.clientX) }
    },
    [canInteract, xToTime, clipOverlays, scrubOnTrackClick],
  )

  const handleTrackPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const g = gesture.current
      if (!g) return

      if (g.type === 'anchor-drag' || g.type === 'group-drag' ||
          g.type === 'clip-move' || g.type === 'clip-resize' || g.type === 'clip-create') {
        onDragPositionChange?.(xToTime(e.clientX))
      }

      /** Build the shared target list for clip resize/move gestures.
       *  Grid is returned separately so callers can skip it (e.g. beats-locked resize). */
      const buildClipSnapInputs = (opts: { excludeClipId?: string; includeGrid: boolean; extraTargets?: number[] }) => {
        const rect = trackRef.current?.getBoundingClientRect()
        const thresholdSec = rect ? pixelsToSeconds(snapThresholdPx, rect.width, visibleSpan) : 0
        const targets: SnapTarget[] = []
        for (const a of anchors) targets.push({ time: a.time, source: 'anchor', id: a.id })
        if (clipOverlays) {
          for (const c of clipOverlays) {
            if (c.id === opts.excludeClipId) continue
            targets.push({ time: c.inPoint, source: 'region-edge', id: c.id })
            targets.push({ time: c.outPoint, source: 'region-edge', id: c.id })
          }
        }
        if (playhead !== undefined) targets.push({ time: playhead, source: 'playhead' })
        if (snapTargets) {
          for (const t of snapTargets) targets.push({ time: t, source: 'scene' })
        }
        if (opts.extraTargets) {
          for (const t of opts.extraTargets) targets.push({ time: t, source: 'custom' })
        }
        const grid = opts.includeGrid && snapInterval && snapInterval > 0
          ? { interval: snapInterval, offset: snapOffset }
          : undefined
        return { targets, grid, thresholdSec }
      }

      if (g.type === 'potential') {
        const dx = Math.abs(e.clientX - g.x)
        const dy = Math.abs(e.clientY - g.y)
        if (dx > 4 || dy > 4) {
          if (g.clipId != null && g.clipInPoint != null && g.clipOutPoint != null) {
            // Dragging a clip bar → move
            gesture.current = { type: 'clip-move', id: g.clipId, startTime: xToTime(e.clientX), inPoint: g.clipInPoint, outPoint: g.clipOutPoint }
          } else if (g.anchorId != null) {
            // Dragging an anchor — select it first if not selected, then drag
            if (onSelectionChange && !(selectionRef.current?.has(g.anchorId))) {
              onSelectionChange(new Set([g.anchorId]))
            }
            gesture.current = { type: 'anchor-drag', id: g.anchorId }
          } else if (e.shiftKey) {
            // Shift+drag = pan
            gesture.current = { type: 'panning', lastX: e.clientX }
          } else if (onSelectionChange) {
            // Drag on empty area = lasso selection
            onSelectionChange(new Set())
            const time = xToTime(e.clientX)
            gesture.current = { type: 'lasso', startX: g.x, startTime: g.time, currentX: e.clientX, currentTime: time }
            const minT = Math.min(g.time, time)
            const maxT = Math.max(g.time, time)
            setLassoRect({ left: timeToPercent(minT), width: ((maxT - minT) / visibleSpan) * 100 })
          } else {
            gesture.current = { type: 'panning', lastX: e.clientX }
          }
        }
        return
      }

      if (g.type === 'panning') {
        const rect = trackRef.current!.getBoundingClientRect()
        const delta = ((g.lastX - e.clientX) / rect.width) * visibleSpan
        setView({ start: view.start + delta, end: view.end + delta })
        gesture.current = { ...g, lastX: e.clientX }
        return
      }

      if (g.type === 'lasso') {
        const time = xToTime(e.clientX)
        gesture.current = { ...g, currentX: e.clientX, currentTime: time }
        const minT = Math.min(g.startTime, time)
        const maxT = Math.max(g.startTime, time)
        setLassoRect({ left: timeToPercent(minT), width: ((maxT - minT) / visibleSpan) * 100 })
        // Live-update selection to anchors within lasso range
        const ids = new Set(anchors.filter(a => a.time >= minT && a.time <= maxT).map(a => a.id))
        onSelectionChange?.(ids)
        return
      }

      if (g.type === 'anchor-drag') {
        // Clamp between neighbours so anchors can't cross
        const EPSILON = 0.001
        const sorted = [...anchors].sort((a, b) => a.time - b.time)
        const idx = sorted.findIndex(a => a.id === g.id)
        const neighborMin = idx > 0 ? sorted[idx - 1].time + EPSILON : 0
        const neighborMax = idx < sorted.length - 1 ? sorted[idx + 1].time - EPSILON : duration
        const extra = getBounds?.(g.id)
        const minTime = Math.max(neighborMin, extra?.min ?? 0)
        const maxTime = Math.min(neighborMax, extra?.max ?? duration)

        const clamped = Math.max(minTime, Math.min(maxTime, xToTime(e.clientX)))
        const time = Math.max(minTime, Math.min(maxTime, trySnap(clamped)))
        onAnchorsChange?.(anchors.map(a => a.id === g.id ? { ...a, time } : a))
        return
      }

      if (g.type === 'group-drag') {
        const rect = trackRef.current!.getBoundingClientRect()
        const deltaTime = ((e.clientX - g.lastX) / rect.width) * visibleSpan
        if (Math.abs(deltaTime) < 0.0001) return
        // Move all selected anchors by the same time delta
        const sorted = [...anchors].sort((a, b) => a.time - b.time)
        const dragIds = new Set(g.ids)
        // Check bounds: no selected anchor should cross a non-selected neighbor
        let clampedDelta = deltaTime
        for (const id of g.ids) {
          const idx = sorted.findIndex(a => a.id === id)
          const startTime = g.startTimes.get(id)!
          const newTime = startTime + (deltaTime)
          // Clamp against previous non-selected
          for (let j = idx - 1; j >= 0; j--) {
            if (!dragIds.has(sorted[j].id)) {
              const minT = sorted[j].time + 0.001
              if (newTime < minT) clampedDelta = Math.max(clampedDelta, minT - startTime)
              break
            }
          }
          // Clamp against next non-selected
          for (let j = idx + 1; j < sorted.length; j++) {
            if (!dragIds.has(sorted[j].id)) {
              const maxT = sorted[j].time - 0.001
              if (newTime > maxT) clampedDelta = Math.min(clampedDelta, maxT - startTime)
              break
            }
          }
        }
        // Also clamp to [0, duration]
        for (const id of g.ids) {
          const startTime = g.startTimes.get(id)!
          clampedDelta = Math.max(clampedDelta, -startTime)
          clampedDelta = Math.min(clampedDelta, duration - startTime)
        }
        const updated = anchors.map(a => {
          if (!dragIds.has(a.id)) return a
          return { ...a, time: g.startTimes.get(a.id)! + clampedDelta }
        })
        onAnchorsChange?.(updated)
        return
      }

      if (g.type === 'clip-create') {
        const time = xToTime(e.clientX)
        gesture.current = { ...g, currentTime: time }

        return
      }

      if (g.type === 'clip-resize') {
        const raw = xToTime(e.clientX)
        const { targets, grid, thresholdSec } = buildClipSnapInputs({
          excludeClipId: g.id,
          includeGrid: !clipResizeNoGridSnap,
          extraTargets: clipResizeSnapTargets,
        })
        const { delta } = computeSnap({ subjects: [raw], targets, grid, thresholdSec })
        const snapped = raw + delta
        if (g.edge === 'left') {
          const inPoint = Math.min(snapped, g.outPoint - 0.1)
          gesture.current = { ...g, inPoint }
          onClipOverlayResize?.(g.id, inPoint, g.outPoint)
        } else {
          const outPoint = Math.max(snapped, g.inPoint + 0.1)
          gesture.current = { ...g, outPoint }
          onClipOverlayResize?.(g.id, g.inPoint, outPoint)
        }
        return
      }

      if (g.type === 'clip-move') {
        const time = xToTime(e.clientX)
        const dragDelta = time - g.startTime
        const span = g.outPoint - g.inPoint
        let newIn = Math.max(0, Math.min(duration - span, g.inPoint + dragDelta))
        const { targets, grid, thresholdSec } = buildClipSnapInputs({ excludeClipId: g.id, includeGrid: true })
        // Rigid move: both edges are snap subjects, grid is evaluated per-subject.
        const { delta } = computeSnap({
          subjects: [newIn, newIn + span],
          targets,
          grid,
          thresholdSec,
        })
        newIn = Math.max(0, Math.min(duration - span, newIn + delta))
        const newOut = newIn + span
        onClipOverlayMove?.(g.id, newIn, newOut)
        return
      }

      if (g.type === 'scrub') {
        onTrackScrub?.(Math.max(0, Math.min(duration, xToTime(e.clientX))))
        return
      }
    },
    [view, visibleSpan, duration, xToTime, trySnap, setView, anchors, onAnchorsChange, getBounds, onSelectionChange, timeToPercent, onClipOverlayCreate, onClipOverlayResize, onClipOverlayMove, onTrackScrub, scrubOnTrackClick, clipOverlays, snapThresholdPx, onDragPositionChange],
  )

  const handleTrackPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const g = gesture.current
      gesture.current = null
      setLassoRect(null)
      onDragPositionChange?.(null)

      if (g?.type === 'potential') {
        if (g.clipId != null) {
          // Click on clip bar (no drag) → select the clip
          onClipOverlaySelect?.(g.clipId)
        } else if (g.anchorId != null) {
          // Anchor click — handle selection
          const sel = selectionRef.current ?? new Set<number>()
          if (g.ctrlKey) {
            const next = new Set(sel)
            if (next.has(g.anchorId)) next.delete(g.anchorId)
            else next.add(g.anchorId)
            onSelectionChange?.(next)
          } else if (g.shiftKey) {
            const sorted = [...anchors].sort((a, b) => a.time - b.time)
            const clickedIdx = sorted.findIndex(a => a.id === g.anchorId)
            let startIdx = clickedIdx
            for (let i = 0; i < sorted.length; i++) {
              if (sel.has(sorted[i].id)) { startIdx = i; break }
            }
            const lo = Math.min(startIdx, clickedIdx)
            const hi = Math.max(startIdx, clickedIdx)
            const next = new Set(sel)
            for (let i = lo; i <= hi; i++) next.add(sorted[i].id)
            onSelectionChange?.(next)
          } else {
            onSelectionChange?.(new Set([g.anchorId]))
          }
        } else {
          // Click on empty area — deselect and seek
          const sel = selectionRef.current
          if (sel && sel.size > 0) {
            onSelectionChange?.(new Set())
          }
          onTrackScrub?.(Math.max(0, Math.min(duration, g.time)))
        }
        return
      }

      if (g?.type === 'lasso') {
        return
      }

      if (g?.type === 'group-drag') {
        return
      }

      if (g?.type === 'clip-create') {

        const start = Math.min(g.startTime, g.currentTime)
        const end = Math.max(g.startTime, g.currentTime)
        if (end - start >= 0.1) {
          onClipOverlayCreate?.(start, end)
        }
        return
      }

      if (g?.type === 'clip-resize') {
        // Already committed live during move
        return
      }

      if (g?.type === 'clip-move') {
        // Already committed live during move
        return
      }

      if (g?.type === 'scrub') {
        return
      }
    },
    [noAdd, canInteract, duration, anchors, onAnchorsChange, onSelectionChange, mergeMarginPx, visibleSpan, scrubOnTrackClick, onTrackScrub, onClipOverlayCreate, onClipOverlaySelect, onDragPositionChange],
  )

  const handleAnchorPointerDown = useCallback(
    (e: React.PointerEvent, anchor: Anchor) => {
      if (!canInteract) return
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)

      const sel = selectionRef.current ?? new Set<number>()

      // If this anchor is part of a multi-selection, prepare for group drag
      if (sel.has(anchor.id) && sel.size > 1) {
        const ids = [...sel]
        const startTimes = new Map(ids.map(id => {
          const a = anchors.find(a => a.id === id)
          return [id, a?.time ?? 0]
        }))
        gesture.current = { type: 'group-drag', ids, startTimes, lastX: e.clientX }
      } else {
        // Single anchor drag — record click details for potential selection handling on up
        gesture.current = { type: 'potential', x: e.clientX, y: e.clientY, time: anchor.time, anchorId: anchor.id, ctrlKey: e.ctrlKey || e.metaKey, shiftKey: e.shiftKey }
      }
    },
    [canInteract, anchors],
  )

  const handleAnchorDblClick = useCallback(
    (e: React.MouseEvent, id: number) => {
      e.stopPropagation()
      // Cancel any pending seek from the first click of this double-click
      if (anchorClickTimer.current) {
        clearTimeout(anchorClickTimer.current)
        anchorClickTimer.current = null
      }
      if (onAnchorDblClickProp) {
        onAnchorDblClickProp(id)
      } else if (!noRemove) {
        onAnchorsChange?.(anchors.filter(a => a.id !== id))
      }
    },
    [onAnchorDblClickProp, noRemove, anchors, onAnchorsChange],
  )

  const seekFromRuler = useCallback((clientX: number) => {
    if (!onRulerClick || !rulerRef.current) return
    const rect = rulerRef.current.getBoundingClientRect()
    const t = view.start + ((clientX - rect.left) / rect.width) * visibleSpan
    onRulerClick(Math.max(0, Math.min(duration, t)))
  }, [onRulerClick, view.start, visibleSpan, duration])

  const handleRulerPointerDown = useCallback((e: React.PointerEvent) => {
    if (!onRulerClick) return
    e.currentTarget.setPointerCapture(e.pointerId)
    seekFromRuler(e.clientX)
  }, [onRulerClick, seekFromRuler])

  const handleRulerPointerMove = useCallback((e: React.PointerEvent) => {
    if (!e.buttons) return
    seekFromRuler(e.clientX)
  }, [seekFromRuler])

  const beat = bpm && bpm > 0 ? 60 / bpm : 0

  const ticks = musicalRuler && beat > 0
    ? musicalTicks(view.start, view.end, beat, snapOffset, beatsPerMeasure)
    : rulerTicks(view.start, view.end)

  const beatOpacity = beatGridOpacity(view, bpm ?? 0)

  const beatLines: BeatLine[] = []
  if (beat > 0 && beatOpacity > 0) {
    const gridInterval = beat / gridDiv
    const first = snapOffset + Math.ceil((view.start - snapOffset) / gridInterval) * gridInterval
    for (let t = first; t <= view.end + 1e-9; t += gridInterval) {
      if (beatRangeStart !== undefined && t < beatRangeStart - 1e-9) continue
      if (beatRangeEnd   !== undefined && t > beatRangeEnd   + 1e-9) continue
      const rawBeat = (t - snapOffset) / beat
      const beatIdx = Math.round(rawBeat * gridDiv)
      const onBeat = beatIdx % gridDiv === 0
      const beatInMeasure = ((Math.round(rawBeat) % beatsPerMeasure) + beatsPerMeasure) % beatsPerMeasure
      beatLines.push({ time: t, measure: onBeat && beatInMeasure === 0, onBeat })
    }
  }

  const visibleBands = bands?.map(b => ({
    left: timeToPercent((b.left / 100) * duration),
    width: (((b.right - b.left) / 100) * duration / visibleSpan) * 100,
    stretchRatio: b.stretchRatio,
  }))

  const labelEl = label ? <div className="timeline-label">{label}</div> : null

  const rulerEl = (
      <div
        ref={rulerRef}
        className={`ruler${onRulerClick ? ' ruler--clickable' : ''}`}
        onPointerDown={handleRulerPointerDown}
        onPointerMove={e => {
          handleRulerPointerMove(e)
          if (onRulerClick && rulerRef.current) {
            const rect = rulerRef.current.getBoundingClientRect()
            const t = view.start + ((e.clientX - rect.left) / rect.width) * visibleSpan
            setRulerHover(Math.max(0, Math.min(duration, t)))
          }
        }}
        onMouseLeave={() => setRulerHover(null)}
      >
        {ticks.map((tick) => {
          const major = 'major' in tick ? tick.major : tick.type === 'measure'
          const isSub = 'type' in tick && tick.type === 'sub'
          const outsideClip = (clipIn !== undefined && tick.time < clipIn - 0.01) || (clipOut !== undefined && tick.time > clipOut + 0.01)
          return (
            <div
              key={`t-${tick.time}`}
              className={`tick ${major ? 'tick--major' : isSub ? 'tick--sub' : 'tick--minor'}${outsideClip ? ' tick--dimmed' : ''}`}
              style={{ left: `${timeToPercent(tick.time)}%` }}
            >
              {tick.label && <span className="tick-label">{tick.label}</span>}
            </div>
          )
        })}
        {rulerHover !== null && (
          <div className="playhead-ghost" style={{ left: `${timeToPercent(rulerHover)}%` }} />
        )}
      </div>
  )

  const trackEl = (
      <div
        ref={trackRef}
        className={`track${isZoomed ? ' track--zoomed' : ''}${!canInteract ? ' track--readonly' : ''}`}
        style={{ '--beat-opacity': beatOpacity } as React.CSSProperties}
        onPointerDown={handleTrackPointerDown}
        onPointerMove={handleTrackPointerMove}
        onPointerUp={handleTrackPointerUp}
        onPointerLeave={handleTrackPointerUp}
        onDoubleClick={e => {
          if ((e.target as HTMLElement).closest('.anchor')) return
          const rect = trackRef.current!.getBoundingClientRect()
          const time = Math.max(0, Math.min(duration, view.start + ((e.clientX - rect.left) / rect.width) * visibleSpan))
          // If click is in the bar area (top 14px) of a clip overlay → zoom to that clip
          if (!flip && clipOverlays) {
            const clickY = e.clientY - rect.top
            const hit = clickY <= 14 ? clipOverlays.find(c => time >= c.inPoint && time <= c.outPoint) : null
            if (hit) {
              if (onClipOverlayZoom) onClipOverlayZoom(hit.id)
              else setView({ start: hit.inPoint, end: hit.outPoint })
              return
            }
          }
          if (noAdd || !canInteract) return
          const marginSec = (mergeMarginPx / rect.width) * visibleSpan
          const nearby = anchors.reduce<{ anchor: Anchor; dist: number } | null>((best, a) => {
            const dist = Math.abs(a.time - time)
            if (dist <= marginSec && (!best || dist < best.dist)) return { anchor: a, dist }
            return best
          }, null)
          if (nearby) {
            onAnchorsChange?.(anchors.map(a => a.id === nearby.anchor.id ? { ...a, time } : a))
          } else {
            onAnchorsChange?.([...anchors, { id: newAnchorId(), time }])
          }
        }}
        onContextMenu={e => {
          if ((e.target as HTMLElement).closest('.anchor')) return
          e.preventDefault()
          if (!onTrackContextMenu) return
          const rect = trackRef.current!.getBoundingClientRect()
          const time = view.start + ((e.clientX - rect.left) / rect.width) * visibleSpan
          onTrackContextMenu(Math.max(0, Math.min(duration, time)), e.clientX, e.clientY)
        }}
      >
        {/* Clip out-of-range overlays */}
        {clipIn !== undefined && clipIn > view.start && (
          <div
            className="clip-out-of-range"
            style={{ left: 0, width: `${timeToPercent(clipIn)}%` }}
          />
        )}
        {clipOut !== undefined && clipOut < duration && (
          <div
            className="clip-out-of-range"
            style={{ left: `${timeToPercent(clipOut)}%`, right: 0 }}
          />
        )}

        {visibleBands?.map((b, i) => (
          <div
            key={i}
            className="track-band"
            style={{
              left: `${b.left}%`,
              width: `${b.width}%`,
              background: stretchColor(b.stretchRatio),
            }}
          />
        ))}

        {trimAt !== undefined && trimAt < duration && (
          <div
            className="track-trim"
            style={{
              left: `${timeToPercent(trimAt)}%`,
              width: `${((duration - trimAt) / visibleSpan) * 100}%`,
            }}
          />
        )}

        {/* Clip overlays — subtle shaded blocks with interactive handle at top */}
        {clipOverlays && clipOverlays.map(clip => {
          const left = Math.max(0, timeToPercent(clip.inPoint))
          const right = Math.min(100, timeToPercent(clip.outPoint))
          const width = right - left
          if (width <= 0) return null
          return (
            <div
              key={clip.id}
              data-clip-id={clip.id}
              className={`clip-overlay${clip.active ? ' clip-overlay--active' : ''} clip-overlay--color-${(clip.colorIndex ?? 0) % 8}`}
              style={{ left: `${left}%`, width: `${width}%` }}
            >
              {/* Handle bar — solid on top timeline; edge-grips-only on flipped */}
              <div
                className={`clip-overlay__bar${flip ? ' clip-overlay__bar--flip' : ''}`}
                onDoubleClick={e => {
                  e.stopPropagation()
                  if (onClipOverlayZoom) onClipOverlayZoom(clip.id)
                  else setView({ start: clip.inPoint, end: clip.outPoint })
                }}
                onContextMenu={onClipOverlayContextMenu ? e => {
                  e.preventDefault()
                  e.stopPropagation()
                  onClipOverlayContextMenu(clip.id, e.clientX, e.clientY)
                } : undefined}
              >
                <div className="clip-overlay__handle clip-overlay__handle--left" />
                {flip ? <div className="clip-overlay__bar-spacer" /> : <span className="clip-overlay__label">{clip.name}</span>}
                <div className="clip-overlay__handle clip-overlay__handle--right" />
              </div>
            </div>
          )
        })}

        {beatLines.map(({ time, measure, onBeat }) => {
          const outsideClip = (clipIn !== undefined && time < clipIn - 0.01) || (clipOut !== undefined && time > clipOut + 0.01)
          const base = measure ? 'measure-line' : onBeat ? 'beat-line' : 'sub-beat-line'
          return (
            <div
              key={`bl-${time}`}
              className={`${base}${outsideClip ? ' beat-dimmed' : ''}`}
              style={{ left: `${timeToPercent(time)}%` }}
            />
          )
        })}

        {rulerHover !== null && onRulerClick && (
          <div className="playhead-ghost" style={{ left: `${timeToPercent(rulerHover)}%` }} />
        )}

        {anchors.map(anchor => {
          const isSelected = selectedIds?.has(anchor.id) ?? false
          const isBoundary = boundaryAnchorIds?.has(anchor.id) ?? false
          const isLinked = linkedAnchorIds?.has(anchor.id) ?? false
          const isDimmed = dimmedAnchorIds?.has(anchor.id) ?? false
          return (
          <div
            key={`a-${anchor.id}`}
            className={`anchor${anchorZeroId === anchor.id ? ' anchor--zero' : ''}${isSelected ? (primarySelection ? ' anchor--selected' : ' anchor--selected-secondary') : ''}${isBoundary ? ' anchor--boundary' : ''}${isLinked ? ' anchor--linked' : ''}${isDimmed ? ' anchor--dimmed' : ''}`}
            style={{
              left: `${timeToPercent(anchor.time)}%`,
              ...(isBoundary && boundaryColor ? ({ ['--boundary-color' as string]: boundaryColor } as React.CSSProperties) : {}),
            }}
            onPointerDown={e => handleAnchorPointerDown(e, anchor)}
            onDoubleClick={e => handleAnchorDblClick(e, anchor.id)}
            onContextMenu={e => {
              e.preventDefault()
              e.stopPropagation()
              onAnchorContextMenu?.(anchor.id, e.clientX, e.clientY)
            }}
            onClick={e => {
              e.stopPropagation()
              if (!onAnchorClick) return
              // Delay seek so a double-click can cancel it before it fires
              if (anchorClickTimer.current) clearTimeout(anchorClickTimer.current)
              const t = anchor.time
              anchorClickTimer.current = setTimeout(() => {
                anchorClickTimer.current = null
                onAnchorClick(t)
              }, 220)
            }}
          >
            {onAnchorSetZero && (
              <button
                className={`anchor-zero-btn${anchorZeroId === anchor.id ? ' anchor-zero-btn--active' : ''}`}
                onPointerDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); onAnchorSetZero(anchor.id) }}
                title={anchorZeroId === anchor.id ? 'Remove beat zero' : 'Set as beat zero'}
              >
                0
              </button>
            )}
            <div className="anchor-handle" />
            <div className="anchor-line" />
            <div className="anchor-time">{formatTime(anchor.time)}</div>
          </div>
          )
        })}

        {lassoRect && (
          <div
            className="lasso-rect"
            style={{ left: `${lassoRect.left}%`, width: `${lassoRect.width}%` }}
          />
        )}

        {!noAdd && canInteract && anchors.length === 0 && (
          <div className="track-hint">Click to place anchors · scroll to zoom · middle-click to pan</div>
        )}
        {noAdd && anchors.length === 0 && (
          <div className="track-hint">Drag anchors to assign beats</div>
        )}
      </div>
  )

  const minimapEl = (
      <div
        className="minimap"
        style={{ cursor: 'ew-resize' }}
        onPointerDown={e => {
          e.stopPropagation()
          const rect = e.currentTarget.getBoundingClientRect()
          e.currentTarget.setPointerCapture(e.pointerId)
          // Jump to clicked position (center view on it) then drag from there
          const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration
          const half = visibleSpan / 2
          setView({ start: t - half, end: t + half })
          minimapDrag.current = { lastX: e.clientX, rect }
        }}
        onPointerMove={e => {
          const g = minimapDrag.current
          if (!g || !e.buttons) return
          const v = viewRef.current
          // drag right → viewport moves right (positive delta)
          const delta = ((e.clientX - g.lastX) / g.rect.width) * duration
          setView({ start: v.start + delta, end: v.end + delta })
          minimapDrag.current = { ...g, lastX: e.clientX }
        }}
        onPointerUp={() => { minimapDrag.current = null }}
        onPointerLeave={() => {
          minimapDrag.current = null
          minimapScrollTarget.current = null
          if (minimapRafRef.current !== null) {
            cancelAnimationFrame(minimapRafRef.current)
            minimapRafRef.current = null
          }
        }}
        ref={minimapRef}
      >
        {minimapRegions?.map(region => (
          <div
            key={region.id}
            className={`minimap-region clip-overlay--color-${(region.colorIndex ?? 0) % 8}${region.active ? ' minimap-region--active' : ''}`}
            style={{
              left: `${(region.inPoint / duration) * 100}%`,
              width: `${((region.outPoint - region.inPoint) / duration) * 100}%`,
            }}
          />
        ))}
        {anchors.map(anchor => (
          <div
            key={anchor.id}
            className="minimap-anchor"
            style={{ left: `${(anchor.time / duration) * 100}%` }}
          />
        ))}
        {(() => {
          const leftPct = Math.max(0, (view.start / duration) * 100)
          const rightPct = Math.min(100, (view.end / duration) * 100)
          const widthPct = Math.max(0, rightPct - leftPct)
          return (
            <div
              className={`minimap-viewport${visibleSpan >= duration - 0.001 ? ' minimap-viewport--full' : ''}`}
              style={{
                left: `${leftPct}%`,
                width: `${widthPct}%`,
              }}
            />
          )
        })()}
      </div>
  )

  const playheadOverlay = playhead !== undefined ? (
    <div className="timeline__playhead-overlay">
      <div className="playhead" style={{ left: `${timeToPercent(playhead)}%` }} />
    </div>
  ) : null

  const activeSet = activeThroughlines ? new Set(activeThroughlines) : null
  const throughlineOverlay = throughlines && throughlines.length > 0 ? (
    <div className={`timeline__throughlines${activeSet ? ' timeline__throughlines--gated' : ''}`}>
      {throughlines.map((t) => {
        const x = timeToPercent(t)
        if (x < -1 || x > 101) return null
        const active = activeSet ? activeSet.has(t) : true
        return (
          <div
            key={t}
            className={`timeline__throughline${active ? ' timeline__throughline--active' : ''}`}
            style={{ left: `${x}%` }}
          />
        )
      })}
    </div>
  ) : null

  const row = (railContent: React.ReactNode, bodyContent: React.ReactNode, modifier: string) => (
    <div className={`timeline__row timeline__row--${modifier}`}>
      <div className={`timeline__rail-cell timeline__rail-cell--${modifier}`}>
        {railContent ?? null}
      </div>
      {bodyContent}
    </div>
  )

  return (
    <div className={`timeline${flip ? ' timeline--flip' : ''}`}>
      {labelEl}
      {!flip && row(rowLabels?.minimap, minimapEl, 'minimap')}
      {flip ? (
        <>
          {row(rowLabels?.track, trackEl, 'track')}
          {row(rowLabels?.ruler, rulerEl, 'ruler')}
          {belowRulerContent !== undefined && row(rowLabels?.belowRuler, belowRulerContent, 'below')}
        </>
      ) : (
        <>
          {row(rowLabels?.ruler, rulerEl, 'ruler')}
          {belowRulerContent !== undefined && row(rowLabels?.belowRuler, belowRulerContent, 'below')}
          {row(rowLabels?.track, trackEl, 'track')}
        </>
      )}
      {throughlineOverlay}
      {playheadOverlay}
    </div>
  )
}
