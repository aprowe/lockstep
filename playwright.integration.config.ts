import { defineConfig, devices } from '@playwright/test'

/**
 * Frontend integration suite — Playwright tests bound to scenarios from
 * spec/features/*.feature. Drives the live Vite dev server with the Tauri IPC
 * layer mocked, so tests exercise the real React + Redux + browser layout
 * paths but stop at the IPC boundary. Each scenario carries a `// @behavior`
 * marker so scripts/behavior.ts flags it when the underlying Gherkin steps
 * change (scenario hash drift surfaces as a coverage gap).
 *
 * NB: this is integration-level, not E2E. True E2E (real Tauri binary, real
 * Rust commands) would need tauri-driver / WebdriverIO.
 *
 * Companion to `playwright.config.ts` (screenshots): same dev server, distinct
 * test directory + match pattern so the two suites can run independently.
 */
export default defineConfig({
  testDir: './tests/integration',
  testMatch: /.*\.bdd\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5175',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
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
