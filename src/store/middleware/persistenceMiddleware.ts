import { createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit'
import type { RootState } from '../store'
import type { Anchor, SavedVideoState } from '../../types'
import { saveVideoState } from '../../api/storage'
import { writeVideoSidecar } from '../../api/warp'
import { updateMarkerCount, updateClipCount } from '../slices/videoSlice'
import { dragEnd } from '../slices/dragSlice'
import {
  setOrigAnchors,
  setBeatAnchors,
  addAnchor,
  removeAnchors,
  resetBeatLinks,
  clearAnchors,
  loadAnchors,
  setBpm,
  setMinStretch,
  setMaxStretch,
  setBeatZeroId,
  _syncAnchorPositions,
} from '../slices/warpSlice'
import {
  setRegions,
  addRegion,
  deleteRegion,
  renameRegion,
  updateRegionBpm,
  updateRegionLockedBeats,
  updateRegionStretch,
  _syncRegionPositions,
  _syncRegionMeta,
} from '../slices/regionSlice'
import { setCuts as setScenes, addCut, deleteCut, setMinGap as setSceneMinGap } from '../slices/sceneSlice'

export const persistenceMiddleware = createListenerMiddleware()

// Match any action that should trigger a save
const shouldSave = isAnyOf(
  // Warp state changes (slice ID-list / metadata mutations)
  setOrigAnchors, setBeatAnchors, addAnchor, removeAnchors,
  resetBeatLinks, clearAnchors, loadAnchors,
  setBpm, setMinStretch, setMaxStretch, setBeatZeroId,
  // Region state changes (slice metadata mutations)
  setRegions, addRegion, deleteRegion,
  updateRegionLockedBeats,
  renameRegion, updateRegionBpm, updateRegionStretch,
  // Scene detection results + user edits + min-gap setting
  setScenes, addCut, deleteCut, setSceneMinGap,
  // Pipeline slice writes — position mutations (replaces applyOp trigger)
  _syncAnchorPositions,
  _syncRegionPositions,
  _syncRegionMeta,
  // Drag end — one save after all the pointer-move commits complete
  dragEnd,
)

persistenceMiddleware.startListening({
  matcher: shouldSave,
  effect: async (_action, listenerApi) => {
    // Cancel any previous pending save
    listenerApi.cancelActiveListeners()

    // Debounce 500ms
    await listenerApi.delay(500)

    const state = listenerApi.getState() as RootState
    // Gate: skip rapid pointer-move commits during a drag. dragEnd IS in
    // shouldSave so when it arrives drag.active is already false — that triggers
    // the single post-drag save.
    if (state.drag.active) return

    const vid = state.video.video
    if (!vid) return

    const warp = state.warp

    // Slice is the source of truth for positions.
    const matOrigAnchors: Anchor[] = warp.origAnchors.map(a => ({ id: a.id, time: a.time }))

    // Determine which anchors are linked via the slice's beatAnchors[n].linked field.
    // absent or true = linked; false = diverged.
    const matBeatAnchors: Anchor[] = warp.beatAnchors.map(a => {
      const isLinked = a.linked !== false
      return isLinked ? { id: a.id, time: a.time } : { id: a.id, time: a.time, linked: false }
    })

    // Materialise region positions from the slice (source of truth).
    const matRegions = state.region.regions.map(r => ({ ...r }))

    const cuts = state.scene.cutsByPath[vid.path]
    const userCuts = state.scene.userCutsByPath[vid.path]
    const threshold = state.scene.thresholdByPath[vid.path]
    const minGap = state.scene.minGapByPath[vid.path]
    const hasSceneData =
      (cuts && cuts.length > 0) ||
      (userCuts && userCuts.length > 0) ||
      typeof threshold === 'number' ||
      typeof minGap === 'number'

    const savedState: SavedVideoState = {
      version: 2,
      defaultRegion: {
        origAnchors: matOrigAnchors,
        beatAnchors: matBeatAnchors,
        bpm: warp.bpm,
        minStretch: warp.minStretch,
        maxStretch: warp.maxStretch,
      },
      regions: matRegions,
      ...(hasSceneData
        ? {
            scenes: {
              threshold: threshold ?? 10,
              cuts: cuts ?? [],
              ...(typeof minGap === 'number' ? { minGap } : {}),
              ...(userCuts && userCuts.length > 0 ? { userCuts } : {}),
            },
          }
        : {}),
    }

    // Save to internal hash-based storage
    try {
      await saveVideoState(vid.fileHash, savedState)
    } catch { /* best effort */ }

    // Write sidecar next to source video (portable project file)
    try {
      await writeVideoSidecar(vid.path, JSON.stringify(savedState, null, 2))
    } catch { /* read-only location — best effort */ }

    // Update sidebar badge counts
    const count = savedState.defaultRegion.origAnchors.length
    listenerApi.dispatch(updateMarkerCount({ path: vid.path, count }))
    listenerApi.dispatch(updateClipCount({ path: vid.path, count: state.region.regions.length }))
  },
})
