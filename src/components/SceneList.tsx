import { useState, useEffect, useMemo } from 'react'
import type { Region, View } from '../types'
import { formatTime } from '../utils/time'
import { filterCutsByMinGap } from '../utils/sceneFilter'
import './SceneList.css'

// Must match the palette in RegionSidebar / Timeline.css (clip-overlay--color-N).
const REGION_PALETTE = [
  { h: 0,   s: 75, l: 55 },
  { h: 30,  s: 80, l: 52 },
  { h: 58,  s: 80, l: 48 },
  { h: 115, s: 65, l: 45 },
  { h: 183, s: 65, l: 42 },
  { h: 213, s: 70, l: 55 },
  { h: 270, s: 60, l: 55 },
  { h: 305, s: 65, l: 52 },
]

interface SceneListProps {
  cuts: number[]
  status: 'idle' | 'analyzing' | 'done' | 'error'
  progress: number
  error?: string
  threshold: number
  duration: number
  /** Regions sorted by creation order — index determines the color. */
  regions: Region[]
  /** Current timeline view window (used by the "near view" filter). */
  view: View
  onSeek?: (time: number) => void
  onRecompute: (threshold: number) => void
  /** Min seconds between consecutive cuts to keep; collapses dense clusters. 0 disables. */
  minGap: number
  onMinGapChange: (minGap: number) => void
  /** Remove the scene boundary at this time. Omit to hide the delete affordance. */
  onSceneDelete?: (time: number) => void
}

export default function SceneList({
  cuts, status, progress, error, threshold, duration,
  regions, view,
  onSeek, onRecompute,
  minGap, onMinGapChange,
  onSceneDelete,
}: SceneListProps) {
  const [draftThreshold, setDraftThreshold] = useState<string>(String(threshold))
  const [nearViewOnly, setNearViewOnly] = useState<boolean>(false)

  // Keep draft in sync when upstream threshold changes (e.g. new video).
  useEffect(() => { setDraftThreshold(String(threshold)) }, [threshold])

  const parsed = Number.parseFloat(draftThreshold)
  const thresholdChanged = Number.isFinite(parsed) && Math.abs(parsed - threshold) > 1e-3

  const filteredCuts = useMemo(() => filterCutsByMinGap(cuts, minGap), [cuts, minGap])

  // Scene boundaries (0, ...filteredCuts, duration) turned into rows. Each row is a scene
  // interval [start, end). Optionally filtered to the current view ± 50% of its span.
  const rows = useMemo(() => {
    const boundaries = [0, ...filteredCuts, duration]
    const all = boundaries.slice(0, -1).map((start, i) => ({
      originalIndex: i,
      start,
      end: boundaries[i + 1],
    }))
    if (!nearViewOnly) return all
    const span = view.end - view.start
    const lo = view.start - span * 0.25
    const hi = view.end + span * 0.25
    // Keep a row if its [start, end) overlaps the expanded window.
    return all.filter(r => r.end > lo && r.start < hi)
  }, [filteredCuts, duration, nearViewOnly, view])

  // Region index (by array position) covering a given time, or -1 if none.
  const regionColorFor = (time: number) => {
    const idx = regions.findIndex(r => time >= r.inPoint && time < r.outPoint)
    if (idx === -1) return null
    return REGION_PALETTE[idx % REGION_PALETTE.length]
  }

  return (
    <div className="scene-list">
      <div className="sl-header">
        <span>Scenes</span>
        <span className="sl-header__count">
          {status === 'analyzing'
            ? `${Math.round(progress * 100)}%`
            : filteredCuts.length > 0
              ? (minGap > 0 && filteredCuts.length !== cuts.length
                  ? `${filteredCuts.length}/${cuts.length}`
                  : filteredCuts.length)
              : status === 'error' ? '—' : 0}
        </span>
      </div>

      <div className="sl-controls">
        <label className="sl-controls__label">Threshold</label>
        <input
          type="number"
          className="sl-controls__input"
          min={0}
          max={100}
          step={1}
          value={draftThreshold}
          onChange={e => setDraftThreshold(e.target.value)}
        />
        <button
          className="sl-controls__btn"
          onClick={() => {
            const t = Number.parseFloat(draftThreshold)
            if (Number.isFinite(t) && t >= 0) onRecompute(t)
          }}
          disabled={status === 'analyzing'}
        >
          {thresholdChanged ? 'Apply' : 'Recompute'}
        </button>
      </div>

      <div className="sl-controls">
        <label className="sl-controls__label" title="Collapse markers closer than this into one segment.">Min gap</label>
        <input
          type="number"
          className="sl-controls__input"
          min={0}
          max={60}
          step={0.25}
          value={minGap}
          onChange={e => {
            const v = Number.parseFloat(e.target.value)
            onMinGapChange(Number.isFinite(v) && v >= 0 ? v : 0)
          }}
        />
        <span className="sl-controls__unit">s</span>
      </div>

      <label className="sl-filter">
        <input
          type="checkbox"
          checked={nearViewOnly}
          onChange={e => setNearViewOnly(e.target.checked)}
        />
        <span>Near view only</span>
      </label>

      {status === 'analyzing' && (
        <div className="sl-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
          <div className="sl-progress__bar" style={{ width: `${Math.max(2, Math.round(progress * 100))}%` }} />
          <span className="sl-progress__label">
            Analyzing… {Math.round(progress * 100)}%
          </span>
        </div>
      )}

      {status === 'error' && error && (
        <div className="sl-error" title={error}>{error}</div>
      )}

      <div className="sl-scroll">
        {rows.length === 0 ? (
          <div className="sl-empty">
            {status === 'analyzing'
              ? 'Analyzing…'
              : nearViewOnly
                ? 'No scenes near view'
                : 'No scene cuts detected'}
          </div>
        ) : (
          rows.map(({ originalIndex, start, end }) => {
            const length = end - start
            const color = regionColorFor(start)
            // The first row always starts at t=0 (boundary, not a real cut),
            // so deletion only makes sense for subsequent rows.
            const canDelete = !!onSceneDelete && originalIndex > 0
            return (
              <div
                key={originalIndex}
                className="sl-row"
                onDoubleClick={() => onSeek?.(start)}
                onClick={() => onSeek?.(start)}
                title={`Scene ${originalIndex + 1}: ${formatTime(start)} → ${formatTime(end)}`}
              >
                <span
                  className="sl-row__region-color"
                  style={color ? { background: `hsl(${color.h}, ${color.s}%, ${color.l}%)` } : undefined}
                />
                <span className="sl-row__idx">{originalIndex + 1}</span>
                <span className="sl-row__time">{formatTime(start)}</span>
                <span className="sl-row__len">{length.toFixed(2)}s</span>
                {canDelete && (
                  <button
                    type="button"
                    className="sl-row__delete"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSceneDelete!(start)
                    }}
                    title="Delete scene boundary"
                    aria-label={`Delete scene ${originalIndex + 1}`}
                  >×</button>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
