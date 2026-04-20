import type { View } from '../../types'
import { timeToViewPct } from '../../utils/view'
import TrackRow from './TrackRow'
import './RegionBand.css'

export interface RegionBlock {
  id: string
  inPoint: number
  outPoint: number
  colorIndex?: number
  active?: boolean
  label?: string
}

interface RegionBandProps {
  label?: string
  kind: 'input' | 'output'
  regions: RegionBlock[]
  view: View
  onSelect?: (id: string) => void
  onContextMenu?: (id: string, x: number, y: number) => void
}

/**
 * Thin row rendering regions as colored horizontal blocks. Two instances are
 * stacked in ThinTimeline: one for the input (source) region spans, one for
 * their output (beat-space) spans.
 */
export default function RegionBand({ label, kind, regions, view, onSelect, onContextMenu }: RegionBandProps) {
  return (
    <TrackRow label={label ?? (kind === 'input' ? 'Regions' : 'Out')} kind={`region-${kind}`}>
      {regions.map(r => {
        if (r.outPoint <= r.inPoint) return null
        const left = timeToViewPct(r.inPoint, view)
        const right = timeToViewPct(r.outPoint, view)
        if (right < -1 || left > 101) return null
        const width = Math.max(0.5, right - left)
        return (
          <div
            key={r.id}
            className={`thin-region clip-overlay--color-${(r.colorIndex ?? 0) % 8}${r.active ? ' thin-region--active' : ''}`}
            style={{ left: `${left}%`, width: `${width}%` }}
            title={r.label ?? `${r.inPoint.toFixed(2)}s → ${r.outPoint.toFixed(2)}s`}
            onClick={(e) => { e.stopPropagation(); onSelect?.(r.id) }}
            onContextMenu={(e) => {
              if (!onContextMenu) return
              e.preventDefault(); e.stopPropagation()
              onContextMenu(r.id, e.clientX, e.clientY)
            }}
          />
        )
      })}
    </TrackRow>
  )
}
