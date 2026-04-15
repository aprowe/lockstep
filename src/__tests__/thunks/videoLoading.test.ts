/**
 * @behavior video-loading::c912c
 *
 *   When a video is loaded, the viewport will change to the length of the video
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { configureStore } from '@reduxjs/toolkit'
import videoReducer from '../../store/slices/videoSlice'
import uiReducer from '../../store/slices/uiSlice'
import warpReducer from '../../store/slices/warpSlice'
import regionReducer from '../../store/slices/regionSlice'
import historyReducer from '../../store/slices/historySlice'
import { persistenceMiddleware } from '../../store/middleware/persistenceMiddleware'
import { historyMiddleware } from '../../store/middleware/historyMiddleware'
import { selectVideoThunk } from '../../store/thunks/videoThunks'
import type { VideoInfo } from '../../types'

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../api/video', () => ({
  loadVideoFromPath: vi.fn(),
  openVideo: vi.fn(),
  openFolder: vi.fn(),
  listFolderVideos: vi.fn(),
}))

vi.mock('../../api/storage', () => ({
  saveVideoState: vi.fn(),
  loadVideoState: vi.fn(),
  getFileHash: vi.fn(),
}))

vi.mock('../../api/warp', () => ({
  checkVideoSidecar: vi.fn(),
  deleteVideoSidecar: vi.fn(),
  openJsonFile: vi.fn(),
  readJsonSidecarForVideo: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
  convertFileSrc: (p: string) => `tauri://localhost/${p}`,
}))

import * as videoApi from '../../api/video'
import * as storageApi from '../../api/storage'
import * as warpApi from '../../api/warp'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeVideoInfo(overrides: Partial<VideoInfo> = {}): VideoInfo {
  return {
    path: '/videos/concert.mp4',
    originalName: 'concert.mp4',
    videoUrl: 'tauri://localhost//videos/concert.mp4',
    duration: 240,
    fps: 30,
    fileHash: 'abc123',
    ...overrides,
  }
}

// ── Store factory ─────────────────────────────────────────────────────────────

function makeStore() {
  return configureStore({
    reducer: {
      video: videoReducer,
      ui: uiReducer,
      warp: warpReducer,
      region: regionReducer,
      history: historyReducer,
    },
    middleware: (getDefault) =>
      getDefault()
        .prepend(persistenceMiddleware.middleware)
        .prepend(historyMiddleware.middleware),
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('video loading — viewport reset', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    vi.clearAllMocks()
    store = makeStore()
  })

  it('when a video is loaded, the viewport end is set to the video duration', async () => {
    vi.mocked(videoApi.loadVideoFromPath).mockResolvedValue(makeVideoInfo({ duration: 240 }))
    vi.mocked(warpApi.checkVideoSidecar).mockResolvedValue(null)
    vi.mocked(storageApi.loadVideoState).mockResolvedValue(null)

    await store.dispatch(selectVideoThunk('/videos/concert.mp4'))

    expect(store.getState().ui.view).toEqual({ start: 0, end: 240 })
  })

  it('when a video is loaded, the viewport start is 0', async () => {
    vi.mocked(videoApi.loadVideoFromPath).mockResolvedValue(makeVideoInfo({ duration: 90 }))
    vi.mocked(warpApi.checkVideoSidecar).mockResolvedValue(null)
    vi.mocked(storageApi.loadVideoState).mockResolvedValue(null)

    await store.dispatch(selectVideoThunk('/videos/short.mp4'))

    expect(store.getState().ui.view.start).toBe(0)
    expect(store.getState().ui.view.end).toBe(90)
  })

  it('when a second video is loaded after the first, the viewport resets to the new duration', async () => {
    vi.mocked(videoApi.loadVideoFromPath).mockResolvedValueOnce(makeVideoInfo({ duration: 300 }))
    vi.mocked(warpApi.checkVideoSidecar).mockResolvedValue(null)
    vi.mocked(storageApi.loadVideoState).mockResolvedValue(null)
    await store.dispatch(selectVideoThunk('/videos/long.mp4'))

    vi.mocked(videoApi.loadVideoFromPath).mockResolvedValueOnce(makeVideoInfo({ duration: 45, path: '/videos/short.mp4' }))
    await store.dispatch(selectVideoThunk('/videos/short.mp4'))

    expect(store.getState().ui.view).toEqual({ start: 0, end: 45 })
  })
})
