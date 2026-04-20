import { createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit'
import type { RootState } from '../store'
import type { SavedVideoState } from '../../types'
import { saveVideoState } from '../../api/storage'
import { writeVideoSidecar } from '../../api/warp'
import { updateMarkerCount } from '../slices/videoSlice'
import {
  setOrigAnchors,
  setBeatAnchors,
  addAnchor,
  removeAnchors,
  moveOrigAnchor,
  setOrigAnchorsFromTimeline,
  moveBeatAnchor,
  setBeatAnchorsFromTimeline,
  resetBeatLinks,
  clearAnchors,
  loadAnchors,
  setBpm,
  setMinStretch,
  setMaxStretch,
  setBeatZeroId,
  setLoopBeats,
  setTrimToLoop,
  setAddToEnd,
} from '../slices/warpSlice'
import {
  setRegions,
  addRegion,
  deleteRegion,
  updateRegionInOut,
  updateRegionBeatTimes,
  updateRegionLock,
  renameRegion,
  updateRegionBpm,
  updateRegionStretch,
  updateRegionTriggerMode,
} from '../slices/regionSlice'
import { setCuts as setScenes } from '../slices/sceneSlice'

export const persistenceMiddleware = createListenerMiddleware()

// Match any action that should trigger a save
const shouldSave = isAnyOf(
  // Warp state changes
  setOrigAnchors, setBeatAnchors, addAnchor, removeAnchors,
  moveOrigAnchor, setOrigAnchorsFromTimeline,
  moveBeatAnchor, setBeatAnchorsFromTimeline,
  resetBeatLinks, clearAnchors, loadAnchors,
  setBpm, setMinStretch, setMaxStretch, setBeatZeroId,
  setLoopBeats, setTrimToLoop, setAddToEnd,
  // Region state changes
  setRegions, addRegion, deleteRegion,
  updateRegionInOut, updateRegionBeatTimes, updateRegionLock,
  renameRegion, updateRegionBpm, updateRegionStretch, updateRegionTriggerMode,
  // Scene detection results
  setScenes,
)

persistenceMiddleware.startListening({
  matcher: shouldSave,
  effect: async (_action, listenerApi) => {
    // Cancel any previous pending save
    listenerApi.cancelActiveListeners()

    // Debounce 500ms
    await listenerApi.delay(500)

    const state = listenerApi.getState() as RootState
    const vid = state.video.video
    if (!vid) return

    const warp = state.warp

    // Compute beat-zero anchor time for persistence
    const sortedOrig = [...warp.origAnchors].sort((a, b) => a.time - b.time)
    const sortedBeat = sortedOrig.map(oa => warp.beatAnchors.find(ba => ba.id === oa.id)).filter(Boolean)
    let beatZeroTime = sortedBeat[0]?.time ?? 0
    if (warp.beatZeroId !== null) {
      const z = sortedBeat.find(a => a?.id === warp.beatZeroId)
      if (z) beatZeroTime = z.time
    }

    const cuts = state.scene.cutsByPath[vid.path]
    const threshold = state.scene.thresholdByPath[vid.path]

    const savedState: SavedVideoState = {
      version: 2,
      defaultRegion: {
        origAnchors: warp.origAnchors,
        beatAnchors: warp.beatAnchors,
        bpm: warp.bpm,
        minStretch: warp.minStretch,
        maxStretch: warp.maxStretch,
        beatZeroAnchorTime: beatZeroTime,
        loopBeats: warp.loopBeats,
        trimToLoop: warp.trimToLoop,
        addToEnd: warp.addToEnd,
      },
      regions: state.region.regions,
      ...(cuts && typeof threshold === 'number'
        ? { scenes: { threshold, cuts } }
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

    // Update marker count for sidebar badge
    const count = savedState.defaultRegion.origAnchors.length
    listenerApi.dispatch(updateMarkerCount({ path: vid.path, count }))
  },
})
