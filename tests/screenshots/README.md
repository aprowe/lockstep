# Screenshots (Playwright)

Automated screenshots of the Lockstep UI, served via Playwright pointed at the Vite dev server.

## One-time setup

```bash
npm run playwright:install   # downloads chromium (~150 MB)
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

## Posting screenshots to a PR (Screenshot workflow)

The `Screenshot` workflow runs Playwright against the same dev-server +
tauri-mock + seed setup used here, then comments on a PR with the resulting
images inline (renders in the GitHub mobile app). It accepts three trigger
paths:

### Trigger A — PR comment (works from anywhere, including phone)

Comment on any PR, anywhere — phone, web, Claude, MCP — with `/screenshot`
followed by the JSON instructions. The workflow reacts with eyes,
runs the capture, then posts the screenshots and reacts with rocket.

````
/screenshot
```json
[
  {
    "name": "overview",
    "seed": { "video": { "duration": 32 }, "bpm": 120 }
  }
]
```
optional preface text after the fenced block
````

Or reference a JSON file checked into the PR's branch:

```
/screenshot @scripts/shots/export-audio.json optional preface text
```

A starter set of reusable shot specs lives at `scripts/shots/`.

This path needs no OAuth `workflow` scope — anything that can post a PR
comment can fire it. Best option for "develop away from your machine."

### Trigger B — Actions UI / `gh workflow run`

```bash
gh workflow run screenshot.yml \
  -f pr_number=123 \
  -f comment="Verse panel after change" \
  -f instructions='[
    {
      "name": "01-overview",
      "seed": {
        "video": { "duration": 32, "name": "beach.mp4" },
        "bpm": 120,
        "anchors": [[2.1, 2.0], [5.85, 6.0], [9.7, 10.0]],
        "regions": [
          { "name": "Intro", "inPoint": 0, "outPoint": 8 },
          { "name": "Verse", "inPoint": 8, "outPoint": 20 }
        ],
        "view": { "start": 0, "end": 32 },
        "activeRegion": "Verse"
      }
    },
    {
      "name": "02-bpm-panel",
      "seed": { "video": { "duration": 32 }, "bpm": 120 },
      "selector": ".rip"
    },
    {
      "name": "03-hotkey-sheet",
      "evaluate": "window.dispatchEvent(new KeyboardEvent(\"keydown\",{key:\"?\"}))"
    }
  ]'
```

Step fields (see `scripts/screenshot.ts` for the source of truth):

| field      | type                                  | notes                                              |
|------------|---------------------------------------|----------------------------------------------------|
| `name`     | string (required)                     | `[\w.-]+` — becomes the PNG filename               |
| `url`      | string                                | Path on the dev server. Default `/`                |
| `seed`     | `SeedState` (see `state.ts`)          | Dispatched into the Redux store                    |
| `evaluate` | string of JS                          | Run with `new Function(code)()` in the page        |
| `selector` | CSS selector                          | If set, screenshots that element instead of page   |
| `clip`     | `{x,y,width,height}`                  | Clip rectangle for full-page shots                 |
| `fullPage` | bool                                  | Whole scroll height                                |
| `viewport` | `{width,height}`                      | Default `1440x900`, dpr 2                          |
| `waitMs`   | number                                | Extra settle time after networkidle                |

Output is uploaded as a workflow artifact and committed to a long-lived
`screenshots` branch under `pr-<N>/<run_id>/`, then referenced via
`raw.githubusercontent.com` URLs in a PR comment.

### Trigger C — Local (no GitHub Actions runner)

`scripts/screenshot-local.ts` does the same thing on your machine using your
local `gh` auth — useful when the dispatch route is blocked or when iterating
on the JSON locally.

```bash
# inline JSON
npx tsx scripts/screenshot-local.ts \
  --pr 45 \
  --instructions '[{"name":"overview","seed":{"video":{"duration":32},"bpm":120}}]' \
  --comment "Verse panel after change"

# from a file
npx tsx scripts/screenshot-local.ts --pr 45 --instructions @./shots.json

# generate PNGs without pushing or commenting
npx tsx scripts/screenshot-local.ts --pr 45 --instructions @./shots.json --dry-run
```

Requires `gh` signed in (`gh auth login`). PNGs land in `tests/screenshots/out/`,
get pushed to `screenshots:pr-<N>/local-<timestamp>/`, and the PR gets a
comment with raw URL image refs.

### Updating the workflow

GitHub gates `.github/workflows/*.yml` writes behind the `workflow` OAuth
scope. Agents/tokens without that scope can't push edits directly. To
update:

- **Web UI** — edit `.github/workflows/screenshot.yml` on GitHub and
  commit. Doable from a phone browser.
- **`gh`** — push from a terminal where `gh auth login` was run with
  `--scopes workflow` (the default scopes already include it).

If a session lacks `workflow` scope, stage proposed YAML somewhere outside
`.github/workflows/` and apply it via one of the above paths.
