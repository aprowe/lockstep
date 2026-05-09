/**
 * Render harness for ScenesPanel — minimum store + DockBridge wiring.
 *
 * Scene cuts live per video path in scene.cutsByPath; the panel turns the
 * boundaries into segments (one row per [start, next-start) span). Pre-seed
 * via `cuts`, which drives both the cut list and the segment derivation.
 *
 * The list selection lives in lists.selection.scenes; pre-seed via
 * `selectedSceneIds` (segment-row ids — strings of segment indices).
 */

import { render, type RenderResult } from '@testing-library/react/pure'
import { Provider } from 'react-redux'
import { vi } from 'vitest'
import type { RefObject } from 'react'
import ScenesPanel from '../../src/layout/panels/ScenesPanel'
import { ThumbnailHoverProvider } from '../../src/components/ThumbnailPopup'
import { DockBridgeProvider, type DockBridge } from '../../src/layout/DockContext'
import { setVideo } from '../../src/store/slices/videoSlice'
import { setCuts as setSceneCuts } from '../../src/store/slices/sceneSlice'
import { setListFilterMode, setListSelection, type ListFilterMode } from '../../src/store/slices/listsSlice'
import { setView } from '../../src/store/slices/uiSlice'
import type { View } from '../../src/types'
import type { VideoPlayerHandle } from '../../src/components/VideoPlayer'
import { makeStore, makeVideoInfo } from '../helpers/setup'

export interface RenderScenesPanelOptions {
  duration?: number
  cuts?: number[]
  /** Pre-seed lists.selection.scenes (segment-row ids — stringified indices). */
  selectedSceneIds?: string[]
  view?: View
  filterMode?: ListFilterMode
}

export function renderScenesPanel(opts: RenderScenesPanelOptions = {}) {
  const store = makeStore()
  const duration = opts.duration ?? 120
  const cuts = opts.cuts ?? [10, 20, 30]

  const videoInfo = makeVideoInfo({ duration })
  store.dispatch(setVideo(videoInfo))
  store.dispatch(setSceneCuts({ path: videoInfo.path, cuts }))
  if (opts.selectedSceneIds) {
    store.dispatch(setListSelection({ list: 'scenes', ids: opts.selectedSceneIds }))
  }
  if (opts.view) store.dispatch(setView(opts.view))
  if (opts.filterMode) {
    store.dispatch(setListFilterMode({ list: 'scenes', mode: opts.filterMode }))
  }

  const seek = vi.fn()
  const setExportOpen = vi.fn()
  const setClipContextMenu = vi.fn()
  const playerRef: RefObject<VideoPlayerHandle | null> = { current: null }
  const bridge: DockBridge = { seek, setExportOpen, openExportLog: vi.fn(), playerRef, setClipContextMenu }

  const result = render(
    <Provider store={store}>
      <ThumbnailHoverProvider>
        <DockBridgeProvider value={bridge}>
          <ScenesPanel />
        </DockBridgeProvider>
      </ThumbnailHoverProvider>
    </Provider>,
  )

  return { ...(result as RenderResult), store, seek }
}
