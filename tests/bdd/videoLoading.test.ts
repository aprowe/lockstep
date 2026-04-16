import { it, expect, vi, beforeEach } from 'vitest'
import { selectVideoThunk } from '../../src/store/thunks/videoThunks'
import { behaviorTest } from '../helpers/runBehavior'
import { makeStore, makeVideoInfo } from '../helpers/setup'

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../src/api/video', () => ({
  loadVideoFromPath: vi.fn(),
  openVideo: vi.fn(),
  openFolder: vi.fn(),
  listFolderVideos: vi.fn(),
}))

vi.mock('../../src/api/storage', () => ({
  saveVideoState: vi.fn(),
  loadVideoState: vi.fn(),
  getFileHash: vi.fn(),
}))

vi.mock('../../src/api/warp', () => ({
  checkVideoSidecar: vi.fn(),
  deleteVideoSidecar: vi.fn(),
  openJsonFile: vi.fn(),
  readJsonSidecarForVideo: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
  convertFileSrc: (p: string) => `tauri://localhost/${p}`,
}))

import * as videoApi from '../../src/api/video'
import * as storageApi from '../../src/api/storage'
import * as warpApi from '../../src/api/warp'

// ── Tests ─────────────────────────────────────────────────────────────────────

// video-loading::90289e16
// Viewport is set to the video duration on load

behaviorTest('video-loading::90289e16', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    vi.clearAllMocks()
    store = makeStore()
  })

  it('viewport start is 0 and end equals video duration', async () => {
    vi.mocked(videoApi.loadVideoFromPath).mockResolvedValue(makeVideoInfo({ duration: 240 }))
    vi.mocked(warpApi.checkVideoSidecar).mockResolvedValue(null)
    vi.mocked(storageApi.loadVideoState).mockResolvedValue(null)

    await store.dispatch(selectVideoThunk('/videos/concert.mp4'))

    expect(store.getState().ui.view).toEqual({ start: 0, end: 240 })
  })

  it('viewport end equals the exact duration for a different length video', async () => {
    vi.mocked(videoApi.loadVideoFromPath).mockResolvedValue(makeVideoInfo({ duration: 90 }))
    vi.mocked(warpApi.checkVideoSidecar).mockResolvedValue(null)
    vi.mocked(storageApi.loadVideoState).mockResolvedValue(null)

    await store.dispatch(selectVideoThunk('/videos/short.mp4'))

    expect(store.getState().ui.view.start).toBe(0)
    expect(store.getState().ui.view.end).toBe(90)
  })
})

// video-loading::ea78fa82
// Viewport resets when a different video is loaded

behaviorTest('video-loading::ea78fa82', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    vi.clearAllMocks()
    store = makeStore()
  })

  it('viewport resets to the new duration when a second video loads', async () => {
    vi.mocked(videoApi.loadVideoFromPath).mockResolvedValueOnce(makeVideoInfo({ duration: 300 }))
    vi.mocked(warpApi.checkVideoSidecar).mockResolvedValue(null)
    vi.mocked(storageApi.loadVideoState).mockResolvedValue(null)
    await store.dispatch(selectVideoThunk('/videos/long.mp4'))

    vi.mocked(videoApi.loadVideoFromPath).mockResolvedValueOnce(
      makeVideoInfo({ duration: 45, path: '/videos/short.mp4' }),
    )
    await store.dispatch(selectVideoThunk('/videos/short.mp4'))

    expect(store.getState().ui.view).toEqual({ start: 0, end: 45 })
  })
})
