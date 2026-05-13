import { test, expect } from '@playwright/test'
import { bootApp, getState } from './setup'

/**
 * Feature: Video Loading
 * Scenario: Viewport is set to the video duration on load
 *   When a video is loaded
 *   Then the viewport changes to the length of the video
 *
 * Drives the real File → Open File menu path. Tauri's open_video command is
 * mocked to return a 90-second clip; the openFileThunk then dispatches
 * setVideo + setView and we assert ui.view spans 0..90.
 */
// @behavior video-loading::90289e16
test('Viewport is set to the video duration on load', async ({ page }) => {
  const VIDEO_DURATION = 90

  await bootApp(page, {
    mock: {
      open_video: () => ({
        path: '/fake/loaded.mp4',
        original_name: 'loaded.mp4',
        duration: VIDEO_DURATION,
        fps: 30,
        file_hash: 'mock-hash-loaded',
        width: 1920,
        height: 1080,
      }),
    },
  })

  // Sanity: pre-load view doesn't already match the duration we're about to
  // load — otherwise the assertion below would tautologically pass.
  const initialView = await getState(page, (s) => s.ui.view)
  expect(initialView.end).not.toBe(VIDEO_DURATION)

  // Open the File menu and click "Open Video".
  await page.locator('.menubar__trigger', { hasText: 'File' }).first().click()
  await page.locator('.menubar__item', { hasText: 'Open Video' }).first().click()

  // Wait for the thunk to apply the new view.
  await expect.poll(() => getState(page, (s) => s.ui.view), {
    timeout: 5000,
  }).toEqual({ start: 0, end: VIDEO_DURATION })

  const video = await getState(page, (s) => s.video.video)
  expect(video?.duration).toBe(VIDEO_DURATION)
})
