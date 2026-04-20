import { forwardRef, useRef, useImperativeHandle } from 'react'
import './VideoPlayer.css'

export interface VideoPlayerHandle {
  seek(time: number): void
  play(): void
  pause(): void
  toggle(): void
  setPlaybackRate(rate: number): void
  get currentTime(): number
  get playing(): boolean
  get videoElement(): HTMLVideoElement | null
}

interface VideoPlayerProps {
  src: string
  duration: number
  onTimeUpdate?: (time: number) => void
  onPlayStateChange?: (playing: boolean) => void
}

export default forwardRef<VideoPlayerHandle, VideoPlayerProps>(function VideoPlayer(
  { src, duration, onTimeUpdate, onPlayStateChange },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const playingRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const onTimeUpdateRef = useRef(onTimeUpdate)
  onTimeUpdateRef.current = onTimeUpdate
  const lastEmittedRef = useRef(0)

  function emit(t: number) {
    lastEmittedRef.current = t
    onTimeUpdateRef.current?.(t)
  }

  // Some files (edit-list mp4s, odd duration metadata) fire `pause`/`ended`
  // with currentTime=0 even though playback was mid-video. In that case the
  // last raf tick has the real position — don't clobber it with 0.
  function emitIfNotSpuriousZero() {
    const t = videoRef.current?.currentTime ?? 0
    if (t === 0 && lastEmittedRef.current > 0.05) return
    emit(t)
  }

  function startRaf() {
    if (rafRef.current !== null) return
    const tick = () => {
      if (!playingRef.current) { rafRef.current = null; return }
      emit(videoRef.current?.currentTime ?? 0)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  function stopRaf() {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
  }

  useImperativeHandle(ref, () => ({
    seek(time: number) {
      if (videoRef.current) videoRef.current.currentTime = Math.max(0, Math.min(duration, time))
    },
    play() { videoRef.current?.play() },
    pause() { videoRef.current?.pause() },
    toggle() {
      const v = videoRef.current
      if (!v) return
      playingRef.current ? v.pause() : v.play()
    },
    setPlaybackRate(rate: number) {
      if (videoRef.current) videoRef.current.playbackRate = rate
    },
    get currentTime() { return videoRef.current?.currentTime ?? 0 },
    get playing() { return playingRef.current },
    get videoElement() { return videoRef.current },
  }))

  return (
    <div className="video-player">
      <video
        ref={videoRef}
        src={src}
        className="video-player__video"
        onPlay={() => {
          playingRef.current = true
          onPlayStateChange?.(true)
          startRaf()
        }}
        onPause={() => {
          playingRef.current = false
          onPlayStateChange?.(false)
          stopRaf()
          emitIfNotSpuriousZero()
        }}
        onEnded={() => {
          playingRef.current = false
          onPlayStateChange?.(false)
          stopRaf()
          emitIfNotSpuriousZero()
        }}
        onSeeked={() => {
          if (!playingRef.current) {
            emit(videoRef.current?.currentTime ?? 0)
          }
        }}
      />
    </div>
  )
})
