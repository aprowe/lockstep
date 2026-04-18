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
 *   audit     Generate generated/audit.md — per-behavior scenario + test snippets
 *             for human / LLM review. Preserves <!-- audit:feedback --> blocks.
 *
 * Usage:
 *   tsx scripts/behavior.ts parse
 *   tsx scripts/behavior.ts coverage
 *   tsx scripts/behavior.ts check
 *   tsx scripts/behavior.ts audit
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT         = resolve(fileURLToPath(import.meta.url), '..', '..')
const FEATURES_DIR = join(ROOT, 'spec', 'features')
const TESTS_DIR    = join(ROOT, 'tests')
const RUST_TESTS_DIR = join(ROOT, 'src-tauri', 'tests')
const GENERATED    = join(ROOT, 'spec', 'generated')
const REGISTRY     = join(GENERATED, 'behavior-registry.json')
const COVERAGE_OUT = join(GENERATED, 'coverage.json')
const AUDIT_OUT    = join(GENERATED, 'audit.md')

const args    = process.argv.slice(2)
const cmd     = args.find(a => !a.startsWith('-'))
const NO_COLOR = args.includes('--no-color') || !process.stdout.isTTY

if (!cmd || !['parse', 'coverage', 'check', 'audit'].includes(cmd)) {
  console.error('Usage: tsx scripts/behavior.ts <parse|coverage|check|audit> [--no-color]')
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

interface CoverageRef { id: string; file: string; line: number; lang: 'ts' | 'rust'; heavy?: boolean; skipped?: boolean }

const CALL_RE = /behaviorTest\(\s*['"]([^'"]+)['"]/g
const TS_BEHAVIOR_COMMENT_RE = /^\s*\/\/\s*@behavior\s+(\S+)/

function scanTests(dir: string): CoverageRef[] {
  const refs: CoverageRef[] = []
  for (const file of [...findFiles(dir, '.test.ts'), ...findFiles(dir, '.test.tsx')]) {
    const rel   = relative(ROOT, file).replace(/\\/g, '/')
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((text, i) => {
      // Legacy: behaviorTest('id', ...)
      CALL_RE.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = CALL_RE.exec(text)) !== null) refs.push({ id: m[1], file: rel, line: i + 1, lang: 'ts' })

      // vitest-cucumber: // @behavior <id> above a Scenario(...) call
      const cm = text.match(TS_BEHAVIOR_COMMENT_RE)
      if (cm) {
        let skipped = false
        for (let j = i + 1; j < Math.min(i + 15, lines.length); j++) {
          if (/\bScenario\.skip\s*\(/.test(lines[j]))      { skipped = true; break }
          if (/\bScenario(?:\.only)?\s*\(/.test(lines[j])) { break }
        }
        refs.push({ id: cm[1], file: rel, line: i + 1, lang: 'ts', skipped })
      }
    })
  }
  return refs
}

/**
 * Scan Rust integration tests for `// behavior: <id>` markers that annotate a
 * `#[test]` fn. Detects `#[ignore]` on the same test and tags those refs heavy.
 */
function scanRustTests(dir: string): CoverageRef[] {
  if (!existsSync(dir)) return []
  const refs: CoverageRef[] = []
  const BEHAVIOR_RE = /^\s*\/\/\s*behavior:\s*(\S+)/
  const TEST_RE    = /^\s*#\[test\]/
  const IGNORE_RE  = /^\s*#\[ignore\b/
  const FN_RE      = /^\s*(?:pub\s+)?fn\s+\w+/

  for (const file of findFiles(dir, '.rs')) {
    const rel   = relative(ROOT, file).replace(/\\/g, '/')
    const lines = readFileSync(file, 'utf8').split('\n')

    let pendingIds: { id: string; line: number }[] = []
    let seenTest = false
    let seenIgnore = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const mBehavior = line.match(BEHAVIOR_RE)
      if (mBehavior) { pendingIds.push({ id: mBehavior[1], line: i + 1 }); continue }
      if (TEST_RE.test(line))   { seenTest = true;   continue }
      if (IGNORE_RE.test(line)) { seenIgnore = true; continue }
      if (FN_RE.test(line)) {
        if (seenTest && pendingIds.length > 0) {
          for (const { id, line: refLine } of pendingIds) {
            refs.push({ id, file: rel, line: refLine, lang: 'rust', heavy: seenIgnore })
          }
        }
        pendingIds = []; seenTest = false; seenIgnore = false
      }
    }
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
  const testRefs      = [...scanTests(TESTS_DIR), ...scanRustTests(RUST_TESTS_DIR)]

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
    for (const ref of coverage.get(id)!) {
      const bits: string[] = []
      if (ref.lang === 'rust') bits.push(ref.heavy ? 'rust·heavy' : 'rust')
      if (ref.skipped)         bits.push('skipped')
      const tag = bits.length ? ' ' + c.yellow(`[${bits.join(' ')}]`) : ''
      console.log(`    ${c.gray('→')} ${ref.file}:${ref.line}${tag}`)
    }
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

// ─── audit ────────────────────────────────────────────────────────────────────

/**
 * Brace-match extractor.  Given a file's source and a starting line (1-based)
 * that contains an opening brace, returns the substring from that line through
 * the matching closing brace.  Ignores braces inside // line comments and
 * /* block *​/ comments; strings are treated naively (good enough for our
 * test files, which don't put literal braces inside strings in tricky ways).
 */
function extractBraceBlock(src: string, startLine1: number): string | null {
  const lines = src.split('\n')
  if (startLine1 < 1 || startLine1 > lines.length) return null
  // Find the first '{' on or after startLine
  let pos = lines.slice(0, startLine1 - 1).reduce((n, l) => n + l.length + 1, 0)
  const text = src
  const firstBrace = text.indexOf('{', pos)
  if (firstBrace < 0) return null

  let depth = 0
  let i = firstBrace
  let inLineCmt = false, inBlockCmt = false, inStr: string | null = null
  while (i < text.length) {
    const ch = text[i]
    const next = text[i + 1]
    if (inLineCmt) {
      if (ch === '\n') inLineCmt = false
    } else if (inBlockCmt) {
      if (ch === '*' && next === '/') { inBlockCmt = false; i++ }
    } else if (inStr) {
      if (ch === '\\') i++
      else if (ch === inStr) inStr = null
    } else {
      if (ch === '/' && next === '/') { inLineCmt = true; i++ }
      else if (ch === '/' && next === '*') { inBlockCmt = true; i++ }
      else if (ch === '"' || ch === '\'' || ch === '`') inStr = ch
      else if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          // Walk back to the start of startLine for a clean slice
          const sliceStart = lines.slice(0, startLine1 - 1).reduce((n, l) => n + l.length + 1, 0)
          return text.slice(sliceStart, i + 1)
        }
      }
    }
    i++
  }
  return null
}

/** Extract the snippet associated with a CoverageRef. */
function extractSnippet(ref: CoverageRef): string {
  const abs = join(ROOT, ref.file)
  let src: string
  try { src = readFileSync(abs, 'utf8') } catch { return `// (could not read ${ref.file})` }

  if (ref.lang === 'ts') {
    const lines = src.split('\n')
    const line = lines[ref.line - 1] ?? ''

    // vitest-cucumber path: `// @behavior <id>` marker; walk forward to Scenario(...)
    if (TS_BEHAVIOR_COMMENT_RE.test(line)) {
      let scenarioLine = -1
      for (let i = ref.line; i < Math.min(ref.line + 20, lines.length); i++) {
        if (/\bScenario(?:\.(?:skip|only))?\s*\(/.test(lines[i])) { scenarioLine = i + 1; break }
      }
      if (scenarioLine < 0) return `// (could not find Scenario() after ${ref.file}:${ref.line})`
      const block = extractBraceBlock(src, scenarioLine)
      if (!block) return `// (could not extract Scenario at ${ref.file}:${scenarioLine})`
      const preamble = lines.slice(ref.line - 1, scenarioLine - 1).join('\n')
      return `${preamble}\n${lines[scenarioLine - 1]}\n${block.split('\n').slice(1).join('\n')}`
    }

    // Legacy path: behaviorTest('id', () => { ... })
    const block = extractBraceBlock(src, ref.line)
    if (!block) return `// (could not extract block at ${ref.file}:${ref.line})`
    return line + '\n' + block.split('\n').slice(1).join('\n')
  }

  // Rust: ref.line points at the `// behavior:` marker. Walk forward to the fn,
  // capture from the marker through the end of the fn body.
  const lines = src.split('\n')
  let fnLine = -1
  for (let i = ref.line - 1; i < lines.length && i < ref.line - 1 + 20; i++) {
    if (/^\s*(?:pub\s+)?fn\s+\w+/.test(lines[i])) { fnLine = i + 1; break }
  }
  if (fnLine < 0) return `// (could not find fn after ${ref.file}:${ref.line})`
  const block = extractBraceBlock(src, fnLine)
  if (!block) return `// (could not extract fn body at ${ref.file}:${fnLine})`
  const preamble = lines.slice(ref.line - 1, fnLine - 1).join('\n')
  return `${preamble}\n${lines[fnLine - 1]}\n${block.split('\n').slice(1).join('\n')}`
}

const FEEDBACK_OPEN_RE  = /<!--\s*audit:feedback\s+id=(\S+?)\s*-->/g
const FEEDBACK_CLOSE    = '<!-- /audit:feedback -->'

/** Parse existing audit.md and return a map of id → feedback body. */
function loadExistingFeedback(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  const content = readFileSync(path, 'utf8')
  const out: Record<string, string> = {}
  FEEDBACK_OPEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = FEEDBACK_OPEN_RE.exec(content)) !== null) {
    const id = m[1]
    const bodyStart = m.index + m[0].length
    const closeIdx = content.indexOf(FEEDBACK_CLOSE, bodyStart)
    if (closeIdx < 0) continue
    out[id] = content.slice(bodyStart, closeIdx).replace(/^\n+|\n+$/g, '')
  }
  return out
}

