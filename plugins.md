# Lockstep Plugin System — Design

> **Status:** Design proposal. Not implemented.
> **Driving example:** an AI plugin that reads scene cuts and frames from a video and produces regions matching a natural-language query (e.g. *"make a clip for every scene with a horse"*).

---

## 1. Goals

- **Extend the app without forking it.** Third parties (and us) can ship analyzers, exporters, importers, and panels without touching `src/` or `src-tauri/`.
- **Language-agnostic for backend work.** AI/ML plugins want Python; format converters might want Node; native filters want Rust. The protocol must not pin one runtime.
- **Safe by default.** A plugin gets nothing it didn't declare. Network, filesystem, subprocess access are explicit permissions.
- **Cancelable, async, observable.** Long-running plugins report progress and can be aborted from the UI, the same way `start_warp` / `start_scene_detection` already do.
- **Round-trip cleanly with existing state.** A plugin's output (regions, markers, scene cuts) flows through the same Redux actions a human would dispatch — undoable, persistable via `persistenceMiddleware`, indistinguishable from hand-edited state.

## 2. Non-Goals (for v1)

- Hot-reload / live development of plugins. Restart the app to pick up changes.
- Plugins modifying the warp pipeline (`processor.rs`) or core UI chrome (`MenuBar`, `Timeline`). They extend, not replace.
- A plugin marketplace or auto-update. Manual install from a folder or zip.
- Sandboxing of native subprocess plugins beyond OS-level permissions. Users install a subprocess plugin at the same trust level as installing a CLI tool.

---

## 3. Plugin Tiers

A plugin is one or both of:

### 3a. **UI plugin** — frontend-only, ESM module
A `.js` bundle the renderer dynamically imports. Best for:
- Custom panels (extra sidebar tabs)
- Marker math / region transforms that don't need heavy compute
- Custom export dialogs / batch operators

Has access to a typed `host` API (see §6). Cannot run subprocesses or hit the network outside of `host.fetch` (which the host can gate).

### 3b. **Worker plugin** — subprocess, JSON-RPC over stdio
The host launches an executable declared in the manifest (`worker.command`). Communication is line-delimited JSON: requests in, events + responses out. Best for:
- AI / ML inference (Python, ONNX, llama.cpp wrappers)
- Heavy CV (OpenCV, decord)
- Calling external services
- Anything that benefits from a real package ecosystem

A worker plugin can also ship a UI bundle that drives it — this is the **hybrid** case (most realistic plugins).

> **Why not WASM?** Worth revisiting later. WASM gives sandboxing for free, but most "interesting" plugins want PyTorch / network / FFmpeg, which means WASI gaps. Subprocess is the path of least resistance for v1.

---

## 4. Layout & Manifest

### 4a. Disk layout

Plugins live under the Tauri app data dir, mirroring the existing `markers/` convention:

```
<appData>/lockstep/
├── markers/
└── plugins/
    └── ai-scene-tagger/
        ├── manifest.json
        ├── icon.svg            (optional, 24px)
        ├── ui/
        │   └── index.js        (ES module, optional)
        └── worker/
            ├── main.py
            ├── requirements.txt
            └── ...
```

A plugin is a directory with a `manifest.json` at its root. Drop-in install = copy the folder. Uninstall = delete it.

### 4b. Manifest schema

