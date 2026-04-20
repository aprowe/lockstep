import { useCallback } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { useAppSelector } from '../store/hooks'
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
}

const PLAYHEAD_MATCH_TOLERANCE = 0.05 // ~1 video frame at 20fps

export default function SceneRow({ scenes, view, duration, expanded, onSceneClick, onSceneHover, playhead }: SceneRowProps) {
  const video = useAppSelector(s => s.video.video)
  const thumbPaths = useAppSelector(s =>
    video ? s.thumbnails.pathsByHashAndFrame[video.fileHash] ?? {} : {},
  )
  const setThumbnailHover = useSetThumbnailHover()

  const thumbSrc = (t: number): string | null => {
    if (!video || video.fps <= 0) return null
    const frame = Math.floor(t * video.fps)
    const path = thumbPaths[frame]
    return path ? convertFileSrc(path) : null
  }

  let activeIdx = -1
  if (playhead !== undefined) {
    let bestDist = PLAYHEAD_MATCH_TOLERANCE
    for (let i = 0; i < scenes.length; i++) {
      const d = Math.abs(scenes[i] - playhead)
      if (d <= bestDist) { bestDist = d; activeIdx = i }
    }
  }

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

  return (
    <div className={`scene-row${expanded ? ' scene-row--expanded' : ''}`}>
      {scenes.map((t, i) => {
        if (t < 0 || t > duration) return null
        const x = timeToViewPct(t, view)
        if (x < -2 || x > 102) return null
        const active = i === activeIdx
        const inlineSrc = expanded ? thumbSrc(t) : null
        return (
          <div key={i} className="scene-row__marker" style={{ left: `${x}%` }}>
            <button
              type="button"
              className={`scene-row__diamond${active ? ' scene-row__diamond--active' : ''}`}
              onClick={onSceneClick ? () => onSceneClick(t) : undefined}
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
