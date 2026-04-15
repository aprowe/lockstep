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
import { resolve, join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT         = resolve(fileURLToPath(import.meta.url), '..', '..')
const FEATURES_DIR = join(ROOT, 'features')
const TESTS_DIR    = join(ROOT, 'tests')
const GENERATED    = join(ROOT, 'generated')
const REGISTRY     = join(GENERATED, 'behavior-registry.json')
const COVERAGE_OUT = join(GENERATED, 'coverage.json')

const [,, cmd] = process.argv
if (!cmd || !['parse', 'coverage', 'check'].includes(cmd)) {
  console.error('Usage: tsx scripts/behavior.ts <parse|coverage|check>')
  process.exit(1)
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
    .map(l => l.replace(/^\s*(Given|When|Then|And|But)\s+/i, '').trim())
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
}

const FEATURE_RE  = /^\s*Feature\s*:/i
const SCENARIO_RE = /^\s*Scenario(\s+Outline)?\s*:/i
const STEP_RE     = /^\s*(Given|When|Then|And|But)\s+/i
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

  const flush = () => {
    if (!scenarioTitle || steps.length === 0) return
    const id = `${toSlug(featureTitle)}::${shortHash(normalizeSteps(steps))}`
    if (behaviors[id]) console.warn(`  WARN: ID collision in ${relPath}: ${id}`)
    behaviors[id] = { feature: featureTitle, scenario: scenarioTitle, isOutline, steps: steps.map(s => s.trim()), file: relPath, line: scenarioLine }
    steps = []; scenarioTitle = ''; isOutline = false; inExamples = false
  }

  for (const [i, raw] of lines.entries()) {
    const t = raw.trim()
    if (FEATURE_RE.test(t))  { featureTitle = t.replace(/^Feature\s*:\s*/i, '').trim(); continue }
    if (SCENARIO_RE.test(t)) { flush(); isOutline = /Outline/i.test(t); scenarioTitle = t.replace(/^Scenario(\s+Outline)?\s*:\s*/i, '').trim(); scenarioLine = i + 1; inExamples = false; continue }
    if (EXAMPLES_RE.test(t)) { inExamples = true; continue }
    if (inExamples)            continue
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
  writeFileSync(REGISTRY, JSON.stringify({ generated: new Date().toISOString(), behaviors: all }, null, 2) + '\n')

  const count = Object.keys(all).length
  console.log(`\nWrote ${count} behavior${count !== 1 ? 's' : ''} → ${relative(ROOT, REGISTRY).replace(/\\/g, '/')}\n`)
  for (const [id, e] of Object.entries(all)) {
    console.log(`  ${id}${e.isOutline ? ' [outline]' : ''}`)
    console.log(`    ${e.scenario}`)
  }

  if (collisions > 0) { console.error(`\n${collisions} ID collision(s).`); process.exit(1) }
}

// ─── coverage ─────────────────────────────────────────────────────────────────

interface CoverageRef { id: string; file: string; line: number }

const CALL_RE = /behaviorTest\(\s*['"]([^'"]+)['"]/g

function scanTests(dir: string): CoverageRef[] {
  const refs: CoverageRef[] = []
  for (const file of findFiles(dir, '.test.ts')) {
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

  const W = 72
  console.log(`\n${'━'.repeat(W)}\n  BEHAVIOR COVERAGE\n${'━'.repeat(W)}\n`)

  console.log(`COVERED  (${covered.length}/${expectedIds.size})\n${'─'.repeat(W)}`)
  for (const id of covered) {
    console.log(`  ✓ ${id}\n    ${behaviors[id].scenario}`)
    for (const ref of coverage.get(id)!) console.log(`    → ${ref.file}:${ref.line}`)
  }

  console.log(`\nMISSING  (${missing.length})\n${'─'.repeat(W)}`)
  if (missing.length === 0) {
    console.log('  (none)')
  } else {
    for (const id of missing) console.log(`  ✗ ${id}\n    ${behaviors[id].scenario}\n    spec: ${behaviors[id].file}:${behaviors[id].line}`)
  }

  console.log(`\nORPHANED REFS  (${orphans.length})\n${'─'.repeat(W)}`)
  if (orphans.length === 0) {
    console.log('  (none)')
  } else {
    for (const ref of orphans) console.log(`  ? ${ref.id}\n    ${ref.file}:${ref.line}`)
  }

  console.log(`\n${'━'.repeat(W)}\n  Coverage: ${covered.length}/${expectedIds.size} (${pct}%)  |  ${orphans.length} orphaned ref(s)\n${'━'.repeat(W)}\n`)

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
