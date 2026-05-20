/**
 * snapIndex — derived lookup structure for O(1) cohort queries at snap install.
 *
 * `buildSnapIndex` scans the constraint list for SnapCohort and SnapRule
 * constraints and assembles the index.  It is cheap to rebuild on every
 * `snapToSiblings` call (few cohorts, few rules), so no caching layer is
 * provided by default.  If profiling shows cost, the caller can memoize.
 */

import type { State, SnapIndex, SnapRule } from "./types";
import { ConstraintKind } from "./types";

export function buildSnapIndex(state: State): SnapIndex {
    const idsByCohort = new Map<string, string[]>();
    const cohortsByEntity = new Map<string, string[]>();
    const rules: SnapRule[] = [];

    for (const c of state.constraints) {
        if (c.kind === ConstraintKind.SnapCohort) {
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
        } else if (c.kind === ConstraintKind.SnapRule) {
            rules.push(c);
        }
    }

    return { idsByCohort, cohortsByEntity, rules };
}
