import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type SceneStatus = "idle" | "analyzing" | "done" | "cancelled" | "error";

/** A merged, sorted, half-open range of source-time we've actually scanned
 *  for cuts. The visual indicator on the scene track reads this directly. */
export interface ScannedRange {
    start: number;
    end: number;
}

interface SceneState {
    /** Detected cut times (seconds) per video path — what ffmpeg's scdet
     *  produced. Subject to the user's min-gap filter at display time. */
    cutsByPath: Record<string, number[]>;
    /** User-placed cut times per video path. These bypass the min-gap
     *  filter — if the user explicitly dropped a cut there, the UI must
     *  honor it regardless of how dense the surrounding detected cuts are.
     *  Persisted alongside `cutsByPath`. */
    userCutsByPath: Record<string, number[]>;
    /** Source-time ranges we've actually run the detector over. Each `setCuts`
     *  merges its scanned window in; the visual on the scene track reads this
     *  directly so the user can tell at a glance which slices have been
     *  analysed and which haven't. Sorted, non-overlapping. A sentinel
     *  `Infinity` end marks "open-ended through the file" so the slice doesn't
     *  need to know per-video duration. */
    scannedRangesByPath: Record<string, ScannedRange[]>;
    /** The window the active scan is sweeping through. Set on `startDetection`
     *  (Infinity end for full-file scans), cleared on done/cancel/error. The
     *  scene track combines this with `progressByPath` to grow the "scanned"
     *  tint live as ffmpeg advances, instead of waiting for completion. */
    scanWindowByPath: Record<string, ScannedRange>;
    /** Per-path detection status. */
    statusByPath: Record<string, SceneStatus>;
    /** Per-path progress fraction 0..1. */
    progressByPath: Record<string, number>;
    /** Per-path error message. */
    errorByPath: Record<string, string>;
    /** Active detection job id per path (used to ignore stale events). */
    jobByPath: Record<string, string>;
    /** Per-video scdet threshold override. Higher = fewer cuts. */
    thresholdByPath: Record<string, number>;
    /** Per-video min seconds between consecutive cuts. 0 disables. Collapses dense clusters in the UI. */
    minGapByPath: Record<string, number>;
    /** Currently-selected scene cut times (seconds). Identified by exact time
     *  rather than index because cuts can be added/removed underneath the
     *  selection — matching by time keeps the survivors stable. */
    selectedCutTimes: number[];
}

const initialState: SceneState = {
    cutsByPath: {},
    userCutsByPath: {},
    scannedRangesByPath: {},
    scanWindowByPath: {},
    statusByPath: {},
    progressByPath: {},
    errorByPath: {},
    jobByPath: {},
    thresholdByPath: {},
    minGapByPath: {},
    selectedCutTimes: [],
};

/** Insert `range` into a sorted, non-overlapping list and merge any ranges
 *  it touches. Returns a new array; safe to call from Immer reducers (they
 *  swap the slot rather than mutating in place). Treats touching ranges
 *  (a.end === b.start) as overlapping so back-to-back scans collapse. */
function mergeIntoRanges(list: ScannedRange[], range: ScannedRange): ScannedRange[] {
    if (range.end <= range.start) return list;
    const merged: ScannedRange[] = [];
    let current = { ...range };
    for (const r of list) {
        if (r.end < current.start) {
            merged.push(r);
        } else if (r.start > current.end) {
            merged.push(current);
            current = { ...r };
        } else {
            current = {
                start: Math.min(current.start, r.start),
                end: Math.max(current.end, r.end),
            };
        }
    }
    merged.push(current);
    return merged;
}

/** Insert `t` into a sorted number[] in place (Immer-safe), deduped within
 *  1ms to absorb float drift. Returns true when the array changed. */
function insertSorted(list: number[], t: number): boolean {
    if (list.some((existing) => Math.abs(existing - t) < 1e-3)) return false;
    let i = 0;
    while (i < list.length && list[i] < t) i += 1;
    list.splice(i, 0, t);
    return true;
}

