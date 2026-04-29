import { test, expect } from '@playwright/test'
import { bootApp, dispatch } from './setup'

/**
 * Feature: Frame count display
 *
 * Toolbar's currentTime comes from Redux warp.playhead, so these tests
 * dispatch setPlayhead and read the rendered DOM. The edit scenario verifies
 * the edit-mode UI toggle; the seek-on-commit goes through the live <video>
 * element which has no real source under Playwright, so the post-commit
 * playhead update is out of scope here.
 */

const SEEDED_VIDEO = {
  duration: 60,
  fps: 30,
  name: 'frame-count-fixture.mp4',
}

// @behavior frame-count-display::871cc353
test('Frame count shown next to timecode at 2.5 seconds', async ({ page }) => {
  await bootApp(page, {
    state: { video: SEEDED_VIDEO, view: { start: 0, end: SEEDED_VIDEO.duration } },
  })

  // 2.5s × 30fps = 75 frames
  await dispatch(page, { type: 'warp/setPlayhead', payload: 2.5 })

  const frameCount = page.locator('[data-testid="frame-count"]')
  await expect(frameCount).toBeVisible()
  await expect(frameCount).toContainText('75')
})

// @behavior frame-count-display::2ae2aa1e
test('Clicking the frame count opens an editable input pre-filled with the current frame', async ({ page }) => {
  await bootApp(page, {
    state: { video: SEEDED_VIDEO, view: { start: 0, end: SEEDED_VIDEO.duration } },
  })

  await dispatch(page, { type: 'warp/setPlayhead', payload: 2.5 })

  // Display mode: span visible, input absent.
  const display = page.locator('[data-testid="frame-count"]')
  const input = page.locator('[data-testid="frame-count-input"]')
  await expect(display).toBeVisible()
  await expect(input).toHaveCount(0)

  await display.click()

  // Edit mode: input visible with "75" pre-filled (round(2.5 * 30)).
  await expect(input).toBeVisible()
  await expect(input).toHaveValue('75')

  // Enter commits and returns to display mode.
  await input.fill('100')
  await input.press('Enter')

  await expect(input).toHaveCount(0)
  await expect(display).toBeVisible()
})
