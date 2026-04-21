# Native Rust Migration — Analysis

A pragmatic look at replacing the Tauri + React/TypeScript frontend with a
native Rust GUI while keeping the existing Rust pipeline intact.

**Motivation: frame-accurate playback + timeline responsiveness.** This is
a precision frame-analysis tool. HTML5 `<video>` scrubs poorly (keyframe-
granular seeks, browser-debounced `currentTime` updates, no decoded-frame
cache) and the HTML timeline lags during drag/zoom (React reconciliation
+ CSS layout on every pointer event). Those are the two things that have
to get dramatically better; everything else is incidental.

## TL;DR

- The Rust backend (~4.3k LOC in `src-tauri/src/`) already contains all the
  heavy lifting — ffmpeg pipeline, PCHIP, RIFE, scene detection, thumbnails,
  storage. A migration is a **frontend replacement**, not a rewrite.
- The frontend (~7.4k LOC in `src/`) is dominated by a **custom timeline**
  (thin tracks, warp connectors, region bands, markers, filmstrip) plus a
  Redux store with persistence + history middleware. Most of this maps
  cleanly to an immediate-mode GUI.
- **The video layer is the reason to do this.** HTML5 `<video>` is
  architected for playback, not scrubbing. Replacing it with a purpose-built
  decode + frame-cache pipeline (ffmpeg-next, not mpv) is where the user-
  visible win comes from — and it's the part that justifies the rewrite.
- **The timeline is the second reason.** An immediate-mode GUI driven by
  pointer input directly into paint state — no VDOM diff, no CSS layout —
  is how you get sub-frame drag latency on a hundred markers.
- **Recommended framework: `egui`** (with `eframe` + wgpu backend). Custom
  timeline code has a straight translation to `Painter` + `Response`, and
  wgpu makes sharing a decoded video texture cheap.
- **Rough effort: 8–12 focused weeks** for a developer comfortable in Rust
  + egui + ffmpeg. Frame-accurate scrubbing alone is ~3–4 weeks; the rest
  is mechanical port work.

---

## Current architecture (inventory)

| Layer | LOC | What it does |
|---|---:|---|
| `src-tauri/src/` | 4,328 | ffmpeg pipeline, PCHIP, RIFE, scene detection, thumbnails, storage, IPC commands |
| `src/components/` | ~4,200 | Timeline, video player, sidebars, dialogs, menu bar |
| `src/store/` | ~1,300 | Redux slices, persistence + history middleware, thunks |
| `src/api/` | ~340 | Thin `invoke(...)` wrappers |
| `src/utils/` | ~450 | quantize, view math, snap, sceneFilter, time |
| `src/App.tsx` | 834 | Wiring, keyboard shortcuts, drag-drop |

Frontend breakdown of what's load-bearing:

- **Custom timeline** (`components/thin/*` + `WarpView.tsx` = ~1,300 LOC):
  ThinRuler, BarsTrack, BeatsTrack, MarkersTrack, ThumbnailStripTrack,
  RegionBand, TrackRow, ThinMinimap. Already canvas-like in intent — no
  library widgets, just coordinate math and paint calls.
- **Custom widgets**: Filmstrip, SpeedStrip, WarpConnector, SceneRow,
  ThumbnailPopup. Also paint-heavy.
- **Stock widgets**: ExportDialog (725 LOC), RegionInfoPanel (430),
  RegionSidebar, MarkerList, Toolbar, MenuBar. Forms + lists. Trivial in
  any GUI framework.
- **Video playback**: `VideoPlayer.tsx` (111 LOC) — just an HTML5 `<video>`
  + rAF loop emitting `currentTime`. Short, but backed by massive browser
  infrastructure we don't get for free natively.

### What the backend already exposes

Commands in `src-tauri/src/commands.rs` are already shaped as pure-ish
request/response functions plus event emitters. Reused verbatim from a
native frontend, they become normal Rust function calls — we drop
serde<->IPC boundaries entirely:

