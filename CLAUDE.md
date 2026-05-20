# Lockstep

A native desktop app for BPM-warping video to music. Tauri v2 + Rust + React/TypeScript.

---

## Status

Pre-release. **No users in the wild** — no installed builds, no saved state to migrate. Don't write migrations, deprecation shims, or "fallback to legacy field" branches. When a schema or default changes, change it. When a feature is removed, delete it; don't keep stubs.

---

## Stack

- **Tauri v2** — app shell, native dialogs (`tauri-plugin-dialog`), asset protocol for local video playback.
- **Rust backend** — all processing logic exposed as Tauri commands.
- **React + TypeScript + Redux Toolkit** — UI with centralized state.
- **FFmpeg CLI** — invoked as a subprocess via `std::process::Command`.
- **RIFE (optional)** — frame interpolation pass when stretching beyond 1× without judder; ships as a sidecar binary.

No OpenCV. No HTTP server. No Python.

---

## Project structure

```
src/                            # React frontend
├── api/                        # invoke() wrappers around each Tauri command surface
│   ├── video.ts                #   open/load/list video, reveal_in_folder, sidecars
│   ├── warp.ts                 #   startWarp + warp-progress events, analyze_anchors, save_output
│   ├── diagnostic.ts           #   diagnostic + overlay video jobs
│   ├── scene.ts                #   scene detection (PySceneDetect-style cuts)
│   ├── thumbnails.ts           #   thumbnail queue priority + cache control
│   ├── extract.ts              #   single-frame extract
│   └── storage.ts              #   save_video_state / load_video_state by file fingerprint
├── store/
│   ├── store.ts                # Redux store wiring + middleware stack
│   ├── hooks.ts                # useAppDispatch, useAppSelector
│   ├── selectors.ts            # top-level selectors (warp data, active region, selection sets, …)
│   ├── selectors/
│   │   ├── timeline.ts         #   memoised selectors consumed by WarpView / CanvasTimeline
│   │   └── constraintGraph.ts  #   constraint-graph queries
│   ├── slices/
│   │   ├── videoSlice.ts       # loaded video info, folder list, marker-count cache
│   │   ├── warpSlice.ts        # orig + beat anchors, BPM, beat zero, stretch bounds, playhead
│   │   ├── regionSlice.ts      # regions list + activeRegionId
│   │   ├── sceneSlice.ts       # detected scenes per video
│   │   ├── thumbnailsSlice.ts  # thumbnail cache state
│   │   ├── listsSlice.ts       # multi-selection sets per list panel
│   │   ├── dragSlice.ts        # pre-drag snapshot + active flag (used by replay)
│   │   ├── dragCtxSlice.ts     # transient gesture state for the constraint pipeline
│   │   ├── settingsSlice.ts    # theme, UI scale, etc.
│   │   ├── uiSlice.ts          # layout panel sizes, view window, playing, export-open
│   │   └── historySlice.ts     # undo/redo stack
│   ├── middleware/
│   │   ├── persistenceMiddleware.ts        # auto-saves warp+region state to disk by fileHash
│   │   ├── historyMiddleware.ts            # snapshots for undo/redo
│   │   ├── selectionGraphMirrorMiddleware.ts   # mirrors lasso → constraint graph
│   │   ├── anchorLockMirrorMiddleware.ts       # mirrors anchor-lock state
│   │   ├── globalLockModeMirrorMiddleware.ts   # mirrors lock mode (bpm/beats)
│   │   ├── dragCtxMirrorMiddleware.ts          # passthrough stub (retained for test imports)
│   │   └── revealPlayheadMiddleware.ts         # auto-scrolls timeline to keep playhead visible
│   └── thunks/
│       ├── videoThunks.ts      # openFileThunk / openFolderThunk / selectVideoThunk
│       ├── regionThunks.ts     # region CRUD with history snapshotting
│       ├── clipoutThunks.ts    # clipout (beat-space) pan/resize
│       ├── dragThunks.ts       # dispatchPipelinedReplay + beginReplayFrame
│       ├── entityWriteThunks.ts# entity write helpers routed through the constraint pipeline
│       └── sceneThunks.ts      # scene detection orchestration
├── constraints/                # Typed constraint graph + resolver pipeline
│   ├── types.ts                # Entity, Constraint, Intent, DragCtx
│   ├── recipes.ts              # high-level gestures: lasso, lockOn, snapToSiblings, …
│   ├── resolver.ts             # walks state.constraints, dispatches by kind
│   ├── pipeline.ts             # Propose / Restrict / Finalize / Derive phases
│   ├── pipelineDispatch.ts     # entry point used by the controller + tests
│   ├── closure.ts              # transitive movement closure for a drag
│   ├── snap-index.ts           # spatial index used for snap candidates
│   ├── snap-rules.ts           # which entities snap to which, per gesture
│   └── ids.ts                  # anchorInId / anchorOutId / regionInId / isClipOut helpers
├── timeline/                   # Canvas timeline rendering + interaction layer
│   ├── controller.ts           # pure pointer/wheel/key state machine → Intent[]
│   ├── hitTest.ts              # what's under the cursor
│   ├── layout.ts               # track layout, minimap geometry
│   ├── view.ts                 # zoom/pan helpers
│   ├── ruler.ts                # time-tick rendering
│   ├── palette.ts              # colors used by the canvas
│   ├── types.ts                # Snapshot, Intent, DragState
│   └── model/                  # pure data model (no React, no Redux)
│       ├── beatMap.ts          #   anchor pair construction, orig↔beat mapping
│       ├── effectiveBounds.ts  #   region in/out resolution
│       ├── snapTarget.ts       #   snap-target derivation
│       ├── newRegionBounds.ts  #   default span when creating a region
│       ├── clampRegion.ts      #   clamp to video duration
│       ├── linkState.ts        #   anchor↔edge default-link state machine
│       └── linkingEvent.ts     #   link/unlink event semantics
├── components/                 # React UI surface — pure wiring, no prop-side logic
│   ├── CanvasTimeline.tsx      #   timeline canvas + controller wrapper
│   ├── ExportDialog.tsx        #   export modal (single + batch)
│   ├── RegionInfoPanel.tsx     #   BPM / stretch / lock controls for active region
│   ├── MenuBar.tsx             #   custom app menu bar
│   ├── ContextMenu.tsx         #   generic context menu
│   ├── HotkeySheet.tsx         #   ? overlay
│   ├── AssistantPanel.tsx      #   in-app assistant
│   └── …                       #   filmstrip, thumbnails, scenes, speed strip, etc.
├── layout/                     # dockview panels + center column (video + timeline)
│   ├── CenterColumn.tsx
│   ├── PanelDock.tsx
│   └── panels/                 # ClipInfo, Clips, FileBrowser, Markers, Scenes, VideoInfo, …
├── utils/                      # quantize, snap, time fmt, anchor augmentation, …
├── themes/                     # CSS themes
├── assistant/                  # core tools registered with the in-app assistant
├── hotkeys.ts, menus.ts
├── App.tsx, main.tsx
└── types.ts                    # VideoInfo, Anchor, Region, WarpData, …

src-tauri/src/                  # Rust backend
├── main.rs / lib.rs            # entry + plugin/command registration
├── commands.rs                 # all Tauri command handlers (front door for IPC)
├── video.rs                    # get_video_info, file_fingerprint via ffprobe
├── processor.rs                # remap_video — core warp pipeline
├── pipeline/                   # supporting passes: segments, time_map, post, rife_pass, options
├── ffmpeg.rs                   # subprocess helpers, atempo_chain
├── pchip.rs                    # monotone piecewise-cubic time map (smoothing)
├── diagnostic.rs               # diagnostic + overlay video generation
├── scene.rs                    # scene-cut detection
├── thumbnails.rs               # thumbnail queue + cache
├── rife.rs                     # RIFE frame-interp sidecar driver
└── storage.rs                  # save_video_state / load_video_state (app data dir)
```

