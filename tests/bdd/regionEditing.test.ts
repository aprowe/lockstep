import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react/pure'
import { addRegion, updateRegionInOut } from '../../src/store/slices/regionSlice'
import { pushSnapshot, undo } from '../../src/store/slices/historySlice'
import { calcZoomToRegion, viewFitsRegion } from '../../src/utils/view'
import { makeStore } from '../helpers/setup'
import { renderTimeline } from '../harnesses/timeline'

const feature = await loadFeature('./spec/features/region-editing.feature')

const makeRegion = (id: string, inPoint: number, outPoint: number) => ({
  id, name: id, inPoint, outPoint, bpm: 120, minStretch: 0.5, maxStretch: 2, addToEnd: false,
})

const snap = (store: ReturnType<typeof makeStore>) =>
  store.dispatch(pushSnapshot({
    origAnchors: [], beatAnchors: [], linkedBeatIds: [], beatZeroId: null,
    regions: store.getState().region.regions,
  }))

describeFeature(feature, ({ Scenario, ScenarioOutline, BeforeEachScenario }) => {
  BeforeEachScenario(() => { cleanup() })
  // @behavior region-editing::5b468a4b
  Scenario('A regions start bounds can be undone', ({ Given, When, And, Then }) => {
    const store = makeStore()

    Given('A region with start 10 and end 20', () => {
      store.dispatch(addRegion(makeRegion('r', 10, 20)))
      snap(store)
    })
    When('The regions start is changed to 15', () => {
      store.dispatch(updateRegionInOut({ id: 'r', inPoint: 15, outPoint: 20 }))
      snap(store)
    })
    And('The change is undone', async () => {
      store.dispatch(undo())
      await Promise.resolve()
    })
    Then('the regions start is 10', () => {
      expect(store.getState().region.regions[0].inPoint).toBe(10)
    })
  })

  // @behavior region-editing::9c0aa13b
  Scenario('A regions end bounds can be undone', ({ Given, When, And, Then }) => {
    const store = makeStore()

    Given('A region with start 10 and end 20', () => {
      store.dispatch(addRegion(makeRegion('r', 10, 20)))
      snap(store)
    })
    When('The regions end is changed to 25', () => {
      store.dispatch(updateRegionInOut({ id: 'r', inPoint: 10, outPoint: 25 }))
      snap(store)
    })
    And('The change is undone', async () => {
      store.dispatch(undo())
      await Promise.resolve()
    })
    Then('the regions start is 10', () => {
      const r = store.getState().region.regions[0]
      expect(r.inPoint).toBe(10)
      expect(r.outPoint).toBe(20)
    })
  })

  // @behavior region-editing::40ad3af0
  Scenario('A regions start bound being changed to after end moves region', ({ Given, When, Then }) => {
    const store = makeStore()

    Given('A region with start 10 and end 20', () => {
      store.dispatch(addRegion(makeRegion('r', 10, 20)))
    })
    When('The regions start is changed to 25', () => {
      store.dispatch(updateRegionInOut({ id: 'r', inPoint: 25, outPoint: 20 }))
    })
    Then('The regions moved to (25,35) so its length is unchanged', () => {
      const r = store.getState().region.regions[0]
      expect(r.inPoint).toBe(25)
      expect(r.outPoint).toBe(35)
    })
  })

  // @behavior region-editing::eec30ad5
  Scenario('Out point set for region before beginning point creates a new region', ({ Given, When, Then }) => {
    Given('a region with start 30 and end 40', () => {})
    When('the Set Out Point Button is clicked when the playhead is at 20', () => {})
    Then('a new region is created starting at 20. The region is 10% of the viewport, minimum 5 seconds, max up to the next region,', () => {})
  })

  // @behavior region-editing::c8493472
  ScenarioOutline('A region is prevented from being too small', ({ Given, When, Then }, variables) => {
    const store = makeStore()

    Given('the current region spans from 10 to 20 seconds and min length 1', () => {
      store.dispatch(addRegion(makeRegion('r', 10, 20)))
    })
    When('the region is attempet to resize to <a> to <b>', () => {
      store.dispatch(updateRegionInOut({
        id: 'r',
        inPoint: Number(variables.a),
        outPoint: Number(variables.b),
      }))
    })
    Then('the region span is now <c> to <d> seconds', () => {
      const r = store.getState().region.regions[0]
      expect(r.inPoint).toBe(Number(variables.c))
      expect(r.outPoint).toBe(Number(variables.d))
    })
  })

  // @behavior region-editing::35ddd908
  Scenario('A regions zoom action is called when double clicked', ({ Given, When, Then }) => {
    let harness: ReturnType<typeof renderTimeline>

    Given('A region', () => {})
    When('the user double clicks the handle', () => {
      harness = renderTimeline()
      const bar = harness.container.querySelector('.clip-overlay__bar')!
      expect(bar).not.toBeNull()
      fireEvent.doubleClick(bar)
    })
    Then('The zoom action is called', () => {
      expect(harness.onClipOverlayZoom).toHaveBeenCalledWith('r1')
    })
  })

  // @behavior region-editing::7a5597d1
  Scenario('A region when zoom action is called fills up the time bar', ({ Given, When, Then }) => {
    const currentView = { start: 0, end: 120 }
    let result: ReturnType<typeof calcZoomToRegion>

    Given('A region that is not perfectly fit to the timeline', () => {
      // currentView spans 0-120, region spans 30-60, so the view does not fit
    })
    When('the user calls the zoom action into that region', () => {
      result = calcZoomToRegion(currentView, 30, 60, null)
    })
    Then('the zoom and bounds are set so the region is 100% of the timeline', () => {
      expect(result.nextView).toEqual({ start: 30, end: 60 })
      expect(result.previousView).toEqual(currentView)
    })
  })

  // @behavior region-editing::404dfafc
  Scenario('A region already zoomed when zoom action is called will zoom out', ({ Given, And, When, Then }) => {
    const savedView = { start: 0, end: 120 }
    const zoomedView = { start: 30, end: 60 }
    let result: ReturnType<typeof calcZoomToRegion>

    Given('A region had the zoom action called on', () => {
      expect(viewFitsRegion(zoomedView, 30, 60)).toBe(true)
    })
    And('zoom / pan is still centered on the region', () => {
      // zoomedView matches the region exactly
    })
    When('the user calls the zoom action again', () => {
      result = calcZoomToRegion(zoomedView, 30, 60, savedView)
    })
    Then('the zoom and bounds are set to what it was when the user called the zoom action', () => {
      expect(result.nextView).toEqual(savedView)
      expect(result.previousView).toBeNull()
    })
  })
})
