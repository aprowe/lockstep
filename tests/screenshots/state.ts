import type { Page } from '@playwright/test'

/**
 * State seed shape — kept minimal. Each field is optional; only set what
 * matters for the screenshot. Anchors are pairs of (origTime, beatTime) in
 * seconds; pass identical values for "linked" markers.
 */
export interface SeedState {
  video?: {
    duration: number
    fps?: number
    name?: string
  }
  bpm?: number
  /** [origTime, beatTime] pairs in seconds */
  anchors?: Array<[number, number]>
  regions?: Array<{
    name: string
    inPoint: number
    outPoint: number
    bpm?: number
  }>
  view?: { start: number; end: number }
  exportOpen?: boolean
  /** Force activeRegionId to this region name */
  activeRegion?: string
}

/**
 * Dispatch a sequence of Redux actions to bring the app into the requested
 * state. Runs inside the page context — needs `window.__STORE__` to be live
 * (exposed by store.ts in dev builds).
 */
export async function seed(page: Page, state: SeedState) {
  await page.waitForFunction(() => Boolean((window as unknown as { __STORE__?: unknown }).__STORE__))
  await page.evaluate((s) => {
    type Anchor = { id: number; time: number }
    type Region = {
      id: string
      name: string
      inPoint: number
      outPoint: number
      bpm: number
      minStretch: number
      maxStretch: number
      colorIndex?: number
    }
    const store = (window as unknown as {
      __STORE__: {
        dispatch: (a: { type: string; payload?: unknown }) => void
      }
    }).__STORE__

    const dispatch = store.dispatch

    if (s.video) {
      dispatch({
        type: 'video/setVideo',
        payload: {
          path: '/fake/video.mp4',
          originalName: s.video.name ?? 'sample.mp4',
          videoUrl: '',
          duration: s.video.duration,
          fps: s.video.fps ?? 30,
          fileHash: 'mock-hash',
          width: 1920,
          height: 1080,
        },
      })
      dispatch({ type: 'video/setMarkersLoaded', payload: true })
    }

    if (s.bpm !== undefined) {
      dispatch({ type: 'warp/setBpm', payload: s.bpm })
    }

    if (s.anchors) {
      const orig: Anchor[] = []
      const beat: Anchor[] = []
      const linked: number[] = []
      s.anchors.forEach(([o, b], i) => {
        const id = i + 1
        orig.push({ id, time: o })
        beat.push({ id, time: b })
        if (o === b) linked.push(id)
      })
      dispatch({
        type: 'warp/loadAnchors',
        payload: { origAnchors: orig, beatAnchors: beat, linkedBeatIds: linked },
      })
    }

    if (s.regions) {
      const regions: Region[] = s.regions.map((r, i) => ({
        id: `region-${i + 1}`,
        name: r.name,
        inPoint: r.inPoint,
        outPoint: r.outPoint,
        bpm: r.bpm ?? s.bpm ?? 120,
        minStretch: 0.5,
        maxStretch: 2.0,
        colorIndex: i,
      }))
      dispatch({ type: 'region/setRegions', payload: regions })
      const activeName = s.activeRegion
      const active = regions.find((r) => r.name === activeName) ?? regions[0]
      if (active) {
        dispatch({ type: 'region/setActiveRegionId', payload: active.id })
      }
    }

    if (s.view) {
      dispatch({ type: 'ui/setView', payload: s.view })
    }

    if (s.exportOpen) {
      dispatch({ type: 'ui/setExportOpen', payload: true })
    }
  }, state)
}
