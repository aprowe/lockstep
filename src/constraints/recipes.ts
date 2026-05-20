/**
 * Recipes — user-level gestures expressed as constraint mutations.
 *
 * Each recipe returns an Op (or Op[]) that the caller dispatches through
 * `reduce`. Recipes are the ONLY place that knows what specific constraints
 * a given gesture needs; the resolver is generic.
 */

import type { Derived, EntityId, Field, Op, SnapTarget, State } from "./types";
import { ConstraintKind, OpKind, PairMode, PreserveMode, Role, EntityKind } from "./types";
import { bpmDerivedConstraint } from "./resolver";
import { movementClosure } from "./closure";
import { buildSnapIndex } from "./snap-index";
import { SNAP_CONDITIONS } from "./snap-rules";

// ─── Lifecycle ────────────────────────────────────────────────────────────

/** Initial setup for a newly-added clip pair:
 *    - default-linked (clipin → clipout via directed translate pair)
 *    - BPM × beats × length tradeoff (fixed = bpm by default)
 *    - min length 0.1 (shift mode)
 *    - non-negative clamps on clipin */
export function initClip(clipInId: EntityId, clipOutId: EntityId): Op[] {
    return [
        {
            kind: OpKind.AddConstraint,
            constraint: {
                kind: ConstraintKind.DirectedPair,
                from: clipInId,
                to: clipOutId,
                mode: PairMode.Translate,
                tag: `defaultlink:${clipInId}`,
            },
        },
        { kind: OpKind.AddConstraint, constraint: bpmDerivedConstraint(clipOutId, "bpm") },
        {
            kind: OpKind.AddConstraint,
            constraint: {
                kind: ConstraintKind.PreserveLength,
                clipId: clipInId,
                min: 0.1,
                mode: PreserveMode.Shift,
            },
        },
        {
            kind: OpKind.AddConstraint,
            constraint: {
                kind: ConstraintKind.Clamp,
                entityId: clipInId,
                field: "in",
                min: 0,
            },
        },
        {
            kind: OpKind.AddConstraint,
            constraint: {
                kind: ConstraintKind.Clamp,
                entityId: clipInId,
                field: "out",
                min: 0,
            },
        },
    ];
}

/** Initial setup for an anchor pair:
 *    - delete-group binds them so deleting either deletes both.
 *    - directed translate (orig → beat): orig.time writes propagate to beat.
 *      One-way — beat writes do NOT tug orig (beat moves are the unlink
 *      gesture handled by `applyMoveBeatAnchor`).
 *    - The shared tag `pair:{anchorInId}` is the "linked" sentinel: its
 *      presence means the beat side tracks the orig side. `unlinkAnchor`
 *      removes both constraints to diverge beat from orig. */
export function initAnchorPair(anchorInId: EntityId, anchorOutId: EntityId): Op[] {
    return [
        {
            kind: OpKind.AddConstraint,
            constraint: {
                kind: ConstraintKind.DeleteGroup,
                ids: [anchorInId, anchorOutId],
                tag: `pair:${anchorInId}`,
            },
        },
        {
            kind: OpKind.AddConstraint,
            constraint: {
                kind: ConstraintKind.DirectedPair,
                from: anchorInId,
                to: anchorOutId,
                mode: PairMode.Translate,
                tag: `pair:${anchorInId}`,
            },
        },
    ];
}

/** Remove the linked-pair marker for an anchor (equivalent to "diverge" for
 *  anchors). Removes both the DeleteGroup and the orig→beat DirectedPair so
 *  subsequent orig writes no longer drag the beat side. */
export function unlinkAnchor(anchorInId: EntityId): Op {
    return {
        kind: OpKind.RemoveConstraint,
        predicate: (c) =>
            (c.kind === ConstraintKind.DeleteGroup || c.kind === ConstraintKind.DirectedPair) &&
            (c as { tag?: string }).tag === `pair:${anchorInId}`,
    };
}

// ─── Selection (lasso / multi-select) ─────────────────────────────────────

/** Lasso N entities into one translate-coupled group. `groupTag` lets the
 *  caller distinguish multiple coexisting lassos when needed. */
export function lasso(groupTag: string, ids: EntityId[]): Op {
    return {
        kind: OpKind.AddConstraint,
        constraint: {
            kind: ConstraintKind.TranslateGroup,
            ids,
            tag: `lasso:${groupTag}`,
        },
    };
}

export function clearLasso(groupTag: string): Op {
    return {
        kind: OpKind.RemoveConstraint,
        predicate: (c) => c.kind === ConstraintKind.TranslateGroup && c.tag === `lasso:${groupTag}`,
    };
}

