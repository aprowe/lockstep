import { useEffect, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import {
  setTimelineThumbShow, setTimelineFollowDrag,
  setTimelineAlwaysAnchors, setTimelineAlwaysRegions, setTimelineAlwaysScenes,
  setAnchorLock,
} from '../store/slices/uiSlice'
import {
  IconWarpToggle, IconAlwaysAnchors, IconAlwaysRegions, IconAlwaysScenes,
  IconThumbStrip, IconFollowDrag, IconZoomToRegion, IconLockClosed,
} from './icons'
import { getUiScale } from '../uiScale'

// GRID_DIVS kept here so the toolbar can render the select without
// depending on the full CanvasTimeline module.
const GRID_DIVS = [
  { label: '1/1', value: 1 }, { label: '1/2', value: 2 }, { label: '1/2T', value: 3 },
  { label: '1/4', value: 4 }, { label: '1/4T', value: 6 }, { label: '1/8', value: 8 },
]

export interface CanvasTimelineToolbarProps {
  warpCollapsed?: boolean
  onToggleWarp?: () => void
  onZoomToRegion?: () => void
  gridDiv?: number
  onGridDivChange?: (div: number) => void
}

export function CanvasTimelineToolbar({
  warpCollapsed = false,
  onToggleWarp,
  onZoomToRegion,
  gridDiv,
  onGridDivChange,
}: CanvasTimelineToolbarProps) {
  const dispatch      = useAppDispatch()
  const alwaysAnchors = useAppSelector(s => s.ui.timelineAlwaysAnchors)
  const alwaysRegions = useAppSelector(s => s.ui.timelineAlwaysRegions)
  const alwaysScenes  = useAppSelector(s => s.ui.timelineAlwaysScenes)
  const followDrag    = useAppSelector(s => s.ui.timelineFollowDrag)
  const thumbMode     = useAppSelector(s => s.ui.timelineThumbShow ? 'show' : 'none')
  const anchorLock    = useAppSelector(s => s.ui.anchorLock)

  // Alt-held preview: flip the visual while Alt is held anywhere in the app.
  // Use document listeners (broader than window) + pointermove to catch Alt
  // held during pointer movement (no keydown fires in that case). Also clear
  // on window blur so stale altHeld never gets stuck when the window loses focus.
  const [altHeld, setAltHeld] = useState(false)
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.altKey) setAltHeld(true) }
    const up   = (e: KeyboardEvent) => { if (!e.altKey) setAltHeld(false) }
    const move = (e: PointerEvent | MouseEvent) => { setAltHeld(e.altKey) }
    const blur = () => setAltHeld(false)
    document.addEventListener('keydown', down)
    document.addEventListener('keyup',   up)
    document.addEventListener('pointermove', move)
    window.addEventListener('blur', blur)
    return () => {
      document.removeEventListener('keydown', down)
      document.removeEventListener('keyup',   up)
      document.removeEventListener('pointermove', move)
      window.removeEventListener('blur', blur)
    }
  }, [])
  const displayAnchorLock = altHeld ? !anchorLock : anchorLock

  const [uiScale, setUiScaleState] = useState<number>(() => getUiScale())
  useEffect(() => {
    const handler = (e: Event) => setUiScaleState((e as CustomEvent).detail as number)
    window.addEventListener('ui-scale-change', handler)
    return () => window.removeEventListener('ui-scale-change', handler)
  }, [])
  const iconSize = Math.round(16 * uiScale)

  return (
    <div className="canvas-timeline__toolbar">
      <button
        type="button"
        className={`ct-btn ct-btn--warp${warpCollapsed ? '' : ' ct-btn--active'}`}
        onClick={onToggleWarp}
        title={warpCollapsed ? 'Show warp views' : 'Hide warp views'}
      >
        <IconWarpToggle size={iconSize} />
      </button>
      <button
        type="button"
        className={`ct-btn ct-btn--thumbs${thumbMode === 'show' ? ' ct-btn--active' : ''}`}
        onClick={() => dispatch(setTimelineThumbShow(thumbMode !== 'show'))}
        title={thumbMode === 'show' ? 'Hide thumbnails' : 'Show thumbnails'}
      >
        <IconThumbStrip size={iconSize} />
      </button>

      <span className="ct-sep" />

      <button
        type="button"
        className={`ct-btn ct-btn--zoom${onZoomToRegion ? '' : ' ct-btn--disabled'}`}
        onClick={onZoomToRegion}
        disabled={!onZoomToRegion}
        title="Zoom to active clip"
      >
        <IconZoomToRegion size={iconSize} />
      </button>
      <button
        type="button"
        className={`ct-btn ct-btn--anchor-lock${displayAnchorLock ? ' ct-btn--active' : ''}${altHeld ? ' ct-btn--alt-preview' : ''}`}
        onClick={() => dispatch(setAnchorLock(!anchorLock))}
        title={altHeld
          ? `Alt held — anchor lock will act as ${!anchorLock ? 'ON' : 'OFF'} for this gesture`
          : `Anchor lock: ${anchorLock ? 'ON' : 'OFF'} — beat anchors inside clip ${anchorLock ? 'move with resize/pan' : 'stay in place'} (Alt reverses)`}
      >
        <IconLockClosed size={iconSize} />
      </button>

      <span className="ct-sep" />

      <button
        type="button"
        className={`ct-btn ct-btn--follow${followDrag ? ' ct-btn--active' : ''}`}
        onClick={() => dispatch(setTimelineFollowDrag(!followDrag))}
        title="Playhead follows dragged anchors"
      >
        <IconFollowDrag size={iconSize} />
      </button>

      <span className="ct-sep" />

      <button
        type="button"
        className={`ct-btn ct-btn--anchors${alwaysAnchors ? ' ct-btn--active' : ''}`}
        onClick={() => dispatch(setTimelineAlwaysAnchors(!alwaysAnchors))}
        title="Always show anchor through-lines"
      >
        <IconAlwaysAnchors size={iconSize} />
      </button>
      <button
        type="button"
        className={`ct-btn ct-btn--regions${alwaysRegions ? ' ct-btn--active' : ''}`}
        onClick={() => dispatch(setTimelineAlwaysRegions(!alwaysRegions))}
        title="Always show region edge through-lines"
      >
        <IconAlwaysRegions size={iconSize} />
      </button>
      <button
        type="button"
        className={`ct-btn ct-btn--scenes${alwaysScenes ? ' ct-btn--active' : ''}`}
        onClick={() => dispatch(setTimelineAlwaysScenes(!alwaysScenes))}
        title="Always show scene through-lines"
      >
        <IconAlwaysScenes size={iconSize} />
      </button>

      <span className="ct-sep" />

      {onGridDivChange && (
        <>
          <span className="ct-spacer" />
          <div className="ct-grid-group">
            <span className="ct-grid-label">Grid</span>
            <select
              className="ct-select"
              value={gridDiv ?? 1}
              onChange={e => onGridDivChange(parseInt(e.target.value))}
            >
              {GRID_DIVS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
          </div>
        </>
      )}
    </div>
  )
}
