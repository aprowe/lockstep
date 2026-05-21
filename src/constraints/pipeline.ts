/**
 * runConstraintPipeline — pure function that applies a constraint op to slice state.
 *
 * Builds a constraint State from (slice, dragCtx), runs the resolver, then
 * extracts slice diffs from the resulting state.
 * Returns { regionDiffs, anchorDiffs, metaDiffs } — no Redux dispatch, no mutation
 * of external state.
 */

import { reduce, bpmDerivedConstraint } from "./resolver";
import type {
    Constraint,
    ConformTuple,
    Entity,
    EntityId,
    EntityMeta,
    Op,
    State,
} from "./types";
import { ConformMode, ConstraintKind, EntityKind, OpKind, PairMode } from "./types";
import { keyBy } from "es-toolkit";
import { anchorInId, anchorOutId, regionInId, regionOutId } from "./ids";
import { initAnchorPair, lasso, lockOn } from "./recipes";
import { SNAP_RULES } from "./snap-rules";
import { lookupProfile } from "./profiles";
import { pushToBucket } from "./multimap";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface PipelineSlice {
    warp: {
        origAnchors: Array<{ id: number; time: number; linked?: boolean }>;
        beatAnchors: Array<{ id: number; time: number; linked?: boolean }>;
    };
    region: {
        regions: Array<{
            id: string;
            inPoint: number;
            outPoint: number;
            inBeatTime: number;
            outBeatTime: number;
            bpm?: number;
            lockedBeats?: number;
            defaultLinked: boolean;
        }>;
    };
    ui: {
        anchorLock: boolean;
        anchorLockGestureOverride: boolean | null;
        lockMode: "bpm" | "beats";
        activeRegionId?: string | null;
    };
    lists: {
        selection: {
            clipin: string[];
            clipout: string[];
        };
    };
    /** Selected anchor IDs per space, mirrored into the lasso TranslateGroup
     *  by buildGraphFromSlice. Read directly from warp slice — no separate
     *  mirror in dragCtxSlice. */
    selection?: {
        orig: number[];
        beat: number[];
    };
    /** Scene cut times for the active video, in seconds. Synthesized into
     *  anchor-like entities at build time so the snap engine can target them. */
    scenes?: number[];
}

export interface DragCtx {
    /** Active gesture handle — drives profile.whileDragging constraint injection. */
    activeHandle?: import("./profiles/types").Handle | null;
    /** Modifier-key state for the active gesture (alt for anchor-lock XOR). */
    modifiers?: { alt: boolean };
    /** Pixel-to-time conversion at drag start (from controller's view info).
     *  Profiles use this to convert the pixel-space snap threshold (8 px)
     *  into entity-time units. */
    pxPerUnit?: number;
    /** Optional beat-grid for snap (set when the active gesture should
     *  consider grid marks alongside entity targets). */
    grid?: { interval: number; offset: number };
}

export interface PipelineInput {
    slice: PipelineSlice;
    dragCtx: DragCtx;
    op: Op;
}

export interface PipelineOutput {
    /** Per-region position diffs to write to slice.region. */
    regionDiffs: Record<
        string,
        Partial<{
            inPoint: number;
            outPoint: number;
            inBeatTime: number;
            outBeatTime: number;
            bpm: number;
            lockedBeats: number;
            defaultLinked: boolean;
        }>
    >;
    /** Per-anchor position diffs (by numeric anchor id). */
    anchorDiffs: {
        orig: Record<number, number>;
        beat: Record<number, number>;
    };
    /** Per-region meta diffs. */
    metaDiffs: Record<string, Partial<{ bpm: number; lockedBeats: number }>>;
}

// ─── Graph build ──────────────────────────────────────────────────────────────

