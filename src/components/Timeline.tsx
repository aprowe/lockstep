import { useCallback, useEffect, useRef, useState } from 'react'
import type { Anchor, Band, View } from '../types'
import { stretchColor } from '../utils/quantize'
import { clampView, MIN_VISIBLE, beatGridOpacity } from '../utils/view'
import { formatTime } from '../utils/time'
import './Timeline.css'

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
  /** When set, draws a loop-start marker at this time and shades the pre region */
  loopStartAt?: number
  /** Start of the pre-beat shade (defaults to 0 if omitted) */
  loopPreStart?: number
  /** When set, draws a loop-end line and shades the region after it */
  loopEndAt?: number
  /** When set, draws a ghost/preview region (e.g. pre-beat section appended at end) */
  ghostRegion?: { start: number; end: number }
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
}

type GestureState =
  | null
  | { type: 'potential'; x: number; y: number; time: number; anchorId?: number; ctrlKey?: boolean; shiftKey?: boolean }
  | { type: 'panning'; lastX: number }
  | { type: 'anchor-drag'; id: number }
  | { type: 'group-drag'; ids: number[]; startTimes: Map<number, number>; lastX: number }
  | { type: 'lasso'; startX: number; startTime: number; currentX: number; currentTime: number }

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
): MusicalTick[] {
  const span = viewEnd - viewStart
  const BPM = 4
  const measure = beat * BPM
  const candidates = [beat, measure, measure * 2, measure * 4, measure * 8]
  const interval = candidates.find(t => t > 0 && span / t <= 64) ?? candidates[candidates.length - 1]

  const first = beatOffset + Math.ceil((viewStart - beatOffset) / interval) * interval
  const ticks: MusicalTick[] = []

  for (let t = first; t <= viewEnd + 1e-9; t += interval) {
    const rawBeat = (t - beatOffset) / beat
    const beatIdx = Math.round(rawBeat)
    const beatInMeasure = ((beatIdx % BPM) + BPM) % BPM
    const onMeasure = beatInMeasure === 0

    const m = Math.floor(beatIdx / BPM)
    const b = beatInMeasure
    const type: MusicalTick['type'] = onMeasure ? 'measure' : 'beat'
    const label = onMeasure ? String(m) : `${m}.${b}`

    ticks.push({ time: t, type, label })
  }
  return ticks
}

type BeatLine = { time: number; measure: boolean; onBeat: boolean }

