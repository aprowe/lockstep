import type { EntityId, State } from './types'
import { ConstraintKind } from './types'

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
 * Non-write constraints (Clamp, PreserveLength, SnapTarget, ConformVisual,
 * Derived, SingleOfKind, DeleteGroup, HighlightGroup) are ignored — they
 * don't propagate position writes.
 */
export function movementClosure(state: State, seed: EntityId): Set<EntityId> {
  const closure = new Set<EntityId>([seed])
  const queue: EntityId[] = [seed]

  while (queue.length > 0) {
    const id = queue.shift()!
    for (const c of state.constraints) {
      let followers: readonly EntityId[] = []

      switch (c.kind) {
        case ConstraintKind.TranslateGroup:
          if (c.driver === undefined) {
            if (c.ids.includes(id)) followers = c.ids
          } else if (c.driver === id) {
            followers = c.ids
          }
          break

        case ConstraintKind.ScaleGroup:
          if (c.driver === id) followers = c.ids
          break

        case ConstraintKind.DirectedPair:
          // mode (Translate / MirrorEdge) doesn't matter for reachability —
          // both propagate writes from `from` to `to`.
          if (c.from === id) followers = [c.to]
          break
      }

      for (const f of followers) {
        if (!closure.has(f)) {
          closure.add(f)
          queue.push(f)
        }
      }
    }
  }

  return closure
}
