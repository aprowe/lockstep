import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect } from 'vitest'
import { calcNewRegionSpan, calcNewRegionBounds } from '../../src/utils/view'
import { addRegion, setActiveRegionId } from '../../src/store/slices/regionSlice'
import { makeStore } from '../helpers/setup'

const feature = await loadFeature('./spec/features/region-creation.feature')

const makeRegion = (id: string, inPoint: number, outPoint: number) => ({
  id, name: id, inPoint, outPoint, bpm: 120, minStretch: 0.5, maxStretch: 2, addToEnd: false,
})

describeFeature(feature, ({ ScenarioOutline, Scenario }) => {
  // @behavior region-creation::30fd066b
  ScenarioOutline(
    'New region size is the larger of 10% of view or 5 seconds',
    ({ Given, When, Then }, variables) => {
      let span = 0
      Given('the current viewport span is <viewSpan> seconds', () => {
        // variables.viewSpan drives the computation
      })
      When('a new region is created', () => {
        span = calcNewRegionSpan(Number(variables.viewSpan))
      })
      Then('the region span is <expectedSpan> seconds', () => {
        expect(span).toBeCloseTo(Number(variables.expectedSpan))
      })
    },
  )

  // @behavior region-creation::089f7025
  Scenario('New region from the timeline is is aligned on the cursor position', ({ Given, And, When, Then }) => {
    let bounds: { inPoint: number; outPoint: number } = { inPoint: 0, outPoint: 0 }
    Given('the current viewport span is 40 seconds', () => {})
    And('the video duration is 120 seconds', () => {})
    When('a new region is created at cursor position 60 seconds', () => {
      bounds = calcNewRegionBounds(60, 40, 120)
    })
    Then('the region spans from 60 to 65 seconds', () => {
      expect(bounds.inPoint).toBeCloseTo(60)
      expect(bounds.outPoint).toBeCloseTo(65)
    })
  })

  // @behavior region-creation::622d79ba
  Scenario('New region from the region list is aligned on the playhead', ({ Given, And, When, Then }) => {
    let bounds: { inPoint: number; outPoint: number } = { inPoint: 0, outPoint: 0 }
    Given('the current viewport span is 40 seconds', () => {})
    And('the video duration is 120 seconds', () => {})
    When('a new region is created at playhead position 60 seconds', () => {
      bounds = calcNewRegionBounds(60, 40, 120)
    })
    Then('the region spans from 60 to 65 seconds', () => {
      expect(bounds.inPoint).toBeCloseTo(60)
      expect(bounds.outPoint).toBeCloseTo(65)
    })
  })

  // @behavior region-creation::beaf3038
  Scenario('Region is clamped to the start of the video', ({ Given, And, When, Then }) => {
    let inPoint = 0
    Given('the current viewport span is 40 seconds', () => {})
    And('the video duration is 120 seconds', () => {})
    When('a new region is created at cursor position -0.5 seconds', () => {
      inPoint = calcNewRegionBounds(-0.5, 40, 120).inPoint
    })
    Then('the region in-point is 0', () => {
      expect(inPoint).toBe(0)
    })
  })

  // @behavior region-creation::220bf2e0
  Scenario('Region is clamped to the end of the video', ({ Given, And, When, Then }) => {
    let outPoint = 0
    Given('the current viewport span is 40 seconds', () => {})
    And('the video duration is 120 seconds', () => {})
    When('a new region is created at cursor position 119.5 seconds', () => {
      outPoint = calcNewRegionBounds(119.5, 40, 120).outPoint
    })
    Then('the region out-point is 120', () => {
      expect(outPoint).toBe(120)
    })
  })

  // @behavior region-creation::95af3b45
  Scenario('Region is selected when created', ({ Given, When, Then, And }) => {
    const store = makeStore()
    const viewBefore = store.getState().ui.view

    Given('Region A is selected', () => {
      store.dispatch(addRegion(makeRegion('a', 0, 10)))
      store.dispatch(setActiveRegionId('a'))
    })
    When('Region B is created', () => {
      store.dispatch(addRegion(makeRegion('b', 10, 20)))
    })
    Then('Region B is selected', () => {
      expect(store.getState().region.activeRegionId).toBe('b')
    })
    And('the viewport has not changed', () => {
      expect(store.getState().ui.view).toEqual(viewBefore)
    })
  })
})
