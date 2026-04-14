import { useState, useRef } from 'react'
import type { Region } from '../types'
import './ClipSidebar.css'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m > 0
    ? `${m}:${String(Math.floor(sec)).padStart(2, '0')}.${String(Math.floor((sec % 1) * 100)).padStart(2, '0')}`
    : `${Math.floor(sec)}.${String(Math.floor((sec % 1) * 100)).padStart(2, '0')}s`
}

// ── Props ────────────────────────────────────────────────────────────────────

interface ClipSidebarProps {
  duration: number
  playhead: number
  regions: Region[]
  activeRegionId: string | null
  onSelectRegion: (id: string | null) => void
  onAddRegion: (inPoint: number, outPoint: number) => void
  onDeleteRegion: (id: string) => void
  onUpdateInOut: (id: string, inPoint: number, outPoint: number) => void
  onRename: (id: string, name: string) => void
  width?: number
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ClipSidebar({
  duration,
  playhead,
  regions,
  activeRegionId,
  onSelectRegion,
  onAddRegion,
  onDeleteRegion,
  onUpdateInOut,
  onRename,
}: ClipSidebarProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  const activeRegion = activeRegionId !== null
    ? regions.find(r => r.id === activeRegionId) ?? null
    : null

  const handleStartRename = (region: Region) => {
    setRenamingId(region.id)
    setRenameValue(region.name)
    setTimeout(() => renameInputRef.current?.select(), 30)
  }

  const handleCommitRename = () => {
    if (renamingId && renameValue.trim()) {
      onRename(renamingId, renameValue.trim())
    }
    setRenamingId(null)
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleCommitRename()
    if (e.key === 'Escape') setRenamingId(null)
  }

  return (
    <div className="cs-sidebar">
      {/* Header */}
      <div className="cs-header">
        <span className="cs-header__label">Clips</span>
        <button
          className="cs-header__add"
          onClick={() => onAddRegion(0, duration)}
          title="Add clip"
        >
          +
        </button>
      </div>

      {/* Clip list */}
      <div className="cs-list">
        {/* Full Video (default) */}
        <div
          className={`cs-item${activeRegionId === null ? ' cs-item--active' : ''}`}
          onClick={() => onSelectRegion(null)}
        >
          <div className="cs-item__arrow">{activeRegionId === null ? '▶' : ''}</div>
          <div className="cs-item__info">
            <div className="cs-item__name">Full Video</div>
            <div className="cs-item__range">
              {fmtTime(0)} – {fmtTime(duration)}
            </div>
          </div>
        </div>

        {/* User-defined clips */}
        {regions.map(region => (
          <div
            key={region.id}
            className={`cs-item${activeRegionId === region.id ? ' cs-item--active' : ''}`}
            onClick={() => onSelectRegion(region.id)}
            onDoubleClick={() => handleStartRename(region)}
          >
            <div className="cs-item__arrow">{activeRegionId === region.id ? '▶' : ''}</div>
            <div className="cs-item__info">
              {renamingId === region.id ? (
                <input
                  ref={renameInputRef}
                  className="cs-rename-input"
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onBlur={handleCommitRename}
                  onKeyDown={handleRenameKeyDown}
                  onClick={e => e.stopPropagation()}
                  autoFocus
                />
              ) : (
                <div className="cs-item__name">{region.name}</div>
              )}
              <div className="cs-item__range">
                {fmtTime(region.inPoint)} – {fmtTime(region.outPoint)}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* In/Out editor — only shown for user clips */}
      {activeRegion !== null && (
        <div className="cs-inout">
          <div className="cs-inout__divider" />

          <div className="cs-inout__row">
            <span className="cs-inout__label">In:</span>
            <span className="cs-inout__time">{fmtTime(activeRegion.inPoint)}</span>
            <button
              className="cs-inout__set"
              onClick={() => onUpdateInOut(activeRegion.id, playhead, activeRegion.outPoint)}
              title="Set in point to playhead"
            >
              Set
            </button>
          </div>

          <div className="cs-inout__row">
            <span className="cs-inout__label">Out:</span>
            <span className="cs-inout__time">{fmtTime(activeRegion.outPoint)}</span>
            <button
              className="cs-inout__set"
              onClick={() => onUpdateInOut(activeRegion.id, activeRegion.inPoint, playhead)}
              title="Set out point to playhead"
            >
              Set
            </button>
          </div>

          <div className="cs-inout__actions">
            <button
              className="cs-inout__btn"
              onClick={() => handleStartRename(activeRegion)}
              title="Rename clip"
            >
              Rename ✎
            </button>
            <button
              className="cs-inout__btn cs-inout__btn--danger"
              onClick={() => onDeleteRegion(activeRegion.id)}
              title="Delete clip"
            >
              Delete ✗
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
