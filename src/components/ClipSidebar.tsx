import { useRef } from 'react'
import type { Clip } from '../types'
import './ClipSidebar.css'

function fmtTime(s: number) {
  const m = Math.floor(s / 60)
  const sec = (s % 60).toFixed(1).padStart(4, '0')
  return `${m}:${sec}`
}

interface ClipSidebarProps {
  clips: Clip[]
  activeClipId: string | null  // null = full video mode
  videoDuration: number
  playhead: number
  onSelectFull: () => void
  onSelectClip: (id: string) => void
  onAddClip: () => void
  onDeleteClip: (id: string) => void
  onSetIn: (id: string) => void
  onSetOut: (id: string) => void
  onRenameClip: (id: string, name: string) => void
}

export default function ClipSidebar({
  clips, activeClipId, videoDuration, playhead,
  onSelectFull, onSelectClip, onAddClip,
  onDeleteClip, onSetIn, onSetOut, onRenameClip,
}: ClipSidebarProps) {
  const editingRef = useRef<HTMLInputElement | null>(null)

  return (
    <div className="clip-sidebar">
      <div className="clip-sidebar__header">
        <span className="clip-sidebar__title">Clips</span>
        <button
          className="clip-sidebar__add"
          onClick={onAddClip}
          title="Add clip at current playhead"
        >+</button>
      </div>

      {/* Full video entry */}
      <div
        className={`clip-entry clip-entry--full${activeClipId === null ? ' clip-entry--active' : ''}`}
        onClick={onSelectFull}
      >
        <span className="clip-entry__icon">▶</span>
        <span className="clip-entry__name">Full Video</span>
        <span className="clip-entry__dur">{fmtTime(videoDuration)}</span>
      </div>

      {clips.length > 0 && <div className="clip-sidebar__divider" />}

      {/* Clip list */}
      {clips.map(clip => {
        const isActive = clip.id === activeClipId
        const dur = clip.outPoint - clip.inPoint
        return (
          <div
            key={clip.id}
            className={`clip-entry${isActive ? ' clip-entry--active' : ''}`}
            onClick={() => onSelectClip(clip.id)}
          >
            <div className="clip-entry__top">
              <span className="clip-entry__icon">▶</span>
              <input
                ref={isActive ? editingRef : undefined}
                className="clip-entry__name-input"
                value={clip.name}
                onClick={e => e.stopPropagation()}
                onChange={e => onRenameClip(clip.id, e.target.value)}
              />
              <button
                className="clip-entry__delete"
                onClick={e => { e.stopPropagation(); onDeleteClip(clip.id) }}
                title="Delete clip"
              >✕</button>
            </div>
            <div className="clip-entry__meta">
              <span className="clip-entry__range">
                {fmtTime(clip.inPoint)} – {fmtTime(clip.outPoint)}
              </span>
              <span className="clip-entry__dur-small">{fmtTime(dur)}</span>
            </div>
            <div className="clip-entry__actions">
              <button
                className="clip-entry__btn"
                onClick={e => { e.stopPropagation(); onSetIn(clip.id) }}
                title={`Set in point to ${fmtTime(playhead)}`}
              >Set In</button>
              <button
                className="clip-entry__btn"
                onClick={e => { e.stopPropagation(); onSetOut(clip.id) }}
                title={`Set out point to ${fmtTime(playhead)}`}
              >Set Out</button>
            </div>
          </div>
        )
      })}

      {clips.length === 0 && (
        <div className="clip-sidebar__empty">
          Click + to add a clip
        </div>
      )}
    </div>
  )
}