---

## Command surface

All IPC uses `invoke()` on the frontend and `#[tauri::command]` on the backend. Full list:

| Surface             | Commands                                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **File / folder**   | `open_video`, `load_video`, `open_folder`, `list_folder_videos`, `reveal_in_folder`, `show_in_folder`                                                                                                                                      |
| **Warp / export**   | `analyze_anchors`, `start_warp`, `start_diagnostic`, `save_output`, `pick_export_folder`, `save_to_folder`                                                                                                                                 |
| **Frame extract**   | `extract_frame`                                                                                                                                                                                                                            |
| **Scenes**          | `start_scene_detection`, `cancel_scene_detection`                                                                                                                                                                                          |
| **Thumbnails**      | `set_thumbnail_priority`, `get_thumbnail_queue_stats`, `get_thumbnail_path`, `clear_thumbnails`, `clear_all_thumbnails`                                                                                                                    |
| **Sidecar / state** | `save_video_state`, `load_video_state`, `list_saved_hashes`, `get_file_hash`, `check_video_sidecar`, `write_video_sidecar`, `delete_video_sidecar`, `open_json_file`, `read_json_sidecar_for_video`, `load_llc_project`, `write_text_file` |

Progress events fire on a per-job channel:

```rust
app.emit("warp-progress", json!({ "job_id": id, "percent": 0.5, "status": "running", "message": "..." }))
// terminal: status "done" + output_path, or status "error" + error
```

