import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { VideoPlayerHandle } from './VideoPlayer'
import './Toolbar.css'

function pad(n: number) { return String(Math.floor(n)).padStart(2, '0') }
function fmt(s: number) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${pad(m)}:${sec.toFixed(2).padStart(5, '0')}`
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]

const GRID_DIVS: { label: string; value: number }[] = [
  { label: '1/1', value: 1 },
  { label: '1/2', value: 2 },
  { label: '1/2T', value: 3 },
  { label: '1/4', value: 4 },
  { label: '1/4T', value: 6 },
  { label: '1/8', value: 8 },
]

interface ToolbarProps {
  playerRef: RefObject<VideoPlayerHandle | null>
  duration: number
  fps: number
  playing: boolean
  currentTime: number
  onMark?: (time: number) => void
  onJumpPrev?: () => void
  onJumpNext?: () => void
  onZoomToRegion?: () => void
  onSetIn?: () => void
  onSetOut?: () => void
  bpm?: number
  onBpmChange?: (bpm: number) => void
  onBpmDetect?: () => Promise<void>
  detectingBpm?: boolean
  anchorCount?: number
  gridDiv?: number
  onGridDivChange?: (div: number) => void
  onNewRegion?: () => void
}

export default function Toolbar({
  playerRef, duration, fps, playing, currentTime,
  onMark, onJumpPrev, onJumpNext, onZoomToRegion, onSetIn, onSetOut,
  bpm, onBpmChange, onBpmDetect, detectingBpm, anchorCount = 0,
  gridDiv, onGridDivChange, onNewRegion,
}: ToolbarProps) {
  const [bpmInput, setBpmInput] = useState(String(bpm ?? 120))
  const [speed, setSpeed] = useState(1)
  const onMarkRef = useRef(onMark); onMarkRef.current = onMark
  const onSetInRef = useRef(onSetIn); onSetInRef.current = onSetIn
  const onSetOutRef = useRef(onSetOut); onSetOutRef.current = onSetOut

  // Tap tempo state
  const tapTimesRef = useRef<number[]>([])
  const tapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { if (bpm != null) setBpmInput(String(bpm)) }, [bpm])

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const active = document.activeElement
      const inInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')
      if (inInput) return
      if (e.key === ' ') {
        e.preventDefault()
        playerRef.current?.toggle()
      }
      if (e.key === 'm' || e.key === 'M') {
        onMarkRef.current?.(playerRef.current?.currentTime ?? 0)
      }
      if (e.key === 'i' || e.key === 'I') {
        onSetInRef.current?.()
      }
      if (e.key === 'o' || e.key === 'O') {
        onSetOutRef.current?.()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [playerRef])

  const toggle = () => playerRef.current?.toggle()
  const step = (frames: number) => {
    const p = playerRef.current
    if (!p) return
    p.pause()
    p.seek(p.currentTime + frames / fps)
  }
  const rewind = () => playerRef.current?.seek(0)

  const changeSpeed = (rate: number) => {
    setSpeed(rate)
    playerRef.current?.setPlaybackRate(rate)
  }

  const commitBpm = () => {
    const n = parseFloat(bpmInput)
    if (n > 0 && n <= 999) onBpmChange?.(n)
    else setBpmInput(String(bpm ?? 120))
  }

  const handleTap = () => {
    const now = performance.now()
    const taps = tapTimesRef.current
    if (taps.length > 0 && now - taps[taps.length - 1] > 2000) tapTimesRef.current = []
    tapTimesRef.current.push(now)
    if (tapTimeoutRef.current) clearTimeout(tapTimeoutRef.current)
    tapTimeoutRef.current = setTimeout(() => { tapTimesRef.current = [] }, 2000)
    if (tapTimesRef.current.length >= 2) {
      const intervals = tapTimesRef.current.slice(1).map((t, i) => t - tapTimesRef.current[i])
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length
      const bpmValue = Math.round(60000 / avg)
      if (bpmValue > 0 && bpmValue <= 999) { setBpmInput(String(bpmValue)); onBpmChange?.(bpmValue) }
    }
  }

  return (
    <div className="toolbar">

      {/* Left: marker button + in/out + jump */}
      <div className="tb-side tb-side--left">
        {onMark && (
          <button className="tb-btn tb-btn--mark" onClick={() => onMark(playerRef.current?.currentTime ?? 0)} title="Place marker at playhead (M)">M</button>
        )}
        {onSetIn && (
          <button className="tb-btn tb-btn--inout" onClick={onSetIn} title="Set region In point at playhead (I)">I</button>
        )}
        {onSetOut && (
          <button className="tb-btn tb-btn--inout" onClick={onSetOut} title="Set region Out point at playhead (O)">O</button>
        )}
        {onNewRegion && (
          <button className="tb-btn tb-btn--region" onClick={onNewRegion} title="New region at playhead">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="4" x2="12" y2="20"/><line x1="4" y1="12" x2="20" y2="12"/></svg>
          </button>
        )}
        <button className="tb-btn" onClick={onJumpPrev} disabled={!onJumpPrev} title="Jump to previous marker">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm12 0-8.5 6 8.5 6z"/></svg>
        </button>
        <button className="tb-btn" onClick={onJumpNext} disabled={!onJumpNext} title="Jump to next marker">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM6 6l8.5 6L6 18z"/></svg>
        </button>
        {onZoomToRegion && (
          <button className="tb-btn" onClick={onZoomToRegion} title="Reset view to current region">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M4 5v14M20 5v14" stroke="currentColor" strokeWidth="2" fill="none"/>
              <path d="M7 12h10M7 12l3-3M7 12l3 3M17 12l-3-3M17 12l-3 3"/>
            </svg>
          </button>
        )}
      </div>

      {/* Center: transport */}
      <div className="tb-center">
        <button className="tb-btn" onClick={rewind} title="Rewind">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
        </button>
        <button className="tb-btn" onClick={() => step(-1)} title="Step back">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm12 0-8.5 6 8.5 6z"/></svg>
        </button>
        <button className="tb-btn tb-btn--play" onClick={toggle} title={playing ? 'Pause' : 'Play'}>
          {playing
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6zm8-14v14h4V5z"/></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>}
        </button>
        <button className="tb-btn" onClick={() => step(1)} title="Step forward">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM6 6l8.5 6L6 18z"/></svg>
        </button>
        <div className="tb-time">
          <span className="tb-time__current">{fmt(currentTime)}</span>
          <span className="tb-time__sep">/</span>
          <span className="tb-time__total">{fmt(duration)}</span>
        </div>
      </div>

      {/* Right: speed + grid + BPM controls */}
      <div className="tb-side tb-side--right">
        <span className="tb-label">Speed</span>
        <select
          className="tb-select"
          value={speed}
          onChange={e => changeSpeed(parseFloat(e.target.value))}
          title="Playback speed"
        >
          {SPEEDS.map(s => <option key={s} value={s}>{s === 1 ? '1×' : `${s}×`}</option>)}
        </select>
        {onGridDivChange && (
          <>
            <span className="tb-label">Grid</span>
            <select
              className="tb-select"
              value={gridDiv ?? 1}
              onChange={e => onGridDivChange(parseInt(e.target.value))}
              title="Beat grid subdivision"
            >
              {GRID_DIVS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
          </>
        )}
        {onBpmChange && (
          <>
            <span className="tb-bpm-label">BPM</span>
            <input
              className="tb-bpm-input"
              type="number" min={1} max={999}
              value={bpmInput}
              onChange={e => setBpmInput(e.target.value)}
              onBlur={commitBpm}
              onKeyDown={e => e.key === 'Enter' && commitBpm()}
            />
            <button className="tb-btn tb-btn--tap" onClick={handleTap} title="Tap tempo">Tap</button>
            {onBpmDetect && (
              <button className="tb-btn" onClick={onBpmDetect} disabled={detectingBpm || anchorCount < 2} title="Detect BPM from anchors">
                {detectingBpm ? '...' : '\u27F3'}
              </button>
            )}
          </>
        )}
      </div>

    </div>
  )
}