```jsonc
{
  "id": "com.lockstep.ai-scene-tagger",     // reverse-DNS, unique
  "name": "AI Scene Tagger",
  "version": "0.1.0",
  "apiVersion": "1",                         // host plugin-API major version
  "author": "Alex Rowe",
  "description": "Find clips matching a natural-language query.",
  "icon": "icon.svg",

  "permissions": [
    "regions.read",
    "regions.write",
    "scenes.read",
    "video.frames.read",
    "net.fetch",                             // outbound HTTP
    "secrets.read:OPENAI_API_KEY"            // named secret only
  ],

  "ui": {
    "entry": "ui/index.js",
    "panels": [
      { "id": "tagger", "title": "AI Tag", "side": "right" }
    ]
  },

  "worker": {
    "command": ["python", "worker/main.py"],
    "cwd": "worker",
    "env": { "PYTHONUNBUFFERED": "1" }
  },

  "commands": [
    {
      "id": "ai-scene-tagger.find",
      "title": "Find clips matching…",
      "menu": "Plugins/AI Tag",              // appears under MenuBar → Plugins
      "shortcut": null
    }
  ],

  "config": {                                // user-editable in Settings → Plugins
    "schema": [
      { "key": "model", "type": "enum",
        "options": ["claude-opus-4-7", "gpt-4o", "gemini-1.5-pro"],
        "default": "claude-opus-4-7" },
      { "key": "framesPerScene", "type": "int", "min": 1, "max": 8, "default": 3 },
      { "key": "minConfidence", "type": "float", "min": 0, "max": 1, "default": 0.5 }
    ],
    "secrets": ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"]
  }
}
```

### 4c. Permissions

Permissions are **opt-in** strings the host enforces at the broker layer (see §6). Unknown permissions cause a load error; the user sees a "this plugin needs X" dialog the first time they enable it. Sketch of the namespace:

| Namespace | Capability |
|-----------|-----------|
| `regions.read` / `regions.write` | Read or dispatch region CRUD |
| `markers.read` / `markers.write` | Same for markers |
| `scenes.read` / `scenes.write` | Read scene cuts, request scene detection |
| `warp.read` / `warp.write` | Anchors, BPM, beat zero |
| `video.metadata.read` | `VideoInfo` for the active video |
| `video.frames.read` | Extract frames at given timestamps via host-mediated ffmpeg |
| `video.file.read` | Raw filesystem read of the source video (rarely needed) |
| `net.fetch` | Outbound HTTP via `host.fetch` |
| `subprocess` | Worker plugin permission — required to declare a `worker` block |
| `secrets.read:<NAME>` | Read a specific named secret from the host's secret store |
| `fs.write.output` | Write to the temp output dir (for plugins that produce video files) |

The host always denies any capability not in the manifest, even if the user previously granted it. Granting is per-permission and persisted in `<appData>/plugins/grants.json`.

---

## 5. Lifecycle

```
discover → load manifest → user enables → grant permissions → register commands/panels
                                                                       │
                                                                       ▼
                                  [user invokes a command]
                                                                       │
                                                                       ▼
                              spawn worker (lazy) ──► JSON-RPC session
                                                                       │
                                              progress events ◄────────┤
                                                                       │
                                                  result ◄─────────────┘
```

- **Discover** on startup: enumerate `<appData>/plugins/*/manifest.json`.
- **Load** is metadata-only — no code runs.
- **Enable** is a per-user choice (Settings → Plugins). First enable shows the permission grant dialog.
- **Worker spawn** is lazy: the first command that needs the worker triggers `command + cwd + env`. The process stays alive for the rest of the session unless `worker.idleTimeout` is set in the manifest.
- **Cancel**: the host sends `{ "method": "cancel", "params": { "id": <reqId> } }`. Worker is expected to abort and emit a final `error: "cancelled"`. Same shape as `cancel_scene_detection`.
- **Crash recovery**: if the worker exits unexpectedly, in-flight requests reject; the host marks the plugin as unhealthy and offers a restart.

---

## 6. Host API (UI side)

A UI bundle exports a default function:

```ts
// ui/index.js
export default function activate(host: PluginHost): PluginExports {
  host.commands.register('ai-scene-tagger.find', async () => {
    const query = await host.dialog.prompt('Describe what to find:')
    if (!query) return
    const job = await host.worker.invoke('findScenes', { query })
    job.onProgress(p => host.toast.update(job.id, `${Math.round(p * 100)}% — ${p.message ?? ''}`))
    const result = await job.result   // ← throws on cancel/error
    host.dispatch.regions.addMany(result.regions)
  })

  return {
    panels: { tagger: TaggerPanel },
  }
}
```

