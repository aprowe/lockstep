import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect, vi } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react/pure'
import { renderClipsPanel, makeRegion } from '../harnesses/clipsPanel'
import { renderMarkersPanel } from '../harnesses/markersPanel'
import { renderScenesPanel } from '../harnesses/scenesPanel'
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

type ListVariant = 'clips' | 'markers' | 'scenes'

interface PanelHandle {
  container: HTMLElement
  store: ReturnType<typeof renderClipsPanel>['store']
  seek: ReturnType<typeof renderClipsPanel>['seek']
  rowSelector: string
  /** Read the current selection as a stringified id array — works across
   *  the per-list selection sources (lists.selection.{clips,scenes} or
   *  warp.selectedIds for markers). */
  readSelection: () => string[]
}

/** Render the list panel for the given variant pre-seeded with three rows
 *  and the optional initial selection. Returns a uniform handle so the
 *  shared scenario bindings can stay list-agnostic. */
function renderListVariant(list: ListVariant, opts: { selectedIndex?: number } = {}): PanelHandle {
  if (list === 'clips') {
    const a = makeRegion('clip-a', 'A', 5, 15)
    const b = makeRegion('clip-b', 'B', 20, 30)
    const c = makeRegion('clip-c', 'C', 35, 45)
    const all = [a, b, c]
    const harness = renderClipsPanel({
      regions: all,
      selectedClipIds: opts.selectedIndex !== undefined ? [all[opts.selectedIndex].id] : undefined,
    })
    return {
      container: harness.container,
      store: harness.store,
      seek: harness.seek,
      rowSelector: '.clip-row:not(.clip-row--full)',
      readSelection: () => [...harness.store.getState().lists.selection.clips],
    }
  }
  if (list === 'markers') {
    const anchors = [
      { id: 1, time: 5 },
      { id: 2, time: 15 },
      { id: 3, time: 25 },
    ]
    const harness = renderMarkersPanel({
      anchors,
      selectedAnchorIds: opts.selectedIndex !== undefined ? [anchors[opts.selectedIndex].id] : undefined,
    })
    return {
      container: harness.container,
      store: harness.store,
      seek: harness.seek,
      rowSelector: '.marker-row',
      readSelection: () => harness.store.getState().warp.selectedIds.map(String),
    }
  }
  // scenes — boundaries [0, 10, 20, 30, 120] → 4 rows; treat row index 0
  // as "skip" so callers selecting index 0/1/2 always pick a real cut row.
  const cuts = [10, 20, 30]
  const harness = renderScenesPanel({
    cuts,
    selectedSceneIds: opts.selectedIndex !== undefined ? [String(opts.selectedIndex)] : undefined,
  })
  return {
    container: harness.container,
    store: harness.store,
    seek: harness.seek,
    rowSelector: '.scene-row',
    readSelection: () => [...harness.store.getState().lists.selection.scenes],
  }
}