let nextId = 1
export function newAnchorId() { return nextId++ }

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
  anchorZeroId,
  onAnchorSetZero,
  loopStartAt,
  loopPreStart,
  loopEndAt,
  ghostRegion,
  gridDiv = 1,
  flip = false,
  selectedIds,
  onSelectionChange,
  clipIn,
  clipOut,
  onAnchorContextMenu,
  onTrackContextMenu,
  mergeMarginPx = 10,
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

  /** Proximity snap: only snaps if within snapThresholdPx of a beat */
  const trySnap = useCallback(
    (rawTime: number): number => {
      if (!snapInterval || snapInterval <= 0) return rawTime
      const nearest = snapOffset + Math.round((rawTime - snapOffset) / snapInterval) * snapInterval
      const rect = trackRef.current?.getBoundingClientRect()
      const thresholdSec = rect ? (snapThresholdPx / rect.width) * visibleSpan : MIN_VISIBLE
      return Math.abs(rawTime - nearest) <= thresholdSec ? nearest : rawTime
    },
    [snapInterval, snapOffset, snapThresholdPx, visibleSpan],
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
      if (!e.shiftKey) return
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

  const handleTrackPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!canInteract) return
      if ((e.target as HTMLElement).closest('.anchor')) return
      if (e.button !== 0) return
      e.currentTarget.setPointerCapture(e.pointerId)
      gesture.current = { type: 'potential', x: e.clientX, y: e.clientY, time: xToTime(e.clientX) }
    },
    [canInteract, xToTime],
  )

  const handleTrackPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const g = gesture.current
      if (!g) return

      if (g.type === 'potential') {
        const dx = Math.abs(e.clientX - g.x)
        const dy = Math.abs(e.clientY - g.y)
        if (dx > 4 || dy > 4) {
          if (g.anchorId != null) {
            // Dragging an anchor — select it first if not selected, then drag
            if (onSelectionChange && !(selectionRef.current?.has(g.anchorId))) {
              onSelectionChange(new Set([g.anchorId]))
            }
            gesture.current = { type: 'anchor-drag', id: g.anchorId }
          } else if (e.shiftKey) {
            // Shift+drag = pan
            gesture.current = { type: 'panning', lastX: e.clientX }
          } else if (onSelectionChange) {
            // Non-shift drag on empty area = lasso selection
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
      }
    },
    [view, visibleSpan, duration, xToTime, trySnap, setView, anchors, onAnchorsChange, getBounds, onSelectionChange, timeToPercent],
  )

  const handleTrackPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const g = gesture.current
      gesture.current = null
      setLassoRect(null)

      if (g?.type === 'potential') {
        if (g.anchorId != null) {
          // Anchor click — handle selection
          const sel = selectionRef.current ?? new Set<number>()
          if (g.ctrlKey) {
            // Ctrl+click: toggle
            const next = new Set(sel)
            if (next.has(g.anchorId)) next.delete(g.anchorId)
            else next.add(g.anchorId)
            onSelectionChange?.(next)
          } else if (g.shiftKey) {
            // Shift+click: range select from last to this
            const sorted = [...anchors].sort((a, b) => a.time - b.time)
            const clickedIdx = sorted.findIndex(a => a.id === g.anchorId)
            // Find the index of the first currently selected anchor for range
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
            // Plain click: select only this anchor
            onSelectionChange?.(new Set([g.anchorId]))
          }
        } else {
          // Click on empty area
          const sel = selectionRef.current
          if (sel && sel.size > 0) {
            // Has selection — just deselect, don't place marker
            onSelectionChange?.(new Set())
          } else if (!noAdd) {
            // No selection — place or update a marker
            const time = Math.max(0, Math.min(duration, g.time))
            const rect = trackRef.current?.getBoundingClientRect()
            const marginSec = rect ? (mergeMarginPx / rect.width) * visibleSpan : 0
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
          }
        }
        return
      }

      if (g?.type === 'lasso') {
        // Selection was already updated during move; just clear the visual
        return
      }

      if (g?.type === 'group-drag') {
        // Commit the drag — anchors are already updated during move
        return
      }
    },
    [noAdd, duration, anchors, onAnchorsChange, onSelectionChange, mergeMarginPx, visibleSpan],
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
    ? musicalTicks(view.start, view.end, beat, snapOffset)
    : rulerTicks(view.start, view.end)

  const beatOpacity = beatGridOpacity(view, bpm ?? 0)

  const beatLines: BeatLine[] = []
  if (beat > 0 && beatOpacity > 0) {
    const BPM = 4
    const gridInterval = beat / gridDiv
    const first = snapOffset + Math.ceil((view.start - snapOffset) / gridInterval) * gridInterval
    for (let t = first; t <= view.end + 1e-9; t += gridInterval) {
      const rawBeat = (t - snapOffset) / beat
      const beatIdx = Math.round(rawBeat * gridDiv)
      const onBeat = beatIdx % gridDiv === 0
      const beatInMeasure = ((Math.round(rawBeat) % BPM) + BPM) % BPM
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
          return (
            <div
              key={`t-${tick.time}`}
              className={`tick ${major ? 'tick--major' : 'tick--minor'}`}
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
          <>
            <div
              className="clip-out-of-range"
              style={{ left: 0, width: `${timeToPercent(clipIn)}%` }}
            />
            <div
              className="clip-boundary"
              style={{ left: `${timeToPercent(clipIn)}%` }}
            />
          </>
        )}
        {clipOut !== undefined && clipOut < duration && (
          <>
            <div
              className="clip-out-of-range"
              style={{ left: `${timeToPercent(clipOut)}%`, right: 0 }}
            />
            <div
              className="clip-boundary"
              style={{ left: `${timeToPercent(clipOut)}%` }}
            />
          </>
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

        {beatLines.map(({ time, measure, onBeat }) => (
          <div
            key={`bl-${time}`}
            className={measure ? 'measure-line' : onBeat ? 'beat-line' : 'sub-beat-line'}
            style={{ left: `${timeToPercent(time)}%` }}
          />
        ))}

        {playhead !== undefined && (
          <div
            className="playhead"
            style={{ left: `${timeToPercent(playhead)}%` }}
          />
        )}

        {rulerHover !== null && onRulerClick && (
          <div className="playhead-ghost" style={{ left: `${timeToPercent(rulerHover)}%` }} />
        )}

        {loopStartAt !== undefined && loopStartAt > 0 && (() => {
          const preStartPct = loopPreStart !== undefined ? timeToPercent(loopPreStart) : 0
          const preEndPct = timeToPercent(loopStartAt)
          return (
            <>
              <div
                className="loop-pre"
                style={{ left: `${preStartPct}%`, width: `${preEndPct - preStartPct}%` }}
              />
              <div
                className="loop-start-line"
                style={{ left: `${preEndPct}%` }}
              />
            </>
          )
        })()}

        {loopEndAt !== undefined && (
          <>
            <div
              className="loop-end-shade"
              style={{
                left: `${timeToPercent(loopEndAt)}%`,
                width: `${((duration - loopEndAt) / visibleSpan) * 100}%`,
              }}
            />
            <div
              className="loop-end-line"
              style={{ left: `${timeToPercent(loopEndAt)}%` }}
            />
          </>
        )}

        {ghostRegion !== undefined && (
          <div
            className="loop-ghost"
            style={{
              left: `${timeToPercent(ghostRegion.start)}%`,
              width: `${((ghostRegion.end - ghostRegion.start) / visibleSpan) * 100}%`,
            }}
          />
        )}

        {anchors.map(anchor => {
          const isSelected = selectedIds?.has(anchor.id) ?? false
          return (
          <div
            key={`a-${anchor.id}`}
            className={`anchor${anchorZeroId === anchor.id ? ' anchor--zero' : ''}${isSelected ? ' anchor--selected' : ''}`}
            style={{ left: `${timeToPercent(anchor.time)}%` }}
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
                title={anchorZeroId === anchor.id ? 'Beat zero reference' : 'Set as beat zero'}
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
          <div className="track-hint">Click to place anchors · shift+scroll to zoom · shift+drag to pan</div>
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
        onPointerLeave={() => { minimapDrag.current = null }}
      >
        {anchors.map(anchor => (
          <div
            key={anchor.id}
            className="minimap-anchor"
            style={{ left: `${(anchor.time / duration) * 100}%` }}
          />
        ))}
        <div
          className="minimap-viewport"
          style={{
            left: `${(view.start / duration) * 100}%`,
            width: `${(visibleSpan / duration) * 100}%`,
          }}
        />
      </div>
  )

  return (
    <div className={`timeline${flip ? ' timeline--flip' : ''}`}>
      {flip ? (
        <>{trackEl}{rulerEl}{labelEl}</>
      ) : (
        <>{labelEl}{minimapEl}{rulerEl}{trackEl}</>
      )}
    </div>
  )
}
