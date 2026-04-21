import { useCallback, useMemo } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { useAppSelector } from '../store/hooks'
import { selectThumbnailPathsFor } from '../store/slices/thumbnailsSlice'
import type { View } from '../types'
import { timeToViewPct } from '../utils/view'
import { useSetThumbnailHover } from './ThumbnailPopup'
import './SceneRow.css'

interface SceneRowProps {
  /** Scene change times in orig (input) seconds. */
  scenes: number[]
  view: View
  /** Clip duration — used to clamp projection. */
  duration: number
  /** When true, expand to show scene index labels per diamond. */
  expanded?: boolean
  /** Click on a scene diamond — receives the scene time. */
  onSceneClick?: (time: number) => void
  /** Fired on diamond hover enter (time) / leave (null). */
  onSceneHover?: (time: number | null) => void
  /** Current playhead time — highlights the closest scene within one frame. */
  playhead?: number
  /** Shift-click or double-click on a scene diamond — remove that scene. */
  onSceneDelete?: (time: number) => void
  /** Double-click on the empty row background — add a scene at that timestamp. */
  onSceneAdd?: (time: number) => void
  /** Right-click on a scene diamond — caller shows a context menu. */
  onSceneContextMenu?: (time: number, x: number, y: number) => void
  /** Right-click on the empty row background — global timeline menu. */
  onBackgroundContextMenu?: (time: number, x: number, y: number) => void
}

const PLAYHEAD_MATCH_TOLERANCE = 0.05 // ~1 video frame at 20fps

export default function SceneRow({
  scenes, view, duration, expanded, onSceneClick, onSceneHover, playhead,
  onSceneDelete, onSceneAdd, onSceneContextMenu, onBackgroundContextMenu,
}: SceneRowProps) {
  const video = useAppSelector(s => s.video.video)
  const thumbPaths = useAppSelector(selectThumbnailPathsFor(video?.fileHash))
  const setThumbnailHover = useSetThumbnailHover()

  // Precompute the per-scene inline thumbnail URLs only when expanded. Without
  // this, convertFileSrc runs N times per render (N = scene count), and the
  // render runs on every playhead tick during playback.
  const inlineSrcs = useMemo<(string | null)[]>(() => {
    if (!expanded || !video || video.fps <= 0) return []
    return scenes.map(t => {
      const path = thumbPaths[Math.floor(t * video.fps)]
      return path ? convertFileSrc(path) : null
    })
  }, [expanded, scenes, thumbPaths, video])

  // Active-scene index: the scene closest to the current playhead (within
  // one video frame). Memoized so repeated playhead ticks that don't cross
  // a scene boundary don't force a full recomputation.
  const activeIdx = useMemo(() => {
    if (playhead === undefined) return -1
    let best = -1
    let bestDist = PLAYHEAD_MATCH_TOLERANCE
    for (let i = 0; i < scenes.length; i++) {
      const d = Math.abs(scenes[i] - playhead)
      if (d <= bestDist) { bestDist = d; best = i }
    }
    return best
  }, [scenes, playhead])

  // Diamond hover — fires onSceneHover always; popup only in collapsed mode
  // (expanded mode already shows the thumbnail inline).
  const handleDiamondEnter = useCallback(
    (time: number, e: React.MouseEvent<HTMLElement>) => {
      onSceneHover?.(time)
      if (expanded) return
      const rect = e.currentTarget.getBoundingClientRect()
      setThumbnailHover({ time, x: rect.left + rect.width / 2, y: rect.top })
    },
    [onSceneHover, expanded, setThumbnailHover],
  )

  const handleLeave = useCallback(() => {
    onSceneHover?.(null)
    setThumbnailHover(null)
  }, [onSceneHover, setThumbnailHover])

  // Double-click on empty row background → add a cut at the clicked timestamp.
  const handleBackgroundDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onSceneAdd) return
      if (e.target !== e.currentTarget) return
      const rect = e.currentTarget.getBoundingClientRect()
      const pct = (e.clientX - rect.left) / rect.width
      const span = view.end - view.start
      const t = view.start + Math.max(0, Math.min(1, pct)) * span
      if (t >= 0 && t <= duration) onSceneAdd(t)
    },
    [onSceneAdd, view.start, view.end, duration],
  )

  const handleBackgroundContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onBackgroundContextMenu) return
      if (e.target !== e.currentTarget) return
      e.preventDefault(); e.stopPropagation()
      const rect = e.currentTarget.getBoundingClientRect()
      const pct = (e.clientX - rect.left) / rect.width
      const t = view.start + Math.max(0, Math.min(1, pct)) * (view.end - view.start)
      onBackgroundContextMenu(t, e.clientX, e.clientY)
    },
    [onBackgroundContextMenu, view.start, view.end],
  )

  return (
    <div
      className={`scene-row${expanded ? ' scene-row--expanded' : ''}`}
      onDoubleClick={handleBackgroundDoubleClick}
      onContextMenu={handleBackgroundContextMenu}
    >
      {scenes.map((t, i) => {
        if (t < 0 || t > duration) return null
        const x = timeToViewPct(t, view)
        if (x < -2 || x > 102) return null
        const active = i === activeIdx
        const inlineSrc = expanded ? inlineSrcs[i] ?? null : null
        return (
          <div key={i} className="scene-row__marker" style={{ left: `${x}%` }}>
            <button
              type="button"
              className={`scene-row__diamond${active ? ' scene-row__diamond--active' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                if (e.shiftKey && onSceneDelete) onSceneDelete(t)
                else onSceneClick?.(t)
              }}
              onDoubleClick={(e) => {
                e.stopPropagation()
                onSceneDelete?.(t)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (onSceneContextMenu) onSceneContextMenu(t, e.clientX, e.clientY)
                else onSceneDelete?.(t)
              }}
              onMouseEnter={(e) => handleDiamondEnter(t, e)}
              onMouseLeave={handleLeave}
              aria-label={`Scene ${i + 1}`}
              title={`Scene ${i + 1}`}
            />
            {expanded && (
              <button
                type="button"
                className={`scene-row__thumb-btn${active ? ' scene-row__thumb-btn--active' : ''}`}
                onClick={onSceneClick ? () => onSceneClick(t) : undefined}
                onMouseEnter={() => onSceneHover?.(t)}
                onMouseLeave={() => onSceneHover?.(null)}
                aria-label={`Scene ${i + 1} thumbnail`}
                title={`Scene ${i + 1}`}
              >
                {inlineSrc ? (
                  <img
                    className="scene-row__thumb-img"
                    src={inlineSrc}
                    alt=""
                    draggable={false}
                  />
                ) : (
                  <div className="scene-row__thumb-img scene-row__thumb-img--placeholder" />
                )}
              </button>
            )}
            {expanded && <span className="scene-row__label">{i + 1}</span>}
          </div>
        )
      })}
    </div>
  )
}
