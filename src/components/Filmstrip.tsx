import { useCallback, useEffect, useMemo, useRef } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import {
  listenThumbnailReady,
  setThumbnailPriority,
} from '../api/thumbnails'
import { setThumbnail } from '../store/slices/thumbnailsSlice'
import { setFilmstripHeight } from '../store/slices/uiSlice'
import './Filmstrip.css'

const SLOTS = 7
const PUSH_DEBOUNCE_MS = 120

interface FilmstripProps {
  onSeekFrame?: (frame: number) => void
}

export default function Filmstrip({ onSeekFrame }: FilmstripProps) {
  const dispatch = useAppDispatch()
  const video = useAppSelector(s => s.video.video)
  const playhead = useAppSelector(s => s.warp.playhead)
  const origAnchors = useAppSelector(s => s.warp.origAnchors)
  const regions = useAppSelector(s => s.region.regions)
  const view = useAppSelector(s => s.ui.view)
  const stripHeight = useAppSelector(s => s.ui.filmstripHeight)
  const scenes = useAppSelector(s =>
    video ? s.scene.cutsByPath[video.path] ?? [] : [],
  )
  const thumbPaths = useAppSelector(s =>
    video ? s.thumbnails.pathsByHashAndFrame[video.fileHash] ?? {} : {},
  )

  // Listen once for thumbnail-ready events while the component is mounted.
  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | undefined
    listenThumbnailReady(p => {
      if (cancelled) return
      dispatch(
        setThumbnail({ fileHash: p.file_hash, frame: p.frame, path: p.path }),
      )
    }).then(u => {
      if (cancelled) u()
      else unlisten = u
    })
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [dispatch])

  // Debounced push of priority context to the backend.
  const lastPushedRef = useRef<string>('')
  useEffect(() => {
    if (!video) return
    const fps = video.fps
    const duration = video.duration
    if (fps <= 0 || duration <= 0) return

    const clampFrame = (t: number) =>
      Math.max(0, Math.min(Math.floor(duration * fps), Math.floor(t * fps)))

    const playheadFrame = clampFrame(playhead)
    const regionFrames: [number, number][] = regions.map(r => [
      clampFrame(r.inPoint),
      clampFrame(r.outPoint),
    ])
    const markerFrames = origAnchors.map(a => clampFrame(a.time))
    const sceneFrames = scenes.map(clampFrame)
    const viewportFrames: [number, number] = [clampFrame(view.start), clampFrame(view.end)]

    const signature = [
      video.fileHash,
      playheadFrame,
      regionFrames.flat().join(','),
      markerFrames.join(','),
      sceneFrames.join(','),
      viewportFrames.join(','),
    ].join('|')
    if (signature === lastPushedRef.current) return

    const timer = setTimeout(() => {
      lastPushedRef.current = signature
      setThumbnailPriority({
        fileHash: video.fileHash,
        videoPath: video.path,
        fps,
        duration,
        playheadFrame,
        regionFrames,
        markerFrames,
        sceneFrames,
        viewportFrames,
      }).catch(() => {})
    }, PUSH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [video, playhead, origAnchors, regions, scenes, view])

  const slots = useMemo(() => {
    if (!video) return []
    const fps = video.fps
    const maxFrame = Math.max(0, Math.floor(video.duration * fps))
    const center = Math.max(0, Math.min(maxFrame, Math.floor(playhead * fps)))
    const markerFrameSet = new Set(origAnchors.map(a => Math.floor(a.time * fps)))
    const half = Math.floor(SLOTS / 2)
    const result: { frame: number; offset: number; inBounds: boolean; hasMarker: boolean }[] = []
    for (let i = -half; i <= half; i++) {
      const frame = center + i
      result.push({
        frame,
        offset: i,
        inBounds: frame >= 0 && frame <= maxFrame,
        hasMarker: markerFrameSet.has(frame),
      })
    }
    return result
  }, [video, playhead, origAnchors])

  const resizeStart = useRef<{ y: number; h: number } | null>(null)
  const handleResizeDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      resizeStart.current = { y: e.clientY, h: stripHeight }
      const onMove = (ev: MouseEvent) => {
        if (!resizeStart.current) return
        const delta = resizeStart.current.y - ev.clientY
        dispatch(setFilmstripHeight(resizeStart.current.h + delta))
      }
      const onUp = () => {
        resizeStart.current = null
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [dispatch, stripHeight],
  )

  if (!video) return null

  return (
    <div className="filmstrip-wrap" style={{ height: stripHeight }}>
      <div
        className="filmstrip__resizer"
        onMouseDown={handleResizeDown}
        role="separator"
        aria-label="Resize filmstrip"
      />
      <div className="filmstrip" role="group" aria-label="Thumbnail filmstrip">
        {slots.map(({ frame, offset, inBounds, hasMarker }) => {
          const path = inBounds ? thumbPaths[frame] : undefined
          const src = path ? convertFileSrc(path) : null
          const classes = [
            'filmstrip__slot',
            offset === 0 ? 'filmstrip__slot--center' : '',
            !inBounds ? 'filmstrip__slot--out' : '',
            hasMarker ? 'filmstrip__slot--marker' : '',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <button
              key={offset}
              className={classes}
              disabled={!inBounds}
              onClick={() => inBounds && onSeekFrame?.(frame)}
              title={inBounds ? `Frame ${frame}` : ''}
            >
              {src ? (
                <img className="filmstrip__img" src={src} alt="" draggable={false} />
              ) : (
                <div className="filmstrip__placeholder" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
