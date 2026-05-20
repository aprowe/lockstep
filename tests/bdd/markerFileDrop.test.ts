import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { addAnchor } from '../../src/store/slices/warpSlice'
import { pushSnapshot, undo } from '../../src/store/slices/historySlice'
import { selectVideoThunk, openJsonFileThunk } from '../../src/store/thunks/videoThunks'
import { makeStore, makeVideoInfo, makeSavedState } from '../helpers/setup'

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

const feature = await loadFeature('./spec/features/drop-marker-file.feature')

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  let store: ReturnType<typeof makeStore>

  BeforeEachScenario(() => {
    vi.clearAllMocks()
    store = makeStore()
    vi.mocked(storageApi.loadVideoState).mockResolvedValue(null)
  })

  // @behavior drop-a-matching-marker-file-onto-a-loaded-clip::535b7e93
  Scenario('Markers are replaced when a matching sidecar is dropped', ({ Given, And, When, Then }) => {
    Given('a video is loaded with in-progress marker state', () => {
      store.dispatch(addAnchor({ id: 99, time: 30 }))
    })
    And('a sidecar file exists in the same folder with saved markers', () => {
      vi.mocked(videoApi.loadVideoFromPath).mockResolvedValue(makeVideoInfo())
      vi.mocked(warpApi.checkVideoSidecar).mockResolvedValue(JSON.stringify(makeSavedState()))
    })
    When('the user drops the JSON file onto the app window', async () => {
      await store.dispatch(selectVideoThunk('/videos/concert.mp4'))
    })
    Then('the video does not change', () => {
      expect(store.getState().video.video?.path).toBe('/videos/concert.mp4')
    })
    And('all current in-memory markers are replaced with those from the sidecar', () => {
      const { origAnchors, beatAnchors, bpm } = store.getState().warp
      expect(origAnchors).toHaveLength(2)
      expect(origAnchors[0].time).toBe(5)
      expect(origAnchors[1].time).toBe(10)
      expect(beatAnchors[1].time).toBe(11)
      expect(bpm).toBe(140)
      expect(store.getState().warp.playhead).toBe(0)
      expect(store.getState().region.activeRegionId).toBeNull()
    })
  })

  // @behavior drop-a-matching-marker-file-onto-a-loaded-clip::5a680ff1
  Scenario('Undo reverts the sidecar load', ({ Given, When, Then }) => {
    Given('a sidecar file is loaded over in-progress markers', async () => {
      store.dispatch(addAnchor({ id: 99, time: 30 }))
      store.dispatch(pushSnapshot({
        origAnchors: [{ id: 99, time: 30 }],
        beatAnchors: [{ id: 99, time: 30 }],
        beatZeroId: null,
        bpm: 120,
        minStretch: 0.5,
        maxStretch: 2.0,
        regions: [],
      }))
      vi.mocked(videoApi.loadVideoFromPath).mockResolvedValue(makeVideoInfo())
      vi.mocked(warpApi.checkVideoSidecar).mockResolvedValue(JSON.stringify(makeSavedState()))
      await store.dispatch(selectVideoThunk('/videos/concert.mp4'))
      expect(store.getState().warp.origAnchors).toHaveLength(2)
    })
    When('the user dispatches undo', async () => {
      store.dispatch(undo())
      await Promise.resolve()
    })
    Then('the markers revert to the state directly before loading', () => {
      expect(store.getState().warp.origAnchors).toHaveLength(1)
      expect(store.getState().warp.origAnchors[0].time).toBe(30)
    })
  })

  // @behavior drop-a-matching-marker-file-onto-a-loaded-clip::b2dcfc34
  Scenario('No sibling video found results in silent error', ({ Given, When, Then, And }) => {
    let stateBefore: ReturnType<ReturnType<typeof makeStore>['getState']>
    let threw = false

    Given('a JSON file is dropped with no sibling video next to it', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      store.dispatch(addAnchor({ id: 77, time: 15 }))
      stateBefore = store.getState()
      vi.mocked(warpApi.openJsonFile).mockResolvedValue({
        jsonContent: '{}',
        videoPath: '/videos/missing.mp4',
      })
      vi.mocked(videoApi.loadVideoFromPath).mockRejectedValue(new Error('File not found'))
    })
    When('the app tries to resolve the sibling', async () => {
      try {
        await store.dispatch(openJsonFileThunk())
      } catch {
        threw = true
      }
    })
    Then('the error is logged silently', () => {
      expect(threw).toBe(false)
    })
    And('the current state is unchanged', () => {
      const stateAfter = store.getState()
      expect(stateAfter.video.video).toBe(stateBefore.video.video)
      expect(stateAfter.warp.origAnchors).toHaveLength(1)
      expect(stateAfter.warp.origAnchors[0].time).toBe(15)
    })
  })

  // @behavior drop-a-matching-marker-file-onto-a-loaded-clip::dd2831c4
  Scenario('A different sibling video loads with its markers', ({ Given, When, Then, And }) => {
    Given('a JSON file is dropped whose sibling video differs from the currently loaded one', async () => {
      vi.mocked(videoApi.loadVideoFromPath).mockResolvedValueOnce(
        makeVideoInfo({ path: '/videos/concert.mp4', fileHash: 'abc123' }),
      )
      vi.mocked(warpApi.checkVideoSidecar).mockResolvedValueOnce(JSON.stringify(makeSavedState()))
      await store.dispatch(selectVideoThunk('/videos/concert.mp4'))
    })
    When('the sidecar is resolved', async () => {
      const songMarkers = makeSavedState({
        origAnchors: [{ id: 10, time: 3 }],
        beatAnchors: [{ id: 10, time: 3 }],
        bpm: 160,
      })
      vi.mocked(videoApi.loadVideoFromPath).mockResolvedValueOnce(
        makeVideoInfo({ path: '/videos/song.mp4', originalName: 'song.mp4', fileHash: 'def456' }),
      )
      vi.mocked(warpApi.checkVideoSidecar).mockResolvedValueOnce(JSON.stringify(songMarkers))
      await store.dispatch(selectVideoThunk('/videos/song.mp4'))
    })
    Then('the sibling video loads replacing the current video', () => {
      expect(store.getState().video.video?.path).toBe('/videos/song.mp4')
    })
    And("the sibling's markers are applied", () => {
      const state = store.getState()
      expect(state.warp.origAnchors).toHaveLength(1)
      expect(state.warp.origAnchors[0].time).toBe(3)
      expect(state.warp.bpm).toBe(160)
    })
  })
})

// ── Non-behavior: no-sidecar happy path ───────────────────────────────────────

describe('marker file drop — no sidecar found', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    vi.clearAllMocks()
    store = makeStore()
  })

  it('video loads with empty marker state when neither sidecar nor storage has data', async () => {
    store.dispatch(addAnchor({ id: 99, time: 30 }))

    vi.mocked(videoApi.loadVideoFromPath).mockResolvedValue(makeVideoInfo())
    vi.mocked(warpApi.checkVideoSidecar).mockResolvedValue(null)
    vi.mocked(storageApi.loadVideoState).mockResolvedValue(null)

    await store.dispatch(selectVideoThunk('/videos/concert.mp4'))

    const state = store.getState()
    expect(state.video.video).not.toBeNull()
    expect(state.warp.origAnchors).toHaveLength(0)
    expect(state.warp.beatAnchors).toHaveLength(0)
    expect(state.video.markersLoaded).toBe(true)
  })
})
