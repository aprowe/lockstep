#!/usr/bin/env node
/**
 * behavior-coverage.mjs
 *
 * Deterministic spec-to-test traceability tool.
 *
 * For each scenario in BEHAVIORS.md it produces a stable ID:
 *   <feature-slug>::<hash>
 *
 * where:
 *   feature-slug  = kebab-case of the nearest ## section header (number prefix stripped)
 *   hash          = first 5 hex chars of SHA-256( normalised GWT text )
 *   normalised    = strip markdown bold, collapse whitespace, lowercase, trim
 *
 * IDs are purely content-addressed. Same spec text → same ID, always.
 *
 * Usage:
 *   node scripts/behavior-coverage.mjs [--json]
 */

import { readFileSync } from 'fs'
import { createHash } from 'crypto'
import { resolve, join } from 'path'
import { readdirSync, statSync } from 'fs'

const ROOT    = resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'), '..')
const SPEC    = join(ROOT, 'BEHAVIORS.md')
const TESTS   = join(ROOT, 'src/__tests__')
const JSON_MODE = process.argv.includes('--json')

// ─────────────────────────────────────────────────────────────────────────────
// Slug & hash helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Kebab-case from a markdown section header line */
function toSlug(header) {
  return header
    .replace(/^#+\s*/, '')          // strip leading ## marks
    .replace(/\*\*/g, '')           // strip bold markers
    .replace(/^\d+\.\s*/, '')       // strip leading ordinal "1. "
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Normalise scenario text: strip bold, collapse whitespace, lowercase */
function normalise(lines) {
  return lines
    .map(l => l.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** First 5 hex chars of SHA-256(text) */
function shortHash(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 5)
}

// ─────────────────────────────────────────────────────────────────────────────
// Spec parser
// ─────────────────────────────────────────────────────────────────────────────

const GWT_RE     = /^\*\*(Given|When|Then|And|But)\*\*/i
const SECTION_RE = /^#{2,}\s/
const SKIP_RE    = /^(<!--|→|---)/    // HTML comments, reference links, dividers

/**
 * Parse BEHAVIORS.md into scenario objects.
 * A scenario = one contiguous block of GWT lines separated from others by a
 * blank line or a new section header.  Only GWT lines contribute to the hash.
 */
function parseSpec(content) {
  const scenarios = []
  let section = ''
  let paragraph = []   // accumulated non-blank lines for current paragraph

  function flush() {
    const gwtLines = paragraph.filter(l => GWT_RE.test(l))
    if (gwtLines.length > 0) {
      const text = normalise(gwtLines)
      const slug = toSlug(section)
      const id   = `${slug}::${shortHash(text)}`
      scenarios.push({ id, slug, section, gwtLines, text })
    }
    paragraph = []
  }

  for (const raw of content.split('\n')) {
    const line = raw.trimEnd()
    const trimmed = line.trim()

    if (SECTION_RE.test(trimmed)) { flush(); section = trimmed; continue }
    if (SKIP_RE.test(trimmed))      continue
    if (trimmed === '')             { flush(); continue }

    paragraph.push(trimmed)
  }
  flush()

  return scenarios
}

// ─────────────────────────────────────────────────────────────────────────────
// Test scanner
// ─────────────────────────────────────────────────────────────────────────────

// Matches both formats:
//   @behavior <id>
//   [@behavior <id>] (bracketed in test name)
const REF_RE = /@behavior\s+([\w:\-./]+)/g

function walkDir(dir, ext, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walkDir(full, ext, files)
    else if (entry.name.endsWith(ext)) files.push(full)
  }
  return files
}

function scanTests(dir) {
  const refs = []   // { file, lineNo, id }
  for (const file of walkDir(dir, '.test.ts')) {
    const rel = file.replace(ROOT + '/', '').replace(/\\/g, '/')
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      let m
      REF_RE.lastIndex = 0
      while ((m = REF_RE.exec(line)) !== null) {
        refs.push({ file: rel, lineNo: i + 1, id: m[1].trim() })
      }
    })
  }
  return refs
}

// ─────────────────────────────────────────────────────────────────────────────
// Analysis
// ─────────────────────────────────────────────────────────────────────────────

const spec      = parseSpec(readFileSync(SPEC, 'utf8'))
const testRefs  = scanTests(TESTS)
const specIds   = new Set(spec.map(s => s.id))

// spec → tests
const coverage  = new Map(spec.map(s => [s.id, []]))
for (const ref of testRefs) {
  if (coverage.has(ref.id)) coverage.get(ref.id).push(ref)
}

const uncovered = spec.filter(s => coverage.get(s.id).length === 0)
const orphaned  = testRefs.filter(r => !specIds.has(r.id))

// ─────────────────────────────────────────────────────────────────────────────
// Output
// ─────────────────────────────────────────────────────────────────────────────

if (JSON_MODE) {
  console.log(JSON.stringify({
    scenarios: spec.map(s => ({
      id: s.id, section: s.section,
      gwtLines: s.gwtLines, text: s.text,
    })),
    coverage: Object.fromEntries(
      [...coverage.entries()].map(([id, refs]) => [id, refs])
    ),
    uncovered: uncovered.map(s => s.id),
    orphaned,
  }, null, 2))
} else {
  const W = 72
  const hr = '─'.repeat(W)

  console.log(`\n${'━'.repeat(W)}`)
  console.log('  BEHAVIOR COVERAGE REPORT')
  console.log(`${'━'.repeat(W)}\n`)

  console.log('SPEC IDs\n' + hr)
  for (const s of spec) {
    const refs = coverage.get(s.id)
    const mark = refs.length > 0 ? '✓' : '✗'
    console.log(`${mark} ${s.id}`)
    console.log(`  section : ${s.section}`)
    console.log(`  scenario: ${s.text.slice(0, 70)}${s.text.length > 70 ? '…' : ''}`)
    if (refs.length > 0) {
      for (const r of refs) console.log(`  covered : ${r.file}:${r.lineNo}`)
    }
    console.log()
  }

  console.log('UNCOVERED SPECS  (' + uncovered.length + ')\n' + hr)
  if (uncovered.length === 0) {
    console.log('  (none)\n')
  } else {
    for (const s of uncovered) {
      console.log(`  ✗ ${s.id}`)
      for (const l of s.gwtLines) console.log(`      ${l}`)
      console.log()
    }
  }

  console.log('ORPHANED TEST REFS  (' + orphaned.length + ')\n' + hr)
  if (orphaned.length === 0) {
    console.log('  (none)\n')
  } else {
    for (const r of orphaned) {
      console.log(`  ? ${r.id}`)
      console.log(`    ${r.file}:${r.lineNo}`)
      console.log()
    }
  }

  console.log(`${'━'.repeat(W)}`)
  const total = spec.length
  const covered = spec.length - uncovered.length
  console.log(`  Coverage: ${covered}/${total} behaviors  |  ${orphaned.length} orphaned test ref(s)`)
  console.log(`${'━'.repeat(W)}\n`)
}
