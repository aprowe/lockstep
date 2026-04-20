import type { View } from '../types'
import { timeToViewPct } from '../utils/view'
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
  let activeIdx = -1
  if (playhead !== undefined) {
    let bestDist = PLAYHEAD_MATCH_TOLERANCE
    for (let i = 0; i < scenes.length; i++) {
      const d = Math.abs(scenes[i] - playhead)
      if (d <= bestDist) { bestDist = d; activeIdx = i }
    }
  }

  return (
    <div className={`scene-row${expanded ? ' scene-row--expanded' : ''}`}>
      {scenes.map((t, i) => {
        if (t < 0 || t > duration) return null
        const x = timeToViewPct(t, view)
        if (x < -2 || x > 102) return null
        const active = i === activeIdx
        return (
          <div key={i} className="scene-row__marker" style={{ left: `${x}%` }}>
            <button
              type="button"
              className={`scene-row__diamond${active ? ' scene-row__diamond--active' : ''}`}
              onClick={onSceneClick ? () => onSceneClick(t) : undefined}
              onMouseEnter={onSceneHover ? () => onSceneHover(t) : undefined}
              onMouseLeave={onSceneHover ? () => onSceneHover(null) : undefined}
              aria-label={`Scene ${i + 1}`}
              title={`Scene ${i + 1}`}
            />
            {expanded && <span className="scene-row__label">{i + 1}</span>}
          </div>
        )
      })}
    </div>
  )
}
