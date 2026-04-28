import { test } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mockTauri } from './tauri-mock'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.resolve(HERE, '..', '..', 'docs', 'screenshots')

test.describe('Lockstep screenshots', () => {
  test.beforeEach(async ({ page }) => {
    await mockTauri(page)
  })

  test('01-empty-state', async ({ page }) => {
    await page.goto('/')
    // wait for the React tree to mount + first paint to settle
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(400)
    await page.screenshot({
      path: path.join(OUT_DIR, '01-empty-state.png'),
      fullPage: false,
    })
  })

  // Add more shots here. Each test should:
  //   1. mockTauri(page, { /* per-shot command stubs */ })
  //   2. drive the UI into the desired state (clicks, dispatch via page.evaluate)
  //   3. page.screenshot({ path: path.join(OUT_DIR, 'NN-name.png') })
  //
  // To dispatch Redux actions directly, expose the store on window in dev:
  //   await page.evaluate(() => (window as any).__STORE__.dispatch({...}))
})
