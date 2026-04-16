# Lockstep

A native desktop app for BPM-warping video to music. Built with Tauri v2 + Rust backend + React/TypeScript frontend. No Python, no HTTP server, no sidecar.

---

## Developing Features
- Feature development is behavior driven.
- Run `npm run behaviors:check` to check for unimplemented or changed behaviors

## Design & Visual Spec
- See `docs/VISUAL_SPEC.md` for the full design system (Neon Rhythm Theme): colors, layout grid, shape language, glow rules, motion principles, and component specs.

---

## Stack

- **Tauri v2** — app shell, native dialogs (`tauri-plugin-dialog`), asset protocol for local video playback
- **Rust backend** — all processing logic as Tauri commands
- **React + TypeScript + Redux Toolkit** — UI with centralized state
- **FFmpeg CLI** — invoked as subprocess via `std::process::Command`

No OpenCV. No HTTP server. No Python.

---

## Project Structure

```
src/                        # React frontend
├── api/
│   ├── video.ts            # openVideo(), openFolder() → invoke(...)
│   ├── warp.ts             # startWarp(), listenWarpProgress(), analyzeAnchors(), saveOutput()
│   ├── diagnostic.ts       # startDiagnostic(), listenDiagnosticProgress()
│   └── storage.ts          # saveVideoState(), loadVideoState()
├── components/
│   ├── Timeline.tsx         # Anchor point editor on video scrubber
│   ├── WarpView.tsx         # Main view: video + timeline + warp panel; clip overlays for regions
│   ├── WarpConnector.tsx    # Connects anchors to beat grid visually
│   ├── VideoPlayer.tsx      # HTML5 video with seek/playback controls
│   ├── VideoFolderSidebar.tsx # Left sidebar: folder video list
│   ├── RegionSidebar.tsx    # Left panel: region/clip list with CRUD
│   ├── RegionInfoPanel.tsx  # BPM / stretch / lock controls for active region
│   ├── MarkerList.tsx       # Right panel: marker table with snap/reset/delete actions
│   ├── ExportDialog.tsx     # Export modal: warp options, region selection, batch export
│   ├── Toolbar.tsx          # Playback controls, mark, jump, set in/out, grid div
│   ├── MenuBar.tsx          # Custom app menu bar (File / Edit / View)
│   └── ContextMenu.tsx      # Generic context menu (used for region overlays)
├── store/
│   ├── store.ts             # Redux store with persistence + history middleware
│   ├── hooks.ts             # useAppDispatch, useAppSelector
│   ├── selectors.ts         # selectWarpData, selectActiveRegion, selectSelectedIdsSet
│   ├── slices/
│   │   ├── videoSlice.ts    # video info, folder video list, marker count cache
│   │   ├── warpSlice.ts     # anchors, BPM, beat zero, stretch bounds, playhead
│   │   ├── regionSlice.ts   # regions list, activeRegionId
│   │   ├── uiSlice.ts       # layout sizes, view window, playing state, export open
│   │   └── historySlice.ts  # undo/redo stack
│   ├── middleware/
│   │   ├── persistenceMiddleware.ts  # Auto-saves video state to Rust backend on changes
│   │   └── historyMiddleware.ts      # Captures snapshots for undo/redo
│   └── thunks/
│       └── videoThunks.ts   # openFileThunk, openFolderThunk, selectVideoThunk, etc.
├── utils/
│   ├── quantize.ts          # Snap anchor times to beat grid
│   ├── view.ts              # Viewport/zoom helpers, calcNewRegionBounds()
│   └── time.ts              # Time formatting utilities
└── types.ts                 # Shared types (VideoInfo, Anchor, Region, WarpData, etc.)

src-tauri/src/              # Rust backend
├── main.rs                 # Entry point (calls lib.rs::run())
├── lib.rs                  # Tauri builder, plugin registration, command registration
├── commands.rs             # All Tauri command handlers
├── video.rs                # get_video_info(), file_fingerprint() via ffprobe
├── processor.rs            # estimate_bpm(), remap_video() — core warp pipeline
├── diagnostic.rs           # generate_diagnostic_video(), generate_overlay_video()
├── storage.rs              # save_video_state(), load_video_state() — app data dir persistence
└── ffmpeg.rs               # FFmpeg/ffprobe subprocess helpers, atempo_chain()
```

---

## Command Surface

All IPC uses `invoke()` on the frontend and `#[tauri::command]` on the backend.

