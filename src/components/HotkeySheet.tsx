import { useEffect } from 'react'
import { hotkeysByCategory } from '../hotkeys'
import './HotkeySheet.css'

interface HotkeySheetProps {
  open: boolean
  onClose: () => void
}

export default function HotkeySheet({ open, onClose }: HotkeySheetProps) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])

  if (!open) return null

  const groups = hotkeysByCategory()

  return (
    <div className="hk-overlay" onClick={onClose}>
      <div className="hk-dialog" onClick={e => e.stopPropagation()}>
        <div className="hk-dialog__header">
          <span className="hk-dialog__title">Keyboard Shortcuts</span>
          <button className="hk-dialog__close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="hk-dialog__body">
          {groups.map(g => (
            <section key={g.category} className="hk-group">
              <h3 className="hk-group__title">{g.category}</h3>
              <ul className="hk-list">
                {g.items.map(h => (
                  <li key={h.id} className="hk-row">
                    <span className="hk-row__label">{h.label}</span>
                    <span className="hk-row__keys">{renderKeys(h.keys)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

function renderKeys(combo: string) {
  const parts = combo.split('+')
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span className="hk-row__plus">+</span>}
          <kbd className="hk-kbd">{p}</kbd>
        </span>
      ))}
    </>
  )
}
