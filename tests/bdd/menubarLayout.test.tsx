/**
 * Verify the menu bar and each dropdown menu match the layout specs in
 * layouts/menubar.layout.yaml. Renders with real menu builders from src/menus.ts
 * (with stub deps) and queries data-layout-id / data-layout-sep attributes.
 */

import { assertLayoutMatches } from '../helpers/runLayout'
import { renderMenuBar, openMenu } from '../harnesses/menubar'

// Top-level menubar: File | Edit | View
{
  const { container } = renderMenuBar()
  assertLayoutMatches('menubar', container)
}

// File menu
{
  const result = renderMenuBar()
  openMenu(result, 'File')
  const dropdown = result.container.querySelector('.menubar__dropdown')!
  assertLayoutMatches('file-menu', dropdown)
}

// Edit menu
{
  const result = renderMenuBar()
  openMenu(result, 'Edit')
  const dropdown = result.container.querySelector('.menubar__dropdown')!
  assertLayoutMatches('edit-menu', dropdown)
}

// View menu
{
  const result = renderMenuBar()
  openMenu(result, 'View')
  const dropdown = result.container.querySelector('.menubar__dropdown')!
  assertLayoutMatches('view-menu', dropdown)
}