/**
 * Build a constraint State from (slice, dragCtx).
 *
 * Derives all constraints from slice state: anchor pairs, default-link
 * DirectedPairs, SnapRules, space cohorts, twin cohorts, lasso
 * TranslateGroup, anchorLock TranslateGroup/ScaleGroup, and a batched
 * `ConformRule` (one rule per mode × shared tuple table) covering the
 * (region × anchor × edge) conform bindings.
 *
 * Performance: the build is intentionally non-immutable — we accumulate
 * directly into `entities`, `constraints`, `meta` and return a fresh
 * `State` at the end, instead of routing each addition through
 * `reduce(state, op)` (which deep-clones the entire state per call). The
 * conform-binding install alone touches `O(R·A)` constraint entries; the
 * recipes used at build time (`initAnchorPair`, `lasso`, `lockOn`) only
 * emit `AddConstraint` ops with no propagation, so the reduce / clone
 * roundtrip would be pure overhead.
 */
export function buildGraphFromSlice(slice: PipelineSlice, dragCtx: DragCtx): State {
    const entities: Record<EntityId, Entity> = {};
    const constraints: Constraint[] = [];
    const meta: Record<EntityId, EntityMeta> = {};

    const addConstraintOp = (op: Op): void => {
        if (op.kind === OpKind.AddConstraint) constraints.push(op.constraint);
    };

    // ── Entities ──────────────────────────────────────────────────────────────

    // Anchor pairs
    for (const a of slice.warp.origAnchors) {
        const id = anchorInId(a.id);
        entities[id] = { kind: EntityKind.Anchor, id, time: a.time };
    }
    for (const a of slice.warp.beatAnchors) {
        const id = anchorOutId(a.id);
        entities[id] = { kind: EntityKind.Anchor, id, time: a.time };
    }

    // Region clip pairs
    for (const r of slice.region.regions) {
        const inId = regionInId(r.id);
        const outId = regionOutId(r.id);
        entities[inId] = { kind: EntityKind.Clip, id: inId, in: r.inPoint, out: r.outPoint };
        entities[outId] = {
            kind: EntityKind.Clip,
            id: outId,
            in: r.inBeatTime,
            out: r.outBeatTime,
        };
        // Seed meta for bpmDerivedConstraint
        if (r.bpm !== undefined || r.lockedBeats !== undefined) {
            meta[outId] = {
                ...(r.bpm !== undefined ? { bpm: r.bpm } : {}),
                ...(r.lockedBeats !== undefined ? { lockedBeats: r.lockedBeats } : {}),
            };
        }
    }

    // ── Structural constraints ─────────────────────────────────────────────────

    // 1. Anchor pair markers (DeleteGroup + linked sentinel).
    //    A beat anchor with linked !== false is considered linked.
    const beatById = keyBy(slice.warp.beatAnchors, (a) => a.id);
    for (const a of slice.warp.origAnchors) {
        const beat = beatById[a.id];
        const isLinked = !beat || beat.linked !== false;
        if (isLinked) {
            for (const op of initAnchorPair(anchorInId(a.id), anchorOutId(a.id))) {
                addConstraintOp(op);
            }
        }
    }

    // 2. BPM derived constraint — one per region clipout.
    for (const r of slice.region.regions) {
        constraints.push(bpmDerivedConstraint(regionOutId(r.id), slice.ui.lockMode));
    }

    // 3. Default-link (clipin → clipout): two MirrorEdges (per-edge value
    //    mirror). For each clipin edge write, clipout's matching edge gets the
    //    same value. Chosen over Translate (delta cascade) so the linked
    //    invariant `clipout = clipin` is re-asserted every pipeline pass —
    //    important for the conform "restore" behavior: when ConformVisual
    //    transiently writes clipout to a beat anchor's time and the user then
    //    drags clipin past coincidence, the next pass's MirrorEdge cascade
    //    snaps clipout back to clipin's new value (not clipout's stale
    //    conformed value + delta, which is what Translate would yield).
    for (const r of slice.region.regions) {
        if (r.defaultLinked) {
            constraints.push(
                {
                    kind: ConstraintKind.DirectedPair,
                    from: regionInId(r.id),
                    to: regionOutId(r.id),
                    mode: PairMode.MirrorEdge,
                    fromEdge: "in",
                    tag: `defaultlink:${regionInId(r.id)}:in`,
                },
                {
                    kind: ConstraintKind.DirectedPair,
                    from: regionInId(r.id),
                    to: regionOutId(r.id),
                    mode: PairMode.MirrorEdge,
                    fromEdge: "out",
                    tag: `defaultlink:${regionInId(r.id)}:out`,
                },
            );
        }
    }

    // 4. ConformVisual + ConformRedirect — installed after step 11 below so
    //    they fire AFTER SnapTarget in each Propose fixed-point iteration.

    // 5. SnapRule constraints — derived from SNAP_RULES table.
    for (const spec of SNAP_RULES) {
        const tag = spec.condition
            ? `rule:${spec.dragger}->${spec.target}:${spec.condition}`
            : `rule:${spec.dragger}->${spec.target}`;
        constraints.push({
            kind: ConstraintKind.SnapRule,
            dragger: spec.dragger,
            target: spec.target,
            condition: spec.condition,
            tag,
        });
    }

    // 6. Space cohorts (anchor-in / anchor-out / clipin / clipout). Pushed
    //    in a single shot — we start from an empty constraint list, so no
    //    remove-before-add dance is needed.
    constraints.push(
        {
            kind: ConstraintKind.SnapCohort,
            tag: "anchor-in",
            ids: slice.warp.origAnchors.map((a) => anchorInId(a.id)),
        },
        {
            kind: ConstraintKind.SnapCohort,
            tag: "anchor-out",
            ids: slice.warp.beatAnchors.map((a) => anchorOutId(a.id)),
        },
        {
            kind: ConstraintKind.SnapCohort,
            tag: "clipin",
            ids: slice.region.regions.map((r) => regionInId(r.id)),
        },
        {
            kind: ConstraintKind.SnapCohort,
            tag: "clipout",
            ids: slice.region.regions.map((r) => regionOutId(r.id)),
        },
    );

    // 6b. Scenes — pure read-only proximity targets. Stored as a sorted
    //     Float64Array sidecar on `State`, NOT as entities + SnapCohort.
    //     This keeps the per-Move state clone independent of scene count
    //     and lets `evaluateSnap` binary-search the cuts directly. Snap
    //     resolution for the `scenes` cohort tag is special-cased in
    //     `snapToSiblings`, which reads the sidecar.
    let sceneSidecar: Float64Array | undefined;
    if (slice.scenes && slice.scenes.length > 0) {
        sceneSidecar = new Float64Array(slice.scenes);
        sceneSidecar.sort();
    }

    // 7. Twin cohorts (twin:{regionId}) — derived for diverged (defaultLinked === false) regions.
    for (const r of slice.region.regions) {
        if (r.defaultLinked === false) {
            constraints.push({
                kind: ConstraintKind.SnapCohort,
                tag: `twin:${r.id}`,
                ids: [regionInId(r.id), regionOutId(r.id)],
            });
        }
    }

    // ── Transient (dragCtx) constraints ──────────────────────────────────────

    // 8. Lasso TranslateGroup — derived directly from slice selection state
    //    on every pipeline dispatch.
    let lassoIds: EntityId[] = [];
    if (slice.selection) {
        for (const n of slice.selection.orig) lassoIds.push(anchorInId(n));
        for (const n of slice.selection.beat) lassoIds.push(anchorOutId(n));
        for (const s of slice.lists.selection.clipin) lassoIds.push(regionInId(s));
        for (const s of slice.lists.selection.clipout) lassoIds.push(regionOutId(s));
        lassoIds = [...new Set(lassoIds)];
    }
    if (lassoIds.length > 0) {
        addConstraintOp(lasso("main", lassoIds));
    }

    // 10. Anchor-lock constraints — derived directly from slice state.
    //     The gesture-override (alt key during drag) is XOR'd with the static
    //     ui.anchorLock to get the effective lock state.
    {
        const gestureOverride = slice.ui.anchorLockGestureOverride ?? null;
        const effectiveAnchorLock =
            gestureOverride !== null ? gestureOverride : (slice.ui.anchorLock ?? false);
        const activeRegionId = slice.ui.activeRegionId ?? null;
        const activeRegion = activeRegionId
            ? slice.region.regions.find((r) => r.id === activeRegionId)
            : undefined;
        if (effectiveAnchorLock && activeRegion) {
            const clipoutIn = activeRegion.inBeatTime;
            const clipoutOut = activeRegion.outBeatTime;
            const EPSILON = 1e-9;
            const innerAnchorOutIds: EntityId[] = [];
            for (const a of slice.warp.beatAnchors) {
                if (a.time > clipoutIn + EPSILON && a.time < clipoutOut - EPSILON) {
                    innerAnchorOutIds.push(anchorOutId(a.id));
                }
            }
            innerAnchorOutIds.sort();
            if (innerAnchorOutIds.length > 0) {
                const clipOutId = regionOutId(activeRegion.id);
                const lockMode = slice.ui.lockMode;
                if (lockMode === "beats") {
                    for (const op of lockOn(clipOutId, innerAnchorOutIds)) {
                        addConstraintOp(op);
                    }
                } else {
                    constraints.push({
                        kind: ConstraintKind.TranslateGroup,
                        ids: [clipOutId, ...innerAnchorOutIds],
                        driver: clipOutId,
                        tag: `lock:${clipOutId}`,
                    });
                }
            }
        }
    }

    // 11. Gesture-scoped constraints — declared by the active drag handle's
    //     GestureProfile.whileDragging. The profile is read against a
    //     snapshot of the partially-built state (it may call `snapToSiblings`
    //     and friends), so we hand it a synthesized read-only view rather
    //     than mutate the accumulator.
    if (dragCtx.activeHandle) {
        const profile = lookupProfile(dragCtx.activeHandle);
        if (profile) {
            const ctx = {
                preDrag: {
                    origAnchors: slice.warp.origAnchors,
                    beatAnchors: slice.warp.beatAnchors,
                    regions: slice.region.regions,
                },
                ui: { anchorLock: slice.ui.anchorLock ?? false, lockMode: slice.ui.lockMode },
                modifiers: dragCtx.modifiers ?? { alt: false },
                pxPerUnit: dragCtx.pxPerUnit ?? 0,
                grid: dragCtx.grid ?? undefined,
            };
            // The profile may consult the partial graph (e.g. snapToSiblings
            // walks SnapCohorts / SnapRules). We hand it a snapshot of the
            // constraints array because derived-index.ts caches its bundles
            // keyed on the array reference — if we passed the live array,
            // any later mutation (step 12's conform bindings, or even the
            // profile-emitted constraints below) would leave the cached
            // bundle stale.
            const profileView: State = {
                entities,
                constraints: [...constraints],
                meta,
                globals: { lockMode: slice.ui.lockMode },
                scenes: sceneSidecar,
            };
            for (const constraint of profile.whileDragging(
                dragCtx.activeHandle,
                ctx,
                profileView,
            )) {
                constraints.push(constraint);
            }
        }
    }

    // 12. ConformRule (redirect + visual) — installed LAST so that within
    //     each Propose fixed-point iteration the order is:
    //       (a) Default-link (step 3)         — clipin → clipout cascade
    //       (b) ... other Propose rules ...
    //       (c) SnapTarget (step 11, gesture) — restricts seed write
    //       (d) ConformRule mode=redirect     — rewrites user clipout
    //                                           writes as anchor.beat writes
    //       (e) ConformRule mode=visual       — asserts clipout = anchor.beat
    //
    //     Order matters because state.constraints iterates by insertion order
    //     within each Propose pass. Redirect must see the snapped value (so
    //     the anchor.beat write carries the snapped value, not the raw
    //     cursor). Visual must run after Redirect so the clipout it writes
    //     reflects the redirected anchor.beat.
    //
    //     Both modes iterate the same per (region × anchor × edge) tuple
    //     table internally. The conform coupling is strictly directed
    //     (anchor → clipout); the redirect mode handles user clipout drags
    //     by rewriting them into anchor.beat writes.
    //
    //     See: docs/superpowers/specs/2026-05-20-conform-invariant-restructure-design.md
    const linkedOrigAnchors = slice.warp.origAnchors.filter((a) => beatById[a.id]);
    const conformTuples: ConformTuple[] = [];
    const conformByEntity = new Map<EntityId, number[]>();
    for (const r of slice.region.regions) {
        const clipId = regionInId(r.id);
        const clipOutId = regionOutId(r.id);
        for (const orig of linkedOrigAnchors) {
            const aInId = anchorInId(orig.id);
            const aOutId = anchorOutId(orig.id);
            for (const edge of ["in", "out"] as const) {
                const i = conformTuples.length;
                conformTuples.push({
                    anchorInId: aInId,
                    anchorOutId: aOutId,
                    clipId,
                    clipOutId,
                    edge,
                });
                pushToBucket(conformByEntity, aInId, i);
                pushToBucket(conformByEntity, aOutId, i);
                pushToBucket(conformByEntity, clipId, i);
                pushToBucket(conformByEntity, clipOutId, i);
            }
        }
    }
    if (conformTuples.length > 0) {
        constraints.push(
            {
                kind: ConstraintKind.ConformRule,
                mode: ConformMode.Redirect,
                tuples: conformTuples,
                byEntity: conformByEntity,
            },
            {
                kind: ConstraintKind.ConformRule,
                mode: ConformMode.Visual,
                tuples: conformTuples,
                byEntity: conformByEntity,
            },
        );
    }

    return {
        entities,
        constraints,
        meta,
        globals: { lockMode: slice.ui.lockMode },
        scenes: sceneSidecar,
    };
}

