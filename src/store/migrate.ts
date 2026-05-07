import type { SavedVideoState, Region } from '../types'

export interface MigrationResult {
  /** Possibly-modified state. Same reference as the input when no migration ran. */
  state: SavedVideoState | null
  /** Id of the region the migration synthesized, if one was added. Callers
   *  can use this to land the user inside the new region instead of in the
   *  legacy "Full Video" sentinel. */
  migratedRegionId: string | null
}

/** Migrate a loaded `SavedVideoState` toward the issue #18 model where warping
 *  only happens *inside regions* — there's no "full video" mode with global
 *  BPM/anchors anymore.
 *
 *  Behavior:
 *  - `null` → returned unchanged (fresh project, nothing to migrate).
 *  - State with one or more existing regions → returned unchanged.
 *  - State whose `defaultRegion` carries warp content (anchors or non-default
 *    BPM) and has no user regions → a synthesized full-span region is added,
 *    carrying the defaultRegion's BPM, stretch bounds, and addToEnd flag.
 *    The defaultRegion itself is left intact for now — later phases retire
 *    it once nothing reads from it.
 *  - State whose `defaultRegion` has no warp content → returned unchanged
 *    (no synthesis — there's nothing to migrate).
 *
 *  Idempotent: running it twice produces the same output as running it once. */
export function migrateSavedVideoState(
  state: SavedVideoState | null,
  duration: number,
): MigrationResult {
  if (!state) return { state, migratedRegionId: null }
  if (state.regions.length > 0) return { state, migratedRegionId: null }
  if (duration <= 0) return { state, migratedRegionId: null }

  const dr = state.defaultRegion
  const hasAnchors = (dr.origAnchors?.length ?? 0) > 0
  const nonDefaultBpm = (dr.bpm ?? 120) !== 120
  if (!hasAnchors && !nonDefaultBpm) return { state, migratedRegionId: null }

  const migrated: Region = {
    id: `region_migrated_${Date.now().toString(36)}`,
    name: 'Full clip',
    inPoint: 0,
    outPoint: duration,
    bpm: dr.bpm ?? 120,
    minStretch: dr.minStretch ?? 0.5,
    maxStretch: dr.maxStretch ?? 2.0,
    addToEnd: dr.addToEnd ?? false,
  }

  return {
    state: { ...state, regions: [migrated] },
    migratedRegionId: migrated.id,
  }
}
