import { useEffect, useRef, useState } from 'react'
import type { Region } from '../../types'
import type { RowContext } from '../../components/list/ListPanel'
import { IconTrash } from '../../components/icons'
import './ClipRow.css'

// Color palette — must match Timeline.css clip-overlay--color-N.
const PALETTE = [
  { h: 0,   s: 75, l: 55 },
  { h: 30,  s: 80, l: 52 },
  { h: 58,  s: 80, l: 48 },
  { h: 115, s: 65, l: 45 },
  { h: 183, s: 65, l: 42 },
  { h: 213, s: 70, l: 55 },
  { h: 270, s: 60, l: 55 },
  { h: 305, s: 65, l: 52 },
]

function fmtTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = s % 60
  const ss = String(Math.floor(sec)).padStart(2, '0')
  const cs = String(Math.floor((sec % 1) * 100)).padStart(2, '0')
  return m > 0 ? `${m}:${ss}.${cs}` : `${ss}.${cs}s`
}

interface Props {
  region: Region
  /** Index in the unsorted region list — drives the color swatch. */
  colorIndex: number
  ctx: RowContext
  pendingRename: boolean
  onCommitRename: (id: string, name: string) => void
  onCancelRename: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onDoubleClick: () => void
  /** Per-row delete affordance — removes just this region without touching
   *  the rest of the multi-selection. */
  onDelete: () => void
}

export default function ClipRow({
  region, colorIndex, ctx, pendingRename, onCommitRename, onCancelRename,
  onContextMenu, onDoubleClick, onDelete,
}: Props) {
  const {
    isActive, isSelected, thumbnailMode, thumbnailSrc, multiSelectMode,
    onRowClick, onRowMouseEnter, onRowMouseLeave, onToggleSelection,
  } = ctx
  const [renameValue, setRenameValue] = useState(region.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (pendingRename) {
      setRenameValue(region.name)
      // Defer select() so React has committed the input mount.
      setTimeout(() => inputRef.current?.select(), 20)
    }
  }, [pendingRename, region.name])

  const commit = () => {
    if (renameValue.trim()) onCommitRename(region.id, renameValue.trim())
    else onCancelRename()
  }

  const { h, s, l } = PALETTE[colorIndex % PALETTE.length]
  const cls = [
    'clip-row',
    isActive && 'clip-row--active',
    isSelected && 'clip-row--selected',
  ].filter(Boolean).join(' ')

  return (
    <div
      className={cls}
      onClick={onRowClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onMouseEnter={onRowMouseEnter}
      onMouseLeave={onRowMouseLeave}
    >
      {multiSelectMode && (
        <input
          type="checkbox"
          className="clip-row__check"
          checked={isSelected}
          onChange={onToggleSelection}
          onClick={e => e.stopPropagation()}
          aria-label="Select clip"
        />
      )}
      {thumbnailMode === 'always' && (
        thumbnailSrc
          ? <img className="list-panel__row-thumb" src={thumbnailSrc} alt="" draggable={false} />
          : <div className="list-panel__row-thumb list-panel__row-thumb--placeholder" />
      )}
      <span className="clip-row__swatch" style={{ background: `hsl(${h},${s}%,${l}%)` }} />
      <div className="clip-row__body">
        {pendingRename ? (
          <input
            ref={inputRef}
            className="clip-row__rename"
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') onCancelRename()
              e.stopPropagation()
            }}
            onClick={e => e.stopPropagation()}
            autoFocus
          />
        ) : (
          <div className="clip-row__name" title={region.name}>{region.name}</div>
        )}
        <div className="clip-row__range">
          {fmtTime(region.inPoint)} – {fmtTime(region.outPoint)}
        </div>
      </div>
      <button
        type="button"
        className="clip-row__del"
        title="Delete clip"
        onClick={e => { e.stopPropagation(); onDelete() }}
      >
        <IconTrash size={14} />
      </button>
    </div>
  )
}
