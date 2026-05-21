/**
 * snapIndex — derived lookup structure for O(1) cohort queries at snap install.
 *
 * `buildSnapIndex` scans the SnapCohort and SnapRule kind buckets (constant
 * size in practice — a few dozen at most) and assembles the cohort maps and
 * rule list. The bucket lookup skips the rest of the constraint graph, which
 * matters at scale where most constraints are conform bindings or anchor
 * pairs.
 *
 * Callers should prefer `snapIndexFor(state)` in `derived-index.ts`, which
 * caches the result per `state.constraints` reference. `buildSnapIndex`
 * remains exported for tests and for the cache to call through to.
 */

import type { State, SnapIndex, SnapRule } from "./types";
import { ConstraintKind } from "./types";
import { constraintsByKind } from "./derived-index";

/**
 * Build a `SnapIndex` from the SnapCohort and SnapRule constraints in `state`.
 *
 * @param state - The constraint graph state to scan.
 * @returns Forward (cohort → ids) and reverse (entity → cohort tags) lookup
 *          maps plus the list of installed SnapRules.
 */
export function buildSnapIndex(state: State): SnapIndex {
    const idsByCohort = new Map<string, string[]>();
    const cohortsByEntity = new Map<string, string[]>();
    const rules: SnapRule[] = [];

    for (const c of constraintsByKind(state, ConstraintKind.SnapCohort)) {
        if (c.kind !== ConstraintKind.SnapCohort) continue;
        // Register the cohort.
        idsByCohort.set(c.tag, [...c.ids]);
        // Register reverse mapping.
        for (const id of c.ids) {
            let tags = cohortsByEntity.get(id);
            if (!tags) {
                tags = [];
                cohortsByEntity.set(id, tags);
            }
            if (!tags.includes(c.tag)) tags.push(c.tag);
        }
    }

    for (const c of constraintsByKind(state, ConstraintKind.SnapRule)) {
        if (c.kind !== ConstraintKind.SnapRule) continue;
        rules.push(c);
    }

    return { idsByCohort, cohortsByEntity, rules };
}
