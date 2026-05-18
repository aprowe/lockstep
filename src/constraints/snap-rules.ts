/**
 * Snap rules — declarative table that is the single source of truth for
 * which cohorts snap to which.  Editing one row here changes behavior;
 * no other code needs to be touched.
 *
 * Cohort tags:
 *   anchor-in     — all anchor-in entities (input-space anchors)
 *   anchor-out    — all anchor-out entities (beat-space anchors)
 *   clipin        — all clipin entities (input-space clip in-edges)
 *   clipout       — all clipout entities (beat-space clip out-edges) — base membership
 *   clipout:edge  — role-qualified dragger tag for clipout edge-resize gestures
 *   clipout:body  — role-qualified dragger tag for clipout body-pan gestures
 *   twin:{id}     — per-region cohort containing both clipin + clipout for that region
 *   scenes        — scene-marker entities (deferred: cohort is always empty for now)
 *   playhead      — playhead entity (deferred: cohort is empty until playhead is added)
 *   grid          — synthetic: not a real cohort; means "include beat-grid snap"
 */

import type { State } from './types'

export type CohortTag = string

export interface SnapRuleSpec {
  dragger:    CohortTag
  target:     CohortTag
  condition?: string
}

// ── The table ────────────────────────────────────────────────────────────────
//
// Each row is a DIRECTED edge: when an entity from `dragger` cohort is being
// dragged, entities in `target` cohort are valid snap targets.
// Symmetric relationships require two rows.

export const SNAP_RULES: readonly SnapRuleSpec[] = [
  // anchor-in drags
  { dragger: 'anchor-in',    target: 'anchor-out' },
  { dragger: 'anchor-in',    target: 'clipin' },
  { dragger: 'anchor-in',    target: 'scenes' },
  { dragger: 'anchor-in',    target: 'playhead' },

  // anchor-out drags
  { dragger: 'anchor-out',   target: 'anchor-out' },
  { dragger: 'anchor-out',   target: 'clipout' },
  { dragger: 'anchor-out',   target: 'playhead' },
  { dragger: 'anchor-out',   target: 'grid' },

  // clipin drags
  { dragger: 'clipin',       target: 'anchor-in' },
  { dragger: 'clipin',       target: 'scenes' },
  { dragger: 'clipin',       target: 'clipin' },
  { dragger: 'clipin',       target: 'playhead' },

  // clipout edge-resize
  { dragger: 'clipout:edge', target: 'twin' },
  { dragger: 'clipout:edge', target: 'grid', condition: 'lockMode-bpm-and-out-edge' },

  // clipout body-pan
  { dragger: 'clipout:body', target: 'twin' },

  // playhead has no snap targets

  // DEFERRED: { dragger: 'anchor-out', target: 'anchor-in', condition: 'warped' }
] as const

// ── Condition context ────────────────────────────────────────────────────────

export interface SnapConditionContext {
  state:         State
  draggedField:  'in' | 'out' | 'time'   // the field being dragged
}

export const SNAP_CONDITIONS: Record<string, (ctx: SnapConditionContext) => boolean> = {
  /** Grid snap for clipout edge-resize: only when lockMode=bpm AND the out edge is being dragged. */
  'lockMode-bpm-and-out-edge': (ctx) => {
    return ctx.state.globals.lockMode === 'bpm' && ctx.draggedField === 'out'
  },
  // 'warped': () => false,  // deferred
}
