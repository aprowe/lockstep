import { test, expect } from '@playwright/test'
import { bootApp } from './setup'

/**
 * Feature: List Selection
 * Scenario: Selection bar appears when 2+ rows are selected
 *   Given a populated list with two rows selected
 *   Then the panel header shows "2 selected"
 *   And a clear-selection (deselect) button is visible
 *   And a bulk-delete (trash) button is visible
 *
 * Drives the real Clips dockview panel: plain-click one row, ctrl-click a
 * second, then assert the list-panel selection chrome appears. The bulk
 * "delete selected" / "clear selection" buttons are rendered conditionally
 * on multiSelectMode (>= 2 selected).
 */

// @behavior list-selection::0763ac4b
test('Selection bar appears when 2+ rows are selected (clips list)', async ({ page }) => {
  await bootApp(page, {
    state: {
      video: { duration: 60, fps: 30 },
      bpm: 120,
      regions: [
        { name: 'Intro', inPoint: 0, outPoint: 8 },
        { name: 'Verse', inPoint: 8, outPoint: 30 },
        { name: 'Drop',  inPoint: 30, outPoint: 50 },
      ],
      view: { start: 0, end: 60 },
    },
  })

  // Real region rows only (the leading "Full Video" sentinel uses
  // .clip-row--full and isn't part of multiselect).
  const rows = page.locator('.clip-row:not(.clip-row--full)')
  await expect(rows).toHaveCount(3)

  // 1 selected → no selection chrome.
  await rows.nth(0).click()
  const selectionCount = page.locator('.list-panel__selection-count')
  await expect(selectionCount).toHaveCount(0)

  // 2 selected → selection bar appears with count + clear + trash buttons.
  await rows.nth(1).click({ modifiers: ['Control'] })
  await expect(selectionCount).toBeVisible()
  await expect(selectionCount).toHaveText('2 selected')

  const clipsPanel = page.locator('.list-panel').filter({ has: selectionCount })
  await expect(clipsPanel.locator('button[title="Clear selection"]')).toBeVisible()
  await expect(clipsPanel.locator('button[title="Delete selected"]')).toBeVisible()
})