### File / Folder
| Command | Description |
|---|---|
| `open_video` | Native file picker → `VideoInfo` |
| `load_video` | Load video by path (no dialog) → `VideoInfo` |
| `open_folder` | Native folder picker → `VideoEntry[]` (video files sorted by name) |
| `list_folder_videos` | List video files in a path (no dialog) → `VideoEntry[]` |
| `reveal_in_folder` | Open path in OS file manager |

### Warp / Export
| Command | Description |
|---|---|
| `analyze_anchors` | Estimates BPM from tap times |
| `start_warp` | Starts async warp job → `job_id` (progress via `warp-progress` events) |
| `start_diagnostic` | Generates diagnostic or overlay video → `job_id` (progress via `diagnostic-progress`) |
| `save_output` | Native save dialog → copies temp output file |
| `pick_export_folder` | Native folder picker for batch export → path string |
| `save_to_folder` | Copy temp output to a folder without dialog |

### Sidecar / State
| Command | Description |
|---|---|
| `save_video_state` | Persist marker/region state by file hash (app data dir) |
| `load_video_state` | Load persisted state by file hash |
| `check_video_sidecar` | Read `<stem>.json` next to video file, if it exists |
| `write_video_sidecar` | Write `<stem>.json` next to video file |
| `delete_video_sidecar` | Delete `<stem>.json` next to video file |
| `open_json_file` | Native JSON picker → reads file + finds sibling video |
| `read_json_sidecar_for_video` | Load a `.json` path directly → `{ json_content, video_path }` |
| `write_text_file` | Write arbitrary text to a given path |

Progress events during `start_warp`:
```rust
app.emit("warp-progress", json!({ "job_id": id, "percent": 0.5, "status": "running", "message": "..." }))
// Final: status "done" + output_path, or status "error" + error
```

---

## State Architecture

State is managed with Redux Toolkit. Key slices:

- **`video`** — loaded video info, folder video list, marker-count-by-path cache, `markersLoaded` flag
- **`warp`** — orig/beat anchors, BPM, beat zero anchor, stretch bounds, playhead, loop options
- **`region`** — list of `Region` objects (sub-clips with in/out, BPM, lock mode), `activeRegionId`
- **`ui`** — layout panel sizes, timeline view window (`{ start, end }` seconds), playing state, export open flag
- **`history`** — undo/redo snapshots (managed by `historyMiddleware`)

`persistenceMiddleware` auto-saves warp + region state to Rust backend keyed by `video.fileHash` whenever anchors or regions change.

---

## Regions

Regions are named sub-clips of a video with their own in/out points and BPM settings. They appear as colored overlays on the timeline and in the `RegionSidebar`. Key behaviors:

- Beat zero is always at `region.inPoint`
- `lock` field controls whether BPM or beat count stays fixed when in/out are resized
- `inBeatTime` / `outBeatTime` allow overriding the default beat-space boundaries for export
- Regions are exported independently via `ExportDialog` (single or batch)

---

## Warp Pipeline (`processor.rs`)

`remap_video()` is the core function. Given anchor points (orig_times → beat_times), it:

1. Builds a piecewise-linear time map (`direct_time_map`)
2. Slices the video into segments at each control point
3. Time-stretches each segment with `setpts` (video) + `atempo` chain (audio)
4. Concatenates all segments with ffmpeg concat demuxer
5. Post-processes: loop trimming, beat-zero rearrangement, BPM normalization

`atempo` is limited to 0.5–2.0x — `atempo_chain()` in `ffmpeg.rs` chains multiple filters for ratios outside that range.

Warp jobs run in `tokio::task::spawn_blocking` inside a `tokio::spawn` so the command returns immediately.

---

## Video Playback

Local files are served via Tauri's asset protocol (`convertFileSrc(path)`) — the `<video>` element uses a `tauri://localhost/...` URL. The CSP in `tauri.conf.json` must allow this.

Drag-and-drop is handled via `getCurrentWebview().onDragDropEvent`. Dropping a video file loads it directly; dropping a `.json` sidecar loads the sibling video; dropping a folder opens it in the sidebar.

---

## File Fingerprinting

`file_fingerprint()` in `video.rs` hashes: first 512 KB + last 512 KB + file size. Used as the storage key for persisted marker/region state.

---

## Dev & Build

```bash
npm run tauri dev     # dev mode (hot reload)
npm run tauri build   # release build for current OS
```

FFmpeg/ffprobe must be on PATH in dev. For bundled releases, they go in `src-tauri/binaries/` and are declared as `externalBin` in `tauri.conf.json`.
