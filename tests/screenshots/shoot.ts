import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ROOT     = path.resolve(HERE, '..', '..')
export const SHOT_DIR = path.resolve(ROOT, 'docs', 'screenshots')

export interface ShootOptions {
  /** Output subdirectory under docs/screenshots/. Defaults to the
   *  SHOOT_OUT env var (set by `npm run shoot`) or the literal "shots". */
  out?: string
  /** Padding in CSS pixels around the element when clipping. */
  pad?: number
  /** When true, screenshot the element directly (its own bounds, no
   *  surrounding context). Default false → page-level clip with padding so
   *  hover/focus rings and adjacent UI are visible. */
  tight?: boolean
}

function resolveOut(opts: ShootOptions): string {
  const sub = opts.out ?? process.env.SHOOT_OUT ?? 'shots'
  const dir = path.resolve(SHOT_DIR, sub)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** Take a screenshot of a DOM element with sensible padding around it.
 *
 *  Replaces the boundingBox/clip dance most callers were duplicating — pass a
 *  page or locator, a name, and you get a PNG at `docs/screenshots/<out>/<name>.png`.
 *  The full path is returned so callers can log or assert. */
export async function shootElement(
  target: Page | Locator,
  selector: string,
  name: string,
  opts: ShootOptions = {},
): Promise<string> {
  const page = 'page' in target ? target.page() : target
  const locator = 'locator' in target ? target.locator(selector) : (target as Page).locator(selector)
  const out = path.join(resolveOut(opts), `${name}.png`)

  await locator.scrollIntoViewIfNeeded()
  if (opts.tight) {
    await locator.screenshot({ path: out })
    return out
  }

  const box = await locator.boundingBox()
  if (!box) throw new Error(`shootElement: "${selector}" has no bounding box`)
  const pad = opts.pad ?? 16
  await page.screenshot({
    path: out,
    clip: {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: box.width + pad * 2,
      height: box.height + pad * 2,
    },
  })
  return out
}

/** Take a screenshot of an entire region (e.g. `.toolbar`, `.rip`) without
 *  surrounding padding — uses the element's own bounds. Equivalent to
 *  `shootElement(..., { tight: true })` but reads more clearly at the call
 *  site for "shoot the whole panel" cases. */
export async function shootRegion(
  target: Page | Locator,
  selector: string,
  name: string,
  opts: Omit<ShootOptions, 'tight' | 'pad'> = {},
): Promise<string> {
  return shootElement(target, selector, name, { ...opts, tight: true })
}

/** Take a viewport-sized screenshot. */
export async function shootPage(
  page: Page,
  name: string,
  opts: Omit<ShootOptions, 'tight' | 'pad'> = {},
): Promise<string> {
  const out = path.join(resolveOut(opts), `${name}.png`)
  await page.screenshot({ path: out, fullPage: false })
  return out
}
