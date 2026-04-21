import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { setStripFrames } from '../../store/slices/thumbnailsSlice'
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

interface StripLayout extends Strip {
  slots: { t: number; frame: number }[]
}

/**
 * Narrow row that lays out connected thumbnails between consecutive scene
 * markers. Each strip starts at a scene (or the timeline origin when no scene
 * precedes) and ends at the next scene (or duration). Thumbnails are sized
 * square to the row height and sampled at regular intervals across the strip.
 *
 * Publishes its visible slot frames to the thumbnails slice so the Filmstrip's
 * priority push includes them in the backend request — otherwise viewport
 * sampling alone isn't dense enough to fill a strip.
 */
export default function ThumbnailStripTrack({
  scenes, duration, view, label = 'Thumbs', thumbSize = 18, onSeek,
}: ThumbnailStripTrackProps) {
  const dispatch = useAppDispatch()
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
  const fps = video?.fps ?? 0

  // Lay out slots only for strips that intersect the viewport. Off-screen
  // strips contribute nothing to render and nothing to the priority push.
  const visibleStrips = useMemo<StripLayout[]>(() => {
    if (pxPerSec <= 0 || fps <= 0) return []
    const out: StripLayout[] = []
    for (const s of strips) {
      if (s.end <= view.start || s.start >= view.end) continue
      const stripPx = (s.end - s.start) * pxPerSec
      const count = Math.max(1, Math.floor(stripPx / thumbSize))
      const slotSec = (s.end - s.start) / count
      const slots: { t: number; frame: number }[] = []
      for (let k = 0; k < count; k++) {
        const t = s.start + (k + 0.5) * slotSec
        slots.push({ t, frame: Math.floor(t * fps) })
      }
      out.push({ ...s, slots })
    }
    return out
  }, [strips, pxPerSec, fps, thumbSize, view.start, view.end])

  // Publish visible slot frames to the store so Filmstrip's priority push can
  // include them in the request to the backend renderer.
  useEffect(() => {
    if (!video) return
    const fileHash = video.fileHash
    const frames: number[] = []
    const seen = new Set<number>()
    for (const s of visibleStrips) {
      for (const slot of s.slots) {
        if (!seen.has(slot.frame)) {
          seen.add(slot.frame)
          frames.push(slot.frame)
        }
      }
    }
    dispatch(setStripFrames({ fileHash, frames }))
  }, [dispatch, video, visibleStrips])

  // On unmount (e.g. user toggles the strip off), drop our priority claim so
  // the backend stops rendering strip frames for this video.
  const hashRef = useRef<string | null>(null)
  hashRef.current = video?.fileHash ?? null
  useEffect(() => () => {
    const h = hashRef.current
    if (h) dispatch(setStripFrames({ fileHash: h, frames: [] }))
  }, [dispatch])

  const thumbSrc = useCallback((frame: number): string | null => {
    const path = thumbPaths[frame]
    return path ? convertFileSrc(path) : null
  }, [thumbPaths])

  return (
    <TrackRow label={label} kind="thumbs">
      <div ref={bodyRef} className="thin-thumbs__body">
        {visibleStrips.map((s, i) => {
          const leftPct = timeToViewPct(s.start, view)
          const rightPct = timeToViewPct(s.end, view)
          const widthPct = rightPct - leftPct
          const count = s.slots.length
          return (
            <div
              key={i}
              className="thin-thumbs__strip"
              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
            >
              {s.slots.map(({ t, frame }, k) => {
                const src = thumbSrc(frame)
                return (
                  <button
                    key={k}
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
