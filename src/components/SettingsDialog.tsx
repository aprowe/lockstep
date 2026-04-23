import { useEffect, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import {
  setMaxCachedFrames,
  setThumbWidth,
  setTheme,
  resetSettings,
  THEMES,
  type Theme,
} from '../store/slices/settingsSlice'
import { clearAllThumbnails } from '../api/thumbnails'
import './SettingsDialog.css'

const THEME_LABELS: Record<Theme, string> = {
  'warm-dark':       'Warm Dark',
  'neon-rhythm':     'Neon Rhythm',
  'violet-dusk':     'Violet Dusk',
  'tokyo-night':     'Tokyo Night',
  'catppuccin-mocha':'Catppuccin Mocha',
}

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
}

export default function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const dispatch = useAppDispatch()
  const thumbWidth = useAppSelector(s => s.settings.thumbWidth)
  const maxCachedFrames = useAppSelector(s => s.settings.maxCachedFrames)
  const theme = useAppSelector(s => s.settings.theme)
  const [clearing, setClearing] = useState(false)
  const [cleared, setCleared] = useState(false)

  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])

  if (!open) return null

  const handleClearAll = async () => {
    setClearing(true)
    try {
      await clearAllThumbnails()
      setCleared(true)
      setTimeout(() => setCleared(false), 2000)
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-dialog" onClick={e => e.stopPropagation()}>
        <div className="settings-dialog__header">
          <span className="settings-dialog__title">Settings</span>
          <button className="settings-dialog__close" onClick={onClose} title="Close">✕</button>
        </div>

        <div className="settings-dialog__body">
          <section className="settings-section">
            <h3 className="settings-section__heading">Appearance</h3>

            <div className="settings-row">
              <label className="settings-row__label">
                <span className="settings-row__title">Theme</span>
                <span className="settings-row__hint">Color palette for the entire app.</span>
              </label>
              <div className="settings-row__control">
                <select
                  className="settings-select"
                  value={theme}
                  onChange={e => dispatch(setTheme(e.target.value as Theme))}
                >
                  {THEMES.map(t => (
                    <option key={t} value={t}>{THEME_LABELS[t]}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section className="settings-section">
            <h3 className="settings-section__heading">Thumbnails</h3>

            <div className="settings-row">
              <label className="settings-row__label">
                <span className="settings-row__title">Thumbnail size</span>
                <span className="settings-row__hint">Width in pixels. Changing wipes existing thumbnails.</span>
              </label>
              <div className="settings-row__control">
                <input
                  type="range"
                  min={48}
                  max={480}
                  step={8}
                  value={thumbWidth}
                  onChange={e => dispatch(setThumbWidth(parseInt(e.target.value, 10)))}
                />
                <span className="settings-row__value">{thumbWidth}px</span>
              </div>
            </div>

            <div className="settings-row">
              <label className="settings-row__label">
                <span className="settings-row__title">Cache size (per video)</span>
                <span className="settings-row__hint">Max cached frames before oldest get evicted.</span>
              </label>
              <div className="settings-row__control">
                <input
                  type="range"
                  min={200}
                  max={10000}
                  step={100}
                  value={maxCachedFrames}
                  onChange={e => dispatch(setMaxCachedFrames(parseInt(e.target.value, 10)))}
                />
                <span className="settings-row__value">{maxCachedFrames.toLocaleString()}</span>
              </div>
            </div>

            <div className="settings-row">
              <label className="settings-row__label">
                <span className="settings-row__title">Clear thumbnail cache</span>
                <span className="settings-row__hint">Deletes every cached thumbnail on disk.</span>
              </label>
              <div className="settings-row__control settings-row__control--buttons">
                <button
                  className="settings-btn settings-btn--danger"
                  onClick={handleClearAll}
                  disabled={clearing}
                >
                  {clearing ? 'Clearing…' : cleared ? 'Cleared ✓' : 'Clear all'}
                </button>
              </div>
            </div>
          </section>

          <div className="settings-dialog__footer">
            <button
              className="settings-btn settings-btn--ghost"
              onClick={() => dispatch(resetSettings())}
            >
              Reset to defaults
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
