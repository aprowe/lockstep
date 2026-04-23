import type { RowContext } from '../../components/list/ListPanel'
import { IconTrash } from '../../components/icons'
import { formatTime } from '../../utils/time'
import './MarkerRow.css'

export interface MarkerRowData {
  id: string
  /** Numeric anchor id underneath the string-coerced ListPanel id. */
  anchorId: number
  /** Index in the sorted list (1-based for display). */
  index: number
  /** Source-time of this anchor in seconds. */
  time: number
  fps: number
  /** Beat number relative to beat-zero, or null if no beat anchor pairing. */
  beatNumber: number | null
  /** True when this anchor is the current beat-zero. */
  isBeatZero: boolean
  /** Stretch factor between this anchor and the next, or null. */
  stretch: number | null
}

interface Props {
  data: MarkerRowData
  ctx: RowContext
  onDelete: () => void
  onDoubleClick: () => void
}

export default function MarkerRow({ data, ctx, onDelete, onDoubleClick }: Props) {
  const {
    isActive, isSelected, thumbnailMode, thumbnailSrc, multiSelectMode,
    onRowClick, onRowMouseEnter, onRowMouseLeave, onToggleSelection,
  } = ctx

  const cls = [
    'marker-row',
    isActive && 'marker-row--active',
    isSelected && 'marker-row--selected',
  ].filter(Boolean).join(' ')

  const frame = Math.round(data.time * data.fps)
  const stretchClass = data.stretch == null
    ? ''
    : data.stretch > 1.3 ? ' marker-row__stretch--high'
    : data.stretch < 0.75 ? ' marker-row__stretch--low'
    : ''

  return (
    <div
      className={cls}
      onClick={onRowClick}
      onDoubleClick={onDoubleClick}
      onMouseEnter={onRowMouseEnter}
      onMouseLeave={onRowMouseLeave}
    >
      {multiSelectMode && (
        <input
          type="checkbox"
          className="marker-row__check"
          checked={isSelected}
          onChange={onToggleSelection}
          onClick={e => e.stopPropagation()}
          aria-label="Select marker"
        />
      )}
      {thumbnailMode === 'always' && (
        thumbnailSrc
          ? <img className="list-panel__row-thumb" src={thumbnailSrc} alt="" draggable={false} />
          : <div className="list-panel__row-thumb list-panel__row-thumb--placeholder" />
      )}
      <span className="marker-row__idx">{data.index}</span>
      <span className="marker-row__time">{formatTime(data.time)}</span>
      <span className="marker-row__frame">f{frame}</span>
      {data.isBeatZero
        ? <span className="marker-row__beat0">B0</span>
        : data.beatNumber !== null
          ? <span className="marker-row__beat">
              B{data.beatNumber % 1 === 0 ? data.beatNumber.toFixed(0) : data.beatNumber.toFixed(1)}
            </span>
          : <span className="marker-row__beat">—</span>
      }
      {data.stretch !== null && (
        <span className={`marker-row__stretch${stretchClass}`}>
          {data.stretch.toFixed(2)}×
        </span>
      )}
      <button
        type="button"
        className="marker-row__del"
        title="Delete marker"
        onClick={e => { e.stopPropagation(); onDelete() }}
      >
        <IconTrash size={14} />
      </button>
    </div>
  )
}
