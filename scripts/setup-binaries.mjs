#!/usr/bin/env node
/**
 * Downloads FFmpeg + FFprobe binaries into src-tauri/binaries/ for the
 * current platform. Safe to re-run — skips files that already exist.
 *
 * Usage:
 *   npm run setup
 */

import { existsSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT    = join(dirname(fileURLToPath(import.meta.url)), '..')
const BIN_DIR = join(ROOT, 'src-tauri', 'binaries')

const VERSION = '6.1'
const BASE    = `https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v${VERSION}`

function targetTriple() {
  const p = process.platform
  const a = process.arch
  if (p === 'win32')  return `${a === 'x64' ? 'x86_64' : 'aarch64'}-pc-windows-msvc`
  if (p === 'darwin') return `${a === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`
  return `${a === 'x64' ? 'x86_64' : 'aarch64'}-unknown-linux-gnu`
}

function zipUrl(tool) {
  const p = process.platform
  if (p === 'win32')  return `${BASE}/${tool}-${VERSION}-win-64.zip`
  if (p === 'darwin') return `${BASE}/${tool}-${VERSION}-osx-64.zip`
  return `${BASE}/${tool}-${VERSION}-linux-64.zip`
}

mkdirSync(BIN_DIR, { recursive: true })

const triple = targetTriple()
const isWin  = process.platform === 'win32'
const ext    = isWin ? '.exe' : ''

console.log(`\nSetting up binaries for ${triple}\n`)

for (const tool of ['ffmpeg', 'ffprobe']) {
  const dest = join(BIN_DIR, `${tool}-${triple}${ext}`)
  if (existsSync(dest)) {
    console.log(`  ✓  ${tool}-${triple}${ext}  (already present)`)
    continue
  }

  const url  = zipUrl(tool)
  const tmp  = join(tmpdir(), `lockstep-${tool}-${Date.now()}`)
  const zip  = `${tmp}.zip`

  console.log(`  ↓  ${tool}  →  ${url}`)

  try {
    // Download
    execSync(`curl -sL "${url}" -o "${zip}"`, { stdio: 'inherit' })

    // Extract
    mkdirSync(tmp, { recursive: true })
    if (isWin) {
      execSync(`powershell -NoProfile -Command "Expand-Archive -Force '${zip}' '${tmp}'"`, { stdio: 'inherit' })
    } else {
      execSync(`unzip -q "${zip}" -d "${tmp}"`, { stdio: 'inherit' })
    }

    // Move to final location
    const extracted = join(tmp, `${tool}${ext}`)
    if (!existsSync(extracted)) throw new Error(`Expected ${extracted} in archive`)
    execSync(isWin ? `move "${extracted}" "${dest}"` : `mv "${extracted}" "${dest}"`, { shell: isWin ? 'cmd' : '/bin/sh' })
    if (!isWin) execSync(`chmod +x "${dest}"`)

    console.log(`  ✓  ${tool}-${triple}${ext}`)
  } finally {
    // Clean up temp files
    try {
      execSync(isWin ? `if exist "${zip}" del "${zip}"` : `rm -f "${zip}"`, { shell: isWin ? 'cmd' : '/bin/sh' })
      execSync(isWin ? `if exist "${tmp}" rmdir /s /q "${tmp}"` : `rm -rf "${tmp}"`, { shell: isWin ? 'cmd' : '/bin/sh' })
    } catch { /* best-effort cleanup */ }
  }
}

console.log('\nDone. You can now run: npm run tauri dev\n')