// ─── Anchor lock ──────────────────────────────────────────────────────────

/** Anchor-lock ON for a clipout + its inner anchor set. Both constraints
 *  are DIRECTED with the clipout as driver — only clipout writes propagate
 *  to the inner anchors; anchor drags don't drag the clipout. */
export function lockOn(clipOutId: EntityId, innerAnchorOutIds: EntityId[]): Op[] {
    const ids = [clipOutId, ...innerAnchorOutIds];
    return [
        {
            kind: OpKind.AddConstraint,
            constraint: {
                kind: ConstraintKind.TranslateGroup,
                ids,
                driver: clipOutId,
                tag: `lock:${clipOutId}`,
            },
        },
        {
            kind: OpKind.AddConstraint,
            constraint: {
                kind: ConstraintKind.ScaleGroup,
                ids,
                driver: clipOutId,
                tag: `lock:${clipOutId}`,
            },
        },
    ];
}

export function lockOff(clipOutId: EntityId): Op {
    return {
        kind: OpKind.RemoveConstraint,
        predicate: (c) =>
            (c.kind === ConstraintKind.TranslateGroup || c.kind === ConstraintKind.ScaleGroup) &&
            c.tag === `lock:${clipOutId}`,
    };
}

// ─── Conform-driven edge/anchor propagation ──────────────────────────────
//
// No recipe is needed here. `buildGraphFromSlice` installs a
// ConformRedirect + ConformVisual pair for every (region × anchor × edge);
// the resolver checks coincidence per pipeline pass and engages / disengages
// automatically. ConformRedirect rewrites user clipout writes into
// anchor.beat writes, and ConformVisual asserts clipout = anchor.beat in
// the other direction.

// ─── Region.lock dropdown (BPM vs beats fixed) ────────────────────────────

export function setLockMode(clipOutId: EntityId, fixed: "bpm" | "beats"): Op[] {
    return [
        {
            kind: OpKind.RemoveConstraint,
            predicate: (c) => c.kind === ConstraintKind.Derived && c.tag === `bpm:${clipOutId}`,
        },
        { kind: OpKind.AddConstraint, constraint: bpmDerivedConstraint(clipOutId, fixed) },
    ];
}

/** User typed a new BPM value. Behavior depends on the clip's lock mode
 *  (read from its bpm-derived constraint's `meta.fixed`):
 *    - fixed='bpm':   the bpm being typed becomes the new fixed value;
 *                     lockedBeats will absorb on the next length change.
 *                     Just write bpm; nothing else.
 *    - fixed='beats': lockedBeats stays put, so length must change to
 *                     satisfy length × bpm / 60 = beats. We dispatch BOTH
 *                     the bpm SetValue AND a SetEdge that changes clip.out
 *                     to the new length. The SetEdge then triggers the
 *                     full propose phase — scale_group (if anchor-lock is
 *                     on) rescales inner anchors automatically. */
export function setBpm(clipId: EntityId, newBpm: number, state: State): Op[] {
    const clip = state.entities[clipId];
    if (!clip || clip.kind !== EntityKind.Clip) return [];

    const derived = state.constraints.find(
        (c) => c.kind === ConstraintKind.Derived && c.tag === `bpm:${clipId}`,
    ) as Derived | undefined;
    const fixed = derived?.meta?.fixed as "bpm" | "beats" | undefined;

    if (fixed !== "beats") {
        return [{ kind: OpKind.SetValue, id: clipId, field: "bpm", value: newBpm }];
    }

    const meta = state.meta[clipId];
    if (!meta?.lockedBeats || newBpm <= 0) {
        return [{ kind: OpKind.SetValue, id: clipId, field: "bpm", value: newBpm }];
    }

    const newLength = (60 * meta.lockedBeats) / newBpm;
    const newOut = clip.in + newLength;

    return [
        { kind: OpKind.SetValue, id: clipId, field: "bpm", value: newBpm },
        { kind: OpKind.SetEdge, id: clipId, edge: "out", value: newOut },
    ];
}

/** Symmetric to setBpm — user typed a new lockedBeats value. */
export function setLockedBeats(clipId: EntityId, newBeats: number, state: State): Op[] {
    const clip = state.entities[clipId];
    if (!clip || clip.kind !== EntityKind.Clip) return [];

    const derived = state.constraints.find(
        (c) => c.kind === ConstraintKind.Derived && c.tag === `bpm:${clipId}`,
    ) as Derived | undefined;
    const fixed = derived?.meta?.fixed as "bpm" | "beats" | undefined;

    if (fixed !== "bpm") {
        return [{ kind: OpKind.SetValue, id: clipId, field: "lockedBeats", value: newBeats }];
    }

    const meta = state.meta[clipId];
    if (!meta?.bpm || newBeats <= 0) {
        return [{ kind: OpKind.SetValue, id: clipId, field: "lockedBeats", value: newBeats }];
    }

    const newLength = (60 * newBeats) / meta.bpm;
    const newOut = clip.in + newLength;

    return [
        { kind: OpKind.SetValue, id: clipId, field: "lockedBeats", value: newBeats },
        { kind: OpKind.SetEdge, id: clipId, edge: "out", value: newOut },
    ];
}

