import { useCallback } from 'react'
import type { Anchor, View } from '../../types'
import { timeToViewPct } from '../../utils/view'
import TrackRow from './TrackRow'
import './MarkersTrack.css'

interface MarkersTrackProps {
  anchors: Anchor[]
  view: View
  duration: number
  selectedIds: Set<number>
  label?: string
  onSeek?: (time: number) => void
  onAdd?: (time: number) => void
  onDelete?: (id: number) => void
  onSelect?: (id: number, additive: boolean) => void
  onContextMenu?: (id: number, x: number, y: number) => void
}

/**
 * Thin marker track — shows user-placed anchor times as narrow ticks.
 * Click tick → seek + select. Shift-click → additive select. Right-click →
 * context menu. Click on the row background → add a marker at that time
 * (snap-only; no warping per the thin-layout spec).
 */
export default function MarkersTrack({
  anchors, view, duration,
  selectedIds,
  label = 'Markers',
  onSeek, onAdd, onDelete, onSelect, onContextMenu,
}: MarkersTrackProps) {
  const handleBgClick = useCallback((pct: number) => {
    if (!onAdd) return
    const span = view.end - view.start
    const t = view.start + pct * span
    if (t >= 0 && t <= duration) onAdd(t)
  }, [onAdd, view.start, view.end, duration])

  return (
    <TrackRow
      label={label}
      kind="markers"
      onBackgroundClick={handleBgClick}
    >
      {anchors.map(a => {
        const x = timeToViewPct(a.time, view)
        if (x < -1 || x > 101) return null
        const selected = selectedIds.has(a.id)
        return (
          <button
            key={a.id}
            type="button"
            className={`thin-marker${selected ? ' thin-marker--selected' : ''}`}
            style={{ left: `${x}%` }}
            title={`Marker @ ${a.time.toFixed(3)}s`}
            onClick={(e) => {
              e.stopPropagation()
              if (e.shiftKey && onDelete) { onDelete(a.id); return }
              onSelect?.(a.id, e.ctrlKey || e.metaKey)
              onSeek?.(a.time)
            }}
            onContextMenu={(e) => {
              if (!onContextMenu) return
              e.preventDefault(); e.stopPropagation()
              onContextMenu(a.id, e.clientX, e.clientY)
            }}
          />
        )
      })}
    </TrackRow>
  )
}
