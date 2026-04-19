import { useEffect, useRef, useState } from 'react'
import './MenuBar.css'

interface MenuItem {
  label: string
  shortcut?: string
  action?: () => void
  disabled?: boolean
  separator?: false
}

interface MenuSeparator {
  separator: true
}

type MenuEntry = MenuItem | MenuSeparator

interface MenuDef {
  label: string
  items: MenuEntry[]
}

interface MenuBarProps {
  menus: MenuDef[]
  rightContent?: React.ReactNode
}

export type { MenuDef, MenuEntry, MenuItem, MenuSeparator }

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export default function MenuBar({ menus, rightContent }: MenuBarProps) {
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    if (openIdx === null) return
    const handler = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpenIdx(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [openIdx])

  // Register keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't hijack shortcuts while the user is typing in an editable field —
      // Ctrl+A, Ctrl+Z, etc. should behave natively inside inputs.
      const active = document.activeElement as HTMLElement | null
      if (active && (
        active.tagName === 'INPUT' ||
        active.tagName === 'TEXTAREA' ||
        active.tagName === 'SELECT' ||
        active.isContentEditable
      )) return

      const ctrl = e.ctrlKey || e.metaKey

      for (const menu of menus) {
        for (const item of menu.items) {
          if ('separator' in item && item.separator) continue
          const mi = item as MenuItem
          if (!mi.shortcut || mi.disabled || !mi.action) continue

          const parts = mi.shortcut.toLowerCase().split('+')
          const needCtrl = parts.includes('ctrl')
          const needShift = parts.includes('shift')
          const key = parts[parts.length - 1]

          if (ctrl === needCtrl && e.shiftKey === needShift && e.key.toLowerCase() === key) {
            e.preventDefault()
            mi.action()
            setOpenIdx(null)
            return
          }
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [menus])

  return (
    <div className="menubar" ref={barRef}>
      <div className="menubar__menus">
        {menus.map((menu, i) => (
          <div key={menu.label} style={{ position: 'relative' }}>
            <button
              data-layout-id={slugify(menu.label)}
              className={`menubar__trigger${openIdx === i ? ' menubar__trigger--open' : ''}`}
              onClick={() => setOpenIdx(openIdx === i ? null : i)}
              onMouseEnter={() => { if (openIdx !== null) setOpenIdx(i) }}
            >
              {menu.label}
            </button>

            {openIdx === i && (
              <div className="menubar__dropdown">
                {menu.items.map((item, j) => {
                  if ('separator' in item && item.separator) {
                    return <div key={j} data-layout-sep className="menubar__sep" />
                  }
                  const mi = item as MenuItem
                  return (
                    <button
                      key={j}
                      data-layout-id={slugify(mi.label)}
                      className="menubar__item"
                      disabled={mi.disabled}
                      onClick={() => { mi.action?.(); setOpenIdx(null) }}
                    >
                      <span className="menubar__item-label">{mi.label}</span>
                      {mi.shortcut && (
                        <span className="menubar__item-shortcut">
                          {formatShortcut(mi.shortcut)}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="menubar__spacer" />

      {rightContent}
    </div>
  )
}

function formatShortcut(s: string): string {
  return s
    .split('+')
    .map(p => p === 'Ctrl' ? 'Ctrl' : p === 'Shift' ? 'Shift' : p.toUpperCase())
    .join('+')
}
