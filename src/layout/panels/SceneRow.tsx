import type { RowContext } from '../../components/list/ListPanel'
import RowShell from '../../components/list/RowShell'
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
  /** colorIndex of the region this scene falls within, or null when the
   *  scene sits between regions. The swatch picks its hue via the same
   *  clip-overlay--color-N CSS class the timeline uses, so colors track
   *  automatically. */
  regionColorIndex: number | null
  /** Boundary at t=0 isn't a real cut — show its row but suppress delete. */
  canDelete: boolean
}

interface Props {
  data: SceneRowData
  ctx: RowContext
  onDelete: () => void
}

export default function SceneRow({ data, ctx, onDelete }: Props) {
  const length = data.end - data.start
  const colorClass = data.regionColorIndex != null
    ? ` clip-overlay--color-${data.regionColorIndex % 8}`
    : ''

  return (
    <RowShell
      kind="scene-row"
      ctx={ctx}
      checkboxLabel="Select scene"
      deleteLabel={`Delete scene ${data.index + 1}`}
      onDelete={data.canDelete ? onDelete : undefined}
      title={`Scene ${data.index + 1}: ${formatTime(data.start)} → ${formatTime(data.end)}`}
    >
      <span className={`scene-row__color${colorClass}`} />
      <span className="scene-row__idx">{data.index + 1}</span>
      <span className="scene-row__time">{formatTime(data.start)}</span>
      <span className="scene-row__len">{length.toFixed(2)}s</span>
    </RowShell>
  )
}