// ─── Extract diffs ────────────────────────────────────────────────────────────

/**
 * Compare post-resolver State against the pre-op slice values and emit diffs.
 * Only fields that CHANGED are emitted (undefined = no change).
 */
export function extractDiffs(postState: State, slice: PipelineSlice): Omit<PipelineOutput, never> {
    const regionDiffs: PipelineOutput["regionDiffs"] = {};
    const anchorDiffs: PipelineOutput["anchorDiffs"] = { orig: {}, beat: {} };
    const metaDiffs: PipelineOutput["metaDiffs"] = {};

    // Regions
    for (const r of slice.region.regions) {
        const cin = postState.entities[regionInId(r.id)];
        const cout = postState.entities[regionOutId(r.id)];
        const meta = postState.meta[regionOutId(r.id)];
        const diff: PipelineOutput["regionDiffs"][string] = {};
        let hasDiff = false;

        if (cin && cin.kind === "clip") {
            if (cin.in !== r.inPoint) {
                diff.inPoint = cin.in;
                hasDiff = true;
            }
            if (cin.out !== r.outPoint) {
                diff.outPoint = cin.out;
                hasDiff = true;
            }
        }
        if (cout && cout.kind === "clip") {
            if (cout.in !== r.inBeatTime) {
                diff.inBeatTime = cout.in;
                hasDiff = true;
            }
            if (cout.out !== r.outBeatTime) {
                diff.outBeatTime = cout.out;
                hasDiff = true;
            }
        }

        // defaultLinked is not driven by entity position — it's controlled by
        // the presence/absence of the defaultlink DirectedPair constraint, so
        // there's nothing to diff here.

        if (hasDiff) regionDiffs[r.id] = diff;

        // Meta diffs
        if (meta) {
            const metaDiff: PipelineOutput["metaDiffs"][string] = {};
            let hasMetaDiff = false;
            if (meta.bpm !== undefined && meta.bpm !== r.bpm) {
                metaDiff.bpm = meta.bpm;
                hasMetaDiff = true;
            }
            if (meta.lockedBeats !== undefined && meta.lockedBeats !== r.lockedBeats) {
                metaDiff.lockedBeats = meta.lockedBeats;
                hasMetaDiff = true;
            }
            if (hasMetaDiff) metaDiffs[r.id] = metaDiff;
        }
    }

    // Anchors
    for (const a of slice.warp.origAnchors) {
        const e = postState.entities[anchorInId(a.id)];
        if (e && e.kind === "anchor" && e.time !== a.time) {
            anchorDiffs.orig[a.id] = e.time;
        }
    }
    for (const a of slice.warp.beatAnchors) {
        const e = postState.entities[anchorOutId(a.id)];
        if (e && e.kind === "anchor" && e.time !== a.time) {
            anchorDiffs.beat[a.id] = e.time;
        }
    }

    return { regionDiffs, anchorDiffs, metaDiffs };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Pure pipeline: build graph, run resolver, extract diffs.
 *
 * Input: slice subtree + transient dragCtx + the op to apply.
 * Output: diffs to apply to a copy of the slice to reach the post-op state.
 *
 * No Redux dispatch. No mutation of external state. Safe to call from tests,
 * workers, or any context without a store.
 */
export function runConstraintPipeline(input: PipelineInput): PipelineOutput {
    const { slice, dragCtx, op } = input;

    // Build the graph from slice + dragCtx.
    const preState = buildGraphFromSlice(slice, dragCtx);

    // Run the resolver pipeline.
    const postState = reduce(preState, op);

    // Extract diffs by comparing post-state against the original slice values.
    return extractDiffs(postState, slice);
}

// ─── DragCtx extraction ───────────────────────────────────────────────────────

/**
 * Derive a DragCtx from the gestureSlice state subtree.
 *
 * Lasso TranslateGroup, anchor-lock constraints, and SnapTargets are all
 * derived in buildGraphFromSlice directly from slice/gesture state. DragCtx
 * carries only the active gesture handle, modifier-key state, and the
 * pixel-to-time scaling needed by profile.whileDragging.
 */
export function extractDragCtxFromSlice(state: {
    gesture?: {
        activeHandle: import("./profiles/types").Handle | null;
        modifiers: { alt: boolean };
        pxPerUnit?: number;
        grid?: { interval: number; offset: number } | null;
    };
}): DragCtx {
    const g = state.gesture;
    return {
        activeHandle: g?.activeHandle ?? null,
        modifiers: g?.modifiers ?? { alt: false },
        pxPerUnit: g?.pxPerUnit ?? 0,
        grid: g?.grid ?? undefined,
    };
}

/**
 * Apply PipelineOutput diffs to a shallow copy of the slice state,
 * returning the new slice positions. Used by equivalence tests to build a
 * "canonical" final-state snapshot from the pipeline path.
 */
export function applyDiffsToSlice(
    slice: PipelineSlice,
    output: PipelineOutput,
): {
    origAnchors: Array<{ id: number; time: number }>;
    beatAnchors: Array<{ id: number; time: number }>;
    regions: Array<{
        id: string;
        inPoint: number;
        outPoint: number;
        inBeatTime: number;
        outBeatTime: number;
        bpm?: number;
        lockedBeats?: number;
    }>;
} {
    const origAnchors = slice.warp.origAnchors.map((a) => ({
        id: a.id,
        time: output.anchorDiffs.orig[a.id] ?? a.time,
    }));
    const beatAnchors = slice.warp.beatAnchors.map((a) => ({
        id: a.id,
        time: output.anchorDiffs.beat[a.id] ?? a.time,
    }));
    const regions = slice.region.regions.map((r) => {
        const pos = output.regionDiffs[r.id];
        const meta = output.metaDiffs[r.id];
        return {
            id: r.id,
            inPoint: pos?.inPoint ?? r.inPoint,
            outPoint: pos?.outPoint ?? r.outPoint,
            inBeatTime: pos?.inBeatTime ?? r.inBeatTime,
            outBeatTime: pos?.outBeatTime ?? r.outBeatTime,
            bpm: meta?.bpm ?? r.bpm,
            lockedBeats: meta?.lockedBeats ?? r.lockedBeats,
        };
    });
    return { origAnchors, beatAnchors, regions };
}
