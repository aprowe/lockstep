import { useCallback, useRef, useState } from 'react'
import type { Anchor, Band, View } from '../types'
import { stretchColor } from '../utils/quantize'
import { clampView, MIN_VISIBLE } from '../utils/view'
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
  /** Flip layout: track on top, ruler below, label at bottom. No minimap. */
  flip?: boolean
}

type GestureState =
  | null
  | { type: 'potential'; x: number; y: number; time: number }
  | { type: 'panning'; lastX: number }
  | { type: 'anchor-drag'; id: number }

export function formatTime(s: number) {
  const m = Math.floor(s / 60)
  const sec = (s % 60).toFixed(2).padStart(5, '0')
  return m > 0 ? `${m}:${sec}` : `${sec}s`
}

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

type BeatLine = { time: number; measure: boolean }

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
  flip = false,
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

  const trackRef = useRef<HTMLDivElement>(null)
  const rulerRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<GestureState>(null)
  const anchorClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!e.shiftKey) return
      e.preventDefault()
      const cursorTime = xToTime(e.clientX)
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15
      const newSpan = visibleSpan * factor
      const ratio = (cursorTime - view.start) / visibleSpan
      const ns = cursorTime - ratio * newSpan
      setView({ start: ns, end: ns + newSpan })
    },
    [view.start, visibleSpan, xToTime, setView],
  )

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
        if (dx > 4 || (Math.abs(e.clientY - g.y) > 4 && e.shiftKey)) {
          gesture.current = { type: 'panning', lastX: e.clientX }
        }
        return
      }

      if (g.type === 'panning' && e.shiftKey) {
        const rect = trackRef.current!.getBoundingClientRect()
        const delta = ((g.lastX - e.clientX) / rect.width) * visibleSpan
        setView({ start: view.start + delta, end: view.end + delta })
        gesture.current = { ...g, lastX: e.clientX }
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
      }
    },
    [view, visibleSpan, duration, xToTime, trySnap, setView, anchors, onAnchorsChange, getBounds],
  )

  const handleTrackPointerUp = useCallback(
    (_e: React.PointerEvent) => {
      const g = gesture.current
      gesture.current = null
      if (g?.type === 'potential' && !noAdd) {
        const time = Math.max(0, Math.min(duration, g.time))
        onAnchorsChange?.([...anchors, { id: newAnchorId(), time }])
      }
    },
    [noAdd, duration, anchors, onAnchorsChange],
  )

  const handleAnchorPointerDown = useCallback(
    (e: React.PointerEvent, anchor: Anchor) => {
      if (!canInteract) return
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      gesture.current = { type: 'anchor-drag', id: anchor.id }
    },
    [canInteract],
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

  const beatLines: BeatLine[] = []
  if (beat > 0) {
    const BPM = 4
    const first = snapOffset + Math.ceil((view.start - snapOffset) / beat) * beat
    for (let t = first; t <= view.end + 1e-9; t += beat) {
      const rawBeat = (t - snapOffset) / beat
      const beatIdx = Math.round(rawBeat)
      const beatInMeasure = ((beatIdx % BPM) + BPM) % BPM
      beatLines.push({ time: t, measure: beatInMeasure === 0 })
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
        onPointerMove={handleRulerPointerMove}
      >
        {ticks.map((tick) => {
          const major = 'major' in tick ? tick.major : tick.type === 'measure'
          return (
            <div
              key={tick.time}
              className={`tick ${major ? 'tick--major' : 'tick--minor'}`}
              style={{ left: `${timeToPercent(tick.time)}%` }}
            >
              {tick.label && <span className="tick-label">{tick.label}</span>}
            </div>
          )
        })}
      </div>
  )

  const trackEl = (
      <div
        ref={trackRef}
        className={`track${isZoomed ? ' track--zoomed' : ''}${!canInteract ? ' track--readonly' : ''}`}
        onPointerDown={handleTrackPointerDown}
        onPointerMove={handleTrackPointerMove}
        onPointerUp={handleTrackPointerUp}
        onPointerLeave={handleTrackPointerUp}
        onWheel={handleWheel}
      >
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

        {beatLines.map(({ time, measure }) => (
          <div
            key={time}
            className={measure ? 'measure-line' : 'beat-line'}
            style={{ left: `${timeToPercent(time)}%` }}
          />
        ))}

        {playhead !== undefined && (
          <div
            className={`playhead${onRulerClick ? ' playhead--draggable' : ''}`}
            style={{ left: `${timeToPercent(playhead)}%` }}
            onPointerDown={e => {
              if (!onRulerClick) return
              e.stopPropagation()
              e.currentTarget.setPointerCapture(e.pointerId)
            }}
            onPointerMove={e => {
              if (!onRulerClick || !e.buttons) return
              const rect = trackRef.current!.getBoundingClientRect()
              const t = view.start + ((e.clientX - rect.left) / rect.width) * visibleSpan
              onRulerClick(Math.max(0, Math.min(duration, t)))
            }}
          />
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

        {anchors.map(anchor => (
          <div
            key={anchor.id}
            className={`anchor${anchorZeroId === anchor.id ? ' anchor--zero' : ''}`}
            style={{ left: `${timeToPercent(anchor.time)}%` }}
            onPointerDown={e => handleAnchorPointerDown(e, anchor)}
            onDoubleClick={e => handleAnchorDblClick(e, anchor.id)}
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
        ))}

        {!noAdd && canInteract && anchors.length === 0 && (
          <div className="track-hint">Click to place anchors · shift+scroll to zoom · shift+drag to pan</div>
        )}
        {noAdd && anchors.length === 0 && (
          <div className="track-hint">Drag anchors to assign beats</div>
        )}
      </div>
  )

  const minimapEl = (
      <div className="minimap">
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
