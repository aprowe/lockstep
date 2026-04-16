#!/usr/bin/env tsx
/**
 * scripts/behavior.ts
 *
 * Single compiler for the behavior system.
 *
 * Commands:
 *   parse     Parse features/ → generated/behavior-registry.json
 *             Also writes generated/coverage.json (all uncovered)
 *   coverage  Load registry and scan tests/ → print + write generated/coverage.json
 *   check     parse + coverage, exit 1 if coverage < 100%
 *
 * Usage:
 *   tsx scripts/behavior.ts parse
 *   tsx scripts/behavior.ts coverage
 *   tsx scripts/behavior.ts check
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT         = resolve(fileURLToPath(import.meta.url), '..', '..')
const FEATURES_DIR = join(ROOT, 'spec', 'features')
const TESTS_DIR    = join(ROOT, 'tests')
const GENERATED    = join(ROOT, 'spec', 'generated')
const REGISTRY     = join(GENERATED, 'behavior-registry.json')
const COVERAGE_OUT = join(GENERATED, 'coverage.json')

const args    = process.argv.slice(2)
const cmd     = args.find(a => !a.startsWith('-'))
const NO_COLOR = args.includes('--no-color') || !process.stdout.isTTY

if (!cmd || !['parse', 'coverage', 'check'].includes(cmd)) {
  console.error('Usage: tsx scripts/behavior.ts <parse|coverage|check> [--no-color]')
  process.exit(1)
}

// ─── color helpers ────────────────────────────────────────────────────────────

const c = {
  reset:  (s: string) => NO_COLOR ? s : `\x1b[0m${s}\x1b[0m`,
  bold:   (s: string) => NO_COLOR ? s : `\x1b[1m${s}\x1b[0m`,
  dim:    (s: string) => NO_COLOR ? s : `\x1b[2m${s}\x1b[0m`,
  green:  (s: string) => NO_COLOR ? s : `\x1b[32m${s}\x1b[0m`,
  red:    (s: string) => NO_COLOR ? s : `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => NO_COLOR ? s : `\x1b[33m${s}\x1b[0m`,
  cyan:   (s: string) => NO_COLOR ? s : `\x1b[36m${s}\x1b[0m`,
  gray:   (s: string) => NO_COLOR ? s : `\x1b[90m${s}\x1b[0m`,
}

// ─── shared helpers ───────────────────────────────────────────────────────────

function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizeSteps(lines: string[]): string {
  return lines
    .map(l => l.replace(/^\s*(Given|When|Then|And|But)\s*:?\s+/i, '').trim())
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function shortHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 8)
}

// ─── parse ────────────────────────────────────────────────────────────────────

interface BehaviorEntry {
  feature: string
  scenario: string
  isOutline: boolean
  steps: string[]
  file: string
  line: number
  /** Optional test file hints (from `# @test <path>` comments before the scenario) */
  tests?: string[]
  /** Optional AI/human hints (from `# @hint <text>` comments before the scenario) */
  hints?: string[]
}

const FEATURE_RE  = /^\s*Feature\s*:/i
const SCENARIO_RE = /^\s*Scenario(\s+Outline)?\s*:/i
const STEP_RE     = /^\s*(Given|When|Then|And|But)\s*:?\s+/i
const EXAMPLES_RE = /^\s*Examples\s*:/i

