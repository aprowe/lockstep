/**
 * Render harness for the full ThinTimeline component plus the cross-slice
 * timeline callbacks (handleTimelineDelete, handleTimelineDeselect) that
 * CenterColumn composes in the live app.
 *
 * Use this whenever a test needs to exercise focus-scoped timeline keyboard
 * shortcuts, lasso behaviour, or empty-area click semantics. Tests pre-seed
 * regions / anchors / selections through the options bag and then assert
 * against the returned store after firing user events on the rendered DOM.
 */

import { useMemo } from 'react'
import { render, type RenderResult } from '@testing-library/react/pure'
import { Provider } from 'react-redux'
import { createSelector } from '@reduxjs/toolkit'
import ThinTimeline from '../../src/components/thin/ThinTimeline'
import type { RegionBlock } from '../../src/components/thin/RegionBand'
import { setVideo } from '../../src/store/slices/videoSlice'
import {
  setRegions,
  setActiveRegionId,
  deleteRegion,
} from '../../src/store/slices/regionSlice'
import {
  loadAnchors,
  setSelectedIds as setSelectedAnchorIds,
  removeAnchors,
} from '../../src/store/slices/warpSlice'
import { setListSelection } from '../../src/store/slices/listsSlice'
import {
  setCuts as setSceneCuts,
  setSelectedCutTimes,
  deleteCut as deleteSceneCut,
} from '../../src/store/slices/sceneSlice'
import { selectSelectedIdsSet } from '../../src/store/selectors'
import { useAppSelector } from '../../src/store/hooks'
import type { Anchor, Region, View } from '../../src/types'
import { makeStore, makeVideoInfo } from '../helpers/setup'

const selectSelectedClipIdsSet = createSelector(
  (s: { lists: { selection: { clips: string[] } } }) => s.lists.selection.clips,
  (ids) => new Set(ids),
)

const selectSelectedSceneTimesSet = createSelector(
  (s: { scene: { selectedCutTimes: number[] } }) => s.scene.selectedCutTimes,
  (times) => new Set(times),
)

export interface RenderThinTimelineOptions {
  duration?: number
  view?: View
  regions?: Region[]
  activeRegionId?: string | null
  anchors?: Anchor[]
  /** Defaults to anchors (1:1 input/output map) when omitted. */
  beatAnchors?: Anchor[]
  scenes?: number[]
  /** Pre-seed lists.selection.clips before render. */
  selectedClipIds?: string[]
  /** Pre-seed warp.selectedIds (markers selection) before render. */
  selectedMarkerIds?: number[]
  /** Pre-seed scene.selectedCutTimes before render. Times must match
   *  entries in `scenes` for handleTimelineDelete to actually remove them. */
  selectedSceneTimes?: number[]
  bpm?: number
  warpCollapsed?: boolean
}

/**
 * Inner wrapper that mirrors WarpView — subscribes to live store state and
 * feeds it to ThinTimeline as props so the rendered timeline reacts to
 * dispatches the way the real app does.
 */
function ThinTimelineHarness(props: {
  duration: number
  view: View
  regions: Region[]
  anchors: Anchor[]
  beatAnchors: Anchor[]
  scenes: number[]
  bpm: number
  warpCollapsed: boolean
  onTimelineDelete: () => void
  onTimelineDeselect: () => void
  onConnectorSelectionChange: (ids: Set<number>) => void
  onClipsSelectionChange: (ids: Set<string>) => void
  onScenesSelectionChange: (times: Set<number>) => void
}) {
  const selectedAnchorIds = useAppSelector(selectSelectedIdsSet)
  const selectedClipIds = useAppSelector(selectSelectedClipIdsSet)
  const selectedSceneTimes = useAppSelector(selectSelectedSceneTimesSet)
  const blocks = useMemo<RegionBlock[]>(
    () => props.regions.map(r => ({
      id: r.id,
      label: r.name,
      inPoint: r.inPoint,
      outPoint: r.outPoint,
      active: false,
      colorIndex: r.colorIndex,
    })),
    [props.regions],
  )

  return (
    <ThinTimeline
      duration={props.duration}
      outputDuration={props.duration}
      view={props.view}
      onViewChange={() => {}}
      maxDuration={props.duration}
      playhead={0}
      onSeek={() => {}}
      anchors={props.anchors}
      selectedAnchorIds={selectedAnchorIds}
      beatAnchors={props.beatAnchors}
      bpm={props.bpm}
      scenes={props.scenes}
      regions={blocks}
      segments={[]}
      selectedClipIds={selectedClipIds}
      selectedSceneTimes={selectedSceneTimes}
      onConnectorSelectionChange={props.onConnectorSelectionChange}
      onClipsSelectionChange={props.onClipsSelectionChange}
      onScenesSelectionChange={props.onScenesSelectionChange}
      onTimelineDelete={props.onTimelineDelete}
      onTimelineDeselect={props.onTimelineDeselect}
      warpCollapsed={props.warpCollapsed}
    />
  )
}

