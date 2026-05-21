#!/usr/bin/env tsx
/**
 * scripts/bench-constraints.ts
 *
 * Constraint-pipeline microbenchmark — matrix sweep across size × gesture
 * using tinybench for statistics.
 *
 * Drives the production drag thunks (beginDrag → drag(δ) × iterations →
 * endDrag) directly so the numbers reflect pipeline cost without controller
 * / snapshot / hit-test noise. Each cell in the matrix is a separate
 * tinybench task with its own scene + active drag set up in `beforeAll`.
 *
 * For regression-gating a fixed set of scenarios in CI, use `vitest bench`
 * against tests/bench/constraints.bench.ts instead.
 *
 * Usage:
 *   npx tsx scripts/bench-constraints.ts
 *   npx tsx scripts/bench-constraints.ts --sizes=5,10,20
 *   npx tsx scripts/bench-constraints.ts --gestures=anchor,group-pan
 *   npx tsx scripts/bench-constraints.ts --iterations=20 --warmup=3
 *   npx tsx scripts/bench-constraints.ts --json
 */

import { Bench, type Task } from "tinybench";

import { beginDrag, drag as dragThunk, endDrag } from "../src/store/thunks/dragThunks";
import {
    ALL_GESTURES,
    buildScene,
    configureForGesture,
    type Gesture,
} from "../tests/bench/scenarios";

// ─── CLI ─────────────────────────────────────────────────────────────────────

interface Cli {
    sizes: number[];
    gestures: Gesture[];
    iterations: number;
    warmupIterations: number;
    json: boolean;
    seed: number;
}

function parseCli(): Cli {
    const args = process.argv.slice(2);
    const get = (name: string): string | undefined => {
        const a = args.find((x) => x.startsWith(`--${name}=`));
        return a ? a.split("=").slice(1).join("=") : undefined;
    };
    const gestures = (get("gestures")
        ?.split(",")
        .map((s) => s.trim())
        .filter((s) => (ALL_GESTURES as readonly string[]).includes(s)) ??
        ALL_GESTURES) as Gesture[];
    return {
        sizes:
            get("sizes")
                ?.split(",")
                .map((s) => Number(s.trim()))
                .filter((n) => Number.isFinite(n) && n > 0) ?? [10, 25, 50, 100],
        gestures,
        iterations: Number(get("iterations") ?? 10),
        warmupIterations: Number(get("warmup") ?? 2),
        json: args.includes("--json"),
        seed: Number(get("seed") ?? 0xc0ffee),
    };
}

// ─── Task setup ──────────────────────────────────────────────────────────────

interface ActiveDrag {
    dispatch: ReturnType<typeof buildScene>["store"]["dispatch"];
    amplitude: number;
    frame: number;
}

function startDrag(n: number, gesture: Gesture, seed: number): ActiveDrag {
    const scene = buildScene(n, seed);
    const cfg = configureForGesture(scene, gesture);
    scene.store.dispatch(beginDrag({ handle: cfg.handle, pxPerUnit: 30 }) as never);
    return { dispatch: scene.store.dispatch, amplitude: cfg.amplitude, frame: 0 };
}

function step(state: ActiveDrag): void {
    const phase = ((state.frame++ % 60) / 60) * 2 * Math.PI;
    const delta = Math.sin(phase) * state.amplitude;
    state.dispatch(dragThunk({ delta, modifiers: { alt: false } }) as never);
}

function taskName(n: number, gesture: Gesture): string {
    return `${gesture}@n=${n}`;
}

function parseTaskName(name: string): { gesture: Gesture; size: number } {
    const [gesture, rest] = name.split("@n=");
    return { gesture: gesture as Gesture, size: Number(rest) };
}

// ─── Reporting ───────────────────────────────────────────────────────────────

function fmt(ms: number, width = 8): string {
    if (!Number.isFinite(ms)) return "-".padStart(width);
    return ms.toFixed(3).padStart(width);
}

function printTable(tasks: Task[]): void {
    const headers = [
        "gesture".padEnd(20),
        "size".padStart(6),
        "samples".padStart(7),
        "mean_ms".padStart(8),
        "p75_ms".padStart(8),
        "p99_ms".padStart(8),
        "min_ms".padStart(8),
        "max_ms".padStart(8),
        "rme_%".padStart(8),
        "hz".padStart(10),
    ];
    console.log(headers.join("  "));
    console.log(headers.map((h) => "-".repeat(h.length)).join("  "));
    // Sort by (gesture order in ALL_GESTURES, then size).
    const order = new Map(ALL_GESTURES.map((g, i) => [g, i]));
    const sorted = [...tasks].sort((a, b) => {
        const ap = parseTaskName(a.name);
        const bp = parseTaskName(b.name);
        const ga = order.get(ap.gesture) ?? 99;
        const gb = order.get(bp.gesture) ?? 99;
        return ga !== gb ? ga - gb : ap.size - bp.size;
    });
    for (const task of sorted) {
        const { gesture, size } = parseTaskName(task.name);
        const r = task.result;
        if (!r) {
            console.log(`${gesture.padEnd(20)}  ${String(size).padStart(6)}   (no result)`);
            continue;
        }
        console.log(
            [
                gesture.padEnd(20),
                String(size).padStart(6),
                String(r.samples.length).padStart(7),
                fmt(r.mean),
                fmt(r.p75),
                fmt(r.p99),
                fmt(r.min),
                fmt(r.max),
                fmt(r.rme),
                (Number.isFinite(r.hz) ? r.hz.toFixed(1) : "-").padStart(10),
            ].join("  "),
        );
    }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const cli = parseCli();
    if (!cli.json) {
        console.log(
            `bench-constraints: sizes=[${cli.sizes.join(",")}] gestures=[${cli.gestures.join(",")}] iterations=${cli.iterations} warmup=${cli.warmupIterations} seed=${cli.seed}`,
        );
        console.log("");
    }

    const bench = new Bench({
        iterations: cli.iterations,
        warmupIterations: cli.warmupIterations,
        // Disable time-based budget — only the iteration count controls run length.
        time: 0,
        warmupTime: 0,
    });

    for (const gesture of cli.gestures) {
        for (const n of cli.sizes) {
            let state: ActiveDrag | null = null;
            bench.add(
                taskName(n, gesture),
                () => {
                    step(state!);
                },
                {
                    beforeAll() {
                        state = startDrag(n, gesture, cli.seed);
                    },
                    afterAll() {
                        state?.dispatch(endDrag() as never);
                        state = null;
                    },
                },
            );
        }
    }

    if (!cli.json) {
        // Live progress on stderr; doesn't clutter the JSON output path.
        bench.addEventListener("cycle", (e) => {
            const ev = e as Event & { task: Task };
            const r = ev.task.result;
            if (!r) return;
            process.stderr.write(
                `  ${ev.task.name.padEnd(28)}  mean=${r.mean.toFixed(2)}ms  rme=±${r.rme.toFixed(2)}%  samples=${r.samples.length}\n`,
            );
        });
    }

    await bench.run();

    if (cli.json) {
        const payload = bench.tasks.map((t) => ({
            name: t.name,
            ...parseTaskName(t.name),
            result: t.result,
        }));
        process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    } else {
        console.log("");
        printTable(bench.tasks);
    }

    // Persistence middleware schedules 500ms debounced sidecar writes that
    // never resolve (the listener calls a Tauri command). Force exit so
    // dangling timers don't keep the process alive.
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
