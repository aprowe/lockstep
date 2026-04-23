import type { RowContext } from '../../components/list/ListPanel'
import { IconTrash } from '../../components/icons'
import { formatTime } from '../../utils/time'
import './SceneRow.css'

export interface SceneRowData {
  id: string
  /** Index in the scene-boundary list (0-based) — used as the visible #. */
  index: number
  /** Source-time of the scene start. */
  start: number
  /** Source-time of the scene end (next boundary or video duration). */
  end: number
  /** Color of the region this scene falls within, or null. Matches the
   *  clip-overlay palette so the timeline + sidebar agree. */
  regionColor: { h: number; s: number; l: number } | null
  /** Boundary at t=0 isn't a real cut — show its row but suppress delete. */
  canDelete: boolean
}

interface Props {
  data: SceneRowData
  ctx: RowContext
  onDelete: () => void
}

export default function SceneRow({ data, ctx, onDelete }: Props) {
  const {
    isActive, isSelected, thumbnailMode, thumbnailSrc, multiSelectMode,
    onRowClick, onRowMouseEnter, onRowMouseLeave, onToggleSelection,
  } = ctx

  const cls = [
    'scene-row',
    isActive && 'scene-row--active',
    isSelected && 'scene-row--selected',
  ].filter(Boolean).join(' ')

  const length = data.end - data.start

  return (
    <div
      className={cls}
      onClick={onRowClick}
      onMouseEnter={onRowMouseEnter}
      onMouseLeave={onRowMouseLeave}
      title={`Scene ${data.index + 1}: ${formatTime(data.start)} → ${formatTime(data.end)}`}
    >
      {multiSelectMode && (
        <input
          type="checkbox"
          className="scene-row__check"
          checked={isSelected}
          onChange={onToggleSelection}
          onClick={e => e.stopPropagation()}
          aria-label="Select scene"
        />
      )}
      {thumbnailMode === 'always' && (
        thumbnailSrc
          ? <img className="list-panel__row-thumb" src={thumbnailSrc} alt="" draggable={false} />
          : <div className="list-panel__row-thumb list-panel__row-thumb--placeholder" />
      )}
      <span
        className="scene-row__color"
        style={data.regionColor
          ? { background: `hsl(${data.regionColor.h}, ${data.regionColor.s}%, ${data.regionColor.l}%)` }
          : undefined}
      />
      <span className="scene-row__idx">{data.index + 1}</span>
      <span className="scene-row__time">{formatTime(data.start)}</span>
      <span className="scene-row__len">{length.toFixed(2)}s</span>
      {data.canDelete && (
        <button
          type="button"
          className="scene-row__del"
          title="Delete scene boundary"
          aria-label={`Delete scene ${data.index + 1}`}
          onClick={e => { e.stopPropagation(); onDelete() }}
        >
          <IconTrash size={14} />
        </button>
      )}
    </div>
  )
}
