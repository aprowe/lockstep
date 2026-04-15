import { useEffect, useRef, useState } from 'react'
import type { Region, WarpData } from '../types'
import './RegionInfoPanel.css'

type LockTarget = 'bpm' | 'beats'

interface RegionInfoPanelProps {
  activeRegion: Region | null
  warpData: WarpData | null
  duration: number
  addToEnd: boolean
  onBpmChange: (bpm: number) => void
  onMinStretchChange: (v: number) => void
  onMaxStretchChange: (v: number) => void
  onAddToEndChange: (v: boolean) => void
  onUpdateRegionInOut?: (id: string, inPoint: number, outPoint: number) => void
  /** Orig-space time of the current beat-zero anchor (null = clip start) */
  beatZeroOrigTime?: number | null
  /** Called when user picks "Start at" marker (null = clip start) */
  onStartAtChange?: (origTime: number | null) => void
  /** Called when lock state changes */
  onLockChange?: (lock: 'bpm' | 'beats', lockedBeats?: number) => void
  /** Called when user clicks Detect BPM */
  onBpmDetect?: () => void
  detectingBpm?: boolean
}

function formatTimecode(s: number): string {
  const m = Math.floor(s / 60)
  const sec = (s % 60).toFixed(2).padStart(5, '0')
  return m > 0 ? `${m}:${sec}` : `${sec}s`
}