describeFeature(feature, ({ Scenario, ScenarioOutline, BeforeEachScenario }) => {
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

  // @behavior list-selection::c16d9138
  Scenario('Timeline Delete also removes selected scene cuts', ({ Given, When, Then, And }) => {
    const observed: {
      cutsRemaining: number[]
      sceneSelection: number[]
    } = { cutsRemaining: [], sceneSelection: [] }
    const cuts = [12, 25, 41]

    Given('the timeline has two selected scene cuts', () => {})
    When('the user presses Delete with the timeline focused', () => {
      const harness = renderThinTimeline({
        scenes: cuts,
        selectedSceneTimes: [12, 41],
      })
      const root = harness.container.querySelector('.thin-timeline') as HTMLElement
      root.focus()
      fireEvent.keyDown(root, { key: 'Delete' })
      const s = harness.store.getState()
      observed.cutsRemaining = [...(s.scene.cutsByPath[harness.videoPath] ?? [])]
      observed.sceneSelection = [...s.scene.selectedCutTimes]
    })
    Then('the selected cuts are removed from the scene list', () => {
      expect(observed.cutsRemaining).toEqual([25])
    })
    And('the scene-cut selection is cleared', () => {
      expect(observed.sceneSelection).toEqual([])
    })
  })

  // @behavior list-selection::bc0146f7
  Scenario('Timeline Cmd+D also clears the scene-cut selection', ({ Given, When, Then, And }) => {
    const observed: {
      cutsRemaining: number[]
      sceneSelection: number[]
    } = { cutsRemaining: [], sceneSelection: [] }
    const cuts = [12, 25]

    Given('the timeline has two selected scene cuts', () => {})
    When('the user presses Cmd+D with the timeline focused', () => {
      const harness = renderThinTimeline({
        scenes: cuts,
        selectedSceneTimes: [12, 25],
      })
      const root = harness.container.querySelector('.thin-timeline') as HTMLElement
      root.focus()
      fireEvent.keyDown(root, { key: 'd', metaKey: true })
      const s = harness.store.getState()
      observed.cutsRemaining = [...(s.scene.cutsByPath[harness.videoPath] ?? [])]
      observed.sceneSelection = [...s.scene.selectedCutTimes]
    })
    Then('the scene-cut selection is cleared', () => {
      expect(observed.sceneSelection).toEqual([])
    })
    And('the cuts themselves remain', () => {
      expect([...observed.cutsRemaining].sort((a, b) => a - b)).toEqual(cuts)
    })
  })

  // @behavior list-selection::5afb8d06
  Scenario('Plain click on empty timeline clears the scene-cut selection', ({ Given, When, Then }) => {
    const observed: { sceneSelection: number[] } = { sceneSelection: [] }
    const cuts = [12, 25]

    Given('the timeline has two selected scene cuts', () => {})
    When('the user clicks the empty timeline body with no modifier keys and no drag', () => {
      const harness = renderThinTimeline({
        scenes: cuts,
        selectedSceneTimes: [12, 25],
      })
      const root = harness.container.querySelector('.thin-timeline') as HTMLElement
      fireEvent.pointerDown(root, {
        button: 0, pointerId: 1, clientX: 50, clientY: 50,
      })
      fireEvent.pointerUp(root, {
        button: 0, pointerId: 1, clientX: 50, clientY: 50,
      })
      observed.sceneSelection = [...harness.store.getState().scene.selectedCutTimes]
    })
    Then('the scene-cut selection is cleared', () => {
      expect(observed.sceneSelection).toEqual([])
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

  // ── Multi-select chrome ─────────────────────────────────────────────────

  // @behavior list-selection::0763ac4b
  Scenario('Selection bar appears when 2+ rows are selected', ({ Given, Then, And }) => {
    const observed: {
      countText: string | null
      hasClear: boolean
      hasTrash: boolean
    } = { countText: null, hasClear: false, hasTrash: false }
    const a = makeRegion('clip-a', 'A', 5, 15)
    const b = makeRegion('clip-b', 'B', 20, 30)

    Given('a populated list with two rows selected', () => {
      const harness = renderClipsPanel({
        regions: [a, b],
        selectedClipIds: [a.id, b.id],
      })
      const countEl = harness.container.querySelector('.list-panel__selection-count')
      observed.countText = countEl?.textContent ?? null
      observed.hasClear = !!harness.container.querySelector('[title="Clear selection"]')
      observed.hasTrash = !!harness.container.querySelector('[title="Delete selected"]')
    })
    Then('the panel header shows "2 selected"', () => {
      expect(observed.countText).toBe('2 selected')
    })
    And('a clear-selection (deselect) button is visible', () => {
      expect(observed.hasClear).toBe(true)
    })
    And('a bulk-delete (trash) button is visible', () => {
      expect(observed.hasTrash).toBe(true)
    })
  })

  // @behavior list-selection::152900a6
  Scenario('Per-row checkboxes appear when 2+ rows are selected', ({ Given, Then, And }) => {
    const observed: {
      checkedIds: string[]
      uncheckedIds: string[]
    } = { checkedIds: [], uncheckedIds: [] }
    const a = makeRegion('clip-a', 'A', 5, 15)
    const b = makeRegion('clip-b', 'B', 20, 30)
    const c = makeRegion('clip-c', 'C', 35, 45)

    Given('a populated list with two rows selected', () => {
      const harness = renderClipsPanel({
        regions: [a, b, c],
        selectedClipIds: [a.id, b.id],
      })
      const rows = harness.container.querySelectorAll('.clip-row:not(.clip-row--full)')
      rows.forEach((row, i) => {
        const id = [a, b, c][i].id
        const check = row.querySelector('input.clip-row__check') as HTMLInputElement | null
        if (!check) return
        if (check.checked) observed.checkedIds.push(id)
        else observed.uncheckedIds.push(id)
      })
    })
    Then('every visible row shows a checkbox', () => {
      // 3 rows, 3 checkboxes (covered ids must be exhaustive).
      expect(observed.checkedIds.length + observed.uncheckedIds.length).toBe(3)
    })
    And('the checkbox is checked for currently-selected rows', () => {
      expect(observed.checkedIds.sort()).toEqual([a.id, b.id].sort())
    })
    And('the checkbox is unchecked for unselected rows', () => {
      expect(observed.uncheckedIds).toEqual([c.id])
    })
  })

  // @behavior list-selection::0530ee04
  Scenario('Single selection has no checkboxes or bulk-action chrome', ({ Given, Then, And }) => {
    const observed: { checkboxCount: number; selectionBarVisible: boolean } = {
      checkboxCount: 0, selectionBarVisible: false,
    }
    const a = makeRegion('clip-a', 'A', 5, 15)
    const b = makeRegion('clip-b', 'B', 20, 30)

    Given('a populated list with exactly one row selected', () => {
      const harness = renderClipsPanel({
        regions: [a, b],
        selectedClipIds: [a.id],
      })
      observed.checkboxCount = harness.container.querySelectorAll('input.clip-row__check').length
      observed.selectionBarVisible = !!harness.container.querySelector('.list-panel__selection')
    })
    Then('no per-row checkboxes are rendered', () => {
      expect(observed.checkboxCount).toBe(0)
    })
    And('the selection bar is hidden', () => {
      expect(observed.selectionBarVisible).toBe(false)
    })
  })

  // @behavior list-selection::e6ae004a
  Scenario('Checkbox click toggles selection without activating', ({ Given, When, Then, And }) => {
    const observed: {
      selectionAfter: string[]
      activeAfter: string | null
      seekCalls: number
    } = { selectionAfter: [], activeAfter: null, seekCalls: 0 }
    const a = makeRegion('clip-a', 'A', 5, 15)
    const b = makeRegion('clip-b', 'B', 20, 30)
    const c = makeRegion('clip-c', 'C', 35, 45)

    Given('a populated list with two rows selected', () => {})
    When("the user clicks an unselected row's checkbox", () => {
      const harness = renderClipsPanel({
        regions: [a, b, c],
        selectedClipIds: [a.id, b.id],
        activeRegionId: a.id,
      })
      const rows = harness.container.querySelectorAll('.clip-row:not(.clip-row--full)')
      // Third row = clip-c (unselected).
      const checkC = rows[2].querySelector('input.clip-row__check') as HTMLInputElement
      // Toggling onChange fires the handler — onChange dispatches setListSelection.
      fireEvent.click(checkC)
      observed.selectionAfter = [...harness.store.getState().lists.selection.clips]
      observed.activeAfter = harness.store.getState().region.activeRegionId
      observed.seekCalls = harness.seek.mock.calls.length
    })
    Then('that row joins the selection', () => {
      expect([...observed.selectionAfter].sort()).toEqual([a.id, b.id, c.id].sort())
    })
    And('the activate handler is not called', () => {
      // Active region unchanged AND seek not invoked — both signals of activation.
      expect(observed.activeAfter).toBe(a.id)
      expect(observed.seekCalls).toBe(0)
    })
  })

  // ── Per-row vs bulk delete ──────────────────────────────────────────────

  // @behavior list-selection::5287d418
  Scenario('Per-row trash removes only that row', ({ Given, When, Then, And }) => {
    const observed: {
      regionsAfter: string[]
      selectionAfter: string[]
    } = { regionsAfter: [], selectionAfter: [] }
    const a = makeRegion('clip-a', 'A', 5, 15)
    const b = makeRegion('clip-b', 'B', 20, 30)
    const c = makeRegion('clip-c', 'C', 35, 45)
    const d = makeRegion('clip-d', 'D', 50, 60)

    Given('a populated list with three rows selected', () => {})
    When('the user clicks the trash button on a different (unselected) row', () => {
      const harness = renderClipsPanel({
        regions: [a, b, c, d],
        selectedClipIds: [a.id, b.id, c.id],
      })
      const rows = harness.container.querySelectorAll('.clip-row:not(.clip-row--full)')
      // Fourth row = clip-d (unselected). Per-row trash button.
      const trashD = rows[3].querySelector('button.clip-row__del') as HTMLButtonElement
      fireEvent.click(trashD)
      observed.regionsAfter = harness.store.getState().region.regions.map(r => r.id)
      observed.selectionAfter = [...harness.store.getState().lists.selection.clips]
    })
    Then('only that row is removed', () => {
      expect(observed.regionsAfter).toEqual([a.id, b.id, c.id])
    })
    And('the original three-row selection is unchanged', () => {
      expect([...observed.selectionAfter].sort()).toEqual([a.id, b.id, c.id].sort())
    })
  })

  // @behavior list-selection::da2c6dec
  Scenario('Header trash removes the entire selection', ({ Given, When, Then, And }) => {
    const observed: {
      regionsAfter: string[]
      selectionAfter: string[]
    } = { regionsAfter: [], selectionAfter: [] }
    const a = makeRegion('clip-a', 'A', 5, 15)
    const b = makeRegion('clip-b', 'B', 20, 30)
    const c = makeRegion('clip-c', 'C', 35, 45)
    const d = makeRegion('clip-d', 'D', 50, 60)

    Given('a populated list with three rows selected', () => {})
    When('the user clicks the trash button in the selection header', () => {
      const harness = renderClipsPanel({
        regions: [a, b, c, d],
        selectedClipIds: [a.id, b.id, c.id],
      })
      const headerTrash = harness.container.querySelector(
        '.list-panel__selection [title="Delete selected"]',
      ) as HTMLButtonElement
      fireEvent.click(headerTrash)
      observed.regionsAfter = harness.store.getState().region.regions.map(r => r.id)
      observed.selectionAfter = [...harness.store.getState().lists.selection.clips]
    })
    Then('all three selected rows are removed', () => {
      expect(observed.regionsAfter).toEqual([d.id])
    })
    And('the selection is cleared', () => {
      expect(observed.selectionAfter).toEqual([])
    })
  })

  // @behavior list-selection::0c8fc530
  Scenario('Delete key on focused list removes selection', ({ Given, When, Then, And }) => {
    const observed: {
      regionsAfter: string[]
      selectionAfter: string[]
    } = { regionsAfter: [], selectionAfter: [] }
    const a = makeRegion('clip-a', 'A', 5, 15)
    const b = makeRegion('clip-b', 'B', 20, 30)
    const c = makeRegion('clip-c', 'C', 35, 45)

    Given('a populated list with focus and a non-empty selection', () => {})
    When('the user presses Delete', () => {
      const harness = renderClipsPanel({
        regions: [a, b, c],
        selectedClipIds: [a.id, b.id],
      })
      const panel = harness.container.querySelector('.list-panel') as HTMLElement
      panel.focus()
      fireEvent.keyDown(panel, { key: 'Delete' })
      observed.regionsAfter = harness.store.getState().region.regions.map(r => r.id)
      observed.selectionAfter = [...harness.store.getState().lists.selection.clips]
    })
    Then('every selected row is removed', () => {
      expect(observed.regionsAfter).toEqual([c.id])
    })
    And('the selection is cleared', () => {
      expect(observed.selectionAfter).toEqual([])
    })
  })

  // ── Active vs selected (clips-specific) ─────────────────────────────────

  // @behavior list-selection::8e807736
  Scenario('Plain click on a clip sets both active and selection', ({ Given, When, Then, And }) => {
    const observed: {
      selection: string[]
      activeId: string | null
      seekCalls: number[]
    } = { selection: [], activeId: null, seekCalls: [] }
    const a = makeRegion('clip-a', 'A', 5, 15)
    const b = makeRegion('clip-b', 'B', 20, 30)

    Given('the clips list', () => {})
    When('the user clicks a clip row with no modifier keys', () => {
      const harness = renderClipsPanel({ regions: [a, b] })
      const rows = harness.container.querySelectorAll('.clip-row:not(.clip-row--full)')
      fireEvent.click(rows[1] as HTMLElement)
      observed.selection = [...harness.store.getState().lists.selection.clips]
      observed.activeId = harness.store.getState().region.activeRegionId
      observed.seekCalls = harness.seek.mock.calls.map(c => c[0] as number)
    })
    Then('that clip becomes the only selected clip', () => {
      expect(observed.selection).toEqual([b.id])
    })
    And('it becomes the active region', () => {
      expect(observed.activeId).toBe(b.id)
    })
    And('the player seeks to its in-point', () => {
      expect(observed.seekCalls).toEqual([b.inPoint])
    })
  })

  // @behavior list-selection::e190e98b
  Scenario("Modifier-clicks on clips don't change the active region", ({ Given, When, Then, And }) => {
    const observed: {
      activeId: string | null
      selection: string[]
    } = { activeId: null, selection: [] }
    const a = makeRegion('clip-a', 'A', 5, 15)
    const b = makeRegion('clip-b', 'B', 20, 30)

    Given('the clips list with clip A active and selected', () => {})
    When('the user shift-clicks or ctrl-clicks clip B', () => {
      const harness = renderClipsPanel({
        regions: [a, b],
        activeRegionId: a.id,
        selectedClipIds: [a.id],
      })
      const rows = harness.container.querySelectorAll('.clip-row:not(.clip-row--full)')
      // Ctrl-click — additive, shouldn't activate.
      fireEvent.click(rows[1] as HTMLElement, { ctrlKey: true })
      observed.activeId = harness.store.getState().region.activeRegionId
      observed.selection = [...harness.store.getState().lists.selection.clips]
    })
    Then('clip A remains the active region', () => {
      expect(observed.activeId).toBe(a.id)
    })
    And('the selection now includes both clips A and B', () => {
      expect([...observed.selection].sort()).toEqual([a.id, b.id].sort())
    })
  })

  // ── Cross-list independence ─────────────────────────────────────────────

  // @behavior list-selection::ecdd90c1
  Scenario('Selecting in one list does not affect another list', ({ Given, And, When, Then }) => {
    const observed: { markersAfter: number[] } = { markersAfter: [] }
    const a = makeRegion('clip-a', 'A', 5, 15)
    const b = makeRegion('clip-b', 'B', 20, 30)

    Given('a clip is selected in the clips list', () => {})
    And('a marker is selected in the markers list', () => {})
    When('the user selects another clip', () => {
      const harness = renderClipsPanel({
        regions: [a, b],
        selectedClipIds: [a.id],
        selectedMarkerIds: [101, 202],
      })
      const rows = harness.container.querySelectorAll('.clip-row:not(.clip-row--full)')
      fireEvent.click(rows[1] as HTMLElement)
      observed.markersAfter = [...harness.store.getState().warp.selectedIds]
    })
    Then('the marker selection is unchanged', () => {
      expect([...observed.markersAfter].sort()).toEqual([101, 202].sort())
    })
  })

  // ── Filter independence ─────────────────────────────────────────────────

  // @behavior list-selection::67c421a9
  Scenario('Selection survives a filter change', ({ Given, When, And, Then }) => {
    const observed: {
      selectionAfter: string[]
      visibleIds: string[]
    } = { selectionAfter: [], visibleIds: [] }
    // a sits at [5,15], b at [40,50], c at [80,90]. A viewport of 0..30 hides
    // both b and c — only a's range overlaps. Selection set is independent
    // of which rows are visible.
    const a = makeRegion('clip-a', 'A', 5, 15)
    const b = makeRegion('clip-b', 'B', 40, 50)
    const c = makeRegion('clip-c', 'C', 80, 90)

    Given('a list with three rows selected', () => {})
    When('the user switches the list filter from All to View', () => {
      // Pre-seed the viewport so the filter actually hides one row;
      // mode change happens at render time via the harness option.
      const harness = renderClipsPanel({
        regions: [a, b, c],
        selectedClipIds: [a.id, b.id, c.id],
        view: { start: 0, end: 30 },
        filterMode: 'viewport',
      })
      const rows = harness.container.querySelectorAll('.clip-row:not(.clip-row--full)')
      observed.visibleIds = Array.from(rows).map(r => {
        // ClipRow renders the clip name in `.clip-row__name` — match by name.
        const name = r.querySelector('.clip-row__name')?.textContent ?? ''
        return [a, b, c].find(x => x.name === name)?.id ?? ''
      })
      observed.selectionAfter = [...harness.store.getState().lists.selection.clips]
    })
    And('the filter hides one of the selected rows', () => {
      // Only clip A's [5,15] overlaps the [0,30] viewport — b and c are out.
      expect(observed.visibleIds).toEqual([a.id])
    })
    Then('the hidden row remains in the selection', () => {
      expect([...observed.selectionAfter].sort()).toEqual([a.id, b.id, c.id].sort())
    })
    And('the rows still visible remain selected and checked', () => {
      // The single visible row is selected — selectedClipIds includes a.
      expect(observed.selectionAfter).toContain(a.id)
    })
  })

  // ── Click semantics shared by every list (clips / markers / scenes) ─────

  // @behavior list-selection::b8d2081f
  ScenarioOutline('Plain click selects one row and activates it', ({ Given, When, Then, And }, variables) => {
    const observed: { selection: string[]; seekCalls: number } = {
      selection: [], seekCalls: 0,
    }

    Given('a populated <list> list', () => {})
    When('the user clicks a row with no modifier keys', () => {
      const list = variables.list as ListVariant
      const handle = renderListVariant(list)
      const rows = handle.container.querySelectorAll(handle.rowSelector)
      // Row index 1 is always a real, second-position row across all lists.
      fireEvent.click(rows[1] as HTMLElement)
      observed.selection = handle.readSelection()
      observed.seekCalls = handle.seek.mock.calls.length
    })
    Then("only that row is in the list's selection", () => {
      expect(observed.selection.length).toBe(1)
    })
    And("the row's activate handler fires once for that id", () => {
      expect(observed.seekCalls).toBe(1)
    })
  })

  // @behavior list-selection::b99b4eb7
  ScenarioOutline('Shift-click range-extends the selection without activating', ({ Given, When, Then, And }, variables) => {
    const observed: {
      selectionAfterShift: string[]
      seekDelta: number
    } = { selectionAfterShift: [], seekDelta: 0 }

    Given('a populated <list> list with one row already selected', () => {})
    When('the user shift-clicks a different row', () => {
      const list = variables.list as ListVariant
      const handle = renderListVariant(list)
      const rows = handle.container.querySelectorAll(handle.rowSelector)
      // Plain-click row 0 first to seed selection + anchor (the spec's
      // "one row already selected" precondition flows through plain click).
      fireEvent.click(rows[0] as HTMLElement)
      const seekBefore = handle.seek.mock.calls.length
      // Now shift-click row 2 — should range-extend to include 0,1,2.
      fireEvent.click(rows[2] as HTMLElement, { shiftKey: true })
      observed.selectionAfterShift = handle.readSelection()
      observed.seekDelta = handle.seek.mock.calls.length - seekBefore
    })
    Then('the selection now contains every row between the anchor and the clicked row, inclusive', () => {
      expect(observed.selectionAfterShift.length).toBe(3)
    })
    And('the activate handler is not called', () => {
      expect(observed.seekDelta).toBe(0)
    })
  })

  // @behavior list-selection::1e9814c2
  ScenarioOutline('Ctrl-click toggles a single row in the selection', ({ Given, When, Then, And }, variables) => {
    // The two When/Then pairs share the rendered panel — capture it at the
    // top of the binding so each step can poke the same DOM/store.
    let handle: PanelHandle | null = null
    let rows: NodeListOf<Element> = [] as unknown as NodeListOf<Element>
    let seekBefore = 0
    const observed: {
      selectionAfterAdd: string[]
      seekDeltaAdd: number
      selectionAfterRemove: string[]
      seekDeltaRemove: number
    } = {
      selectionAfterAdd: [], seekDeltaAdd: 0,
      selectionAfterRemove: [], seekDeltaRemove: 0,
    }

    Given('a populated <list> list with one row selected', () => {
      const list = variables.list as ListVariant
      handle = renderListVariant(list, { selectedIndex: 0 })
      rows = handle.container.querySelectorAll(handle.rowSelector)
    })
    When('the user ctrl-clicks an unselected row', () => {
      seekBefore = handle!.seek.mock.calls.length
      fireEvent.click(rows[1] as HTMLElement, { ctrlKey: true })
      observed.selectionAfterAdd = handle!.readSelection()
      observed.seekDeltaAdd = handle!.seek.mock.calls.length - seekBefore
    })
    Then('both rows are in the selection', () => {
      expect(observed.selectionAfterAdd.length).toBe(2)
    })
    And('the activate handler is not called', () => {
      expect(observed.seekDeltaAdd).toBe(0)
    })
    When('the user ctrl-clicks one of the selected rows', () => {
      seekBefore = handle!.seek.mock.calls.length
      fireEvent.click(rows[0] as HTMLElement, { ctrlKey: true })
      observed.selectionAfterRemove = handle!.readSelection()
      observed.seekDeltaRemove = handle!.seek.mock.calls.length - seekBefore
    })
    Then('that row is removed from the selection', () => {
      // Row 0 was just removed; row 1 (toggled in earlier) must remain.
      expect(observed.selectionAfterRemove.length).toBe(1)
    })
    And('the other selected rows remain selected', () => {
      // Activate must not have fired on the toggle-off either.
      expect(observed.seekDeltaRemove).toBe(0)
    })
  })
})
