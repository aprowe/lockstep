/**
 * Entity-ID helpers for the constraint graph.
 *
 * Live ID scheme
 * ──────────────
 *   Anchor pair  id=N (number)  → `a{N}-in`  + `a{N}-out`
 *   Clip         id=S (string)  → `{S}-in`   + `{S}-out`
 *
 * where S is the slice region ID, which looks like `region_<timestamp>_<i>_<xxx>`.
 * The spec's `r{N}` notation was illustrative only — real region IDs are the
 * slice-generated strings from `videoThunks`.
 *
 * Anchor in/out:    `a{N}-in`  carries the input (orig) time
 *                   `a{N}-out` carries the beat-space (output) time
 * Clip in/out:      `{S}-in`   is the input-space clip (in=inPoint, out=outPoint)
 *                   `{S}-out`  is the beat-space clip (in=inBeatTime ?? inPoint,
 *                                                      out=outBeatTime ?? outPoint)
 *
 * Parsing / partitioning
 * ──────────────────────
 * Anchor IDs are always `a{digits}-in` or `a{digits}-out`.  Clip IDs are
 * everything else that ends in `-in` / `-out`. `parseEntityId()` returns the
 * discriminated `EntityKind` so Phase 2 lasso / selection logic can split
 * entities by prefix without ad-hoc string checks.
 */

import type { EntityId } from './types'

// ── Anchors ──────────────────────────────────────────────────────────────────

export function anchorInId(anchorId: number): EntityId {
  return `a${anchorId}-in`
}

export function anchorOutId(anchorId: number): EntityId {
  return `a${anchorId}-out`
}

// ── Regions / clips ──────────────────────────────────────────────────────────

export function regionInId(regionId: string): EntityId {
  return `${regionId}-in`
}

export function regionOutId(regionId: string): EntityId {
  return `${regionId}-out`
}

// ── Parsing ──────────────────────────────────────────────────────────────────

export type EntityKind = 'anchor-in' | 'anchor-out' | 'clip-in' | 'clip-out'

const ANCHOR_IN_RE  = /^a(\d+)-in$/
const ANCHOR_OUT_RE = /^a(\d+)-out$/

/**
 * Parse a graph entity ID into its kind and source ID.
 *
 * Returns `null` if the ID doesn't match any known pattern (e.g. bare or
 * malformed IDs that lack a recognised `-in` / `-out` suffix).
 *
 * Disambiguation rule: anchor IDs match `a{digits}-in/out`; any other
 * `-in`/`-out` suffixed ID is a clip (region). This is unambiguous because
 * real region IDs start with `region_` — they can never match `a\d+`.
 */
export function parseEntityId(id: EntityId): { kind: EntityKind; sourceId: string } | null {
  let m: RegExpMatchArray | null
  if ((m = id.match(ANCHOR_IN_RE)))  return { kind: 'anchor-in',  sourceId: m[1] }
  if ((m = id.match(ANCHOR_OUT_RE))) return { kind: 'anchor-out', sourceId: m[1] }
  if (id.endsWith('-in'))            return { kind: 'clip-in',    sourceId: id.slice(0, -3) }
  if (id.endsWith('-out'))           return { kind: 'clip-out',   sourceId: id.slice(0, -4) }
  return null
}

// ── Kind predicates ──────────────────────────────────────────────────────────

export function isAnchorIn (id: EntityId): boolean { return parseEntityId(id)?.kind === 'anchor-in'  }
export function isAnchorOut(id: EntityId): boolean { return parseEntityId(id)?.kind === 'anchor-out' }
export function isClipIn   (id: EntityId): boolean { return parseEntityId(id)?.kind === 'clip-in'    }
export function isClipOut  (id: EntityId): boolean { return parseEntityId(id)?.kind === 'clip-out'   }
