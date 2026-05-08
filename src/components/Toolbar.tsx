import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { VideoPlayerHandle } from './VideoPlayer'
import {
  IconPlay, IconPause, IconPrevFrame, IconNextFrame,
  IconCreateMarker, IconPrevMarker, IconNextMarker,
  IconCreateRegion, IconSetRegionStart, IconSetRegionEnd,
  IconGoToRegionStart, IconGoToRegionEnd,
  IconCreateScene, IconPrevScene, IconNextScene,
  IconLoopStop, IconLoopRepeat, IconLoopContinue,
} from './icons'
import type { PlaybackLoopMode } from '../store/slices/uiSlice'
import { secondsToFrames } from '../utils/time'
import { tooltipFor } from '../hotkeys'
import './Toolbar.css'

function pad(n: number) { return String(Math.floor(n)).padStart(2, '0') }
function fmt(s: number) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${pad(m)}:${sec.toFixed(2).padStart(5, '0')}`
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]

interface ToolbarProps {
  playerRef: RefObject<VideoPlayerHandle | null>
  duration: number
  fps: number
  playing: boolean
  currentTime: number
  onMark?: (time: number) => void
  onJumpPrev?: () => void
  onJumpNext?: () => void
  onSetIn?: () => void
  onSetOut?: () => void
  onNewRegion?: () => void
  onPrevRegion?: () => void
  onNextRegion?: () => void
  onJumpRegionStart?: () => void
  onJumpRegionEnd?: () => void
  onDeleteRegion?: () => void
  onNewScene?: () => void
  onPrevScene?: () => void
  onNextScene?: () => void
  /** What playback does when the playhead reaches the end of the active
   *  clip (or video). When omitted the selector is hidden. */
  playbackLoopMode?: PlaybackLoopMode
  onPlaybackLoopModeChange?: (mode: PlaybackLoopMode) => void
  /** Beat position of the playhead — relative to the active region's
   *  in-point if there is one, else to the warp's beat-zero. Null when
   *  no BPM is set yet. */
  currentBeat?: number | null
}

export default function Toolbar({
  playerRef, duration, fps, playing, currentTime,
  onMark, onJumpPrev, onJumpNext, onSetIn, onSetOut,
  onNewRegion, onJumpRegionStart, onJumpRegionEnd, onDeleteRegion,
  onNewScene, onPrevScene, onNextScene,
  playbackLoopMode, onPlaybackLoopModeChange,
  currentBeat,
}: ToolbarProps) {
  const [speed, setSpeed] = useState(1)
  const [editingFrame, setEditingFrame] = useState(false)
  const [frameInput, setFrameInput] = useState('')
  const onMarkRef = useRef(onMark); onMarkRef.current = onMark
  const onSetInRef = useRef(onSetIn); onSetInRef.current = onSetIn
  const onSetOutRef = useRef(onSetOut); onSetOutRef.current = onSetOut
  const onDeleteRegionRef = useRef(onDeleteRegion); onDeleteRegionRef.current = onDeleteRegion

  const fpsRef = useRef(fps); fpsRef.current = fps
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const active = document.activeElement
      const inInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')
      if (inInput) return
      if (e.key === ' ') { e.preventDefault(); playerRef.current?.toggle() }
      if (e.key === 'm' || e.key === 'M') onMarkRef.current?.(playerRef.current?.currentTime ?? 0)
      if (e.key === 'i' || e.key === 'I') onSetInRef.current?.()
      if (e.key === 'o' || e.key === 'O') onSetOutRef.current?.()
      if (e.key === 'Delete' && e.ctrlKey) { e.preventDefault(); onDeleteRegionRef.current?.() }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const dir = e.key === 'ArrowRight' ? 1 : -1
        const f = fpsRef.current
        let delta: number
        if (e.altKey) delta = dir * 1
        else if (e.shiftKey) delta = dir * (f > 0 ? 10 / f : 0)
        else delta = dir * (f > 0 ? 1 / f : 0)
        const p = playerRef.current
        if (!p || delta === 0) return
        e.preventDefault()
        p.pause()
        p.seek(p.currentTime + delta)
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
  const changeSpeed = (rate: number) => { setSpeed(rate); playerRef.current?.setPlaybackRate(rate) }

  return (
    <div className="toolbar">

      <div className="tb-side tb-side--left">

        {/* ── Scene ── */}
        <div className="tb-group tb-group--scene">
          <span className="tb-group-label">Scene</span>
          <div className="tb-group-buttons">
            <button
              data-layout-id="new-scene"
              className="tb-btn tb-btn--create"
              onClick={onNewScene}
              disabled={!onNewScene}
              title="New scene marker at playhead"
            >
              <IconCreateScene size={18} />
            </button>
            <div className="tb-pair">
              <button
                data-layout-id="prev-scene"
                className="tb-btn tb-btn--nav"
                onClick={onPrevScene}
                disabled={!onPrevScene}
                title="Previous scene marker"
              >
                <IconPrevScene size={18} />
              </button>
              <button
                data-layout-id="next-scene"
                className="tb-btn tb-btn--nav"
                onClick={onNextScene}
                disabled={!onNextScene}
                title="Next scene marker"
              >
                <IconNextScene size={18} />
              </button>
            </div>
          </div>
        </div>

        <div data-layout-sep className="tb-sep" />

        {/* ── Region ── */}
        <div className="tb-group tb-group--region">
          <span className="tb-group-label">Region</span>
          <div className="tb-group-buttons">
            <div className="tb-pair">
              <button
                data-layout-id="set-in-region"
                className="tb-btn tb-btn--delimit"
                onClick={onSetIn}
                disabled={!onSetIn}
                title={tooltipFor('Set In', 'set-in')}
              >
                <IconSetRegionStart size={18} />
              </button>
              <button
                data-layout-id="set-out-region"
                className="tb-btn tb-btn--delimit"
                onClick={onSetOut}
                disabled={!onSetOut}
                title={tooltipFor('Set Out', 'set-out')}
              >
                <IconSetRegionEnd size={18} />
              </button>
            </div>
            <button
              data-layout-id="new-region"
              className="tb-btn tb-btn--create"
              onClick={onNewRegion}
              disabled={!onNewRegion}
              title="New region"
            >
              <IconCreateRegion size={18} />
            </button>
            <div className="tb-pair">
              <button
                data-layout-id="jump-to-region-start"
                className="tb-btn tb-btn--nav"
                onClick={onJumpRegionStart}
                disabled={!onJumpRegionStart}
                title="Jump to region start"
              >
                <IconGoToRegionStart size={18} />
              </button>
              <button
                data-layout-id="jump-to-region-end"
                className="tb-btn tb-btn--nav"
                onClick={onJumpRegionEnd}
                disabled={!onJumpRegionEnd}
                title="Jump to region end"
              >
                <IconGoToRegionEnd size={18} />
              </button>
            </div>
          </div>
        </div>

        <div data-layout-sep className="tb-sep" />

        {/* ── Markers ── */}
        <div className="tb-group tb-group--marker">
          <span className="tb-group-label">Markers</span>
          <div className="tb-group-buttons">
            <button
              data-layout-id="new-marker"
              className="tb-btn tb-btn--create"
              onClick={() => onMark?.(playerRef.current?.currentTime ?? 0)}
              disabled={!onMark}
              title={tooltipFor('Place marker', 'mark')}
            >
              <IconCreateMarker size={18} />
            </button>
            <div className="tb-pair">
              <button
                data-layout-id="prev-marker"
                className="tb-btn tb-btn--nav"
                onClick={onJumpPrev}
                disabled={!onJumpPrev}
                title="Previous marker"
              >
                <IconPrevMarker size={18} />
              </button>
              <button
                data-layout-id="next-marker"
                className="tb-btn tb-btn--nav"
                onClick={onJumpNext}
                disabled={!onJumpNext}
                title="Next marker"
              >
                <IconNextMarker size={18} />
              </button>
            </div>
          </div>
        </div>

      </div>

      {/* invisible group boundary marker for layout tests */}
      <span data-layout-sep aria-hidden="true" style={{ display: 'none' }} />

      {/* ── Center: play controls ── */}
      <div className="tb-group tb-group--center tb-group--playback">
        <button
          data-layout-id="play"
          className="tb-btn tb-btn--play"
          onClick={toggle}
          title={tooltipFor(playing ? 'Pause' : 'Play', 'play-pause')}
        >
          {playing ? <IconPause size={18} /> : <IconPlay size={18} />}
        </button>
        <div className="tb-group-buttons">
        <div className="tb-pair tb-pair--playback">
          <button data-layout-id="prev-frame" className="tb-btn" onClick={() => step(-1)} title="Step back 1 frame">
            <IconPrevFrame size={18} />
          </button>
          <button data-layout-id="next-frame" className="tb-btn" onClick={() => step(1)} title="Step forward 1 frame">
            <IconNextFrame size={18} />
          </button>
        </div>
        {playbackLoopMode && onPlaybackLoopModeChange && (() => {
          const next: Record<PlaybackLoopMode, PlaybackLoopMode> = {
            continue: 'loop',
            loop: 'stop',
            stop: 'continue',
          }
          const label: Record<PlaybackLoopMode, string> = {
            continue: 'Continue past end',
            loop: 'Loop clip',
            stop: 'Stop at end',
          }
          const Icon = playbackLoopMode === 'loop' ? IconLoopRepeat
                     : playbackLoopMode === 'stop' ? IconLoopStop
                     : IconLoopContinue
          return (
            <button
              data-layout-id="playback-loop-mode"
              className={`tb-btn tb-btn--loop-mode${playbackLoopMode !== 'continue' ? ' tb-btn--loop-mode--active' : ''}`}
              onClick={() => onPlaybackLoopModeChange(next[playbackLoopMode])}
              title={`${label[playbackLoopMode]} (click for ${label[next[playbackLoopMode]].toLowerCase()})`}
              aria-label={`Playback loop mode: ${label[playbackLoopMode]}`}
            >
              <Icon size={18} />
            </button>
          )
        })()}
        </div>
        <div className="tb-time">
          <div className="tb-time__clock">
            <span data-layout-id="play-time" className="tb-time__current">{fmt(currentTime)}</span>
            <span className="tb-time__total">{fmt(duration)}</span>
          </div>
          <div className="tb-time__counts">
            {editingFrame ? (
              <input
                data-layout-id="frame-count"
                className="tb-time__frames-input"
                data-testid="frame-count-input"
                type="number"
                value={frameInput}
                autoFocus
                onChange={e => setFrameInput(e.target.value)}
                onBlur={() => {
                  const n = parseInt(frameInput, 10)
                  if (fps > 0 && Number.isFinite(n) && n >= 0) {
                    playerRef.current?.seek(n / fps)
                  }
                  setEditingFrame(false)
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  if (e.key === 'Escape') setEditingFrame(false)
                  e.stopPropagation()
                }}
              />
            ) : (
              <span
                data-layout-id="frame-count"
                className="tb-time__frames"
                data-testid="frame-count"
                onClick={() => { setFrameInput(String(Math.round(currentTime * fps))); setEditingFrame(true) }}
                title="Click to edit frame"
              >
                <span className="tb-time__count-value">{secondsToFrames(currentTime, fps)}</span>
                <span className="tb-time__count-label">frames</span>
              </span>
            )}
            <span
              data-layout-id="beat-count-clip-based"
              className="tb-time__beats"
              title={currentBeat != null ? 'Beat position at playhead' : 'No BPM set'}
            >
              <span className="tb-time__count-value">
                {currentBeat != null ? currentBeat.toFixed(1) : '—'}
              </span>
              <span className="tb-time__count-label">beats</span>
            </span>
          </div>
        </div>
      </div>

      {/* invisible group boundary marker for layout tests */}
      <span data-layout-sep aria-hidden="true" style={{ display: 'none' }} />

      {/* ── Right: speed ── */}
      <div className="tb-side tb-side--right">
        <div className="tb-group">
          <span data-layout-id="speed" className="tb-label">Speed</span>
          <select className="tb-select" value={speed} onChange={e => changeSpeed(parseFloat(e.target.value))} title="Playback speed">
            {SPEEDS.map(s => <option key={s} value={s}>{s === 1 ? '1×' : `${s}×`}</option>)}
          </select>
        </div>
      </div>

    </div>
  )
}
