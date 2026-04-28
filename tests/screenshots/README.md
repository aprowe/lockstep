# Screenshots (Playwright)

Automated screenshots of the Lockstep UI, served via Playwright pointed at the Vite dev server.

## One-time setup

```bash
npm run screenshots:install   # downloads chromium (~150 MB)
```

## Take screenshots

```bash
npm run screenshots
```

Output goes to `docs/screenshots/`.

## How it works

- `playwright.config.ts` boots `npm run dev` (or reuses a running one) on `http://localhost:5175`
- `tauri-mock.ts` shims `window.__TAURI_INTERNALS__` so the React app can render in plain Chrome (every `invoke()` would otherwise throw)
- Each test in `*.shot.ts` drives the UI into a target state and saves a PNG

## Adding a new shot

1. Open `app.shot.ts`
2. Copy an existing `test(...)` block
3. Use `page.evaluate(...)` or DOM interactions to set up state
4. Call `page.screenshot({ path: path.join(OUT_DIR, 'NN-name.png') })`

## Mocking Tauri commands

The default mock returns empty/null for the commands the app calls at startup. To return richer data:

```ts
await mockTauri(page, {
  list_folder_videos: () => [
    { name: 'clip1.mp4', path: '/fake/clip1.mp4' },
  ],
})
```

Unhandled commands log a warning and return `null` — check the page console output if a screenshot looks broken.

## Loading a real video

The asset protocol (`tauri://localhost/...`) won't work in plain Chrome. Either:

- Use a regular HTTP video URL in the mock for `load_video`, or
- Run the actual Tauri app and screenshot it with an OS-level tool (out of scope here)
