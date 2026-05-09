/**
 * Dynamic screenshot runner. Reads a JSON description of one or more steps
 * from $INSTRUCTIONS and writes PNGs into ./screenshots-out/.
 *
 * Step shape:
 *   {
 *     "name":     "01-overview",            // required, becomes the file name
 *     "url":      "/",                       // optional, default "/"
 *     "seed":     { ...SeedState },          // optional, see tests/screenshots/state.ts
 *     "evaluate": "store.dispatch({...})",   // optional, JS run in page context
 *     "selector": ".rip",                    // optional, screenshot just this element
 *     "fullPage": false,                     // optional, default false
 *     "clip":     { x, y, width, height },   // optional
 *     "viewport": { width, height },         // optional, default 1440x900
 *     "waitMs":   400                        // optional extra settle time
 *   }
 *
 * Pass either a single step object or an array of steps.
 */
import { chromium, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mockTauri } from '../tests/screenshots/tauri-mock'
import { seed, type SeedState } from '../tests/screenshots/state'

interface Step {
  name: string
  url?: string
  seed?: SeedState
  evaluate?: string
  selector?: string
  fullPage?: boolean
  clip?: { x: number; y: number; width: number; height: number }
  viewport?: { width: number; height: number }
  waitMs?: number
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const OUT_DIR = path.join(ROOT, 'screenshots-out')

fs.rmSync(OUT_DIR, { recursive: true, force: true })
fs.mkdirSync(OUT_DIR, { recursive: true })

const raw = (process.env.INSTRUCTIONS ?? '').trim()
if (!raw) {
  console.error('INSTRUCTIONS env var is empty')
  process.exit(2)
}

let steps: Step[]
try {
  const parsed = JSON.parse(raw)
  steps = Array.isArray(parsed) ? parsed : [parsed]
} catch (err) {
  console.error(`INSTRUCTIONS is not valid JSON: ${(err as Error).message}`)
  console.error('--- received ---')
  console.error(raw)
  process.exit(2)
}

if (steps.length === 0) {
  console.error('INSTRUCTIONS must contain at least one step')
  process.exit(2)
}

steps.forEach((s, i) => {
  if (!s.name || !/^[\w.-]+$/.test(s.name)) {
    console.error(`Step ${i}: "name" must match /^[\\w.-]+$/, got ${JSON.stringify(s.name)}`)
    process.exit(2)
  }
})

const PORT = 5175
const BASE_URL = `http://localhost:${PORT}`

async function waitForServer(url: string, timeoutMs: number) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.status < 500) return
    } catch {
      // still booting
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`dev server did not come up at ${url} within ${timeoutMs}ms`)
}

async function settle(page: Page, extraMs: number) {
  await page.waitForLoadState('networkidle')
  if (extraMs > 0) await page.waitForTimeout(extraMs)
}

let dev: ChildProcess | undefined

async function main() {
  console.log(`booting dev server on :${PORT}`)
  dev = spawn('npm', ['run', 'dev'], {
    cwd: ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  await waitForServer(BASE_URL, 90_000)
  console.log('dev server up')

  const browser = await chromium.launch()
  try {
    for (const step of steps) {
      console.log(`→ ${step.name}`)
      const ctx = await browser.newContext({
        viewport: step.viewport ?? { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        colorScheme: 'dark',
      })
      const page = await ctx.newPage()
      await mockTauri(page)
      await page.goto(`${BASE_URL}${step.url ?? '/'}`)

      if (step.seed) {
        await seed(page, step.seed)
      }

      if (step.evaluate) {
        await page.evaluate((code: string) => {
          // eslint-disable-next-line @typescript-eslint/no-implied-eval
          return new Function(code)()
        }, step.evaluate)
      }

      await settle(page, step.waitMs ?? 400)

      const out = path.join(OUT_DIR, `${step.name}.png`)
      if (step.selector) {
        const loc = page.locator(step.selector).first()
        await loc.scrollIntoViewIfNeeded()
        await loc.screenshot({ path: out })
      } else {
        const opts: Parameters<Page['screenshot']>[0] = { path: out }
        if (step.fullPage) opts.fullPage = true
        if (step.clip) opts.clip = step.clip
        await page.screenshot(opts)
      }

      await ctx.close()
      console.log(`  wrote ${path.relative(ROOT, out)}`)
    }
  } finally {
    await browser.close()
  }
}

try {
  await main()
} finally {
  if (dev?.pid) {
    try { dev.kill('SIGTERM') } catch { /* noop */ }
  }
}
