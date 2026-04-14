import { useCallback } from 'react'
import type { Anchor } from '../types'
import { formatTime } from '../utils/time'
import './MarkerList.css'

interface MarkerListProps {
  origAnchors: Anchor[]
  beatAnchors: Anchor[]
  duration: number
  fps: number
  bpm: number
  beatZeroTime: number
  selectedIds: Set<number>
  onSelectionChange: (ids: Set<number>) => void
  onSeek?: (time: number) => void
  onClear?: () => void
  onReset?: () => void
  onSnap?: () => void
  onDeleteSelected?: () => void
  onResetSelected?: () => void
  onSnapSelected?: () => void
}

export default function MarkerList({
  origAnchors, beatAnchors,
  fps, bpm, beatZeroTime,
  selectedIds, onSelectionChange, onSeek,
  onClear, onReset, onSnap, onDeleteSelected, onResetSelected, onSnapSelected,
}: MarkerListProps) {
  const beatDuration = 60 / bpm
  const sorted = [...origAnchors].sort((a, b) => a.time - b.time)
  const hasSelection = selectedIds.size > 0

  const handleClick = useCallback((e: React.MouseEvent, id: number) => {
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selectedIds)
      if (next.has(id)) next.delete(id); else next.add(id)
      onSelectionChange(next)
    } else if (e.shiftKey && sorted.length > 0) {
      const clickedIdx = sorted.findIndex(a => a.id === id)
      let startIdx = clickedIdx
      for (let i = 0; i < sorted.length; i++) {
        if (selectedIds.has(sorted[i].id)) { startIdx = i; break }
      }
      const lo = Math.min(startIdx, clickedIdx)
      const hi = Math.max(startIdx, clickedIdx)
      const next = new Set(selectedIds)
      for (let i = lo; i <= hi; i++) next.add(sorted[i].id)
      onSelectionChange(next)
    } else {
      onSelectionChange(new Set([id]))
    }
  }, [selectedIds, onSelectionChange, sorted])

  return (
    <div className="marker-list">
      {/* Header + actions */}
      <div className="ml-section__header">
        <span>Markers</span>
        <span className="ml-section__header-count">{origAnchors.length}</span>
      </div>
      <div className="ml-actions">
        {hasSelection ? (
          <>
            <button className="ml-actions__btn" onClick={onDeleteSelected}>Delete</button>
            <button className="ml-actions__btn" onClick={onResetSelected}>Reset</button>
            <button className="ml-actions__btn" onClick={onSnapSelected}>Snap</button>
            <button className="ml-actions__btn ml-actions__btn--deselect" onClick={() => onSelectionChange(new Set())}>Deselect</button>
          </>
        ) : (
          <>
            <button className="ml-actions__btn" onClick={onClear} disabled={origAnchors.length === 0}>Clear</button>
            <button className="ml-actions__btn" onClick={onReset} disabled={origAnchors.length === 0}>Reset</button>
            <button className="ml-actions__btn" onClick={onSnap} disabled={origAnchors.length === 0}>Snap</button>
          </>
        )}
      </div>

      {/* Scrollable list */}
      <div className="ml-scroll">
        {sorted.length === 0 ? (
          <div className="ml-empty">No markers placed</div>
        ) : (
          sorted.map((anchor, i) => {
            const beatAnchor = beatAnchors.find(b => b.id === anchor.id)
            const nextOrig = sorted[i + 1]
            const nextBeat = nextOrig ? beatAnchors.find(b => b.id === nextOrig.id) : null
            let stretch: number | null = null
            if (nextOrig && beatAnchor && nextBeat) {
              const origSpan = nextOrig.time - anchor.time
              const beatSpan = nextBeat.time - beatAnchor.time
              if (origSpan > 0) stretch = beatSpan / origSpan
            }
            const isSelected = selectedIds.has(anchor.id)
            const frame = Math.round(anchor.time * fps)
            const isBeatZero = beatAnchor !== undefined && Math.abs(beatAnchor.time - beatZeroTime) < 0.001
            const beatNumber = beatAnchor !== undefined
              ? (beatAnchor.time - beatZeroTime) / beatDuration
              : null

            return (
              <div
                key={anchor.id}
                className={`ml-row${isSelected ? ' ml-row--selected' : ''}`}
                onClick={e => handleClick(e, anchor.id)}
                onDoubleClick={() => onSeek?.(anchor.time)}
              >
                <span className="ml-row__idx">{i + 1}</span>
                <span className="ml-row__time">{formatTime(anchor.time)}</span>
                <span className="ml-row__frame">f{frame}</span>
                {isBeatZero
                  ? <span className="ml-row__beat0">B0</span>
                  : beatNumber !== null
                    ? <span className="ml-row__beat">B{beatNumber % 1 === 0 ? beatNumber.toFixed(0) : beatNumber.toFixed(1)}</span>
                    : <span className="ml-row__beat">—</span>
                }
                {stretch !== null && (
                  <span className={`ml-row__stretch${stretch > 1.3 ? ' ml-row__stretch--high' : stretch < 0.75 ? ' ml-row__stretch--low' : ''}`}>
                    {stretch.toFixed(2)}×
                  </span>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
