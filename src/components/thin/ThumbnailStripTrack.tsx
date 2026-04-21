import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { useAppSelector } from '../../store/hooks'
import type { View } from '../../types'
import { timeToViewPct } from '../../utils/view'
import TrackRow from './TrackRow'
import './ThumbnailStripTrack.css'

interface ThumbnailStripTrackProps {
  scenes: number[]
  duration: number
  view: View
  label?: string
  /** Pixel height of a thumbnail — also used as its width for square slots. */
  thumbSize?: number
  onSeek?: (time: number) => void
}

interface Strip {
  start: number
  end: number
}

/**
 * Narrow row that lays out connected thumbnails between consecutive scene
 * markers. Each strip starts at a scene (or the timeline origin when no scene
 * precedes) and ends at the next scene (or duration). Thumbnails are sized
 * square to the row height and sampled at regular intervals across the strip.
 *
 * Uses whatever thumbnails the backend has cached. Missing frames render as
 * placeholders — no new priority signal is sent, so the component relies on
 * the viewport-sampling the Filmstrip already primes.
 */
export default function ThumbnailStripTrack({
  scenes, duration, view, label = 'Thumbs', thumbSize = 18, onSeek,
}: ThumbnailStripTrackProps) {
  const video = useAppSelector(s => s.video.video)
  const thumbPaths = useAppSelector(s =>
    video ? s.thumbnails.pathsByHashAndFrame[video.fileHash] ?? {} : {},
  )

  const bodyRef = useRef<HTMLDivElement>(null)
  const [bodyWidth, setBodyWidth] = useState(0)

  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setBodyWidth(e.contentRect.width)
    })
    ro.observe(el)
    setBodyWidth(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])

  const strips = useMemo<Strip[]>(() => {
    const sorted = [...scenes].filter(t => t >= 0 && t <= duration).sort((a, b) => a - b)
    const out: Strip[] = []
    if (sorted.length === 0) {
      if (duration > 0) out.push({ start: 0, end: duration })
      return out
    }
    if (sorted[0] > 0) out.push({ start: 0, end: sorted[0] })
    for (let i = 0; i < sorted.length; i++) {
      const start = sorted[i]
      const end = i + 1 < sorted.length ? sorted[i + 1] : duration
      if (end > start) out.push({ start, end })
    }
    return out
  }, [scenes, duration])

  const viewSpan = view.end - view.start
  const pxPerSec = bodyWidth > 0 && viewSpan > 0 ? bodyWidth / viewSpan : 0

  const thumbSrc = useCallback((t: number): string | null => {
    if (!video || video.fps <= 0) return null
    const frame = Math.floor(t * video.fps)
    const path = thumbPaths[frame]
    return path ? convertFileSrc(path) : null
  }, [video, thumbPaths])

  return (
    <TrackRow label={label} kind="thumbs">
      <div ref={bodyRef} className="thin-thumbs__body">
        {pxPerSec > 0 && strips.map((s, i) => {
          const leftPct = timeToViewPct(s.start, view)
          const rightPct = timeToViewPct(s.end, view)
          if (rightPct < -1 || leftPct > 101) return null
          const widthPct = rightPct - leftPct
          const stripPx = Math.max(0, (s.end - s.start) * pxPerSec)
          const count = Math.max(1, Math.floor(stripPx / thumbSize))
          const slotSec = (s.end - s.start) / count
          const slots: { t: number; key: number }[] = []
          for (let k = 0; k < count; k++) {
            slots.push({ t: s.start + (k + 0.5) * slotSec, key: k })
          }
          return (
            <div
              key={i}
              className="thin-thumbs__strip"
              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
            >
              {slots.map(({ t, key }) => {
                const src = thumbSrc(t)
                return (
                  <button
                    key={key}
                    type="button"
                    className="thin-thumbs__slot"
                    style={{ width: `${100 / count}%` }}
                    onClick={() => onSeek?.(t)}
                    title={`${t.toFixed(2)}s`}
                  >
                    {src ? (
                      <img
                        className="thin-thumbs__img"
                        src={src}
                        alt=""
                        draggable={false}
                      />
                    ) : (
                      <div className="thin-thumbs__placeholder" />
                    )}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </TrackRow>
  )
}
