import { useRef } from 'react'
import type { Anchor, View } from '../../types'
import type { RegionBlock } from './RegionBand'
import './ThinMinimap.css'

interface ThinMinimapProps {
  duration: number
  view: View
  onViewChange: (v: View) => void
  anchors?: Anchor[]
  regions?: RegionBlock[]
  label?: string
}

/**
 * Minimap row for the thin timeline. Visually identical to the classic
 * Timeline minimap — just wraps it in the thin rail + body convention.
 */
export default function ThinMinimap({
  duration, view, onViewChange, anchors, regions, label = 'Overview',
}: ThinMinimapProps) {
  const drag = useRef<{ lastX: number; width: number } | null>(null)

  const visibleSpan = Math.max(0, view.end - view.start)
  const leftPct = Math.max(0, (view.start / duration) * 100)
  const rightPct = Math.min(100, (view.end / duration) * 100)
  const widthPct = Math.max(0, rightPct - leftPct)

  return (
    <div className="thin-row thin-row--minimap">
      <div className="thin-row__rail">{label}</div>
      <div
        className="minimap"
        style={{ cursor: 'ew-resize', flex: 1 }}
        onPointerDown={e => {
          e.currentTarget.setPointerCapture(e.pointerId)
          const rect = e.currentTarget.getBoundingClientRect()
          const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration
          const half = visibleSpan / 2
          onViewChange({ start: t - half, end: t + half })
          drag.current = { lastX: e.clientX, width: rect.width }
        }}
        onPointerMove={e => {
          const g = drag.current
          if (!g || !e.buttons) return
          const delta = ((e.clientX - g.lastX) / g.width) * duration
          onViewChange({ start: view.start + delta, end: view.end + delta })
          drag.current = { ...g, lastX: e.clientX }
        }}
        onPointerUp={() => { drag.current = null }}
        onPointerLeave={() => { drag.current = null }}
      >
        {regions?.map(r => (
          <div
            key={r.id}
            className={`minimap-region clip-overlay--color-${(r.colorIndex ?? 0) % 8}${r.active ? ' minimap-region--active' : ''}`}
            style={{
              left: `${(r.inPoint / duration) * 100}%`,
              width: `${((r.outPoint - r.inPoint) / duration) * 100}%`,
            }}
          />
        ))}
        {anchors?.map(a => (
          <div
            key={a.id}
            className="minimap-anchor"
            style={{ left: `${(a.time / duration) * 100}%` }}
          />
        ))}
        <div
          className={`minimap-viewport${visibleSpan >= duration - 0.001 ? ' minimap-viewport--full' : ''}`}
          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
        />
      </div>
    </div>
  )
}