The `host` object is a typed surface gated by the manifest's permissions. Calling something the manifest didn't declare throws synchronously — caught and reported as a load-time validation failure where possible.

```ts
interface PluginHost {
  // — Read state —
  state: {
    video(): VideoInfo | null
    regions(): Region[]
    markers(): Marker[]
    scenes(): { cuts: number[]; threshold: number } | null
    warp(): WarpData
    subscribe<T>(selector: (s: AppState) => T, fn: (v: T) => void): () => void
  }

  // — Dispatch (write) state —
  dispatch: {
    regions: { add(r: Region): void; addMany(rs: Region[]): void; delete(id: string): void; update(r: Partial<Region> & { id: string }): void }
    markers: { add(m: Marker): void; ... }
    scenes:  { setCuts(cuts: number[]): void; runDetection(opts?: { threshold?: number }): Promise<number[]> }
    warp:    { setAnchors(orig: Anchor[], beat: Anchor[]): void; setBpm(bpm: number): void }
  }

  // — Worker bridge (only if a worker is declared) —
  worker: {
    invoke<TParams, TResult>(method: string, params: TParams): Job<TResult>
  }

  // — UI primitives —
  dialog: { prompt; confirm; selectFile; selectFolder }
  toast:  { info; error; update(id, msg); dismiss(id) }
  panels: { focus(id: string): void }

  // — Misc —
  fetch:  typeof fetch                           // gated by net.fetch
  secrets: { get(name: string): Promise<string> } // gated by secrets.read:NAME
  log:    { info; warn; error }                  // routes to lockstep's logger
  config: { get<T>(key: string): T; set<T>(key: string, v: T): void }
}

interface Job<T> {
  id: string
  cancel(): void
  onProgress(fn: (e: { percent: number; message?: string }) => void): void
  readonly result: Promise<T>
}
```

`dispatch.*` translates to existing Redux thunks/actions — the plugin doesn't see Redux, just a stable façade. That keeps `historyMiddleware` (undo) and `persistenceMiddleware` (autosave) working without per-plugin coordination: a plugin's region adds are undoable like any user edit.

---

## 7. Worker Protocol (JSON-RPC over stdio)

Line-delimited JSON, one message per line. Request shape mirrors JSON-RPC 2.0 minus the trappings:

**Host → worker:**
```json
{"id": "1", "method": "init", "params": {"plugin_dir": "...", "config": {...}, "secrets": {...}}}
{"id": "2", "method": "findScenes", "params": {"video_path": "...", "scenes": [12.3, 47.1, ...], "query": "horse"}}
{"id": "2", "method": "cancel"}
```

**Worker → host:**
```json
{"id": "2", "event": "progress", "percent": 0.42, "message": "scoring scene 5/12"}
{"id": "2", "event": "log", "level": "info", "message": "claude returned 3 matches"}
{"id": "2", "event": "result", "value": {"regions": [...]}}
{"id": "2", "event": "error", "code": "rate_limited", "message": "..."}
```

### Worker-callable host methods (reverse direction)

A worker often needs the host to do something privileged — extract a frame, fetch a URL through a permission-checked client, look up a secret. The worker writes a request *with no `id` collision* and receives a response:

```json
// worker → host
{"id": "h-7", "method": "host.video.frames", "params": {"path": "...", "timestamps": [12.3, 12.5, 12.7], "max_dim": 512}}
// host → worker (response)
{"id": "h-7", "result": {"frames": [{"t": 12.3, "jpeg_b64": "..."}, ...]}}
```

Reusing a single duplex stream keeps everything ordered. Host methods exposed to workers, gated by permissions, include:

| Method | Permission | Purpose |
|--------|------------|---------|
| `host.video.frames` | `video.frames.read` | Extract JPEG frames at given timestamps via ffmpeg |
| `host.video.info` | `video.metadata.read` | Get `VideoInfo` for a path |
| `host.scenes.detect` | `scenes.write` | Run scene detection (delegates to existing `start_scene_detection`) |
| `host.fetch` | `net.fetch` | HTTP request — host can rate-limit / log |
| `host.secrets.get` | `secrets.read:<NAME>` | Resolve a secret by name |
| `host.log` | (always) | Log line into lockstep's logger |

