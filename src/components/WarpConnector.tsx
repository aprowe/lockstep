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
  /** Region in/out boundaries (one entry per region). Drawn as two slanted
   *  edge strokes per region across the warp row, hue per region color. */
  regionEdges?: ReadonlyArray<{
    id: string
    origIn: number
    origOut: number
    beatIn: number
    beatOut: number
    colorIndex: number
  }>
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
  function WarpConnector({ segments, view, origDuration, outputDuration, clipIn, clipOut, beatClipIn, beatClipOut, clipFillColor, boundaryColor, linkedBoundaries, selectedBoundaries, regionEdges, railLabel }, ref) {
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
          {/* Connector lines between paired top/bottom anchors. Always solid;
              hue encodes linked (cyan, --space-input) vs unlinked (warp orange,
              --space-warp). Intensity (alpha + width) encodes selection. */}
          {segments.slice(1).map((seg, i) => {
            const origTime = (seg.origLeft / 100) * origDuration
            const atClipIn = clipIn !== undefined && Math.abs(origTime - clipIn) < 1e-3
            const atClipOut = clipOut !== undefined && Math.abs(origTime - clipOut) < 1e-3
            if (atClipIn || atClipOut) return null
            const oX = toView(seg.origLeft, origDuration, view)
            const qX = toView(seg.quantLeft, outputDuration, view)
            const linked = linkedBoundaries?.[i] ?? false
            const selected = selectedBoundaries?.[i] ?? false
            const alpha = selected ? 1.0 : 0.75
            const width = selected ? 2.3 : 2
            return (
              <line
                key={i}
                x1={oX} y1={0} x2={qX} y2={1}
                className={linked ? 'warp-connector__line warp-connector__line--linked' : 'warp-connector__line warp-connector__line--unlinked'}
                strokeOpacity={alpha}
                strokeWidth={String(width)}
                vectorEffect="non-scaling-stroke"
              />
            )
          })}

          {/* Region edges on the warp row — two slanted strokes per region
              connecting the input-side boundary to the output-side boundary.
              Hue per region via clip-overlay--color-N → --clip-h/s/l. Fill
              between the edges lives on the Clip In / Clip Out bands. */}
          {regionEdges && regionEdges.map(r => {
            const oIn = timeToViewPct(r.origIn, view)
            const oOut = timeToViewPct(r.origOut, view)
            const bIn = timeToViewPct(r.beatIn, view)
            const bOut = timeToViewPct(r.beatOut, view)
            return (
              <g key={r.id} className={`clip-overlay--color-${r.colorIndex % 8}`}>
                {/* Whisper-faint fill between the slanted edges so the warp band
                    isn't visually empty between the input and output clips. */}
                <polygon
                  points={`${oIn},0 ${oOut},0 ${bOut},1 ${bIn},1`}
                  className="warp-connector__region-fill"
                  pointerEvents="none"
                />
                <line
                  x1={oIn} y1={0}
                  x2={bIn} y2={1}
                  className="warp-connector__region-edge"
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
                <line
                  x1={oOut} y1={0}
                  x2={bOut} y2={1}
                  className="warp-connector__region-edge"
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
              </g>
            )
          })}
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
                className="warp-connector__out-of-range-poly"
              />
            )}
            {clipOut !== undefined && clipOut < origDuration && (
              <polygon
                points={`${timeToViewPct(clipOut, view)},0 100,0 100,1 ${timeToViewPct(beatClipOut ?? clipOut, view)},1`}
                className="warp-connector__out-of-range-poly"
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