// ─── Divergence (clipout drag breaks default-link) ────────────────────────

/** Remove the clipin → clipout default-link pair. Recipe fires when the
 *  user pans/resizes the clipout for the first time. */
export function diverge(clipInId: EntityId): Op {
    return {
        kind: OpKind.RemoveConstraint,
        predicate: (c) =>
            c.kind === ConstraintKind.DirectedPair && c.tag === `defaultlink:${clipInId}`,
    };
}

// ─── Cardinality ──────────────────────────────────────────────────────────

export function setActiveClip(activeId: EntityId | null): Op[] {
    return [
        {
            kind: OpKind.RemoveConstraint,
            predicate: (c) =>
                c.kind === ConstraintKind.SingleOfKind &&
                c.filterKind === EntityKind.Clip &&
                c.role === Role.Active,
        },
        {
            kind: OpKind.AddConstraint,
            constraint: {
                kind: ConstraintKind.SingleOfKind,
                filterKind: EntityKind.Clip,
                role: Role.Active,
                activeId,
            },
        },
    ];
}

export function setBeatZero(anchorId: EntityId | null): Op[] {
    return [
        {
            kind: OpKind.RemoveConstraint,
            predicate: (c) =>
                c.kind === ConstraintKind.SingleOfKind &&
                c.filterKind === EntityKind.Anchor &&
                c.role === Role.BeatZero,
        },
        {
            kind: OpKind.AddConstraint,
            constraint: {
                kind: ConstraintKind.SingleOfKind,
                filterKind: EntityKind.Anchor,
                role: Role.BeatZero,
                activeId: anchorId,
            },
        },
    ];
}

// ─── Warp-line drag (move anchor-in + anchor-out together) ────────────────

export function warpLineStart(anchorInId: EntityId, anchorOutId: EntityId): Op {
    return {
        kind: OpKind.AddConstraint,
        constraint: {
            kind: ConstraintKind.TranslateGroup,
            ids: [anchorInId, anchorOutId],
            tag: `warpline:${anchorInId}`,
        },
    };
}

export function warpLineEnd(anchorInId: EntityId): Op {
    return {
        kind: OpKind.RemoveConstraint,
        predicate: (c) =>
            c.kind === ConstraintKind.TranslateGroup && c.tag === `warpline:${anchorInId}`,
    };
}

// ─── Snap-on-drag ─────────────────────────────────────────────────────────

export function snapBegin(
    id: EntityId,
    field: "time" | "in" | "out",
    targets: SnapTarget["targets"],
    threshold = 4,
): Op {
    return {
        kind: OpKind.AddConstraint,
        constraint: {
            kind: ConstraintKind.SnapTarget,
            id,
            field,
            targets,
            threshold,
            tag: `snap:${id}:${field}`,
        },
    };
}

export function snapEnd(id: EntityId, field: "time" | "in" | "out"): Op {
    return {
        kind: OpKind.RemoveConstraint,
        predicate: (c) => c.kind === ConstraintKind.SnapTarget && c.tag === `snap:${id}:${field}`,
    };
}

/** Dynamic snap setup at drag start. Queries the constraint graph's SnapIndex
 *  (built by buildGraphFromSlice from SNAP_RULES + space/twin cohorts)
 *  to derive snap targets from the declarative SNAP_RULES table. No ID parsing.
 *
 *  Exclusion: anything in the dragged entity's movement closure (writes follow
 *  the drag — snapping is degenerate) is excluded.
 *
 *  `gestureRole` disambiguates role-split cohorts: when dragging a clipout,
 *  pass `'edge'` for an edge-resize gesture or `'body'` for a body pan.
 *  This adds `clipout:edge` or `clipout:body` to the effective dragger cohorts
 *  so the matching rules fire.  For other entity kinds, role is ignored.
 *
 *  `pxPerUnit` converts the pixel-space threshold to the entity's unit.
 *  `grid` params are passed by the caller (from computeGridForSnap); the rules
 *  table decides whether to actually include them via the `'grid'` target. */
