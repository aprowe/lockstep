import type { ReactNode } from 'react'
import './TrackRow.css'

interface TrackRowProps {
  /** Short label shown in the left rail (e.g. "Scenes", "Bars"). */
  label?: ReactNode
  /** Optional CSS class suffix — becomes `.thin-row--${kind}`. */
  kind?: string
  /** Row contents — should position children absolutely using view-space %. */
  children?: ReactNode
  /** Click on the empty row background. Receives the horizontal pct (0..1). */
  onBackgroundClick?: (pct: number, e: React.MouseEvent<HTMLDivElement>) => void
  /** Right-click on empty background. */
  onBackgroundContextMenu?: (pct: number, x: number, y: number) => void
  /** Pointer-down on empty background — receives pct (0..1) and the event.
   * Lets callers implement scrubbing (pointer capture + move listener). */
  onBackgroundPointerDown?: (pct: number, e: React.PointerEvent<HTMLDivElement>) => void
  /** Extra CSS vars on the row (e.g. overriding --thin-row-h). */
  style?: React.CSSProperties
}

/**
 * Base primitive for narrow per-type timeline tracks. Gives every row a
 * consistent left rail label column + a time-mapped content area where
 * children absolutely-position via `left: <pct>%`.
 */
export default function TrackRow({ label, kind, children, onBackgroundClick, onBackgroundContextMenu, onBackgroundPointerDown, style }: TrackRowProps) {
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onBackgroundClick) return
    if (e.target !== e.currentTarget) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = (e.clientX - rect.left) / rect.width
    onBackgroundClick(Math.max(0, Math.min(1, pct)), e)
  }

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onBackgroundContextMenu) return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = (e.clientX - rect.left) / rect.width
    onBackgroundContextMenu(Math.max(0, Math.min(1, pct)), e.clientX, e.clientY)
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onBackgroundPointerDown) return
    if (e.target !== e.currentTarget) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = (e.clientX - rect.left) / rect.width
    onBackgroundPointerDown(Math.max(0, Math.min(1, pct)), e)
  }

  return (
    <div className={`thin-row${kind ? ` thin-row--${kind}` : ''}`} style={style}>
      {label !== undefined && <div className="thin-row__rail">{label}</div>}
      <div
        className="thin-row__body"
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onPointerDown={handlePointerDown}
      >
        {children}
      </div>
    </div>
  )
}
