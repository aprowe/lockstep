#!/usr/bin/env tsx
/**
 * scripts/layouts.ts
 *
 * Parser + coverage checker for UI layout specs.
 *
 * Spec format: YAML files at layouts/*.layout.yaml
 *
 *   id: main-toolbar
 *   name: Main toolbar
 *   description: ...
 *   groups:
 *     - - New Marker             # simple form — string = label, id auto-slugified
 *       - id: explicit-id        # rich form — object with explicit fields
 *         label: Prev Marker
 *         shortcut: Shift+Tab    # reserved for future behavior checks
 *     - - New Region
 *       - ...
 *
 * Commands:
 *   parse     Parse layouts/ → generated/layout-registry.json
 *   check     parse + verify every layout has a layoutTest(...) reference
 *
 * Usage:
 *   tsx scripts/layouts.ts parse
 *   tsx scripts/layouts.ts check
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseAllDocuments } from 'yaml'

const ROOT        = resolve(fileURLToPath(import.meta.url), '..', '..')
const LAYOUTS_DIR = join(ROOT, 'spec', 'layouts')
const TESTS_DIR   = join(ROOT, 'tests')
const GENERATED   = join(ROOT, 'spec', 'generated')
const REGISTRY    = join(GENERATED, 'layout-registry.json')

const args     = process.argv.slice(2)
const cmd      = args.find(a => !a.startsWith('-'))
const NO_COLOR = args.includes('--no-color') || !process.stdout.isTTY

if (!cmd || !['parse', 'check'].includes(cmd)) {
  console.error('Usage: tsx scripts/layouts.ts <parse|check> [--no-color]')
  process.exit(1)
}

// ─── color helpers ────────────────────────────────────────────────────────────

const c = {
  bold:   (s: string) => NO_COLOR ? s : `\x1b[1m${s}\x1b[0m`,
  green:  (s: string) => NO_COLOR ? s : `\x1b[32m${s}\x1b[0m`,
  red:    (s: string) => NO_COLOR ? s : `\x1b[31m${s}\x1b[0m`,
  cyan:   (s: string) => NO_COLOR ? s : `\x1b[36m${s}\x1b[0m`,
  gray:   (s: string) => NO_COLOR ? s : `\x1b[90m${s}\x1b[0m`,
  yellow: (s: string) => NO_COLOR ? s : `\x1b[33m${s}\x1b[0m`,
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function walkDir(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) walkDir(p, out)
    else out.push(p)
  }
  return out
}

// ─── types ────────────────────────────────────────────────────────────────────

interface LayoutItem {
  id: string
  label: string
  /** Any extra fields from the YAML (shortcut, disabledWhen, icon, etc.) */
  attrs?: Record<string, unknown>
}

interface LayoutGroup {
  items: LayoutItem[]
}

interface LayoutEntry {
  id: string
  name: string
  description?: string
  file: string
  groups: LayoutGroup[]
}

// ─── parser ───────────────────────────────────────────────────────────────────

function parseItem(raw: unknown, fileRel: string): LayoutItem {
  if (typeof raw === 'string') {
    const label = raw.trim()
    return { id: toSlug(label), label }
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    const label = typeof obj.label === 'string' ? obj.label : ''
    const id = typeof obj.id === 'string' ? obj.id : toSlug(label)
    if (!label) throw new Error(`${fileRel}: item missing "label"`)
    // Collect any extra keys as attrs
    const { id: _, label: __, ...rest } = obj
    const attrs = Object.keys(rest).length > 0 ? (rest as Record<string, unknown>) : undefined
    return attrs ? { id, label, attrs } : { id, label }
  }
  throw new Error(`${fileRel}: item must be a string or object, got ${typeof raw}`)
}

function parseLayoutDoc(doc: unknown, fileRel: string, docIndex: number): LayoutEntry {
  const where = `${fileRel}${docIndex > 0 ? ` (doc ${docIndex + 1})` : ''}`
  if (!doc || typeof doc !== 'object') {
    throw new Error(`${where}: YAML document must be a mapping`)
  }
  const d = doc as Record<string, unknown>
  const id = typeof d.id === 'string' ? d.id : null
  if (!id) throw new Error(`${where}: missing top-level "id"`)

  const name = typeof d.name === 'string' ? d.name : id
  const description = typeof d.description === 'string' ? d.description : undefined

  const groupsRaw = d.groups
  if (!Array.isArray(groupsRaw)) {
    throw new Error(`${where}: "groups" must be a list of lists`)
  }

  const groups: LayoutGroup[] = groupsRaw.map((groupRaw, gi) => {
    let items: unknown[]
    if (Array.isArray(groupRaw)) {
      items = groupRaw
    } else if (groupRaw && typeof groupRaw === 'object' && Array.isArray((groupRaw as any).items)) {
      items = (groupRaw as any).items
    } else {
      throw new Error(`${where}: group ${gi} must be a list or { items: [...] }`)
    }
    return { items: items.map(item => parseItem(item, where)) }
  })

  const seen = new Set<string>()
  for (const g of groups) {
    for (const item of g.items) {
      if (seen.has(item.id)) {
        throw new Error(`${where}: duplicate item ID "${item.id}"`)
      }
      seen.add(item.id)
    }
  }

  return { id, name, description, file: fileRel, groups }
}