Other event channels: `diagnostic-progress`, `scene-progress`, `thumbnail-progress`.

---

## Constraint pipeline

The timeline's behaviour lives in a typed constraint graph, not in components.

- **Entities** — anchors, clips (clipin in input-space and clipout in beat-space), regions.
- **Constraints** — `MirrorPair`, `ConformVisual`, `DirectedPair` (Translate / MirrorEdge), `TranslateGroup`, `ScaleGroup`, `SnapTarget`, default-link, etc.
- **Pipeline phases** — `Propose` → `Restrict` → `Finalize` → `Derive`. Each frame of a drag dispatches an `Intent` through the pipeline; the pipeline returns the new entity values to write back to the slices.
- **Replay model** — `dispatchPipelinedReplay` reapplies from a pre-drag snapshot every pointer event, with `beginReplayFrame` resetting slice state to that baseline first. This is why intents are pure functions of cursor + delta rather than stateful mutations.
- **Controller is intent-pure** — `src/timeline/controller.ts` carries only "what was grabbed" on `DragState`; payloads come from cursor + snapshot at intent-emit time, never from a parallel mirror.

If you're touching drag behaviour or selection semantics, you almost certainly want to read or extend `src/constraints/` and `src/timeline/controller.ts`, not the React components.

---

## State architecture

Redux Toolkit. Slices map to data, not to features:

- **`video`** — loaded video info, folder list, marker-count cache.
- **`warp`** — orig + beat anchors, BPM, beat-zero anchor, stretch bounds, playhead, loop.
- **`region`** — regions + `activeRegionId`.
- **`scene`** — detected scenes per video.
- **`thumbnails`** — thumbnail cache state.
- **`lists`** — multi-selection sets per list panel.
- **`drag`** — pre-drag snapshot + active flag (replay baseline).
- **`dragCtx`** — transient gesture state for the constraint pipeline (lassoIds, snapInstall, anchorLock).
- **`settings`** — theme, UI scale.
- **`ui`** — layout panel sizes, view window, playing, export-open.
- **`history`** — undo/redo snapshots.

`persistenceMiddleware` auto-saves warp + region state to the Rust backend keyed by `video.fileHash` whenever anchors or regions change. Mirror middlewares keep the constraint graph in sync with selection / lock-mode / anchor-lock state.

Pure-data derivations from slice state live in `src/store/selectors/timeline.ts` and are consumed via `useAppSelector`. **TSX files should be pure wiring** — no prop-side logic. If a component grows useMemo blocks doing real work, that work belongs in a selector.

