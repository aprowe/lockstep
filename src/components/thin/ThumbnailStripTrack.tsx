import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { setStripFrames, selectThumbnailPathsFor } from '../../store/slices/thumbnailsSlice'
import type { View } from '../../types'
import { timeToViewPct } from '../../utils/view'
import TrackRow from './TrackRow'
import './ThumbnailStripTrack.css'

interface ThumbnailStripTrackProps {
  scenes: number[]
  duration: number
  view: View
  label?: string
  onSeek?: (time: number) => void
}

/**
 * Shows one thumbnail per scene marker, positioned at the marker's time.
 * Scene frames are already a priority tier on the backend, so nothing extra
 * needs to be pushed — this track just reads from the cache.
 */
export default function ThumbnailStripTrack({
  scenes, duration, view, label = 'Thumbs', onSeek,
}: ThumbnailStripTrackProps) {
  const dispatch = useAppDispatch()
  const video = useAppSelector(s => s.video.video)
  const thumbPaths = useAppSelector(selectThumbnailPathsFor(video?.fileHash))

  const [aspect, setAspect] = useState(16 / 9)
  const aspectCapturedRef = useRef(false)
  useEffect(() => { aspectCapturedRef.current = false }, [video?.fileHash])
  const handleImgLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    if (aspectCapturedRef.current) return
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget
    if (w > 0 && h > 0) {
      aspectCapturedRef.current = true
      setAspect(w / h)
    }
  }, [])

  // Clear any previously-published strip frames — this track no longer pushes
  // a dense grid; scene_frames is already its own priority tier on the backend.
  const hashRef = useRef<string | null>(null)
  hashRef.current = video?.fileHash ?? null
  useEffect(() => {
    const h = hashRef.current
    if (h) dispatch(setStripFrames({ fileHash: h, frames: [] }))
    return () => {
      const h2 = hashRef.current
      if (h2) dispatch(setStripFrames({ fileHash: h2, frames: [] }))
    }
  }, [dispatch])

  const fps = video?.fps ?? 0

  const visible = useMemo(() => {
    if (fps <= 0) return []
    return scenes
      .filter(t => t >= 0 && t <= duration && t >= view.start && t <= view.end)
      .map(t => ({ t, frame: Math.floor(t * fps) }))
  }, [scenes, duration, view.start, view.end, fps])

  return (
    <TrackRow label={label} kind="thumbs">
      <div className="thin-thumbs__body">
        {visible.map(({ t, frame }) => {
          const path = thumbPaths[frame]
          const src = path ? convertFileSrc(path) : null
          const leftPct = timeToViewPct(t, view)
          return (
            <button
              key={t}
              type="button"
              className="thin-thumbs__scene"
              style={{ left: `${leftPct}%`, aspectRatio: `${aspect}` }}
              onClick={() => onSeek?.(t)}
              title={`${t.toFixed(2)}s`}
            >
              {src ? (
                <img
                  className="thin-thumbs__img"
                  src={src}
                  alt=""
                  draggable={false}
                  onLoad={handleImgLoad}
                />
              ) : (
                <div className="thin-thumbs__placeholder" />
              )}
            </button>
          )
        })}
      </div>
    </TrackRow>
  )
}
