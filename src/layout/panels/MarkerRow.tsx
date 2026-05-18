import type { RowContext } from '../../components/list/ListPanel'
import RowShell from '../../components/list/RowShell'
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
  dim?: boolean
}

export default function MarkerRow({ data, ctx, onDelete, onDoubleClick, dim }: Props) {
  const frame = Math.round(data.time * data.fps)
  const stretchClass = data.stretch == null
    ? ''
    : data.stretch > 1.3 ? ' marker-row__stretch--high'
    : data.stretch < 0.75 ? ' marker-row__stretch--low'
    : ''

  return (
    <RowShell
      kind="marker-row"
      className={dim ? 'marker-row--dim' : undefined}
      ctx={ctx}
      checkboxLabel="Select anchor"
      deleteLabel="Delete anchor"
      onDelete={onDelete}
      onDoubleClick={onDoubleClick}
    >
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
    </RowShell>
  )
}
