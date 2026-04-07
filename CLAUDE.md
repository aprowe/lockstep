# vj-toolkit-rs

A native desktop app for BPM-warping video to music. Built with Tauri v2 + Rust backend + React/TypeScript frontend. No Python, no HTTP server, no sidecar.

---

## Stack

- **Tauri v2** — app shell, native dialogs (`tauri-plugin-dialog`), asset protocol for local video playback
- **Rust backend** — all processing logic as Tauri commands
- **React + TypeScript** — UI
- **FFmpeg CLI** — invoked as subprocess via `std::process::Command`

No OpenCV. No HTTP server. No Python.

---

## Project Structure

```
src/                        # React frontend
├── api/
│   ├── video.ts            # openVideo() → invoke('open_video')
│   └── warp.ts             # startWarp(), listenWarpProgress(), analyzeAnchors(), saveOutput()
├── components/
│   ├── Timeline.tsx         # Anchor point editor on video scrubber
│   ├── WarpPanel.tsx        # BPM + warp options controls
│   ├── WarpView.tsx         # Main view: video + timeline + warp panel
│   ├── WarpConnector.tsx    # Connects anchors to beat grid visually
│   ├── VideoPlayer.tsx      # HTML5 video with seek/playback controls
│   └── ClipSidebar.tsx      # Clip in/out trimming
├── utils/
│   ├── quantize.ts          # Snap anchor times to beat grid
│   └── view.ts              # Viewport/zoom helpers for timeline
└── types.ts                 # Shared types (VideoInfo, etc.)

src-tauri/src/              # Rust backend
├── main.rs                 # Entry point (calls lib.rs::run())
├── lib.rs                  # Tauri builder, plugin registration, command registration
├── commands.rs             # Tauri command handlers (thin layer over video/processor)
├── video.rs                # get_video_info(), file_fingerprint() via ffprobe
├── processor.rs            # estimate_bpm(), remap_video() — core warp pipeline
└── ffmpeg.rs               # FFmpeg/ffprobe subprocess helpers, atempo_chain()
```

---

## Command Surface

All IPC uses `invoke()` on the frontend and `#[tauri::command]` on the backend.

| Command | Source | Description |
|---|---|---|
| `open_video` | `commands.rs` | Opens native file picker, returns `VideoInfo` |
| `analyze_anchors` | `commands.rs` | Estimates BPM from tap times |
| `start_warp` | `commands.rs` | Starts async warp job, returns `job_id` immediately |
| `save_output` | `commands.rs` | Opens native save dialog, copies output file |

Progress during `start_warp` is streamed via Tauri events — no polling:

```rust
// Backend emits during processing
app.emit("warp-progress", json!({ "job_id": id, "percent": 0.5, "status": "running" }))
```

```ts
// Frontend listens
import { listen } from '@tauri-apps/api/event'
const unlisten = await listenWarpProgress(payload => { ... })
```

---

## Warp Pipeline (`processor.rs`)

`remap_video()` is the core function. Given a set of anchor points (orig_times → beat_times), it:

1. Builds a piecewise-linear time map (`direct_time_map`)
2. Slices the input video into segments at each control point
3. Time-stretches each segment with `setpts` (video) + `atempo` chain (audio)
4. Concatenates all segments with ffmpeg concat demuxer
5. Post-processes: loop trimming, beat-zero rearrangement, BPM normalization

`atempo` filters are limited to 0.5–2.0x range by the FFmpeg API — `atempo_chain()` in `ffmpeg.rs` handles ratios outside that range by chaining multiple filters.

Warp jobs run in `tokio::task::spawn_blocking` (CPU-bound FFmpeg calls) inside a `tokio::spawn` so the command returns immediately.

---

## Video Playback

Local video files are served via Tauri's asset protocol (`convertFileSrc(path)`) — the `<video>` element points to a `tauri://localhost/...` URL. The CSP in `tauri.conf.json` must allow this.

---

## File Fingerprinting

`file_fingerprint()` in `video.rs` computes a short hash from: first 512 KB + last 512 KB + file size. Fast enough to be synchronous, stable enough to use as a cache key.

---

## Dev & Build

```bash
npm run tauri dev     # dev mode (hot reload)
npm run tauri build   # release build for current OS
```

FFmpeg/ffprobe must be on PATH in dev. For bundled releases, they go in `src-tauri/binaries/` and are declared as `externalBin` in `tauri.conf.json`.

---

## What's Not Here Yet

- **Multi-clip / cutter** — batch clip extraction and warp. Next major feature.
- **FPS interpolation** (`rife-ncnn-vulkan`) — out of scope for now.
- **Effects** — out of scope for now.
