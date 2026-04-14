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
        onTimeUpdate={e => onTimeUpdate?.((e.target as HTMLVideoElement).currentTime)}
        onPlay={() => { playingRef.current = true; onPlayStateChange?.(true) }}
        onPause={() => { playingRef.current = false; onPlayStateChange?.(false) }}
        onEnded={() => { playingRef.current = false; onPlayStateChange?.(false) }}
      />
    </div>
  )
})
