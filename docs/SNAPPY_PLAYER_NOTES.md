# Snappy player (experimental)

A prototype canvas-based video player that replaces the HTML5 `<video>`
element with an ffmpeg-fed frame stream rendered to a 2D canvas. Goal: make
scrub feel instant by paying the decode cost once, in advance, around the
playhead.

Off by default. Toggle on in **Settings → Snappy player (experimental)**.

## How it works

```
┌─────────────┐  Channel<ArrayBuffer>   ┌────────────────────┐  ImageBitmap
│  ffmpeg     │  ─────────────────────▶ │  SnappyVideoPlayer │ ──────────▶ <canvas>
│  -c:v mjpeg │  16-byte header + JPEG  │  ring-buffer cache │
└─────────────┘                         └────────────────────┘
       ▲
       │ -ss start -t span -vf fps=N -f image2pipe
       │
   src-tauri/src/frame_stream.rs
```

1. The frontend asks Rust for a window of frames around the current playhead
   (`WINDOW_SECONDS / 2` on each side, capped to the clip's bounds).
2. Rust spawns ffmpeg with `-f image2pipe -c:v mjpeg`, parses each complete
   JPEG out of stdout by scanning for SOI/EOI markers, and sends them as raw
   binary messages on a per-invocation Tauri `Channel<InvokeResponseBody>`.
3. The frontend decodes each JPEG with `createImageBitmap`, inserts it into
   a pts-sorted ring buffer, and blits the nearest cached frame to a 2D
   canvas on every seek or animation tick.
4. When the playhead gets within `PREFETCH_MARGIN` seconds of either edge of
   the cached window, a new stream is requested centred on the current
   playhead. The old stream is cancelled but its decoded frames are kept
   until they fall outside the new window.

Audio is a sibling `<audio>` element pointed at the same path via
`convertFileSrc`. The cache walker only drives the visual canvas; audio
playback is left to the browser, with `currentTime` resynced on seek.

## Wire format

Each frame on the Channel is a single binary message:

```
offset  size  field
     0     4  index    (u32 LE) — frame # within the requested window
     4     8  pts      (f64 LE) — absolute presentation time in seconds
    12     4  jpeg_len (u32 LE) — bytes of JPEG that follow
    16   ...  jpeg     (jpeg_len bytes)
```

Defined twice — once in `src-tauri/src/frame_stream.rs::encode_frame_message`
and once in `src/api/frameStream.ts::decodeFrameMessage`. Keep them in sync.

## Why binary IPC instead of `emit("frame-ready", base64)`

- ~33% less bandwidth (no base64 expansion).
- One fewer copy on the JS side — `createImageBitmap` gets bytes that came
  straight out of ffmpeg with no string conversion.
- Per-invocation Channel lifetime is a cleaner fit than a global event:
  cancelling the invoke teardown the callback automatically, and
  superseded streams can't accidentally feed the wrong window.

Tauri's Channel routes payloads ≥ 1024 bytes through the fetch API, so
720p JPEGs (typically 50–150 KB) arrive as a single `ArrayBuffer` callback
with no chunking visible to the consumer.

## What works

- Sub-frame scrub latency inside the cached window — the canvas is always
  showing the cached frame nearest the requested pts.
- Window repositions happen in the background; no black flash between
  windows (overlap is preserved across the cancel-and-restart).
- Play / pause / seek all go through `VideoPlayerHandle`, same interface
  as the existing `VideoPlayer.tsx`, so `CenterColumn` swaps the two
  components without any other wiring changes.
- **Beat-time playback**: the player accepts an optional `getRate(t)`
  callback. The cache walker reads it on every animation frame, re-anchors
  the play clock, and pushes the same rate onto the `<audio>` element —
  so warped playback follows the orig→beat anchor map identically to the
  HTML5 player path. Both players source the rate from
  `beatRateAt()` in `src/timeline/model/beatMap.ts`.

## Known gaps

- **Audio sync is best-effort.** The cache-walker drives the visual clock;
  the `<audio>` element is told to track via `currentTime = ...` on seek
  but drifts under heavy scrub. A proper fix would use a single shared
  AudioContext clock or hand audio decoding to Rust as well.
- **Beat-time prefetch is rate-blind.** When playback hits a fast segment
  (orig 2× beat), the cache empties twice as quickly but the prefetch
  margin is still in seconds-of-source. Long fast segments can outrun
  the decode and stall briefly at the window edge. Scaling the margin by
  the local rate would fix this.
- **Window-edge stalls.** Crossing into a not-yet-decoded region costs one
  ffmpeg spawn + first-frame decode (~150 ms on a warm SSD). The window
  is sized at 6 seconds (= ~180 frames at 30 fps), so most scrubs stay
  inside the cache.
- **Bandwidth at high res.** Capped at 1280 width regardless of source.
  4K input is downsampled to 720p for display — fine for editing, not
  fine for previewing colour grading.
- **Frame stepping doesn't yet snap to ffmpeg's actual frame timestamps.**
  The cache stores frames at `start + i / fps`, not the source video's
  real pts. For VFR sources this drifts; for CFR sources it's exact.

## Files

| File                                   | Role                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| `src-tauri/src/frame_stream.rs`        | ffmpeg subprocess, MJPEG parser, frame message encoder, Tauri Channel send loop. |
| `src/api/frameStream.ts`               | Frontend invoke wrapper + Channel binary decoder.                                |
| `src/components/SnappyVideoPlayer.tsx` | Cache, prefetch logic, canvas paint, imperative VideoPlayerHandle surface.       |
| `src/components/VideoPlayer.css`       | Shared player styles + `.video-player--snappy` overrides.                        |
| `src/store/slices/settingsSlice.ts`    | `snappyPlayer` toggle, persisted to localStorage.                                |
| `src/components/SettingsDialog.tsx`    | Toggle UI under the General section.                                             |
| `src/layout/CenterColumn.tsx`          | Branches on `snappyPlayer` to pick the component; supplies `getRate` callback.   |
| `src/timeline/model/beatMap.ts`        | `beatRateAt(t)` — segment-local playback rate, consumed by both player paths.    |

## Tuning knobs

All in `src/components/SnappyVideoPlayer.tsx`:

- `WINDOW_SECONDS` (default 6) — total span of decoded frames around the
  playhead. Bigger = smoother scrub, more memory, longer initial decode.
- `PREFETCH_MARGIN` (default 1.0) — how close the playhead can get to a
  window edge before a new stream kicks off. Smaller = more decoder
  churn; larger = bigger lurch when the window repositions.
- `STREAM_WIDTH` (default 1280) — frame width fed to ffmpeg. The
  bandwidth budget scales linearly with width.

## If we ship this

Open questions before promoting past "experimental":

1. **Audio strategy.** Hand audio to Rust + a shared AudioContext clock, or
   keep the `<audio>` hack and document the drift?
2. **Cache lifetime across video switches.** Currently nuked on `path`
   change. A small per-path LRU would make tab-switching feel free.
3. **VFR support.** Switch from `fps=N` resampling to reading source pts
   from ffmpeg's `-showinfo` output or moving to raw frame extraction +
   `pts_time` parsing.
4. **Rate-aware prefetch.** Scale the prefetch margin by the local rate so
   fast beat segments don't drain the cache before the next stream lands.
