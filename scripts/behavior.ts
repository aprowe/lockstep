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

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const FEATURES_DIR = join(ROOT, "spec", "features");
const DEFS_PATH = join(ROOT, "spec", "defs.yaml");
const TESTS_DIR = join(ROOT, "tests");
const RUST_TESTS_DIR = join(ROOT, "src-tauri", "tests");
const GENERATED = join(ROOT, "spec", "generated");
const REGISTRY = join(GENERATED, "behavior-registry.json");
const COVERAGE_OUT = join(GENERATED, "coverage.json");
const AUDIT_OUT = join(GENERATED, "audit.md");

const args = process.argv.slice(2);
const cmd = args.find((a) => !a.startsWith("-"));
const NO_COLOR = args.includes("--no-color") || !process.stdout.isTTY;

if (!cmd || !["parse", "coverage", "check", "audit"].includes(cmd)) {
    console.error("Usage: tsx scripts/behavior.ts <parse|coverage|check|audit> [--no-color]");
    process.exit(1);
}

// ─── color helpers ────────────────────────────────────────────────────────────

const c = {
    reset: (s: string) => (NO_COLOR ? s : `\x1b[0m${s}\x1b[0m`),
    bold: (s: string) => (NO_COLOR ? s : `\x1b[1m${s}\x1b[0m`),
    dim: (s: string) => (NO_COLOR ? s : `\x1b[2m${s}\x1b[0m`),
    green: (s: string) => (NO_COLOR ? s : `\x1b[32m${s}\x1b[0m`),
    red: (s: string) => (NO_COLOR ? s : `\x1b[31m${s}\x1b[0m`),
    yellow: (s: string) => (NO_COLOR ? s : `\x1b[33m${s}\x1b[0m`),
    cyan: (s: string) => (NO_COLOR ? s : `\x1b[36m${s}\x1b[0m`),
    gray: (s: string) => (NO_COLOR ? s : `\x1b[90m${s}\x1b[0m`),
};

// ─── shared helpers ───────────────────────────────────────────────────────────

