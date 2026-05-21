import type { EntityId, State } from "./types";
import { ConstraintKind } from "./types";
import { constraintsTouchingEntity } from "./derived-index";

/**
 * BFS the constraint graph from `seed` and return every entity that would
 * receive a write when `seed` is moved. Used by snap target enumeration to
 * exclude entities that move with the drag (snapping to them is degenerate).
 *
 * Edges (write-propagating):
 *   - TranslateGroup (bidirectional, no driver):  every member is reachable
 *     from every other.
 *   - TranslateGroup (directed, has driver):      driver → followers only.
 *   - ScaleGroup (always has a driver):           driver → followers only.
 *   - DirectedPair (any mode):                    from → to only.
 *
 * Non-write constraints (Clamp, PreserveLength, SnapTarget, Derived,
 * SingleOfKind, DeleteGroup, HighlightGroup, ConformVisual,
 * ConformRedirect, SnapCohort, SnapRule) are ignored — they don't
 * propagate a translate-shaped delta.
 *
 * Performance: uses the reverse `entity → constraints` index so each BFS
 * step consults only constraints that mention the dequeued entity, not the
 * full constraint list. Cost per drag is O(|closure| · avgDegree) instead of
 * O(|closure| · |constraints|).
 */
export function movementClosure(state: State, seed: EntityId): Set<EntityId> {
    const closure = new Set<EntityId>([seed]);
    const queue: EntityId[] = [seed];

    while (queue.length > 0) {
        const id = queue.shift()!;
        for (const c of constraintsTouchingEntity(state, id)) {
            let followers: readonly EntityId[] = [];

            switch (c.kind) {
                case ConstraintKind.TranslateGroup:
                    if (c.driver === undefined) {
                        if (c.ids.includes(id)) followers = c.ids;
                    } else if (c.driver === id) {
                        followers = c.ids;
                    }
                    break;

                case ConstraintKind.ScaleGroup:
                    if (c.driver === id) followers = c.ids;
                    break;

                case ConstraintKind.DirectedPair:
                    // mode (Translate / MirrorEdge) doesn't matter for reachability —
                    // both propagate writes from `from` to `to`.
                    if (c.from === id) followers = [c.to];
                    break;

                // ConformVisual + ConformRedirect are directional couplings
                // that don't propagate a translate-shaped delta, so they're
                // not included in movement closure.
            }

            for (const f of followers) {
                if (!closure.has(f)) {
                    closure.add(f);
                    queue.push(f);
                }
            }
        }
    }

    return closure;
}
