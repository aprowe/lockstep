import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect, vi } from 'vitest'
import { selectVideoThunk } from '../../src/store/thunks/videoThunks'
import { makeStore, makeVideoInfo } from '../helpers/setup'

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

const feature = await loadFeature('./spec/features/video-loading.feature')

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  let store: ReturnType<typeof makeStore>

  BeforeEachScenario(() => {
    vi.clearAllMocks()
    store = makeStore()
    vi.mocked(warpApi.checkVideoSidecar).mockResolvedValue(null)
    vi.mocked(storageApi.loadVideoState).mockResolvedValue(null)
  })

  // @behavior video-loading::90289e16
  Scenario('Viewport is set to the video duration on load', ({ When, Then }) => {
    When('a video is loaded', async () => {
      vi.mocked(videoApi.loadVideoFromPath).mockResolvedValue(makeVideoInfo({ duration: 240 }))
      await store.dispatch(selectVideoThunk('/videos/concert.mp4'))
    })
    Then('the viewport changes to the length of the video', () => {
      expect(store.getState().ui.view).toEqual({ start: 0, end: 240 })
    })
  })

  // @behavior video-loading::ea78fa82
  Scenario('Viewport resets when a different video is loaded', ({ Given, When, Then }) => {
    Given('a first video with a long duration is already loaded', async () => {
      vi.mocked(videoApi.loadVideoFromPath).mockResolvedValueOnce(makeVideoInfo({ duration: 300 }))
      await store.dispatch(selectVideoThunk('/videos/long.mp4'))
    })
    When('a second video with a shorter duration is loaded', async () => {
      vi.mocked(videoApi.loadVideoFromPath).mockResolvedValueOnce(
        makeVideoInfo({ duration: 45, path: '/videos/short.mp4' }),
      )
      await store.dispatch(selectVideoThunk('/videos/short.mp4'))
    })
    Then("the viewport changes to the shorter video's duration", () => {
      expect(store.getState().ui.view).toEqual({ start: 0, end: 45 })
    })
  })
})
