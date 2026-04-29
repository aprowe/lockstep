import type { Page } from '@playwright/test'
import { mockTauri, type CommandHandlers } from '../screenshots/tauri-mock'
import { seed, type SeedState } from '../screenshots/state'

export { mockTauri, seed }
export type { CommandHandlers, SeedState }

/**
 * Boot the app for an integration scenario:
 *   - install Tauri mock (with optional command handler overrides)
 *   - navigate to /
 *   - wait for the dev-only window.__STORE__ to attach
 *   - optionally seed Redux state
 *
 * Returns once the store is live; individual tests still drive UI interactions
 * after this resolves.
 */
export async function bootApp(
  page: Page,
  opts: { mock?: CommandHandlers; state?: SeedState } = {},
) {
  await mockTauri(page, opts.mock ?? {})
  await page.goto('/')
  await page.waitForFunction(() => Boolean((window as unknown as { __STORE__?: unknown }).__STORE__))
  if (opts.state) await seed(page, opts.state)
}

/** Read a slice of Redux state from the running app. */
export async function getState<T>(page: Page, fn: (s: any) => T): Promise<T> {
  return page.evaluate((src) => {
    // eslint-disable-next-line no-new-func
    const get = new Function('s', `return (${src})(s)`) as (s: unknown) => T
    const store = (window as unknown as { __STORE__: { getState: () => unknown } }).__STORE__
    return get(store.getState())
  }, fn.toString())
}

/** Dispatch a plain Redux action against the running store. */
export async function dispatch(
  page: Page,
  action: { type: string; payload?: unknown },
) {
  await page.evaluate((a) => {
    const store = (window as unknown as { __STORE__: { dispatch: (a: unknown) => unknown } }).__STORE__
    store.dispatch(a)
  }, action)
}