const sceneSlice = createSlice({
    name: "scene",
    initialState,
    reducers: {
        startDetection(
            state,
            action: PayloadAction<{
                path: string;
                jobId: string;
                threshold: number;
                /** When set, the scan only covers this source-time range. The slice
                 *  preserves cuts outside the window so a partial rescan doesn't
                 *  destroy work elsewhere on the timeline. */
                window?: { start: number; end: number };
            }>,
        ) {
            const { path, jobId, threshold, window } = action.payload;
            state.statusByPath[path] = "analyzing";
            state.progressByPath[path] = 0;
            state.jobByPath[path] = jobId;
            state.thresholdByPath[path] = threshold;
            state.scanWindowByPath[path] = window
                ? { start: window.start, end: window.end }
                : { start: 0, end: Number.POSITIVE_INFINITY };
            // Clear stale cuts so streaming results don't mingle with a previous
            // run. With a window, only drop cuts inside that range.
            const existing = state.cutsByPath[path] ?? [];
            if (window) {
                state.cutsByPath[path] = existing.filter((t) => t < window.start || t > window.end);
            } else {
                state.cutsByPath[path] = [];
            }
            delete state.errorByPath[path];
        },
        setProgress(state, action: PayloadAction<{ path: string; progress: number }>) {
            const { path, progress } = action.payload;
            state.progressByPath[path] = progress;
            // Flip to 'analyzing' in case a progress event arrives before startDetection.
            const s = state.statusByPath[path];
            if (s !== "done" && s !== "error") state.statusByPath[path] = "analyzing";
        },
        setCuts(
            state,
            action: PayloadAction<{
                path: string;
                cuts: number[];
                /** When set, only the slice of cuts inside this source-time range is
                 *  replaced; cuts outside it survive untouched. Mirrors the scoped
                 *  scan ffmpeg actually ran. */
                window?: { start: number; end: number };
                /** The range that was actually scanned. Equals `window` for a scoped
                 *  scan; for a full-file scan the listener fills in `{0, duration}`
                 *  (or uses `Infinity` when duration isn't known yet). Drives the
                 *  "scanned" indicator on the scene track. */
                scannedRange?: ScannedRange;
            }>,
        ) {
            const { path, cuts, window, scannedRange } = action.payload;
            if (window) {
                const outside = (state.cutsByPath[path] ?? []).filter(
                    (t) => t < window.start || t > window.end,
                );
                const merged = [...outside, ...cuts].sort((a, b) => a - b);
                // Dedup within 1ms of each other to absorb float drift between
                // surviving and freshly-detected cuts at the window boundary.
                const deduped: number[] = [];
                for (const t of merged) {
                    if (deduped.length === 0 || Math.abs(deduped[deduped.length - 1] - t) >= 1e-3) {
                        deduped.push(t);
                    }
                }
                state.cutsByPath[path] = deduped;
            } else {
                state.cutsByPath[path] = cuts;
            }
            if (scannedRange) {
                state.scannedRangesByPath[path] = mergeIntoRanges(
                    state.scannedRangesByPath[path] ?? [],
                    scannedRange,
                );
            }
            state.statusByPath[path] = "done";
            state.progressByPath[path] = 1;
            delete state.scanWindowByPath[path];
        },
        /** Append a single streaming cut as ffmpeg discovers it. Keeps the list sorted. */
        appendCut(state, action: PayloadAction<{ path: string; cut: number }>) {
            const { path, cut } = action.payload;
            const list = state.cutsByPath[path] ?? [];
            // Dedup within 1ms of an existing cut.
            if (list.some((t) => Math.abs(t - cut) < 1e-3)) return;
            // Insert in sorted position.
            let i = 0;
            while (i < list.length && list[i] < cut) i += 1;
            state.cutsByPath[path] = [...list.slice(0, i), cut, ...list.slice(i)];
            const s = state.statusByPath[path];
            if (s !== "done" && s !== "error") state.statusByPath[path] = "analyzing";
        },
        setError(state, action: PayloadAction<{ path: string; error: string }>) {
            state.statusByPath[action.payload.path] = "error";
            state.errorByPath[action.payload.path] = action.payload.error;
            delete state.scanWindowByPath[action.payload.path];
        },
        /** Flagged when the user aborts an in-flight detection. Keeps whatever
         *  cuts were streamed so far so the user doesn't lose partial progress. */
        setCancelled(state, action: PayloadAction<{ path: string }>) {
            const { path } = action.payload;
            state.statusByPath[path] = "cancelled";
            state.progressByPath[path] = 0;
            delete state.errorByPath[path];
            delete state.scanWindowByPath[path];
        },
        loadCached(
            state,
            action: PayloadAction<{
                path: string;
                cuts: number[];
                threshold: number;
                userCuts?: number[];
            }>,
        ) {
            const { path, cuts, threshold, userCuts } = action.payload;
            state.cutsByPath[path] = cuts;
            if (userCuts && userCuts.length > 0) state.userCutsByPath[path] = userCuts;
            // We don't track per-scan windows in the on-disk cache, so a cached
            // load is treated as a full-file scan. The visualisation clamps the
            // Infinity end against the loaded video's duration.
            state.scannedRangesByPath[path] = [{ start: 0, end: Number.POSITIVE_INFINITY }];
            state.statusByPath[path] = "done";
            state.progressByPath[path] = 1;
            state.thresholdByPath[path] = threshold;
            delete state.errorByPath[path];
            delete state.jobByPath[path];
        },
        clearForPath(state, action: PayloadAction<string>) {
            const path = action.payload;
            delete state.cutsByPath[path];
            delete state.userCutsByPath[path];
            delete state.scannedRangesByPath[path];
            delete state.scanWindowByPath[path];
            delete state.statusByPath[path];
            delete state.progressByPath[path];
            delete state.errorByPath[path];
            delete state.jobByPath[path];
        },
        setMinGap(state, action: PayloadAction<{ path: string; minGap: number }>) {
            const { path, minGap } = action.payload;
            state.minGapByPath[path] = Math.max(0, minGap);
        },
        /** User-added cut — written to `userCutsByPath` so it bypasses the
         *  min-gap filter that detected cuts are subject to. Skipped if the
         *  same time is already a detected cut (no point shadowing it). */
        addCut(state, action: PayloadAction<{ path: string; cut: number }>) {
            const { path, cut } = action.payload;
            const detected = state.cutsByPath[path] ?? [];
            if (detected.some((t) => Math.abs(t - cut) < 1e-3)) return;
            if (!state.userCutsByPath[path]) state.userCutsByPath[path] = [];
            insertSorted(state.userCutsByPath[path], cut);
        },
        /** User-removed cut — matches within 1ms in BOTH detected and user
         *  pools so the same path works whether the cut was detected or
         *  manually placed. */
        deleteCut(state, action: PayloadAction<{ path: string; cut: number }>) {
            const { path, cut } = action.payload;
            if (state.cutsByPath[path]) {
                state.cutsByPath[path] = state.cutsByPath[path].filter(
                    (t) => Math.abs(t - cut) >= 1e-3,
                );
            }
            if (state.userCutsByPath[path]) {
                state.userCutsByPath[path] = state.userCutsByPath[path].filter(
                    (t) => Math.abs(t - cut) >= 1e-3,
                );
            }
            // Drop the matching entry from selection too — orphaned times would
            // visually do nothing but pollute every selection-driven action.
            state.selectedCutTimes = state.selectedCutTimes.filter(
                (t) => Math.abs(t - cut) >= 1e-3,
            );
        },
        /** Replace the timeline-side scene cut selection. Times are matched by
         *  exact value when reading; lasso/Delete callers always pass canonical
         *  times sourced from cutsByPath. */
        setSelectedCutTimes(state, action: PayloadAction<number[]>) {
            state.selectedCutTimes = action.payload;
        },
    },
});

export const {
    startDetection,
    setProgress,
    setCuts,
    appendCut,
    setError,
    setCancelled,
    loadCached,
    clearForPath,
    setMinGap,
    addCut,
    deleteCut,
    setSelectedCutTimes,
} = sceneSlice.actions;

export default sceneSlice.reducer;
