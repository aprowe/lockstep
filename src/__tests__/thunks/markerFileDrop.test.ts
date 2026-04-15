/**
 * Behaviors under test (see BEHAVIORS.md §1):
 *
 * @behavior drop-a-matching-marker-file-onto-a-loaded-clip::82957
 *   Given a video is loaded with in-progress marker state
 *   And a sidecar exists for the dropped JSON's sibling video
 *   When selectVideoThunk is dispatched (the action taken after a JSON drop resolves its sibling)
 *   Then the video is replaced, markers from the sidecar are applied,
 *        history is reset, and playhead returns to 0
 *
 * @behavior drop-a-matching-marker-file-onto-a-loaded-clip::d85a8
 *   Given a JSON drop resolves a sibling that differs from the currently loaded video
 *   When selectVideoThunk is dispatched with the sibling's path
 *   Then the different video loads with its own markers, replacing all prior state
 *
 * (no behavior): no-sidecar happy path — video loads with empty markers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { configureStore } from '@reduxjs/toolkit'
import videoReducer from '../../store/slices/videoSlice'
import uiReducer from '../../store/slices/uiSlice'
import warpReducer, { addAnchor } from '../../store/slices/warpSlice'
import regionReducer from '../../store/slices/regionSlice'
import historyReducer, { pushSnapshot } from '../../store/slices/historySlice'
import { persistenceMiddleware } from '../../store/middleware/persistenceMiddleware'
import { historyMiddleware } from '../../store/middleware/historyMiddleware'
import { selectVideoThunk, openJsonFileThunk } from '../../store/thunks/videoThunks'
import { undo } from '../../store/slices/historySlice'
import type { SavedVideoState, VideoInfo } from '../../types'

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

// Also mock the persistence middleware's side-effects (invoke calls)
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
    duration: 120,
    fps: 30,
    fileHash: 'abc123',
    ...overrides,
  }
}

function makeSavedState(overrides: Partial<SavedVideoState['defaultRegion']> = {}): SavedVideoState {
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

describe('marker file drop — matching sidecar', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    vi.clearAllMocks()
    store = makeStore()
  })

  it('given a video loaded with in-progress markers, when selectVideoThunk dispatches, then playhead returns to 0', async () => {
    // Seed in-progress state
    store.dispatch(addAnchor({ id: 99, time: 30 }))

    vi.mocked(videoApi.loadVideoFromPath).mockResolvedValue(makeVideoInfo())
    vi.mocked(warpApi.checkVideoSidecar).mockResolvedValue(JSON.stringify(makeSavedState()))
    vi.mocked(storageApi.loadVideoState).mockResolvedValue(null)

    await store.dispatch(selectVideoThunk('/videos/concert.mp4'))

    expect(store.getState().warp.playhead).toBe(0)
  })

  it('given a video loaded with in-progress markers, when selectVideoThunk dispatches, then markers are replaced with sidecar contents', async () => {
    // Seed in-progress state
    store.dispatch(addAnchor({ id: 99, time: 30 }))

    const saved = makeSavedState()
    vi.mocked(videoApi.loadVideoFromPath).mockResolvedValue(makeVideoInfo())
    vi.mocked(warpApi.checkVideoSidecar).mockResolvedValue(JSON.stringify(saved))
    vi.mocked(storageApi.loadVideoState).mockResolvedValue(null)

    await store.dispatch(selectVideoThunk('/videos/concert.mp4'))

    const { origAnchors, beatAnchors, bpm } = store.getState().warp
    expect(origAnchors).toHaveLength(2)
    expect(origAnchors[0].time).toBe(5)
    expect(origAnchors[1].time).toBe(10)
    expect(beatAnchors[1].time).toBe(11) // unlinked beat from sidecar
    expect(bpm).toBe(140)
  })

  it('given in-progress markers exist, when selectVideoThunk dispatches, then history is reset to the sidecar state', async () => {
    store.dispatch(addAnchor({ id: 99, time: 30 }))
    // Push a snapshot so history has multiple entries
    store.dispatch(pushSnapshot({ origAnchors: [{ id: 99, time: 30 }], beatAnchors: [{ id: 99, time: 30 }], linkedBeatIds: [99], beatZeroId: null }))

    const saved = makeSavedState()
    vi.mocked(videoApi.loadVideoFromPath).mockResolvedValue(makeVideoInfo())
    vi.mocked(warpApi.checkVideoSidecar).mockResolvedValue(JSON.stringify(saved))
    vi.mocked(storageApi.loadVideoState).mockResolvedValue(null)

    await store.dispatch(selectVideoThunk('/videos/concert.mp4'))

    const history = store.getState().history
    expect(history.stack).toHaveLength(1)
    expect(history.index).toBe(0)
    expect(history.stack[0].origAnchors).toHaveLength(2)
  })

  it('given a video loaded, when selectVideoThunk dispatches, then the video state is updated to the resolved VideoInfo', async () => {
    const info = makeVideoInfo()
    vi.mocked(videoApi.loadVideoFromPath).mockResolvedValue(info)
    vi.mocked(warpApi.checkVideoSidecar).mockResolvedValue(JSON.stringify(makeSavedState()))
    vi.mocked(storageApi.loadVideoState).mockResolvedValue(null)

    await store.dispatch(selectVideoThunk('/videos/concert.mp4'))

    expect(store.getState().video.video?.path).toBe('/videos/concert.mp4')
    expect(store.getState().video.video?.duration).toBe(120)
  })

  it('given a video loaded, when selectVideoThunk dispatches, then active region is cleared', async () => {
    vi.mocked(videoApi.loadVideoFromPath).mockResolvedValue(makeVideoInfo())
    vi.mocked(warpApi.checkVideoSidecar).mockResolvedValue(JSON.stringify(makeSavedState()))
    vi.mocked(storageApi.loadVideoState).mockResolvedValue(null)

    await store.dispatch(selectVideoThunk('/videos/concert.mp4'))

    expect(store.getState().region.activeRegionId).toBeNull()
  })
})

describe('marker file drop — different sibling video', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    vi.clearAllMocks()
    store = makeStore()
  })

  it('given concert.mp4 is loaded, when selectVideoThunk is dispatched for song.mp4, then song.mp4 loads with its own markers', async () => {
    // Load concert.mp4 first
    vi.mocked(videoApi.loadVideoFromPath).mockResolvedValueOnce(makeVideoInfo({ path: '/videos/concert.mp4', originalName: 'concert.mp4', fileHash: 'abc123' }))
    vi.mocked(warpApi.checkVideoSidecar).mockResolvedValueOnce(JSON.stringify(makeSavedState()))
    vi.mocked(storageApi.loadVideoState).mockResolvedValue(null)
    await store.dispatch(selectVideoThunk('/videos/concert.mp4'))

    const songMarkers = makeSavedState({ origAnchors: [{ id: 10, time: 3 }], beatAnchors: [{ id: 10, time: 3 }], bpm: 160 })
    vi.mocked(videoApi.loadVideoFromPath).mockResolvedValueOnce(makeVideoInfo({ path: '/videos/song.mp4', originalName: 'song.mp4', fileHash: 'def456' }))
    vi.mocked(warpApi.checkVideoSidecar).mockResolvedValueOnce(JSON.stringify(songMarkers))

    await store.dispatch(selectVideoThunk('/videos/song.mp4'))

    const state = store.getState()
    expect(state.video.video?.path).toBe('/videos/song.mp4')
    expect(state.warp.origAnchors).toHaveLength(1)
    expect(state.warp.origAnchors[0].time).toBe(3)
    expect(state.warp.bpm).toBe(160)
  })
})

describe('marker file drop — no sidecar found', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    vi.clearAllMocks()
    store = makeStore()
  })

  it('given neither sidecar nor internal storage has markers, when selectVideoThunk dispatches, then the video loads with empty marker state', async () => {
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

// ── @behavior drop-a-matching-marker-file-onto-a-loaded-clip::98c87 ──────────
//
// NOTE: This test documents the desired behavior from BEHAVIORS.md §1 scenario 2.
// It currently FAILS because applyLoadedState calls resetHistory(), which wipes
// pre-load history. To make it pass, the thunk must preserve the pre-load
// history stack so undo can return to it.

describe('marker file drop — undo reverts sidecar load', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    vi.clearAllMocks()
    store = makeStore()
  })

  it('given in-progress markers exist when a sidecar loads, when undo, then markers revert to the pre-load state', async () => {
    // Establish pre-load state with one in-progress anchor
    store.dispatch(addAnchor({ id: 99, time: 30 }))
    store.dispatch(pushSnapshot({
      origAnchors: [{ id: 99, time: 30 }],
      beatAnchors: [{ id: 99, time: 30 }],
      linkedBeatIds: [],
      beatZeroId: null,
    }))

    // Load sidecar — replaces in-progress markers with saved ones
    vi.mocked(videoApi.loadVideoFromPath).mockResolvedValue(makeVideoInfo())
    vi.mocked(warpApi.checkVideoSidecar).mockResolvedValue(JSON.stringify(makeSavedState()))
    vi.mocked(storageApi.loadVideoState).mockResolvedValue(null)
    await store.dispatch(selectVideoThunk('/videos/concert.mp4'))

    expect(store.getState().warp.origAnchors).toHaveLength(2) // sidecar state is active

    // Undo the load
    store.dispatch(undo())
    await Promise.resolve() // let listener effect run

    // Markers must revert to the single in-progress anchor from before the load
    expect(store.getState().warp.origAnchors).toHaveLength(1)
    expect(store.getState().warp.origAnchors[0].time).toBe(30)
  })
})

// ── @behavior drop-a-matching-marker-file-onto-a-loaded-clip::4468a ──────────

describe('marker file drop — no sibling video found', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    vi.clearAllMocks()
    store = makeStore()
  })

  it('given a JSON file is dropped whose sibling video does not exist, then the error is caught silently and state is unchanged', async () => {
    // Seed in-progress state to verify nothing is cleared
    store.dispatch(addAnchor({ id: 77, time: 15 }))
    const stateBefore = store.getState()

    // openJsonFile resolves but the video path doesn't exist on disk
    vi.mocked(warpApi.openJsonFile).mockResolvedValue({
      jsonContent: '{}',
      videoPath: '/videos/missing.mp4',
    })
    vi.mocked(videoApi.loadVideoFromPath).mockRejectedValue(new Error('File not found'))

    // Must not throw
    await expect(store.dispatch(openJsonFileThunk())).resolves.not.toThrow()

    const stateAfter = store.getState()
    expect(stateAfter.video.video).toBe(stateBefore.video.video)
    expect(stateAfter.warp.origAnchors).toHaveLength(1)
    expect(stateAfter.warp.origAnchors[0].time).toBe(15)
  })
})