export function snapToSiblings(
    draggedId: EntityId,
    field: Field,
    state: State,
    pxPerUnit: number,
    pixelThreshold = 8,
    grid?: { interval: number; offset: number },
    gestureRole?: "edge" | "body" | "anchor",
): Op {
    const exclusion = movementClosure(state, draggedId);

    // Build the snap index from the current graph state (cheap, no caching needed).
    const index = buildSnapIndex(state);

    // Resolve the dragger cohorts for this entity + role.
    const baseCohorts = index.cohortsByEntity.get(draggedId) ?? [];
    const draggerCohorts = new Set<string>(baseCohorts);

    // Role variants: for clipout with a gesture role, add the qualified tag.
    if (gestureRole && (gestureRole === "edge" || gestureRole === "body")) {
        for (const c of baseCohorts) {
            if (c === "clipout") {
                draggerCohorts.add(`${c}:${gestureRole}`);
            }
        }
    }

    // Walk rules; collect target cohorts where dragger matches and condition passes.
    const targetCohorts = new Set<string>();
    let includeGrid = false;

    for (const rule of index.rules) {
        if (!draggerCohorts.has(rule.dragger)) continue;
        if (rule.condition) {
            const pred = SNAP_CONDITIONS[rule.condition];
            if (!pred || !pred({ state, draggedField: field as "in" | "out" | "time" })) continue;
        }
        if (rule.target === "grid") {
            includeGrid = true;
            continue;
        }
        // 'twin' resolves to per-region twin cohorts — find any twin:* cohort whose
        // region matches.  We check if the entity is in a twin cohort directly.
        if (rule.target === "twin") {
            // The twin cohort for a region contains both the -in and -out entities.
            // We want to add the PEER entity's cohort. We look for `twin:{regionId}`
            // cohorts where the dragged entity is a member, and include them.
            for (const [tag, ids] of index.idsByCohort) {
                if (!tag.startsWith("twin:")) continue;
                if (ids.includes(draggedId)) {
                    targetCohorts.add(tag);
                }
            }
            continue;
        }
        targetCohorts.add(rule.target);
    }

    // For body-pan, the SnapTarget must align EITHER edge to a target and
    // apply the same delta to both. Materialize targets for BOTH edges of
    // each clip target. Otherwise just the dragged field.
    const mode: "edge" | "body" = gestureRole === "body" ? "body" : "edge";

    // Materialize targets from the collected cohorts.
    const targets: SnapTarget["targets"] = [];
    const seen = new Set<string>(); // deduplicate (entityId, field) pairs

    for (const cohort of targetCohorts) {
        const ids = index.idsByCohort.get(cohort) ?? [];
        for (const id of ids) {
            if (id === draggedId || exclusion.has(id)) continue;
            const e = state.entities[id];
            if (!e) continue;
            // What field(s) on the target are valid snap points?
            //   Anchor target → only 'time'.
            //   Clip target → BOTH edges are valid snap candidates, always.
            //     A clip's left edge can snap to another clip's left edge (stack
            //     same axis) OR right edge (abut). Threshold filtering picks
            //     whichever target edge is actually close. Same for body-pan and
            //     anchor-to-clip snap.
            let targetFields: Field[];
            if (e.kind === EntityKind.Anchor) {
                targetFields = ["time"];
            } else {
                targetFields = ["in", "out"];
            }
            for (const tf of targetFields) {
                const key = `${id}:${tf}`;
                if (seen.has(key)) continue;
                seen.add(key);
                targets.push({ entityId: id, field: tf });
            }
        }
    }

    // Grid: caller passed `grid` only when contextually possible.
    // Rule table decides whether to actually use it.
    const effectiveGrid = includeGrid ? grid : undefined;

    return {
        kind: OpKind.AddConstraint,
        constraint: {
            kind: ConstraintKind.SnapTarget,
            id: draggedId,
            field,
            targets,
            threshold: pixelThreshold / pxPerUnit,
            grid: effectiveGrid,
            mode,
            tag: `snap:${draggedId}:${field}`,
        },
    };
}

// ─── Conform binding ──────────────────────────────────────────────────────
//
// Conform bindings are installed unconditionally by `buildGraphFromSlice`
// (one ConformRedirect + one ConformVisual per region × anchor × edge).
// The resolver handlers gate themselves on positional coincidence each
// pipeline pass, so there is no manual conform/unconform recipe.

// ─── Highlight (hover / multi-select indicator) ───────────────────────────

export function highlight(ids: EntityId[], tag: string): Op {
    return {
        kind: OpKind.AddConstraint,
        constraint: { kind: ConstraintKind.HighlightGroup, ids, tag },
    };
}