function parseLayoutFile(filePath: string): LayoutEntry[] {
  const fileRel = relative(ROOT, filePath).replace(/\\/g, '/')
  const content = readFileSync(filePath, 'utf8')
  const docs = parseAllDocuments(content)
  // Skip empty documents (blank file, trailing `---` with nothing after, comment-only)
  const parsed = docs.map(d => d.toJSON()).filter(d => d !== null && d !== undefined)
  if (parsed.length === 0) {
    console.warn(`  (skipped empty: ${fileRel})`)
    return []
  }
  return parsed.map((doc, i) => parseLayoutDoc(doc, fileRel, i))
}

function parseAll(): Record<string, LayoutEntry> {
  const registry: Record<string, LayoutEntry> = {}
  if (!existsSync(LAYOUTS_DIR)) {
    console.error(`No layouts directory at ${LAYOUTS_DIR}`)
    return registry
  }
  const files = walkDir(LAYOUTS_DIR).filter(f => f.endsWith('.layout.yaml') || f.endsWith('.layout.yml'))
  for (const file of files) {
    const entries = parseLayoutFile(file)
    for (const entry of entries) {
      if (registry[entry.id]) {
        throw new Error(`Duplicate layout ID "${entry.id}" in ${entry.file} (already in ${registry[entry.id].file})`)
      }
      registry[entry.id] = entry
    }
  }
  return registry
}

// ─── commands ─────────────────────────────────────────────────────────────────

function runParse() {
  const layouts = parseAll()
  mkdirSync(GENERATED, { recursive: true })
  writeFileSync(REGISTRY, JSON.stringify({ layouts }, null, 2) + '\n', 'utf8')

  const count      = Object.keys(layouts).length
  const totalItems = Object.values(layouts).reduce(
    (sum, l) => sum + l.groups.reduce((s, g) => s + g.items.length, 0), 0,
  )
  const outRel = relative(ROOT, REGISTRY).replace(/\\/g, '/')
  console.log(`\n${c.bold(`Wrote ${count} layout${count !== 1 ? 's' : ''}`)}`
    + ` ${c.gray('→')} ${c.cyan(outRel)}\n`)

  for (const l of Object.values(layouts)) {
    const itemCount = l.groups.reduce((s, g) => s + g.items.length, 0)
    console.log(`  ${c.cyan(l.id)}  ${c.gray(`(${l.groups.length} groups, ${itemCount} items)`)}`)
    l.groups.forEach((group, gi) => {
      for (const item of group.items) {
        const extra = item.attrs ? c.gray(` [${Object.keys(item.attrs).join(', ')}]`) : ''
        console.log(`    ${c.gray('-')} ${item.id.padEnd(24)} ${c.gray(item.label)}${extra}`)
      }
      if (gi < l.groups.length - 1) console.log(c.gray('    ───'))
    })
    console.log()
  }
}

function runCheck() {
  runParse()
  const registry = JSON.parse(readFileSync(REGISTRY, 'utf8')).layouts as Record<string, LayoutEntry>

  const testFiles = walkDir(TESTS_DIR).filter(f => f.endsWith('.test.ts') || f.endsWith('.test.tsx'))
  const referenced = new Set<string>()
  // Match assertLayoutMatches('<id>', ...) and any *LayoutTest('<id>', ...) helpers
  const idPattern = /(?:assertLayoutMatches|[A-Za-z]*[Ll]ayoutTest)\(\s*['"]([a-z0-9-]+)['"]/g
  for (const file of testFiles) {
    const content = readFileSync(file, 'utf8')
    let m: RegExpExecArray | null
    while ((m = idPattern.exec(content)) !== null) referenced.add(m[1])
  }

  const ids     = Object.keys(registry)
  const covered = ids.filter(id =>  referenced.has(id))
  const missing = ids.filter(id => !referenced.has(id))
  const pct     = ids.length === 0 ? 100 : Math.round((covered.length / ids.length) * 100)

  const W     = 72
  const heavy = '━'.repeat(W)
  const light = '─'.repeat(W)
  console.log(`${c.bold(heavy)}\n  ${c.bold('LAYOUT COVERAGE')}\n${c.bold(heavy)}\n`)

  console.log(`${c.bold(`COVERED  (${covered.length}/${ids.length})`)}\n${c.gray(light)}`)
  for (const id of covered) {
    console.log(`  ${c.green('✓')} ${c.cyan(id)}`)
    console.log(`    ${c.gray(registry[id].file)}`)
  }

  console.log(`\n${c.bold(`MISSING  (${missing.length})`)}\n${c.gray(light)}`)
  if (missing.length === 0) {
    console.log(c.gray('  (none)'))
  } else {
    for (const id of missing) {
      console.log(`  ${c.red('✗')} ${c.red(id)}`)
      console.log(`    ${c.gray(registry[id].file)}`)
    }
  }

  const pctColor = pct === 100 ? c.green : pct >= 80 ? c.yellow : c.red
  const summary  = `Coverage: ${covered.length}/${ids.length} (${pct}%)`
  console.log(`\n${c.bold(heavy)}\n  ${pctColor(c.bold(summary))}\n${c.bold(heavy)}\n`)

  if (missing.length > 0) process.exit(1)
}

if (cmd === 'parse') runParse()
else if (cmd === 'check') runCheck()
