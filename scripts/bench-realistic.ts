#!/usr/bin/env tsx
/**
 * scripts/bench-realistic.ts
 *
 * Constraint-pipeline bench at the user's actual target workload:
 *   1000 scenes × 100 anchors × 10 regions
 *
 * Scenes are pure snap targets — they don't move. The square N×N×N bench
 * in scripts/bench-constraints.ts is dominated by conform tuples (which
 * grow as R·A), so it doesn't surface bottlenecks that only matter in
 * skewed ratios — most importantly, snap-target enumeration cost when
 * the project has lots of scenes.
 *
 * Usage:
 *   npx tsx scripts/bench-realistic.ts
 *   npx tsx scripts/bench-realistic.ts --regions=10 --anchors=100 --scenes=1000
 *   npx tsx scripts/bench-realistic.ts --iterations=20
 */

import { Bench, type Task } from "tinybench";

import { beginDrag, drag as dragThunk, endDrag } from "../src/store/thunks/dragThunks";
import {
    ALL_GESTURES,
    buildScene,
    configureForGesture,
    type Gesture,
    type SceneCounts,
} from "../tests/bench/scenarios";

interface Cli {
    counts: SceneCounts;
    iterations: number;
    warmupIterations: number;
    seed: number;
    gestures: readonly Gesture[];
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
        .filter((s) => (ALL_GESTURES as readonly string[]).includes(s)) ?? ALL_GESTURES) as Gesture[];
    return {
        counts: {
            regions: Number(get("regions") ?? 10),
            anchors: Number(get("anchors") ?? 100),
            scenes: Number(get("scenes") ?? 1000),
        },
        iterations: Number(get("iterations") ?? 15),
        warmupIterations: Number(get("warmup") ?? 3),
        seed: Number(get("seed") ?? 0xc0ffee),
        gestures,
    };
}

interface ActiveDrag {
    dispatch: ReturnType<typeof buildScene>["store"]["dispatch"];
    amplitude: number;
    frame: number;
}

function startDrag(counts: SceneCounts, gesture: Gesture, seed: number): ActiveDrag {
    const scene = buildScene(counts, seed);
    const cfg = configureForGesture(scene, gesture);
    scene.store.dispatch(beginDrag({ handle: cfg.handle, pxPerUnit: 30 }) as never);
    return { dispatch: scene.store.dispatch, amplitude: cfg.amplitude, frame: 0 };
}

function step(state: ActiveDrag): void {
    const phase = ((state.frame++ % 60) / 60) * 2 * Math.PI;
    const delta = Math.sin(phase) * state.amplitude;
    state.dispatch(dragThunk({ delta, modifiers: { alt: false } }) as never);
}

function fmt(ms: number, width = 8): string {
    if (!Number.isFinite(ms)) return "-".padStart(width);
    return ms.toFixed(3).padStart(width);
}

async function main(): Promise<void> {
    const cli = parseCli();
    console.log(
        `bench-realistic: regions=${cli.counts.regions} anchors=${cli.counts.anchors} scenes=${cli.counts.scenes} iterations=${cli.iterations} warmup=${cli.warmupIterations}`,
    );
    console.log("");

    const bench = new Bench({
        iterations: cli.iterations,
        warmupIterations: cli.warmupIterations,
        time: 0,
        warmupTime: 0,
    });

    for (const gesture of cli.gestures) {
        let state: ActiveDrag | null = null;
        bench.add(
            gesture,
            () => {
                step(state!);
            },
            {
                beforeAll() {
                    state = startDrag(cli.counts, gesture, cli.seed);
                },
                afterAll() {
                    state?.dispatch(endDrag() as never);
                    state = null;
                },
            },
        );
    }

    bench.addEventListener("cycle", (e) => {
        const ev = e as Event & { task: Task };
        const r = ev.task.result;
        if (!r) return;
        process.stderr.write(
            `  ${ev.task.name.padEnd(22)}  mean=${r.mean.toFixed(2)}ms  rme=±${r.rme.toFixed(2)}%  samples=${r.samples.length}\n`,
        );
    });

    await bench.run();

    console.log("");
    const headers = [
        "gesture".padEnd(22),
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
    for (const task of bench.tasks) {
        const r = task.result;
        if (!r) {
            console.log(`${task.name.padEnd(22)}  (no result)`);
            continue;
        }
        console.log(
            [
                task.name.padEnd(22),
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

    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
