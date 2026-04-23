#!/usr/bin/env node
/**
 * Downloads FFmpeg + FFprobe + rife-ncnn-vulkan into src-tauri/binaries/ for
 * the current platform. Safe to re-run — skips files that already exist.
 *
 * Usage:
 *   npm run setup
 *   RIFE_SKIP=1 npm run setup   # skip RIFE (large ~430MB download)
 */

import { existsSync, mkdirSync, cpSync, readdirSync, rmSync, statSync } from 'node:fs'
import { execSync, spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir, homedir } from 'node:os'

const ROOT    = join(dirname(fileURLToPath(import.meta.url)), '..')
const BIN_DIR = join(ROOT, 'src-tauri', 'binaries')

const FF_VERSION = '6.1'
const FF_BASE    = `https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v${FF_VERSION}`

// rife-ncnn-vulkan from the aprowe fork — adds `-M manifest.json` batch mode.
// Release bundles every model — we only keep the binary + rife-v4.6.
const RIFE_VERSION = '20260422'
const RIFE_BASE    = `https://github.com/aprowe/rife-ncnn-vulkan/releases/download/${RIFE_VERSION}`
const RIFE_MODEL   = 'rife-v4.6'

function targetTriple() {
  const p = process.platform
  const a = process.arch
  if (p === 'win32')  return `${a === 'x64' ? 'x86_64' : 'aarch64'}-pc-windows-msvc`
  if (p === 'darwin') return `${a === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`
  return `${a === 'x64' ? 'x86_64' : 'aarch64'}-unknown-linux-gnu`
}

function ffZipUrl(tool) {
  const p = process.platform
  if (p === 'win32')  return `${FF_BASE}/${tool}-${FF_VERSION}-win-64.zip`
  if (p === 'darwin') return `${FF_BASE}/${tool}-${FF_VERSION}-osx-64.zip`
  return `${FF_BASE}/${tool}-${FF_VERSION}-linux-64.zip`
}

function rifeZipUrl() {
  const p = process.platform
  if (p === 'win32')  return `${RIFE_BASE}/rife-ncnn-vulkan-${RIFE_VERSION}-windows.zip`
  if (p === 'darwin') {
    throw new Error(
      `macOS prebuilts aren't published for aprowe/rife-ncnn-vulkan ${RIFE_VERSION}. ` +
      `Build from source at https://github.com/aprowe/rife-ncnn-vulkan and drop the ` +
      `binary + ${RIFE_MODEL}/ into src-tauri/binaries/, or run with RIFE_SKIP=1.`
    )
  }
  return `${RIFE_BASE}/rife-ncnn-vulkan-${RIFE_VERSION}-ubuntu.zip`
}

mkdirSync(BIN_DIR, { recursive: true })

const triple = targetTriple()
const isWin  = process.platform === 'win32'
const ext    = isWin ? '.exe' : ''

console.log(`\nSetting up binaries for ${triple}\n`)

// ── FFmpeg + FFprobe ─────────────────────────────────────────────────────────
for (const tool of ['ffmpeg', 'ffprobe']) {
  const dest = join(BIN_DIR, `${tool}-${triple}${ext}`)
  if (existsSync(dest)) {
    console.log(`  ✓  ${tool}-${triple}${ext}  (already present)`)
    continue
  }

  const url  = ffZipUrl(tool)
  const tmp  = join(tmpdir(), `lockstep-${tool}-${Date.now()}`)
  const zip  = `${tmp}.zip`

  console.log(`  ↓  ${tool}  →  ${url}`)

  try {
    execSync(`curl -sL "${url}" -o "${zip}"`, { stdio: 'inherit' })

    mkdirSync(tmp, { recursive: true })
    if (isWin) {
      execSync(`powershell -NoProfile -Command "Expand-Archive -Force '${zip}' '${tmp}'"`, { stdio: 'inherit' })
    } else {
      execSync(`unzip -q "${zip}" -d "${tmp}"`, { stdio: 'inherit' })
    }

    const extracted = join(tmp, `${tool}${ext}`)
    if (!existsSync(extracted)) throw new Error(`Expected ${extracted} in archive`)
    execSync(isWin ? `move "${extracted}" "${dest}"` : `mv "${extracted}" "${dest}"`, { shell: isWin ? 'cmd' : '/bin/sh' })
    if (!isWin) execSync(`chmod +x "${dest}"`)

    console.log(`  ✓  ${tool}-${triple}${ext}`)
  } finally {
    try {
      execSync(isWin ? `if exist "${zip}" del "${zip}"` : `rm -f "${zip}"`, { shell: isWin ? 'cmd' : '/bin/sh' })
      execSync(isWin ? `if exist "${tmp}" rmdir /s /q "${tmp}"` : `rm -rf "${tmp}"`, { shell: isWin ? 'cmd' : '/bin/sh' })
    } catch { /* best-effort cleanup */ }
  }
}

