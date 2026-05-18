import { useEffect, useRef, useState } from 'react'
import type { Region, WarpData } from '../types'
import type { EffectiveBeatBounds } from '../timeline/model/effectiveBounds'
import { IconLockClosed, IconLockOpen, IconDetectBPM, IconRename } from './icons'
import './RegionInfoPanel.css'

type LockTarget = 'bpm' | 'beats'

interface RegionInfoPanelProps {
  activeRegion: Region | null
  warpData: WarpData | null
  duration: number
  /** Effective beat-space bounds for the active region (from selectEffectiveBeatBoundsForActive).
   *  When provided, these are used in place of region.inBeatTime/outBeatTime for
   *  beat-span and related computations so that input-anchor conform is reflected. */
  effectiveBounds?: EffectiveBeatBounds | null
  onBpmChange: (bpm: number) => void
  onUpdateRegionInOut?: (id: string, inPoint: number, outPoint: number) => void
  onUpdateRegionBeatTimes?: (id: string, inBeatTime: number, outBeatTime: number) => void
  /** Global lock mode (Phase 6 — replaces per-region Region.lock). */
  lockMode?: 'bpm' | 'beats'
  /** Called when lock mode toggle is clicked */
  onLockChange?: (lock: 'bpm' | 'beats', lockedBeats?: number) => void
  onRename?: (id: string, name: string) => void
  /** Called when user clicks Detect BPM */
  onBpmDetect?: () => void
  detectingBpm?: boolean
  /** Called when user commits a BPM value. stretch=true when Alt was held. */
  onApplyBpmEdit?: (newBpm: number, stretch: boolean) => void
  /** Called when user commits a beats value. stretch=true when Alt was held. */
  onApplyBeatsEdit?: (newLockedBeats: number, stretch: boolean) => void
  /** Called when user clicks Reset Boundary — clears diverged beat-space bounds. */
  onResetBoundary?: () => void
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
  effectiveBounds,
  onBpmChange,
  onUpdateRegionInOut,
  onUpdateRegionBeatTimes,
  lockMode: lockModeProp,
  onLockChange,
  onRename,
  onBpmDetect,
  detectingBpm,
  onApplyBpmEdit,
  onApplyBeatsEdit,
  onResetBoundary,
}: RegionInfoPanelProps) {
  const bpm = warpData?.bpm ?? 120

  const beat = bpm > 0 ? 60 / bpm : 0
  // Beat-space span defines the actual timing — use effective bounds when
  // available so input-anchor conform is reflected in derived values.
  const effectiveInBeat = effectiveBounds?.inBeatTime
    ?? activeRegion?.inBeatTime
    ?? 0
  const effectiveOutBeat = effectiveBounds?.outBeatTime
    ?? activeRegion?.outBeatTime
    ?? duration
  const beatSpan = activeRegion
    ? effectiveOutBeat - effectiveInBeat
    : duration
  const regionSpan = beatSpan  // use beat-space span for all calculations
  const totalBeats = beat > 0 ? beatSpan / beat : 0

  // Lock: use global lockMode prop (Phase 6), default to 'bpm'.
  const lock = lockModeProp ?? 'bpm'
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
  /** Tracks whether Alt is currently held over a BPM/beats input. */
  const [altHeld, setAltHeld] = useState(false)
  /** Ref holding the last committed altKey state for use inside blur handlers
   *  (synthetic blur events do not carry keyboard modifiers reliably). */
  const altHeldRef = useRef(false)

  // Slice is live during drag (controller dispatches commit thunks on every
  // pointerMove; history + persistence middleware gate on drag.active). Read
  // all display values directly from the region — no gesture-store overlay.
  const regionBpm = activeRegion?.bpm ?? null
  const regionLockedBeats = activeRegion?.lockedBeats ?? null
  const liveIn  = activeRegion?.inPoint  ?? 0
  const liveOut = activeRegion?.outPoint ?? 0

  // Sync bpmInput from region BPM when active (live during clipout drag) or
  // global BPM otherwise.
  useEffect(() => {
    setBpmInput(String(regionBpm ?? bpm))
  }, [regionBpm, bpm])
  useEffect(() => {
    const displayBeats = regionLockedBeats ?? totalBeats
    setBeatsInput(displayBeats > 0 ? displayBeats.toFixed(1) : '')
  }, [regionLockedBeats, totalBeats])

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

  const commitBpm = (stretch = altHeldRef.current) => {
    const n = parseFloat(bpmInput)
    if (n > 0 && n <= 999) {
      if (activeRegion && onApplyBpmEdit) {
        onApplyBpmEdit(n, stretch)
      } else {
        onBpmChange(n)
      }
    } else {
      setBpmInput(String(bpm))
    }
  }

  // The out boundary is "linked" when the region is default-linked (clipout
  // follows clipin). Uses the defaultLinked flag directly.
  const outLinked = !activeRegion || activeRegion.defaultLinked

  const applyBeatCount = (n: number) => {
    if (!activeRegion || beat <= 0) return
    onLockChange?.(lock, n)
    const newOutBeat = effectiveInBeat + n * beat
    if (outLinked) {
      // Linked → move both orig and beat-space out. updateRegionInOut clears
      // beat-space overrides, re-establishing the linked (identity) mapping.
      if (!onUpdateRegionInOut) return
      const newOut = Math.min(duration, activeRegion.inPoint + n * beat)
      onUpdateRegionInOut(activeRegion.id, activeRegion.inPoint, newOut)
    } else {
      // Not linked → only change the bottom (beat-space) boundary.
      if (!onUpdateRegionBeatTimes) return
      onUpdateRegionBeatTimes(activeRegion.id, effectiveBounds?.inBeatTime ?? activeRegion.inBeatTime, newOutBeat)
    }
  }

  const commitBeats = (stretch = altHeldRef.current) => {
    if (!activeRegion || beat <= 0) {
      setBeatsInput(totalBeats > 0 ? totalBeats.toFixed(1) : '')
      return
    }
    const n = parseFloat(beatsInput)
    if (n > 0 && n <= 99999) {
      if (onApplyBeatsEdit) {
        onApplyBeatsEdit(n, stretch)
      } else {
        applyBeatCount(n)
      }
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
          <div className="rip__field rip__field--bpm" title={altHeld ? 'Alt: stretch mode — length rescales' : 'Enter BPM (hold Alt to stretch)'}>
            <input
              className={`rip__input${altHeld ? ' rip__input--stretch' : ''}`}
              type="number" min={1} max={999}
              value={bpmInput}
              onChange={e => setBpmInput(e.target.value)}
              onBlur={e => {
                // Prefer the native event's altKey when available (real browser blurring
                // while Alt is held). Fall back to the ref set by the last keyDown/keyUp
                // — reliable for the Enter-to-commit path.
                const stretch = (e.nativeEvent as MouseEvent).altKey ?? altHeldRef.current
                altHeldRef.current = false
                setAltHeld(false)
                commitBpm(stretch)
              }}
              onKeyDown={e => {
                altHeldRef.current = e.altKey
                setAltHeld(e.altKey)
                if (e.key === 'Enter') { commitBpm(e.altKey); (e.target as HTMLInputElement).blur() }
                if (e.key === 'Escape') { setBpmInput(String(bpm)); altHeldRef.current = false; setAltHeld(false); (e.target as HTMLInputElement).blur() }
                e.stopPropagation()
              }}
              onKeyUp={e => { altHeldRef.current = e.altKey; setAltHeld(e.altKey) }}
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
          <div className="rip__field rip__field--beats" title={altHeld ? 'Alt: stretch mode — length rescales' : 'Enter beats (hold Alt to stretch)'}>
            {activeRegion ? (
              <>
                <input
                  className={`rip__input${altHeld ? ' rip__input--stretch' : ''}`}
                  type="number" min={0.5} max={99999} step={1}
                  value={beatsInput}
                  onChange={e => setBeatsInput(e.target.value)}
                  onBlur={e => {
                    const stretch = (e.nativeEvent as MouseEvent).altKey ?? altHeldRef.current
                    altHeldRef.current = false
                    setAltHeld(false)
                    commitBeats(stretch)
                  }}
                  onKeyDown={e => {
                    altHeldRef.current = e.altKey
                    setAltHeld(e.altKey)
                    if (e.key === 'Enter') { commitBeats(e.altKey); (e.target as HTMLInputElement).blur() }
                    if (e.key === 'Escape') { setBeatsInput(totalBeats > 0 ? totalBeats.toFixed(1) : ''); altHeldRef.current = false; setAltHeld(false); (e.target as HTMLInputElement).blur() }
                    e.stopPropagation()
                  }}
                  onKeyUp={e => { altHeldRef.current = e.altKey; setAltHeld(e.altKey) }}
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

          {/* Reset Boundary — always shown when handler is available; disabled
               when both boundaries are default-linked (nothing to reset). */}
          {activeRegion && onResetBoundary && (
            <div className="rip__btn-group rip__btn-group--full">
              <button
                className="rip__adj rip__adj--reset"
                onClick={onResetBoundary}
                disabled={activeRegion.defaultLinked}
                title={
                  activeRegion.defaultLinked
                    ? 'Beat-space boundaries are already at default (linked to clip in/out)'
                    : 'Reset the beat-space boundary back to default (linked to clip in/out)'
                }
              >
                Reset Boundary
              </button>
            </div>
          )}
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
