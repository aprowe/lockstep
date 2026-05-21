/**
 * Constraint-pipeline regression benchmarks.
 *
 * Driven through the production drag thunks — each bench iteration is one
 * `drag(δ)` dispatch on a pre-built scene with the active drag already begun.
 * Setup runs once at module load (NOT inside the measured iteration).
 *
 * The pipeline is slow enough that the default time-based vitest budget
 * (500 ms / bench) gets too few samples at N≥25. Every bench overrides to a
 * fixed iteration count so the sample size is predictable per cell.
 *
 * Run:
 *   npm run bench                 # all bench files
 *   npm run bench -- --reporter=json --outputFile=bench.json
 *
 * Regression-detection workflow:
 *   git checkout main && npm run bench -- --outputJson=baseline.json
 *   git checkout <branch> && npm run bench -- --outputJson=current.json
 *   <diff the two JSON files; meaningful changes show up as >10% drift>
 */

import { bench, describe } from "vitest";

import { beginDrag, drag as dragThunk } from "../../src/store/thunks/dragThunks";
import { ALL_GESTURES, buildScene, configureForGesture, type Gesture } from "./scenarios";

// Sizes picked so the full suite finishes in a CI-acceptable window. At N=25
// each drag frame already costs hundreds of ms — N=100+ would push the suite
// into multiple minutes. Use scripts/bench-constraints.ts for larger sweeps.
const SIZES = [10, 25] as const;
const SEED = 0xc0ffee;
const ITERATIONS = 8;
const WARMUP_ITERATIONS = 2;

interface ActiveDrag {
    dispatch: ReturnType<typeof buildScene>["store"]["dispatch"];
    amplitude: number;
    frame: number;
}

function startDrag(n: number, gesture: Gesture): ActiveDrag {
    const scene = buildScene(n, SEED);
    const cfg = configureForGesture(scene, gesture);
    scene.store.dispatch(beginDrag({ handle: cfg.handle, pxPerUnit: 30 }) as never);
    return { dispatch: scene.store.dispatch, amplitude: cfg.amplitude, frame: 0 };
}

function step(state: ActiveDrag): void {
    const phase = ((state.frame++ % 60) / 60) * 2 * Math.PI;
    const delta = Math.sin(phase) * state.amplitude;
    state.dispatch(dragThunk({ delta, modifiers: { alt: false } }) as never);
}

for (const n of SIZES) {
    describe(`constraint pipeline N=${n}`, () => {
        for (const gesture of ALL_GESTURES) {
            // Pre-build the scene + start the drag at module load. Each bench
            // iteration measures exactly one drag(δ) dispatch.
            const state = startDrag(n, gesture as Gesture);

            bench(
                gesture,
                () => {
                    step(state);
                },
                {
                    iterations: ITERATIONS,
                    warmupIterations: WARMUP_ITERATIONS,
                    // Disable time-based budget — the iterations option is the
                    // real bound. (tinybench still respects iterations as a
                    // floor when time runs out.)
                    time: 0,
                    warmupTime: 0,
                    // NOTE: do NOT put endDrag in teardown. tinybench runs
                    // teardown after BOTH the warmup phase and the run phase,
                    // so clearing the active drag between them turns every
                    // measured iteration into a no-op (drag thunk returns
                    // early when gesture.activeHandle is null). Stores are
                    // per-bench and get garbage-collected when the worker
                    // exits — no cleanup needed.
                },
            );
        }
    });
}
