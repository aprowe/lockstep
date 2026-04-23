import { type ReactNode } from 'react'
import type { RowContext } from './ListPanel'
import { IconTrash } from '../icons'

/**
 * Boilerplate every list row shares: container with active/selected
 * modifiers, click + hover wiring, optional checkbox in multi-select mode,
 * optional inline thumbnail in 'always' mode, and a trailing trash button.
 *
 * Each row file (ClipRow, MarkerRow, SceneRow) just supplies its
 * type-specific cells as `children`. Modifier classes are namespaced via
 * the `kind` prop so per-row styling can hook them (e.g. `clip-row--active`).
 */

interface RowShellProps {
  /** Class prefix for the row, e.g. 'clip-row'. Modifiers become
   *  `${kind}--active`, `${kind}--selected`. */
  kind: string
  ctx: RowContext
  children: ReactNode

  /** Aria label for the per-row checkbox (defaults to "Select item"). */
  checkboxLabel?: string
  /** Aria label for the per-row trash button (defaults to "Delete item"). */
  deleteLabel?: string
  /** When omitted, no trash button renders — for rows like the Scenes
   *  t=0 boundary that aren't deletable. */
  onDelete?: () => void

  onDoubleClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  /** Optional override of the row's title attribute. */
  title?: string
}

export default function RowShell({
  kind, ctx, children,
  checkboxLabel = 'Select item',
  deleteLabel = 'Delete item',
  onDelete, onDoubleClick, onContextMenu, title,
}: RowShellProps) {
  const {
    isActive, isSelected, thumbnailMode, thumbnailSrc, multiSelectMode,
    onRowClick, onRowMouseEnter, onRowMouseLeave, onToggleSelection,
  } = ctx

  const cls = [
    kind,
    isActive && `${kind}--active`,
    isSelected && `${kind}--selected`,
  ].filter(Boolean).join(' ')

  return (
    <div
      className={cls}
      onClick={onRowClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onMouseEnter={onRowMouseEnter}
      onMouseLeave={onRowMouseLeave}
      title={title}
    >
      {multiSelectMode && (
        <input
          type="checkbox"
          className={`${kind}__check`}
          checked={isSelected}
          onChange={onToggleSelection}
          onClick={e => e.stopPropagation()}
          aria-label={checkboxLabel}
        />
      )}
      {thumbnailMode === 'always' && (
        thumbnailSrc
          ? <img className="list-panel__row-thumb" src={thumbnailSrc} alt="" draggable={false} />
          : <div className="list-panel__row-thumb list-panel__row-thumb--placeholder" />
      )}
      {children}
      {onDelete && (
        <button
          type="button"
          className={`${kind}__del`}
          title={deleteLabel}
          aria-label={deleteLabel}
          onClick={e => { e.stopPropagation(); onDelete() }}
        >
          <IconTrash size={14} />
        </button>
      )}
    </div>
  )
}
