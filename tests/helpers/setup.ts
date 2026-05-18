/**
 * Shared store factory and test fixtures for BDD tests.
 *
 * vi.mock() calls cannot be shared (they must be hoisted at each test module's
 * top level), but the store factory and fixture builders can be.
 */

import { configureStore } from '@reduxjs/toolkit'
import videoReducer from '../../src/store/slices/videoSlice'
import uiReducer from '../../src/store/slices/uiSlice'
import warpReducer from '../../src/store/slices/warpSlice'
import regionReducer from '../../src/store/slices/regionSlice'
import historyReducer from '../../src/store/slices/historySlice'
import sceneReducer from '../../src/store/slices/sceneSlice'
import thumbnailsReducer from '../../src/store/slices/thumbnailsSlice'
import settingsReducer from '../../src/store/slices/settingsSlice'
import listsReducer from '../../src/store/slices/listsSlice'
import dragReducer from '../../src/store/slices/dragSlice'
import dragCtxReducer from '../../src/store/slices/dragCtxSlice'
import { persistenceMiddleware } from '../../src/store/middleware/persistenceMiddleware'
import { historyMiddleware } from '../../src/store/middleware/historyMiddleware'
import { selectionGraphMirrorMiddleware } from '../../src/store/middleware/selectionGraphMirrorMiddleware'
import { anchorLockMirrorMiddleware } from '../../src/store/middleware/anchorLockMirrorMiddleware'
import type { VideoInfo, SavedVideoState } from '../../src/types'

export function makeStore() {
  return configureStore({
    reducer: {
      video: videoReducer,
      ui: uiReducer,
      warp: warpReducer,
      region: regionReducer,
      history: historyReducer,
      scene: sceneReducer,
      thumbnails: thumbnailsReducer,
      settings: settingsReducer,
      lists: listsReducer,
      drag: dragReducer,
      dragCtx: dragCtxReducer,
    },
    middleware: (getDefault) =>
      getDefault({
        serializableCheck: {
          ignoredActionPaths: ['payload.constraint', 'payload.apply', 'payload.predicate'],
        },
      })
        .prepend(persistenceMiddleware.middleware)
        .prepend(historyMiddleware.middleware)
        .concat(selectionGraphMirrorMiddleware)
        .concat(anchorLockMirrorMiddleware),
  })
}

export function makeVideoInfo(overrides: Partial<VideoInfo> = {}): VideoInfo {
  return {
    path: '/videos/concert.mp4',
    originalName: 'concert.mp4',
    videoUrl: 'tauri://localhost//videos/concert.mp4',
    duration: 120,
    fps: 30,
    fileHash: 'abc123',
    ...overrides,
  }
}

export function makeSavedState(
  overrides: Partial<SavedVideoState['defaultRegion']> = {},
): SavedVideoState {
  return {
    version: 2,
    defaultRegion: {
      origAnchors: [{ id: 1, time: 5 }, { id: 2, time: 10 }],
      beatAnchors: [{ id: 1, time: 5 }, { id: 2, time: 11 }],
      bpm: 140,
      minStretch: 0.5,
      maxStretch: 2.0,
      beatZeroAnchorTime: null,
      ...overrides,
    },
    regions: [],
  }
}
