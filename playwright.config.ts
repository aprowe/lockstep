import { defineConfig, devices } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

// Find a usable Chromium when Playwright's expected version isn't downloaded.
// Common in sandbox environments — falls back to whatever
// `chromium-N/chrome-linux/chrome` exists under PLAYWRIGHT_BROWSERS_PATH (or
// /opt/pw-browsers). Returns undefined to let Playwright use its own default
// when nothing custom is found.
function detectChromium(): string | undefined {
  const env = process.env.PLAYWRIGHT_BROWSERS_PATH
  const root = env && fs.existsSync(env) ? env : '/opt/pw-browsers'
  if (!fs.existsSync(root)) return undefined
  const candidates = fs.readdirSync(root)
    .filter(n => /^chromium-\d+$/.test(n))
    .sort()
    .reverse()
  for (const name of candidates) {
    const p = path.join(root, name, 'chrome-linux', 'chrome')
    if (fs.existsSync(p)) return p
  }
  return undefined
}

const executablePath = detectChromium()

export default defineConfig({
  testDir: './tests/screenshots',
  testMatch: /.*\.shot\.ts$/,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5175',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    trace: 'off',
    screenshot: 'off',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5175',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
