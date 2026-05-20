#!/usr/bin/env tsx
"use strict";
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
var __spreadArray =
    (this && this.__spreadArray) ||
    function (to, from, pack) {
        if (pack || arguments.length === 2)
            for (var i = 0, l = from.length, ar; i < l; i++) {
                if (ar || !(i in from)) {
                    if (!ar) ar = Array.prototype.slice.call(from, 0, i);
                    ar[i] = from[i];
                }
            }
        return to.concat(ar || Array.prototype.slice.call(from));
    };
Object.defineProperty(exports, "__esModule", { value: true });
var node_fs_1 = require("node:fs");
var node_crypto_1 = require("node:crypto");
var node_path_1 = require("node:path");
var node_url_1 = require("node:url");
var ROOT = (0, node_path_1.resolve)((0, node_url_1.fileURLToPath)(import.meta.url), "..", "..");
var FEATURES_DIR = (0, node_path_1.join)(ROOT, "spec", "features");
var TESTS_DIR = (0, node_path_1.join)(ROOT, "tests");
var GENERATED = (0, node_path_1.join)(ROOT, "spec", "generated");
var REGISTRY = (0, node_path_1.join)(GENERATED, "behavior-registry.json");
var COVERAGE_OUT = (0, node_path_1.join)(GENERATED, "coverage.json");
var args = process.argv.slice(2);
var cmd = args.find(function (a) {
    return !a.startsWith("-");
});
var NO_COLOR = args.includes("--no-color") || !process.stdout.isTTY;
if (!cmd || !["parse", "coverage", "check"].includes(cmd)) {
    console.error("Usage: tsx scripts/behavior.ts <parse|coverage|check> [--no-color]");
    process.exit(1);
}
// ─── color helpers ────────────────────────────────────────────────────────────
var c = {
    reset: function (s) {
        return NO_COLOR ? s : "\u001B[0m".concat(s, "\u001B[0m");
    },
    bold: function (s) {
        return NO_COLOR ? s : "\u001B[1m".concat(s, "\u001B[0m");
    },
    dim: function (s) {
        return NO_COLOR ? s : "\u001B[2m".concat(s, "\u001B[0m");
    },
    green: function (s) {
        return NO_COLOR ? s : "\u001B[32m".concat(s, "\u001B[0m");
    },
    red: function (s) {
        return NO_COLOR ? s : "\u001B[31m".concat(s, "\u001B[0m");
    },
    yellow: function (s) {
        return NO_COLOR ? s : "\u001B[33m".concat(s, "\u001B[0m");
    },
    cyan: function (s) {
        return NO_COLOR ? s : "\u001B[36m".concat(s, "\u001B[0m");
    },
    gray: function (s) {
        return NO_COLOR ? s : "\u001B[90m".concat(s, "\u001B[0m");
    },
};
// ─── shared helpers ───────────────────────────────────────────────────────────
function toSlug(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
function normalizeSteps(lines) {
    return lines
        .map(function (l) {
            return l.replace(/^\s*(Given|When|Then|And|But)\s*:?\s+/i, "").trim();
        })
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function shortHash(text) {
    return (0, node_crypto_1.createHash)("sha256").update(text, "utf8").digest("hex").slice(0, 8);
}
var FEATURE_RE = /^\s*Feature\s*:/i;
var SCENARIO_RE = /^\s*Scenario(\s+Outline)?\s*:/i;
var STEP_RE = /^\s*(Given|When|Then|And|But)\s*:?\s+/i;
var EXAMPLES_RE = /^\s*Examples\s*:/i;
function parseFeatureFile(content, relPath) {
    var lines = content.split("\n");
    var behaviors = {};
    var featureTitle = "";
    var scenarioTitle = "";
    var scenarioLine = 0;
    var isOutline = false;
    var steps = [];
    var inExamples = false;
    var exampleRows = [];
    var flush = function () {
        if (!scenarioTitle || steps.length === 0) return;
        var hashInput = __spreadArray(
            [scenarioTitle.toLowerCase().trim(), normalizeSteps(steps)],
            exampleRows,
            true,
        ).join("\n");
        var id = "".concat(toSlug(featureTitle), "::").concat(shortHash(hashInput));
        if (behaviors[id])
            console.warn("  WARN: ID collision in ".concat(relPath, ": ").concat(id));
        behaviors[id] = {
            feature: featureTitle,
            scenario: scenarioTitle,
            isOutline: isOutline,
            steps: steps.map(function (s) {
                return s.trim();
            }),
            file: relPath,
            line: scenarioLine,
        };
        steps = [];
        scenarioTitle = "";
        isOutline = false;
        inExamples = false;
        exampleRows = [];
    };
    for (var _i = 0, _a = lines.entries(); _i < _a.length; _i++) {
        var _b = _a[_i],
            i = _b[0],
            raw = _b[1];
        var t = raw.trim();
        if (FEATURE_RE.test(t)) {
            featureTitle = t.replace(/^Feature\s*:\s*/i, "").trim();
            continue;
        }
        if (SCENARIO_RE.test(t)) {
            flush();
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
function findFiles(dir, ext, out) {
    if (out === void 0) {
        out = [];
    }
    for (
        var _i = 0, _a = (0, node_fs_1.readdirSync)(dir, { withFileTypes: true });
        _i < _a.length;
        _i++
    ) {
        var entry = _a[_i];
        var full = (0, node_path_1.join)(dir, entry.name);
        if (entry.isDirectory()) findFiles(full, ext, out);
        else if (entry.name.endsWith(ext)) out.push(full);
    }
    return out;
}
function runParse() {
    var all = {};
    var collisions = 0;
    for (var _i = 0, _a = findFiles(FEATURES_DIR, ".feature"); _i < _a.length; _i++) {
        var file = _a[_i];
        var content = (0, node_fs_1.readFileSync)(file, "utf8");
        var rel = (0, node_path_1.relative)(ROOT, file).replace(/\\/g, "/");
        for (
            var _b = 0, _c = Object.entries(parseFeatureFile(content, rel));
            _b < _c.length;
            _b++
        ) {
            var _d = _c[_b],
                id = _d[0],
                entry = _d[1];
            if (all[id]) {
                console.warn("WARN: cross-file collision: ".concat(id));
                collisions++;
            }
            all[id] = entry;
        }
    }
    (0, node_fs_1.mkdirSync)(GENERATED, { recursive: true });
    (0, node_fs_1.writeFileSync)(REGISTRY, JSON.stringify({ behaviors: all }, null, 2) + "\n");
    var count = Object.keys(all).length;
    var outRel = (0, node_path_1.relative)(ROOT, REGISTRY).replace(/\\/g, "/");
    console.log(
        "\n".concat(c.bold("Wrote ".concat(count, " behavior").concat(count !== 1 ? "s" : ""))) +
            " ".concat(c.gray("→"), " ").concat(c.cyan(outRel), "\n"),
    );
    for (var _e = 0, _f = Object.entries(all); _e < _f.length; _e++) {
        var _g = _f[_e],
            id = _g[0],
            e = _g[1];
        var tag = e.isOutline ? c.gray(" [outline]") : "";
        console.log("  ".concat(c.cyan(id)).concat(tag));
        console.log("  ".concat(c.gray(e.scenario)));
    }
    if (collisions > 0) {
        console.error(c.red("\n".concat(collisions, " ID collision(s).")));
        process.exit(1);
    }
}
var CALL_RE = /behaviorTest\(\s*['"]([^'"]+)['"]/g;
function scanTests(dir) {
    var refs = [];
    var _loop_1 = function (file) {
        var rel = (0, node_path_1.relative)(ROOT, file).replace(/\\/g, "/");
        var lines = (0, node_fs_1.readFileSync)(file, "utf8").split("\n");
        lines.forEach(function (text, i) {
            CALL_RE.lastIndex = 0;
            var m;
            while ((m = CALL_RE.exec(text)) !== null)
                refs.push({ id: m[1], file: rel, line: i + 1 });
        });
    };
    for (var _i = 0, _a = findFiles(dir, ".test.ts"); _i < _a.length; _i++) {
        var file = _a[_i];
        _loop_1(file);
    }
    return refs;
}
function runCoverage(print) {
    if (print === void 0) {
        print = true;
    }
    if (!(0, node_fs_1.existsSync)(REGISTRY)) {
        console.error("Registry not found. Run: tsx scripts/behavior.ts parse");
        process.exit(1);
    }
    var behaviors = JSON.parse((0, node_fs_1.readFileSync)(REGISTRY, "utf8")).behaviors;
    var expectedIds = new Set(Object.keys(behaviors));
    var testRefs = scanTests(TESTS_DIR);
    var coverage = new Map(
        __spreadArray([], expectedIds, true).map(function (id) {
            return [id, []];
        }),
    );
    for (var _i = 0, testRefs_1 = testRefs; _i < testRefs_1.length; _i++) {
        var ref = testRefs_1[_i];
        if (coverage.has(ref.id)) coverage.get(ref.id).push(ref);
    }
    var missing = __spreadArray([], expectedIds, true).filter(function (id) {
        return coverage.get(id).length === 0;
    });
    var orphans = testRefs.filter(function (ref) {
        return !expectedIds.has(ref.id);
    });
    var covered = __spreadArray([], expectedIds, true).filter(function (id) {
        return coverage.get(id).length > 0;
    });
    var pct = expectedIds.size === 0 ? 100 : Math.round((covered.length / expectedIds.size) * 100);
    var result = {
        total: expectedIds.size,
        covered: covered.length,
        percentage: pct,
        missing: missing,
        orphans: orphans,
    };
    (0, node_fs_1.mkdirSync)(GENERATED, { recursive: true });
    (0, node_fs_1.writeFileSync)(COVERAGE_OUT, JSON.stringify(result, null, 2) + "\n");
    if (!print) return missing.length === 0 && orphans.length === 0;
    var W = 72;
    var heavy = "━".repeat(W);
    var light = "─".repeat(W);
    console.log(
        "\n"
            .concat(c.bold(heavy), "\n  ")
            .concat(c.bold("BEHAVIOR COVERAGE"), "\n")
            .concat(c.bold(heavy), "\n"),
    );
    console.log(
        ""
            .concat(
                c.bold("COVERED  (".concat(covered.length, "/").concat(expectedIds.size, ")")),
                "\n",
            )
            .concat(c.gray(light)),
    );
    for (var _a = 0, covered_1 = covered; _a < covered_1.length; _a++) {
        var id = covered_1[_a];
        console.log("  ".concat(c.green("✓"), " ").concat(c.cyan(id)));
        console.log("    ".concat(c.gray(behaviors[id].scenario)));
        for (var _b = 0, _c = coverage.get(id); _b < _c.length; _b++) {
            var ref = _c[_b];
            console.log("    ".concat(c.gray("→"), " ").concat(ref.file, ":").concat(ref.line));
        }
    }
    console.log(
        "\n".concat(c.bold("MISSING  (".concat(missing.length, ")")), "\n").concat(c.gray(light)),
    );
    if (missing.length === 0) {
        console.log(c.gray("  (none)"));
    } else {
        for (var _d = 0, missing_1 = missing; _d < missing_1.length; _d++) {
            var id = missing_1[_d];
            console.log("  ".concat(c.red("✗"), " ").concat(c.red(id)));
            console.log("    ".concat(c.gray(behaviors[id].scenario)));
            console.log(
                "    "
                    .concat(c.gray("spec:"), " ")
                    .concat(behaviors[id].file, ":")
                    .concat(behaviors[id].line),
            );
        }
    }
    console.log(
        "\n"
            .concat(c.bold("ORPHANED REFS  (".concat(orphans.length, ")")), "\n")
            .concat(c.gray(light)),
    );
    if (orphans.length === 0) {
        console.log(c.gray("  (none)"));
    } else {
        for (var _e = 0, orphans_1 = orphans; _e < orphans_1.length; _e++) {
            var ref = orphans_1[_e];
            console.log("  ".concat(c.yellow("?"), " ").concat(c.yellow(ref.id)));
            console.log("    ".concat(ref.file, ":").concat(ref.line));
        }
    }
    var pctColor = pct === 100 ? c.green : pct >= 80 ? c.yellow : c.red;
    var summary = "Coverage: "
        .concat(covered.length, "/")
        .concat(expectedIds.size, " (")
        .concat(pct, "%)  |  ")
        .concat(orphans.length, " orphaned ref(s)");
    console.log(
        "\n"
            .concat(c.bold(heavy), "\n  ")
            .concat(pctColor(c.bold(summary)), "\n")
            .concat(c.bold(heavy), "\n"),
    );
    return missing.length === 0 && orphans.length === 0;
}
// ─── dispatch ─────────────────────────────────────────────────────────────────
if (cmd === "parse") {
    runParse();
} else if (cmd === "coverage") {
    var ok = runCoverage();
    process.exit(ok ? 0 : 1);
} else if (cmd === "check") {
    runParse();
    var ok = runCoverage();
    process.exit(ok ? 0 : 1);
}