Frame extraction is the most important one: it means individual plugins don't ship their own ffmpeg, and the user doesn't grant raw filesystem access just to read frames. We already have `ffmpeg.rs` — wrapping it as a host-method is straightforward.

---

## 8. Backend (Rust) Surface

New module: `src-tauri/src/plugins/`. New Tauri commands:

| Command | Purpose |
|---|---|
| `list_plugins` | Enumerate manifests + enabled/granted state |
| `enable_plugin` / `disable_plugin` | Toggle in `grants.json` |
| `set_plugin_grants` | Update permission grants for a plugin |
| `start_plugin_job` | Spawn worker (if not running) and send a `method` call → returns `job_id` |
| `cancel_plugin_job` | Cancel by job id |
| `set_plugin_config` | Persist plugin's `config` block |
| `set_plugin_secret` | Write to OS keychain via `tauri-plugin-stronghold` or equivalent |

Progress events use the existing pattern:
```rust
app.emit("plugin-progress", json!({ "plugin_id": ..., "job_id": ..., "percent": ..., "status": "running", "message": ... }))
```

Worker management is one struct in the Tauri-managed state:

```rust
pub struct PluginRuntime {
    workers: Mutex<HashMap<String, WorkerHandle>>,  // plugin_id → handle
}

pub struct WorkerHandle {
    child: tokio::process::Child,
    stdin: ChildStdin,
    pending: Mutex<HashMap<String, oneshot::Sender<Value>>>,  // req_id → reply
    grants: Vec<Permission>,
}
```

A reader task per worker pulls lines from stdout, splits responses (with `id`) from events, routes events to `app.emit`, and resolves matching `pending` slots for results. A writer task accepts host-side `host.*` calls and replies on the same stream.

Reuse `tokio::task::spawn_blocking` and `tokio::spawn` exactly the way `start_warp` does so progress eventing is uniform.

---

## 9. UI Integration Points

- **MenuBar**: top-level `Plugins` menu, populated from each enabled plugin's `commands` block. `menu: "Plugins/AI Tag"` produces `Plugins → AI Tag → Find clips matching…`.
- **Settings → Plugins**: list of installed plugins, enable/disable, per-plugin config form (driven by `config.schema`), secrets entry, "Reveal in Folder", "Uninstall".
- **Right sidebar tabs**: panels declared with `side: "right"` add tabs. Plugin renders into a host-provided container.
- **Toasts / progress chips**: `host.toast.*` and `host.worker.invoke` progress feed the existing toast/progress system that warp jobs use.
- **Region context menu**: a future hook (`onContextMenu(target: 'region', items: ...)`) lets plugins add items to existing menus. Out of scope for v1.

---

## 10. Worked Example — `ai-scene-tagger`

User flow:

1. User opens `horses.mp4`.
2. Optionally runs scene detection (or relies on existing `scenes.cuts`).
3. `Plugins → AI Tag → Find clips matching…`
4. Prompt: *"horse"*.
5. Toast: *"AI Tag: scoring scene 4/12…"* with cancel button.
6. Toast clears; **N new regions** appear on the timeline named `horse-1 … horse-N`, each spanning a scene boundary, with a `confidence` value in metadata.
7. The user keeps, edits, or deletes them like any other region.

### Plugin internals

**`worker/main.py`** (sketch):

