/**
 * DEV-ONLY theme cycler. Renders a small floating chip in the bottom-
 * right corner that cycles through every theme imported by index.css
 * by toggling the `data-theme` attribute on `<html>`. Last choice is
 * stashed in localStorage so a reload keeps the same look.
 *
 * Gated behind `import.meta.env.DEV` so the chip never ships in a
 * release build. Keep this dependency-free + low-impact — anything more
 * elaborate than "click to cycle" belongs in a real settings panel.
 */

import { useCallback, useEffect, useState } from 'react'

const THEMES = [
  'warm-dark',
  'neon-rhythm',
  'violet-dusk',
  'tokyo-night',
  'catppuccin-mocha',
] as const
type Theme = typeof THEMES[number]

const STORAGE_KEY = 'devThemeSwitcher.theme'

function applyTheme(name: Theme) {
  document.documentElement.setAttribute('data-theme', name)
}

function readInitial(): Theme {
  if (typeof window === 'undefined') return 'warm-dark'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored && (THEMES as readonly string[]).includes(stored)) return stored as Theme
  return 'warm-dark'
}

export default function DevThemeSwitcher() {
  const [theme, setTheme] = useState<Theme>(readInitial)

  // Apply the theme on mount + whenever it changes. localStorage write
  // happens in the same effect so reload is sticky without a separate
  // useEffect plus a stale-closure footgun.
  useEffect(() => {
    applyTheme(theme)
    try { window.localStorage.setItem(STORAGE_KEY, theme) } catch { /* private mode */ }
  }, [theme])

  const cycle = useCallback(() => {
    setTheme(curr => {
      const idx = THEMES.indexOf(curr)
      return THEMES[(idx + 1) % THEMES.length]
    })
  }, [])

  return (
    <button
      type="button"
      onClick={cycle}
      title={`Theme: ${theme} (click to cycle)`}
      style={{
        position: 'fixed',
        right: 8,
        bottom: 8,
        zIndex: 99999,
        padding: '4px 8px',
        background: 'rgba(0, 0, 0, 0.55)',
        color: 'var(--fg-2, #ccc)',
        border: '1px solid var(--border-hi, #444)',
        borderRadius: 4,
        font: '11px/1.2 ui-monospace, Consolas, monospace',
        letterSpacing: '0.04em',
        cursor: 'pointer',
        opacity: 0.5,
        transition: 'opacity 0.12s',
      }}
      onMouseEnter={e => { e.currentTarget.style.opacity = '1' }}
      onMouseLeave={e => { e.currentTarget.style.opacity = '0.5' }}
    >
      🎨 {theme}
    </button>
  )
}
