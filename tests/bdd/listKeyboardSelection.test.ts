import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect, vi } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react/pure'
import { renderClipsPanel, makeRegion } from '../harnesses/clipsPanel'
import {
  renderThinTimeline,
  makeAnchor,
  makeRegion as makeTimelineRegion,
} from '../harnesses/thinTimeline'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
  convertFileSrc: (p: string) => `tauri://localhost/${p}`,
}))

const feature = await loadFeature('./spec/features/list-selection.feature')

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(() => { cleanup() })

  // @behavior list-selection::cb8929f5
  Scenario('Right-click on an unselected clip pre-selects it', ({ Given, When, Then, And }) => {
    const observed: { selection: string[]; activeId: string | null; menuVisible: boolean } = {
      selection: [], activeId: null, menuVisible: false,
    }
    const a = makeRegion('clip-a', 'A', 5, 15)
    const b = makeRegion('clip-b', 'B', 20, 30)

    Given('the clips list with two clips and clip A is selected', () => {})
    When('the user right-clicks clip B', () => {
      const harness = renderClipsPanel({
        regions: [a, b],
        activeRegionId: a.id,
        selectedClipIds: [a.id],
      })
      // Find clip B by label — second non-Full-Video row.
      const rows = harness.container.querySelectorAll('.clip-row:not(.clip-row--full)')
      const rowB = rows[1] as HTMLElement
      fireEvent.contextMenu(rowB, { clientX: 50, clientY: 50 })
      observed.selection = harness.store.getState().lists.selection.clips
      observed.activeId = harness.store.getState().region.activeRegionId
      observed.menuVisible = !!screen.queryByText('Rename')
    })
    Then('clip B is the only selected clip', () => {
      expect(observed.selection).toEqual([b.id])
    })
    And('clip B becomes the active region', () => {
      expect(observed.activeId).toBe(b.id)
    })
    And('the context menu is shown for clip B', () => {
      expect(observed.menuVisible).toBe(true)
    })
  })

  // @behavior list-selection::0462dc5d
  Scenario('Right-click on an already-selected clip preserves the multi-selection', ({ Given, When, Then }) => {
    const observed: { selectionAfter: string[] } = { selectionAfter: [] }
    const a = makeRegion('clip-a', 'A', 5, 15)
    const b = makeRegion('clip-b', 'B', 20, 30)
    const c = makeRegion('clip-c', 'C', 35, 45)

    Given('the clips list with three clips all selected', () => {})
    When('the user right-clicks one of them', () => {
      const harness = renderClipsPanel({
        regions: [a, b, c],
        selectedClipIds: [a.id, b.id, c.id],
      })
      const rows = harness.container.querySelectorAll('.clip-row:not(.clip-row--full)')
      fireEvent.contextMenu(rows[1] as HTMLElement, { clientX: 50, clientY: 50 })
      observed.selectionAfter = harness.store.getState().lists.selection.clips
    })
    Then('all three clips are still selected', () => {
      expect([...observed.selectionAfter].sort()).toEqual([a.id, b.id, c.id].sort())
    })
  })

  // @behavior list-selection::a9ef63b3
  Scenario('Cmd+A in the clips list selects every visible row', ({ Given, When, Then }) => {
    const observed: { selection: string[] } = { selection: [] }
    const a = makeRegion('clip-a', 'A', 5, 15)
    const b = makeRegion('clip-b', 'B', 20, 30)
    const c = makeRegion('clip-c', 'C', 35, 45)

    Given('the clips list with three clips and none selected', () => {})
    When('the user presses Cmd+A with the clips list focused', () => {
      const harness = renderClipsPanel({ regions: [a, b, c] })
      const panel = harness.container.querySelector('.list-panel') as HTMLElement
      panel.focus()
      fireEvent.keyDown(panel, { key: 'a', metaKey: true })
      observed.selection = harness.store.getState().lists.selection.clips
    })
    Then('all three clips are selected', () => {
      expect([...observed.selection].sort()).toEqual([a.id, b.id, c.id].sort())
    })
  })

  // @behavior list-selection::022db7fb
  Scenario("Cmd+D in the clips list clears its selection only", ({ Given, And, When, Then }) => {
    const observed: { clipsAfter: string[]; markersAfter: number[] } = {
      clipsAfter: [], markersAfter: [],
    }
    const a = makeRegion('clip-a', 'A', 5, 15)
    const b = makeRegion('clip-b', 'B', 20, 30)

    Given('the clips list with two clips selected', () => {})
    And('the markers list also has selected markers', () => {})
    When('the user presses Cmd+D with the clips list focused', () => {
      // Pre-seed BOTH selections via the harness so the rendered panel's
      // closures see them on first commit. Markers live in warp.selectedIds
      // (focus-scoping rule: Cmd+D in clips must not touch them).
      const harness = renderClipsPanel({
        regions: [a, b],
        selectedClipIds: [a.id, b.id],
        selectedMarkerIds: [101, 202],
      })
      const panel = harness.container.querySelector('.list-panel') as HTMLElement
      panel.focus()
      fireEvent.keyDown(panel, { key: 'd', metaKey: true })
      observed.clipsAfter = harness.store.getState().lists.selection.clips
      observed.markersAfter = [...harness.store.getState().warp.selectedIds]
    })
    Then('the clips selection is cleared', () => {
      expect(observed.clipsAfter).toEqual([])
    })
    And('the markers selection is unchanged', () => {
      expect([...observed.markersAfter].sort()).toEqual([101, 202].sort())
    })
  })

  // ── Timeline-focused keyboard + empty-click deselect ─────────────────────

  // @behavior list-selection::440d0555
  Scenario('Timeline Delete removes the union of clip + marker selections', ({ Given, When, Then, And }) => {
    const observed: {
      clipsRemaining: string[]
      anchorsRemaining: number[]
      clipsSelection: string[]
      markersSelection: number[]
    } = {
      clipsRemaining: [], anchorsRemaining: [], clipsSelection: [], markersSelection: [],
    }
    const a = makeTimelineRegion('clip-a', 'A', 5, 15)
    const b = makeTimelineRegion('clip-b', 'B', 20, 30)
    const m1 = makeAnchor(101, 6)
    const m2 = makeAnchor(102, 12)
    const m3 = makeAnchor(103, 25)

    Given('the timeline has two selected clips and three selected markers', () => {})
    When('the user presses Delete with the timeline focused', () => {
      const harness = renderThinTimeline({
        regions: [a, b],
        anchors: [m1, m2, m3],
        selectedClipIds: [a.id, b.id],
        selectedMarkerIds: [m1.id, m2.id, m3.id],
      })
      const root = harness.container.querySelector('.thin-timeline') as HTMLElement
      root.focus()
      fireEvent.keyDown(root, { key: 'Delete' })
      const s = harness.store.getState()
      observed.clipsRemaining = s.region.regions.map(r => r.id)
      observed.anchorsRemaining = s.warp.origAnchors.map(x => x.id)
      observed.clipsSelection = [...s.lists.selection.clips]
      observed.markersSelection = [...s.warp.selectedIds]
    })
    Then('the two clips are removed', () => {
      expect(observed.clipsRemaining).toEqual([])
    })
    And('the three markers are removed', () => {
      expect(observed.anchorsRemaining).toEqual([])
    })
    And('both selections are cleared', () => {
      expect(observed.clipsSelection).toEqual([])
      expect(observed.markersSelection).toEqual([])
    })
  })

  // @behavior list-selection::9ca01b60
  Scenario('Timeline Cmd+D clears every timeline-side selection', ({ Given, When, Then, And }) => {
    const observed: {
      clipsSelection: string[]
      markersSelection: number[]
      clipsRemaining: string[]
      anchorsRemaining: number[]
    } = {
      clipsSelection: [], markersSelection: [], clipsRemaining: [], anchorsRemaining: [],
    }
    const a = makeTimelineRegion('clip-a', 'A', 5, 15)
    const m1 = makeAnchor(101, 6)
    const m2 = makeAnchor(102, 25)

    Given('the timeline has selected clips and selected markers', () => {})
    When('the user presses Cmd+D with the timeline focused', () => {
      const harness = renderThinTimeline({
        regions: [a],
        anchors: [m1, m2],
        selectedClipIds: [a.id],
        selectedMarkerIds: [m1.id, m2.id],
      })
      const root = harness.container.querySelector('.thin-timeline') as HTMLElement
      root.focus()
      fireEvent.keyDown(root, { key: 'd', metaKey: true })
      const s = harness.store.getState()
      observed.clipsSelection = [...s.lists.selection.clips]
      observed.markersSelection = [...s.warp.selectedIds]
      observed.clipsRemaining = s.region.regions.map(r => r.id)
      observed.anchorsRemaining = s.warp.origAnchors.map(x => x.id)
    })
    Then('the clips selection is cleared', () => {
      expect(observed.clipsSelection).toEqual([])
    })
    And('the markers selection is cleared', () => {
      expect(observed.markersSelection).toEqual([])
    })
    And('no items are deleted', () => {
      expect(observed.clipsRemaining).toEqual([a.id])
      expect([...observed.anchorsRemaining].sort()).toEqual([m1.id, m2.id].sort())
    })
  })

  // @behavior list-selection::871d21c2
  Scenario('Plain click on empty timeline clears every timeline-side selection', ({ Given, And, When, Then }) => {
    const observed: {
      clipsSelection: string[]
      markersSelection: number[]
      activeId: string | null
    } = { clipsSelection: [], markersSelection: [], activeId: null }
    const a = makeTimelineRegion('clip-a', 'A', 5, 15)
    const m1 = makeAnchor(101, 6)

    Given('the timeline has selected clips and selected markers', () => {})
    And('the active clip is set', () => {})
    When('the user clicks the empty timeline body with no modifier keys and no drag', () => {
      const harness = renderThinTimeline({
        regions: [a],
        anchors: [m1],
        selectedClipIds: [a.id],
        selectedMarkerIds: [m1.id],
        activeRegionId: a.id,
      })
      const root = harness.container.querySelector('.thin-timeline') as HTMLElement
      // Plain pointerdown → pointerup with no movement and no modifier keys
      // is the empty-click deselect path (Policy B).
      fireEvent.pointerDown(root, {
        button: 0, pointerId: 1, clientX: 50, clientY: 50,
      })
      fireEvent.pointerUp(root, {
        button: 0, pointerId: 1, clientX: 50, clientY: 50,
      })
      const s = harness.store.getState()
      observed.clipsSelection = [...s.lists.selection.clips]
      observed.markersSelection = [...s.warp.selectedIds]
      observed.activeId = s.region.activeRegionId
    })
    Then('both timeline selections are cleared', () => {
      expect(observed.clipsSelection).toEqual([])
      expect(observed.markersSelection).toEqual([])
    })
    And('the active clip is unchanged', () => {
      expect(observed.activeId).toBe(a.id)
    })
  })

  // @behavior list-selection::5253b594
  Scenario('Modifier-click on empty timeline does not clear selection', ({ Given, When, Then }) => {
    const observed: {
      clipsSelection: string[]
      markersSelection: number[]
    } = { clipsSelection: [], markersSelection: [] }
    const a = makeTimelineRegion('clip-a', 'A', 5, 15)
    const m1 = makeAnchor(101, 6)

    Given('the timeline has selected clips and selected markers', () => {})
    When('the user ctrl-clicks the empty timeline body with no drag', () => {
      const harness = renderThinTimeline({
        regions: [a],
        anchors: [m1],
        selectedClipIds: [a.id],
        selectedMarkerIds: [m1.id],
      })
      const root = harness.container.querySelector('.thin-timeline') as HTMLElement
      // Ctrl-pointerdown arms an additive lasso; pointerup with no
      // movement is a no-op — the prior selection survives.
      fireEvent.pointerDown(root, {
        button: 0, pointerId: 1, clientX: 50, clientY: 50, ctrlKey: true,
      })
      fireEvent.pointerUp(root, {
        button: 0, pointerId: 1, clientX: 50, clientY: 50, ctrlKey: true,
      })
      const s = harness.store.getState()
      observed.clipsSelection = [...s.lists.selection.clips]
      observed.markersSelection = [...s.warp.selectedIds]
    })
    Then('both selections are unchanged', () => {
      expect(observed.clipsSelection).toEqual([a.id])
      expect([...observed.markersSelection]).toEqual([m1.id])
    })
  })
})
