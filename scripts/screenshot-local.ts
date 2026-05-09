/**
 * Local screenshot + PR-post tool. Runs the same Playwright capture as
 * scripts/screenshot.ts, then pushes the PNGs to the `screenshots` branch
 * and posts a PR comment with inline image refs — all using your local
 * `gh` auth, so it works without the GitHub Actions runner.
 *
 * Requires: `gh` CLI signed in (`gh auth login`) with `workflow` scope only
 * if you also want the runner workflow; this local tool just needs `repo`.
 *
 * Usage:
 *   npx tsx scripts/screenshot-local.ts \
 *     --pr 45 \
 *     --instructions @path/to/steps.json \
 *     --comment "Verse panel after change"
 *
 *   npx tsx scripts/screenshot-local.ts --pr 45 --instructions '[{...}]'
 *   npx tsx scripts/screenshot-local.ts --pr 45 --instructions '...' --dry-run
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

interface Args {
  pr: number
  instructions: string
  comment: string
  dryRun: boolean
}

function usage(msg: string): never {
  console.error(`error: ${msg}\n`)
  console.error('usage:')
  console.error('  npx tsx scripts/screenshot-local.ts --pr <N> --instructions <json|@file> [--comment <text>] [--dry-run]')
  process.exit(2)
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const out: Partial<Args> = { comment: '', dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) usage(`${a} requires a value`)
      return v
    }
    if (a === '--pr') out.pr = parseInt(next(), 10)
    else if (a === '--instructions') out.instructions = next()
    else if (a === '--comment') out.comment = next()
    else if (a === '--dry-run') out.dryRun = true
    else if (a === '-h' || a === '--help') usage('help')
    else usage(`unknown arg: ${a}`)
  }
  if (!out.pr || !Number.isFinite(out.pr)) usage('--pr <N> required')
  if (!out.instructions) usage('--instructions <json|@file> required')
  if (out.instructions.startsWith('@')) {
    const p = out.instructions.slice(1)
    out.instructions = fs.readFileSync(p, 'utf8')
  }
  // Parse-check: fail fast on bad JSON instead of in the child process.
  try {
    JSON.parse(out.instructions)
  } catch (err) {
    usage(`--instructions is not valid JSON: ${(err as Error).message}`)
  }
  return out as Args
}

function sh(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string; allowFail?: boolean } = {},
): { stdout: string; status: number } {
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'inherit'],
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    input: opts.input,
  })
  if (res.status !== 0 && !opts.allowFail) {
    throw new Error(`${cmd} ${args.join(' ')} failed with exit ${res.status}`)
  }
  return { stdout: res.stdout ?? '', status: res.status ?? 0 }
}

function shInherit(cmd: string, args: string[], env?: NodeJS.ProcessEnv): number {
  const res = spawnSync(cmd, args, { stdio: 'inherit', env: env ?? process.env })
  return res.status ?? 1
}

const args = parseArgs()

// 1. Capture
console.log(`→ capturing screenshots for PR #${args.pr}`)
const captureStatus = shInherit('npx', ['tsx', 'scripts/screenshot.ts'], {
  ...process.env,
  INSTRUCTIONS: args.instructions,
})
if (captureStatus !== 0) {
  console.error('capture failed')
  process.exit(captureStatus)
}

const outDir = path.resolve('screenshots-out')
const files = fs.readdirSync(outDir).filter((f) => f.endsWith('.png')).sort()
if (files.length === 0) {
  console.error('no PNGs in screenshots-out/')
  process.exit(1)
}
console.log(`→ ${files.length} screenshot(s) generated`)

// 2. Identify repo
const repoFull = sh('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']).stdout.trim()
if (!repoFull.includes('/')) {
  console.error(`could not determine repo from \`gh repo view\`: ${repoFull}`)
  process.exit(1)
}
const [owner, repo] = repoFull.split('/')
const remoteUrl = `https://github.com/${owner}/${repo}.git`

if (args.dryRun) {
  console.log('--dry-run: skipping push + comment. Files:')
  for (const f of files) console.log(`  ${path.join(outDir, f)}`)
  process.exit(0)
}

// 3. Push to screenshots branch
const ts = new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '')
const branch = 'screenshots'
const dest = `pr-${args.pr}/local-${ts}`
console.log(`→ publishing to ${branch}:${dest}`)

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lockstep-screenshots-'))
try {
  sh('git', ['init', '-q', '-b', branch], { cwd: scratch })
  sh('git', ['config', 'user.email', 'screenshot-local@local'], { cwd: scratch })
  sh('git', ['config', 'user.name', 'screenshot-local'], { cwd: scratch })

  const exists = sh('git', ['ls-remote', '--exit-code', '--heads', remoteUrl, branch], { allowFail: true })
  if (exists.status === 0) {
    sh('git', ['fetch', '--depth=1', remoteUrl, branch], { cwd: scratch })
    sh('git', ['reset', '--hard', 'FETCH_HEAD'], { cwd: scratch })
  }

  const destAbs = path.join(scratch, dest)
  fs.mkdirSync(destAbs, { recursive: true })
  for (const f of files) fs.copyFileSync(path.join(outDir, f), path.join(destAbs, f))

  sh('git', ['add', '.'], { cwd: scratch })
  sh('git', ['commit', '-q', '-m', `Screenshots for PR #${args.pr} (local ${ts})`], { cwd: scratch })

  // gh's credential helper handles auth — works with `gh auth login`.
  sh('gh', ['auth', 'setup-git'])
  sh('git', ['push', remoteUrl, `HEAD:${branch}`], { cwd: scratch })
} finally {
  fs.rmSync(scratch, { recursive: true, force: true })
}

// 4. Post comment
const baseUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${dest}`
const lines: string[] = []
const preface = args.comment.trim()
if (preface) lines.push(preface, '')
lines.push(`### Screenshots — \`${ts}\``, '')
for (const f of files) {
  const label = f.replace(/\.png$/, '')
  lines.push(`**${label}**`, '')
  lines.push(`![${label}](${baseUrl}/${f})`, '')
}

const body = lines.join('\n')
console.log(`→ commenting on PR #${args.pr}`)
sh('gh', ['api', '--method', 'POST', `repos/${owner}/${repo}/issues/${args.pr}/comments`, '--input', '-'], {
  input: JSON.stringify({ body }),
})

console.log(`✓ posted: https://github.com/${owner}/${repo}/pull/${args.pr}`)
