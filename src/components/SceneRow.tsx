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
}

export default function SceneRow({ scenes, view, duration, expanded, onSceneClick }: SceneRowProps) {
  return (
    <div className={`scene-row${expanded ? ' scene-row--expanded' : ''}`}>
      {scenes.map((t, i) => {
        if (t < 0 || t > duration) return null
        const x = timeToViewPct(t, view)
        if (x < -2 || x > 102) return null
        return (
          <div key={i} className="scene-row__marker" style={{ left: `${x}%` }}>
            <button
              type="button"
              className="scene-row__diamond"
              onClick={onSceneClick ? () => onSceneClick(t) : undefined}
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
