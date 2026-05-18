import type { WarpSegment, View } from '../types'
import { stretchBarColor } from '../utils/quantize'
import { timeToViewPct } from '../utils/view'
import './SpeedStrip.css'

interface SpeedStripProps {
  segments: WarpSegment[]
  view: View
  outputDuration: number
}

function toView(pct: number, totalDuration: number, view: View): number {
  return timeToViewPct((pct / 100) * totalDuration, view)
}

export default function SpeedStrip({ segments, view, outputDuration }: SpeedStripProps) {
  if (segments.length === 0) return <div className="speed-strip speed-strip--empty" />

  return (
    <div className="speed-strip">
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 100 1"
        preserveAspectRatio="none"
      >
        {segments.map((seg, i) => {
          const qL = toView(seg.quantLeft, outputDuration, view)
          const qR = toView(seg.quantRight, outputDuration, view)
          const w = qR - qL
          if (w <= 0) return null
          return (
            <rect
              key={i}
              x={qL} y={0}
              width={w} height={1}
              fill={stretchBarColor(seg.stretchRatio)}
            />
          )
        })}
      </svg>
      {segments.map((seg, i) => {
        const qL = toView(seg.quantLeft, outputDuration, view)
        const qR = toView(seg.quantRight, outputDuration, view)
        const midX = (qL + qR) / 2
        if (midX < 0 || midX > 100) return null
        const viewSpan = qR - qL
        if (viewSpan < 2.5) return null
        return (
          <div
            key={i}
            className="speed-strip__label"
            style={{ left: `${midX}%` }}
          >
            {(seg.stretchRatio > 0 ? 1 / seg.stretchRatio : 1).toFixed(2)}×
          </div>
        )
      })}
    </div>
  )
}
