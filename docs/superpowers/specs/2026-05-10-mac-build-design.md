# Mac Build Design — Lockstep

**Date:** 2026-05-10

## Goal

Ship Lockstep for both Apple Silicon and Intel Macs, using the aprowe fork's universal `rife-ncnn-vulkan` binary (which includes the `-M manifest.json` batch mode required by the warp pipeline).

## What changes

**File:** `.github/workflows/release.yml`

### 1. Extend the release matrix

Add an Intel Mac entry alongside the existing Apple Silicon one:

| Runner | Target triple |
|---|---|
| `macos-latest` (macos-14, arm64) | `aarch64-apple-darwin` |
| `macos-13` (x86_64) | `x86_64-apple-darwin` |

### 2. Fix the macOS rife download step

Replace the current nihui binary download with the aprowe fork's universal binary.

- **Source:** `https://github.com/aprowe/rife-ncnn-vulkan/releases/download/20260511/rife-ncnn-vulkan-20260511-macos.zip`
- **Binary inside zip:** `rife-ncnn-vulkan-20260511-macos/rife-ncnn-vulkan`
- **Universal binary:** contains both arm64 and x86_64 slices (built via lipo in the fork's CI)
- **Destination:** `src-tauri/binaries/rife-ncnn-vulkan-${{ matrix.target }}`

Both matrix entries download the same zip; each copies the binary under its own target-triple name.

### 3. FFmpeg (no change needed)

`brew install ffmpeg` on each native runner already produces the correct-arch binary. The existing step copies it as `ffmpeg-${{ matrix.target }}` / `ffprobe-${{ matrix.target }}` — this works for both architectures.

## rife-v4.6 models

Models (`flownet.bin`, `flownet.param`) are architecture-independent. Both jobs copy them from the same zip. No change needed.

## No other changes

- `tauri.conf.json` `externalBin` already lists `binaries/rife-ncnn-vulkan` — Tauri appends the target triple at bundle time, so no config change is needed.
- The Rust backend and frontend are untouched.
