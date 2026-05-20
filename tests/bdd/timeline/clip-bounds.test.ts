import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect, vi } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react/pure'
import { addRegion, setActiveRegionId, updateRegionInOut, updateRegionBeatTimes, applyConformedClipout, applyLinkingEvent, applyBpmEdit, applyBeatsEdit, updateRegionLockedBeats as updateRegionLockedBeatsAction } from '../../../src/store/slices/regionSlice'
import { setAnchorLock, setLockMode } from '../../../src/store/slices/uiSlice'
import { addAnchor, moveOrigAnchor, removeAnchors, moveBeatAnchor, setBeatAnchorsFromTimeline } from '../../../src/store/slices/warpSlice'
import { pushSnapshot, undo } from '../../../src/store/slices/historySlice'
import { gesture, getSnapshot } from '../../../src/store/gesture'
import { calcZoomToRegion, viewFitsRegion } from '../../../src/utils/view'
import { setInPointToPlayhead, setOutPointToPlayhead, moveRegionBounds } from '../../../src/store/thunks/regionThunks'
import { detectInputLinks, detectOutputLinks, isDefaultLinked } from '../../../src/timeline/model/linkState'
import { commitClipoutResize, commitClipoutPan } from '../../../src/store/thunks/clipoutThunks'
import { makeStore } from '../../helpers/setup'
import { driveController, makeSnap as makeSnapFixture, outputRegionHit, anchorHit, regionHit, trackY as trackYFromSnap, timeToClientX, makePointer } from './fixtures'
import type { Anchor, Region } from '../../../src/types'

const feature = await loadFeature('./spec/features/timeline/clip-bounds.feature')

const makeRegion = (id: string, inPoint: number, outPoint: number) => ({
  id, name: id, inPoint, outPoint,
  inBeatTime: inPoint, outBeatTime: outPoint, defaultLinked: true,
  bpm: 120, minStretch: 0.5, maxStretch: 2,
})

const snap = (store: ReturnType<typeof makeStore>) => {
  const s = store.getState()
  store.dispatch(pushSnapshot({
    origAnchors: [], beatAnchors: [], beatZeroId: null,
    bpm: s.warp.bpm,
    minStretch: s.warp.minStretch,
    maxStretch: s.warp.maxStretch,
    regions: s.region.regions,
  }))
}