function parseFeatureFile(content: string, relPath: string): Record<string, BehaviorEntry> {
  const lines       = content.split('\n')
  const behaviors: Record<string, BehaviorEntry> = {}
  let featureTitle  = ''
  let scenarioTitle = ''
  let scenarioLine  = 0
  let isOutline     = false
  let steps: string[] = []
  let inExamples    = false
  let exampleRows: string[] = []
  // pendingTests/Hints: annotations collected BETWEEN scenarios (before the next Scenario: line)
  let pendingTests: string[] = []
  let pendingHints: string[] = []
  // scenarioTests/Hints: annotations for the CURRENT scenario being built
  let scenarioTests: string[] = []
  let scenarioHints: string[] = []

  const flush = () => {
    if (!scenarioTitle || steps.length === 0) return
    const hashInput = [
      scenarioTitle.toLowerCase().trim(),
      normalizeSteps(steps),
      ...exampleRows,
    ].join('\n')
    const id = `${toSlug(featureTitle)}::${shortHash(hashInput)}`
    if (behaviors[id]) console.warn(`  WARN: ID collision in ${relPath}: ${id}`)
    const entry: BehaviorEntry = { feature: featureTitle, scenario: scenarioTitle, isOutline, steps: steps.map(s => s.trim()), file: relPath, line: scenarioLine }
    if (scenarioTests.length > 0) entry.tests = scenarioTests
    if (scenarioHints.length > 0) entry.hints = scenarioHints
    behaviors[id] = entry
    steps = []; scenarioTitle = ''; isOutline = false; inExamples = false; exampleRows = []
    scenarioTests = []; scenarioHints = []
  }

  for (const [i, raw] of lines.entries()) {
    const t = raw.trim()
    if (FEATURE_RE.test(t))  { featureTitle = t.replace(/^Feature\s*:\s*/i, '').trim(); continue }
    // Collect @test / @hint from comment lines (multi-line hints joined with space)
    if (t.startsWith('#')) {
      const testMatch = t.match(/^#\s*@test\s+(.+)/)
      const hintMatch = t.match(/^#\s*@hint\s+(.+)/)
      if (testMatch) pendingTests.push(testMatch[1].trim())
      else if (hintMatch) pendingHints.push(hintMatch[1].trim())
      // Continuation: `#       more hint text` (indented, no @tag) appends to last hint
      else if (pendingHints.length > 0 && /^#\s{6,}/.test(t)) {
        pendingHints[pendingHints.length - 1] += ' ' + t.replace(/^#\s+/, '').trim()
      }
      continue
    }
    if (SCENARIO_RE.test(t)) {
      flush()
      // Transfer pending annotations to the new scenario
      scenarioTests = pendingTests; scenarioHints = pendingHints
      pendingTests = []; pendingHints = []
      isOutline = /Outline/i.test(t); scenarioTitle = t.replace(/^Scenario(\s+Outline)?\s*:\s*/i, '').trim(); scenarioLine = i + 1; inExamples = false; continue
    }
    if (EXAMPLES_RE.test(t)) { inExamples = true; continue }
    if (inExamples)          { if (t.startsWith('|')) exampleRows.push(t.replace(/\s+/g, ' ')); continue }
    if (STEP_RE.test(t))       steps.push(t)
  }
  flush()
  return behaviors
}

function findFiles(dir: string, ext: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory())           findFiles(full, ext, out)
    else if (entry.name.endsWith(ext)) out.push(full)
  }
  return out
}

function runParse() {
  const all: Record<string, BehaviorEntry> = {}
  let collisions = 0

  for (const file of findFiles(FEATURES_DIR, '.feature')) {
    const content = readFileSync(file, 'utf8')
    const rel     = relative(ROOT, file).replace(/\\/g, '/')
    for (const [id, entry] of Object.entries(parseFeatureFile(content, rel))) {
      if (all[id]) { console.warn(`WARN: cross-file collision: ${id}`); collisions++ }
      all[id] = entry
    }
  }

  mkdirSync(GENERATED, { recursive: true })
  writeFileSync(REGISTRY, JSON.stringify({ behaviors: all }, null, 2) + '\n')

  const count  = Object.keys(all).length
  const outRel = relative(ROOT, REGISTRY).replace(/\\/g, '/')
  console.log(`\n${c.bold(`Wrote ${count} behavior${count !== 1 ? 's' : ''}`)}`
    + ` ${c.gray('→')} ${c.cyan(outRel)}\n`)
  for (const [id, e] of Object.entries(all)) {
    const tag = e.isOutline ? c.gray(' [outline]') : ''
    console.log(`  ${c.cyan(id)}${tag}`)
    console.log(`  ${c.gray(e.scenario)}`)
  }

  if (collisions > 0) { console.error(c.red(`\n${collisions} ID collision(s).`)); process.exit(1) }
}

// ─── coverage ─────────────────────────────────────────────────────────────────

interface CoverageRef { id: string; file: string; line: number }

const CALL_RE = /behaviorTest\(\s*['"]([^'"]+)['"]/g

function scanTests(dir: string): CoverageRef[] {
  const refs: CoverageRef[] = []
  for (const file of [...findFiles(dir, '.test.ts'), ...findFiles(dir, '.test.tsx')]) {
    const rel   = relative(ROOT, file).replace(/\\/g, '/')
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((text, i) => {
      CALL_RE.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = CALL_RE.exec(text)) !== null) refs.push({ id: m[1], file: rel, line: i + 1 })
    })
  }
  return refs
}

