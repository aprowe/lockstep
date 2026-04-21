import { forwardRef, useRef } from 'react'
import type { WarpSegment, View } from '../types'
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
  /** Semi-transparent fill color for the region quadrilateral (matches timeline clip-overlay tint) */
  clipFillColor?: string
  /** Solid color for the clip boundary lines (should match region palette). Defaults to blue via CSS. */
  boundaryColor?: string
  /** For each segment boundary (length = segments.length - 1): true = anchor is unmanually-adjusted */
  linkedBoundaries?: boolean[]
  /** For each segment boundary: true = the paired anchor is selected (intensifies the connector line). */
  selectedBoundaries?: boolean[]
  /** Label shown in the left-side rail next to the connector. */
  railLabel?: React.ReactNode
}

/** Convert a full-duration percentage to view-space percentage */
function toView(pct: number, totalDuration: number, view: View): number {
  return timeToViewPct((pct / 100) * totalDuration, view)
}

// Lasso selection lives in ThinTimeline's root-level handlers so a drag started
// anywhere (including inside the warp connector) can extend across every track.
// This component stays a passive renderer — no pointer interaction.
const WarpConnector = forwardRef<HTMLDivElement, WarpConnectorProps>(
  function WarpConnector({ segments, view, origDuration, outputDuration, clipIn, clipOut, beatClipIn, beatClipOut, clipFillColor, boundaryColor, linkedBoundaries, selectedBoundaries, railLabel }, ref) {
    const containerRef = useRef<HTMLDivElement>(null)

    if (segments.length === 0) {
      return (
        <div className="warp-connector-wrap">
          <div className="warp-connector__rail-cell">{railLabel ?? null}</div>
          <div ref={ref} className="warp-connector warp-connector--empty" />
        </div>
      )
    }

    // Merge refs
    const setRefs = (el: HTMLDivElement | null) => {
      (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el
      if (typeof ref === 'function') ref(el)
      else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = el
    }

    return (
      <div className="warp-connector-wrap">
        <div className="warp-connector__rail-cell">{railLabel ?? null}</div>
        <div
          ref={setRefs}
          className="warp-connector"
        >
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 100 1"
          preserveAspectRatio="none"
        >
          {/* Connector lines between paired top/bottom anchors.
              - Style (solid vs dashed) encodes linked vs unlinked.
              - Intensity (alpha + width) encodes whether the pair is selected. */}
          {segments.slice(1).map((seg, i) => {
            const origTime = (seg.origLeft / 100) * origDuration
            const atClipIn = clipIn !== undefined && Math.abs(origTime - clipIn) < 1e-3
            const atClipOut = clipOut !== undefined && Math.abs(origTime - clipOut) < 1e-3
            if (atClipIn || atClipOut) return null
            const oX = toView(seg.origLeft, origDuration, view)
            const qX = toView(seg.quantLeft, outputDuration, view)
            const linked = linkedBoundaries?.[i] ?? false
            const selected = selectedBoundaries?.[i] ?? false
            const alpha = linked
              ? (selected ? 1.0 : 0.75)
              : (selected ? 1.0 : 0.75)
            const width = selected ? 1.3 : (linked ? 1.0 : 1)
            return (
              <line
                key={i}
                x1={oX} y1={0} x2={qX} y2={1}
                stroke={`rgba(245,158,11,${alpha})`}
                strokeWidth={String(width)}
                strokeDasharray={linked ? undefined : '5 5'}
                vectorEffect="non-scaling-stroke"
              />
            )
          })}

          {/* Region tint — quadrilateral matching the clip block on top/bottom timelines */}
          {clipFillColor && clipIn !== undefined && clipOut !== undefined && (
            <polygon
              points={`${timeToViewPct(clipIn, view)},0 ${timeToViewPct(clipOut, view)},0 ${timeToViewPct(beatClipOut ?? clipOut, view)},1 ${timeToViewPct(beatClipIn ?? clipIn, view)},1`}
              fill={clipFillColor}
              pointerEvents="none"
            />
          )}
        </svg>

        {/* Out-of-range shading — polygons follow the slanted clip boundaries */}
        {(clipIn !== undefined || clipOut !== undefined) && (
          <svg
            width="100%" height="100%"
            viewBox="0 0 100 1"
            preserveAspectRatio="none"
            style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 1 }}
          >
            {clipIn !== undefined && (
              <polygon
                points={`0,0 ${timeToViewPct(clipIn, view)},0 ${timeToViewPct(beatClipIn ?? clipIn, view)},1 0,1`}
                fill="rgba(0,0,0,0.45)"
              />
            )}
            {clipOut !== undefined && clipOut < origDuration && (
              <polygon
                points={`${timeToViewPct(clipOut, view)},0 100,0 100,1 ${timeToViewPct(beatClipOut ?? clipOut, view)},1`}
                fill="rgba(0,0,0,0.45)"
              />
            )}
          </svg>
        )}
        {/* Clip boundary lines — rendered above the out-of-range overlays */}
        {(clipIn !== undefined || (clipOut !== undefined && clipOut < origDuration)) && (
          <svg
            width="100%" height="100%"
            viewBox="0 0 100 1"
            preserveAspectRatio="none"
            style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 2 }}
          >
            {clipIn !== undefined && (() => {
              const origX = timeToViewPct(clipIn, view)
              const beatX = timeToViewPct(beatClipIn ?? clipIn, view)
              return (origX >= -5 && origX <= 105) || (beatX >= -5 && beatX <= 105) ? (
                <line x1={origX} y1={0} x2={beatX} y2={1}
                  className="warp-connector__boundary-line"
                  style={boundaryColor ? { stroke: boundaryColor } : undefined}
                  vectorEffect="non-scaling-stroke" />
              ) : null
            })()}
            {clipOut !== undefined && clipOut < origDuration && (() => {
              const origX = timeToViewPct(clipOut, view)
              const beatX = timeToViewPct(beatClipOut ?? clipOut, view)
              return (origX >= -5 && origX <= 105) || (beatX >= -5 && beatX <= 105) ? (
                <line x1={origX} y1={0} x2={beatX} y2={1}
                  className="warp-connector__boundary-line"
                  style={boundaryColor ? { stroke: boundaryColor } : undefined}
                  vectorEffect="non-scaling-stroke" />
              ) : null
            })()}
          </svg>
        )}

        </div>
      </div>
    )
  }
)

export default WarpConnector
