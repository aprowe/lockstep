/**
 * Single source of truth for keyboard shortcuts.
 *
 * Add a hotkey here and it shows up in the cheat sheet and is available to
 * `tooltipFor(label, id)` for button tooltips. The actual key handling still
 * lives in the components that own the action — this registry just describes
 * what's bound to what.
 */

export interface HotkeyDef {
  id: string
  /** Human-readable key combo, e.g. "Ctrl+Z" or "Space". */
  keys: string
  /** Short imperative label for the cheat sheet, e.g. "Play / pause". */
  label: string
  /** Cheat sheet section. Order in HOTKEYS controls section order. */
  category: string
}

export const HOTKEYS: readonly HotkeyDef[] = [
  // ── Playback ────────────────────────────────────────────────────────────
  { id: 'play-pause',       keys: 'Space',           label: 'Play / pause',           category: 'Playback' },
  { id: 'step-back-frame',  keys: 'Left',            label: 'Step back 1 frame',      category: 'Playback' },
  { id: 'step-fwd-frame',   keys: 'Right',           label: 'Step forward 1 frame',   category: 'Playback' },
  { id: 'step-back-10',     keys: 'Shift+Left',      label: 'Step back 10 frames',    category: 'Playback' },
  { id: 'step-fwd-10',      keys: 'Shift+Right',     label: 'Step forward 10 frames', category: 'Playback' },
  { id: 'step-back-sec',    keys: 'Alt+Left',        label: 'Step back 1 second',     category: 'Playback' },
  { id: 'step-fwd-sec',     keys: 'Alt+Right',       label: 'Step forward 1 second',  category: 'Playback' },

  // ── Markers ─────────────────────────────────────────────────────────────
  { id: 'mark',             keys: 'M',               label: 'Drop marker at playhead', category: 'Markers' },

  // ── Regions ─────────────────────────────────────────────────────────────
  { id: 'set-in',           keys: 'I',               label: 'Set region in point',    category: 'Regions' },
  { id: 'set-out',          keys: 'O',               label: 'Set region out point',   category: 'Regions' },
  { id: 'delete-region',    keys: 'Ctrl+Delete',     label: 'Delete active region',   category: 'Regions' },

  // ── Edit ────────────────────────────────────────────────────────────────
  { id: 'undo',             keys: 'Ctrl+Z',          label: 'Undo',                   category: 'Edit' },
  { id: 'redo',             keys: 'Ctrl+Shift+Z',    label: 'Redo',                   category: 'Edit' },
  { id: 'select-all',       keys: 'Ctrl+A',          label: 'Select all markers',     category: 'Edit' },
  { id: 'deselect',         keys: 'Escape',          label: 'Deselect',               category: 'Edit' },

  // ── File ────────────────────────────────────────────────────────────────
  { id: 'open-file',        keys: 'Ctrl+O',          label: 'Open video file',        category: 'File' },
  { id: 'open-folder',      keys: 'Ctrl+Shift+O',    label: 'Open folder',            category: 'File' },
  { id: 'import-markers',   keys: 'Ctrl+I',          label: 'Import markers',         category: 'File' },
  { id: 'export-markers',   keys: 'Ctrl+E',          label: 'Export markers',         category: 'File' },

  // ── View ────────────────────────────────────────────────────────────────
  { id: 'ui-scale-up',      keys: 'Ctrl+=',          label: 'Increase UI scale',      category: 'View' },
  { id: 'ui-scale-down',    keys: 'Ctrl+-',          label: 'Decrease UI scale',      category: 'View' },
  { id: 'ui-scale-reset',   keys: 'Ctrl+0',          label: 'Reset UI scale',         category: 'View' },
  { id: 'show-shortcuts',   keys: '?',               label: 'Show keyboard shortcuts', category: 'View' },
]

const BY_ID: Record<string, HotkeyDef> = Object.fromEntries(
  HOTKEYS.map(h => [h.id, h]),
)

/** The key combo for a given action ID, or '' if the ID is unknown. */
export function formatHotkey(id: string): string {
  return BY_ID[id]?.keys ?? ''
}

/** Build a tooltip string with the shortcut appended in parens. */
export function tooltipFor(label: string, id: string): string {
  const k = formatHotkey(id)
  return k ? `${label} (${k})` : label
}

/** Group hotkeys by category, in registry order. */
export function hotkeysByCategory(): Array<{ category: string; items: HotkeyDef[] }> {
  const out: Array<{ category: string; items: HotkeyDef[] }> = []
  for (const h of HOTKEYS) {
    let group = out[out.length - 1]
    if (!group || group.category !== h.category) {
      group = { category: h.category, items: [] }
      out.push(group)
    }
    group.items.push(h)
  }
  return out
}
