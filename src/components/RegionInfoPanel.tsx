import { useEffect, useRef, useState } from 'react'
import type { Region, WarpData } from '../types'
import { IconLockClosed, IconLockOpen, IconDetectBPM, IconRename } from './icons'
import { useGesture } from '../store/gesture'
import './RegionInfoPanel.css'

type LockTarget = 'bpm' | 'beats'

interface RegionInfoPanelProps {
  activeRegion: Region | null
  warpData: WarpData | null
  duration: number
  onBpmChange: (bpm: number) => void
  onUpdateRegionInOut?: (id: string, inPoint: number, outPoint: number) => void
  onUpdateRegionBeatTimes?: (id: string, inBeatTime?: number, outBeatTime?: number) => void
  /** Called when lock state changes */
  onLockChange?: (lock: 'bpm' | 'beats', lockedBeats?: number) => void
  onRename?: (id: string, name: string) => void
  /** Called when user clicks Detect BPM */
  onBpmDetect?: () => void
  detectingBpm?: boolean
}

function formatTimecode(s: number): string {
  const m = Math.floor(s / 60)
  const sec = (s % 60).toFixed(2).padStart(5, '0')
  return m > 0 ? `${m}:${sec}` : `${sec}s`
}

function parseTimecode(str: string): number | null {
  const s = str.trim().replace(/s$/, '')
  // m:ss or m:ss.xx
  const colon = s.match(/^(\d+):(\d+(?:\.\d*)?)$/)
  if (colon) return parseInt(colon[1]) * 60 + parseFloat(colon[2])
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

export default function RegionInfoPanel({
  activeRegion,
  warpData,
  duration,
  onBpmChange,
  onUpdateRegionInOut,
  onUpdateRegionBeatTimes,
  onLockChange,
  onRename,
  onBpmDetect,
  detectingBpm,
}: RegionInfoPanelProps) {
  const bpm = warpData?.bpm ?? 120

  const beat = bpm > 0 ? 60 / bpm : 0
  // Beat-space span defines the actual timing — bottom handle controls this
  const beatSpan = activeRegion
    ? (activeRegion.outBeatTime ?? activeRegion.outPoint) - (activeRegion.inBeatTime ?? activeRegion.inPoint)
    : duration
  const regionSpan = beatSpan  // use beat-space span for all calculations
  const totalBeats = beat > 0 ? beatSpan / beat : 0

  // Lock: use region's persisted lock state, default to 'bpm'
  const lock = activeRegion?.lock ?? 'bpm'
  const lockedBeats = activeRegion?.lockedBeats ?? totalBeats

  // Track previous span to detect external resizes (drag, etc.)
  const prevSpanRef = useRef(regionSpan)

  const [bpmInput, setBpmInput] = useState(String(bpm))
  const [beatsInput, setBeatsInput] = useState(totalBeats > 0 ? totalBeats.toFixed(1) : '')
  const [inInput, setInInput] = useState('')
  const [outInput, setOutInput] = useState('')
  const [durInput, setDurInput] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [editingIn, setEditingIn] = useState(false)
  const [editingOut, setEditingOut] = useState(false)
  const [editingDur, setEditingDur] = useState(false)

  const dragRegion = useGesture(s => s.dragRegion)
  const isLiveDrag = dragRegion?.id === activeRegion?.id
  const liveIn  = isLiveDrag ? dragRegion!.inPoint  : (activeRegion?.inPoint  ?? 0)
  const liveOut = isLiveDrag ? dragRegion!.outPoint : (activeRegion?.outPoint ?? 0)
  const liveBeatSpan = isLiveDrag
    ? (activeRegion?.outBeatTime ?? liveOut) - (activeRegion?.inBeatTime ?? liveIn)
    : beatSpan
  const liveTotalBeats = beat > 0 ? liveBeatSpan / beat : 0

  useEffect(() => { setBpmInput(String(bpm)) }, [bpm])
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

  // The out boundary is "linked" when its beat-space time matches the orig-space
  // time — i.e., 1.0x playback at that boundary. Changes to beat count should
  // propagate to both orig and beat space in that case; otherwise they affect
  // only beat space (bottom timeline).
  const outLinked = !activeRegion
    || activeRegion.outBeatTime === undefined
    || Math.abs(activeRegion.outBeatTime - activeRegion.outPoint) < 0.001

  const applyBeatCount = (n: number) => {
    if (!activeRegion || beat <= 0) return
    onLockChange?.(lock, n)
    const inBeat = activeRegion.inBeatTime ?? activeRegion.inPoint
    const newOutBeat = inBeat + n * beat
    if (outLinked) {
      // Linked → move both orig and beat-space out. updateRegionInOut clears
      // beat-space overrides, re-establishing the linked (identity) mapping.
      if (!onUpdateRegionInOut) return
      const newOut = Math.min(duration, activeRegion.inPoint + n * beat)
      onUpdateRegionInOut(activeRegion.id, activeRegion.inPoint, newOut)
    } else {
      // Not linked → only change the bottom (beat-space) boundary.
      if (!onUpdateRegionBeatTimes) return
      onUpdateRegionBeatTimes(activeRegion.id, activeRegion.inBeatTime, newOutBeat)
    }
  }

  const commitBeats = () => {
    if (!activeRegion || beat <= 0) {
      setBeatsInput(totalBeats > 0 ? totalBeats.toFixed(1) : '')
      return
    }
    const n = parseFloat(beatsInput)
    if (n > 0 && n <= 99999) {
      applyBeatCount(n)
    } else {
      setBeatsInput(totalBeats > 0 ? totalBeats.toFixed(1) : '')
    }
  }

  const commitIn = () => {
    if (!activeRegion || !onUpdateRegionInOut) { setEditingIn(false); return }
    const n = parseTimecode(inInput)
    if (n !== null && n >= 0 && n < activeRegion.outPoint) {
      onUpdateRegionInOut(activeRegion.id, n, activeRegion.outPoint)
    }
    setEditingIn(false)
  }

  const commitOut = () => {
    if (!activeRegion || !onUpdateRegionInOut) { setEditingOut(false); return }
    const n = parseTimecode(outInput)
    if (n !== null && n > activeRegion.inPoint) {
      onUpdateRegionInOut(activeRegion.id, activeRegion.inPoint, n)
    }
    setEditingOut(false)
  }

  const commitDur = () => {
    if (!activeRegion || !onUpdateRegionInOut) { setEditingDur(false); return }
    const n = parseTimecode(durInput)
    if (n !== null && n > 0) {
      onUpdateRegionInOut(activeRegion.id, activeRegion.inPoint, activeRegion.inPoint + n)
    }
    setEditingDur(false)
  }

  // ── Beat adjustment helpers ─────────────────────────────

  const adjustBeats = (newBeats: number) => {
    if (!activeRegion || beat <= 0 || newBeats < 0.5) return
    applyBeatCount(newBeats)
  }

  const title = activeRegion ? activeRegion.name : 'No Active Clip'

  return (
    <div className="rip">
      <div className="rip__header">
        <span className="rip__title">{title}</span>
      </div>
      <div className="rip__body">
        {activeRegion && (
          <div className="rip__name">
            {editingName ? (
              <input
                className="rip__input rip__input--name"
                type="text"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                onBlur={() => { if (nameInput.trim()) onRename?.(activeRegion.id, nameInput.trim()); setEditingName(false) }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { if (nameInput.trim()) onRename?.(activeRegion.id, nameInput.trim()); setEditingName(false) }
                  if (e.key === 'Escape') setEditingName(false)
                  e.stopPropagation()
                }}
                autoFocus
              />
            ) : (
              <>
                <span className="rip__name-text">{activeRegion.name}</span>
                <button
                  className="rip__name-edit"
                  onClick={() => { setNameInput(activeRegion.name); setEditingName(true) }}
                  title="Rename clip"
                >
                  <IconRename size={12} />
                </button>
              </>
            )}
          </div>
        )}

        {/* BPM + Beats grid — beat-space timing (bottom timeline). */}
        {activeRegion && <div className="rip__grid">
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
            {activeRegion && (
              <button
                className={`rip__lock${lock === 'bpm' ? ' rip__lock--active' : ''}`}
                onClick={handleLockToggle}
                title={lock === 'bpm' ? 'BPM locked — resize changes beats' : 'Click to lock BPM'}
              >
                {lock === 'bpm' ? <IconLockClosed size={16} /> : <IconLockOpen size={16} />}
              </button>
            )}
            {onBpmDetect && (
              <button
                className="rip__detect"
                onClick={onBpmDetect}
                disabled={detectingBpm}
                title="Detect BPM from anchors"
              >
                {detectingBpm ? '…' : <IconDetectBPM size={16} />}
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
                  value={isLiveDrag && liveTotalBeats > 0 ? liveTotalBeats.toFixed(1) : beatsInput}
                  onChange={e => setBeatsInput(e.target.value)}
                  onBlur={commitBeats}
                  onKeyDown={e => { if (e.key === 'Enter') commitBeats(); e.stopPropagation() }}
                />
                <button
                  className={`rip__lock${lock === 'beats' ? ' rip__lock--active' : ''}`}
                  onClick={handleLockToggle}
                  title={lock === 'beats' ? 'Beats locked — resize changes BPM' : 'Click to lock beats'}
                >
                  {lock === 'beats' ? <IconLockClosed size={16} /> : <IconLockOpen size={16} />}
                </button>
              </>
            ) : (
              <span className="rip__value rip__value--computed">
                {totalBeats > 0 ? totalBeats.toFixed(1) : '—'}
              </span>
            )}
          </div>

          {/* Beat adj buttons span full grid width, below Beats row */}
          {/* {activeRegion && (
            <div className="rip__btn-group rip__btn-group--full">
              <button className="rip__adj" onClick={() => adjustBeats(totalBeats / 2)} title="Halve beats">÷2</button>
              <button className="rip__adj" onClick={() => adjustBeats(Math.round(totalBeats) - 1)} title="Remove 1 beat">−1</button>
              <button className="rip__adj" onClick={() => adjustBeats(Math.round(totalBeats) + 1)} title="Add 1 beat">+1</button>
              <button className="rip__adj" onClick={() => adjustBeats(totalBeats * 2)} title="Double beats">×2</button>
            </div>
          )} */}
        </div>}

        {activeRegion && <div className="rip__divider" />}

        {/* In / Out / Dur — orig-space times (top timeline). */}
        {activeRegion && (
          <>
            <div className="rip__row">
              <span className="rip__label">In</span>
              {editingIn ? (
                <input
                  className="rip__input rip__input--time"
                  type="text"
                  value={inInput}
                  onChange={e => setInInput(e.target.value)}
                  onBlur={commitIn}
                  onKeyDown={e => { if (e.key === 'Enter') commitIn(); if (e.key === 'Escape') setEditingIn(false); e.stopPropagation() }}
                  autoFocus
                />
              ) : (
                <span
                  className="rip__value rip__value--editable"
                  onClick={() => { setInInput(formatTimecode(liveIn)); setEditingIn(true) }}
                  title="Click to edit"
                >
                  {formatTimecode(liveIn)}
                </span>
              )}
            </div>
            <div className="rip__row">
              <span className="rip__label">Out</span>
              {editingOut ? (
                <input
                  className="rip__input rip__input--time"
                  type="text"
                  value={outInput}
                  onChange={e => setOutInput(e.target.value)}
                  onBlur={commitOut}
                  onKeyDown={e => { if (e.key === 'Enter') commitOut(); if (e.key === 'Escape') setEditingOut(false); e.stopPropagation() }}
                  autoFocus
                />
              ) : (
                <span
                  className="rip__value rip__value--editable"
                  onClick={() => { setOutInput(formatTimecode(liveOut)); setEditingOut(true) }}
                  title="Click to edit"
                >
                  {formatTimecode(liveOut)}
                </span>
              )}
            </div>
            <div className="rip__row">
              <span className="rip__label">Dur</span>
              {editingDur ? (
                <input
                  className="rip__input rip__input--time"
                  type="text"
                  value={durInput}
                  onChange={e => setDurInput(e.target.value)}
                  onBlur={commitDur}
                  onKeyDown={e => { if (e.key === 'Enter') commitDur(); if (e.key === 'Escape') setEditingDur(false); e.stopPropagation() }}
                  autoFocus
                />
              ) : (
                <span
                  className="rip__value rip__value--editable"
                  onClick={() => { setDurInput(formatTimecode(liveOut - liveIn)); setEditingDur(true) }}
                  title="Click to edit"
                >
                  {formatTimecode(liveOut - liveIn)}
                </span>
              )}
            </div>
          </>
        )}

      </div>
    </div>
  )
}