// ── rife-ncnn-vulkan + rife-v4.6 model ───────────────────────────────────────
if (process.env.RIFE_SKIP) {
  console.log('  ⏭  rife-ncnn-vulkan  (RIFE_SKIP set, skipping)')
} else {
  setupRife()
}

/** The binary printed usage contains this flag iff it's the aprowe fork. */
function rifeSupportsManifest(exe) {
  try {
    const r = spawnSync(exe, ['-h'], { encoding: 'utf8', timeout: 5000 })
    const out = (r.stdout || '') + (r.stderr || '')
    return out.includes('-M manifest-path')
  } catch {
    return false
  }
}

function setupRife() {
  const rifeExe   = join(BIN_DIR, `rife-ncnn-vulkan-${triple}${ext}`)
  const modelDir  = join(BIN_DIR, RIFE_MODEL)

  let exePresent   = existsSync(rifeExe)
  const modelPresent = existsSync(modelDir)

  // Stale-binary guard: pre-20260422 builds don't support -M manifest mode.
  // Force a re-download so users don't hit "rife-ncnn-vulkan exited ... -f pattern-format".
  if (exePresent && !rifeSupportsManifest(rifeExe)) {
    console.log(`  ↻  rife-ncnn-vulkan present but missing -M support; removing to refresh`)
    rmSync(rifeExe, { force: true })
    exePresent = false
  }

  if (exePresent && modelPresent) {
    console.log(`  ✓  rife-ncnn-vulkan + ${RIFE_MODEL}  (already present)`)
    return
  }

  // Fast path: copy from a local frames/frames2 checkout if one exists.
  const localCandidates = [
    join(homedir(), 'projects', 'frames', 'frames2', 'backend'),
    join(homedir(), 'projects', 'frames'),
  ]
  for (const src of localCandidates) {
    const localExe   = join(src, `rife-ncnn-vulkan${ext}`)
    const localModel = join(src, RIFE_MODEL)
    if (existsSync(localExe) && existsSync(localModel)) {
      console.log(`  ⇢  rife  ←  ${src}  (local copy)`)
      if (!exePresent) {
        cpSync(localExe, rifeExe)
        if (!isWin) execSync(`chmod +x "${rifeExe}"`)
      }
      if (!modelPresent) cpSync(localModel, modelDir, { recursive: true })
      console.log(`  ✓  rife-ncnn-vulkan-${triple}${ext}`)
      console.log(`  ✓  ${RIFE_MODEL}/`)
      return
    }
  }

  // Download path: large (~430MB) because the release bundles every model.
  const url  = rifeZipUrl()
  const tmp  = join(tmpdir(), `lockstep-rife-${Date.now()}`)
  const zip  = `${tmp}.zip`

  console.log(`  ↓  rife-ncnn-vulkan  →  ${url}  (~430MB, bundles all models; we keep only the binary + ${RIFE_MODEL})`)

  try {
    execSync(`curl -fL "${url}" -o "${zip}"`, { stdio: 'inherit' })

    mkdirSync(tmp, { recursive: true })
    if (isWin) {
      execSync(`powershell -NoProfile -Command "Expand-Archive -Force '${zip}' '${tmp}'"`, { stdio: 'inherit' })
    } else {
      execSync(`unzip -q "${zip}" -d "${tmp}"`, { stdio: 'inherit' })
    }

    // Archive contains a single top-level folder like rife-ncnn-vulkan-20221029-windows/
    const extractedRoot = findExtractedRoot(tmp)
    if (!extractedRoot) throw new Error('rife archive: could not find extracted root')

    const extractedExe   = join(extractedRoot, `rife-ncnn-vulkan${ext}`)
    const extractedModel = join(extractedRoot, RIFE_MODEL)
    if (!existsSync(extractedExe))   throw new Error(`rife archive: missing ${extractedExe}`)
    if (!existsSync(extractedModel)) throw new Error(`rife archive: missing ${extractedModel}`)

    if (!exePresent) {
      cpSync(extractedExe, rifeExe)
      if (!isWin) execSync(`chmod +x "${rifeExe}"`)
    }
    if (!modelPresent) cpSync(extractedModel, modelDir, { recursive: true })

    console.log(`  ✓  rife-ncnn-vulkan-${triple}${ext}`)
    console.log(`  ✓  ${RIFE_MODEL}/`)
  } finally {
    try {
      execSync(isWin ? `if exist "${zip}" del "${zip}"` : `rm -f "${zip}"`, { shell: isWin ? 'cmd' : '/bin/sh' })
      execSync(isWin ? `if exist "${tmp}" rmdir /s /q "${tmp}"` : `rm -rf "${tmp}"`, { shell: isWin ? 'cmd' : '/bin/sh' })
    } catch { /* best-effort cleanup */ }
  }
}

function findExtractedRoot(tmp) {
  // Expect exactly one top-level directory inside tmp.
  const entries = readdirSync(tmp)
  for (const name of entries) {
    const p = join(tmp, name)
    if (statSync(p).isDirectory()) return p
  }
  return null
}

console.log('\nDone. You can now run: npm run tauri dev\n')