export default function RegionInfoPanel({
  activeRegion,
  warpData,
  duration,
  addToEnd,
  onBpmChange,
  onMinStretchChange,
  onMaxStretchChange,
  onAddToEndChange,
  onUpdateRegionInOut,
  beatZeroOrigTime,
  onStartAtChange,
  onLockChange,
  onBpmDetect,
  detectingBpm,
}: RegionInfoPanelProps) {
  const bpm = warpData?.bpm ?? 120
  const minStretch = warpData?.minStretch ?? 0.5
  const maxStretch = warpData?.maxStretch ?? 2.0

  const beat = bpm > 0 ? 60 / bpm : 0
  const origSpan = activeRegion
    ? activeRegion.outPoint - activeRegion.inPoint
    : duration
  // Beat-space span defines the actual timing — bottom handle controls this
  const beatSpan = activeRegion
    ? (activeRegion.outBeatTime ?? activeRegion.outPoint) - (activeRegion.inBeatTime ?? activeRegion.inPoint)
    : duration
  const regionSpan = beatSpan  // use beat-space span for all calculations
  const totalBeats = beat > 0 ? beatSpan / beat : 0
  const markerCount = warpData?.origAnchors.length ?? 0

  // Anchors within the active clip for "Start at" selector
  const anchorsInClip = (() => {
    if (!warpData) return []
    const clipIn = activeRegion?.inPoint ?? 0
    const clipOut = activeRegion?.outPoint ?? duration
    return [...warpData.origAnchors]
      .filter(a => a.time >= clipIn - 0.001 && a.time <= clipOut + 0.001)
      .sort((a, b) => a.time - b.time)
  })()

  // Lock: use region's persisted lock state, default to 'bpm'
  const lock = activeRegion?.lock ?? 'bpm'
  const lockedBeats = activeRegion?.lockedBeats ?? totalBeats

  // Track previous span to detect external resizes (drag, etc.)
  const prevSpanRef = useRef(regionSpan)

  const [bpmInput, setBpmInput] = useState(String(bpm))
  const [beatsInput, setBeatsInput] = useState(totalBeats > 0 ? totalBeats.toFixed(1) : '')
  const [minInput, setMinInput] = useState(String(minStretch))
  const [maxInput, setMaxInput] = useState(String(maxStretch))

  useEffect(() => { setBpmInput(String(bpm)) }, [bpm])
  useEffect(() => { setMinInput(String(minStretch)) }, [minStretch])
  useEffect(() => { setMaxInput(String(maxStretch)) }, [maxStretch])
  useEffect(() => {
    setBeatsInput(totalBeats > 0 ? totalBeats.toFixed(1) : '')
  }, [totalBeats])

  // When beats are locked and region span changes externally → adjust BPM
  useEffect(() => {
    if (!activeRegion) { prevSpanRef.current = regionSpan; return }
    const spanChanged = Math.abs(regionSpan - prevSpanRef.current) > 0.001
    prevSpanRef.current = regionSpan
    if (!spanChanged) return

    if (lock === 'beats' && lockedBeats > 0 && regionSpan > 0.01) {
      const newBpm = Math.round((lockedBeats * 60) / regionSpan * 100) / 100
      if (newBpm > 0 && newBpm <= 999 && Math.abs(newBpm - bpm) > 0.01) {
        onBpmChange(newBpm)
      }
    }
  }, [regionSpan, activeRegion, lock, bpm, onBpmChange])

  // When user switches to 'beats' lock, snapshot current beats
  const handleLockToggle = () => {
    if (lock === 'bpm') {
      onLockChange?.('beats', totalBeats)
    } else {
      onLockChange?.('bpm')
    }
  }

  // ── Commit helpers ──────────────────────────────────────

  const commitBpm = () => {
    const n = parseFloat(bpmInput)
    if (n > 0 && n <= 999) onBpmChange(n)
    else setBpmInput(String(bpm))
  }

  const commitBeats = () => {
    if (!activeRegion || !onUpdateRegionInOut || beat <= 0) {
      setBeatsInput(totalBeats > 0 ? totalBeats.toFixed(1) : '')
      return
    }
    const n = parseFloat(beatsInput)
    if (n > 0 && n <= 99999) {
      onLockChange?.(lock, n)
      const newOut = Math.min(duration, activeRegion.inPoint + n * beat)
      onUpdateRegionInOut(activeRegion.id, activeRegion.inPoint, newOut)
    } else {
      setBeatsInput(totalBeats > 0 ? totalBeats.toFixed(1) : '')
    }
  }

  const commitMin = () => {
    const n = parseFloat(minInput)
    if (n > 0 && n < 10) onMinStretchChange(n)
    else setMinInput(String(minStretch))
  }

  const commitMax = () => {
    const n = parseFloat(maxInput)
    if (n > 0 && n < 10) onMaxStretchChange(n)
    else setMaxInput(String(maxStretch))
  }

  // ── Beat adjustment helpers ─────────────────────────────

  const adjustBeats = (newBeats: number) => {
    if (!activeRegion || !onUpdateRegionInOut || beat <= 0 || newBeats < 0.5) return
    onLockChange?.(lock, newBeats)
    const newOut = Math.min(duration, activeRegion.inPoint + newBeats * beat)
    onUpdateRegionInOut(activeRegion.id, activeRegion.inPoint, newOut)
  }

  const title = activeRegion ? activeRegion.name : 'Full Video'

  return (
    <div className="rip">
      <div className="rip__header">
        <span className="rip__title">{title}</span>
      </div>
      <div className="rip__body">
        {/* BPM + Beats grid */}
        <div className="rip__grid">
          <span className="rip__label">BPM</span>
          <div className="rip__field">
            <input
              className="rip__input"
              type="number" min={1} max={999}
              value={bpmInput}
              onChange={e => setBpmInput(e.target.value)}
              onBlur={commitBpm}
              onKeyDown={e => { if (e.key === 'Enter') commitBpm(); e.stopPropagation() }}
            />
            {onBpmDetect && (
              <button
                className="rip__detect"
                onClick={onBpmDetect}
                disabled={detectingBpm}
                title="Detect BPM from markers"
              >
                {detectingBpm ? '…' : '?'}
              </button>
            )}
            {activeRegion && (
              <button
                className={`rip__lock${lock === 'bpm' ? ' rip__lock--active' : ''}`}
                onClick={handleLockToggle}
                title={lock === 'bpm' ? 'BPM locked — resize changes beats' : 'Click to lock BPM'}
              >
                {lock === 'bpm' ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM15.1 8H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2z"/></svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2z"/></svg>
                )}
              </button>
            )}
          </div>

          <span className="rip__label">Beats</span>
          <div className="rip__field">
            {activeRegion ? (
              <>
                <input
                  className="rip__input"
                  type="number" min={0.5} max={99999} step={1}
                  value={beatsInput}
                  onChange={e => setBeatsInput(e.target.value)}
                  onBlur={commitBeats}
                  onKeyDown={e => { if (e.key === 'Enter') commitBeats(); e.stopPropagation() }}
                />
                <button
                  className={`rip__lock${lock === 'beats' ? ' rip__lock--active' : ''}`}
                  onClick={handleLockToggle}
                  title={lock === 'beats' ? 'Beats locked — resize changes BPM' : 'Click to lock beats'}
                >
                  {lock === 'beats' ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM15.1 8H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2z"/></svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2z"/></svg>
                  )}
                </button>
                <div className="rip__btn-group">
                  <button className="rip__adj" onClick={() => adjustBeats(totalBeats / 2)} title="Halve beats">÷2</button>
                  <button className="rip__adj" onClick={() => adjustBeats(Math.round(totalBeats) - 1)} title="Remove 1 beat">−1</button>
                  <button className="rip__adj" onClick={() => adjustBeats(Math.round(totalBeats) + 1)} title="Add 1 beat">+1</button>
                  <button className="rip__adj" onClick={() => adjustBeats(totalBeats * 2)} title="Double beats">×2</button>
                </div>
              </>
            ) : (
              <span className="rip__value rip__value--computed">
                {totalBeats > 0 ? totalBeats.toFixed(1) : '—'}
              </span>
            )}
          </div>
        </div>

        {/* Markers */}
        <div className="rip__row">
          <span className="rip__label">Markers</span>
          <span className="rip__value">{markerCount}</span>
        </div>

        <div className="rip__divider" />

        {/* Stretch limits */}
        <div className="rip__row">
          <span className="rip__label">Min %</span>
          <input
            className="rip__input"
            type="number" min={0.1} max={10} step={0.05}
            value={minInput}
            onChange={e => setMinInput(e.target.value)}
            onBlur={commitMin}
            onKeyDown={e => { if (e.key === 'Enter') commitMin(); e.stopPropagation() }}
          />
        </div>
        <div className="rip__row">
          <span className="rip__label">Max %</span>
          <input
            className="rip__input"
            type="number" min={0.1} max={10} step={0.05}
            value={maxInput}
            onChange={e => setMaxInput(e.target.value)}
            onBlur={commitMax}
            onKeyDown={e => { if (e.key === 'Enter') commitMax(); e.stopPropagation() }}
          />
        </div>

        <div className="rip__divider" />

        {/* Start at — only for actual clips, not Full Video */}
        {activeRegion && (
          <div className="rip__row">
            <span className="rip__label">Start</span>
            {onStartAtChange && anchorsInClip.length > 0 ? (
              <select
                className="rip__select"
                value={beatZeroOrigTime !== null && beatZeroOrigTime !== undefined
                  ? String(beatZeroOrigTime)
                  : '__clip_start__'
                }
                onChange={e => {
                  const val = e.target.value
                  if (val === '__clip_start__') {
                    onStartAtChange(null)
                    onAddToEndChange(false)
                  } else {
                    onStartAtChange(Number(val))
                    onAddToEndChange(true)
                  }
                }}
              >
                <option value="__clip_start__">Clip start</option>
                {anchorsInClip.map(a => (
                  <option key={a.id} value={String(a.time)}>
                    {formatTimecode(a.time)}
                  </option>
                ))}
              </select>
            ) : (
              <span className="rip__value" style={{ color: '#5a4e42', fontSize: '12px' }}>Clip start</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
