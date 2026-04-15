# clip-sync

Native desktop app for BPM-warping video to music. Place anchor points on a video timeline, align them to a beat grid, and export a time-stretched render where every cut lands on the beat.

Built with Tauri v2 + Rust + React/TypeScript.

---

## How it works

1. Load a video
2. Drop anchor points on the timeline at musically significant moments
3. Drag the beat-side of each anchor to align it to the target beat grid
4. Export — the app slices the video at each anchor, time-stretches each segment with FFmpeg, and concatenates the result

The warp pipeline uses a piecewise-linear time map. Each segment between anchors is stretched independently using FFmpeg's `setpts` (video) and `atempo` chain (audio). Stretch ratios outside the 0.5–2.0× `atempo` limit are handled by chaining multiple filters.

---

## Stack

| Layer | Technology |
|---|---|
| App shell | Tauri v2 |
| Backend | Rust (`tokio`, `ffmpeg` subprocess) |
| Frontend | React 19 + TypeScript |
| State | Redux Toolkit |
| Video processing | FFmpeg / ffprobe CLI |

---

## Prerequisites

- [Rust](https://rustup.rs/)
- [Node.js](https://nodejs.org/) 18+
- FFmpeg and ffprobe on `PATH`

---

## Development

```bash
npm install
npm run tauri dev     # hot reload
```

```bash
npm run tauri build   # release build for current OS
```

For bundled releases, FFmpeg/ffprobe binaries go in `src-tauri/binaries/` and are declared as `externalBin` in `tauri.conf.json`.

---

## Testing

```bash
npm test                   # Vitest — unit + BDD tests
npm run behaviors:check    # parse features/ + verify coverage
```

Tests use Vitest with all Tauri APIs mocked. No Rust toolchain needed to run them.

### Behavior system

Behavior specs live in `features/` as plain Gherkin. A script derives stable content-addressed IDs from each scenario's step text and writes `generated/behavior-registry.json`. Tests reference those IDs via `behaviorTest()`:

```
features/          → behaviors:parse →  generated/behavior-registry.json
                                                  ↓
tests/bdd/*.test.ts  (behaviorTest('id', ...))    ↓
                                         behaviors:coverage → report
```

```bash
npm run behaviors:parse     # regenerate registry after editing .feature files
npm run behaviors:coverage  # coverage report only (no re-parse)
npm run behaviors:check     # parse + coverage, exits 1 if anything is missing
```

IDs are deterministic: same step text always produces the same ID. Rename a scenario title without changing its steps and the ID is stable.

---

## Project structure

```
features/                  # Gherkin behavior specs (source of truth)
src/
├── api/                   # Tauri invoke() wrappers
├── components/            # React UI
├── store/                 # Redux slices, thunks, middleware, selectors
└── utils/                 # Pure functions (quantize, view math)
src-tauri/src/             # Rust backend
├── commands.rs            # Tauri command handlers
├── processor.rs           # Core warp pipeline (remap_video)
├── video.rs               # Video info + file fingerprinting
└── ffmpeg.rs              # FFmpeg/ffprobe subprocess helpers
tests/
├── bdd/                   # Behavior-linked integration tests
├── unit/                  # Slice, selector, and utility tests
└── helpers/               # Shared store factory and fixtures
generated/
└── behavior-registry.json # Committed — ties specs to test IDs
scripts/
└── behavior.ts            # Behavior compiler (parse / coverage / check)
```

---

## Architecture notes

**Video playback** — local files are served via Tauri's asset protocol (`convertFileSrc`). The `<video>` element uses a `tauri://localhost/...` URL; the CSP in `tauri.conf.json` must allow it.

**File fingerprinting** — `file_fingerprint()` hashes the first + last 512 KB plus file size. Fast enough to be synchronous, stable enough as a cache key for saved marker state.

**Warp jobs** — run in `tokio::task::spawn_blocking` (CPU-bound FFmpeg calls) inside `tokio::spawn` so the Tauri command returns immediately. Progress is streamed to the frontend via Tauri events.

**History** — undo/redo is implemented as an RTK listener middleware that maintains a capped snapshot stack. Loading a new video or sidecar pushes the pre-load state as the history base so the load itself is undoable.
