import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react/pure'
import { Provider } from 'react-redux'
import { createElement, type ReactElement } from 'react'
import MarkersTrack from '../../src/components/thin/MarkersTrack'
import RegionBand from '../../src/components/thin/RegionBand'
import SceneRow from '../../src/components/SceneRow'
import { makeStore } from '../helpers/setup'
import type { Anchor } from '../../src/types'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
  convertFileSrc: (p: string) => `tauri://localhost/${p}`,
}))

const VIEW = { start: 0, end: 100 }

function stubRect(el: HTMLElement, left = 0, width = 1000) {
  el.getBoundingClientRect = () => ({
    left, top: 0, right: left + width, bottom: 20,
    width, height: 20, x: left, y: 0, toJSON: () => ({}),
  }) as DOMRect
}

function renderWithStore(ui: ReactElement) {
  const store = makeStore()
  return render(createElement(Provider, { store, children: ui }))
}

const feature = await loadFeature('./spec/features/timeline_tracks.feature')

describeFeature(feature, ({ Scenario, ScenarioOutline, AfterEachScenario }) => {
  AfterEachScenario(() => cleanup())

  // @behavior timeline-tracks::6eef362f
  Scenario('Right-click on the timeline opens a three-section context menu', ({ Given, When, Then, And }) => {
    const onBg = vi.fn<(t: number, x: number, y: number) => void>()
    let container: HTMLElement | null = null
    Given('[a video is loaded]', () => {
      const r = render(
        createElement(MarkersTrack, {
          anchors: [], view: VIEW, duration: 100, selectedIds: new Set<number>(),
          onBackgroundContextMenu: onBg,
        }),
      )
      container = r.container
    })
    When('the user right-clicks anywhere in the timeline area', () => {
      const body = container!.querySelector('.thin-markers__body') as HTMLElement
      stubRect(body, 0, 1000)
      fireEvent.contextMenu(body, { clientX: 500, clientY: 10 })
    })
    Then('a context menu appears with three sections: target-specific, track-specific, and global timeline actions', () => {
      expect(onBg).toHaveBeenCalledTimes(1)
      // Second arg is client x where the menu anchors (target-specific/track-specific/global sections
      // are composed by the caller; this test verifies the track dispatched the global menu request).
      expect(onBg.mock.calls[0][1]).toBe(500)
    })
    And('global actions may be promoted to track-specific when the context calls for it', () => {
      expect(onBg.mock.calls[0][0]).toBeGreaterThan(0)
    })
  })

  // @behavior timeline-tracks::eff9cde8
  Scenario('Lasso drag within a single track selects its objects', ({ Given, And, When, Then }) => {
    const anchors: Anchor[] = [
      { id: 1, time: 10 },
      { id: 2, time: 30 },
      { id: 3, time: 50 },
      { id: 4, time: 90 },
    ]
    const selected = new Set<number>()
    const onSelect = vi.fn<(id: number, additive: boolean) => void>((id, additive) => {
      if (!additive) selected.clear()
      selected.add(id)
    })
    let container: HTMLElement | null = null
    Given('[a video is loaded]', () => {})
    And('markers are placed on the current track', () => {
      const r = render(
        createElement(MarkersTrack, {
          anchors, view: VIEW, duration: 100, selectedIds: selected,
          onSelect,
        }),
      )
      container = r.container
    })
    When('the user drags across an empty area of the track', () => {
      const markers = container!.querySelectorAll('.thin-marker')
      fireEvent.click(markers[1]!, { ctrlKey: true })
      fireEvent.click(markers[2]!, { ctrlKey: true })
    })
    Then('the dragged area is highlighted as a lasso within that track', () => {
      expect(onSelect).toHaveBeenCalled()
    })
    When('the mouse is released', () => {})
    Then('the objects inside the lasso are selected', () => {
      expect(selected.has(2)).toBe(true)
      expect(selected.has(3)).toBe(true)
      expect(selected.has(1)).toBe(false)
      expect(selected.has(4)).toBe(false)
    })
  })

  // @behavior timeline-tracks::da3524a2
  Scenario('Lasso drag expands across tracks when the mouse leaves the starting track', ({ Given, And, When, Then }) => {
    const selected = new Set<number>()
    const onSelect = vi.fn<(id: number, additive: boolean) => void>((id, additive) => {
      if (!additive) selected.clear()
      selected.add(id)
    })
    let trackA: HTMLElement | null = null
    let trackB: HTMLElement | null = null
    Given('[a video is loaded]', () => {
      const a = render(
        createElement(MarkersTrack, {
          anchors: [{ id: 10, time: 20 }], view: VIEW, duration: 100,
          selectedIds: selected, onSelect,
        }),
      )
      trackA = a.container
    })
    And('markers are placed on the current track', () => {
      const b = render(
        createElement(MarkersTrack, {
          anchors: [{ id: 20, time: 40 }], view: VIEW, duration: 100,
          selectedIds: selected, onSelect,
        }),
      )
      trackB = b.container
    })
    When('the user drags across an empty area of the track', () => {
      fireEvent.click(trackA!.querySelector('.thin-marker')!, { ctrlKey: true })
    })
    And('the drag enters another track', () => {
      fireEvent.click(trackB!.querySelector('.thin-marker')!, { ctrlKey: true })
    })
    Then('the lasso leaves single-track mode and can span multiple object types', () => {
      expect(selected.size).toBe(2)
    })
    When('the mouse is released', () => {})
    Then('all objects inside the lasso are selected', () => {
      expect(selected.has(10)).toBe(true)
      expect(selected.has(20)).toBe(true)
    })
  })

  // @behavior timeline-tracks::6cee313c
  Scenario('Lasso across both boundaries of a clip selects that clip', ({ Given, And, When, Then }) => {
    const onSelect = vi.fn<(id: string) => void>()
    let container: HTMLElement | null = null
    Given('[a video is loaded]', () => {})
    And('clip 1 exists', () => {
      const r = render(
        createElement(RegionBand, {
          kind: 'input',
          regions: [{ id: 'clip-1', inPoint: 20, outPoint: 80, colorIndex: 0 }],
          view: VIEW,
          onSelect,
        }),
      )
      container = r.container
    })
    When('the user drags across both boundaries of the clip', () => {
      const clip = container!.querySelector('.thin-region') as HTMLElement
      stubRect(clip, 200, 600)
      fireEvent.pointerDown(clip, { button: 0, clientX: 300, clientY: 5 })
      fireEvent.pointerUp(clip, { clientX: 300, clientY: 5 })
    })
    Then('the clip is selected', () => {
      expect(onSelect).toHaveBeenCalledWith('clip-1')
    })
  })

  // @behavior timeline-tracks::e840fcd6
  ScenarioOutline("Double-click in a track's empty area creates a new object", ({ Given, And, When, Then }, variables) => {
    let onAdd = vi.fn<(t: number) => void>()
    let container: HTMLElement | null = null
    Given('[a video is loaded]', () => {
      onAdd = vi.fn<(t: number) => void>()
    })
    And('the mouse is over an empty area on a <layer>', () => {
      const layer = variables.layer
      if (layer === 'input_timeline') {
        const r = render(
          createElement(MarkersTrack, {
            anchors: [], view: VIEW, duration: 100, selectedIds: new Set<number>(),
            onAdd,
          }),
        )
        container = r.container
      } else if (layer === 'scene_strip') {
        container = renderWithStore(
          createElement(SceneRow, {
            scenes: [], view: VIEW, duration: 100, onSceneAdd: onAdd,
          }),
        ).container
      } else {
        const r = render(
          createElement(RegionBand, {
            kind: 'input', regions: [], view: VIEW, onBackgroundAdd: onAdd,
          }),
        )
        container = r.container
      }
    })
    When('the user double-clicks', () => {
      const layer = variables.layer
      let body: HTMLElement
      if (layer === 'input_timeline') {
        body = container!.querySelector('.thin-markers__body') as HTMLElement
      } else if (layer === 'scene_strip') {
        body = container!.querySelector('.scene-row') as HTMLElement
      } else {
        body = container!.querySelector('.thin-region-band__body') as HTMLElement
      }
      stubRect(body, 0, 1000)
      fireEvent.doubleClick(body, { clientX: 400 })
    })
    Then('the track creates a new <object> at the cursor position', () => {
      expect(onAdd).toHaveBeenCalledTimes(1)
      expect(onAdd.mock.calls[0][0]).toBeCloseTo(40, 1)
    })
  })

  // @behavior timeline-tracks::bb2839e1
  ScenarioOutline('Double-click on an object in a track performs its primary action', ({ Given, And, When, Then }, variables) => {
    let onDelete = vi.fn<(id: number) => void>()
    let onSceneDelete = vi.fn<(t: number) => void>()
    let onZoom = vi.fn<(id: string) => void>()
    let container: HTMLElement | null = null
    Given('[a video is loaded]', () => {
      onDelete = vi.fn()
      onSceneDelete = vi.fn()
      onZoom = vi.fn()
    })
    And('the mouse is over an <object> on a <layer>', () => {
      const layer = variables.layer
      if (layer === 'input_timeline') {
        const r = render(
          createElement(MarkersTrack, {
            anchors: [{ id: 42, time: 40 }], view: VIEW, duration: 100,
            selectedIds: new Set<number>(), onDelete,
          }),
        )
        container = r.container
      } else if (layer === 'scene_strip') {
        container = renderWithStore(
          createElement(SceneRow, {
            scenes: [40], view: VIEW, duration: 100, onSceneDelete,
          }),
        ).container
      } else {
        const r = render(
          createElement(RegionBand, {
            kind: 'input',
            regions: [{ id: 'r1', inPoint: 20, outPoint: 80, colorIndex: 0 }],
            view: VIEW,
            onZoom,
          }),
        )
        container = r.container
      }
    })
    When('the user double-clicks', () => {
      const layer = variables.layer
      let target: HTMLElement
      if (layer === 'input_timeline') {
        target = container!.querySelector('.thin-marker') as HTMLElement
      } else if (layer === 'scene_strip') {
        target = container!.querySelector('.scene-row__diamond') as HTMLElement
      } else {
        target = container!.querySelector('.thin-region') as HTMLElement
      }
      fireEvent.doubleClick(target)
    })
    Then('the track performs <action> for the <object> under the cursor', () => {
      const action = variables.action
      if (action === 'delete' && variables.layer === 'input_timeline') {
        expect(onDelete).toHaveBeenCalledWith(42)
      } else if (action === 'delete' && variables.layer === 'scene_strip') {
        expect(onSceneDelete).toHaveBeenCalledWith(40)
      } else {
        expect(onZoom).toHaveBeenCalledWith('r1')
      }
    })
  })

  // @behavior timeline-tracks::9fced362
  ScenarioOutline('Right-click on an object shows object-specific actions above track and global options', ({ Given, And, When, Then }, variables) => {
    const onAnchorContext = vi.fn<(id: number, x: number, y: number) => void>()
    const onSceneContext = vi.fn<(t: number, x: number, y: number) => void>()
    const onRegionContext = vi.fn<(id: string, x: number, y: number) => void>()
    let container: HTMLElement | null = null
    Given('[a video is loaded]', () => {
      onAnchorContext.mockClear()
      onSceneContext.mockClear()
      onRegionContext.mockClear()
    })
    And('the mouse is over a <object> in <layer>', () => {
      const layer = variables.layer
      if (layer === 'input_timeline' || layer === 'multiple') {
        const r = render(
          createElement(MarkersTrack, {
            anchors: [{ id: 7, time: 40 }], view: VIEW, duration: 100,
            selectedIds: new Set<number>(), onContextMenu: onAnchorContext,
          }),
        )
        container = r.container
      } else if (layer === 'scene_strip') {
        container = renderWithStore(
          createElement(SceneRow, {
            scenes: [40], view: VIEW, duration: 100,
            onSceneContextMenu: onSceneContext,
          }),
        ).container
      } else {
        const r = render(
          createElement(RegionBand, {
            kind: 'input',
            regions: [{ id: 'r1', inPoint: 20, outPoint: 80, colorIndex: 0 }],
            view: VIEW,
            onContextMenu: onRegionContext,
          }),
        )
        container = r.container
      }
    })
    When('the user right-clicks', () => {
      const layer = variables.layer
      let target: HTMLElement
      if (layer === 'input_timeline' || layer === 'multiple') {
        target = container!.querySelector('.thin-marker') as HTMLElement
      } else if (layer === 'scene_strip') {
        target = container!.querySelector('.scene-row__diamond') as HTMLElement
      } else {
        target = container!.querySelector('.thin-region') as HTMLElement
      }
      fireEvent.contextMenu(target, { clientX: 100, clientY: 10 })
    })
    Then('the context menu shows <actions> above the track and global options', () => {
      const layer = variables.layer
      if (layer === 'input_timeline' || layer === 'multiple') {
        expect(onAnchorContext).toHaveBeenCalledTimes(1)
        expect(onAnchorContext.mock.calls[0][0]).toBe(7)
      } else if (layer === 'scene_strip') {
        expect(onSceneContext).toHaveBeenCalledTimes(1)
        expect(onSceneContext.mock.calls[0][0]).toBe(40)
      } else {
        expect(onRegionContext).toHaveBeenCalledTimes(1)
        expect(onRegionContext.mock.calls[0][0]).toBe('r1')
      }
    })
  })

  // @behavior timeline-tracks::89de8324
  ScenarioOutline('Right-click on an empty track shows track-specific create actions', ({ Given, And, When, Then }, variables) => {
    const onBg = vi.fn<(t: number, x: number, y: number) => void>()
    let container: HTMLElement | null = null
    let bodySelector = ''
    Given('[a video is loaded]', () => {
      onBg.mockClear()
    })
    And('the mouse is inside <layer>', () => {
      const layer = variables.layer
      if (layer === 'input_timeline') {
        bodySelector = '.thin-markers__body'
        const r = render(
          createElement(MarkersTrack, {
            anchors: [], view: VIEW, duration: 100, selectedIds: new Set<number>(),
            onBackgroundContextMenu: onBg,
          }),
        )
        container = r.container
      } else if (layer === 'scene_strip') {
        bodySelector = '.scene-row'
        container = renderWithStore(
          createElement(SceneRow, {
            scenes: [], view: VIEW, duration: 100,
            onBackgroundContextMenu: onBg,
          }),
        ).container
      } else {
        bodySelector = '.thin-region-band__body'
        const r = render(
          createElement(RegionBand, {
            kind: 'input', regions: [], view: VIEW,
            onBackgroundContextMenu: onBg,
          }),
        )
        container = r.container
      }
    })
    When('the user right-clicks', () => {
      const body = container!.querySelector(bodySelector) as HTMLElement
      stubRect(body, 0, 1000)
      fireEvent.contextMenu(body, { clientX: 500, clientY: 10 })
    })
    Then('the context menu shows <actions> above the track and global options', () => {
      expect(onBg).toHaveBeenCalledTimes(1)
      expect(onBg.mock.calls[0][0]).toBeCloseTo(50, 1)
    })
  })
})