```python
import sys, json, base64
from anthropic import Anthropic

def respond(id, **kwargs): print(json.dumps({"id": id, **kwargs}), flush=True)

def call_host(method, params):
    rid = f"h-{next_id()}"
    print(json.dumps({"id": rid, "method": method, "params": params}), flush=True)
    return await_reply(rid)   # blocks reading stdin until matching id

def find_scenes(req_id, params):
    video = params["video_path"]
    cuts  = params["scenes"] or []           # falls back to whole-video scan if empty
    query = params["query"]
    fps   = CFG["framesPerScene"]
    min_c = CFG["minConfidence"]
    spans = pairs(cuts, end=params["duration"])

    matches = []
    for i, (start, end) in enumerate(spans):
        respond(req_id, event="progress", percent=i / len(spans),
                message=f"scoring scene {i+1}/{len(spans)}")
        ts = sample_timestamps(start, end, fps)
        frames = call_host("host.video.frames", {"path": video, "timestamps": ts, "max_dim": 512})["frames"]
        score, label = score_frames(frames, query)   # multimodal Claude call
        if score >= min_c:
            matches.append({"inPoint": start, "outPoint": end, "score": score, "label": label})

    regions = [{
        "id": new_id(), "name": f"{query}-{i+1}",
        "inPoint": m["inPoint"], "outPoint": m["outPoint"],
        "bpm": 120, "minStretch": 0.5, "maxStretch": 2.0,
        "addToEnd": False,
    } for i, m in enumerate(matches)]

    respond(req_id, event="result", value={"regions": regions, "matches": matches})

# main loop reads stdin, dispatches by method, calls find_scenes for "findScenes"
```

**Manifest permissions used:**
- `regions.write` (the host writes them, but the plugin builds the payload — same grant)
- `scenes.read` (read existing scene cuts to avoid re-detecting)
- `video.frames.read` (extract sample frames per scene via host)
- `net.fetch` (call Claude API) — *or* `secrets.read:ANTHROPIC_API_KEY` if the worker uses the SDK directly with a host-provided key.

**Cancel behavior:** host emits `{"id": req_id, "method": "cancel"}`. Worker breaks out of the scene loop and emits `{event: "error", code: "cancelled"}`. The host's `Job<T>.cancel()` triggers this; the toast disappears and no regions are added.

**Failure modes worth handling:**
- API rate limit → worker emits structured error `code: "rate_limited"` with `retry_after`. Host shows it in the toast.
- No scene cuts available → worker either runs scene detection itself via `host.scenes.detect`, or falls back to a fixed-stride sample window. `framesPerScene` config covers both.
- Result regions overlap existing ones → not the plugin's problem. The user resolves overlap; regions on the timeline are allowed to overlap today.

---

## 11. What This Doesn't Solve (yet)

- **Plugin → plugin composition.** A plugin can't depend on another plugin's output programmatically. (The user can chain by hand.)
- **Streaming results.** A plugin must produce its full result set before regions appear. For a long AI run that's annoying — a future event `event: "partial", regions: [...]` could let the host render results incrementally.
- **Per-region attachments.** The plugin wants to store `confidence` and a thumbnail. `Region` doesn't currently carry arbitrary metadata. Either: extend `Region` with `metadata: Record<string, unknown>` (cheap, persisted via existing path), or have plugins write a separate sidecar keyed by `region.id`. The first is preferable; mention it as a tiny precursor change to land before plugins.
- **Sandboxing.** A worker subprocess inherits the user's permissions. WASM-based workers + a capability-based filesystem (à la Wasmtime preopens) is the long-term answer; out of scope for v1.
- **Plugin development experience.** No scaffolding CLI, no schema validation tooling, no test harness. Worth a follow-up doc once the core protocol is real.

---

## 12. Suggested Build Order

1. **Region metadata field.** Extend `Region` with `metadata?: Record<string, unknown>`. Trivial, unblocks plugins persisting per-region scores/labels.
2. **Manifest loader + Settings panel.** No execution yet; just discover, list, enable/disable.
3. **UI plugin runtime.** Dynamic import + host facade. Land with one trivial example plugin (e.g. "Snap all markers to nearest beat") to validate the API.
4. **Worker runtime.** JSON-RPC stdio, host methods (`host.video.frames`, `host.fetch`, `host.secrets.get`).
5. **Permission grant UI.** Wire to `grants.json` and enforce in the broker.
6. **AI Scene Tagger plugin** as the first real consumer — simultaneously a dogfood test and a template.

Each step is independently shippable behind a `plugins.enabled` setting.