function runAudit(): void {
  if (!existsSync(REGISTRY)) runParse()
  const { behaviors } = JSON.parse(readFileSync(REGISTRY, 'utf8')) as { behaviors: Record<string, BehaviorEntry> }
  const testRefs = [...scanTests(TESTS_DIR), ...scanRustTests(RUST_TESTS_DIR)]
  const refsById = new Map<string, CoverageRef[]>()
  for (const ref of testRefs) {
    if (!refsById.has(ref.id)) refsById.set(ref.id, [])
    refsById.get(ref.id)!.push(ref)
  }

  const existing = loadExistingFeedback(AUDIT_OUT)
  const ids = Object.keys(behaviors).sort()

  const covered = ids.filter(id => (refsById.get(id)?.length ?? 0) > 0)
  const missing = ids.filter(id => (refsById.get(id)?.length ?? 0) === 0)

  const lines: string[] = []
  lines.push('# Behavior Audit')
  lines.push('')
  lines.push('_Auto-generated by `npm run behaviors:audit`. Edit only the `<!-- audit:feedback -->` blocks; the rest is regenerated._')
  lines.push('')
  lines.push(`**Coverage:** ${covered.length}/${ids.length} covered · ${missing.length} missing`)
  lines.push('')
  if (missing.length > 0) {
    lines.push('## Missing')
    lines.push('')
    for (const id of missing) {
      const e = behaviors[id]
      lines.push(`- \`${id}\` — ${e.scenario} (${e.file}:${e.line})`)
    }
    lines.push('')
  }

  lines.push('## Behaviors')
  lines.push('')

  for (const id of ids) {
    const e = behaviors[id]
    const refs = refsById.get(id) ?? []
    lines.push(`### \`${id}\` — ${e.scenario}`)
    lines.push('')
    lines.push(`**Feature:** ${e.feature}  `)
    lines.push(`**Spec:** \`${e.file}:${e.line}\`  `)
    lines.push(`**Status:** ${refs.length > 0 ? `covered by ${refs.length} test(s)` : '**missing**'}`)
    lines.push('')
    lines.push('**Steps:**')
    for (const step of e.steps) lines.push(`- ${step}`)
    lines.push('')
    if (e.hints && e.hints.length > 0) {
      lines.push('**Hints:**')
      for (const h of e.hints) lines.push(`- ${h}`)
      lines.push('')
    }

    for (const ref of refs) {
      const parts = [ref.lang]
      if (ref.lang === 'rust' && ref.heavy) parts.push('heavy')
      if (ref.skipped) parts.push('skipped')
      const tag  = ' · ' + parts.join(' · ')
      const lang = ref.lang === 'rust' ? 'rust' : 'ts'
      lines.push(`#### \`${ref.file}:${ref.line}\`${tag}`)
      lines.push('')
      lines.push('```' + lang)
      lines.push(extractSnippet(ref).trimEnd())
      lines.push('```')
      lines.push('')
    }

    lines.push(`<!-- audit:feedback id=${id} -->`)
    lines.push(existing[id] ?? '_No feedback yet._')
    lines.push(FEEDBACK_CLOSE)
    lines.push('')
    lines.push('---')
    lines.push('')
  }

  mkdirSync(GENERATED, { recursive: true })
  writeFileSync(AUDIT_OUT, lines.join('\n'))

  const rel = relative(ROOT, AUDIT_OUT).replace(/\\/g, '/')
  const preserved = Object.keys(existing).length
  console.log(`Wrote ${ids.length} behaviors → ${rel}`)
  console.log(`  covered: ${covered.length} · missing: ${missing.length} · feedback preserved: ${preserved}`)
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
} else if (cmd === 'audit') {
  runAudit()
}
