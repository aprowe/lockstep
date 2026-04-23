/**
 * Combined render harness — mounts ThinTimeline and a list panel
 * (ClipsPanel or MarkersPanel) inside the same Redux store + DockBridge,
 * so cross-component mirroring scenarios can drive one side and assert
 * against the other.
 *
 * Both sides own their own selection wiring in the live app:
 *   - Lasso on the timeline writes to lists.selection.clips (clips) or
 *     warp.selectedIds (markers).
 *   - List panels subscribe to those slices, so checkboxes appear on
 *     each selected row when 2+ are selected.
 *   - Clicking a row writes back to the same slices, which the timeline
 *     consumes via region.selected → .thin-region--selected styling.
 *
 * The shared store is what ties them together — no extra props.
 */

import { useMemo } from 'react'
import { render, type RenderResult } from '@testing-library/react/pure'
import { Provider } from 'react-redux'
import { vi } from 'vitest'
import { createSelector } from '@reduxjs/toolkit'
import type { RefObject } from 'react'
import ThinTimeline from '../../src/components/thin/ThinTimeline'
import type { RegionBlock } from '../../src/components/thin/RegionBand'
import ClipsPanel from '../../src/layout/panels/ClipsPanel'
import MarkersPanel from '../../src/layout/panels/MarkersPanel'
import { ThumbnailHoverProvider } from '../../src/components/ThumbnailPopup'
import { DockBridgeProvider, type DockBridge } from '../../src/layout/DockContext'
import { setVideo } from '../../src/store/slices/videoSlice'
import { setRegions, setActiveRegionId } from '../../src/store/slices/regionSlice'
import {
  loadAnchors,
  setSelectedIds as setSelectedAnchorIds,
} from '../../src/store/slices/warpSlice'
import { setListSelection } from '../../src/store/slices/listsSlice'
import { selectSelectedIdsSet } from '../../src/store/selectors'
import { useAppSelector } from '../../src/store/hooks'
import type { Anchor, Region, View } from '../../src/types'
import type { VideoPlayerHandle } from '../../src/components/VideoPlayer'
import type { RootState } from '../../src/store/store'
import { makeStore, makeVideoInfo } from '../helpers/setup'

const selectSelectedClipIdsSet = createSelector(
  (s: RootState) => s.lists.selection.clips,
  (ids) => new Set(ids),
)

export interface RenderTimelineAndPanelOptions {
  panel: 'clips' | 'markers'
  duration?: number
  view?: View
  regions?: Region[]
  activeRegionId?: string | null
  anchors?: Anchor[]
  /** Defaults to anchors. */
  beatAnchors?: Anchor[]
  selectedClipIds?: string[]
  selectedMarkerIds?: number[]
}

function TimelineHost(props: {
  duration: number
  view: View
  regions: Region[]
  anchors: Anchor[]
  beatAnchors: Anchor[]
  onConnectorSelectionChange: (ids: Set<number>) => void
  onClipsSelectionChange: (ids: Set<string>) => void
}) {
  const selectedAnchorIds = useAppSelector(selectSelectedIdsSet)
  const selectedClipIds = useAppSelector(selectSelectedClipIdsSet)
  const activeRegionId = useAppSelector((s: RootState) => s.region.activeRegionId)
  const blocks = useMemo<RegionBlock[]>(
    () => props.regions.map(r => ({
      id: r.id,
      label: r.name,
      inPoint: r.inPoint,
      outPoint: r.outPoint,
      active: r.id === activeRegionId,
      // Mirror the live wiring — region.selected drives the timeline's
      // accent outline (.thin-region--selected) so cross-component tests
      // can assert "selecting in the list highlights on the timeline".
      selected: selectedClipIds.has(r.id),
      colorIndex: r.colorIndex,
    })),
    [props.regions, activeRegionId, selectedClipIds],
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
      bpm={120}
      scenes={[]}
      regions={blocks}
      segments={[]}
      selectedClipIds={selectedClipIds}
      onConnectorSelectionChange={props.onConnectorSelectionChange}
      onClipsSelectionChange={props.onClipsSelectionChange}
      warpCollapsed={false}
    />
  )
}

export function renderTimelineAndPanel(opts: RenderTimelineAndPanelOptions) {
  const store = makeStore()
  const duration = opts.duration ?? 120
  const view = opts.view ?? { start: 0, end: 100 }
  const regions = opts.regions ?? []
  const anchors = opts.anchors ?? []
  const beatAnchors = opts.beatAnchors ?? anchors

  store.dispatch(setVideo(makeVideoInfo({ duration })))
  store.dispatch(setRegions(regions))
  if (opts.activeRegionId !== undefined) {
    store.dispatch(setActiveRegionId(opts.activeRegionId))
  }
  store.dispatch(loadAnchors({ origAnchors: anchors, beatAnchors }))
  if (opts.selectedClipIds) {
    store.dispatch(setListSelection({ list: 'clips', ids: opts.selectedClipIds }))
  }
  if (opts.selectedMarkerIds) {
    store.dispatch(setSelectedAnchorIds(opts.selectedMarkerIds))
  }

  const onConnectorSelectionChange = (ids: Set<number>) => {
    store.dispatch(setSelectedAnchorIds([...ids]))
  }
  const onClipsSelectionChange = (ids: Set<string>) => {
    store.dispatch(setListSelection({ list: 'clips', ids: [...ids] }))
  }

  const seek = vi.fn()
  const setExportOpen = vi.fn()
  const setClipContextMenu = vi.fn()
  const playerRef: RefObject<VideoPlayerHandle | null> = { current: null }
  const bridge: DockBridge = { seek, setExportOpen, playerRef, setClipContextMenu }

  const PanelComponent = opts.panel === 'clips' ? ClipsPanel : MarkersPanel

  const result = render(
    <Provider store={store}>
      <ThumbnailHoverProvider>
        <DockBridgeProvider value={bridge}>
          <div className="combined-fixture">
            <TimelineHost
              duration={duration}
              view={view}
              regions={regions}
              anchors={anchors}
              beatAnchors={beatAnchors}
              onConnectorSelectionChange={onConnectorSelectionChange}
              onClipsSelectionChange={onClipsSelectionChange}
            />
            <PanelComponent />
          </div>
        </DockBridgeProvider>
      </ThumbnailHoverProvider>
    </Provider>,
  )

  return { ...(result as RenderResult), store, seek }
}
