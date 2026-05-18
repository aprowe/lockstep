/**
 * Render harness for MarkersPanel — minimum store + DockBridge wiring so
 * tests can fire UI events against the real panel as the live app does.
 *
 * Markers selection lives in warp.selectedIds (number ids), separate from
 * the lists.selection.markers slot. Pre-seed via `selectedAnchorIds`.
 */

import { render, type RenderResult } from '@testing-library/react/pure'
import { Provider } from 'react-redux'
import { vi } from 'vitest'
import type { RefObject } from 'react'
import MarkersPanel from '../../src/layout/panels/MarkersPanel'
import { ThumbnailHoverProvider } from '../../src/components/ThumbnailPopup'
import { DockBridgeProvider, type DockBridge } from '../../src/layout/DockContext'
import { setVideo } from '../../src/store/slices/videoSlice'
import { loadAnchors, setSelectedOrigIds as setSelectedOrigAnchorIds } from '../../src/store/slices/warpSlice'
import { setListFilterMode, type ListFilterMode } from '../../src/store/slices/listsSlice'
import { setView } from '../../src/store/slices/uiSlice'
import type { Anchor, View } from '../../src/types'
import type { VideoPlayerHandle } from '../../src/components/VideoPlayer'
import { makeStore, makeVideoInfo } from '../helpers/setup'

export interface RenderMarkersPanelOptions {
  anchors?: Anchor[]
  /** Defaults to anchors (1:1 input/output map). */
  beatAnchors?: Anchor[]
  selectedAnchorIds?: number[]
  view?: View
  filterMode?: ListFilterMode
}

export function renderMarkersPanel(opts: RenderMarkersPanelOptions = {}) {
  const store = makeStore()
  const anchors = opts.anchors ?? [
    { id: 1, time: 5 },
    { id: 2, time: 15 },
    { id: 3, time: 25 },
  ]
  const beatAnchors = opts.beatAnchors ?? anchors
  store.dispatch(setVideo(makeVideoInfo({ duration: 120 })))
  store.dispatch(loadAnchors({ origAnchors: anchors, beatAnchors }))
  if (opts.selectedAnchorIds) {
    store.dispatch(setSelectedOrigAnchorIds(opts.selectedAnchorIds))
  }
  if (opts.view) store.dispatch(setView(opts.view))
  if (opts.filterMode) {
    store.dispatch(setListFilterMode({ list: 'markers', mode: opts.filterMode }))
  }

  const seek = vi.fn()
  const setExportOpen = vi.fn()
  const setClipContextMenu = vi.fn()
  const playerRef: RefObject<VideoPlayerHandle | null> = { current: null }
  const bridge: DockBridge = { seek, setExportOpen, playerRef, setClipContextMenu }

  const result = render(
    <Provider store={store}>
      <ThumbnailHoverProvider>
        <DockBridgeProvider value={bridge}>
          <MarkersPanel />
        </DockBridgeProvider>
      </ThumbnailHoverProvider>
    </Provider>,
  )

  return { ...(result as RenderResult), store, seek }
}