export function renderThinTimeline(opts: RenderThinTimelineOptions = {}) {
  const store = makeStore()
  const duration = opts.duration ?? 120
  const view = opts.view ?? { start: 0, end: duration }
  const regions = opts.regions ?? []
  const anchors = opts.anchors ?? []
  const beatAnchors = opts.beatAnchors ?? anchors
  const scenes = opts.scenes ?? []

  const videoInfo = makeVideoInfo({ duration })
  const videoPath = videoInfo.path
  store.dispatch(setVideo(videoInfo))
  store.dispatch(setRegions(regions))
  if (opts.activeRegionId !== undefined) {
    store.dispatch(setActiveRegionId(opts.activeRegionId))
  }
  store.dispatch(loadAnchors({ origAnchors: anchors, beatAnchors }))
  // Seed scene cuts into sceneSlice keyed by the video path so the composed
  // handleTimelineDelete (mirror of CenterColumn) can call deleteCut against
  // the right path-keyed bucket.
  if (scenes.length > 0) {
    store.dispatch(setSceneCuts({ path: videoPath, cuts: scenes }))
  }
  if (opts.selectedClipIds) {
    store.dispatch(setListSelection({ list: 'clips', ids: opts.selectedClipIds }))
  }
  if (opts.selectedMarkerIds) {
    store.dispatch(setSelectedAnchorIds(opts.selectedMarkerIds))
  }
  if (opts.selectedSceneTimes) {
    store.dispatch(setSelectedCutTimes(opts.selectedSceneTimes))
  }

  // Mirror CenterColumn's composition of the union-delete and clear-all
  // callbacks. Tests assert against the resulting store state.
  const handleTimelineDelete = () => {
    const s = store.getState()
    const clipIds = s.lists.selection.clips
    const markerIds = s.warp.selectedIds
    const sceneTimes = s.scene.selectedCutTimes
    if (clipIds.length > 0) {
      for (const id of clipIds) store.dispatch(deleteRegion(id))
      store.dispatch(setListSelection({ list: 'clips', ids: [] }))
    }
    if (markerIds.length > 0) {
      store.dispatch(removeAnchors([...markerIds]))
      store.dispatch(setSelectedAnchorIds([]))
    }
    if (sceneTimes.length > 0) {
      for (const t of sceneTimes) {
        store.dispatch(deleteSceneCut({ path: videoPath, cut: t }))
      }
      store.dispatch(setSelectedCutTimes([]))
    }
  }
  const handleTimelineDeselect = () => {
    const s = store.getState()
    if (s.lists.selection.clips.length > 0) {
      store.dispatch(setListSelection({ list: 'clips', ids: [] }))
    }
    if (s.warp.selectedIds.length > 0) {
      store.dispatch(setSelectedAnchorIds([]))
    }
    if (s.scene.selectedCutTimes.length > 0) {
      store.dispatch(setSelectedCutTimes([]))
    }
  }

  // Lasso writes flow back into the store so tests can read the resulting
  // selection from any of the three slices, mirroring WarpView's wiring.
  const onConnectorSelectionChange = (ids: Set<number>) => {
    store.dispatch(setSelectedAnchorIds([...ids]))
  }
  const onClipsSelectionChange = (ids: Set<string>) => {
    store.dispatch(setListSelection({ list: 'clips', ids: [...ids] }))
  }
  const onScenesSelectionChange = (times: Set<number>) => {
    store.dispatch(setSelectedCutTimes([...times]))
  }

  const result = render(
    <Provider store={store}>
      <ThinTimelineHarness
        duration={duration}
        view={view}
        regions={regions}
        anchors={anchors}
        beatAnchors={beatAnchors}
        scenes={scenes}
        bpm={opts.bpm ?? 120}
        warpCollapsed={opts.warpCollapsed ?? false}
        onTimelineDelete={handleTimelineDelete}
        onTimelineDeselect={handleTimelineDeselect}
        onConnectorSelectionChange={onConnectorSelectionChange}
        onClipsSelectionChange={onClipsSelectionChange}
        onScenesSelectionChange={onScenesSelectionChange}
      />
    </Provider>,
  )

  return { ...(result as RenderResult), store, videoPath }
}

export function makeAnchor(id: number, time: number): Anchor {
  return { id, time }
}

export function makeRegion(
  id: string,
  name: string,
  inP: number,
  outP: number,
  colorIndex = 0,
): Region {
  return {
    id, name, inPoint: inP, outPoint: outP,
    bpm: 120, minStretch: 0.5, maxStretch: 2.0, addToEnd: false, colorIndex,
  }
}
