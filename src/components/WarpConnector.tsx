import { forwardRef } from 'react'
import type { WarpSegment, View } from '../types'
import { stretchColor } from '../utils/quantize'
import { timeToViewPct } from '../utils/view'
import './WarpConnector.css'

interface WarpConnectorProps {
  segments: WarpSegment[]
  view: View
  origDuration: number
  outputDuration: number
  /** Clip in/out — draws shaded overlays and boundary lines when set */
  clipIn?: number
  clipOut?: number
}

/** Convert a full-duration percentage to view-space percentage */
function toView(pct: number, totalDuration: number, view: View): number {
  return timeToViewPct((pct / 100) * totalDuration, view)
}

const WarpConnector = forwardRef<HTMLDivElement, WarpConnectorProps>(
  function WarpConnector({ segments, view, origDuration, outputDuration, clipIn, clipOut }, ref) {
    if (segments.length === 0) {
      return <div ref={ref} className="warp-connector warp-connector--empty" />
    }

    return (
      <div ref={ref} className="warp-connector">
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
            return (
              <line
                key={i}
                x1={oX} y1={0} x2={qX} y2={1}
                stroke="rgba(255,240,220,0.15)"
                strokeWidth="0.4"
                vectorEffect="non-scaling-stroke"
              />
            )
          })}
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
      </div>
    )
  }
)

export default WarpConnector
