/**
 * Menu definitions for the main menu bar.
 *
 * Each builder takes the dependencies it needs and returns a MenuDef.
 * Extracted from App.tsx so tests can import them with stub deps.
 *
 * Layout specs: layouts/menubar.layout.yaml
 */

import type { MenuDef } from './components/MenuBar'
import type { VideoInfo } from './types'

interface FileMenuDeps {
  video: VideoInfo | null
  anchorCount: number
  openFile: () => void
  openFolder: () => void
  openJsonFile: () => void
  resetVideoData: () => void
  closeVideo: () => void
  importMarkers: () => void
  exportMarkers: () => void
}

export function buildFileMenu(d: FileMenuDeps): MenuDef {
  return {
    label: 'File',
    items: [
      { label: 'Open File',       shortcut: 'Ctrl+O',       action: d.openFile },
      { label: 'Open Folder',     shortcut: 'Ctrl+Shift+O', action: d.openFolder },
      { label: 'Open Markers…',                             action: d.openJsonFile },
      { separator: true },
      { label: 'Import Markers',  shortcut: 'Ctrl+I',       action: d.importMarkers, disabled: !d.video },
      { label: 'Export Markers',  shortcut: 'Ctrl+E',       action: d.exportMarkers, disabled: !d.video || d.anchorCount === 0 },
      { separator: true },
      { label: 'Reset Video Data',                          action: d.resetVideoData, disabled: !d.video },
      { separator: true },
      { label: 'Close Video',                               action: d.closeVideo,     disabled: !d.video },
    ],
  }
}

interface EditMenuDeps {
  video: VideoInfo | null
  anchorCount: number
  undo: () => void
  redo: () => void
  selectAll: () => void
  deselect: () => void
}

export function buildEditMenu(d: EditMenuDeps): MenuDef {
  return {
    label: 'Edit',
    items: [
      { label: 'Undo',       shortcut: 'Ctrl+Z',       action: d.undo,      disabled: !d.video },
      { label: 'Redo',       shortcut: 'Ctrl+Shift+Z', action: d.redo,      disabled: !d.video },
      { separator: true },
      { label: 'Select All', shortcut: 'Ctrl+A',       action: d.selectAll, disabled: !d.video || d.anchorCount === 0 },
      { label: 'Deselect',   shortcut: 'Escape',       action: d.deselect,  disabled: !d.video },
    ],
  }
}

interface ViewMenuDeps {
  increaseUiScale: () => void
  decreaseUiScale: () => void
  resetUiScale: () => void
  resetPanelLayout: () => void
  /** Toggle a dock panel's visibility. Hidden panels can be brought back via
   *  the same toggle — useful since panels close via the tab × button. */
  togglePanel: (id: string) => void
  /** All side-panel definitions in the order they should appear in the menu. */
  panels: Array<{ id: string; title: string }>
  /** Set of currently-visible panel ids (for the ✓ check state). */
  visiblePanelIds: ReadonlySet<string>
}

export function buildViewMenu(d: ViewMenuDeps): MenuDef {
  return {
    label: 'View',
    items: [
      { label: 'Increase UI Scale', shortcut: 'Ctrl+=', action: d.increaseUiScale },
      { label: 'Decrease UI Scale', shortcut: 'Ctrl+-', action: d.decreaseUiScale },
      { label: 'Reset UI Scale',    shortcut: 'Ctrl+0', action: d.resetUiScale },
      { separator: true },
      { label: 'Reset Panel Layout',                    action: d.resetPanelLayout },
      { separator: true },
      // One toggle per dock panel — checked when visible, unchecked when
      // closed (brings the panel back into the active group on click).
      ...d.panels.map(p => ({
        label: p.title,
        action: () => d.togglePanel(p.id),
        checked: d.visiblePanelIds.has(p.id),
      })),
    ],
  }
}
