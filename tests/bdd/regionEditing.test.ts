import { it, expect } from 'vitest'
import { addRegion, updateRegionInOut } from '../../src/store/slices/regionSlice'
import { pushSnapshot, undo } from '../../src/store/slices/historySlice'
import { behaviorTest } from '../helpers/runBehavior'
import { makeStore } from '../helpers/setup'

const makeRegion = (id: string, inPoint: number, outPoint: number) => ({
  id, name: id, inPoint, outPoint, bpm: 120, minStretch: 0.5, maxStretch: 2, addToEnd: false,
})

// region-editing::5b468a4b
// A regions start bounds can be undone

behaviorTest('region-editing::5b468a4b', () => {
  it('restores inPoint after undo', async () => {
    const store = makeStore()
    store.dispatch(addRegion(makeRegion('r', 10, 20)))
    // snapshot at index 1: "before" state with region at (10, 20)
    store.dispatch(pushSnapshot({
      origAnchors: [], beatAnchors: [], linkedBeatIds: [], beatZeroId: null,
      regions: store.getState().region.regions,
    }))

    store.dispatch(updateRegionInOut({ id: 'r', inPoint: 15, outPoint: 20 }))
    // snapshot at index 2: "after" state with region at (15, 20)
    store.dispatch(pushSnapshot({
      origAnchors: [], beatAnchors: [], linkedBeatIds: [], beatZeroId: null,
      regions: store.getState().region.regions,
    }))

    store.dispatch(undo())  // steps back to index 1 → restores region (10, 20)
    await Promise.resolve()
    expect(store.getState().region.regions[0].inPoint).toBe(10)
  })
})

// region-editing::9c0aa13b
// A regions end bounds can be undone

behaviorTest('region-editing::9c0aa13b', () => {
  it('restores outPoint after undo', async () => {
    const store = makeStore()
    store.dispatch(addRegion(makeRegion('r', 10, 20)))
    // snapshot at index 1: "before" state with region at (10, 20)
    store.dispatch(pushSnapshot({
      origAnchors: [], beatAnchors: [], linkedBeatIds: [], beatZeroId: null,
      regions: store.getState().region.regions,
    }))

    store.dispatch(updateRegionInOut({ id: 'r', inPoint: 10, outPoint: 25 }))
    // snapshot at index 2: "after" state with region at (10, 25)
    store.dispatch(pushSnapshot({
      origAnchors: [], beatAnchors: [], linkedBeatIds: [], beatZeroId: null,
      regions: store.getState().region.regions,
    }))

    store.dispatch(undo())  // steps back to index 1 → restores region (10, 20)
    await Promise.resolve()
    expect(store.getState().region.regions[0].inPoint).toBe(10)
    expect(store.getState().region.regions[0].outPoint).toBe(20)
  })
})

// region-editing::40ad3af0
// A regions start bound being changed to after end moves region

behaviorTest('region-editing::40ad3af0', () => {
  it('shifts the region forward preserving length when start crosses end', () => {
    const store = makeStore()
    store.dispatch(addRegion(makeRegion('r', 10, 20)))

    store.dispatch(updateRegionInOut({ id: 'r', inPoint: 25, outPoint: 20 }))

    const r = store.getState().region.regions[0]
    expect(r.inPoint).toBe(25)
    expect(r.outPoint).toBe(35)
  })
})

// region-editing::1fe21e07
// A regions end bound being changed to before start moves region

behaviorTest('region-editing::1fe21e07', () => {
  it('shifts the region backward preserving length when end crosses start', () => {
    const store = makeStore()
    store.dispatch(addRegion(makeRegion('r', 30, 40)))

    store.dispatch(updateRegionInOut({ id: 'r', inPoint: 30, outPoint: 20 }))

    const r = store.getState().region.regions[0]
    expect(r.inPoint).toBe(10)
    expect(r.outPoint).toBe(20)
  })
})

// region-editing::c8493472
// A region is prevented from being too small

behaviorTest('region-editing::c8493472', () => {
  const cases: [number, number, number, number][] = [
    [10,   10,   10, 11],
    [10,   10.5, 10, 11],
    [20,   20,   19, 20],
    [19.5, 20,   19, 20],
  ]

  for (const [a, b, c, d] of cases) {
    it(`resize (${a}, ${b}) → (${c}, ${d})`, () => {
      const store = makeStore()
      store.dispatch(addRegion(makeRegion('r', 10, 20)))

      store.dispatch(updateRegionInOut({ id: 'r', inPoint: a, outPoint: b }))

      const r = store.getState().region.regions[0]
      expect(r.inPoint).toBe(c)
      expect(r.outPoint).toBe(d)
    })
  }
})
