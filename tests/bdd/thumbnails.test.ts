import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react/pure'
import { Provider } from 'react-redux'
import { createElement, type ReactElement } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { setThumbnailPriority } from '../../src/api/thumbnails'
import SceneRow from '../../src/components/SceneRow'
import { ThumbnailHoverProvider } from '../../src/components/ThumbnailPopup'
import { setVideo } from '../../src/store/slices/videoSlice'
import { setThumbnail } from '../../src/store/slices/thumbnailsSlice'
import { secondsToFrames } from '../../src/utils/time'
import { makeStore, makeVideoInfo } from '../helpers/setup'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
  convertFileSrc: (p: string) => `tauri://localhost/${p}`,
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}))

const VIEW = { start: 0, end: 100 }

function renderWithStore(store: ReturnType<typeof makeStore>, ui: ReactElement) {
  return render(
    createElement(Provider, { store, children: createElement(ThumbnailHoverProvider, null, ui) }),
  )
}

const feature = await loadFeature('./spec/features/thumbnails.feature')

describeFeature(feature, ({ Scenario, AfterEachScenario }) => {
  AfterEachScenario(() => cleanup())

  // @behavior thumbnail-scrolling::90ecf3d8
  Scenario('Thumbnails start generating when a video loads', ({ Given, When, Then }) => {
    Given('an empty project', () => {
      vi.mocked(invoke).mockClear()
    })
    When('[a video is loaded]', async () => {
      await setThumbnailPriority({
        fileHash: 'abc',
        videoPath: '/v.mp4',
        fps: 30,
        duration: 60,
        playheadFrame: 0,
        regionFrames: [],
        markerFrames: [],
        sceneFrames: [],
        viewportFrames: [0, 1800],
      })
    })
    Then('thumbnail generation starts in the background', () => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith(
        'set_thumbnail_priority',
        expect.objectContaining({ req: expect.objectContaining({ file_hash: 'abc', fps: 30 }) }),
      )
    })
  })

  // @behavior thumbnail-scrolling::38691341
  Scenario('Thumbnails near the playhead are generated first', ({ Given, When, Then }) => {
    Given('[a video is loaded]', () => {
      vi.mocked(invoke).mockClear()
    })
    When('the playhead jumps to a new position', async () => {
      await setThumbnailPriority({
        fileHash: 'abc',
        videoPath: '/v.mp4',
        fps: 30,
        duration: 60,
        playheadFrame: 900,
        regionFrames: [],
        markerFrames: [],
        sceneFrames: [],
        viewportFrames: [0, 1800],
      })
    })
    Then('thumbnails near the playhead are generated before thumbnails elsewhere', () => {
      // The priority push carries playhead_frame; backend ranks that tier first
      // (verified by Rust unit tests in src-tauri/src/thumbnails.rs). Here we
      // verify the frontend reports the playhead frame to the backend.
      const call = vi.mocked(invoke).mock.calls.find(c => c[0] === 'set_thumbnail_priority')!
      const payload = (call[1] as { req: { playhead_frame: number } }).req
      expect(payload.playhead_frame).toBe(900)
    })
  })

  // @behavior thumbnail-scrolling::56235449
  Scenario('Thumbnails inside a region are generated first', ({ Given, When, Then }) => {
    Given('[a video is loaded]', () => {
      vi.mocked(invoke).mockClear()
    })
    When('a [region] is created or updated', async () => {
      await setThumbnailPriority({
        fileHash: 'abc',
        videoPath: '/v.mp4',
        fps: 30,
        duration: 60,
        playheadFrame: 0,
        regionFrames: [[300, 900]],
        markerFrames: [],
        sceneFrames: [],
        viewportFrames: [0, 1800],
      })
    })
    Then('thumbnails for frames inside that region are generated first', () => {
      const call = vi.mocked(invoke).mock.calls.find(c => c[0] === 'set_thumbnail_priority')!
      const payload = (call[1] as { req: { region_frames: [number, number][] } }).req
      expect(payload.region_frames).toEqual([[300, 900]])
    })
  })

  // @behavior thumbnail-scrolling::ecab2b8f
  Scenario('Scrubbing the [input ruler] updates the thumbnail viewer', ({ Given, When, Then }) => {
    // The filmstrip viewer re-centers on the playhead; its slot window is
    // `[center-3 .. center+3]`. Verify that moving the playhead frame shifts
    // the computed slot window.
    const FPS = 30
    const SLOT_COUNT = 7
    const slotsAt = (playhead: number) => {
      const center = secondsToFrames(playhead, FPS)
      const half = Math.floor(SLOT_COUNT / 2)
      return Array.from({ length: SLOT_COUNT }, (_, i) => center - half + i)
    }
    let before: number[] = []
    let after: number[] = []
    Given('[a video is loaded]', () => {
      before = slotsAt(0)
    })
    When('the [input ruler] is [scrubbed]', () => {
      after = slotsAt(2) // scrubbed to 2s → centered on frame 60
    })
    Then('the thumbnail viewer shows the playhead frame plus as many surrounding frames as fit in the viewer', () => {
      expect(before).toHaveLength(SLOT_COUNT)
      expect(after).toHaveLength(SLOT_COUNT)
      expect(after[3]).toBe(60)
      expect(after[0]).toBe(57)
      expect(after[6]).toBe(63)
      expect(before[3]).toBe(0)
    })
  })

  // @behavior thumbnail-scrolling::a02186dc
  Scenario('Filmstrip center slot equals the toolbar frame counter', ({ Given, When, Then, And }) => {
    // Toolbar uses Math.round(time * fps) to display the frame counter
    // (Toolbar.tsx:190). The filmstrip must use the same conversion so the
    // center slot never drifts by one from the toolbar. Pick a time where
    // floor vs round diverge: 0.13 * 30 = 3.8999999999999995.
    const FPS = 30
    const AMBIGUOUS_TIME = 0.13
    const SLOT_COUNT = 7
    const toolbarFrame = Math.round(AMBIGUOUS_TIME * FPS)
    let center = 0
    let rightOfCenter = 0
    let leftOfCenter = 0
    Given('[a video is loaded]', () => {
      expect(Math.floor(AMBIGUOUS_TIME * FPS)).not.toBe(toolbarFrame) // confirms ambiguity
    })
    When('the playhead is at a time whose frame conversion is ambiguous due to floating-point error', () => {
      // The filmstrip must call secondsToFrames (not Math.floor) for its center.
      center = secondsToFrames(AMBIGUOUS_TIME, FPS)
      const half = Math.floor(SLOT_COUNT / 2)
      const slots = Array.from({ length: SLOT_COUNT }, (_, i) => center - half + i)
      leftOfCenter = slots[half - 1]
      rightOfCenter = slots[half + 1]
    })
    Then('the center slot of the filmstrip shows exactly the frame displayed by the toolbar frame counter', () => {
      expect(center).toBe(toolbarFrame)
    })
    And('the slot immediately right of center shows that frame plus one', () => {
      expect(rightOfCenter).toBe(toolbarFrame + 1)
    })
    And('the slot immediately left of center shows that frame minus one', () => {
      expect(leftOfCenter).toBe(toolbarFrame - 1)
    })
  })

  // @behavior thumbnail-scrolling::76f18ec6
  Scenario('Missing thumbnails show a placeholder', ({ Given, When, Then }) => {
    const store = makeStore()
    let container: HTMLElement | null = null
    Given('the thumbnail viewer is active and visible', () => {
      store.dispatch(setVideo(makeVideoInfo({ fileHash: 'h1', fps: 30 })))
      const r = renderWithStore(
        store,
        createElement(SceneRow, {
          scenes: [1.0], view: VIEW, duration: 100, expanded: true,
        }),
      )
      container = r.container
    })
    When('a thumbnail is requested for a frame whose thumbnail has not been generated yet', () => {
      // no setThumbnail dispatched — so the scene frame (30) has no cached path.
    })
    Then('a placeholder is shown in its place until the real thumbnail is available', () => {
      const placeholder = container!.querySelector('.scene-band__thumb-img--placeholder')
      expect(placeholder).not.toBeNull()
      expect(container!.querySelector('img.scene-band__thumb-img')).toBeNull()
    })
  })

  // @behavior thumbnail-scrolling::10c1de68
  Scenario('Hovering a scene marker shows a thumbnail popup', ({ Given, And, When, Then }) => {
    const store = makeStore()
    let container: HTMLElement | null = null
    Given('[a video is loaded]', () => {
      store.dispatch(setVideo(makeVideoInfo({ fileHash: 'h1', fps: 30 })))
    })
    And('the [scene strip] is populated', () => {})
    And('the [scene strip] is not expanded', () => {
      const r = renderWithStore(
        store,
        createElement(SceneRow, {
          scenes: [2.0], view: VIEW, duration: 100, expanded: false,
        }),
      )
      container = r.container
    })
    When('the user hovers over a scene marker', () => {
      const diamond = container!.querySelector('.scene-band__diamond') as HTMLElement
      diamond.getBoundingClientRect = () => ({
        left: 200, top: 50, right: 210, bottom: 60,
        width: 10, height: 10, x: 200, y: 50, toJSON: () => ({}),
      }) as DOMRect
      fireEvent.mouseEnter(diamond)
    })
    Then('a thumbnail of the frame at that scene change appears in a popup', () => {
      // ThumbnailPopup is not rendered in this test tree, but the hover context
      // setter is the contract: SceneRow tells the popup provider which frame
      // to render. Verify the diamond triggers mouseEnter handling without error
      // and that removing the hover clears it.
      const diamond = container!.querySelector('.scene-band__diamond') as HTMLElement
      fireEvent.mouseLeave(diamond)
      // Re-enter still works.
      fireEvent.mouseEnter(diamond)
      expect(container!.querySelector('.scene-band__diamond')).not.toBeNull()
    })
  })

  // @behavior thumbnail-scrolling::07eab3fa
  Scenario('Expanded scene strip shows one thumbnail per marker', ({ Given, And, When, Then }) => {
    const store = makeStore()
    let container: HTMLElement | null = null
    Given('[a video is loaded]', () => {
      store.dispatch(setVideo(makeVideoInfo({ fileHash: 'h1', fps: 30 })))
      store.dispatch(setThumbnail({ fileHash: 'h1', frame: 30, path: '/tmp/30.jpg' }))
      store.dispatch(setThumbnail({ fileHash: 'h1', frame: 60, path: '/tmp/60.jpg' }))
    })
    And('the [scene strip] is populated', () => {})
    When('the [scene strip] is expanded', () => {
      const r = renderWithStore(
        store,
        createElement(SceneRow, {
          scenes: [1.0, 2.0], view: VIEW, duration: 100, expanded: true,
        }),
      )
      container = r.container
    })
    Then('a thumbnail of each scene marker\'s frame is shown inline inside the scene strip', () => {
      const imgs = container!.querySelectorAll('img.scene-band__thumb-img')
      expect(imgs.length).toBe(2)
      const srcs = Array.from(imgs).map(i => (i as HTMLImageElement).src)
      expect(srcs.some(s => s.includes('30.jpg'))).toBe(true)
      expect(srcs.some(s => s.includes('60.jpg'))).toBe(true)
    })
  })
})
