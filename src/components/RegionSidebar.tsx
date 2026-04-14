import { useRef, useState } from 'react'
import type { Region } from '../types'
import ContextMenu from './ContextMenu'
import type { ContextMenuState } from './ContextMenu'
import './RegionSidebar.css'

// ── Color palette (must match Timeline.css clip-overlay--color-N) ────────────

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

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = s % 60
  const ss = String(Math.floor(sec)).padStart(2, '0')
  const cs = String(Math.floor((sec % 1) * 100)).padStart(2, '0')
  return m > 0 ? `${m}:${ss}.${cs}` : `${ss}.${cs}s`
}

/** Parse "m:ss.cc", "ss.cc", "ss" → seconds, or null if invalid */
function parseTime(raw: string): number | null {
  const s = raw.trim()
  // m:ss or m:ss.cc
  const colonMatch = s.match(/^(\d+):(\d{1,2})(?:\.(\d{1,2}))?$/)
  if (colonMatch) {
    const m = parseInt(colonMatch[1], 10)
    const sec = parseInt(colonMatch[2], 10)
    const cs = colonMatch[3] ? parseInt(colonMatch[3].padEnd(2, '0'), 10) : 0
    return m * 60 + sec + cs / 100
  }
  // plain seconds
  const n = parseFloat(s)
  return isFinite(n) && n >= 0 ? n : null
}

// ── Props ────────────────────────────────────────────────────────────────────

interface RegionSidebarProps {
  duration: number
  regions: Region[]
  activeRegionId: string | null
  onSelectRegion: (id: string | null) => void
  onAddRegion: (inPoint: number, outPoint: number) => void
  onDeleteRegion: (id: string) => void
  onRename: (id: string, name: string) => void
  onUpdateInOut: (id: string, inPoint: number, outPoint: number) => void
  onExportRegion?: (id: string) => void
}

// ── Editable timecode field ──────────────────────────────────────────────────

function TimeField({
  value,
  duration,
  onChange,
}: {
  value: number
  duration: number
  onChange: (t: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [raw, setRaw] = useState('')

  const start = () => {
    setRaw(fmtTime(value))
    setEditing(true)
  }

  const commit = () => {
    const t = parseTime(raw)
    if (t !== null) onChange(Math.max(0, Math.min(duration, t)))
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        className="rsi-time-input"
        value={raw}
        onChange={e => setRaw(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          if (e.key === 'Escape') setEditing(false)
          e.stopPropagation()
        }}
        onClick={e => e.stopPropagation()}
        autoFocus
        spellCheck={false}
      />
    )
  }

  return (
    <span
      className="rsi-time-value"
      onClick={e => { e.stopPropagation(); start() }}
      title="Click to edit"
    >
      {fmtTime(value)}
    </span>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

export default function RegionSidebar({
  duration,
  regions,
  activeRegionId,
  onSelectRegion,
  onAddRegion,
  onDeleteRegion,
  onRename,
  onUpdateInOut,
  onExportRegion,
}: RegionSidebarProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  const startRename = (region: Region, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setRenamingId(region.id)
    setRenameValue(region.name)
    setTimeout(() => inputRef.current?.select(), 20)
  }

  const commitRename = () => {
    if (renamingId && renameValue.trim()) onRename(renamingId, renameValue.trim())
    setRenamingId(null)
  }

  const openContextMenu = (e: React.MouseEvent, region: Region) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Rename', action: () => startRename(region) },
        ...(onExportRegion ? [{ label: 'Export', action: () => onExportRegion(region.id) }] : []),
        { separator: true as const },
        { label: 'Delete', action: () => onDeleteRegion(region.id), danger: true },
      ],
    })
  }

  return (
    <div className="rsi-sidebar">

      {/* Header */}
      <div className="rsi-header">
        <span className="rsi-header__label">Regions</span>
        <button
          className="rsi-header__add"
          onClick={() => onAddRegion(0, duration)}
          title="New region — or drag on the strip below to define bounds"
        >
          +
        </button>
      </div>

      {/* List */}
      <div className="rsi-list">

        {/* Full Video (default) */}
        <div
          className={`rsi-item${activeRegionId === null ? ' rsi-item--active' : ''}`}
          onClick={() => onSelectRegion(null)}
        >
          <div className="rsi-item__name">Full Video</div>
          <div className="rsi-item__range">{fmtTime(0)} – {fmtTime(duration)}</div>
        </div>

        {/* User-defined regions */}
        {regions.map((region, idx) => {
          const active = activeRegionId === region.id
          const { h, s, l } = PALETTE[idx % PALETTE.length]
          return (
            <div
              key={region.id}
              className={`rsi-item${active ? ' rsi-item--active' : ''}`}
              onClick={() => onSelectRegion(region.id)}
              onDoubleClick={e => startRename(region, e)}
              onContextMenu={e => openContextMenu(e, region)}
            >
              <div className="rsi-item__row">
                <span
                  className="rsi-item__swatch"
                  style={{ background: `hsl(${h},${s}%,${l}%)` }}
                />
                {renamingId === region.id ? (
                  <input
                    ref={inputRef}
                    className="rsi-rename"
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                    onClick={e => e.stopPropagation()}
                    autoFocus
                  />
                ) : (
                  <div className="rsi-item__name">{region.name}</div>
                )}
              </div>

              {/* In/out row — editable when active */}
              {active ? (
                <div className="rsi-item__inout" onClick={e => e.stopPropagation()}>
                  <span className="rsi-item__inout-label">In</span>
                  <TimeField
                    value={region.inPoint}
                    duration={region.outPoint - 0.1}
                    onChange={t => onUpdateInOut(region.id, t, region.outPoint)}
                  />
                  <span className="rsi-item__inout-sep">–</span>
                  <span className="rsi-item__inout-label">Out</span>
                  <TimeField
                    value={region.outPoint}
                    duration={duration}
                    onChange={t => onUpdateInOut(region.id, region.inPoint, t)}
                  />
                </div>
              ) : (
                <div className="rsi-item__range">
                  {fmtTime(region.inPoint)} – {fmtTime(region.outPoint)}
                </div>
              )}
            </div>
          )
        })}

        {regions.length === 0 && (
          <div className="rsi-hint">
            Drag on the strip to create a region
          </div>
        )}
      </div>

      {contextMenu && (
        <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
      )}
    </div>
  )
}