---

## Warp pipeline (`processor.rs` + `src-tauri/src/pipeline/`)

`remap_video()` is the core function. Given anchor points (orig → beat times), it:

1. Builds a piecewise-linear (or monotone-cubic via `pchip`) time map.
2. Slices the video into segments at each control point.
3. Time-stretches each segment with `setpts` (video) + `atempo` chain (audio).
4. Optionally interpolates frames with RIFE on stretches > 1×.
5. Concatenates segments via the ffmpeg concat demuxer.
6. Post-processes: loop trimming, beat-zero rearrangement, BPM normalization.

`atempo` is limited to 0.5–2.0× per filter — `atempo_chain()` in `ffmpeg.rs` chains multiple filters for ratios outside that range.

Warp jobs run in `tokio::task::spawn_blocking` inside a `tokio::spawn`, so the command returns immediately and progress streams through `warp-progress` events.

---

## Regions

Regions are named sub-clips with their own in/out points and BPM settings. They appear as overlays on the timeline and in the Clips panel.

- Beat zero is always at `region.inPoint`.
- `lock` controls whether BPM or beat count stays fixed when in/out are resized.
- `inBeatTime` / `outBeatTime` override the default beat-space boundaries for export.
- Regions are exported independently via `ExportDialog` (single or batch).

---

## Video playback

Local files are served via Tauri's asset protocol (`convertFileSrc(path)`) — the `<video>` element loads a `tauri://localhost/...` URL. The CSP in `tauri.conf.json` must allow this.

Drag-and-drop comes through `getCurrentWebview().onDragDropEvent`: a video file loads directly, a `.json` sidecar loads its sibling video, a folder opens in the sidebar.

---

## File fingerprinting

`file_fingerprint()` in `video.rs` hashes the first 512 KB + last 512 KB + file size. This is the storage key for persisted marker / region state — content-identifying without reading the whole file.

---

## Tests + BDD spec

- **Vitest** (`npm run test:unit`) — `tests/unit/` is unit-level (split between `unit-*` for business logic and `scenario-*` for behavior-specific reproductions in `tests/unit/constraints/`). `tests/bdd/` and `tests/helpers/` cover BDD-level fixtures driven by `@amiceli/vitest-cucumber`.
- **Rust** (`npm run test:rs`) — `cargo test` in `src-tauri/` against an isolated `target-test` dir. Heavy tests gated on `--ignored`.
- **Behavior coverage** (`npm run behaviors`) — `scripts/behavior.ts` parses `spec/features/*.feature` into `spec/generated/behavior-registry.json`, then scans tests for `// @behavior <name>::<hash>` markers. A coverage gate runs in CI.
- **Layout coverage** (`npm run layouts`) — same pattern for `spec/layouts/*.yaml`.

`spec/` is the source of truth for feature behavior. **Don't edit anything in `spec/` unless explicitly asked.**

---

## Screenshots

Three flows, cleanly separated:

| Purpose     | Where                                 | How                                                                                                                       |
| ----------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Docs**    | `docs/screenshots/` (committed)       | `npm run screenshots` runs `tests/screenshots/app.shot.ts`                                                                |
| **PR (CI)** | `tests/screenshots/out/` (gitignored) | comment `/screenshot …` on a PR — `.github/workflows/screenshot.yml` runs `scripts/screenshot.ts` and posts inline images |
| **Local**   | `tests/screenshots/out/` (gitignored) | `scripts/screenshot-local.ts` mirrors the CI flow via local `gh`                                                          |

Full reference: `tests/screenshots/README.md`.

---

## Dev & build

```bash
npm run tauri dev     # hot reload
npm run tauri build   # release build for the current OS
npm test              # vitest + rust tests
npm run build         # tsc + vite build (no Tauri bundling)
```

FFmpeg/ffprobe must be on `PATH` for dev. For packaged releases they live in `src-tauri/binaries/` and are declared as `externalBin` in `tauri.conf.json`. RIFE is optional and ships the same way.
