import type { Page } from '@playwright/test'

/**
 * Stand-in for the Tauri IPC layer so the React UI can render in a plain
 * browser. Add command handlers as you need them — unknown commands return
 * null and log a warning to the page console so you can spot what's missing.
 */
export type CommandHandlers = Record<string, (args: unknown) => unknown>

const defaultHandlers: CommandHandlers = {
  load_video_state: () => null,
  save_video_state: () => null,
  list_saved_hashes: () => [],
  list_folder_videos: () => [],
  check_video_sidecar: () => null,
  get_file_hash: () => 'mock-hash',
}

export async function mockTauri(page: Page, handlers: CommandHandlers = {}) {
  const merged = { ...defaultHandlers, ...handlers }
  await page.addInitScript((handlerNames) => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: unknown) => Promise<unknown>
        transformCallback: (cb?: (v: unknown) => void) => number
      }
      __TAURI_MOCK_RESULTS__: Record<string, unknown>
    }
    w.__TAURI_MOCK_RESULTS__ = {}
    const callbacks = new Map<number, (v: unknown) => void>()
    let nextCb = 1
    w.__TAURI_INTERNALS__ = {
      invoke: async (cmd: string) => {
        if (!handlerNames.includes(cmd)) {
          // eslint-disable-next-line no-console
          console.warn('[tauri-mock] unhandled command:', cmd)
          return null
        }
        return w.__TAURI_MOCK_RESULTS__[cmd] ?? null
      },
      transformCallback: (cb) => {
        const id = nextCb++
        if (cb) callbacks.set(id, cb)
        return id
      },
    }
  }, Object.keys(merged))

  // Inject the actual return values after init script defines the slot.
  await page.addInitScript((results) => {
    const w = window as unknown as { __TAURI_MOCK_RESULTS__: Record<string, unknown> }
    Object.assign(w.__TAURI_MOCK_RESULTS__ ??= {}, results)
  }, Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, v(undefined)])))
}
