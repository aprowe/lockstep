/**
 * Constraint-based timeline model.
 *
 *   import { reduce, recipes, emptyState } from './constraints'
 *
 * Entry points:
 *   reduce(state, op)  — apply an op + propagate constraints, returns new state.
 *   emptyState()       — fresh empty state.
 *   recipes.*          — high-level gestures (lasso, lockOn, snapToSiblings, ...).
 */

export * from './types'
export {
  reduce,
  emptyState,
  bpmDerivedConstraint,
  findSnapCandidates,
  readEntityField,
} from './resolver'
export { movementClosure } from './closure'
export * as recipes from './recipes'
