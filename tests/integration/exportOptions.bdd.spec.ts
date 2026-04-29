import { test, expect } from '@playwright/test'
import { bootApp } from './setup'

/**
 * Feature: Export Options
 * Scenario: Interpolation Options
 *   Given I have a clip i would like to export
 *   When I check "Interpolate Frames"
 *   Then A panel is revealed that lets me pick the interpolation method,
 *        including minterpolate and RIFE, and the target FPS, which is
 *        pre-populated with the current FPS
 */
// @behavior export-options::66beba92
test('Checking "Interpolate Frames" reveals a panel with method + FPS pre-populated', async ({ page }) => {
  const VIDEO_FPS = 30

  await bootApp(page, {
    state: {
      video: { duration: 60, fps: VIDEO_FPS },
      bpm: 120,
      anchors: [[2, 2], [4, 4], [6, 6]],
      regions: [
        { name: 'Intro', inPoint: 0, outPoint: 8 },
        { name: 'Verse', inPoint: 8, outPoint: 30 },
      ],
      activeRegion: 'Verse',
      view: { start: 0, end: 60 },
      exportOpen: true,
    },
  })

  await expect(page.locator('.export-dialog')).toBeVisible()

  // Panel is hidden until the checkbox is on.
  const panel = page.locator('[aria-label="Interpolation Options"]')
  await expect(panel).toHaveCount(0)

  await page.getByLabel('Interpolate Frames').check()

  // Panel reveals method dropdown with both options + FPS input pre-filled.
  await expect(panel).toBeVisible()

  const method = panel.getByLabel('Interpolation Method')
  await expect(method).toBeVisible()
  const optionValues = await method.locator('option').evaluateAll(
    (opts) => opts.map((o) => (o as HTMLOptionElement).value),
  )
  expect(optionValues).toEqual(expect.arrayContaining(['minterpolate', 'rife']))

  const fps = panel.getByLabel('Target FPS')
  await expect(fps).toBeVisible()
  await expect(fps).toHaveValue(String(VIDEO_FPS))

  // Unchecking hides the panel again.
  await page.getByLabel('Interpolate Frames').uncheck()
  await expect(panel).toHaveCount(0)
})
