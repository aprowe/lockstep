#!/usr/bin/env node
/**
 * Wrapper around `playwright test` for the screenshot harness.
 *
 *   npm run shoot                    # all *.shot.ts in tests/screenshots/
 *   npm run shoot -- toolbar         # tests matching "toolbar"
 *   npm run shoot -- toolbar --out=pr-42
 *
 * Sets SHOOT_OUT for shoot.ts helpers (subdir under docs/screenshots/),
 * defaulting to a slugged form of the current git branch when not provided.
 *
 * Prints raw GitHub URLs for every PNG so they can be pasted into PR comments.
 */
import { spawnSync, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const SHOT_DIR = path.resolve(ROOT, 'docs', 'screenshots')

const args = process.argv.slice(2)
let pattern = ''
let outArg = ''
const passthrough = []
for (const a of args) {
  if (a.startsWith('--out=')) outArg = a.slice('--out='.length)
  else if (a.startsWith('-')) passthrough.push(a)
  else pattern = a
}

function currentBranch() {
  try { return execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT, encoding: 'utf8' }).trim() }
  catch { return 'shots' }
}
function gitRemote() {
  try {
    const url = execSync('git config --get remote.origin.url', { cwd: ROOT, encoding: 'utf8' }).trim()
    const m = url.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/)
    return m ? m[1] : null
  } catch { return null }
}

const branch = currentBranch()
const slug = (outArg || branch).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')

const env = { ...process.env, SHOOT_OUT: slug }
const cmd = ['playwright', 'test', ...(pattern ? [`--grep=${pattern}`] : []), ...passthrough]
console.log(`▶ shoot → docs/screenshots/${slug}/   (branch: ${branch})`)
const result = spawnSync('npx', cmd, { cwd: ROOT, stdio: 'inherit', env })
if (result.status !== 0) process.exit(result.status ?? 1)

const dir = path.join(SHOT_DIR, slug)
if (!fs.existsSync(dir)) {
  console.log('(no screenshots produced)')
  process.exit(0)
}
const pngs = fs.readdirSync(dir).filter(n => n.endsWith('.png')).sort()
if (pngs.length === 0) {
  console.log('(no screenshots produced)')
  process.exit(0)
}

const remote = gitRemote()
console.log(`\n${pngs.length} shot${pngs.length === 1 ? '' : 's'} saved:`)
for (const name of pngs) console.log(`  docs/screenshots/${slug}/${name}`)

if (remote) {
  console.log('\nMarkdown for PR comment (commit + push first):\n')
  for (const name of pngs) {
    const label = name.replace(/\.png$/, '')
    const url = `https://raw.githubusercontent.com/${remote}/${branch}/docs/screenshots/${slug}/${name}`
    console.log(`![${label}](${url})`)
  }
}
