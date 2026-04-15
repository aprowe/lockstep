import { forwardRef, useCallback, useRef, useState } from 'react'
import type { WarpSegment, View } from '../types'
import { stretchColor } from '../utils/quantize'
import { timeToViewPct } from '../utils/view'
import './WarpConnector.css'

interface WarpConnectorProps {
  segments: WarpSegment[]
  view: View
  origDuration: number
  outputDuration: number
  /** Clip in/out in orig space — draws shaded overlays */
  clipIn?: number
  clipOut?: number
  /** Clip in/out in beat space (for slanted boundary lines) — defaults to clipIn/clipOut */
  beatClipIn?: number
  beatClipOut?: number
  /** HSL color string for clip boundary lines (e.g. "hsl(30,80%,52%)") */
  clipColor?: string
  /** For each segment boundary (length = segments.length - 1): true = anchor is unmanually-adjusted */
  linkedBoundaries?: boolean[]
  /** Anchors for lasso selection in the connector area */
  anchors?: { id: number; time: number }[]
  /** Called when lasso selection changes */
  onSelectionChange?: (ids: Set<number>) => void
}

/** Convert a full-duration percentage to view-space percentage */
function toView(pct: number, totalDuration: number, view: View): number {
  return timeToViewPct((pct / 100) * totalDuration, view)
}

const WarpConnector = forwardRef<HTMLDivElement, WarpConnectorProps>(
  function WarpConnector({ segments, view, origDuration, outputDuration, clipIn, clipOut, beatClipIn, beatClipOut, clipColor, linkedBoundaries, anchors, onSelectionChange }, ref) {
    const lassoRef = useRef<{ startX: number } | null>(null)
    const [lassoRect, setLassoRect] = useState<{ left: number; width: number } | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    const handlePointerDown = useCallback((e: React.PointerEvent) => {
      if (e.button !== 0 || e.shiftKey) return // let shift-drag pan through
      if (!onSelectionChange || !anchors) return
      e.currentTarget.setPointerCapture(e.pointerId)
      lassoRef.current = { startX: e.clientX }
      onSelectionChange(new Set())
    }, [onSelectionChange, anchors])

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
      const g = lassoRef.current
      if (!g || !containerRef.current || !anchors) return
      const rect = containerRef.current.getBoundingClientRect()
      const startPct = Math.max(0, Math.min(100, ((g.startX - rect.left) / rect.width) * 100))
      const currPct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100))
      const left = Math.min(startPct, currPct)
      const width = Math.abs(currPct - startPct)
      setLassoRect({ left, width })

      // Convert % to time and select anchors in range
      const visibleSpan = view.end - view.start
      const startTime = view.start + (left / 100) * visibleSpan
      const endTime = view.start + ((left + width) / 100) * visibleSpan
      const ids = new Set(anchors.filter(a => a.time >= startTime && a.time <= endTime).map(a => a.id))
      onSelectionChange?.(ids)
    }, [anchors, view, onSelectionChange])

    const handlePointerUp = useCallback(() => {
      lassoRef.current = null
      setLassoRect(null)
    }, [])

    if (segments.length === 0) {
      return <div ref={ref} className="warp-connector warp-connector--empty" />
    }

    // Merge refs
    const setRefs = (el: HTMLDivElement | null) => {
      (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el
      if (typeof ref === 'function') ref(el)
      else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = el
    }

    return (
      <div
        ref={setRefs}
        className="warp-connector"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 100 1"
          preserveAspectRatio="none"
        >
          {segments.map((seg, i) => {
            const oL = toView(seg.origLeft, origDuration, view)
            const oR = toView(seg.origRight, origDuration, view)
            const qL = toView(seg.quantLeft, outputDuration, view)
            const qR = toView(seg.quantRight, outputDuration, view)
            return (
              <polygon
                key={i}
                points={`${oL},0 ${oR},0 ${qR},1 ${qL},1`}
                fill={stretchColor(seg.stretchRatio)}
              />
            )
          })}

          {/* Divider lines at anchor positions */}
          {segments.slice(1).map((seg, i) => {
            const oX = toView(seg.origLeft, origDuration, view)
            const qX = toView(seg.quantLeft, outputDuration, view)
            const linked = linkedBoundaries?.[i] ?? false
            return (
              <line
                key={i}
                x1={oX} y1={0} x2={qX} y2={1}
                stroke={linked ? 'rgba(245,158,11,0.75)' : 'rgba(245,158,11,0.35)'}
                strokeWidth={linked ? '0.9' : '0.6'}
                strokeDasharray={linked ? undefined : '2 3'}
                vectorEffect="non-scaling-stroke"
              />
            )
          })}

          {/* Clip boundary lines — slanted when beat boundary differs from orig */}
          {clipIn !== undefined && (() => {
            const origX = timeToViewPct(clipIn, view)
            const beatX = timeToViewPct(beatClipIn ?? clipIn, view)
            return (origX >= -5 && origX <= 105) || (beatX >= -5 && beatX <= 105) ? (
              <line x1={origX} y1={0} x2={beatX} y2={1}
                stroke={clipColor ?? 'rgba(255,255,255,0.18)'} strokeWidth="1"
                vectorEffect="non-scaling-stroke" />
            ) : null
          })()}
          {clipOut !== undefined && clipOut < origDuration && (() => {
            const origX = timeToViewPct(clipOut, view)
            const beatX = timeToViewPct(beatClipOut ?? clipOut, view)
            return (origX >= -5 && origX <= 105) || (beatX >= -5 && beatX <= 105) ? (
              <line x1={origX} y1={0} x2={beatX} y2={1}
                stroke={clipColor ?? 'rgba(255,255,255,0.18)'} strokeWidth="1"
                vectorEffect="non-scaling-stroke" />
            ) : null
          })()}
        </svg>

        {/* Ratio labels — positioned at midpoint of each segment in view space */}
        {segments.map((seg, i) => {
          const oMid = toView((seg.origLeft + seg.origRight) / 2, origDuration, view)
          const qMid = toView((seg.quantLeft + seg.quantRight) / 2, outputDuration, view)
          const midX = (oMid + qMid) / 2
          if (midX < 0 || midX > 100) return null
          return (
            <div
              key={i}
              className="warp-connector__label"
              style={{ left: `${midX}%` }}
            >
              {seg.stretchRatio.toFixed(2)}×
            </div>
          )
        })}

        {/* Clip region shading */}
        {clipIn !== undefined && clipIn > view.start && (
          <div
            className="warp-connector__out-of-range"
            style={{ left: 0, width: `${timeToViewPct(clipIn, view)}%` }}
          />
        )}
        {clipOut !== undefined && clipOut < origDuration && (
          <div
            className="warp-connector__out-of-range"
            style={{ left: `${timeToViewPct(clipOut, view)}%`, right: 0 }}
          />
        )}
        {lassoRect && (
          <div
            className="warp-connector__lasso"
            style={{ left: `${lassoRect.left}%`, width: `${lassoRect.width}%` }}
          />
        )}
      </div>
    )
  }
)

export default WarpConnector
