import { useEffect, useState } from 'react'
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
  /** User-supplied label for this scene (empty when unset). */
  label: string
}

interface Props {
  data: SceneRowData
  ctx: RowContext
  onDelete: () => void
  onLabelChange: (label: string) => void
}

export default function SceneRow({ data, ctx, onDelete, onLabelChange }: Props) {
  const length = data.end - data.start
  const colorClass = data.regionColorIndex != null
    ? ` clip-overlay--color-${data.regionColorIndex % 8}`
    : ''

  // Local draft so we don't dispatch on every keystroke. Sync when the
  // underlying label changes (e.g. cut deletion shifted scenes around).
  const [draft, setDraft] = useState(data.label)
  useEffect(() => { setDraft(data.label) }, [data.label])

  const commit = () => {
    if (draft !== data.label) onLabelChange(draft)
  }

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
      <input
        type="text"
        className="scene-row__label"
        value={draft}
        placeholder="Label…"
        aria-label={`Label for scene ${data.index + 1}`}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            ;(e.currentTarget as HTMLInputElement).blur()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setDraft(data.label)
            ;(e.currentTarget as HTMLInputElement).blur()
          }
        }}
        onClick={e => e.stopPropagation()}
        onDoubleClick={e => e.stopPropagation()}
      />
      <span className="scene-row__len">{length.toFixed(2)}s</span>
    </RowShell>
  )
}
