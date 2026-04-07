import { forwardRef, useRef, useState, useImperativeHandle, useEffect } from 'react'
import './VideoPlayer.css'

export interface VideoPlayerHandle {
  seek(time: number): void
}

interface VideoPlayerProps {
  src: string
  duration: number
  fps: number
  onTimeUpdate?: (time: number) => void
  onMark?: (time: number) => void
}

function pad(n: number) { return String(Math.floor(n)).padStart(2, '0') }
function fmt(s: number) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${pad(m)}:${sec.toFixed(2).padStart(5, '0')}`
}

export default forwardRef<VideoPlayerHandle, VideoPlayerProps>(function VideoPlayer(
  { src, duration, fps, onTimeUpdate, onMark },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const onMarkRef = useRef(onMark)
  onMarkRef.current = onMark

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'm' || e.key === 'M') {
        const active = document.activeElement
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return
        onMarkRef.current?.(videoRef.current?.currentTime ?? 0)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useImperativeHandle(ref, () => ({
    seek(time: number) {
      if (videoRef.current) {
        videoRef.current.currentTime = Math.max(0, Math.min(duration, time))
      }
    },
  }))

  const toggle = () => {
    const v = videoRef.current
    if (!v) return
    playing ? v.pause() : v.play()
  }

  const step = (frames: number) => {
    const v = videoRef.current
    if (!v) return
    v.pause()
    v.currentTime = Math.max(0, Math.min(duration, v.currentTime + frames / fps))
  }

  const rewind = () => {
    const v = videoRef.current
    if (v) v.currentTime = 0
  }

  return (
    <div className="video-player">
      <div className="video-player__screen">
        <video
          ref={videoRef}
          src={src}
          className="video-player__video"
          onTimeUpdate={e => {
            const t = (e.target as HTMLVideoElement).currentTime
            setCurrentTime(t)
            onTimeUpdate?.(t)
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
      </div>

      <div className="video-player__controls">
        <button className="vp-btn" onClick={rewind} title="Rewind">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/>
          </svg>
        </button>
        <button className="vp-btn" onClick={() => step(-1)} title="Step back">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 6h2v12H6zm12 0-8.5 6 8.5 6z"/>
          </svg>
        </button>
        <button className="vp-btn vp-btn--play" onClick={toggle} title={playing ? 'Pause' : 'Play'}>
          {playing ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 19h4V5H6zm8-14v14h4V5z"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z"/>
            </svg>
          )}
        </button>
        <button className="vp-btn" onClick={() => step(1)} title="Step forward">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M16 6h2v12h-2zM6 6l8.5 6L6 18z"/>
          </svg>
        </button>

        <div className="vp-time">
          <span className="vp-time__current">{fmt(currentTime)}</span>
          <span className="vp-time__sep">/</span>
          <span className="vp-time__total">{fmt(duration)}</span>
        </div>

        {onMark && (
          <button
            className="vp-btn vp-btn--mark"
            onClick={() => onMark(videoRef.current?.currentTime ?? 0)}
            title="Place marker at playhead (M)"
          >
            M
          </button>
        )}
        <div className="vp-hint">Click ruler to seek · M to mark</div>
      </div>
    </div>
  )
})
