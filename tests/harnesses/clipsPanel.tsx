/**
 * Render harness for the new ClipsPanel (replaces the legacy
 * RegionSidebar harness). Wires the bare minimum store + DockBridge so
 * the panel renders inside a fixture exactly as the live app would.
 */

import { render, type RenderResult } from '@testing-library/react/pure'
import { Provider } from 'react-redux'
import { vi } from 'vitest'
import type { RefObject } from 'react'
import ClipsPanel from '../../src/layout/panels/ClipsPanel'
import { ThumbnailHoverProvider } from '../../src/components/ThumbnailPopup'
import { DockBridgeProvider, type DockBridge } from '../../src/layout/DockContext'
import { setVideo } from '../../src/store/slices/videoSlice'
import { setRegions, setActiveRegionId } from '../../src/store/slices/regionSlice'
import { setPendingEdit } from '../../src/store/slices/listsSlice'
import type { Region } from '../../src/types'
import type { VideoPlayerHandle } from '../../src/components/VideoPlayer'
import { makeStore, makeVideoInfo } from '../helpers/setup'

const makeRegion = (id: string, name: string, inP: number, outP: number): Region => ({
  id, name, inPoint: inP, outPoint: outP,
  bpm: 120, minStretch: 0.5, maxStretch: 2.0, addToEnd: false,
  colorIndex: 0,
})

export interface RenderClipsPanelOptions {
  regions?: Region[]
  activeRegionId?: string | null
  pendingRenameId?: string | null
}

export function renderClipsPanel(opts: RenderClipsPanelOptions = {}) {
  const store = makeStore()
  store.dispatch(setVideo(makeVideoInfo({ duration: 120 })))
  store.dispatch(setRegions(opts.regions ?? [makeRegion('r1', 'Verse', 30, 45)]))
  if (opts.activeRegionId !== undefined) {
    store.dispatch(setActiveRegionId(opts.activeRegionId))
  }
  if (opts.pendingRenameId) {
    store.dispatch(setPendingEdit({ list: 'clips', id: opts.pendingRenameId }))
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
          <ClipsPanel />
        </DockBridgeProvider>
      </ThumbnailHoverProvider>
    </Provider>,
  )

  return { ...(result as RenderResult), store, seek, setExportOpen, setClipContextMenu }
}

export { makeRegion }