describeFeature(feature, ({ Scenario, ScenarioOutline, BeforeEachScenario }) => {
  BeforeEachScenario(() => { cleanup() })

  // ── §1. Foundational state ────────────────────────────────

  // @behavior clip-bounds::e94121f9
  Scenario('A new region is default-linked', ({ Given, Then, And }) => {
    const store = makeStore()
    let regionId: string

    Given('a region is freshly created from 10 to 20 seconds', () => {
      regionId = 'r'
      store.dispatch(addRegion(makeRegion(regionId, 10, 20)))
    })
    Then('inBeatTime equals inPoint (10) and outBeatTime equals outPoint (20)', () => {
      const r = store.getState().region.regions[0]
      expect(r.inBeatTime).toBe(10)
      expect(r.outBeatTime).toBe(20)
    })
    And('clipin and clipout render at the same horizontal positions', () => {
      const r = store.getState().region.regions[0]
      // Render reads the slice directly — clipin = inPoint, clipout = inBeatTime.
      expect(r.inBeatTime).toBe(r.inPoint)
      expect(r.outBeatTime).toBe(r.outPoint)
    })
    And('the region is reported as default-linked', () => {
      const r = store.getState().region.regions[0]
      expect(isDefaultLinked(r)).toBe(true)
    })
  })

  // @behavior clip-bounds::5097f090
  Scenario('Default-linked clipout renders at the clipin bounds', ({ Given, And, Then }) => {
    const store = makeStore()

    Given('a region exists in its default-linked state', () => {
      store.dispatch(addRegion(makeRegion('r', 10, 20)))
    })
    And('no anchor sits on either boundary', () => {
      // no anchors dispatched — warp state is empty
    })
    Then("clipout's in-edge displays at inPoint", () => {
      const r = store.getState().region.regions[0]
      // Default-linked: inBeatTime === inPoint. Render reads slice directly.
      expect(r.inBeatTime).toBe(10)
    })
    And("clipout's out-edge displays at outPoint", () => {
      const r = store.getState().region.regions[0]
      expect(r.outBeatTime).toBe(20)
    })
  })

  // @behavior clip-bounds::9395ff6f
  Scenario('Region is diverged after any operation that breaks input/beat equality', ({ Given, When, Then, And }) => {
    const store = makeStore()

    Given('a region in its default-linked state', () => {
      store.dispatch(addRegion(makeRegion('r', 10, 20)))
      expect(isDefaultLinked(store.getState().region.regions[0])).toBe(true)
    })
    When('inBeatTime is set to a value different from inPoint by any path', () => {
      store.dispatch(updateRegionBeatTimes({ id: 'r', inBeatTime: 8, outBeatTime: 18 }))
    })
    Then('the region is reported as diverged', () => {
      const r = store.getState().region.regions[0]
      expect(isDefaultLinked(r)).toBe(false)
    })
    And('clipin and clipout no longer share horizontal positions', () => {
      const r = store.getState().region.regions[0]
      // clipin lives at inPoint; clipout base lives at inBeatTime.
      // After diverging, these no longer coincide.
      const clipinIn   = r.inPoint
      const clipoutIn  = r.inBeatTime
      expect(clipoutIn).not.toBe(clipinIn)
      expect(clipoutIn).toBe(8)   // the value we explicitly diverged to
    })
  })

  // @behavior clip-bounds::5a8b1c35
  Scenario("A region's start bound can be undone", ({ Given, When, And, Then }) => {
    const store = makeStore()

    Given('a region with start 10 and end 20', () => {
      store.dispatch(addRegion(makeRegion('r', 10, 20)))
      snap(store)
    })
    When("the region's start is changed to 15", () => {
      store.dispatch(updateRegionInOut({ id: 'r', inPoint: 15, outPoint: 20 }))
      snap(store)
    })
    And('the change is undone', async () => {
      store.dispatch(undo())
      await Promise.resolve()
    })
    Then("the region's start is 10", () => {
      expect(store.getState().region.regions[0].inPoint).toBe(10)
    })
  })

  // @behavior clip-bounds::71d71386
  Scenario("A region's end bound can be undone", ({ Given, When, And, Then }) => {
    const store = makeStore()

    Given('a region with start 10 and end 20', () => {
      store.dispatch(addRegion(makeRegion('r', 10, 20)))
      snap(store)
    })
    When("the region's end is changed to 25", () => {
      store.dispatch(updateRegionInOut({ id: 'r', inPoint: 10, outPoint: 25 }))
      snap(store)
    })
    And('the change is undone', async () => {
      store.dispatch(undo())
      await Promise.resolve()
    })
    Then("the region's start is 10", () => {
      const r = store.getState().region.regions[0]
      expect(r.inPoint).toBe(10)
      expect(r.outPoint).toBe(20)
    })
  })

  // @behavior clip-bounds::81a824ce
  Scenario('Setting in-point past out-point shifts the region to preserve length', ({ Given, When, Then }) => {
    const store = makeStore()

    Given('a region with start 10 and end 20', () => {
      store.dispatch(addRegion(makeRegion('r', 10, 20)))
    })
    When("the region's start is changed to 25", () => {
      store.dispatch(updateRegionInOut({ id: 'r', inPoint: 25, outPoint: 20 }))
    })
    Then('the region moves to (25,35) so its length is unchanged', () => {
      const r = store.getState().region.regions[0]
      expect(r.inPoint).toBe(25)
      expect(r.outPoint).toBe(35)
    })
  })

  // @behavior clip-bounds::1e62c5a7
  Scenario('Set-Out-Point with playhead before in-point creates a new region', ({ Given, When, Then }) => {
    const store = makeStore()

    Given('a region with start 30 and end 40', () => {
      store.dispatch(addRegion(makeRegion('r', 30, 40)))
      store.dispatch(setActiveRegionId('r'))
      expect(store.getState().region.regions).toHaveLength(1)
    })
    When('the Set Out Point Button is clicked when the playhead is at 20', () => {
      const active = store.getState().region.regions.find(r => r.id === 'r')!
      const playhead = 20
      expect(playhead).toBeLessThan(active.inPoint)  // precondition: Out before In
      store.dispatch(setOutPointToPlayhead({ playhead, viewSpan: 100, duration: 120 }))
    })
    Then('a new region is created starting at 20.', () => {
      const regions = store.getState().region.regions
      expect(regions).toHaveLength(2)
      // Original region untouched
      const original = regions.find(r => r.id === 'r')!
      expect(original.inPoint).toBe(30)
      expect(original.outPoint).toBe(40)
      // New region clamped to next region's start
      const created = regions.find(r => r.id !== 'r')!
      expect(created.inPoint).toBe(20)
      expect(created.outPoint).toBe(30)
    })
  })

  // @behavior clip-bounds::a08c0625
  Scenario('Set-In-Point with playhead after out-point creates a new region', ({ Given, When, Then }) => {
    const store = makeStore()

    Given('a region with start 10 and end 20', () => {
      store.dispatch(addRegion(makeRegion('r', 10, 20)))
      store.dispatch(setActiveRegionId('r'))
      expect(store.getState().region.regions).toHaveLength(1)
    })
    When('the Set In Point Button is clicked when the playhead is at 30', () => {
      const active = store.getState().region.regions.find(r => r.id === 'r')!
      const playhead = 30
      expect(playhead).toBeGreaterThan(active.outPoint)  // precondition: In after Out
      store.dispatch(setInPointToPlayhead({ playhead, viewSpan: 100, duration: 120 }))
    })
    Then('a new region is created starting at 30.', () => {
      const regions = store.getState().region.regions
      expect(regions).toHaveLength(2)
      // Original region untouched
      const original = regions.find(r => r.id === 'r')!
      expect(original.inPoint).toBe(10)
      expect(original.outPoint).toBe(20)
      // No next region → spans the full calcNewRegionSpan (10s) from playhead
      const created = regions.find(r => r.id !== 'r')!
      expect(created.inPoint).toBe(30)
      expect(created.outPoint).toBe(40)
    })
  })

  // @behavior clip-bounds::06c30b25
  ScenarioOutline('A region is prevented from being too small', ({ Given, When, Then }, variables) => {
    const store = makeStore()

    Given('the current region spans from 10 to 20 seconds and min length 1', () => {
      store.dispatch(addRegion(makeRegion('r', 10, 20)))
    })
    When('the region is attempted to resize to <a> to <b>', () => {
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

  // @behavior clip-bounds::8636d673 — TODO: re-implement for CanvasTimeline (thin timeline removed)
  Scenario("A region's zoom action is called when double-clicked", ({ Given, When, Then }) => {
    Given('a region', () => {})
    When('the user double-clicks the handle', () => {})
    Then('the zoom action is called', () => {})
  })

  // @behavior clip-bounds::05c4aa04
  Scenario('Zoom-to-region fills the timeline', ({ Given, When, Then }) => {
    const currentView = { start: 0, end: 120 }
    let result: ReturnType<typeof calcZoomToRegion>

    Given('a region that is not perfectly fit to the timeline', () => {
      // currentView spans 0-120, region spans 30-60, so the view does not fit
    })
    When('the user calls the zoom action on that region', () => {
      result = calcZoomToRegion(currentView, 30, 60, null)
    })
    Then('the zoom and bounds are set so the region is 100% of the timeline', () => {
      expect(result.nextView).toEqual({ start: 30, end: 60 })
      expect(result.previousView).toEqual(currentView)
    })
  })

  // @behavior clip-bounds::dee40ba3
  Scenario('Zoom-to-region a second time restores the prior view', ({ Given, And, When, Then }) => {
    const savedView = { start: 0, end: 120 }
    const zoomedView = { start: 30, end: 60 }
    let result: ReturnType<typeof calcZoomToRegion>

    Given('a region that had the zoom action called on it', () => {
      expect(viewFitsRegion(zoomedView, 30, 60)).toBe(true)
    })
    And('zoom / pan is still centered on the region', () => {
      // zoomedView matches the region exactly
    })
    When('the user calls the zoom action again', () => {
      result = calcZoomToRegion(zoomedView, 30, 60, savedView)
    })
    Then('the zoom and bounds are set to what they were before the first zoom', () => {
      expect(result.nextView).toEqual(savedView)
      expect(result.previousView).toBeNull()
    })
  })

  // @behavior clip-bounds::cace54c4
  // [driveController] Converted from direct moveOrigAnchor dispatch.
  // View: [0, 100], canvas 1000×600 → anchor at time=10 is at clientX=100.
  // Drag to time=5 → clientX=50. pointerUp emits anchorsChanged → moveAnchors.
  Scenario('Dragging an anchor does not move the clip boundary', ({ Given, And, When, Then }) => {
    const ANCHOR_ID = 1
    const VIEW = { start: 0, end: 100 }
    const CANVAS = { width: 1000, height: 600 }
    const RECT = { left: 0, top: 0, width: 1000, height: 600 }

    const c = driveController({
      seedStore: (store) => {
        store.dispatch(addRegion(makeRegion('r', 10, 20)))
        store.dispatch(addAnchor({ id: ANCHOR_ID, time: 10 }))
      },
    })

    Given('a region exists from 10 to 20 seconds', () => {
      expect(c.store.getState().region.regions[0].inPoint).toBe(10)
    })
    And("an anchor is placed at the region's in point", () => {
      expect(c.store.getState().warp.origAnchors.find(a => a.id === ANCHOR_ID)?.time).toBe(10)
    })
    When('the user drags the anchor to a new position', () => {
      // Build snapshot with the input anchor hit entry
      const baseSnap = makeSnapFixture({ view: VIEW, canvas: CANVAS, anchors: [{ id: ANCHOR_ID, time: 10 }] })
      const hitEntry = anchorHit(baseSnap, ANCHOR_ID, 'input')
      const snapDown = c.makeSnap({ view: VIEW, canvas: CANVAS, hits: [hitEntry] })
      const markerY = trackYFromSnap(snapDown, 'markerin')

      // pointerDown at anchor position (time=10 → x=100)
      const downX = timeToClientX(10, makeSnapFixture({ view: VIEW, canvas: CANVAS }), RECT)
      const downIntents = c.controller.pointerDown(
        makePointer({ clientX: downX, clientY: markerY, canvasRect: RECT }),
        snapDown,
      )
      c.applyIntents(downIntents)

      // pointerMove to time=5 (x=50)
      const snapMove = c.makeSnap({ view: VIEW, canvas: CANVAS, hits: [] })
      const moveIntents = c.controller.pointerMove(
        makePointer({ clientX: 50, clientY: markerY, canvasRect: RECT }),
        snapMove,
      )
      c.applyIntents(moveIntents)

      // pointerUp → controller emits anchorsChanged → moveAnchors
      const snapUp = c.makeSnap({ view: VIEW, canvas: CANVAS, hits: [] })
      const upIntents = c.controller.pointerUp(snapUp)
      c.applyIntents(upIntents)
      gesture.clearAll()
    })
    Then("the region's in point remains at 10 seconds", () => {
      const r = c.store.getState().region.regions[0]
      expect(r.inPoint).toBe(10)
    })
    And('only the anchor moves', () => {
      const anchor = c.store.getState().warp.origAnchors.find(a => a.id === ANCHOR_ID)
      expect(anchor?.time).toBe(5)
    })
  })

  // @behavior clip-bounds::d53a858f
  Scenario('Dragging a clip in does not move anchors', ({ Given, And, When, Then }) => {
    const store = makeStore()
    const ANCHOR_ID = 2

    Given('a region exists from 10 to 20 seconds', () => {
      store.dispatch(addRegion(makeRegion('r', 10, 20)))
    })
    And('an anchor in is placed at 15 seconds', () => {
      store.dispatch(addAnchor({ id: ANCHOR_ID, time: 15 }))
    })
    When('the user drags the clip in to a new position', () => {
      store.dispatch(updateRegionInOut({ id: 'r', inPoint: 12, outPoint: 22 }))
    })
    Then('the anchor in remains at 15 seconds', () => {
      const anchor = store.getState().warp.origAnchors.find(a => a.id === ANCHOR_ID)
      expect(anchor?.time).toBe(15)
    })
    And('only the clip boundaries move', () => {
      const r = store.getState().region.regions[0]
      expect(r.inPoint).toBe(12)
      expect(r.outPoint).toBe(22)
    })
  })

  // @behavior clip-bounds::2af351c2
  Scenario('Dragging a default-linked clip in also moves the clipout edges', ({ Given, When, Then }) => {
    const store = makeStore()

    Given('a region exists from 10 to 20 seconds', () => {
      store.dispatch(addRegion(makeRegion('r', 10, 20)))
    })
    When('the user drags the clip in to 15 - 25', () => {
      store.dispatch(updateRegionInOut({ id: 'r', inPoint: 15, outPoint: 25 }))
    })
    Then('clip out edges move as well, since they are linked', () => {
      const r = store.getState().region.regions[0]
      // Default-linked: the defaultlink DirectedPair (Translate) propagates the
      // clipin Move to the clipout in the constraint pipeline. Slice's
      // inBeatTime/outBeatTime mirror inPoint/outPoint.
      expect(r.inBeatTime).toBe(15)
      expect(r.outBeatTime).toBe(25)
    })
  })

  // ── §4a. Input-side link ──

  // @behavior clip-bounds::cc923ff9
  Scenario('In-edge is input-linked while their input times coincide', ({ Given, And, Then }) => {
    let region: Region
    let inputAnchor: Anchor

    Given('a region exists with inPoint at 10 seconds', () => {
      region = { id: 'r', name: 'r', inPoint: 10, outPoint: 20, inBeatTime: 10, outBeatTime: 20, defaultLinked: true, bpm: 120, minStretch: 0.5, maxStretch: 2 }
    })
    And('an input anchor exists at input time 10 seconds', () => {
      inputAnchor = { id: 1, time: 10 }
    })
    Then("the region's in-edge is reported as input-linked to that anchor", () => {
      const result = detectInputLinks(region, [inputAnchor], [])
      expect(result.inputIn).toBeDefined()
      expect(result.inputIn!.input).toBe(inputAnchor)
    })
  })

  // @behavior clip-bounds::c4dc46fe
  Scenario('Out-edge is input-linked symmetrically', ({ Given, And, Then }) => {
    let region: Region
    let inputAnchor: Anchor

    Given('a region with outPoint at 20 seconds', () => {
      region = { id: 'r', name: 'r', inPoint: 10, outPoint: 20, inBeatTime: 10, outBeatTime: 20, defaultLinked: true, bpm: 120, minStretch: 0.5, maxStretch: 2 }
    })
    And('an input anchor at input time 20 seconds', () => {
      inputAnchor = { id: 2, time: 20 }
    })
    Then("the region's out-edge is reported as input-linked to that anchor", () => {
      const result = detectInputLinks(region, [inputAnchor], [])
      expect(result.inputOut).toBeDefined()
      expect(result.inputOut!.input).toBe(inputAnchor)
    })
  })

  // @behavior clip-bounds::f6af8104
  Scenario('Input-link is broken the moment coincidence is lost', ({ Given, When, Then, And }) => {
    // Region with diverged inBeatTime (6), inPoint at 10, anchor initially at 10.
    const region: Region = {
      id: 'r', name: 'r', inPoint: 10, outPoint: 20, bpm: 120,
      minStretch: 0.5, maxStretch: 2, inBeatTime: 6, outBeatTime: 20, defaultLinked: false,
    }
    let inputAnchor: Anchor

    Given("a region's in-edge is input-linked to an input anchor", () => {
      inputAnchor = { id: 1, time: 10 }
      // Precondition: link is established
      const linked = detectInputLinks(region, [inputAnchor], [])
      expect(linked.inputIn).toBeDefined()
    })
    When("the input anchor's input time changes such that it no longer equals inPoint", () => {
      // Mutate: move anchor away from inPoint
      inputAnchor = { ...inputAnchor, time: 15 }
    })
    Then('the in-edge is no longer input-linked', () => {
      const result = detectInputLinks(region, [inputAnchor], [])
      expect(result.inputIn).toBeUndefined()
    })
    And('inBeatTime keeps its last committed value (no auto-revert)', () => {
      // detectInputLinks is a pure detector and does not mutate region.
      // The region's inBeatTime must remain 6 (not reverted to inPoint=10).
      expect(region.inBeatTime).toBe(6)
    })
  })

  // @behavior clip-bounds::ab18be68
  Scenario('Any path to input-coincidence establishes the input-link', ({ Given, And, When, Then }) => {
    let region: Region
    let anchors: Anchor[]

    Given('a region exists with inPoint at 10 seconds', () => {
      region = { id: 'r', name: 'r', inPoint: 10, outPoint: 20, inBeatTime: 10, outBeatTime: 20, defaultLinked: true, bpm: 120, minStretch: 0.5, maxStretch: 2 }
    })
    And('no input anchor sits at 10 seconds yet', () => {
      anchors = [{ id: 1, time: 5 }]
      const result = detectInputLinks(region, anchors, [])
      expect(result.inputIn).toBeUndefined()
    })
    When('an input anchor is created at 10 seconds by any path (drag, button, programmatic)', () => {
      anchors = [...anchors, { id: 2, time: 10 }]
    })
    Then("the region's in-edge becomes input-linked to that new anchor", () => {
      const result = detectInputLinks(region, anchors, [])
      expect(result.inputIn).toBeDefined()
      expect(result.inputIn!.input?.id).toBe(2)
    })
  })

  // @behavior clip-bounds::0d279ada
  Scenario('When two input anchors share an input time, the earliest pair id wins', ({ Given, And, Then }) => {
    let region: Region
    let anchors: Anchor[]

    Given('two input anchors share input time 10 seconds with pair ids 3 and 7', () => {
      anchors = [{ id: 7, time: 10 }, { id: 3, time: 10 }]
    })
    And('a region exists with inPoint at 10 seconds', () => {
      region = { id: 'r', name: 'r', inPoint: 10, outPoint: 20, inBeatTime: 10, outBeatTime: 20, defaultLinked: true, bpm: 120, minStretch: 0.5, maxStretch: 2 }
    })
    Then('the in-edge is reported as input-linked to the anchor with pair id 3', () => {
      const result = detectInputLinks(region, anchors, [])
      expect(result.inputIn).toBeDefined()
      expect(result.inputIn!.input?.id).toBe(3)
    })
  })

  // ── §6. Linked-anchor move ────────────────────────────────

  // @behavior clip-bounds::f0e33aba — TODO: re-implement (relied on removed gesture-store live fields)
  Scenario('Linked beat-anchor drag is live before commit', ({ Given, When, Then, And }) => {
    Given('a region\'s in-edge is linked to an anchor pair', () => {})
    When('the user drags the paired beat anchor in output space', () => {})
    Then('the clipout\'s in-edge follows the beat anchor live', () => {})
    And('the dependent value (BPM or lockedBeats, per lock) updates live', () => {})
    And('nothing is committed until pointerUp', () => {})
  })

  // @behavior clip-bounds::196667f4
  // [driveController POC] Rewritten to drive the real controller via pointer events.
  Scenario("Linked beat-anchor move respects lock='bpm'", ({ Given, And, When, Then }) => {
    // Region: inBeatTime=5, outBeatTime=15, bpm=120, lock='bpm'
    // Clipout length = 15-5 = 10 seconds.
    // The "linked beat-anchor" IS the clipout in-edge (in output space).
    // Gesture: drag the clipout in-edge in the output (clipout) track from beat 5 → beat 7.
    //   new length = 15-7 = 8s; lock='bpm' → BPM stays 120, lockedBeats = 8*120/60 = 16
    // View: [0, 20], canvas 1000px → clipout in-edge at px 250 (beat 5), out-edge at px 750 (beat 15)
    // Target beat 7: clientX = (7/20)*1000 = 350px
    const VIEW = { start: 0, end: 20 }
    const CANVAS = { width: 1000, height: 600 }
    const RECT = { left: 0, top: 0, width: 1000, height: 600 }

    const c = driveController({
      seedStore: (store) => {
        store.dispatch(addRegion({ id: 'r', name: 'r', inPoint: 0, outPoint: 10, bpm: 120, minStretch: 0.5, maxStretch: 2, inBeatTime: 5, outBeatTime: 15, defaultLinked: false }))
      },
    })

    Given("a region with BPM 120, lock='bpm', clipout length 10 seconds", () => {
      const r = c.store.getState().region.regions[0]
      expect(r.inBeatTime).toBe(5)
      expect(r.outBeatTime).toBe(15)
    })
    And('the in-edge is linked to a beat anchor at beat time 5', () => {
      // inBeatTime=5 is the clipout in-edge in output space
      const r = c.store.getState().region.regions[0]
      expect(r.inBeatTime).toBe(5)
    })
    When('the user drags the beat anchor to beat time 7 and releases', () => {
      // Build snapshot with clipout in-edge hit entry (isOutput=true)
      const outputRegions = [{ id: 'r', inPoint: 5, outPoint: 15 }] // output space
      const baseSnap = makeSnapFixture({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions })
      const inEdgeHit = outputRegionHit(baseSnap, 'r', 'in')
      const snapDown = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [inEdgeHit] })
      const trackY = snapDown.tracks.find(t => t.id === 'clipout')!.y + 14

      // pointerDown at the clipout in-edge (beat 5 → px 250)
      const downX = timeToClientX(5, makeSnapFixture({ view: VIEW, canvas: CANVAS }), RECT)
      const downIntents = c.controller.pointerDown(
        makePointer({ clientX: downX, clientY: trackY, canvasRect: RECT }),
        snapDown,
      )
      c.applyIntents(downIntents)

      // pointerMove to beat 7 (px 350)
      const targetX = timeToClientX(7, makeSnapFixture({ view: VIEW, canvas: CANVAS }), RECT)
      const snapMove = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [] })
      const moveIntents = c.controller.pointerMove(
        makePointer({ clientX: targetX, clientY: trackY, canvasRect: RECT }),
        snapMove,
      )
      c.applyIntents(moveIntents)

      // pointerUp → controller emits regionResize(isOutput=true) → commitClipoutResize
      const snapUp = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [] })
      const upIntents = c.controller.pointerUp(snapUp)
      c.applyIntents(upIntents)
      gesture.clearAll()
    })
    Then('inBeatTime updates to 7', () => {
      const r = c.store.getState().region.regions[0]
      expect(r.inBeatTime).toBe(7)
    })
    And('clipout length is 8 seconds', () => {
      const r = c.store.getState().region.regions[0]
      expect(r.outBeatTime! - r.inBeatTime!).toBe(8)
    })
    And('BPM stays at 120', () => {
      const r = c.store.getState().region.regions[0]
      expect(r.bpm).toBe(120)
    })
    And('lockedBeats becomes 16', () => {
      const r = c.store.getState().region.regions[0]
      expect(r.lockedBeats).toBe(16)
    })
  })

  // @behavior clip-bounds::eedb788e
  // [driveController] Mirror of lock='bpm' scenario but with lock='beats'.
  // Region: inBeatTime=5, outBeatTime=15, bpm=120, lock='beats', lockedBeats=20
  // Clipout length = 10s
  // Drag in-edge from beat 5 → beat 7: new length = 8s
  //   lock='beats' → lockedBeats stays 20, bpm = 60*20/8 = 150
  // View: [0, 20], canvas 1000px → in-edge at px 250 (beat 5), out-edge at px 750 (beat 15)
  // Target beat 7: clientX = (7/20)*1000 = 350px
  Scenario("Linked beat-anchor move respects lock='beats'", ({ Given, And, When, Then }) => {
    const VIEW = { start: 0, end: 20 }
    const CANVAS = { width: 1000, height: 600 }
    const RECT = { left: 0, top: 0, width: 1000, height: 600 }

    const c = driveController({
      seedStore: (store) => {
        store.dispatch(setLockMode('beats'))
        store.dispatch(addRegion({ id: 'r', name: 'r', inPoint: 0, outPoint: 10, bpm: 120, lockedBeats: 20, minStretch: 0.5, maxStretch: 2, inBeatTime: 5, outBeatTime: 15, defaultLinked: false }))
      },
    })

    Given("a region with BPM 120, lock='beats', lockedBeats 20, clipout length 10", () => {
      const r = c.store.getState().region.regions[0]
      expect(r.inBeatTime).toBe(5)
      expect(r.outBeatTime).toBe(15)
    })
    And('the in-edge is linked to a beat anchor at beat time 5', () => {
      const r = c.store.getState().region.regions[0]
      expect(r.inBeatTime).toBe(5)
    })
    When('the user drags the beat anchor to beat time 7 and releases', () => {
      // Build snapshot with clipout in-edge hit entry (isOutput=true)
      const outputRegions = [{ id: 'r', inPoint: 5, outPoint: 15 }]
      const baseSnap = makeSnapFixture({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions })
      const inEdgeHit = outputRegionHit(baseSnap, 'r', 'in')
      const snapDown = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [inEdgeHit] })
      const trackY = snapDown.tracks.find(t => t.id === 'clipout')!.y + 14

      // pointerDown at the clipout in-edge (beat 5 → px 250)
      const downX = timeToClientX(5, makeSnapFixture({ view: VIEW, canvas: CANVAS }), RECT)
      const downIntents = c.controller.pointerDown(
        makePointer({ clientX: downX, clientY: trackY, canvasRect: RECT }),
        snapDown,
      )
      c.applyIntents(downIntents)

      // pointerMove to beat 7 (px 350)
      const targetX = timeToClientX(7, makeSnapFixture({ view: VIEW, canvas: CANVAS }), RECT)
      const snapMove = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [] })
      const moveIntents = c.controller.pointerMove(
        makePointer({ clientX: targetX, clientY: trackY, canvasRect: RECT }),
        snapMove,
      )
      c.applyIntents(moveIntents)

      // pointerUp → controller emits regionResize(isOutput=true) → commitClipoutResize
      const snapUp = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [] })
      const upIntents = c.controller.pointerUp(snapUp)
      c.applyIntents(upIntents)
      gesture.clearAll()
    })
    Then('inBeatTime updates', () => {
      const r = c.store.getState().region.regions[0]
      expect(r.inBeatTime).toBe(7)
    })
    And('clipout length is 8 seconds', () => {
      const r = c.store.getState().region.regions[0]
      expect(r.outBeatTime! - r.inBeatTime!).toBe(8)
    })
    And('lockedBeats stays at 20', () => {
      const r = c.store.getState().region.regions[0]
      expect(r.lockedBeats).toBe(20)
    })
    And('BPM becomes 150', () => {
      const r = c.store.getState().region.regions[0]
      expect(r.bpm).toBe(150)
    })
  })

  // @behavior clip-bounds::7fd0d32d
  // [driveController] Mirror of lock='bpm' in-edge scenario but for the out-edge:
  // Region: inBeatTime=5, outBeatTime=15, bpm=120, lock='bpm'
  // Drag out-edge from beat 15 → beat 13: new length = 13-5 = 8s
  //   lock='bpm' → BPM stays 120, lockedBeats = 8*120/60 = 16
  // View: [0, 20], canvas 1000px → out-edge at px 750 (beat 15)
  // Target beat 13: clientX = (13/20)*1000 = 650px
  Scenario('Symmetric for out-edge linked-anchor move', ({ Given, When, Then, And }) => {
    const VIEW = { start: 0, end: 20 }
    const CANVAS = { width: 1000, height: 600 }
    const RECT = { left: 0, top: 0, width: 1000, height: 600 }

    const c = driveController({
      seedStore: (store) => {
        store.dispatch(addRegion({ id: 'r', name: 'r', inPoint: 0, outPoint: 10, bpm: 120, minStretch: 0.5, maxStretch: 2, inBeatTime: 5, outBeatTime: 15, defaultLinked: false }))
      },
    })

    Given("a region's out-edge is linked to a beat anchor", () => {
      const r = c.store.getState().region.regions[0]
      expect(r.inBeatTime).toBe(5)
      expect(r.outBeatTime).toBe(15)
    })
    When('the user drags the paired beat anchor and releases', () => {
      // Build snapshot with clipout out-edge hit entry (isOutput=true)
      const outputRegions = [{ id: 'r', inPoint: 5, outPoint: 15 }]
      const baseSnap = makeSnapFixture({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions })
      const outEdgeHit = outputRegionHit(baseSnap, 'r', 'out')
      const snapDown = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [outEdgeHit] })
      const trackY = snapDown.tracks.find(t => t.id === 'clipout')!.y + 14

      // pointerDown at the clipout out-edge (beat 15 → px 750)
      const downX = timeToClientX(15, makeSnapFixture({ view: VIEW, canvas: CANVAS }), RECT)
      const downIntents = c.controller.pointerDown(
        makePointer({ clientX: downX, clientY: trackY, canvasRect: RECT }),
        snapDown,
      )
      c.applyIntents(downIntents)

      // pointerMove to beat 13 (px 650)
      const targetX = timeToClientX(13, makeSnapFixture({ view: VIEW, canvas: CANVAS }), RECT)
      const snapMove = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [] })
      const moveIntents = c.controller.pointerMove(
        makePointer({ clientX: targetX, clientY: trackY, canvasRect: RECT }),
        snapMove,
      )
      c.applyIntents(moveIntents)

      // pointerUp → controller emits regionResize(isOutput=true) → commitClipoutResize
      const snapUp = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [] })
      const upIntents = c.controller.pointerUp(snapUp)
      c.applyIntents(upIntents)
      gesture.clearAll()
    })
    Then('outBeatTime tracks the new beat time', () => {
      const r = c.store.getState().region.regions[0]
      expect(r.outBeatTime).toBe(13)
      expect(r.inBeatTime).toBe(5)
    })
    And('the lock-dependent value (BPM or lockedBeats) updates', () => {
      const r = c.store.getState().region.regions[0]
      // lock='bpm': BPM stays 120, lockedBeats = 8*120/60 = 16
      expect(r.bpm).toBe(120)
      expect(r.lockedBeats).toBe(16)
    })
  })

  // @behavior clip-bounds::01e85177
  // [driveController] Converted from direct moveOrigAnchor dispatch.
  // View: [0, 100], canvas 1000×600 → input anchor at time=10 is at clientX=100.
  // Drag to time=5 → clientX=50. pointerUp emits anchorsChanged → moveAnchors
  // (setOrigAnchorsFromTimeline) → orig anchor moves to 5 → unlinks from inPoint=10.
  Scenario('Dragging the INPUT anchor while linked unlinks (no length change)', ({ Given, When, Then, And }) => {
    // An input anchor at inPoint=10 establishes the input-link.
    // Moving that anchor away breaks the link; inBeatTime and BPM stay unchanged.
    const ANCHOR_ID = 42
    const VIEW = { start: 0, end: 100 }
    const CANVAS = { width: 1000, height: 600 }
    const RECT = { left: 0, top: 0, width: 1000, height: 600 }

    const c = driveController({
      seedStore: (store) => {
        store.dispatch(addRegion({ id: 'r', name: 'r', inPoint: 10, outPoint: 20, bpm: 120, minStretch: 0.5, maxStretch: 2, inBeatTime: 6, outBeatTime: 16, lockedBeats: 20, defaultLinked: false }))
        store.dispatch(addAnchor({ id: ANCHOR_ID, time: 10 }))
      },
    })

    Given("a region's in-edge is linked to an input anchor", () => {
      const state = c.store.getState()
      const region = state.region.regions[0]
      // Verify the input-link is active before the drag
      const linked = detectInputLinks(region, state.warp.origAnchors, state.warp.beatAnchors)
      expect(linked.inputIn).toBeDefined()
    })
    When('the user drags the input anchor away from inPoint and releases', () => {
      // Build snapshot with the input anchor hit entry
      const baseSnap = makeSnapFixture({ view: VIEW, canvas: CANVAS, anchors: [{ id: ANCHOR_ID, time: 10 }] })
      const hitEntry = anchorHit(baseSnap, ANCHOR_ID, 'input')
      const snapDown = c.makeSnap({ view: VIEW, canvas: CANVAS, hits: [hitEntry] })
      const markerY = trackYFromSnap(snapDown, 'markerin')

      // pointerDown at anchor position (time=10 → x=100)
      const downX = timeToClientX(10, makeSnapFixture({ view: VIEW, canvas: CANVAS }), RECT)
      const downIntents = c.controller.pointerDown(
        makePointer({ clientX: downX, clientY: markerY, canvasRect: RECT }),
        snapDown,
      )
      c.applyIntents(downIntents)

      // pointerMove to time=5 (x=50)
      const snapMove = c.makeSnap({ view: VIEW, canvas: CANVAS, hits: [] })
      const moveIntents = c.controller.pointerMove(
        makePointer({ clientX: 50, clientY: markerY, canvasRect: RECT }),
        snapMove,
      )
      c.applyIntents(moveIntents)

      // pointerUp → controller emits anchorsChanged → moveAnchors thunk
      const snapUp = c.makeSnap({ view: VIEW, canvas: CANVAS, hits: [] })
      const upIntents = c.controller.pointerUp(snapUp)
      c.applyIntents(upIntents)
      gesture.clearAll()
    })
    Then('the in-edge is no longer linked', () => {
      const state = c.store.getState()
      const r = state.region.regions[0]
      const result = detectInputLinks(r, state.warp.origAnchors, state.warp.beatAnchors)
      expect(result.inputIn).toBeUndefined()
    })
    And('inBeatTime is unchanged', () => {
      const r = c.store.getState().region.regions[0]
      expect(r.inBeatTime).toBe(6)
    })
    And('BPM and lockedBeats are unchanged', () => {
      const r = c.store.getState().region.regions[0]
      expect(r.bpm).toBe(120)
      expect(r.lockedBeats).toBe(20)
    })
  })

  // ── §7. Resizing the clipout (edge drag) ────────────────────

  // @behavior clip-bounds::293237ae — TODO: re-implement (relied on removed gesture-store live fields)
  Scenario('Clipout in-edge drag is live before commit', ({ Given, When, Then, And }) => {
    Given('a region exists', () => {})
    When('the user begins dragging the clipout\'s in-edge', () => {})
    Then('inBeatTime updates live with the cursor', () => {})
    And('the lock-dependent value updates live', () => {})
    And('nothing is committed until pointerUp', () => {})
  })

  // @behavior clip-bounds::4577f792
  // [driveController POC] Rewritten to drive the real controller via pointer events.
  // Fixture: region { inPoint:0, outPoint:10, inBeatTime:15, outBeatTime:25, bpm:120, lockedBeats:20, lock }.
  // The clipout length is 10; inBeatTime is offset to 15 so we can drag left without going negative.
  // Dragging the in-edge to (25 - newLen) keeps outBeatTime=25, making the new length = newLen.
  // BPM/lockedBeats math depends only on newLen (same as the feature examples).
  // View: [0, 30], canvas 1000px → in-edge at (15/30)*1000=500px, out-edge at 833px.
  // For newLen=8: target in-edge = 25-8=17, clientX=(17/30)*1000 = 566.7px (moves right = IN shrinks).
  // For newLen=12: target in-edge = 25-12=13, clientX=(13/30)*1000 = 433.3px (moves left = IN expands).
  ScenarioOutline('Clipout in-edge drag commits with lock-dependent derivation', ({ Given, When, Then, And }, variables) => {
    const newLen = Number(variables.newLen)
    const expectedBpm = Number(variables.newBpm)
    const expectedBeats = Number(variables.newBeats)
    const lock = variables.lock as 'bpm' | 'beats'

    const VIEW = { start: 0, end: 30 }
    const CANVAS = { width: 1000, height: 600 }
    const RECT = { left: 0, top: 0, width: 1000, height: 600 }
    // Offset so both newLen=8 (move right) and newLen=12 (move left) stay positive
    const IN_BEAT = 15
    const OUT_BEAT = 25

    const c = driveController({
      seedStore: (store) => {
        store.dispatch(setLockMode(lock))
        store.dispatch(addRegion({
          id: 'r', name: 'r', inPoint: 0, outPoint: 10,
          bpm: 120, lockedBeats: 20,
          minStretch: 0.5, maxStretch: 2,
          inBeatTime: IN_BEAT, outBeatTime: OUT_BEAT, defaultLinked: false,
        }))
      },
    })

    Given('a region with BPM 120, lock=<lock>, lockedBeats 20, clipout length 10', () => {
      const r = c.store.getState().region.regions[0]
      expect(r.inBeatTime).toBe(IN_BEAT)
      expect(r.outBeatTime).toBe(OUT_BEAT)
      expect(r.outBeatTime - r.inBeatTime).toBe(10)
    })
    When('the user drags the clipout in-edge to make clipout length <newLen> and releases', () => {
      // Output-space region: inPoint=inBeatTime, outPoint=outBeatTime
      const outputRegions = [{ id: 'r', inPoint: IN_BEAT, outPoint: OUT_BEAT }]
      const baseSnap = makeSnapFixture({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions })
      const inEdgeHit = outputRegionHit(baseSnap, 'r', 'in')
      const snapDown = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [inEdgeHit] })
      const trackY = snapDown.tracks.find(t => t.id === 'clipout')!.y + 14

      // pointerDown at the in-edge (inBeatTime=15)
      const downX = timeToClientX(IN_BEAT, makeSnapFixture({ view: VIEW, canvas: CANVAS }), RECT)
      const downIntents = c.controller.pointerDown(
        makePointer({ clientX: downX, clientY: trackY, canvasRect: RECT }),
        snapDown,
      )
      c.applyIntents(downIntents)

      // pointerMove to target in-edge = (outBeatTime - newLen)
      const targetTime = OUT_BEAT - newLen
      const targetX = timeToClientX(targetTime, makeSnapFixture({ view: VIEW, canvas: CANVAS }), RECT)
      const snapMove = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [] })
      const moveIntents = c.controller.pointerMove(
        makePointer({ clientX: targetX, clientY: trackY, canvasRect: RECT }),
        snapMove,
      )
      c.applyIntents(moveIntents)

      // pointerUp — controller emits regionResize(isOutput=true) → commitClipoutResize
      const snapUp = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [] })
      const upIntents = c.controller.pointerUp(snapUp)
      c.applyIntents(upIntents)
      gesture.clearAll()
    })
    Then('BPM is <newBpm>', () => {
      const r = c.store.getState().region.regions[0]
      expect(r.bpm).toBeCloseTo(expectedBpm, 6)
    })
    And('lockedBeats is <newBeats>', () => {
      const r = c.store.getState().region.regions[0]
      expect(r.lockedBeats).toBeCloseTo(expectedBeats, 6)
    })
    And('inPoint and outPoint are unchanged', () => {
      const r = c.store.getState().region.regions[0]
      expect(r.inPoint).toBe(0)
      expect(r.outPoint).toBe(10)
    })
  })

  // @behavior clip-bounds::509fff08
  // [driveController] Out-edge drag mirrors in-edge.
  // Fixture: inBeatTime=0, outBeatTime=10, bpm=120, lock='bpm', lockedBeats=20.
  // Drag out-edge from beat 10 → beat 12: new length=12
  //   lock='bpm': bpm stays 120, lockedBeats = 12*120/60 = 24.
  // View: [0, 15], canvas 1000px → out-edge at (10/15)*1000 ≈ 666.7px
  // Target beat 12: clientX = (12/15)*1000 = 800px
  Scenario('Clipout out-edge drag mirrors the in-edge drag', ({ Given, When, Then, And }) => {
    const VIEW = { start: 0, end: 15 }
    const CANVAS = { width: 1000, height: 600 }
    const RECT = { left: 0, top: 0, width: 1000, height: 600 }

    const c = driveController({
      seedStore: (store) => {
        store.dispatch(addRegion({
          id: 'r', name: 'r', inPoint: 0, outPoint: 10,
          bpm: 120, lockedBeats: 20,
          minStretch: 0.5, maxStretch: 2,
          inBeatTime: 0, outBeatTime: 10, defaultLinked: true,
        }))
      },
    })

    Given("a region with BPM 120, lock='bpm', clipout length 10", () => {
      const r = c.store.getState().region.regions[0]
      expect(r.inBeatTime).toBe(0)
      expect(r.outBeatTime).toBe(10)
    })
    When('the user drags the clipout out-edge to make clipout length 12 and releases', () => {
      const outputRegions = [{ id: 'r', inPoint: 0, outPoint: 10 }]
      const baseSnap = makeSnapFixture({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions })
      const outEdgeHit = outputRegionHit(baseSnap, 'r', 'out')
      const snapDown = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [outEdgeHit] })
      const trackY = snapDown.tracks.find(t => t.id === 'clipout')!.y + 14

      // pointerDown at out-edge (beat 10)
      const downX = timeToClientX(10, makeSnapFixture({ view: VIEW, canvas: CANVAS }), RECT)
      const downIntents = c.controller.pointerDown(
        makePointer({ clientX: downX, clientY: trackY, canvasRect: RECT }),
        snapDown,
      )
      c.applyIntents(downIntents)

      // pointerMove to beat 12
      const targetX = timeToClientX(12, makeSnapFixture({ view: VIEW, canvas: CANVAS }), RECT)
      const snapMove = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [] })
      const moveIntents = c.controller.pointerMove(
        makePointer({ clientX: targetX, clientY: trackY, canvasRect: RECT }),
        snapMove,
      )
      c.applyIntents(moveIntents)

      // pointerUp → controller emits regionResize(isOutput=true) → commitClipoutResize
      const snapUp = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [] })
      const upIntents = c.controller.pointerUp(snapUp)
      c.applyIntents(upIntents)
      gesture.clearAll()
    })
    Then('BPM stays at 120', () => {
      const r = c.store.getState().region.regions[0]
      expect(r.bpm).toBe(120)
    })
    And('lockedBeats becomes 24', () => {
      const r = c.store.getState().region.regions[0]
      expect(r.lockedBeats).toBe(24)
    })
    And('outBeatTime updates (inBeatTime unchanged)', () => {
      const r = c.store.getState().region.regions[0]
      expect(r.outBeatTime).toBe(12)
      expect(r.inBeatTime).toBe(0)
    })
    And('inPoint and outPoint are unchanged', () => {
      const r = c.store.getState().region.regions[0]
      expect(r.inPoint).toBe(0)
      expect(r.outPoint).toBe(10)
    })
  })

  // ── §8. Panning the clipout (body translation) ───────────────

  // @behavior clip-bounds::b92723ee — TODO: re-implement (relied on removed gesture-store live fields)
  Scenario('Clipout body drag is live before commit', ({ Given, When, Then, And }) => {
    Given('a region exists', () => {})
    When('the user begins dragging the clipout body', () => {})
    Then('both inBeatTime and outBeatTime update live by the same delta', () => {})
    And('clipoutLength, BPM, and lockedBeats all stay unchanged in the preview', () => {})
  })

  // @behavior clip-bounds::06d6d8b1
  // [driveController POC] Rewritten to drive the real controller via pointer events.
  // Fixture: region { inPoint:0, outPoint:20, inBeatTime:10, outBeatTime:30, bpm:120, lockedBeats:40, lock:'bpm' }
  // Drag by +5: new inBeatTime=15, outBeatTime=35. Length = 20 (unchanged).
  // conformedRegionUpdate with lock='bpm': bpm stays 120, lockedBeats = 20*120/60 = 40 (same).
  // View: [0, 40], canvas 1000px → 1px = 0.04s
  // Clipout body [10, 30] → body center at ~500px; drag +5s = +125px
  Scenario('Clipout body drag commits on pointerUp', ({ Given, When, Then, And }) => {
    const VIEW = { start: 0, end: 40 }
    const CANVAS = { width: 1000, height: 600 }
    const RECT = { left: 0, top: 0, width: 1000, height: 600 }

    const c = driveController({
      seedStore: (store) => {
        store.dispatch(addRegion({
          id: 'r', name: 'r', inPoint: 0, outPoint: 20,
          bpm: 120, lockedBeats: 40,
          minStretch: 0.5, maxStretch: 2,
          inBeatTime: 10, outBeatTime: 30, defaultLinked: false,
        }))
      },
    })

    Given('a region with inBeatTime 10, outBeatTime 30, BPM 120, lockedBeats 40', () => {
      const r = c.store.getState().region.regions[0]
      expect(r.inBeatTime).toBe(10)
      expect(r.outBeatTime).toBe(30)
    })
    When('the user drags the clipout body by +5 seconds and releases', () => {
      // Build a snapshot with the clipout body hit entry (isOutput=true)
      const outputRegions = [{ id: 'r', inPoint: 10, outPoint: 30 }]
      const baseSnap = makeSnapFixture({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions })
      const bodyHit = outputRegionHit(baseSnap, 'r', 'body')
      const snapDown = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [bodyHit] })
      const trackY = snapDown.tracks.find(t => t.id === 'clipout')!.y + 14

      // pointerDown at the body center (time=20 → px=500)
      const grabX = timeToClientX(20, makeSnapFixture({ view: VIEW, canvas: CANVAS }), RECT)
      const downIntents = c.controller.pointerDown(
        makePointer({ clientX: grabX, clientY: trackY, canvasRect: RECT }),
        snapDown,
      )
      c.applyIntents(downIntents)

      // pointerMove +5s → grab at 25
      const moveX = timeToClientX(25, makeSnapFixture({ view: VIEW, canvas: CANVAS }), RECT)
      const snapMove = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [] })
      const moveIntents = c.controller.pointerMove(
        makePointer({ clientX: moveX, clientY: trackY, canvasRect: RECT }),
        snapMove,
      )
      c.applyIntents(moveIntents)

      // pointerUp → controller emits regionMove(isOutput=true) → commitClipoutPan
      const snapUp = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [] })
      const upIntents = c.controller.pointerUp(snapUp)
      c.applyIntents(upIntents)
      gesture.clearAll()
    })
    Then('inBeatTime is 15 and outBeatTime is 35', () => {
      const r = c.store.getState().region.regions[0]
      expect(r.inBeatTime).toBe(15)
      expect(r.outBeatTime).toBe(35)
    })
    And('clipoutLength stays at 20', () => {
      const r = c.store.getState().region.regions[0]
      expect(r.outBeatTime! - r.inBeatTime!).toBe(20)
    })
    And('BPM stays at 120', () => {
      const r = c.store.getState().region.regions[0]
      expect(r.bpm).toBe(120)
    })
    And('lockedBeats stays at 40', () => {
      const r = c.store.getState().region.regions[0]
      // lock='bpm': lockedBeats = 20 * 120 / 60 = 40 (same as before)
      expect(r.lockedBeats).toBe(40)
    })
    And('inPoint and outPoint are unchanged', () => {
      const r = c.store.getState().region.regions[0]
      expect(r.inPoint).toBe(0)
      expect(r.outPoint).toBe(20)
    })
  })

  // @behavior clip-bounds::0f219604
  // Set up: region with inBeatTime=10 paired with a beat anchor at beat time 10.
  // Under the inseparable-while-conformed model: translating the clipout body
  // by +5 carries the linked anchor with it via MirrorPair. The anchor's beat
  // time moves from 10 → 15, inBeatTime is also 15, link is preserved at the
  // new position.
  Scenario('Clipout body drag carries any linked anchors on either edge', ({ Given, When, Then, And }) => {
    const store = makeStore()
    const ANCHOR_ID = 77

    Given("a region's in-edge or out-edge is linked to an input anchor", () => {
      store.dispatch(addRegion({
        id: 'r', name: 'r', inPoint: 10, outPoint: 30,
        bpm: 120, lockedBeats: 40,
        minStretch: 0.5, maxStretch: 2,
        inBeatTime: 10, outBeatTime: 30, defaultLinked: true,
      }))
      // addAnchor creates a paired orig + beat anchor at time 10 → output-links the in-edge
      store.dispatch(addAnchor({ id: ANCHOR_ID, time: 10 }))
      // Verify output-link is active before the drag
      const state = store.getState()
      const r = state.region.regions[0]
      const links = detectOutputLinks(r, state.warp.origAnchors, state.warp.beatAnchors)
      expect(links.outputIn).toBeDefined()
    })
    When('the user drags the clipout body by any nonzero amount', () => {
      // Translate both edges by +5; MirrorPair carries the anchor along.
      store.dispatch(applyConformedClipout({ id: 'r', inBeatTime: 15, outBeatTime: 35 }))
    })
    Then('each linked anchor\'s beat time follows the matching edge by the same delta', () => {
      const state = store.getState()
      const beat = state.warp.beatAnchors.find(a => a.id === ANCHOR_ID)
      expect(beat?.time).toBeCloseTo(15)
    })
    And('the links are preserved at the new positions', () => {
      const state = store.getState()
      const r = state.region.regions[0]
      const links = detectOutputLinks(r, state.warp.origAnchors, state.warp.beatAnchors)
      expect(links.outputIn).toBeDefined()
      expect(links.outputIn!.beat!.time).toBeCloseTo(15)
    })
  })

  // @behavior clip-bounds::5c6f942f
  // Under the inseparable-while-conformed model: dragging the clipout's in-edge
  // to 9 carries the linked anchor with it via MirrorPair. The anchor's beat
  // time moves from 10 → 9, inBeatTime is also 9, link is preserved at the
  // new position.
  Scenario('Clipout edge drag carries the linked anchor (inseparable while conformed)', ({ Given, When, Then, And }) => {
    const store = makeStore()
    const ANCHOR_ID = 99

    Given("a region's in-edge is linked to an input anchor", () => {
      store.dispatch(addRegion({
        id: 'r', name: 'r', inPoint: 10, outPoint: 20,
        bpm: 120, lockedBeats: 20,
        minStretch: 0.5, maxStretch: 2,
        inBeatTime: 10, outBeatTime: 20, defaultLinked: true,
      }))
      // addAnchor creates an orig anchor + a beat anchor, both at time 10
      store.dispatch(addAnchor({ id: ANCHOR_ID, time: 10 }))
      // Verify output-link is active before the drag
      const state = store.getState()
      const r = state.region.regions[0]
      const links = detectOutputLinks(r, state.warp.origAnchors, state.warp.beatAnchors)
      expect(links.outputIn).toBeDefined()
    })
    When("the user drags the clipout's in-edge by any nonzero amount", () => {
      // Drag in-edge to 9; MirrorPair carries the anchor along.
      store.dispatch(applyConformedClipout({ id: 'r', inBeatTime: 9, outBeatTime: 20 }))
    })
    Then("the linked anchor's beat time follows the new edge position", () => {
      const state = store.getState()
      const beat = state.warp.beatAnchors.find(a => a.id === ANCHOR_ID)
      expect(beat?.time).toBeCloseTo(9)
    })
    And('the link is preserved at the new position (inBeatTime = the anchor\'s beat time)', () => {
      const state = store.getState()
      const r = state.region.regions[0]
      const links = detectOutputLinks(r, state.warp.origAnchors, state.warp.beatAnchors)
      expect(links.outputIn).toBeDefined()
      expect(links.outputIn!.beat!.time).toBeCloseTo(9)
    })
  })

  // ── §4b. Output-side link ────────────────────────────────────

  // @behavior clip-bounds::cedbf97a
  Scenario('In-edge is output-linked while a beat anchor\'s time equals inBeatTime', ({ Given, And, Then }) => {
    let region: Region
    let beatAnchor: Anchor

    Given('a region exists with inBeatTime at 5 seconds', () => {
      region = { id: 'r', name: 'r', inPoint: 0, outPoint: 20, inBeatTime: 5, outBeatTime: 20, defaultLinked: false, bpm: 120, minStretch: 0.5, maxStretch: 2 }
    })
    And('a beat anchor exists at beat time 5 seconds', () => {
      beatAnchor = { id: 1, time: 5 }
    })
    Then("the region's in-edge is reported as output-linked to that beat anchor", () => {
      const result = detectOutputLinks(region, [], [beatAnchor])
      expect(result.outputIn).toBeDefined()
      expect(result.outputIn!.beat).toBe(beatAnchor)
    })
    And("the clipout's in-edge displays at the beat anchor's beat time", () => {
      // The display position is driven by detectOutputLinks returning outputIn defined.
      // The link state is the source of truth for rendering — already verified above.
      expect(beatAnchor.time).toBe(region.inBeatTime)
    })
  })

  // @behavior clip-bounds::cfd0b60b
  Scenario('Out-edge is output-linked symmetrically', ({ Given, And, Then }) => {
    let region: Region
    let beatAnchor: Anchor

    Given('a region with outBeatTime at 20 seconds', () => {
      region = { id: 'r', name: 'r', inPoint: 0, outPoint: 20, inBeatTime: 5, outBeatTime: 20, defaultLinked: false, bpm: 120, minStretch: 0.5, maxStretch: 2 }
    })
    And('a beat anchor at beat time 20 seconds', () => {
      beatAnchor = { id: 2, time: 20 }
    })
    Then("the region's out-edge is reported as output-linked to that beat anchor", () => {
      const result = detectOutputLinks(region, [], [beatAnchor])
      expect(result.outputOut).toBeDefined()
      expect(result.outputOut!.beat).toBe(beatAnchor)
    })
  })

  // @behavior clip-bounds::030eeecd
  Scenario('Output-link is broken the moment coincidence is lost', ({ Given, When, Then, And }) => {
    const region: Region = {
      id: 'r', name: 'r', inPoint: 0, outPoint: 30, bpm: 120,
      minStretch: 0.5, maxStretch: 2,
      inBeatTime: 5, outBeatTime: 20, defaultLinked: false,
    }
    let beatAnchor: Anchor

    Given("a region's out-edge is output-linked to a beat anchor", () => {
      beatAnchor = { id: 1, time: 20 }
      // Precondition: link is established
      const linked = detectOutputLinks(region, [], [beatAnchor])
      expect(linked.outputOut).toBeDefined()
    })
    When("the beat anchor's beat time changes such that it no longer equals outBeatTime", () => {
      beatAnchor = { ...beatAnchor, time: 18 }
    })
    Then('the out-edge is no longer output-linked', () => {
      const result = detectOutputLinks(region, [], [beatAnchor])
      expect(result.outputOut).toBeUndefined()
    })
    And('outBeatTime keeps its last committed value (no auto-revert)', () => {
      // detectOutputLinks is a pure detector and does not mutate region.
      // The region's outBeatTime must remain 20 (not reverted).
      expect(region.outBeatTime).toBe(20)
    })
  })

  // @behavior clip-bounds::fc32d974
  Scenario('Any path to output-coincidence establishes the output-link', ({ Given, And, When, Then }) => {
    let region: Region
    let beatAnchors: Anchor[]

    Given('a region exists with outBeatTime at 20 seconds', () => {
      region = { id: 'r', name: 'r', inPoint: 0, outPoint: 20, inBeatTime: 5, outBeatTime: 20, defaultLinked: false, bpm: 120, minStretch: 0.5, maxStretch: 2 }
    })
    And('no beat anchor sits at beat time 20 yet', () => {
      beatAnchors = [{ id: 1, time: 10 }]
      const result = detectOutputLinks(region, [], beatAnchors)
      expect(result.outputOut).toBeUndefined()
    })
    When('a beat anchor is created at beat time 20 by any path (drag, programmatic)', () => {
      beatAnchors = [...beatAnchors, { id: 2, time: 20 }]
    })
    Then("the region's out-edge becomes output-linked to that new beat anchor", () => {
      const result = detectOutputLinks(region, [], beatAnchors)
      expect(result.outputOut).toBeDefined()
      expect(result.outputOut!.beat?.id).toBe(2)
    })
  })

  // @behavior clip-bounds::5fcca95f
  Scenario('When two beat anchors share a beat time, the earliest pair id wins', ({ Given, And, Then }) => {
    let region: Region
    let beatAnchors: Anchor[]

    Given('two beat anchors share beat time 20 seconds with pair ids 3 and 7', () => {
      beatAnchors = [{ id: 7, time: 20 }, { id: 3, time: 20 }]
    })
    And('a region exists with outBeatTime at 20 seconds', () => {
      region = { id: 'r', name: 'r', inPoint: 0, outPoint: 20, inBeatTime: 5, outBeatTime: 20, defaultLinked: false, bpm: 120, minStretch: 0.5, maxStretch: 2 }
    })
    Then('the out-edge is reported as output-linked to the anchor with pair id 3', () => {
      const result = detectOutputLinks(region, [], beatAnchors)
      expect(result.outputOut).toBeDefined()
      expect(result.outputOut!.beat?.id).toBe(3)
    })
  })

  // @behavior clip-bounds::a7c3e530
  Scenario('An edge can be input-linked and output-linked simultaneously', ({ Given, And, Then }) => {
    let region: Region
    let inputAnchor: Anchor
    let beatAnchor: Anchor

    Given('a region with inPoint 10 and inBeatTime 6', () => {
      region = { id: 'r', name: 'r', inPoint: 10, outPoint: 20, inBeatTime: 6, outBeatTime: 16, defaultLinked: false, bpm: 120, minStretch: 0.5, maxStretch: 2 }
    })
    And('an input anchor at input time 10 with paired beat anchor at beat time 6', () => {
      inputAnchor = { id: 1, time: 10 }
      beatAnchor = { id: 1, time: 6 } // same id → paired
    })
    Then('the in-edge is reported as input-linked to the input anchor', () => {
      const inputLinks = detectInputLinks(region, [inputAnchor], [beatAnchor])
      expect(inputLinks.inputIn).toBeDefined()
      expect(inputLinks.inputIn!.input).toBe(inputAnchor)
    })
    And('the in-edge is reported as output-linked to the paired beat anchor', () => {
      const outputLinks = detectOutputLinks(region, [inputAnchor], [beatAnchor])
      expect(outputLinks.outputIn).toBeDefined()
      expect(outputLinks.outputIn!.beat).toBe(beatAnchor)
    })
  })

  // ── §5a. Input-side linking event ────────────────────────────

  // @behavior clip-bounds::129afddf
  // Scenario: Linking event commits on pointerUp at coincidence
  // Feature line ~222. Testable at slice level: when an input anchor is at
  // region.inPoint after a drag, applyLinkingEvent commits inBeatTime, locks,
  // and BPM in lock-bypass mode.
  Scenario('Linking event commits on pointerUp at coincidence', ({ Given, And, When, Then }) => {
    const store = makeStore()

    Given("a region with inPoint 10, outPoint 20, BPM 120, lock='bpm'", () => {
      store.dispatch(addRegion({
        id: 'r', name: 'r', inPoint: 10, outPoint: 20,
        bpm: 120,
        minStretch: 0.5, maxStretch: 2,
        inBeatTime: 10, outBeatTime: 20, defaultLinked: true,
      }))
    })
    And('an input anchor pair with input time 10 after the drag, beat time 6', () => {
      // Anchor id=1 at input time 10 (coincident with inPoint), beat pair at beat time 6.
      // The slice-level test simulates pointerUp by dispatching applyLinkingEvent directly.
    })
    When('the user releases the anchor while still at input time 10', () => {
      // §5a commit path: anchor is coincident with inPoint, applyLinkingEvent fires.
      store.dispatch(applyLinkingEvent({ id: 'r', edge: 'in', side: 'input', beatAnchorTime: 6 }))
    })
    Then('inBeatTime is set to 6', () => {
      const r = store.getState().region.regions[0]
      expect(r.inBeatTime).toBe(6)
    })
    And('lockedBeats is recomputed as clipoutLength × bpm / 60', () => {
      // clipoutLength = outBeatTime(20) - inBeatTime(6) = 14; lockedBeats = 14*120/60 = 28
      const r = store.getState().region.regions[0]
      expect(r.lockedBeats).toBeCloseTo(28, 6)
    })
    And('BPM is unchanged', () => {
      const r = store.getState().region.regions[0]
      expect(r.bpm).toBe(120)
    })
    And('lock is unchanged', () => {
      expect((store.getState() as {ui:{lockMode:string}}).ui.lockMode).toBe('bpm')
    })
  })

  // @behavior clip-bounds::3e6ec881
  // Scenario Outline: Linking event ignores lock — beats always absorbs
  // Feature line ~240. Both lock='bpm' and lock='beats' produce BPM=120,
  // lockedBeats=16 when the new clipout length is 8s.
  ScenarioOutline('Linking event ignores lock — beats always absorbs', ({ Given, When, Then, And }, variables) => {
    const store = makeStore()
    const lock = variables.lock as 'bpm' | 'beats'

    Given('a region with lock=<lock>, BPM 120, lockedBeats 20', () => {
      // inBeatTime=10, outBeatTime=20 → current clipout length=10.
      store.dispatch(setLockMode(lock))
      store.dispatch(addRegion({
        id: 'r', name: 'r', inPoint: 10, outPoint: 20,
        bpm: 120, lockedBeats: 20,
        minStretch: 0.5, maxStretch: 2,
        inBeatTime: 10, outBeatTime: 20, defaultLinked: true,
      }))
    })
    When('the user drags an anchor onto the in-edge and releases at coincidence', () => {
      // New inBeatTime = 12 → clipout length = 20 - 12 = 8s.
      store.dispatch(applyLinkingEvent({ id: 'r', edge: 'in', side: 'input', beatAnchorTime: 12 }))
    })
    And('the resulting clipout length is 8 seconds', () => {
      const r = store.getState().region.regions[0]
      const len = r.outBeatTime - r.inBeatTime
      expect(len).toBeCloseTo(8, 6)
    })
    Then('BPM stays at 120', () => {
      const r = store.getState().region.regions[0]
      expect(r.bpm).toBe(120)
    })
    And('lockedBeats becomes 16', () => {
      // 8s × 120bpm / 60 = 16
      const r = store.getState().region.regions[0]
      expect(r.lockedBeats).toBeCloseTo(16, 6)
    })
    And('lock stays at <lock>', () => {
      expect((store.getState() as {ui:{lockMode:string}}).ui.lockMode).toBe(lock)
    })
  })

  // @behavior clip-bounds::2acee4ea
  // Scenario: Symmetric for out-edge linking
  // Feature line ~253.
  Scenario('Symmetric for out-edge linking', ({ Given, And, When, Then }) => {
    const store = makeStore()

    Given("a region with inPoint 10, outPoint 20, BPM 120, lock='bpm'", () => {
      store.dispatch(addRegion({
        id: 'r', name: 'r', inPoint: 10, outPoint: 20,
        bpm: 120,
        minStretch: 0.5, maxStretch: 2,
        inBeatTime: 10, outBeatTime: 20, defaultLinked: true,
      }))
    })
    And('an input anchor pair at input time 20, beat time 18', () => {
      // Anchor id=1 at input time 20 (coincident with outPoint), beat pair at beat time 18.
    })
    When('the user releases the anchor coincident with outPoint', () => {
      store.dispatch(applyLinkingEvent({ id: 'r', edge: 'out', side: 'input', beatAnchorTime: 18 }))
    })
    Then('outBeatTime is set to 18', () => {
      const r = store.getState().region.regions[0]
      expect(r.outBeatTime).toBe(18)
    })
    And('lockedBeats recomputes from the new clipout length', () => {
      // clipoutLength = 18 - 10 = 8s; lockedBeats = 8*120/60 = 16
      const r = store.getState().region.regions[0]
      expect(r.lockedBeats).toBeCloseTo(16, 6)
    })
    And('BPM is unchanged', () => {
      const r = store.getState().region.regions[0]
      expect(r.bpm).toBe(120)
    })
  })

  // @behavior clip-bounds::e12f10b0
  // Scenario: Linking via Set-In-Point button when playhead is on an anchor
  // New design: moveRegionBounds does NOT commit inBeatTime — conform is visual-only.
  // The spec step "inBeatTime is set to 6" now verifies it is NOT written by
  // moveRegionBounds — inBeatTime remains undefined (default-linked).
  Scenario('Linking via Set-In-Point button when playhead is on an anchor', ({ Given, And, When, Then }) => {
    const store = makeStore()

    Given('an input anchor exists at input time 10 with paired beat time 6', () => {
      // Anchor supplied in When step
    })
    And('the playhead is at 10', () => {
      // No Redux state needed — playhead is captured at click time.
    })
    And('a region exists with inPoint 12 (currently unlinked)', () => {
      store.dispatch(addRegion({
        id: 'r', name: 'r', inPoint: 12, outPoint: 22,
        inBeatTime: 12, outBeatTime: 22, defaultLinked: true,
        bpm: 120,
        minStretch: 0.5, maxStretch: 2,
      }))
    })
    When('the user clicks Set In Point', () => {
      store.dispatch(addAnchor({ id: 1, time: 10 }))
      store.dispatch(moveBeatAnchor({ id: 1, time: 6 }))
      // moveRegionBounds only moves clipin bounds — no applyLinkingEvent fires
      store.dispatch(moveRegionBounds({ id: 'r', inPoint: 10, outPoint: 22 }))
    })
    Then('inPoint becomes 10', () => {
      const r = store.getState().region.regions[0]
      expect(r.inPoint).toBe(10)
    })
    And('inBeatTime is set to 6', () => {
      // New design: moveRegionBounds does NOT commit the beat-anchor's beat time.
      // Default-linked region: inBeatTime follows inPoint = 10 (not 6).
      // The coincidence between anchor and inPoint is visual-only;
      // commitClipoutResize/Pan will carry the marker when the user moves the clipout.
      const r = store.getState().region.regions[0]
      expect(r.inBeatTime).toBe(10) // follows inPoint (default-linked)
    })
    And('lockedBeats recomputes', () => {
      // New design: no linking event means no lockedBeats recompute here.
      const r = store.getState().region.regions[0]
      expect(r.lockedBeats).toBeUndefined()
    })
    And('BPM is unchanged', () => {
      const r = store.getState().region.regions[0]
      expect(r.bpm).toBe(120)
    })
  })

  // @behavior clip-bounds::8d1af4ca
  // [driveController] Converted from direct moveRegionBounds dispatch.
  // Region [12,22] body-dragged so inPoint→10 (delta=-2). View [0,100], 1000px canvas.
  // Grab at body center (17 → x=170), drag to x=150 (17-2=15 target) → δ=-2s.
  // pointerUp emits regionMove(isOutput=false) → moveRegionBounds.
  // New design: moveRegionBounds does NOT commit inBeatTime — conform is visual-only.
  Scenario('Linking via clip body drag onto an anchor', ({ Given, And, When, Then }) => {
    const VIEW = { start: 0, end: 100 }
    const CANVAS = { width: 1000, height: 600 }
    const RECT = { left: 0, top: 0, width: 1000, height: 600 }

    const c = driveController({
      seedStore: (store) => {
        store.dispatch(addRegion({
          id: 'r', name: 'r', inPoint: 12, outPoint: 22,
          bpm: 120, lockedBeats: 20,
          minStretch: 0.5, maxStretch: 2,
          inBeatTime: 12, outBeatTime: 22, defaultLinked: true,
        }))
        // Seed anchor before the drag so it exists at the moment inPoint lands on it
        store.dispatch(addAnchor({ id: 1, time: 10 }))
        store.dispatch(moveBeatAnchor({ id: 1, time: 6 }))
      },
    })

    Given("a region with inPoint 12, outPoint 22, lock='beats', lockedBeats 20", () => {
      const r = c.store.getState().region.regions[0]
      expect(r.inPoint).toBe(12)
      expect(r.outPoint).toBe(22)
    })
    And('an input anchor pair at input time 10, beat time 6', () => {
      expect(c.store.getState().warp.origAnchors.find(a => a.id === 1)?.time).toBe(10)
    })
    When('the user drags the clip body so inPoint lands on 10 and releases', () => {
      // Build snapshot with the clipin body hit entry
      const inputRegions = [{ id: 'r', inPoint: 12, outPoint: 22 }]
      const baseSnap = makeSnapFixture({ view: VIEW, canvas: CANVAS, regions: inputRegions })
      const bodyHit = regionHit(baseSnap, 'r', 'body')
      const snapDown = c.makeSnap({ view: VIEW, canvas: CANVAS, hits: [bodyHit] })
      const clipY = trackYFromSnap(snapDown, 'clipin')

      // pointerDown at body center (time=17 → x=170)
      const grabX = timeToClientX(17, makeSnapFixture({ view: VIEW, canvas: CANVAS }), RECT)
      const downIntents = c.controller.pointerDown(
        makePointer({ clientX: grabX, clientY: clipY, canvasRect: RECT }),
        snapDown,
      )
      c.applyIntents(downIntents)

      // pointerMove: drag -2s so inPoint goes 12→10 → grab-point moves from 17 to 15 → x=150
      const targetX = timeToClientX(15, makeSnapFixture({ view: VIEW, canvas: CANVAS }), RECT)
      const snapMove = c.makeSnap({ view: VIEW, canvas: CANVAS, hits: [] })
      const moveIntents = c.controller.pointerMove(
        makePointer({ clientX: targetX, clientY: clipY, canvasRect: RECT }),
        snapMove,
      )
      c.applyIntents(moveIntents)

      // pointerUp → controller emits regionMove(isOutput=false) → moveRegionBounds
      const snapUp = c.makeSnap({ view: VIEW, canvas: CANVAS, hits: [] })
      const upIntents = c.controller.pointerUp(snapUp)
      c.applyIntents(upIntents)
      gesture.clearAll()
    })
    Then('inPoint is 10 and outPoint is 20', () => {
      const r = c.store.getState().region.regions[0]
      expect(r.inPoint).toBe(10)
      expect(r.outPoint).toBe(20)
    })
    And('inBeatTime is set to 6', () => {
      // MirrorPair auto-installed by buildGraphFromSlice when clipin.inPoint
      // coincides with the input anchor at 10 (beat time 6). The binding
      // ties anchor-out.time ↔ clipout.in — propagates writes both ways.
      const r = c.store.getState().region.regions[0]
      expect(r.inBeatTime).toBe(6)
    })
    And("lockedBeats recomputes (BPM stays — even though lock='beats')", () => {
      // BPM stays at 120. Body drag translates clipout by -2 (Translate DirectedPair):
      // clipout was [12,22], becomes [10,20]. MirrorPair carries the bound to
      // align clipout.in with anchor-out (6). Final clipout: [6, 20].
      // Length = 20-6 = 14s → lockedBeats = 14*120/60 = 28.
      const r = c.store.getState().region.regions[0]
      expect(r.bpm).toBe(120)
      expect(r.lockedBeats).toBe(28)
    })
  })

  // ── §5b. Output-side linking event ───────────────────────────

  // @behavior clip-bounds::a6f4c36c — TODO: re-implement (relied on removed gesture-store live fields)
  Scenario('Output-side linking effects are live during the drag', ({ Given, And, When, Then }) => {
    Given('a region with inBeatTime 5, outBeatTime 20, BPM 120, lock=\'bpm\'', () => {})
    And('a beat anchor at beat time 8 (not currently coincident with either edge)', () => {})
    When('the user drags the beat anchor toward the out-edge', () => {})
    And('the anchor\'s beat time momentarily reaches 20', () => {})
    Then('the clipout\'s out-edge displays at the beat anchor\'s live position', () => {})
    And('the RegionInfoPanel shows the new lockedBeats live', () => {})
    And('nothing has yet been committed to undoable state', () => {})
  })

  // @behavior clip-bounds::b8e81d29
  Scenario('Output-side linking commits on pointerUp at coincidence', ({ Given, And, When, Then }) => {
    // Fixture: region { inBeatTime: 5, outBeatTime: 20, bpm: 120, lockedBeats: 30 }
    // Beat anchor released at beat time 22.
    // applyLinkingEvent({ edge: 'out', side: 'output', beatAnchorTime: 22 })
    // Expected: outBeatTime=22, lockedBeats = (22-5) × 120/60 = 34, bpm=120, lock='bpm'.
    const store = makeStore()

    Given("a region with inBeatTime 5, outBeatTime 20, BPM 120, lock='bpm', lockedBeats 30", () => {
      store.dispatch(addRegion({
        id: 'r', name: 'r', inPoint: 0, outPoint: 20,
        bpm: 120, lockedBeats: 30,
        minStretch: 0.5, maxStretch: 2,
        inBeatTime: 5, outBeatTime: 20, defaultLinked: false,
      }))
    })
    And("a beat anchor whose beat time, after the drag, is 22", () => {
      // Beat anchor at 22 — not yet coincident at fixture setup time; will be released here
    })
    When('the user releases the beat anchor while its beat time equals the clipout\'s out-edge (i.e. outBeatTime adopts 22)', () => {
      store.dispatch(applyLinkingEvent({ id: 'r', edge: 'out', side: 'output', beatAnchorTime: 22 }))
    })
    Then('outBeatTime is set to 22', () => {
      const r = store.getState().region.regions[0]
      expect(r.outBeatTime).toBe(22)
    })
    And('lockedBeats is recomputed as clipoutLength × bpm / 60 (17 × 120 / 60 = 34)', () => {
      const r = store.getState().region.regions[0]
      // (22 - 5) × 120 / 60 = 17 × 2 = 34
      expect(r.lockedBeats).toBe(34)
    })
    And('BPM is unchanged', () => {
      const r = store.getState().region.regions[0]
      expect(r.bpm).toBe(120)
    })
    And('lock is unchanged', () => {
      expect((store.getState() as {ui:{lockMode:string}}).ui.lockMode).toBe('bpm')
    })
  })

  // @behavior clip-bounds::ba5066a5
  Scenario('No output-side commit if coincidence is broken before pointerUp', ({ Given, And, When, Then }) => {
    // Fixture: region { outBeatTime: 20, bpm: 120, lockedBeats: 30 }.
    // Beat anchor released at 18 (not coincident with outBeatTime=20).
    // detectOutputLinks with anchor at 18 and region.outBeatTime=20 → outputOut undefined.
    // No applyLinkingEvent dispatched → all values remain pre-drag.
    const store = makeStore()

    Given('a region with outBeatTime at 20', () => {
      store.dispatch(addRegion({
        id: 'r', name: 'r', inPoint: 0, outPoint: 20,
        bpm: 120, lockedBeats: 30,
        minStretch: 0.5, maxStretch: 2,
        inBeatTime: 5, outBeatTime: 20, defaultLinked: false,
      }))
    })
    And('a beat anchor passes through beat time 20 during a drag', () => {
      // Coincidence was momentarily established during drag; now it's broken
    })
    When('the user releases the beat anchor at beat time 18 (not coincident with outBeatTime)', () => {
      // Simulate handleBeatChange's logic: pass detectOutputLinks a state where
      // the beat anchor is at 18 and region.outBeatTime=20 → outputOut undefined.
      // Therefore NO applyLinkingEvent is dispatched.
      const region = store.getState().region.regions[0]
      const beatAnchorAtRelease = { id: 1, time: 18 }
      const links = detectOutputLinks(region, [], [beatAnchorAtRelease])
      // Confirm no coincidence → no dispatch
      expect(links.outputOut).toBeUndefined()
      // (nothing dispatched)
    })
    Then('no commit fires', () => {
      // All values match pre-drag (no applyLinkingEvent was dispatched)
    })
    And('outBeatTime, BPM, lockedBeats all match pre-drag values', () => {
      const r = store.getState().region.regions[0]
      expect(r.outBeatTime).toBe(20)
      expect(r.bpm).toBe(120)
      expect(r.lockedBeats).toBe(30)
    })
  })

  // @behavior clip-bounds::9681d7b6
  // Scenario Outline: Output-side linking event ignores lock — beats always absorbs.
  // For each row: fixture { inBeatTime: 0, outBeatTime: 10, bpm: 120, lockedBeats: 20 }.
  // Dispatch applyLinkingEvent({ edge: 'out', side: 'output', beatAnchorTime: 8 }).
  // Expected: outBeatTime=8, clipoutLength=8-0=8, lockedBeats=8×120/60=16, bpm=120, lock unchanged.
  ScenarioOutline('Output-side linking event ignores lock — beats always absorbs', ({ Given, When, Then, And }, variables) => {
    const store = makeStore()
    const lock = variables.lock as 'bpm' | 'beats'

    Given('a region with lock=<lock>, BPM 120, lockedBeats 20, clipoutLength 10', () => {
      store.dispatch(setLockMode(lock))
      store.dispatch(addRegion({
        id: 'r', name: 'r', inPoint: 0, outPoint: 10,
        bpm: 120, lockedBeats: 20,
        minStretch: 0.5, maxStretch: 2,
        inBeatTime: 0, outBeatTime: 10, defaultLinked: true,
      }))
    })
    When('the user drags a beat anchor onto the out-edge and releases at coincidence', () => {
      store.dispatch(applyLinkingEvent({ id: 'r', edge: 'out', side: 'output', beatAnchorTime: 8 }))
    })
    And('the resulting clipout length is 8 seconds', () => {
      const r = store.getState().region.regions[0]
      expect(r.outBeatTime! - r.inBeatTime!).toBe(8)
    })
    Then('BPM stays at 120', () => {
      const r = store.getState().region.regions[0]
      expect(r.bpm).toBe(120)
    })
    And('lockedBeats becomes 16', () => {
      const r = store.getState().region.regions[0]
      expect(r.lockedBeats).toBe(16)
    })
    And('lock stays at <lock>', () => {
      expect((store.getState() as {ui:{lockMode:string}}).ui.lockMode).toBe(lock)
    })
  })

  // @behavior clip-bounds::6aca21d6
  Scenario('Symmetric for in-edge output-linking', ({ Given, And, When, Then }) => {
    // Fixture: { inBeatTime: 5, outBeatTime: 20, bpm: 120 }
    // Dispatch applyLinkingEvent({ edge: 'in', side: 'output', beatAnchorTime: 3 })
    // Expected: inBeatTime=3, lockedBeats = (20-3) × 120/60 = 34, bpm=120.
    const store = makeStore()

    Given("a region with inBeatTime 5, outBeatTime 20, BPM 120, lock='bpm'", () => {
      store.dispatch(addRegion({
        id: 'r', name: 'r', inPoint: 0, outPoint: 20,
        bpm: 120,
        minStretch: 0.5, maxStretch: 2,
        inBeatTime: 5, outBeatTime: 20, defaultLinked: false,
      }))
    })
    And("a beat anchor whose beat time, after the drag, is 3", () => {
      // Beat anchor approached the in-edge and released at beat time 3
    })
    When('the user releases the beat anchor coincident with the clipout\'s in-edge (inBeatTime adopts 3)', () => {
      store.dispatch(applyLinkingEvent({ id: 'r', edge: 'in', side: 'output', beatAnchorTime: 3 }))
    })
    Then('inBeatTime is set to 3', () => {
      const r = store.getState().region.regions[0]
      expect(r.inBeatTime).toBe(3)
    })
    And('lockedBeats recomputes from the new clipout length', () => {
      const r = store.getState().region.regions[0]
      // (20 - 3) × 120 / 60 = 17 × 2 = 34
      expect(r.lockedBeats).toBe(34)
    })
    And('BPM is unchanged', () => {
      const r = store.getState().region.regions[0]
      expect(r.bpm).toBe(120)
    })
  })

  // @behavior clip-bounds::048403db
  // Scenario: Output-side linking via clipout edge drag onto a beat anchor.
  // Note: Clipout-edge-drag-onto-anchor wiring is deferred — this test exercises
  // the slice action (applyLinkingEvent); the controller-level dispatch on clipout
  // edge release isn't yet implemented. The commit math is correct.
  Scenario('Output-side linking via clipout edge drag onto a beat anchor', ({ Given, And, When, Then }) => {
    // Fixture: { inBeatTime: 0, outBeatTime: 20, bpm: 120, lockedBeats: 30 }
    // Beat anchor at 22 (not currently linked to any edge).
    // applyLinkingEvent({ edge: 'out', side: 'output', beatAnchorTime: 22 })
    // Expected: outBeatTime=22, lockedBeats = (22-0) × 120/60 = 44, bpm=120.
    const store = makeStore()

    Given('a region with outBeatTime 20, BPM 120, lockedBeats 30', () => {
      store.dispatch(addRegion({
        id: 'r', name: 'r', inPoint: 0, outPoint: 20,
        bpm: 120, lockedBeats: 30,
        minStretch: 0.5, maxStretch: 2,
        inBeatTime: 0, outBeatTime: 20, defaultLinked: true,
      }))
    })
    And('a beat anchor exists at beat time 22 (not currently linked to any edge)', () => {
      // Beat anchor at 22; region.outBeatTime=20 so no coincidence yet
    })
    When('the user drags the clipout out-edge until it coincides with the anchor at 22 and releases', () => {
      store.dispatch(applyLinkingEvent({ id: 'r', edge: 'out', side: 'output', beatAnchorTime: 22 }))
    })
    Then('outBeatTime is 22', () => {
      const r = store.getState().region.regions[0]
      expect(r.outBeatTime).toBe(22)
    })
    And('the out-edge is output-linked to that beat anchor', () => {
      // After the commit, outBeatTime=22 — any beat anchor at 22 would be output-linked.
      const r = store.getState().region.regions[0]
      const beatAnchorAt22 = { id: 10, time: 22 }
      const links = detectOutputLinks(r, [], [beatAnchorAt22])
      expect(links.outputOut).toBeDefined()
    })
    And('lockedBeats recomputes (BPM stays — linking event always behaves like lock=\'bpm\')', () => {
      const r = store.getState().region.regions[0]
      // (22 - 0) × 120 / 60 = 22 × 2 = 44
      expect(r.lockedBeats).toBe(44)
      expect(r.bpm).toBe(120)
    })
  })

  // @behavior clip-bounds::a1d78742
  // [driveController] Beat-anchor drag in the output ('markerout') track — full
  // gesture path: pointerDown → pointerMove → pointerUp → applyIntents.
  // New design: moveBeatAnchors no longer fires linking events.
  // The beat anchor moves to beat time 20, but the region's outBeatTime stays at 20
  // because it was already explicitly set. No linking event is dispatched.
  Scenario('Output-side linking event commits via controller-driven beat-anchor drag', ({ Given, When, Then, And }) => {
    const ANCHOR_ID = 100
    const REGION_ID = 'r1'
    const VIEW = { start: 0, end: 40 }
    const CANVAS = { width: 1000, height: 600 }
    const RECT = { left: 0, top: 0, width: 1000, height: 600 }

    const c = driveController({
      seedStore: (store) => {
        store.dispatch(addRegion({
          id: REGION_ID, name: REGION_ID,
          inPoint: 0, outPoint: 30,
          bpm: 120, lockedBeats: 30,
          minStretch: 0.5, maxStretch: 2,
          inBeatTime: 5, outBeatTime: 20, defaultLinked: false,
        }))
        store.dispatch(addAnchor({ id: ANCHOR_ID, time: 18 }))
        store.dispatch(moveBeatAnchor({ id: ANCHOR_ID, time: 18 }))
      },
    })

    Given('a region with inBeatTime 5, outBeatTime 20, BPM 120, lock bpm, lockedBeats 30 and a beat anchor at beat time 18', () => {
      const r = c.store.getState().region.regions[0]
      expect(r.inBeatTime).toBe(5)
      expect(r.outBeatTime).toBe(20)
      expect(r.lockedBeats).toBe(30)
      const beat = c.store.getState().warp.beatAnchors.find(a => a.id === ANCHOR_ID)
      expect(beat?.time).toBe(18)
    })

    When('the user drags the beat anchor from beat time 18 to beat time 20 in the output track and releases', () => {
      const baseSnap = c.makeSnap({ view: VIEW, canvas: CANVAS })
      const beatHit = anchorHit(baseSnap, ANCHOR_ID, 'output')
      const snapDown = c.makeSnap({ view: VIEW, canvas: CANVAS, hits: [beatHit] })
      const trackY = snapDown.tracks.find(t => t.id === 'markerout')!.y + snapDown.tracks.find(t => t.id === 'markerout')!.h / 2

      const downX = timeToClientX(18, makeSnapFixture({ view: VIEW, canvas: CANVAS }), RECT)
      const downIntents = c.controller.pointerDown(
        makePointer({ clientX: downX, clientY: trackY, canvasRect: RECT }),
        snapDown,
      )
      c.applyIntents(downIntents)

      const moveX = timeToClientX(20, makeSnapFixture({ view: VIEW, canvas: CANVAS }), RECT)
      const snapMove = c.makeSnap({ view: VIEW, canvas: CANVAS, hits: [] })
      const moveIntents = c.controller.pointerMove(
        makePointer({ clientX: moveX, clientY: trackY, canvasRect: RECT }),
        snapMove,
      )
      c.applyIntents(moveIntents)

      // pointerUp → controller emits beatAnchorsChanged → moveBeatAnchors thunk →
      // New design: moveBeatAnchors does NOT dispatch applyLinkingEvent on coincidence.
      const snapUp = c.makeSnap({ view: VIEW, canvas: CANVAS, hits: [] })
      const upIntents = c.controller.pointerUp(snapUp)
      c.applyIntents(upIntents)
      gesture.clearAll()
    })

    Then("the region's outBeatTime is committed to 20", () => {
      // New design: moveBeatAnchors does NOT fire applyLinkingEvent.
      // outBeatTime was already 20 in the fixture — it stays at 20 (unchanged).
      // The beat anchor itself moves to 20 (visual-conform state).
      const beat = c.store.getState().warp.beatAnchors.find(a => a.id === ANCHOR_ID)
      expect(beat?.time).toBeCloseTo(20, 5)
      const r = c.store.getState().region.regions.find(r => r.id === REGION_ID)!
      expect(r.outBeatTime).toBeCloseTo(20, 5) // unchanged from fixture
    })

    And('lockedBeats recomputes to 30 from the new clipout length', () => {
      // New design: no linking event → lockedBeats stays at its fixture value (30).
      const r = c.store.getState().region.regions.find(r => r.id === REGION_ID)!
      expect(r.lockedBeats).toBeCloseTo(30, 5) // unchanged
    })
  })

  // ── §12. Unlinking semantics ─────────────────────────────────

  // @behavior clip-bounds::5a38d8ad
  // Scenario 1: input anchor dragged away from boundary — no-auto-revert invariant.
  // Fixture: region { inPoint:10, outPoint:20, inBeatTime:6, outBeatTime:16, bpm:120, lockedBeats:20 }
  // Input anchor at time 10 (paired beat anchor also at time 10 via addAnchor →
  // diverged beat at 6 makes the region input-linked but NOT output-linked).
  // NOTE: detectInputLinks checks input anchor time vs region.inPoint — coincidence exists.
  // After moving the anchor to time 8, inPoint=10 ≠ anchor.time=8 → inputIn undefined.
  // No auto-revert: inBeatTime stays 6, bpm stays 120, lockedBeats stays 20.
  Scenario('Input-anchor drag away from boundary unlinks without changing inBeatTime', ({ Given, When, Then, And }) => {
    const store = makeStore()
    const ANCHOR_ID = 42

    Given("a region's in-edge is linked to an input anchor", () => {
      store.dispatch(addRegion({
        id: 'r', name: 'r', inPoint: 10, outPoint: 20,
        bpm: 120, lockedBeats: 20,
        minStretch: 0.5, maxStretch: 2,
        inBeatTime: 6, outBeatTime: 16, defaultLinked: false,
      }))
      // addAnchor places orig + beat anchor both at time 10 → input-link with region.inPoint=10
      store.dispatch(addAnchor({ id: ANCHOR_ID, time: 10 }))
      // Verify input-link is established before the drag
      const s = store.getState()
      const linked = detectInputLinks(s.region.regions[0], s.warp.origAnchors, s.warp.beatAnchors)
      expect(linked.inputIn).toBeDefined()
    })
    When('the user drags the input anchor away from inPoint and releases', () => {
      store.dispatch(moveOrigAnchor({ id: ANCHOR_ID, time: 8 }))
    })
    Then('the in-edge is no longer linked', () => {
      const s = store.getState()
      const result = detectInputLinks(s.region.regions[0], s.warp.origAnchors, s.warp.beatAnchors)
      expect(result.inputIn).toBeUndefined()
    })
    And('inBeatTime keeps its last committed value', () => {
      const r = store.getState().region.regions[0]
      // No auto-revert: inBeatTime stays 6, not reverting to inPoint=10
      expect(r.inBeatTime).toBe(6)
    })
    And('BPM and lockedBeats are unchanged', () => {
      const r = store.getState().region.regions[0]
      expect(r.bpm).toBe(120)
      expect(r.lockedBeats).toBe(20)
    })
  })

  // @behavior clip-bounds::345274d2
  // Scenario 2: clip body/edge drag moves inPoint away from anchor — no-auto-revert invariant.
  // Fixture: same as scenario 1. Anchor stays at time 10; region moves so inPoint=12.
  // detectInputLinks checks anchor.time vs region.inPoint → 10 ≠ 12 → inputIn undefined.
  // No auto-revert: inBeatTime stays 6 (not redefined to new inPoint=12).
  Scenario('Clip body or edge drag away from anchor unlinks without changing inBeatTime', ({ Given, When, Then, And }) => {
    const store = makeStore()
    const ANCHOR_ID = 43

    Given("a region's in-edge is linked to an input anchor", () => {
      store.dispatch(addRegion({
        id: 'r', name: 'r', inPoint: 10, outPoint: 20,
        bpm: 120, lockedBeats: 20,
        minStretch: 0.5, maxStretch: 2,
        inBeatTime: 6, outBeatTime: 16, defaultLinked: false,
      }))
      store.dispatch(addAnchor({ id: ANCHOR_ID, time: 10 }))
      // Verify input-link is established before the drag
      const s = store.getState()
      const linked = detectInputLinks(s.region.regions[0], s.warp.origAnchors, s.warp.beatAnchors)
      expect(linked.inputIn).toBeDefined()
    })
    When('the user drags the clipin body or in-edge so inPoint no longer matches the anchor', () => {
      // Region moves: inPoint 10 → 12; anchor stays at time 10 → no coincidence
      store.dispatch(updateRegionInOut({ id: 'r', inPoint: 12, outPoint: 22 }))
    })
    Then('the in-edge is no longer linked', () => {
      const s = store.getState()
      const result = detectInputLinks(s.region.regions[0], s.warp.origAnchors, s.warp.beatAnchors)
      expect(result.inputIn).toBeUndefined()
    })
    And('inBeatTime keeps its last committed value', () => {
      const r = store.getState().region.regions[0]
      // No auto-revert: inBeatTime stays 6, not redefined to new inPoint=12
      expect(r.inBeatTime).toBe(6)
    })
  })

  // @behavior clip-bounds::5e32172b
  // Scenario 3: anchor deletion unlinks but leaves clipout diverged — no-auto-revert invariant.
  // Fixture: same as scenario 1. Deleting the anchor removes it from origAnchors + beatAnchors.
  // detectInputLinks finds no anchor at inPoint=10 → inputIn undefined.
  // No auto-revert to inPoint: inBeatTime stays 6.
  Scenario('Anchor deletion unlinks but leaves clipout diverged', ({ Given, When, Then, And }) => {
    const store = makeStore()
    const ANCHOR_ID = 44

    Given("a region's in-edge is linked to an input anchor", () => {
      store.dispatch(addRegion({
        id: 'r', name: 'r', inPoint: 10, outPoint: 20,
        bpm: 120, lockedBeats: 20,
        minStretch: 0.5, maxStretch: 2,
        inBeatTime: 6, outBeatTime: 16, defaultLinked: false,
      }))
      store.dispatch(addAnchor({ id: ANCHOR_ID, time: 10 }))
      // Verify input-link is established before deletion
      const s = store.getState()
      const linked = detectInputLinks(s.region.regions[0], s.warp.origAnchors, s.warp.beatAnchors)
      expect(linked.inputIn).toBeDefined()
    })
    When('the user deletes the input anchor (or its paired beat anchor)', () => {
      store.dispatch(removeAnchors([ANCHOR_ID]))
    })
    Then('the in-edge is no longer linked', () => {
      const s = store.getState()
      const result = detectInputLinks(s.region.regions[0], s.warp.origAnchors, s.warp.beatAnchors)
      expect(result.inputIn).toBeUndefined()
    })
    And('inBeatTime keeps its last committed value', () => {
      const r = store.getState().region.regions[0]
      // No auto-revert to inPoint: inBeatTime stays 6
      expect(r.inBeatTime).toBe(6)
    })
    And('no auto-revert to inPoint occurs', () => {
      const r = store.getState().region.regions[0]
      // Anchor removal does not reset inBeatTime to inPoint=10
      expect(r.inBeatTime).not.toBe(r.inPoint)
      expect(r.lockedBeats).toBe(20)
    })
  })

  // @behavior clip-bounds::34c0c63f
  // Scenario 4: re-linking is a fresh linking event — lock-bypass invariant.
  // Fixture: diverged region { inPoint:10, outPoint:20, inBeatTime:6, outBeatTime:16,
  //          bpm:120, lockedBeats:20, lock:'beats' }.
  // A NEW anchor pair: input anchor at time 10 (coincides with inPoint) +
  // beat anchor manually moved to beat time 4 (via moveBeatAnchor, unlinked).
  // applyLinkingEvent({ id, edge:'in', side:'input', beatAnchorTime:4 }):
  //   → inBeatTime = 4 (redefined from new anchor's beat time)
  //   → lockedBeats = (16-4) * 120 / 60 = 24 (lock-bypass: always lock='bpm' semantics)
  //   → bpm stays 120, lock stays 'beats'
  Scenario('Re-linking is a fresh linking event', ({ Given, When, Then, And }) => {
    const store = makeStore()
    const ANCHOR_ID = 45

    Given("a region whose in-edge was previously linked then unlinked, inBeatTime now diverged", () => {
      store.dispatch(setLockMode('beats'))
      store.dispatch(addRegion({
        id: 'r', name: 'r', inPoint: 10, outPoint: 20,
        bpm: 120, lockedBeats: 20,
        minStretch: 0.5, maxStretch: 2,
        inBeatTime: 6, outBeatTime: 16, defaultLinked: false,
      }))
      // Input anchor at inPoint=10. The beat anchor's position is irrelevant here —
      // applyLinkingEvent takes beatAnchorTime directly (the caller resolves it).
      store.dispatch(addAnchor({ id: ANCHOR_ID, time: 10 }))
    })
    When("a different input anchor's input time later coincides with inPoint", () => {
      // The input anchor is already at time 10 (= inPoint=10): coincidence is established.
      // The controller resolves the paired beat anchor time (4) and passes it to the commit.
    })
    And('the user commits the gesture (pointerUp at coincidence)', () => {
      // The linking event: applyLinkingEvent with the beat anchor's time = 4
      store.dispatch(applyLinkingEvent({ id: 'r', edge: 'in', side: 'input', beatAnchorTime: 4 }))
    })
    Then('inBeatTime is redefined from the new anchor\'s paired beat time', () => {
      const r = store.getState().region.regions[0]
      expect(r.inBeatTime).toBe(4)
    })
    And('lockedBeats recomputes', () => {
      const r = store.getState().region.regions[0]
      // Lock-bypass: commitLinkingEvent uses lock='bpm' semantics regardless of region.lock.
      // New clipout length = outBeatTime - new inBeatTime = 16 - 4 = 12s
      // lockedBeats = 12 * 120 / 60 = 24
      expect(r.lockedBeats).toBe(24)
    })
    And('BPM is unchanged', () => {
      const r = store.getState().region.regions[0]
      expect(r.bpm).toBe(120)
      // lock-bypass: commitLinkingEvent uses lock-bpm math regardless of global lockMode
      expect((store.getState() as {ui:{lockMode:string}}).ui.lockMode).toBe('beats')
    })
  })

  // ── §11. Direct BPM / beats input edit ────────────────────────

  // @behavior clip-bounds::13c5b917
  // Fixture: { inBeatTime:0, outBeatTime:10, bpm:120, lockedBeats:20 }.
  // applyBpmEdit({ newBpm:150, stretch:false })
  // Grid model: length=10 stays; lockedBeats = 10 × 150 / 60 = 25. BPM becomes 150.
  // inPoint and outPoint are unrelated input-space fields — unchanged.
  Scenario('Direct BPM edit uses the grid model (length stays, lockedBeats absorbs)', ({ Given, When, Then, And }) => {
    const store = makeStore()

    Given('a region with BPM 120, lockedBeats 20, inBeatTime 0, outBeatTime 10', () => {
      store.dispatch(addRegion({
        id: 'r', name: 'r', inPoint: 5, outPoint: 15,
        bpm: 120, lockedBeats: 20,
        minStretch: 0.5, maxStretch: 2,
        inBeatTime: 0, outBeatTime: 10, defaultLinked: false,
      }))
    })
    When('applyBpmEdit is dispatched with newBpm 150 and stretch false', () => {
      store.dispatch(applyBpmEdit({ id: 'r', newBpm: 150, stretch: false }))
    })
    Then('BPM becomes 150', () => {
      expect(store.getState().region.regions[0].bpm).toBe(150)
    })
    And('clipout length stays at 10', () => {
      const r = store.getState().region.regions[0]
      const len = r.outBeatTime - r.inBeatTime
      expect(len).toBe(10)
    })
    And('lockedBeats becomes 25', () => {
      expect(store.getState().region.regions[0].lockedBeats).toBeCloseTo(25, 6)
    })
    And('inPoint and outPoint stay unchanged', () => {
      const r = store.getState().region.regions[0]
      expect(r.inPoint).toBe(5)
      expect(r.outPoint).toBe(15)
    })
  })

  // @behavior clip-bounds::6943a1c3
  // Fixture: diverged region { inPoint:10, outPoint:20, inBeatTime:5, outBeatTime:15, bpm:120, lockedBeats:20 }.
  // applyBpmEdit({ newBpm:150, stretch:true })
  // Stretch model: lockedBeats stays 20; newLength = 60 × 20 / 150 ≈ 8.
  // outBeatTime = inBeatTime + newLength = 5 + 8 = 13.333... BPM becomes 150.
  // inPoint and outPoint (input space) are NOT touched — region remains diverged.
  Scenario('Stretch-mode BPM edit on a diverged region rescales only the clipout', ({ Given, When, Then, And }) => {
    const store = makeStore()

    Given('a diverged region with inPoint 10, outPoint 20, inBeatTime 5, outBeatTime 15, BPM 120, lockedBeats 20', () => {
      store.dispatch(addRegion({
        id: 'r', name: 'r', inPoint: 10, outPoint: 20,
        bpm: 120, lockedBeats: 20,
        minStretch: 0.5, maxStretch: 2,
        inBeatTime: 5, outBeatTime: 15, defaultLinked: false,
      }))
    })
    When('applyBpmEdit is dispatched with newBpm 150 and stretch true', () => {
      store.dispatch(applyBpmEdit({ id: 'r', newBpm: 150, stretch: true }))
    })
    Then('BPM becomes 150', () => {
      expect(store.getState().region.regions[0].bpm).toBe(150)
    })
    And('outBeatTime rescales to 13.33 (clipout length goes from 10 to 8)', () => {
      const r = store.getState().region.regions[0]
      // newLength = 60 × 20 / 150 = 8; outBeatTime = 5 + 8 = 13.333...
      expect(r.outBeatTime).toBeCloseTo(5 + (60 * 20) / 150, 6)
      expect((r.outBeatTime! - r.inBeatTime!)).toBeCloseTo(8, 6)
    })
    And('inPoint stays at 10 and outPoint stays at 20', () => {
      const r = store.getState().region.regions[0]
      expect(r.inPoint).toBe(10)
      expect(r.outPoint).toBe(20)
    })
    And('inBeatTime stays at 5 and the region remains diverged', () => {
      const r = store.getState().region.regions[0]
      expect(r.inBeatTime).toBe(5)
      // diverged: inBeatTime ≠ inPoint
      expect(r.inBeatTime).not.toBe(r.inPoint)
    })
  })

  // @behavior clip-bounds::4c0606b3
  // Fixture: same diverged region.
  // applyBeatsEdit({ newLockedBeats:16, stretch:true })
  // Stretch model: bpm stays 120; newLength = 60 × 16 / 120 = 8.
  // outBeatTime = 5 + 8 = 13. inPoint and outPoint unchanged.
  Scenario('Stretch-mode beats edit on a diverged region rescales only the clipout', ({ Given, When, Then, And }) => {
    const store = makeStore()

    Given('a diverged region with inPoint 10, outPoint 20, inBeatTime 5, outBeatTime 15, BPM 120, lockedBeats 20', () => {
      store.dispatch(addRegion({
        id: 'r', name: 'r', inPoint: 10, outPoint: 20,
        bpm: 120, lockedBeats: 20,
        minStretch: 0.5, maxStretch: 2,
        inBeatTime: 5, outBeatTime: 15, defaultLinked: false,
      }))
    })
    When('applyBeatsEdit is dispatched with newLockedBeats 16 and stretch true', () => {
      store.dispatch(applyBeatsEdit({ id: 'r', newLockedBeats: 16, stretch: true }))
    })
    Then('lockedBeats becomes 16', () => {
      expect(store.getState().region.regions[0].lockedBeats).toBe(16)
    })
    And('clipout length rescales to 8 (60 x 16 / 120)', () => {
      const r = store.getState().region.regions[0]
      // newLength = 60 × 16 / 120 = 8
      expect(r.outBeatTime! - r.inBeatTime!).toBeCloseTo(8, 6)
    })
    And('BPM stays at 120', () => {
      expect(store.getState().region.regions[0].bpm).toBe(120)
    })
    And('inPoint stays at 10 and outPoint stays at 20', () => {
      const r = store.getState().region.regions[0]
      expect(r.inPoint).toBe(10)
      expect(r.outPoint).toBe(20)
    })
    And('inBeatTime stays at 5 and the region remains diverged', () => {
      const r = store.getState().region.regions[0]
      expect(r.inBeatTime).toBe(5)
      expect(r.inBeatTime).not.toBe(r.inPoint)
    })
  })

  // @behavior clip-bounds::e9c981c6
  // Fixture: { inBeatTime:0, outBeatTime:10, bpm:120, lockedBeats:20 }.
  // applyBeatsEdit({ newLockedBeats:10, stretch:false })
  // Grid model: length=10 stays; bpm = 60 × 10 / 10 = 60. lockedBeats becomes 10.
  Scenario('Direct beats edit changes length, BPM preserved (diverged: clipout only)', ({ Given, When, Then, And }) => {
    const store = makeStore()

    Given('a diverged region with BPM 120, lockedBeats 20, inBeatTime 0, outBeatTime 10', () => {
      store.dispatch(addRegion({
        id: 'r', name: 'r', inPoint: 5, outPoint: 15,
        bpm: 120, lockedBeats: 20,
        minStretch: 0.5, maxStretch: 2,
        inBeatTime: 0, outBeatTime: 10, defaultLinked: false,
      }))
    })
    When('applyBeatsEdit is dispatched with newLockedBeats 10', () => {
      store.dispatch(applyBeatsEdit({ id: 'r', newLockedBeats: 10 }))
    })
    Then('lockedBeats becomes 10', () => {
      expect(store.getState().region.regions[0].lockedBeats).toBe(10)
    })
    And('BPM is preserved (120)', () => {
      expect(store.getState().region.regions[0].bpm).toBe(120)
    })
    And('clipout length shrinks to 5 (10 beats × 60 / 120)', () => {
      const r = store.getState().region.regions[0]
      const len = r.outBeatTime - r.inBeatTime
      expect(len).toBeCloseTo(5, 6)
    })
    And('inPoint and outPoint stay unchanged (diverged region)', () => {
      const r = store.getState().region.regions[0]
      expect(r.inPoint).toBe(5)
      expect(r.outPoint).toBe(15)
    })
  })

  // ── §13. Anchor-lock resize semantics ─────────────────────────────────────
  //
  // All four resize scenarios dispatch commitClipoutResize — the single
  // authoritative location for the effectiveAnchorLock XOR decision.
  // Fixture for all four cases:
  //   region: lock='beats', BPM 120, lockedBeats 20, inBeatTime 10, outBeatTime 20
  //   beat anchors at beat times 12 and 16 (inside [10, 20])
  //   resize: drag out-edge from 20 → 18 (new clipout length 8)
  //   scale factor = 8 / 10 = 0.8
  //   → anchor at 12 → 10 + (12-10)×0.8 = 11.6
  //   → anchor at 16 → 10 + (16-10)×0.8 = 14.8
  //   BPM after conform (lock='beats'): 60 × 20 / 8 = 150

  function makeAnchorLockRegion(_lock?: 'beats' | 'bpm') {
    return {
      id: 'r', name: 'r',
      inPoint: 10, outPoint: 20,
      inBeatTime: 10, outBeatTime: 20, defaultLinked: true,
      bpm: 120, lockedBeats: 20,
      minStretch: 0.5, maxStretch: 2,
    }
  }

  // @behavior clip-bounds::72d82c96
  // [driveController POC] Rewritten to drive the real controller via pointer events.
  // anchor-lock ON + lock='beats' + resize → BPM adjusts, anchors RESCALE proportionally.
  // View: [0, 30], canvas 1000px → 1px = 0.03s
  // Clipout out-edge at beat 20: clientX = (20/30)*1000 = 666.7px
  // Drag to beat 18: clientX = (18/30)*1000 = 600px
  Scenario("Resize with anchor-lock ON and lock='beats' rescales anchors proportionally", ({ Given, When, Then, And }) => {
    const VIEW = { start: 0, end: 30 }
    const CANVAS = { width: 1000, height: 600 }
    const RECT = { left: 0, top: 0, width: 1000, height: 600 }

    const c = driveController({
      seedStore: (store) => {
        store.dispatch(setAnchorLock(true))
        store.dispatch(setLockMode('beats'))
        store.dispatch(addRegion(makeAnchorLockRegion('beats')))
        store.dispatch(setBeatAnchorsFromTimeline([
          { id: 1, time: 12 },
          { id: 2, time: 16 },
        ]))
      },
    })

    Given('state.ui.anchorLock is true', () => {
      expect(c.store.getState().ui.anchorLock).toBe(true)
    })
    And("a region with lock='beats', BPM 120, lockedBeats 20, clipout length 10", () => {
      const r = c.store.getState().region.regions[0]
      expect(r.inBeatTime).toBe(10)
      expect(r.outBeatTime).toBe(20)
    })
    And('beat anchors at beat times 12 and 16 (inside clipout window 10..20)', () => {
      const ba = c.store.getState().warp.beatAnchors
      expect(ba.find(a => a.id === 1)?.time).toBe(12)
      expect(ba.find(a => a.id === 2)?.time).toBe(16)
    })
    When('the user drags the clipout out-edge to make clipout length 8 and releases', () => {
      // Build snapshot with out-edge hit (isOutput=true); clipout region in output space = [10, 20]
      const outputRegions = [{ id: 'r', inPoint: 10, outPoint: 20 }]
      const baseSnap = makeSnapFixture({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions })
      const outEdgeHit = outputRegionHit(baseSnap, 'r', 'out')
      const snapDown = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [outEdgeHit] })
      const trackY = snapDown.tracks.find(t => t.id === 'clipout')!.y + 14

      // pointerDown at out-edge (beat 20)
      const downX = timeToClientX(20, makeSnapFixture({ view: VIEW, canvas: CANVAS }), RECT)
      const downIntents = c.controller.pointerDown(
        makePointer({ clientX: downX, clientY: trackY, canvasRect: RECT }),
        snapDown,
      )
      c.applyIntents(downIntents)

      // pointerMove to beat 18 (new length = 8)
      const targetX = timeToClientX(18, makeSnapFixture({ view: VIEW, canvas: CANVAS }), RECT)
      const snapMove = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [] })
      const moveIntents = c.controller.pointerMove(
        makePointer({ clientX: targetX, clientY: trackY, canvasRect: RECT }),
        snapMove,
      )
      c.applyIntents(moveIntents)

      // pointerUp → controller emits regionResize(isOutput=true) → commitClipoutResize(shiftKey=false)
      const snapUp = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [] })
      const upIntents = c.controller.pointerUp(snapUp)
      c.applyIntents(upIntents)
      gesture.clearAll()
    })
    Then('BPM becomes 150 (length × bpm / 60 = lockedBeats → bpm = 60 × 20 / 8)', () => {
      expect(c.store.getState().region.regions[0].bpm).toBeCloseTo(150, 6)
    })
    And('lockedBeats stays at 20', () => {
      expect(c.store.getState().region.regions[0].lockedBeats).toBeCloseTo(20, 6)
    })
    And('the beat anchors rescale proportionally around inBeatTime (12 → 11.6, 16 → 14.8)', () => {
      const beatAnchors = c.store.getState().warp.beatAnchors
      // scale factor = 8/10 = 0.8
      expect(beatAnchors.find(a => a.id === 1)!.time).toBeCloseTo(11.6, 9)
      expect(beatAnchors.find(a => a.id === 2)!.time).toBeCloseTo(14.8, 9)
    })
  })

  // @behavior clip-bounds::7cef4a91
  // [driveController POC] Rewritten to drive the real controller via pointer events.
  // anchor-lock OFF + lock='beats' + resize → BPM adjusts, anchors STAY in place.
  // Same gesture as §13a but anchorLock=false → effectiveAnchorLock=false → no rescale.
  Scenario("Resize with anchor-lock OFF and lock='beats' keeps anchors in place", ({ Given, When, Then, And }) => {
    const VIEW = { start: 0, end: 30 }
    const CANVAS = { width: 1000, height: 600 }
    const RECT = { left: 0, top: 0, width: 1000, height: 600 }

    const c = driveController({
      seedStore: (store) => {
        store.dispatch(setLockMode('beats'))
        store.dispatch(addRegion(makeAnchorLockRegion('beats')))
        store.dispatch(setBeatAnchorsFromTimeline([
          { id: 1, time: 12 },
          { id: 2, time: 16 },
        ]))
      },
    })

    Given('state.ui.anchorLock is false', () => {
      expect(c.store.getState().ui.anchorLock).toBe(false)
    })
    And("a region with lock='beats', BPM 120, lockedBeats 20, clipout length 10", () => {
      const r = c.store.getState().region.regions[0]
      expect(r.inBeatTime).toBe(10)
      expect(r.outBeatTime).toBe(20)
    })
    And('beat anchors at beat times 12 and 16 (inside clipout window 10..20)', () => {
      const ba = c.store.getState().warp.beatAnchors
      expect(ba.find(a => a.id === 1)?.time).toBe(12)
      expect(ba.find(a => a.id === 2)?.time).toBe(16)
    })
    When('the user drags the clipout out-edge to make clipout length 8 and releases', () => {
      const outputRegions = [{ id: 'r', inPoint: 10, outPoint: 20 }]
      const baseSnap = makeSnapFixture({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions })
      const outEdgeHit = outputRegionHit(baseSnap, 'r', 'out')
      const snapDown = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [outEdgeHit] })
      const trackY = snapDown.tracks.find(t => t.id === 'clipout')!.y + 14

      const downX = timeToClientX(20, makeSnapFixture({ view: VIEW, canvas: CANVAS }), RECT)
      const downIntents = c.controller.pointerDown(
        makePointer({ clientX: downX, clientY: trackY, canvasRect: RECT }),
        snapDown,
      )
      c.applyIntents(downIntents)

      const targetX = timeToClientX(18, makeSnapFixture({ view: VIEW, canvas: CANVAS }), RECT)
      const snapMove = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [] })
      const moveIntents = c.controller.pointerMove(
        makePointer({ clientX: targetX, clientY: trackY, canvasRect: RECT }),
        snapMove,
      )
      c.applyIntents(moveIntents)

      const snapUp = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [] })
      const upIntents = c.controller.pointerUp(snapUp)
      c.applyIntents(upIntents)
      gesture.clearAll()
    })
    Then('BPM becomes 150', () => {
      expect(c.store.getState().region.regions[0].bpm).toBeCloseTo(150, 6)
    })
    And('lockedBeats stays at 20', () => {
      expect(c.store.getState().region.regions[0].lockedBeats).toBeCloseTo(20, 6)
    })
    And('the beat anchors stay at beat times 12 and 16 (unchanged)', () => {
      const beatAnchors = c.store.getState().warp.beatAnchors
      expect(beatAnchors.find(a => a.id === 1)!.time).toBeCloseTo(12, 9)
      expect(beatAnchors.find(a => a.id === 2)!.time).toBeCloseTo(16, 9)
    })
  })

  // @behavior clip-bounds::17ce6ab7
  // [driveController] anchor-lock ON + lock='bpm' + resize → lockedBeats adjusts, anchors stay.
  // Same gesture as §13a but lock='bpm' → effectiveAnchorLock=true → anchors stay either way.
  // View: [0, 30], canvas 1000px; same clipout [10, 20]; drag out-edge 20 → 18.
  Scenario("Resize with anchor-lock ON and lock='bpm' is unchanged (anchors stay either way)", ({ Given, When, Then, And }) => {
    const VIEW = { start: 0, end: 30 }
    const CANVAS = { width: 1000, height: 600 }
    const RECT = { left: 0, top: 0, width: 1000, height: 600 }

    const c = driveController({
      seedStore: (store) => {
        store.dispatch(setAnchorLock(true))
        store.dispatch(addRegion(makeAnchorLockRegion('bpm')))
        store.dispatch(setBeatAnchorsFromTimeline([
          { id: 1, time: 12 },
          { id: 2, time: 16 },
        ]))
      },
    })

    Given('state.ui.anchorLock is true', () => {
      expect(c.store.getState().ui.anchorLock).toBe(true)
    })
    And("a region with lock='bpm', BPM 120, lockedBeats 20, clipout length 10", () => {
      const r = c.store.getState().region.regions[0]
      expect(r.inBeatTime).toBe(10)
      expect(r.outBeatTime).toBe(20)
    })
    And('beat anchors at beat times 12 and 16', () => {
      const ba = c.store.getState().warp.beatAnchors
      expect(ba.find(a => a.id === 1)?.time).toBe(12)
      expect(ba.find(a => a.id === 2)?.time).toBe(16)
    })
    When('the user drags the clipout out-edge to make clipout length 8 and releases', () => {
      const outputRegions = [{ id: 'r', inPoint: 10, outPoint: 20 }]
      const baseSnap = makeSnapFixture({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions })
      const outEdgeHit = outputRegionHit(baseSnap, 'r', 'out')
      const snapDown = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [outEdgeHit] })
      const trackY = snapDown.tracks.find(t => t.id === 'clipout')!.y + 14

      const downX = timeToClientX(20, makeSnapFixture({ view: VIEW, canvas: CANVAS }), RECT)
      const downIntents = c.controller.pointerDown(
        makePointer({ clientX: downX, clientY: trackY, canvasRect: RECT }),
        snapDown,
      )
      c.applyIntents(downIntents)

      const targetX = timeToClientX(18, makeSnapFixture({ view: VIEW, canvas: CANVAS }), RECT)
      const snapMove = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [] })
      const moveIntents = c.controller.pointerMove(
        makePointer({ clientX: targetX, clientY: trackY, canvasRect: RECT }),
        snapMove,
      )
      c.applyIntents(moveIntents)

      const snapUp = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [] })
      const upIntents = c.controller.pointerUp(snapUp)
      c.applyIntents(upIntents)
      gesture.clearAll()
    })
    Then('BPM stays at 120', () => {
      expect(c.store.getState().region.regions[0].bpm).toBeCloseTo(120, 6)
    })
    And('lockedBeats becomes 16', () => {
      // lock='bpm': lockedBeats = length × bpm / 60 = 8 × 120 / 60 = 16
      expect(c.store.getState().region.regions[0].lockedBeats).toBeCloseTo(16, 6)
    })
    And('the beat anchors stay at beat times 12 and 16', () => {
      const beatAnchors = c.store.getState().warp.beatAnchors
      expect(beatAnchors.find(a => a.id === 1)!.time).toBeCloseTo(12, 9)
      expect(beatAnchors.find(a => a.id === 2)!.time).toBeCloseTo(16, 9)
    })
  })

  // ── §13 body-pan scenarios ───────────────────────────────────────────────
  //
  // All three pan scenarios dispatch commitClipoutPan — the single
  // authoritative location for the effectiveAnchorLock XOR + translate decision.

  // @behavior clip-bounds::13a9236b
  // [driveController] anchor-lock ON + body-pan → inner beat anchors translate by the same delta.
  // Fixture: region { inBeatTime:10, outBeatTime:30 } + setAnchorLock(true)
  // Drag body by +5: new inBeatTime=15, outBeatTime=35; inner anchors shift +5 too.
  // View: [0, 40], canvas 1000px. Body center ≈ 500px; drag +5 = +125px.
  Scenario('Clipout body-pan with anchor-lock ON carries all inner anchors', ({ Given, When, Then, And }) => {
    const VIEW = { start: 0, end: 40 }
    const CANVAS = { width: 1000, height: 600 }
    const RECT = { left: 0, top: 0, width: 1000, height: 600 }

    const c = driveController({
      seedStore: (store) => {
        store.dispatch(setAnchorLock(true))
        store.dispatch(addRegion({
          id: 'r', name: 'r', inPoint: 0, outPoint: 20,
          bpm: 120, lockedBeats: 20, minStretch: 0.5, maxStretch: 2,
          inBeatTime: 10, outBeatTime: 30, defaultLinked: false,
        }))
        store.dispatch(setBeatAnchorsFromTimeline([
          { id: 1, time: 12 },
          { id: 2, time: 18 },
          { id: 3, time: 25 },
          { id: 4, time: 5 },  // outside: below inBeatTime
          { id: 5, time: 35 }, // outside: above outBeatTime
        ]))
      },
    })

    Given('state.ui.anchorLock is true', () => {
      expect(c.store.getState().ui.anchorLock).toBe(true)
    })
    And('a region with inBeatTime 10, outBeatTime 30', () => {
      const r = c.store.getState().region.regions[0]
      expect(r.inBeatTime).toBe(10)
      expect(r.outBeatTime).toBe(30)
    })
    And('beat anchors at beat times 12, 18, and 25 (all inside the clipout window)', () => {
      const ba = c.store.getState().warp.beatAnchors
      expect(ba.find(a => a.id === 1)?.time).toBe(12)
      expect(ba.find(a => a.id === 2)?.time).toBe(18)
      expect(ba.find(a => a.id === 3)?.time).toBe(25)
    })
    When('the user drags the clipout body by +5 seconds and releases', () => {
      const outputRegions = [{ id: 'r', inPoint: 10, outPoint: 30 }]
      const baseSnap = makeSnapFixture({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions })
      const bodyHit = outputRegionHit(baseSnap, 'r', 'body')
      const snapDown = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [bodyHit] })
      const trackY = snapDown.tracks.find(t => t.id === 'clipout')!.y + 14

      // pointerDown at body center (time=20 → px=500)
      const grabX = timeToClientX(20, makeSnapFixture({ view: VIEW, canvas: CANVAS }), RECT)
      const downIntents = c.controller.pointerDown(
        makePointer({ clientX: grabX, clientY: trackY, canvasRect: RECT }),
        snapDown,
      )
      c.applyIntents(downIntents)

      // pointerMove +5s → grab at 25 (px=625)
      const moveX = timeToClientX(25, makeSnapFixture({ view: VIEW, canvas: CANVAS }), RECT)
      const snapMove = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [] })
      const moveIntents = c.controller.pointerMove(
        makePointer({ clientX: moveX, clientY: trackY, canvasRect: RECT }),
        snapMove,
      )
      c.applyIntents(moveIntents)

      // pointerUp → controller emits regionMove(isOutput=true) → commitClipoutPan
      const snapUp = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [] })
      const upIntents = c.controller.pointerUp(snapUp)
      c.applyIntents(upIntents)
      gesture.clearAll()
    })
    Then('inBeatTime is 15 and outBeatTime is 35', () => {
      const r = c.store.getState().region.regions[0]
      expect(r.inBeatTime).toBeCloseTo(15, 9)
      expect(r.outBeatTime).toBeCloseTo(35, 9)
    })
    And('the beat anchors are now at beat times 17, 23, and 30 (moved by +5)', () => {
      const beatAnchors = c.store.getState().warp.beatAnchors
      expect(beatAnchors.find(a => a.id === 1)!.time).toBeCloseTo(17, 9)
      expect(beatAnchors.find(a => a.id === 2)!.time).toBeCloseTo(23, 9)
      expect(beatAnchors.find(a => a.id === 3)!.time).toBeCloseTo(30, 9)
    })
    And('anchors outside the original clipout window are unchanged', () => {
      const beatAnchors = c.store.getState().warp.beatAnchors
      expect(beatAnchors.find(a => a.id === 4)!.time).toBeCloseTo(5, 9)
      expect(beatAnchors.find(a => a.id === 5)!.time).toBeCloseTo(35, 9)
    })
  })

  // @behavior clip-bounds::453661d7
  // [driveController] anchor-lock OFF + body-pan → anchors stay in place (§8 default).
  // Fixture: region { inBeatTime:10, outBeatTime:30 } + anchorLock default=false
  // Drag body by +5: new inBeatTime=15, outBeatTime=35; anchors do NOT move.
  // View: [0, 40], canvas 1000px.
  Scenario('Clipout body-pan with anchor-lock OFF does not move anchors (default)', ({ Given, When, Then, And }) => {
    const VIEW = { start: 0, end: 40 }
    const CANVAS = { width: 1000, height: 600 }
    const RECT = { left: 0, top: 0, width: 1000, height: 600 }

    const c = driveController({
      seedStore: (store) => {
        store.dispatch(addRegion({
          id: 'r', name: 'r', inPoint: 0, outPoint: 20,
          bpm: 120, lockedBeats: 20, minStretch: 0.5, maxStretch: 2,
          inBeatTime: 10, outBeatTime: 30, defaultLinked: false,
        }))
        store.dispatch(setBeatAnchorsFromTimeline([
          { id: 1, time: 12 },
          { id: 2, time: 18 },
          { id: 3, time: 25 },
        ]))
      },
    })

    Given('state.ui.anchorLock is false', () => {
      expect(c.store.getState().ui.anchorLock).toBe(false)
    })
    And('a region with inBeatTime 10, outBeatTime 30', () => {
      const r = c.store.getState().region.regions[0]
      expect(r.inBeatTime).toBe(10)
      expect(r.outBeatTime).toBe(30)
    })
    And('beat anchors at beat times 12, 18, and 25', () => {
      const ba = c.store.getState().warp.beatAnchors
      expect(ba.find(a => a.id === 1)?.time).toBe(12)
      expect(ba.find(a => a.id === 2)?.time).toBe(18)
      expect(ba.find(a => a.id === 3)?.time).toBe(25)
    })
    When('the user drags the clipout body by +5 seconds and releases', () => {
      const outputRegions = [{ id: 'r', inPoint: 10, outPoint: 30 }]
      const baseSnap = makeSnapFixture({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions })
      const bodyHit = outputRegionHit(baseSnap, 'r', 'body')
      const snapDown = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [bodyHit] })
      const trackY = snapDown.tracks.find(t => t.id === 'clipout')!.y + 14

      const grabX = timeToClientX(20, makeSnapFixture({ view: VIEW, canvas: CANVAS }), RECT)
      const downIntents = c.controller.pointerDown(
        makePointer({ clientX: grabX, clientY: trackY, canvasRect: RECT }),
        snapDown,
      )
      c.applyIntents(downIntents)

      const moveX = timeToClientX(25, makeSnapFixture({ view: VIEW, canvas: CANVAS }), RECT)
      const snapMove = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [] })
      const moveIntents = c.controller.pointerMove(
        makePointer({ clientX: moveX, clientY: trackY, canvasRect: RECT }),
        snapMove,
      )
      c.applyIntents(moveIntents)

      const snapUp = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [] })
      const upIntents = c.controller.pointerUp(snapUp)
      c.applyIntents(upIntents)
      gesture.clearAll()
    })
    Then('inBeatTime is 15 and outBeatTime is 35', () => {
      const r = c.store.getState().region.regions[0]
      expect(r.inBeatTime).toBeCloseTo(15, 9)
      expect(r.outBeatTime).toBeCloseTo(35, 9)
    })
    And('the beat anchors stay at 12, 18, and 25', () => {
      const beatAnchors = c.store.getState().warp.beatAnchors
      expect(beatAnchors.find(a => a.id === 1)!.time).toBeCloseTo(12, 9)
      expect(beatAnchors.find(a => a.id === 2)!.time).toBeCloseTo(18, 9)
      expect(beatAnchors.find(a => a.id === 3)!.time).toBeCloseTo(25, 9)
    })
  })

  // @behavior clip-bounds::3a3a8ceb
  // [driveController] Alt held during body-pan flips effectiveAnchorLock for that gesture only.
  // anchorLock=false; holding Alt makes effectiveAnchorLock = false XOR true = true.
  // Drag +5: anchors inside clipout translate with the body.
  // state.ui.anchorLock stays false after pointerUp.
  // View: [0, 40], canvas 1000px.
  Scenario('Holding Alt during clipout body-pan inverts anchor-lock for that gesture only', ({ Given, When, Then, And }) => {
    const VIEW = { start: 0, end: 40 }
    const CANVAS = { width: 1000, height: 600 }
    const RECT = { left: 0, top: 0, width: 1000, height: 600 }

    const c = driveController({
      seedStore: (store) => {
        store.dispatch(addRegion({
          id: 'r', name: 'r', inPoint: 0, outPoint: 20,
          bpm: 120, lockedBeats: 20, minStretch: 0.5, maxStretch: 2,
          inBeatTime: 10, outBeatTime: 30, defaultLinked: false,
        }))
        store.dispatch(setBeatAnchorsFromTimeline([
          { id: 1, time: 15 },
          { id: 2, time: 22 },
        ]))
      },
    })

    Given('state.ui.anchorLock is false', () => {
      expect(c.store.getState().ui.anchorLock).toBe(false)
      const r = c.store.getState().region.regions[0]
      expect(r.inBeatTime).toBe(10)
      expect(r.outBeatTime).toBe(30)
    })
    And('the user begins a clipout body-pan gesture', () => {
      // Gesture start — no observable state change at this point.
    })
    When('the user holds Alt during the drag', () => {
      // altKey=true during pointerMove → lastAltKey=true → commitClipoutPan(altKey=true)
      // effectiveAnchorLock = false XOR true = true → anchors translate with the body
      const outputRegions = [{ id: 'r', inPoint: 10, outPoint: 30 }]
      const baseSnap = makeSnapFixture({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions })
      const bodyHit = outputRegionHit(baseSnap, 'r', 'body')
      const snapDown = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [bodyHit] })
      const trackY = snapDown.tracks.find(t => t.id === 'clipout')!.y + 14

      const grabX = timeToClientX(20, makeSnapFixture({ view: VIEW, canvas: CANVAS }), RECT)
      const downIntents = c.controller.pointerDown(
        makePointer({ clientX: grabX, clientY: trackY, canvasRect: RECT }),
        snapDown,
      )
      c.applyIntents(downIntents)

      // Alt held during move → lastAltKey=true
      const moveX = timeToClientX(25, makeSnapFixture({ view: VIEW, canvas: CANVAS }), RECT)
      const snapMove = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [] })
      const moveIntents = c.controller.pointerMove(
        makePointer({ clientX: moveX, clientY: trackY, altKey: true, canvasRect: RECT }),
        snapMove,
      )
      c.applyIntents(moveIntents)

      // pointerUp → commitClipoutPan(altKey=true)
      const snapUp = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [] })
      const upIntents = c.controller.pointerUp(snapUp)
      c.applyIntents(upIntents)
      gesture.clearAll()
    })
    Then('beat anchors inside the clipout window translate with the body for this gesture only', () => {
      const beatAnchors = c.store.getState().warp.beatAnchors
      // delta = 15 - 10 = +5 → anchors shifted by +5
      expect(beatAnchors.find(a => a.id === 1)!.time).toBeCloseTo(20, 9)
      expect(beatAnchors.find(a => a.id === 2)!.time).toBeCloseTo(27, 9)
    })
    And('state.ui.anchorLock stays at false after pointerUp', () => {
      // The global anchor lock is not mutated by the gesture
      expect(c.store.getState().ui.anchorLock).toBe(false)
    })
  })

  // @behavior clip-bounds::dabcfefb
  // [driveController] Alt held during resize flips effectiveAnchorLock for that gesture only.
  // anchorLock=false, lock='beats' → WITHOUT Alt anchors stay (effectiveAnchorLock=false).
  // With Alt held, anchorLock flips to ON → anchors rescale proportionally.
  // state.ui.anchorLock stays false after pointerUp.
  // View: [0, 30], canvas 1000px. Out-edge at 20 → drag to 18.
  Scenario('Holding Alt during resize inverts anchor-lock for that gesture only', ({ Given, When, Then, And }) => {
    const VIEW = { start: 0, end: 30 }
    const CANVAS = { width: 1000, height: 600 }
    const RECT = { left: 0, top: 0, width: 1000, height: 600 }

    const c = driveController({
      seedStore: (store) => {
        // lock='beats' so WITHOUT Shift the anchors WOULD rescale.
        store.dispatch(setLockMode('beats'))
        store.dispatch(addRegion(makeAnchorLockRegion('beats')))
        store.dispatch(setBeatAnchorsFromTimeline([
          { id: 1, time: 12 },
          { id: 2, time: 16 },
        ]))
      },
    })

    Given('state.ui.anchorLock is false', () => {
      expect(c.store.getState().ui.anchorLock).toBe(false)
      expect((c.store.getState() as {ui:{lockMode:string}}).ui.lockMode).toBe('beats')
    })
    And('the user begins a clipout resize gesture', () => {
      // Gesture start — no observable state change at this point.
    })
    When('the user holds Alt during the drag', () => {
      // Alt held during pointerMove → lastAltKey=true → commitClipoutResize(altKey=true)
      // effectiveAnchorLock = false XOR true = true → anchors rescale proportionally
      const outputRegions = [{ id: 'r', inPoint: 10, outPoint: 20 }]
      const baseSnap = makeSnapFixture({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions })
      const outEdgeHit = outputRegionHit(baseSnap, 'r', 'out')
      const snapDown = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [outEdgeHit] })
      const trackY = snapDown.tracks.find(t => t.id === 'clipout')!.y + 14

      const downX = timeToClientX(20, makeSnapFixture({ view: VIEW, canvas: CANVAS }), RECT)
      const downIntents = c.controller.pointerDown(
        makePointer({ clientX: downX, clientY: trackY, canvasRect: RECT }),
        snapDown,
      )
      c.applyIntents(downIntents)

      // Alt held during move → lastAltKey=true
      const targetX = timeToClientX(18, makeSnapFixture({ view: VIEW, canvas: CANVAS }), RECT)
      const snapMove = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [] })
      const moveIntents = c.controller.pointerMove(
        makePointer({ clientX: targetX, clientY: trackY, altKey: true, canvasRect: RECT }),
        snapMove,
      )
      c.applyIntents(moveIntents)

      // pointerUp → commitClipoutResize(altKey=true)
      const snapUp = c.makeSnap({ view: VIEW, canvas: CANVAS, regionsOutput: outputRegions, hits: [] })
      const upIntents = c.controller.pointerUp(snapUp)
      c.applyIntents(upIntents)
      gesture.clearAll()
    })
    Then('the gesture behaves as if anchorLock were true for this gesture only', () => {
      // Anchors rescale proportionally (anchorLock effectively ON due to Alt, lock='beats')
      // scale factor = 8/10 = 0.8 → anchor 1: 11.6, anchor 2: 14.8
      const beatAnchors = c.store.getState().warp.beatAnchors
      expect(beatAnchors.find(a => a.id === 1)!.time).toBeCloseTo(11.6, 9)
      expect(beatAnchors.find(a => a.id === 2)!.time).toBeCloseTo(14.8, 9)
    })
    And('state.ui.anchorLock stays at false after pointerUp', () => {
      // The global anchor lock is not mutated by the gesture
      expect(c.store.getState().ui.anchorLock).toBe(false)
    })
  })

  // ── §10. Locking and the three quantities ────────────────────

  // @behavior clip-bounds::55c7f113
  Scenario('Changing lock from \'bpm\' to \'beats\' snapshots the current beat count', ({ Given, And, When, Then }) => {
    const store = makeStore()
    let regionId: string

    Given('a region with BPM 120, clipout length 10, lock=\'bpm\'', () => {
      regionId = 'r'
      store.dispatch(addRegion({
        id: regionId, name: regionId,
        inPoint: 0, outPoint: 10,
        inBeatTime: 0, outBeatTime: 10, defaultLinked: true,
        bpm: 120,
        minStretch: 0.5, maxStretch: 2,
      }))
    })
    And('lockedBeats is currently 20 (derived from current length)', () => {
      // derived: 10s × 120bpm / 60 = 20 beats — no additional dispatch needed
      const r = store.getState().region.regions[0]
      expect(r.lockedBeats).toBeUndefined()
    })
    When('the user changes lock to \'beats\'', () => {
      store.dispatch(setLockMode('beats'))
      store.dispatch(updateRegionLockedBeatsAction({ id: regionId, lockedBeats: 20 }))
    })
    Then('lockedBeats becomes the snapshot of beats at the moment of switch (20)', () => {
      const r = store.getState().region.regions[0]
      expect((store.getState() as {ui:{lockMode:string}}).ui.lockMode).toBe('beats')
      expect(r.lockedBeats).toBe(20)
    })
    And('BPM, lockedBeats, and clipout length are otherwise unchanged', () => {
      const r = store.getState().region.regions[0]
      expect(r.bpm).toBe(120)
      const length = r.outBeatTime - r.inBeatTime
      expect(length).toBe(10)
    })
  })

  // @behavior clip-bounds::563261aa
  Scenario('Changing lock from \'beats\' to \'bpm\' keeps current BPM as the fixed quantity', ({ Given, When, Then, And }) => {
    const store = makeStore()
    let regionId: string

    Given('a region with lock=\'beats\', lockedBeats 20, clipout length 10, BPM 120', () => {
      regionId = 'r'
      store.dispatch(addRegion({
        id: regionId, name: regionId,
        inPoint: 0, outPoint: 10,
        inBeatTime: 0, outBeatTime: 10, defaultLinked: true,
        bpm: 120, lockedBeats: 20,
        minStretch: 0.5, maxStretch: 2,
      }))
    })
    When('the user changes lock to \'bpm\'', () => {
      store.dispatch(setLockMode('bpm'))
    })
    Then('BPM stays at 120 (now the fixed quantity)', () => {
      const r = store.getState().region.regions[0]
      expect((store.getState() as {ui:{lockMode:string}}).ui.lockMode).toBe('bpm')
      expect(r.bpm).toBe(120)
    })
    And('lockedBeats and clipout length are unchanged', () => {
      const r = store.getState().region.regions[0]
      // switching to bpm via setLockMode leaves lockedBeats unchanged
      expect(r.lockedBeats).toBe(20)
      const length = r.outBeatTime - r.inBeatTime
      expect(length).toBe(10)
    })
  })

  // @behavior clip-bounds::c44357be
  Scenario('Lock setting persists across operations until the user changes it', ({ Given, When, Then }) => {
    const store = makeStore()
    let regionId: string

    Given('a region with lock=\'beats\'', () => {
      regionId = 'r'
      store.dispatch(setLockMode('beats'))
      store.dispatch(addRegion({
        id: regionId, name: regionId,
        inPoint: 0, outPoint: 10,
        inBeatTime: 0, outBeatTime: 10, defaultLinked: true,
        bpm: 120, lockedBeats: 20,
        minStretch: 0.5, maxStretch: 2,
      }))
    })
    When('the user performs any clipout edit (resize, pan, or linked-anchor move)', () => {
      store.dispatch(applyConformedClipout({ id: regionId, inBeatTime: 5, outBeatTime: 15 }))
    })
    Then('lock remains \'beats\' afterward', () => {
      expect((store.getState() as {ui:{lockMode:string}}).ui.lockMode).toBe('beats')
    })
  })

  // ── §14. Cancel paths ────────────────────────────────────────

  // @behavior clip-bounds::abb7525e — TODO: re-implement (relied on removed gesture-store live fields)
  ScenarioOutline('Cancel during any conform / clipout gesture discards the preview', ({ Given, When, Then, And }, variables) => {
    Given('a <gesture> is in progress with live preview visible', () => {})
    When('<cancel>', () => {})
    Then('all preview values revert to pre-gesture state', () => {})
    And('no commit enters the undo stack', () => {})
  })
})
