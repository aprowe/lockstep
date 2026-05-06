# Screenshots (Playwright)

Automated screenshots of the Lockstep UI, served via Playwright pointed at the Vite dev server.

## Quick start

```bash
npm run shoot                       # all *.shot.ts in this dir
npm run shoot -- toolbar            # only tests matching "toolbar"
npm run shoot -- toolbar --out=pr-42  # write into docs/screenshots/pr-42/
```

`npm run shoot` runs Playwright, writes PNGs under `docs/screenshots/<out>/`, and prints ready-to-paste markdown image tags pointing at the raw GitHub URLs for the current branch.

When `--out=` is omitted, the subdir is slugged from the current git branch.

To regenerate every screenshot, including the user-guide set in `app.shot.ts`:

```bash
npm run test:screenshots
```

## Adding a new shot

1. Drop a new file in this dir: `<name>.shot.ts` (any name, must end in `.shot.ts`).
2. Use the helpers — most cases reduce to one call:

```ts
import { test } from '@playwright/test'
import { mockTauri } from './tauri-mock'
import { seed } from './state'
import { shootElement, shootRegion, shootPage } from './shoot'

test('my-shot', async ({ page }) => {
  await mockTauri(page)
  await page.goto('/')
  await seed(page, { video: { duration: 32 }, bpm: 120 })
  await page.waitForLoadState('networkidle')

  await shootElement(page, '[data-layout-id="play"]', 'play-button', { pad: 24 })
  await shootRegion(page, '.toolbar', 'toolbar')
  await shootPage(page, 'overview')
})
```

See `example.shot.ts.template` for a copy-paste starting point.

### Helpers (`shoot.ts`)

| Function | Output | Notes |
|---|---|---|
| `shootElement(page, sel, name, opts?)` | `<out>/<name>.png` | Padded clip around the element. `opts.pad` (default 16). |
| `shootRegion(page, sel, name, opts?)`  | `<out>/<name>.png` | Element bounds only — no padding. |
| `shootPage(page, name, opts?)`         | `<out>/<name>.png` | Viewport screenshot. |

`opts.out` overrides the output subdir for a single shot; otherwise the value from `SHOOT_OUT` (set by `npm run shoot`) wins, falling back to `shots`.

## Posting to a PR

1. `npm run shoot -- <pattern>` (note the markdown printed at the end).
2. Commit the PNGs and push to the PR's branch.
3. Paste the printed markdown into a comment — the raw GitHub URLs resolve once the push lands.

## How the harness works

- `playwright.config.ts` boots `npm run dev` (or reuses a running one) on `http://localhost:5175` and auto-detects a usable Chromium under `/opt/pw-browsers/` when Playwright's expected version isn't downloaded (common in sandboxes).
- `tauri-mock.ts` shims `window.__TAURI_INTERNALS__` so the React app can render in plain Chrome (every `invoke()` would otherwise throw).
- `state.ts` exposes `seed(page, {...})` to dispatch into the live Redux store and bring the app into a target shape (video, BPM, anchors, regions, view).

### Mocking Tauri commands

The default mock returns empty/null for the commands the app calls at startup. To return richer data:

```ts
await mockTauri(page, {
  list_folder_videos: () => [
    { name: 'clip1.mp4', path: '/fake/clip1.mp4' },
  ],
})
```

Unhandled commands log a warning and return `null` — check the page console output if a screenshot looks broken.

### Loading a real video

The asset protocol (`tauri://localhost/...`) won't work in plain Chrome. Either:

- Use a regular HTTP video URL in the mock for `load_video`, or
- Run the actual Tauri app and screenshot it with an OS-level tool (out of scope here).