- `open_video` / `load_video` / `open_folder` — currently use
  `tauri-plugin-dialog`, native swaps to [`rfd`](https://crates.io/crates/rfd).
- `start_warp` / `start_diagnostic` — currently `tokio::spawn` returning a
  job id + `app.emit("warp-progress", ...)`. Native swaps `app.emit` for an
  `mpsc::Sender<Progress>` the UI thread polls.
- `save_video_state` / `load_video_state` / sidecar ops — already plain
  file I/O, no Tauri-specific API.

**Net:** `commands.rs` becomes a thin adapter from UI actions to library
calls; `lib.rs`'s Tauri builder goes away; `tauri-plugin-dialog` and
`tauri` deps are removed.

---

## Why the current stack is slow for *this* tool

### HTML5 `<video>` and frame-accurate scrubbing

The `<video>` element was designed for linear playback. Scrubbing is a
tacked-on secondary behavior, and it leaks implementation details:

- **Seeks are debounced.** Setting `video.currentTime` during a drag
  coalesces; Chromium emits one `seeked` per ~50–150ms of scrub. The UI
  shows the frame you were on 100ms ago, not the one under the cursor.
- **Seek precision is codec-dependent.** For long-GOP H.264/HEVC, the
  browser may snap to the nearest I-frame for "fast" seeks, or decode
  from the keyframe each time for precise seeks — with no API to pick.
  VFR (variable frame rate) sources and edit-list mp4s drift further.
- **No decoded-frame cache.** Every scrub past a frame re-decodes from
  the preceding keyframe. Scrubbing backwards is brutal — each step is
  a full keyframe-to-target decode.
- **No PTS-indexed access.** `currentTime` is a float in seconds; mapping
  it to "frame N at exactly 23.976fps" requires guessing, which is what
  `VideoPlayer.tsx`'s "spurious zero" workaround already hints at.
- **Hidden decode state.** We can't tell whether the next frame is
  already decoded or a seek is pending. That makes a responsive
  scrubbing UI (e.g., "show intermediate frames while dragging")
  impossible to build correctly.

The native answer is a **purpose-built scrubber**, not a "player":

- Index every packet's PTS on open (`ffprobe -show_packets` or one
  ffmpeg-next demux pass) → frame-number ↔ PTS ↔ byte offset map.
- LRU cache of recently decoded `N` frames around the playhead (say
  128 frames at 1080p = ~800 MB worst case; adjust).
- When the user drags, resolve cursor-time → target frame index,
  hit the cache, or decode forward from the nearest keyframe. Seeking
  backward crosses the keyframe boundary once and decodes forward.
- Pre-decode a forward/backward neighborhood on drag to hide latency.
- Upload the decoded frame to a wgpu texture (zero-copy if decoder
  outputs to a GPU-visible buffer).

This is ~2–3 weeks of focused work but it delivers something HTML5 cannot:
**the frame under your cursor, at cursor speed.**

### HTML timeline and drag / zoom lag

What makes the current timeline lag is not paint — SVG/canvas paint
is fast — it's the layer above it:

- **React reconciliation on every pointer tick.** A drag is ~60 events/s
  on a good mouse, 120+ on a touchpad. Each event touches Redux →
  middleware → reselect → component diffs → setState → reflow.
- **CSS layout thrashing on zoom.** Changing the view window resizes
  hundreds of track children; each one triggers style recalc + layout
  + paint even if its pixel output is trivial.
- **Handler closures re-created.** Most timeline children capture
  callbacks that change identity each render, defeating memoization
  unless every callback is manually pinned with `useCallback`.
- **Redux + persistence + history middleware on hot paths.** Every drag
  tick runs through `persistenceMiddleware` and `historyMiddleware`,
  even though we only want history snapshots on drag-end.

An immediate-mode GUI collapses this to:

```
pointer event → mutate AppState → repaint painters for current frame
```

There is no diff, no reflow, no middleware — one function call, one
paint. egui with wgpu paints a dense timeline at 60–120 Hz on any
recent laptop, with input latency measured in single-digit ms.

Zoom becomes a coordinate transform, not a layout change — nothing is
being resized, we're just redrawing with a different `view: View`
window.

---

## GUI framework options

Ranked by fit for this specific project.

### 1. `egui` + `eframe` — recommended

- **Model**: immediate mode. Every frame, you re-describe the UI from state.
- **Fit**: excellent. Our timeline code is already "paint from state" — no
  layout retention, no diffing. `Painter::line_segment`, `rect_filled`,
  `text` cover everything `components/thin/*` does today. Drag/resize of
  markers/regions maps 1:1 to `ui.interact` + `Response::dragged`.
- **Pros**:
  - Tiny API surface; learnable in a weekend.
  - Excellent custom-paint ergonomics; `Response` makes hit-testing easy.
  - Single-binary, no system webview, fast cold start (~50ms).
  - First-class wgpu backend — composites a video texture cheaply.
  - Built-in docking via `egui_dock` if we want movable panels later.