function runCoverage(print = true): boolean {
  if (!existsSync(REGISTRY)) {
    console.error('Registry not found. Run: tsx scripts/behavior.ts parse')
    process.exit(1)
  }

  const { behaviors } = JSON.parse(readFileSync(REGISTRY, 'utf8')) as { behaviors: Record<string, BehaviorEntry> }
  const expectedIds   = new Set(Object.keys(behaviors))
  const testRefs      = scanTests(TESTS_DIR)

  const coverage = new Map<string, CoverageRef[]>(
    [...expectedIds].map(id => [id, []])
  )
  for (const ref of testRefs) {
    if (coverage.has(ref.id)) coverage.get(ref.id)!.push(ref)
  }

  const missing = [...expectedIds].filter(id => coverage.get(id)!.length === 0)
  const orphans = testRefs.filter(ref => !expectedIds.has(ref.id))
  const covered = [...expectedIds].filter(id => coverage.get(id)!.length > 0)
  const pct     = expectedIds.size === 0 ? 100 : Math.round((covered.length / expectedIds.size) * 100)

  const result = { total: expectedIds.size, covered: covered.length, percentage: pct, missing, orphans }
  mkdirSync(GENERATED, { recursive: true })
  writeFileSync(COVERAGE_OUT, JSON.stringify(result, null, 2) + '\n')

  if (!print) return missing.length === 0 && orphans.length === 0

  const W    = 72
  const heavy = '━'.repeat(W)
  const light = '─'.repeat(W)
  console.log(`\n${c.bold(heavy)}\n  ${c.bold('BEHAVIOR COVERAGE')}\n${c.bold(heavy)}\n`)

  console.log(`${c.bold(`COVERED  (${covered.length}/${expectedIds.size})`)}\n${c.gray(light)}`)
  for (const id of covered) {
    console.log(`  ${c.green('✓')} ${c.cyan(id)}`)
    console.log(`    ${c.gray(behaviors[id].scenario)}`)
    for (const ref of coverage.get(id)!) console.log(`    ${c.gray('→')} ${ref.file}:${ref.line}`)
  }

  console.log(`\n${c.bold(`MISSING  (${missing.length})`)}\n${c.gray(light)}`)
  if (missing.length === 0) {
    console.log(c.gray('  (none)'))
  } else {
    for (const id of missing) {
      console.log(`  ${c.red('✗')} ${c.red(id)}`)
      console.log(`    ${c.gray(behaviors[id].scenario)}`)
      console.log(`    ${c.gray('spec:')} ${behaviors[id].file}:${behaviors[id].line}`)
    }
  }

  console.log(`\n${c.bold(`ORPHANED REFS  (${orphans.length})`)}\n${c.gray(light)}`)
  if (orphans.length === 0) {
    console.log(c.gray('  (none)'))
  } else {
    for (const ref of orphans) {
      console.log(`  ${c.yellow('?')} ${c.yellow(ref.id)}`)
      console.log(`    ${ref.file}:${ref.line}`)
    }
  }

  const pctColor = pct === 100 ? c.green : pct >= 80 ? c.yellow : c.red
  const summary  = `Coverage: ${covered.length}/${expectedIds.size} (${pct}%)  |  ${orphans.length} orphaned ref(s)`
  console.log(`\n${c.bold(heavy)}\n  ${pctColor(c.bold(summary))}\n${c.bold(heavy)}\n`)

  return missing.length === 0 && orphans.length === 0
}

// ─── dispatch ─────────────────────────────────────────────────────────────────

if (cmd === 'parse') {
  runParse()
} else if (cmd === 'coverage') {
  const ok = runCoverage()
  process.exit(ok ? 0 : 1)
} else if (cmd === 'check') {
  runParse()
  const ok = runCoverage()
  process.exit(ok ? 0 : 1)
}