function toSlug(title: string): string {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function normalizeSteps(lines: string[]): string {
    return lines
        .map((l) => l.replace(/^\s*(Given|When|Then|And|But)\s*:?\s+/i, "").trim())
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function shortHash(text: string): string {
    return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 8);
}

// ─── defs.yaml (glossary referenced from .feature files) ─────────────────────
//
// Features reference glossary entries using bracket syntax: `[input ruler]`.
// Each referenced def's text is folded into the scenario hash, so editing a
// def invalidates every scenario linked to it (directly or transitively via
// `$key` tokens inside the def text). Tests pinned to the old hash break at
// the behaviors check, prompting a review.

interface DefEntry {
    /** Canonical (normalized) key. */
    key: string;
    /** The first original spelling seen in defs.yaml. */
    original: string;
    /** The def body, trimmed. */
    def: string;
}

function normalizeKey(s: string): string {
    return s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function loadDefs(): Map<string, DefEntry> {
    const defs = new Map<string, DefEntry>();
    if (!existsSync(DEFS_PATH)) return defs;
    const parsed = parseYaml(readFileSync(DEFS_PATH, "utf8")) as unknown;

    const walk = (entries: unknown) => {
        if (!Array.isArray(entries)) return;
        for (const entry of entries) {
            if (!entry || typeof entry !== "object") continue;
            const e = entry as Record<string, unknown>;
            const raw = e.key;
            const body = typeof e.def === "string" ? e.def.trim().replace(/\s+/g, " ") : "";
            const keys: string[] = Array.isArray(raw)
                ? raw.filter((k): k is string => typeof k === "string")
                : typeof raw === "string"
                  ? [raw]
                  : [];
            for (const k of keys) {
                const canon = normalizeKey(k);
                if (!canon) continue;
                if (defs.has(canon)) {
                    console.warn(`  WARN: duplicate def key "${canon}" (from "${k}")`);
                }
                defs.set(canon, { key: canon, original: k.trim(), def: body });
            }
            if ("sub" in e) walk(e.sub);
        }
    };

    walk((parsed as Record<string, unknown>)?.elements);
    return defs;
}

/** Extract all `[key]` references from a chunk of feature text. */
function extractRefs(text: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const re = /\[([^\]\n]+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const canon = normalizeKey(m[1]);
        if (!canon || seen.has(canon)) continue;
        seen.add(canon);
        out.push(canon);
    }
    return out;
}

/**
 * Given a set of directly-referenced def keys, return the transitive closure
 * via `$key` tokens inside def bodies. Sorted for stable hashing. Unresolved
 * keys are silently dropped here and surfaced separately by the caller.
 */
function resolveDefClosure(directKeys: string[], defs: Map<string, DefEntry>): DefEntry[] {
    const visited = new Set<string>();
    const out: DefEntry[] = [];
    const queue = [...directKeys];
    while (queue.length > 0) {
        const k = queue.shift()!;
        if (visited.has(k)) continue;
        visited.add(k);
        const d = defs.get(k);
        if (!d) continue;
        out.push(d);
        const tokens = d.def.matchAll(/\$([A-Za-z0-9_]+)/g);
        for (const tm of tokens) {
            const canon = normalizeKey(tm[1]);
            if (!visited.has(canon)) queue.push(canon);
        }
    }
    out.sort((a, b) => a.key.localeCompare(b.key));
    return out;
}

// ─── parse ────────────────────────────────────────────────────────────────────

interface BehaviorEntry {
    feature: string;
    scenario: string;
    isOutline: boolean;
    steps: string[];
    file: string;
    line: number;
    /** Scenario is a stub / intentionally unimplemented (Gherkin `@todo` tag). */
    todo?: boolean;
    /** Gherkin `@tag` lines on the scenario (minus `@todo`, which is promoted to `todo`). */
    tags?: string[];
    /** Canonical keys of glossary defs referenced directly by this scenario. */
    defs?: string[];
    /** `[key]` refs that didn't resolve against defs.yaml. */
    unresolvedRefs?: string[];
    /** Optional test file hints (from `# @test <path>` comments before the scenario) */
    tests?: string[];
    /** Optional AI/human hints (from `# @hint <text>` comments before the scenario) */
    hints?: string[];
}

const FEATURE_RE = /^\s*Feature\s*:/i;
const SCENARIO_RE = /^\s*Scenario(\s+Outline)?\s*:/i;
const STEP_RE = /^\s*(Given|When|Then|And|But)\s*:?\s+/i;
const EXAMPLES_RE = /^\s*Examples\s*:/i;

function parseFeatureFile(
    content: string,
    relPath: string,
    defs: Map<string, DefEntry>,
): Record<string, BehaviorEntry> {
    const lines = content.split("\n");
    const behaviors: Record<string, BehaviorEntry> = {};
    let featureTitle = "";
    let scenarioTitle = "";
    let scenarioLine = 0;
    let isOutline = false;
    let steps: string[] = [];
    let inExamples = false;
    let exampleRows: string[] = [];
    // pendingTests/Hints/Tags: annotations collected BETWEEN scenarios (before the next Scenario: line)
    let pendingTests: string[] = [];
    let pendingHints: string[] = [];
    let pendingTags: string[] = [];
    // featureTags: tag tokens declared on the line(s) directly above `Feature:`.
    // Per Gherkin semantics, these cascade to every scenario in the file.
    let featureTags: string[] = [];
    // scenarioTests/Hints/Tags: annotations for the CURRENT scenario being built
    let scenarioTests: string[] = [];
    let scenarioHints: string[] = [];
    let scenarioTags: string[] = [];

    const flush = () => {
        if (!scenarioTitle || steps.length === 0) return;

        // Resolve [key] references in the scenario. The transitive closure of def
        // text feeds the hash so that editing ANY linked def bumps the id.
        const refSource = [scenarioTitle, ...steps, ...exampleRows].join("\n");
        const directRefs = extractRefs(refSource);
        const resolved = resolveDefClosure(directRefs, defs);
        const resolvedKeys = new Set(resolved.map((d) => d.key));
        const directResolved = directRefs.filter((k) => resolvedKeys.has(k)).sort();
        const unresolved = directRefs.filter((k) => !defs.has(k)).sort();

        const hashInput = [
            scenarioTitle.toLowerCase().trim(),
            normalizeSteps(steps),
            ...exampleRows,
            ...resolved.map((d) => `def:${d.key}:${d.def}`),
        ].join("\n");
        const id = `${toSlug(featureTitle)}::${shortHash(hashInput)}`;
        if (behaviors[id]) console.warn(`  WARN: ID collision in ${relPath}: ${id}`);
        const entry: BehaviorEntry = {
            feature: featureTitle,
            scenario: scenarioTitle,
            isOutline,
            steps: steps.map((s) => s.trim()),
            file: relPath,
            line: scenarioLine,
        };
        // Feature-level tags cascade to every scenario (Gherkin semantics).
        const effectiveTags = [...new Set([...featureTags, ...scenarioTags])];
        const todo = effectiveTags.includes("@todo");
        const otherTags = effectiveTags.filter((t) => t !== "@todo");
        if (todo) entry.todo = true;
        if (otherTags.length > 0) entry.tags = otherTags;
        if (directResolved.length > 0) entry.defs = directResolved;
        if (unresolved.length > 0) entry.unresolvedRefs = unresolved;
        if (scenarioTests.length > 0) entry.tests = scenarioTests;
        if (scenarioHints.length > 0) entry.hints = scenarioHints;
        behaviors[id] = entry;
        steps = [];
        scenarioTitle = "";
        isOutline = false;
        inExamples = false;
        exampleRows = [];
        scenarioTests = [];
        scenarioHints = [];
        scenarioTags = [];
    };

    for (const [i, raw] of lines.entries()) {
        const t = raw.trim();
        if (FEATURE_RE.test(t)) {
            featureTitle = t.replace(/^Feature\s*:\s*/i, "").trim();
            // Tags accumulated before `Feature:` cascade to every scenario in the file.
            if (pendingTags.length > 0) {
                featureTags = pendingTags;
                pendingTags = [];
            }
            continue;
        }
        // Collect @test / @hint from comment lines (multi-line hints joined with space)
        if (t.startsWith("#")) {
            const testMatch = t.match(/^#\s*@test\s+(.+)/);
            const hintMatch = t.match(/^#\s*@hint\s+(.+)/);
            if (testMatch) pendingTests.push(testMatch[1].trim());
            else if (hintMatch) pendingHints.push(hintMatch[1].trim());
            // Continuation: `#       more hint text` (indented, no @tag) appends to last hint
            else if (pendingHints.length > 0 && /^#\s{6,}/.test(t)) {
                pendingHints[pendingHints.length - 1] += " " + t.replace(/^#\s+/, "").trim();
            }
            continue;
        }
        // Gherkin tag line: one or more `@tag` tokens on their own line, directly above a scenario.
        if (t.startsWith("@") && !STEP_RE.test(t)) {
            for (const tok of t.split(/\s+/)) if (/^@\S+/.test(tok)) pendingTags.push(tok);
            continue;
        }
        if (SCENARIO_RE.test(t)) {
            flush();
            // Transfer pending annotations to the new scenario
            scenarioTests = pendingTests;
            scenarioHints = pendingHints;
            scenarioTags = pendingTags;
            pendingTests = [];
            pendingHints = [];
            pendingTags = [];
            isOutline = /Outline/i.test(t);
            scenarioTitle = t.replace(/^Scenario(\s+Outline)?\s*:\s*/i, "").trim();
            scenarioLine = i + 1;
            inExamples = false;
            continue;
        }
        if (EXAMPLES_RE.test(t)) {
            inExamples = true;
            continue;
        }
        if (inExamples) {
            if (t.startsWith("|")) exampleRows.push(t.replace(/\s+/g, " "));
            continue;
        }
        if (STEP_RE.test(t)) steps.push(t);
    }
    flush();
    return behaviors;
}

function findFiles(dir: string, ext: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) findFiles(full, ext, out);
        else if (entry.name.endsWith(ext)) out.push(full);
    }
    return out;
}

function runParse() {
    const all: Record<string, BehaviorEntry> = {};
    let collisions = 0;

    const defs = loadDefs();

    for (const file of findFiles(FEATURES_DIR, ".feature")) {
        const content = readFileSync(file, "utf8");
        const rel = relative(ROOT, file).replace(/\\/g, "/");
        for (const [id, entry] of Object.entries(parseFeatureFile(content, rel, defs))) {
            if (all[id]) {
                console.warn(`WARN: cross-file collision: ${id}`);
                collisions++;
            }
            all[id] = entry;
        }
    }

    mkdirSync(GENERATED, { recursive: true });
    writeFileSync(REGISTRY, JSON.stringify({ behaviors: all }, null, 2) + "\n");

    const count = Object.keys(all).length;
    const outRel = relative(ROOT, REGISTRY).replace(/\\/g, "/");
    const defsRel = relative(ROOT, DEFS_PATH).replace(/\\/g, "/");
    const defsNote =
        defs.size > 0
            ? `${c.gray("(")}${defs.size} def${defs.size !== 1 ? "s" : ""} from ${c.cyan(defsRel)}${c.gray(")")}`
            : c.gray(`(no defs loaded — ${defsRel} missing)`);
    console.log(
        `\n${c.bold(`Wrote ${count} behavior${count !== 1 ? "s" : ""}`)}` +
            ` ${c.gray("→")} ${c.cyan(outRel)} ${defsNote}\n`,
    );

    // Group entries by feature file for a tree-style printout.
    const byFile = new Map<string, Array<[string, BehaviorEntry]>>();
    for (const [id, e] of Object.entries(all)) {
        if (!byFile.has(e.file)) byFile.set(e.file, []);
        byFile.get(e.file)!.push([id, e]);
    }
    const files = [...byFile.keys()].sort();
    for (const file of files) {
        const entries = byFile.get(file)!;
        console.log(`${c.cyan(file)}  ${c.gray(`(${entries.length})`)}`);
        entries.forEach(([id, e], idx) => {
            const last = idx === entries.length - 1;
            const branch = c.gray(last ? "└─" : "├─");
            const pipe = c.gray(last ? "  " : "│ ");
            const bits: string[] = [];
            if (e.isOutline) bits.push("outline");
            if (e.todo) bits.push("todo");
            const tag = bits.length > 0 ? " " + c.yellow(`[${bits.join(" ")}]`) : "";
            console.log(`  ${branch} ${e.scenario}${tag}  ${c.gray(id)}`);
            if (e.defs && e.defs.length > 0) {
                console.log(
                    `  ${pipe}    ${c.gray("defs:")} ${e.defs.map((k) => c.yellow(k)).join(c.gray(", "))}`,
                );
            }
            if (e.unresolvedRefs && e.unresolvedRefs.length > 0) {
                console.log(
                    `  ${pipe}    ${c.red("unresolved:")} ${e.unresolvedRefs.map((k) => c.red(`[${k}]`)).join(" ")}`,
                );
            }
        });
        console.log("");
    }

    const unresolvedCount = Object.values(all).reduce(
        (n, e) => n + (e.unresolvedRefs?.length ?? 0),
        0,
    );
    if (unresolvedCount > 0) {
        console.warn(
            c.yellow(
                `\n${unresolvedCount} unresolved [ref]${unresolvedCount !== 1 ? "s" : ""} — add entries to ${defsRel} to link them.`,
            ),
        );
    }

    if (collisions > 0) {
        console.error(c.red(`\n${collisions} ID collision(s).`));
        process.exit(1);
    }
}

// ─── coverage ─────────────────────────────────────────────────────────────────

interface CoverageRef {
    id: string;
    file: string;
    line: number;
    lang: "ts" | "rust";
    heavy?: boolean;
    skipped?: boolean;
}

const CALL_RE = /behaviorTest\(\s*['"]([^'"]+)['"]/g;
const TS_BEHAVIOR_COMMENT_RE = /^\s*\/\/\s*@behavior\s+(\S+)/;

function scanTests(dir: string): CoverageRef[] {
    const refs: CoverageRef[] = [];
    // Vitest specs (.test.ts/.tsx) plus Playwright integration specs
    // (.bdd.spec.ts/.tsx). Both honor the same `// @behavior <id>` marker;
    // the skip-detection walk below handles vitest-cucumber's Scenario(...)
    // and Playwright's test(...) call shapes.
    const files = [
        ...findFiles(dir, ".test.ts"),
        ...findFiles(dir, ".test.tsx"),
        ...findFiles(dir, ".bdd.spec.ts"),
        ...findFiles(dir, ".bdd.spec.tsx"),
    ];
    for (const file of files) {
        const rel = relative(ROOT, file).replace(/\\/g, "/");
        const lines = readFileSync(file, "utf8").split("\n");
        lines.forEach((text, i) => {
            // Legacy: behaviorTest('id', ...)
            CALL_RE.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = CALL_RE.exec(text)) !== null)
                refs.push({ id: m[1], file: rel, line: i + 1, lang: "ts" });

            // vitest-cucumber / Playwright: // @behavior <id> above the test call.
            const cm = text.match(TS_BEHAVIOR_COMMENT_RE);
            if (cm) {
                let skipped = false;
                for (let j = i + 1; j < Math.min(i + 15, lines.length); j++) {
                    if (/\bScenario\.skip\s*\(/.test(lines[j])) {
                        skipped = true;
                        break;
                    }
                    if (/\btest\.skip\s*\(/.test(lines[j])) {
                        skipped = true;
                        break;
                    }
                    if (/\bScenario(?:\.only)?\s*\(/.test(lines[j])) {
                        break;
                    }
                    if (/\btest(?:\.only)?\s*\(/.test(lines[j])) {
                        break;
                    }
                }
                refs.push({ id: cm[1], file: rel, line: i + 1, lang: "ts", skipped });
            }
        });
    }
    return refs;
}

/**
 * Scan Rust integration tests for `// behavior: <id>` markers that annotate a
 * `#[test]` fn. Detects `#[ignore]` on the same test and tags those refs heavy.
 */
function scanRustTests(dir: string): CoverageRef[] {
    if (!existsSync(dir)) return [];
    const refs: CoverageRef[] = [];
    const BEHAVIOR_RE = /^\s*\/\/\s*behavior:\s*(\S+)/;
    const TEST_RE = /^\s*#\[test\]/;
    const IGNORE_RE = /^\s*#\[ignore\b/;
    const FN_RE = /^\s*(?:pub\s+)?fn\s+\w+/;

    for (const file of findFiles(dir, ".rs")) {
        const rel = relative(ROOT, file).replace(/\\/g, "/");
        const lines = readFileSync(file, "utf8").split("\n");

        let pendingIds: { id: string; line: number }[] = [];
        let seenTest = false;
        let seenIgnore = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const mBehavior = line.match(BEHAVIOR_RE);
            if (mBehavior) {
                pendingIds.push({ id: mBehavior[1], line: i + 1 });
                continue;
            }
            if (TEST_RE.test(line)) {
                seenTest = true;
                continue;
            }
            if (IGNORE_RE.test(line)) {
                seenIgnore = true;
                continue;
            }
            if (FN_RE.test(line)) {
                if (seenTest && pendingIds.length > 0) {
                    for (const { id, line: refLine } of pendingIds) {
                        refs.push({
                            id,
                            file: rel,
                            line: refLine,
                            lang: "rust",
                            heavy: seenIgnore,
                        });
                    }
                }
                pendingIds = [];
                seenTest = false;
                seenIgnore = false;
            }
        }
    }
    return refs;
}

function runCoverage(print = true): boolean {
    if (!existsSync(REGISTRY)) {
        console.error("Registry not found. Run: tsx scripts/behavior.ts parse");
        process.exit(1);
    }

    const { behaviors } = JSON.parse(readFileSync(REGISTRY, "utf8")) as {
        behaviors: Record<string, BehaviorEntry>;
    };
    const expectedIds = new Set(Object.keys(behaviors));
    const testRefs = [...scanTests(TESTS_DIR), ...scanRustTests(RUST_TESTS_DIR)];

    const coverage = new Map<string, CoverageRef[]>([...expectedIds].map((id) => [id, []]));
    for (const ref of testRefs) {
        if (coverage.has(ref.id)) coverage.get(ref.id)!.push(ref);
    }

    // @todo scenarios are intentional stubs — excluded from missing, shown in their own bucket.
    const isTodo = (id: string) => behaviors[id]?.todo === true;
    const missing = [...expectedIds].filter((id) => coverage.get(id)!.length === 0 && !isTodo(id));
    const todo = [...expectedIds].filter((id) => isTodo(id));
    const orphans = testRefs.filter((ref) => !expectedIds.has(ref.id));
    const covered = [...expectedIds].filter((id) => coverage.get(id)!.length > 0 && !isTodo(id));
    const denom = expectedIds.size - todo.length;
    const pct = denom === 0 ? 100 : Math.round((covered.length / denom) * 100);

    const result = {
        total: expectedIds.size,
        covered: covered.length,
        todo: todo.length,
        percentage: pct,
        missing,
        orphans,
    };
    mkdirSync(GENERATED, { recursive: true });
    writeFileSync(COVERAGE_OUT, JSON.stringify(result, null, 2) + "\n");

    if (!print) return missing.length === 0 && orphans.length === 0;

    const W = 72;
    const heavy = "━".repeat(W);
    const light = "─".repeat(W);
    console.log(`\n${c.bold(heavy)}\n  ${c.bold("BEHAVIOR COVERAGE")}\n${c.bold(heavy)}\n`);

    // Group ids by feature file for a tree-style printout.
    const groupByFile = (ids: string[]) => {
        const m = new Map<string, string[]>();
        for (const id of ids) {
            const f = behaviors[id].file;
            if (!m.has(f)) m.set(f, []);
            m.get(f)!.push(id);
        }
        return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
    };

    const renderBucket = (
        ids: string[],
        renderLine: (id: string, branch: string, pipe: string) => void,
    ) => {
        for (const [file, fileIds] of groupByFile(ids)) {
            console.log(`  ${c.cyan(file)}  ${c.gray(`(${fileIds.length})`)}`);
            fileIds.forEach((id, idx) => {
                const last = idx === fileIds.length - 1;
                const branch = c.gray(last ? "└─" : "├─");
                const pipe = c.gray(last ? "  " : "│ ");
                renderLine(id, branch, pipe);
            });
            console.log("");
        }
    };

    console.log(`${c.bold(`COVERED  (${covered.length}/${denom})`)}\n${c.gray(light)}`);
    renderBucket(covered, (id, branch, pipe) => {
        console.log(`    ${branch} ${c.green("✓")} ${behaviors[id].scenario}  ${c.gray(id)}`);
        for (const ref of coverage.get(id)!) {
            const bits: string[] = [];
            if (ref.lang === "rust") bits.push(ref.heavy ? "rust·heavy" : "rust");
            if (ref.skipped) bits.push("skipped");
            const tag = bits.length ? " " + c.yellow(`[${bits.join(" ")}]`) : "";
            console.log(`    ${pipe}   ${c.gray("→")} ${ref.file}:${ref.line}${tag}`);
        }
    });

    console.log(`${c.bold(c.yellow(`TODO  (${todo.length})`))}\n${c.gray(light)}`);
    if (todo.length === 0) {
        console.log(c.gray("  (none)\n"));
    } else {
        renderBucket(todo, (id, branch, pipe) => {
            const refs = coverage.get(id)!;
            const marker = refs.length === 0 ? c.yellow("…") : c.yellow("◐");
            console.log(
                `    ${branch} ${marker} ${c.yellow(behaviors[id].scenario)}  ${c.gray(id)}  ${c.gray("@todo")}`,
            );
            if (refs.length === 0) {
                console.log(
                    `    ${pipe}   ${c.gray("spec:")} ${behaviors[id].file}:${behaviors[id].line}`,
                );
            } else {
                for (const ref of refs)
                    console.log(
                        `    ${pipe}   ${c.gray("→")} ${ref.file}:${ref.line} ${c.gray("[stub]")}`,
                    );
            }
        });
    }

    console.log(`${c.bold(`MISSING  (${missing.length})`)}\n${c.gray(light)}`);
    if (missing.length === 0) {
        console.log(c.gray("  (none)\n"));
    } else {
        renderBucket(missing, (id, branch, _pipe) => {
            console.log(
                `    ${branch} ${c.red("✗")} ${c.red(behaviors[id].scenario)}  ${c.gray(id)}  ${c.gray(`:${behaviors[id].line}`)}`,
            );
        });
    }

    console.log(`\n${c.bold(`ORPHANED REFS  (${orphans.length})`)}\n${c.gray(light)}`);
    if (orphans.length === 0) {
        console.log(c.gray("  (none)"));
    } else {
        for (const ref of orphans) {
            console.log(`  ${c.yellow("?")} ${c.yellow(ref.id)}`);
            console.log(`    ${ref.file}:${ref.line}`);
        }
    }

    const pctColor = pct === 100 ? c.green : pct >= 80 ? c.yellow : c.red;
    const todoNote = todo.length > 0 ? `  |  ${c.yellow(`${todo.length} todo`)}` : "";
    const summary = `Coverage: ${covered.length}/${denom} (${pct}%)  |  ${orphans.length} orphaned ref(s)`;
    console.log(
        `\n${c.bold(heavy)}\n  ${pctColor(c.bold(summary))}${todoNote}\n${c.bold(heavy)}\n`,
    );

    return missing.length === 0 && orphans.length === 0;
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
    const lines = src.split("\n");
    if (startLine1 < 1 || startLine1 > lines.length) return null;
    // Find the first '{' on or after startLine
    let pos = lines.slice(0, startLine1 - 1).reduce((n, l) => n + l.length + 1, 0);
    const text = src;
    const firstBrace = text.indexOf("{", pos);
    if (firstBrace < 0) return null;

    let depth = 0;
    let i = firstBrace;
    let inLineCmt = false,
        inBlockCmt = false,
        inStr: string | null = null;
    while (i < text.length) {
        const ch = text[i];
        const next = text[i + 1];
        if (inLineCmt) {
            if (ch === "\n") inLineCmt = false;
        } else if (inBlockCmt) {
            if (ch === "*" && next === "/") {
                inBlockCmt = false;
                i++;
            }
        } else if (inStr) {
            if (ch === "\\") i++;
            else if (ch === inStr) inStr = null;
        } else {
            if (ch === "/" && next === "/") {
                inLineCmt = true;
                i++;
            } else if (ch === "/" && next === "*") {
                inBlockCmt = true;
                i++;
            } else if (ch === '"' || ch === "'" || ch === "`") inStr = ch;
            else if (ch === "{") depth++;
            else if (ch === "}") {
                depth--;
                if (depth === 0) {
                    // Walk back to the start of startLine for a clean slice
                    const sliceStart = lines
                        .slice(0, startLine1 - 1)
                        .reduce((n, l) => n + l.length + 1, 0);
                    return text.slice(sliceStart, i + 1);
                }
            }
        }
        i++;
    }
    return null;
}

/** Extract the snippet associated with a CoverageRef. */
function extractSnippet(ref: CoverageRef): string {
    const abs = join(ROOT, ref.file);
    let src: string;
    try {
        src = readFileSync(abs, "utf8");
    } catch {
        return `// (could not read ${ref.file})`;
    }

    if (ref.lang === "ts") {
        const lines = src.split("\n");
        const line = lines[ref.line - 1] ?? "";

        // vitest-cucumber path: `// @behavior <id>` marker; walk forward to Scenario(...)
        if (TS_BEHAVIOR_COMMENT_RE.test(line)) {
            let scenarioLine = -1;
            for (let i = ref.line; i < Math.min(ref.line + 20, lines.length); i++) {
                if (/\bScenario(?:\.(?:skip|only))?\s*\(/.test(lines[i])) {
                    scenarioLine = i + 1;
                    break;
                }
            }
            if (scenarioLine < 0)
                return `// (could not find Scenario() after ${ref.file}:${ref.line})`;
            const block = extractBraceBlock(src, scenarioLine);
            if (!block) return `// (could not extract Scenario at ${ref.file}:${scenarioLine})`;
            const preamble = lines.slice(ref.line - 1, scenarioLine - 1).join("\n");
            return `${preamble}\n${lines[scenarioLine - 1]}\n${block.split("\n").slice(1).join("\n")}`;
        }

        // Legacy path: behaviorTest('id', () => { ... })
        const block = extractBraceBlock(src, ref.line);
        if (!block) return `// (could not extract block at ${ref.file}:${ref.line})`;
        return line + "\n" + block.split("\n").slice(1).join("\n");
    }

    // Rust: ref.line points at the `// behavior:` marker. Walk forward to the fn,
    // capture from the marker through the end of the fn body.
    const lines = src.split("\n");
    let fnLine = -1;
    for (let i = ref.line - 1; i < lines.length && i < ref.line - 1 + 20; i++) {
        if (/^\s*(?:pub\s+)?fn\s+\w+/.test(lines[i])) {
            fnLine = i + 1;
            break;
        }
    }
    if (fnLine < 0) return `// (could not find fn after ${ref.file}:${ref.line})`;
    const block = extractBraceBlock(src, fnLine);
    if (!block) return `// (could not extract fn body at ${ref.file}:${fnLine})`;
    const preamble = lines.slice(ref.line - 1, fnLine - 1).join("\n");
    return `${preamble}\n${lines[fnLine - 1]}\n${block.split("\n").slice(1).join("\n")}`;
}

const FEEDBACK_OPEN_RE = /<!--\s*audit:feedback\s+id=(\S+?)\s*-->/g;
const FEEDBACK_CLOSE = "<!-- /audit:feedback -->";

/** Parse existing audit.md and return a map of id → feedback body. */
function loadExistingFeedback(path: string): Record<string, string> {
    if (!existsSync(path)) return {};
    const content = readFileSync(path, "utf8");
    const out: Record<string, string> = {};
    FEEDBACK_OPEN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = FEEDBACK_OPEN_RE.exec(content)) !== null) {
        const id = m[1];
        const bodyStart = m.index + m[0].length;
        const closeIdx = content.indexOf(FEEDBACK_CLOSE, bodyStart);
        if (closeIdx < 0) continue;
        out[id] = content.slice(bodyStart, closeIdx).replace(/^\n+|\n+$/g, "");
    }
    return out;
}

function runAudit(): void {
    if (!existsSync(REGISTRY)) runParse();
    const { behaviors } = JSON.parse(readFileSync(REGISTRY, "utf8")) as {
        behaviors: Record<string, BehaviorEntry>;
    };
    const testRefs = [...scanTests(TESTS_DIR), ...scanRustTests(RUST_TESTS_DIR)];
    const refsById = new Map<string, CoverageRef[]>();
    for (const ref of testRefs) {
        if (!refsById.has(ref.id)) refsById.set(ref.id, []);
        refsById.get(ref.id)!.push(ref);
    }

    const existing = loadExistingFeedback(AUDIT_OUT);
    const ids = Object.keys(behaviors).sort();

    const covered = ids.filter((id) => (refsById.get(id)?.length ?? 0) > 0);
    const missing = ids.filter((id) => (refsById.get(id)?.length ?? 0) === 0);

    const lines: string[] = [];
    lines.push("# Behavior Audit");
    lines.push("");
    lines.push(
        "_Auto-generated by `npm run behaviors:audit`. Edit only the `<!-- audit:feedback -->` blocks; the rest is regenerated._",
    );
    lines.push("");
    lines.push(`**Coverage:** ${covered.length}/${ids.length} covered · ${missing.length} missing`);
    lines.push("");
    if (missing.length > 0) {
        lines.push("## Missing");
        lines.push("");
        for (const id of missing) {
            const e = behaviors[id];
            lines.push(`- \`${id}\` — ${e.scenario} (${e.file}:${e.line})`);
        }
        lines.push("");
    }

    lines.push("## Behaviors");
    lines.push("");

    for (const id of ids) {
        const e = behaviors[id];
        const refs = refsById.get(id) ?? [];
        lines.push(`### \`${id}\` — ${e.scenario}`);
        lines.push("");
        lines.push(`**Feature:** ${e.feature}  `);
        lines.push(`**Spec:** \`${e.file}:${e.line}\`  `);
        lines.push(
            `**Status:** ${refs.length > 0 ? `covered by ${refs.length} test(s)` : "**missing**"}`,
        );
        lines.push("");
        lines.push("**Steps:**");
        for (const step of e.steps) lines.push(`- ${step}`);
        lines.push("");
        if (e.hints && e.hints.length > 0) {
            lines.push("**Hints:**");
            for (const h of e.hints) lines.push(`- ${h}`);
            lines.push("");
        }

        for (const ref of refs) {
            const parts = [ref.lang];
            if (ref.lang === "rust" && ref.heavy) parts.push("heavy");
            if (ref.skipped) parts.push("skipped");
            const tag = " · " + parts.join(" · ");
            const lang = ref.lang === "rust" ? "rust" : "ts";
            lines.push(`#### \`${ref.file}:${ref.line}\`${tag}`);
            lines.push("");
            lines.push("```" + lang);
            lines.push(extractSnippet(ref).trimEnd());
            lines.push("```");
            lines.push("");
        }

        lines.push(`<!-- audit:feedback id=${id} -->`);
        lines.push(existing[id] ?? "_No feedback yet._");
        lines.push(FEEDBACK_CLOSE);
        lines.push("");
        lines.push("---");
        lines.push("");
    }

    mkdirSync(GENERATED, { recursive: true });
    writeFileSync(AUDIT_OUT, lines.join("\n"));

    const rel = relative(ROOT, AUDIT_OUT).replace(/\\/g, "/");
    const preserved = Object.keys(existing).length;
    console.log(`Wrote ${ids.length} behaviors → ${rel}`);
    console.log(
        `  covered: ${covered.length} · missing: ${missing.length} · feedback preserved: ${preserved}`,
    );
}

// ─── dispatch ─────────────────────────────────────────────────────────────────

if (cmd === "parse") {
    runParse();
} else if (cmd === "coverage") {
    const ok = runCoverage();
    process.exit(ok ? 0 : 1);
} else if (cmd === "check") {
    runParse();
    const ok = runCoverage();
    process.exit(ok ? 0 : 1);
} else if (cmd === "audit") {
    runAudit();
}