- **Cons**:
  - Non-native look (egui's own theme). For an internal tool, fine.
  - No built-in video widget (same as every other option here).
  - Accessibility is limited vs. native toolkits.
  - Text rendering is passable but not as crisp as native text engines.
- **Ecosystem**: mature, active. `egui_extras` adds tables, image loaders.

### 2. `iced`

- **Model**: Elm-like (messages + update + view), retained widgets.
- **Fit**: good for the forms/dialogs, awkward for a heavily custom
  timeline. Custom widgets require implementing the `Widget` trait with
  explicit layout/draw/event methods — more ceremony than egui for the
  same result.
- **Pros**: clean architecture, good for complex state machines, async
  built-in (`Command`/`Task`).
- **Cons**: timeline work becomes verbose; less mature custom-paint DX;
  smaller ecosystem than egui.

### 3. `Slint`

- **Model**: declarative DSL (`.slint` files) + Rust backend.
- **Fit**: nice for the sidebars/dialogs (DSL + hot reload is pleasant).
  Painful for a pixel-driven timeline — you either escape to a Rust
  `Image` canvas (losing most of Slint's value) or fight the DSL.
- **Pros**: best-looking default widgets of the three; designer-friendly;
  good docs.
- **Cons**: mixing declarative UI with imperative timeline code is
  awkward; licensing has commercial terms to review (GPL/royalty/paid).

### 4. `gtk4-rs`

- **Model**: native GTK widgets via gobject bindings.
- **Fit**: timeline would be a `DrawingArea` + cairo — feasible but
  we'd lose egui's `Response` ergonomics. Great for native menu bar,
  native file dialogs, native look on Linux.
- **Pros**: real native look, full accessibility, proven at scale.
- **Cons**: GTK on Windows ships a large runtime; macOS look is
  second-class; async GObject patterns are clunky from Rust.

### 5. `Dioxus Desktop` / `Tauri v2 without the WebView 2 layer`

- **Not recommended**. Both still rely on a system webview under the hood;
  we'd keep the "frontend is HTML" constraint that motivates the
  migration in the first place. If we go this route there's no point
  moving off Tauri.

### Decision

**`egui` + `eframe`**, with `wgpu` backend, `rfd` for file dialogs,
optional `egui_dock` for panels.

---

## The core work: a frame-accurate video engine

Given that scrubbing is the motivating requirement, "wire up a player" is
the *wrong* framing. We need a **frame-indexed decode cache**, and the
playback mode is just one consumer of it.

### Why libmpv is not the right pick here

mpv is a spectacular player and would be the fastest path to "this thing
plays a video." But mpv is architected around a single internal clock
driving continuous playback:

- Frame access goes through playback properties (`time-pos`, `percent-pos`);
  there is no public "give me the decoded frame at PTS X" API.
- Scrubbing is still seek-then-decode — mpv will be fast at it (better
  than a browser) but it still re-decodes from the keyframe on each
  direction change. It does not maintain a random-access frame cache we
  can query.
- Exposing the current decoded frame to egui requires render-callback
  hooks (`mpv_render_context`) with GL interop, which is additional
  glue for a behavior we'd rather own directly.
- We already have ffmpeg on the backend for warping. Adding libmpv means
  shipping two decode stacks with different codec behavior.

Use libmpv if "plays cleanly" is the goal. That's not our goal.

### The right architecture: ffmpeg-next + frame cache

One decode engine, two consumers (the scrubber and the playback loop):

```
┌─────────────────────┐      ┌──────────────────────────────┐
│  PacketIndex        │      │  FrameCache (LRU, GPU)       │
│  PTS ↔ frame_idx ↔  │◄─────┤  HashMap<frame_idx, Texture> │
│  keyframe byte map  │      │  prefetch around playhead    │
└─────────────────────┘      └───────────▲──────────────────┘
           ▲                             │
           │ built once on open          │ serve
           │                             │
┌──────────┴─────────────────────────────┴─────────┐
│  DecoderWorker (ffmpeg-next, own thread)         │
│  - seek_to_keyframe(before frame_idx)            │
│  - decode forward until frame_idx                │
│  - push frame → cache                            │
│  - hwaccel: d3d11va / videotoolbox / vaapi       │
└──────────────────────────────────────────────────┘
           ▲
           │ requests (frame_idx, priority)
           │
┌──────────┴──────────┐   ┌──────────────────────┐
│  Scrubber           │   │  Playback loop       │
│  cursor → frame_idx │   │  driven by wall clock│
│  request + fallback │   │  request next frame  │
└─────────────────────┘   └──────────────────────┘
```

Concretely:

- **Index pass on open**: demux all packets, record `(pts, dts, flags,
  byte_offset)`. Yields an exact frame-number ↔ PTS map + keyframe
  positions. ~1–3 seconds for a one-hour 1080p file; do it in the
  background and let the UI come up with a coarse thumbnail strip
  (which `thumbnails.rs` already generates).
- **Hardware decode**: ffmpeg supports `d3d11va` on Windows,
  `videotoolbox` on macOS. Negotiate at open; fall back to software.
  Decoded frame lands in GPU memory → wgpu texture with zero-copy in
  the good case (`AV_PIX_FMT_D3D11` → wgpu shared texture).
- **Frame cache**: LRU sized by bytes (cap at e.g. 1.5 GB RAM + 512 MB
  VRAM) keyed by `frame_idx`. Evict least-recently-requested.
- **Scrubber**: on pointer move, compute `frame_idx`, request from
  cache. Hit = paint. Miss = paint the nearest cached frame immediately
  (so the cursor never lags), enqueue the real request high-priority.
  During a sustained drag, prefetch ±N frames around the playhead in
  both directions so reverse scrub is cheap.
- **Playback**: schedule by wall clock, pull from cache, fall through
  to decoder if missed. Rate control (variable speed preview) changes
  the schedule, not the decode.
- **Audio**: `cpal` for output; resample with `rubato` when preview
  playback rate ≠ 1.0. Audio does not need frame-indexing — a ring
  buffer fed by a separate decoder thread is enough.

### Effort and risk, honestly

| Piece | Est. | Risk |
|---|---:|---|
| ffmpeg-next open + packet index | 2d | Low |
| Software decode → wgpu RGBA upload | 2d | Low |
| Hardware decode (d3d11va on Windows) + zero-copy texture | 4d | Medium — wgpu interop is fiddly |
| Frame cache + eviction | 2d | Low |
| Scrubber: request / fallback / prefetch | 3d | Medium — tuning prefetch around direction changes is empirical |
| Playback loop + wall-clock sync | 2d | Low |
| Audio output + speed resample | 3d | Medium — A/V sync during variable-speed preview |
| VFR + edit-list handling | 2d | Medium — same edge cases `VideoPlayer.tsx` already hits |
| Polish, HDR passthrough decisions, 10-bit handling | 3d | Medium |
| **Total** | **~23d / 4.5w** | |

That's the biggest single chunk of the migration. It's also the piece
that delivers the user-visible win. If we don't do this part right,
there's no point in the project.

### Fallback options

| Option | When it's acceptable |
|---|---|
| **libmpv** | If frame-accurate scrubbing turns out to be "close enough" with mpv's precise-seek mode and we ship sooner. Not recommended as the first choice given the stated motivation. |
| **gstreamer appsink** | If ffmpeg-next's Rust bindings prove too painful or licensing shifts. Similar architecture (own decode, feed cache). |
| **ffmpeg CLI over a pipe** | Prototyping only. Too much latency and IPC overhead for real scrubbing. |

### Rendering the video frame

- Decode target is an RGBA (or NV12 → shader-converted) texture.
- egui supports user textures via `TextureHandle` or direct wgpu texture
  registration with `eframe::Frame::wgpu_render_state()`.
- On every repaint, upload the current frame (or skip if unchanged) and
  draw it with `Image::new(texture, size)` in the player pane.
- At ~30fps for a 4K source, this is ~30MB/frame uploaded → ~900MB/s.
  That's fine on desktop GPUs but we'll want zero-copy via shared
  GL/wgpu textures rather than CPU uploads for 4K+ footage.

### Audio

Add `cpal` for output (or let mpv handle it internally, which is what we'd
pick with the mpv approach). When warping playback rate for preview,
either use mpv's `speed` property or a real-time `atempo`-style resampler
(`rubato` crate).

---

## Porting map, subsystem by subsystem

| Today | Native replacement | Notes |
|---|---|---|
| React components | egui `Ui`/`Window`/`SidePanel` functions | One function per "panel"; state lives in a plain struct. |
| Redux slices | Plain Rust structs in an `AppState` | Immediate mode doesn't need a diffing store; just mutate and repaint. |
| `historyMiddleware` | Snapshot stack of `AppState` (or the warp+region subset) on commands | Same idea, smaller. |
| `persistenceMiddleware` | Call `storage::save_video_state` from the command handler directly | No middleware layer needed. |
| `reselect` selectors | `#[derive]` helper methods on `AppState`; memoize with `once_cell` if measured | Immediate mode cheapens recomputation. |
| `invoke(...)` + event listeners | Direct calls + `mpsc` channels | Delete `src/api/`. |
| `tauri-plugin-dialog` | `rfd` crate | `AsyncFileDialog` variant for non-blocking pickers. |
| `@tauri-apps/api/event` | `crossbeam_channel` or `tokio::sync::mpsc` polled in `update()` | One progress channel per job. |
| `convertFileSrc(path)` + `<video>` | `libmpv` render callback into a shared texture | See above. |
| Drag/drop events | `ctx.input(|i| i.raw.dropped_files)` | egui surfaces these natively. |
| Keyboard shortcuts (App.tsx) | `ctx.input(|i| i.key_pressed(Key::X))` | Straightforward. |
| Menu bar (`MenuBar.tsx`) | `egui::menu::bar` or native menu via `muda` crate | `muda` gives native OS menu (Cmd+Q on macOS, etc.) — recommended. |
| Context menus | `response.context_menu(...)` | Built in. |
| CSS styling | `egui::Style` + theme tokens | Port `themes/` tokens to a `Style` factory. |
| Vitest + behaviors | Keep most of it; port UI behaviors to `egui::Harness` tests or skip | Backend tests (`cargo test`) are unchanged. |

### Timeline: concrete translation

`ThinTimeline` + its track children become a single function:

```rust
fn timeline(ui: &mut Ui, state: &mut AppState, view: View) {
    let (rect, response) = ui.allocate_exact_size(
        vec2(ui.available_width(), TIMELINE_HEIGHT),
        Sense::click_and_drag(),
    );
    let painter = ui.painter_at(rect);

    draw_ruler(&painter, rect, view);
    draw_filmstrip(&painter, rect, view, &state.thumbnails);
    draw_region_bands(&painter, rect, view, &state.regions);
    draw_markers(&painter, rect, view, &state.warp.orig_anchors);
    draw_warp_connectors(&painter, rect, view, &state.warp);
    draw_playhead(&painter, rect, view, state.warp.playhead);

    handle_drag(&response, state, view);
}
```

Hit-testing becomes `response.hover_pos()` + `Rect::contains` — simpler
than maintaining pointer-event handlers on SVG elements.

---

## What we gain

- **Frame-accurate scrubbing.** The cursor shows the frame it's over,
  including backwards. This is impossible to achieve correctly in HTML5
  and is the headline feature of the rewrite.
- **Sub-frame timeline latency.** Pointer-to-paint in one frame with no
  reconciliation, no layout, no middleware on the hot path. Zooming a
  hundred markers becomes a coordinate transform, not a reflow storm.
- **Deterministic frame addressing.** Frame index ↔ PTS ↔ seconds is a
  bijection maintained by us. The "spurious zero" and VFR-drift fixes
  in `VideoPlayer.tsx` go away because we own the clock.
- **Typed throughout.** `types.ts` / Rust serde split disappears; no IPC
  round-trips on the scrub hot path.
- **Single binary.** ~20–40 MB (with statically-linked ffmpeg) vs.
  ~80 MB Tauri + system webview.

## What we lose / risks

- **Video engine is the risk.** Frame-accurate scrubbing is the reason
  to do this and the place where the project can fail. If the decoder/
  cache architecture doesn't pan out in the first spike, the rest of
  the migration is wasted effort. **Prototype this first, before
  committing to the rest.**
- **Hardware-decode interop is platform-specific.** `d3d11va` → wgpu on
  Windows, `videotoolbox` → wgpu on macOS. Each has edge cases. Plan
  for a software-decode fallback that still hits 60fps on 1080p.
- **Codec coverage is our problem.** The browser silently handles
  weird H.264 profiles, HEVC in mp4, WebM/VP9, edit-list containers,
  10-bit, HDR. ffmpeg covers everything in principle but each new
  container surface is a small bug hunt.
- **DevEx for UI iteration is slower.** No CSS hot reload; Rust
  recompiles. `eframe` rebuilds are fast but not instant.
- **Look-and-feel is our job.** egui themes look like egui themes.
  Acceptable for a precision tool; not for a consumer app.
- **Accessibility regresses.** Minor for a power-user tool, real for
  anyone relying on a screen reader.
- **Throw-away cost.** ~6,000 LOC of TS/TSX + all of `src/api/` gets
  deleted. That's the point, but it's sunk work.

---

## Effort estimate

Assuming one developer comfortable in Rust + egui + ffmpeg, and that the
existing backend (`processor.rs`, `diagnostic.rs`, `rife.rs`,
`thumbnails.rs`, `scene.rs`, `pipeline/*`) is kept and linked as a
library:

| Phase | Scope | Estimate |
|---|---|---:|
| 0. Cargo restructure | Split `src-tauri/src/` into `lockstep-core` (no Tauri deps) + `lockstep-ui` (eframe app). Delete tauri deps. | 0.5 week |
| 1. **Video engine spike** | ffmpeg-next demux + software decode + wgpu texture + trivial cache + scrubber demo against a real clip. **Gates the rest of the project.** | 1.5 weeks |
| 2. Video engine productionized | Hardware decode (d3d11va/videotoolbox), zero-copy GPU upload, full LRU cache, prefetch heuristics, audio output, variable-rate preview, VFR/edit-list handling | 3 weeks |
| 3. App shell | eframe app, window, menu bar (muda), `rfd` dialogs, open-file flow | 0.5 week |
| 4. State + persistence | `AppState` struct, history snapshots, wire `save_video_state`/`load_video_state` directly | 0.5 week |
| 5. Timeline port | `thin/*` tracks, WarpView interactions, drag/select/resize, snap — benchmark drag/zoom latency against current React version | 2 weeks |
| 6. Sidebars & dialogs | RegionSidebar, RegionInfoPanel, MarkerList, ExportDialog, SettingsDialog | 1 week |
| 7. Export flow | Hook `start_warp` + progress channel to ExportProgressBar; batch export | 0.5 week |
| 8. Polish | Keyboard shortcuts, drag-drop, Windows packaging, smoke testing | 1 week |
| **Total** | | **~10 weeks** |

The video engine lines (1 + 2) are ~45% of the work. If the phase 1
spike doesn't convince you that frame-accurate scrubbing is achievable
on representative footage, **abandon before phase 2.** That's cheap.
Committing past phase 2 without a working engine is not.

---

## Alternatives worth naming

1. **Stay on Tauri, replace React with Leptos/Dioxus Web.** Keeps webview,
   gets us a single-language stack. Doesn't solve the IPC/packaging
   complaints. Pass.
2. **Stay on Tauri, keep React.** Zero migration cost. If the current
   pain is just frontend code quality, rewriting pieces (e.g., `App.tsx`)
   in place is cheaper than a platform change. This is the "do nothing"
   baseline.
3. **Go native but skip Rust UI** — write the UI in C++/Qt or
   Swift/AppKit talking to a Rust core via FFI. Best-looking UI of any
   option, by far the most work, and splits the team's skillset.

---

## Recommendation

The motivation (frame-accurate scrubbing + timeline responsiveness)
justifies the migration, but it concentrates the risk in one place: the
video engine. The correct sequence is:

1. **Week 0: extract `lockstep-core`** — same Rust code, no Tauri. Now
   linkable as a library.
2. **Weeks 1–2: build the scrubber spike.** ffmpeg-next + LRU frame
   cache + wgpu upload + an egui window that does nothing but paint the
   frame under the cursor. Test on: a long-GOP H.264 mp4, a 10-bit HEVC
   clip, a VFR screen recording, an edit-list mp4. If scrubbing feels
   like the cursor is welded to the frame, you have your answer.
3. **Go/no-go decision.** If the spike works, commit to phases 2–8. If
   it doesn't — if hardware decode interop is too painful, or scrubbing
   feels laggy even with the cache — **stop**. Consider: stay on Tauri
   and invest the time instead in a WebCodecs-based scrubber in the
   browser (now that WebCodecs is supported in Tauri's webview). That's
   a smaller, uglier, but potentially sufficient win.
4. **Phases 3–8** are mechanical and low-risk. The timeline port will
   be satisfying — egui's paint model is tailor-made for this — and
   the rest of the frontend is forms.

Don't migrate for generic reasons (IPC, packaging, "Rust is cool"). The
backend is already Rust; those wins are real but not worth 10 weeks on
their own. Migrate because you want the frame under the cursor, and
because a timeline that paints at the same rate as the pointer changes
how the tool feels to use.
