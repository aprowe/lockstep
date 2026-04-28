# Lockstep

**Warp any video to the beat of any music.**

Drop markers on the moments you want to hit, line them up to a beat grid, and Lockstep time-stretches everything in between so your cuts land on the beat — no manual trimming, no re-editing, no guesswork.

![screenshot placeholder](./docs/screenshot.png)

<!-- demo video placeholder -->
https://github.com/user-attachments/assets/demo.mp4

---

## What it's for

- Syncing dance / skate / sports footage to a track
- Making existing edits conform to a new song
- Music videos where the footage wasn't shot to click
- Anywhere you want motion to feel intentional against rhythm

If you've ever tried to manually re-time a clip so a jump or a step hits a kick drum, this is the tool that makes that trivial.

---

## How it works

1. **Load a video** — open a file, drop one onto the window, or point it at a folder to work through a batch
2. **Set the beat** — tap tempo, type a BPM, or let it estimate from your taps
3. **Drop markers** — pause on a moment you care about (a jump, a landing, a glance) and mark it
4. **Line them up** — drag each marker's beat-side handle to the bar or beat it should land on
5. **Export** — Lockstep stretches each segment between your markers to match, stitches the result back together, and writes it out

That's the whole loop. Everything between two markers speeds up or slows down smoothly so the motion still reads naturally — it's not freezing frames or jump-cutting.

---

## Features

**Markers & regions**
- Drop markers anywhere, snap them to beats or leave them free
- Define *regions* — named sub-clips with their own BPM, in/out points, and lock behavior — for working on one section at a time
- Lock BPM or beat count so resizing a region behaves predictably

**Playback**
- Scrub, loop, jump between markers, set in/out
- Tiered thumbnails on the filmstrip so scrubbing stays responsive on long files
- Live preview of warp math before you commit

**Export**
- Single clip or batch export of every region
- Choose output folder, naming, and per-region warp settings
- Diagnostic render mode overlays the beat grid on the output so you can verify alignment

**Projects that travel with the video**
- Save your work as a JSON sidecar next to the video file — drop the `.json` back in later and everything's restored
- Or let Lockstep remember state per-file automatically (by content hash, so it follows the file even if you rename or move it)

**Quality of life**
- Full undo/redo across markers, regions, and warp settings
- Dockable side panels (drag tabs, rearrange layouts)
- Drag-and-drop from Finder / Explorer for videos, folders, and project files

---

## Install

Grab the latest build for your OS from the [Releases page](../../releases).

- **Windows** — `.msi` or `.exe` installer
- **macOS** — `.dmg`
- **Linux** — `.AppImage` or `.deb`

FFmpeg is bundled — nothing else to install.

---

## Quick start

1. Open Lockstep
2. Drag a video file onto the window
3. Hit `T` a few times in time with the music you want to sync to — that sets the BPM
4. Scrub to the first moment you want on a beat, press `M` to mark it
5. Drag the marker's right handle onto the beat grid where it should land
6. Repeat for each key moment
7. **File → Export**

---

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Play / pause | `Space` |
| Drop marker at playhead | `M` |
| Tap tempo | `T` |
| Set in / out | `I` / `O` |
| Jump to previous / next marker | `[` / `]` |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z` |

---

## For developers

Built with Tauri v2, Rust, React, and TypeScript. FFmpeg does the heavy lifting for the actual time-stretch.

```bash
npm install
npm run tauri dev     # hot reload
npm run tauri build   # release build for current OS
```

FFmpeg and ffprobe need to be on `PATH` for dev. For packaged releases they're bundled as `externalBin`.

```bash
npm test              # Vitest + cargo test
npm run behaviors     # check feature specs against tests
```

See [CLAUDE.md](./CLAUDE.md) for a fuller tour of the codebase — command surface, Redux slices, the warp pipeline, and how the behavior-spec system ties `features/*.feature` files to test IDs.

---

## License

TBD — not yet licensed for redistribution. If you want to use or fork this, get in touch.
