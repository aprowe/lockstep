import { describe, it, expect, vi, beforeEach } from 'vitest'
import { addAnchor } from '../../src/store/slices/warpSlice'
import { pushSnapshot, undo } from '../../src/store/slices/historySlice'
import { selectVideoThunk, openJsonFileThunk } from '../../src/store/thunks/videoThunks'
import { behaviorTest } from '../helpers/runBehavior'
import { makeStore, makeVideoInfo, makeSavedState } from '../helpers/setup'

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

// drop-a-matching-marker-file-onto-a-loaded-clip::535b7e93
// Markers are replaced when a matching sidecar is dropped

behaviorTest('drop-a-matching-marker-file-onto-a-loaded-clip::535b7e93', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    vi.clearAllMocks()
    store = makeStore()
  })

  it('markers are replaced with sidecar contents', async () => {
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
    expect(beatAnchors[1].time).toBe(11)
    expect(bpm).toBe(140)
  })

  it('video path is unchanged after the load', async () => {
    vi.mocked(videoApi.loadVideoFromPath).mockResolvedValue(makeVideoInfo())
    vi.mocked(warpApi.checkVideoSidecar).mockResolvedValue(JSON.stringify(makeSavedState()))
    vi.mocked(storageApi.loadVideoState).mockResolvedValue(null)

    await store.dispatch(selectVideoThunk('/videos/concert.mp4'))

    expect(store.getState().video.video?.path).toBe('/videos/concert.mp4')
  })

  it('playhead resets to 0', async () => {
    store.dispatch(addAnchor({ id: 99, time: 30 }))
    vi.mocked(videoApi.loadVideoFromPath).mockResolvedValue(makeVideoInfo())
    vi.mocked(warpApi.checkVideoSidecar).mockResolvedValue(JSON.stringify(makeSavedState()))
    vi.mocked(storageApi.loadVideoState).mockResolvedValue(null)

    await store.dispatch(selectVideoThunk('/videos/concert.mp4'))

    expect(store.getState().warp.playhead).toBe(0)
  })

  it('active region is cleared', async () => {
    vi.mocked(videoApi.loadVideoFromPath).mockResolvedValue(makeVideoInfo())
    vi.mocked(warpApi.checkVideoSidecar).mockResolvedValue(JSON.stringify(makeSavedState()))
    vi.mocked(storageApi.loadVideoState).mockResolvedValue(null)

    await store.dispatch(selectVideoThunk('/videos/concert.mp4'))

    expect(store.getState().region.activeRegionId).toBeNull()
  })
})

// drop-a-matching-marker-file-onto-a-loaded-clip::5a680ff1
// Undo reverts the sidecar load

behaviorTest('drop-a-matching-marker-file-onto-a-loaded-clip::5a680ff1', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    vi.clearAllMocks()
    store = makeStore()
  })

  it('markers revert to the pre-load state after undo', async () => {
    store.dispatch(addAnchor({ id: 99, time: 30 }))
    store.dispatch(pushSnapshot({
      origAnchors: [{ id: 99, time: 30 }],
      beatAnchors: [{ id: 99, time: 30 }],
      linkedBeatIds: [],
      beatZeroId: null,
    }))

    vi.mocked(videoApi.loadVideoFromPath).mockResolvedValue(makeVideoInfo())
    vi.mocked(warpApi.checkVideoSidecar).mockResolvedValue(JSON.stringify(makeSavedState()))
    vi.mocked(storageApi.loadVideoState).mockResolvedValue(null)
    await store.dispatch(selectVideoThunk('/videos/concert.mp4'))

    expect(store.getState().warp.origAnchors).toHaveLength(2)

    store.dispatch(undo())
    await Promise.resolve()

    expect(store.getState().warp.origAnchors).toHaveLength(1)
    expect(store.getState().warp.origAnchors[0].time).toBe(30)
  })
})

// drop-a-matching-marker-file-onto-a-loaded-clip::b2dcfc34
// No sibling video found results in silent error

behaviorTest('drop-a-matching-marker-file-onto-a-loaded-clip::b2dcfc34', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    vi.clearAllMocks()
    store = makeStore()
  })

  it('error is caught silently and state is unchanged', async () => {
    store.dispatch(addAnchor({ id: 77, time: 15 }))
    const stateBefore = store.getState()

    vi.mocked(warpApi.openJsonFile).mockResolvedValue({
      jsonContent: '{}',
      videoPath: '/videos/missing.mp4',
    })
    vi.mocked(videoApi.loadVideoFromPath).mockRejectedValue(new Error('File not found'))

    await expect(store.dispatch(openJsonFileThunk())).resolves.not.toThrow()

    const stateAfter = store.getState()
    expect(stateAfter.video.video).toBe(stateBefore.video.video)
    expect(stateAfter.warp.origAnchors).toHaveLength(1)
    expect(stateAfter.warp.origAnchors[0].time).toBe(15)
  })
})

// drop-a-matching-marker-file-onto-a-loaded-clip::dd2831c4
// A different sibling video loads with its markers

behaviorTest('drop-a-matching-marker-file-onto-a-loaded-clip::dd2831c4', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    vi.clearAllMocks()
    store = makeStore()
  })

  it('the sibling video replaces the current one with its own markers', async () => {
    vi.mocked(videoApi.loadVideoFromPath).mockResolvedValueOnce(
      makeVideoInfo({ path: '/videos/concert.mp4', fileHash: 'abc123' }),
    )
    vi.mocked(warpApi.checkVideoSidecar).mockResolvedValueOnce(JSON.stringify(makeSavedState()))
    vi.mocked(storageApi.loadVideoState).mockResolvedValue(null)
    await store.dispatch(selectVideoThunk('/videos/concert.mp4'))

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

    const state = store.getState()
    expect(state.video.video?.path).toBe('/videos/song.mp4')
    expect(state.warp.origAnchors).toHaveLength(1)
    expect(state.warp.origAnchors[0].time).toBe(3)
    expect(state.warp.bpm).toBe(160)
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
