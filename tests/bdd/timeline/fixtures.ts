import type {
  Snapshot, PointerEventLike, WheelEventLike, KeyEventLike, Intent, LayoutTrack, HitEntry,
} from '../../../src/timeline/types'
import type { Anchor, Region, View, WarpSegment } from '../../../src/types'
import type { RegionBlock } from '../../../src/timeline/types'
import { buildLayout, MINIMAP_H } from '../../../src/timeline/layout'
import { createTimelineController } from '../../../src/timeline/controller'
import { beginReplayFrame } from '../../../src/constraints/pipelineDispatch'
import { makeStore } from '../../helpers/setup'
import { gesture } from '../../../src/store/gesture'
import { selectLinkedAnchorIds } from '../../../src/store/selectors'
import { setView } from '../../../src/store/slices/uiSlice'
import { moveAnchors, moveBeatAnchors, moveRegionBounds } from '../../../src/store/thunks/regionThunks'
import { commitClipoutResize, commitClipoutPan } from '../../../src/store/thunks/clipoutThunks'
import { applyRegionEntityMove, applyAnchorEntityMove } from '../../../src/store/thunks/entityWriteThunks'
import { dragStart, dragEnd } from '../../../src/store/slices/dragSlice'
import { cancelDrag, snapshotPreDragState } from '../../../src/store/thunks/dragThunks'

const DEFAULT_CANVAS = { width: 1000, height: 600 }
const DEFAULT_VIEW: View = { start: 0, end: 100 }
const DEFAULT_RECT = { left: 0, top: 0, width: 1000, height: 600 }

export interface SnapOverrides {
  view?: View
  duration?: number
  outputDuration?: number
  maxDuration?: number
  anchors?: Anchor[]
  beatAnchors?: Anchor[]
  linkedBeatIds?: ReadonlySet<number>
  selectedOrigAnchorIds?: ReadonlySet<number>
  selectedBeatAnchorIds?: ReadonlySet<number>
  regions?: RegionBlock[]
  regionsOutput?: RegionBlock[]
  /** Full Region objects for R1 Slice C live linking-event preview. Defaults to [] when omitted. */
  regionDetails?: Region[]
  selectedClipinIds?: ReadonlySet<string>
  selectedClipoutIds?: ReadonlySet<string>
  scenes?: number[]
  selectedSceneTimes?: ReadonlySet<number>
  segments?: WarpSegment[]
  bpm?: number
  beatOffset?: number
  snapInterval?: number
  snapOffset?: number
  followDrag?: boolean
  warpCollapsed?: boolean
  canvas?: { width: number; height: number }
  tracks?: LayoutTrack[]
  hits?: HitEntry[]
  playhead?: number
}

export function makeSnap(o: SnapOverrides = {}): Snapshot {
  const canvas = o.canvas ?? DEFAULT_CANVAS
  const tracks = o.tracks ?? buildLayout(o.warpCollapsed ?? false, canvas.height)
  return {
    view: o.view ?? DEFAULT_VIEW,
    duration: o.duration ?? 100,
    outputDuration: o.outputDuration ?? 100,
    maxDuration: o.maxDuration ?? 100,
    anchors: o.anchors ?? [],
    beatAnchors: o.beatAnchors ?? [],
    linkedBeatIds: o.linkedBeatIds ?? new Set(),
    selectedOrigAnchorIds: o.selectedOrigAnchorIds ?? new Set(),
    selectedBeatAnchorIds: o.selectedBeatAnchorIds ?? new Set(),
    regions: o.regions ?? [],
    regionsOutput: o.regionsOutput,
    regionDetails: o.regionDetails ?? [],
    selectedClipinIds: o.selectedClipinIds ?? new Set(),
    selectedClipoutIds: o.selectedClipoutIds ?? new Set(),
    scenes: o.scenes ?? [],
    selectedSceneTimes: o.selectedSceneTimes ?? new Set(),
    segments: o.segments ?? [],
    bpm: o.bpm ?? 120,
    beatOffset: o.beatOffset,
    snapInterval: o.snapInterval,
    snapOffset: o.snapOffset,
    followDrag: o.followDrag ?? false,
    warpCollapsed: o.warpCollapsed ?? false,
    canvas,
    tracks,
    hits: o.hits ?? [],
    playhead: o.playhead,
  }
}

export interface PointerOverrides {
  clientX: number
  clientY: number
  button?: number
  shiftKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  canvasRect?: { left: number; top: number; width: number; height: number }
}

export function makePointer(o: PointerOverrides): PointerEventLike {
  return {
    clientX: o.clientX,
    clientY: o.clientY,
    button: o.button ?? 0,
    shiftKey: o.shiftKey ?? false,
    ctrlKey: o.ctrlKey ?? false,
    metaKey: o.metaKey ?? false,
    altKey: o.altKey ?? false,
    canvasRect: o.canvasRect ?? DEFAULT_RECT,
  }
}

export interface WheelOverrides extends PointerOverrides {
  deltaX?: number
  deltaY?: number
}

export function makeWheel(o: WheelOverrides): WheelEventLike {
  return {
    ...makePointer(o),
    deltaX: o.deltaX ?? 0,
    deltaY: o.deltaY ?? 0,
  }
}

export function makeKey(key: string, mods: Partial<Pick<KeyEventLike, 'shiftKey'|'ctrlKey'|'metaKey'|'altKey'>> = {}): KeyEventLike {
  return {
    key,
    shiftKey: mods.shiftKey ?? false,
    ctrlKey: mods.ctrlKey ?? false,
    metaKey: mods.metaKey ?? false,
    altKey: mods.altKey ?? false,
  }
}

/** Find the first intent matching a kind. */
export function findIntent<K extends Intent['kind']>(intents: Intent[], kind: K): Extract<Intent, { kind: K }> | undefined {
  return intents.find(i => i.kind === kind) as Extract<Intent, { kind: K }> | undefined
}

/** Locate a track by id in a snapshot for hit-test setup. */
export function trackY(snap: Snapshot, id: string): number {
  const tr = snap.tracks.find(t => t.id === id)
  if (!tr) throw new Error(`Track ${id} not in snapshot`)
  return tr.y + tr.h / 2
}

/** Build a hit entry for a region at view-relative time positions. */
export function regionHit(snap: Snapshot, regionId: string, edge: 'in' | 'out' | 'body' = 'body'): HitEntry {
  const r = snap.regions.find(x => x.id === regionId)
  if (!r) throw new Error(`Region ${regionId} not found`)
  const tr = snap.tracks.find(t => t.id === 'clipin')
  if (!tr) throw new Error('clipin track missing')
  const W = snap.canvas.width
  const span = snap.view.end - snap.view.start
  const x1 = ((r.inPoint - snap.view.start) / span) * W
  const x2 = ((r.outPoint - snap.view.start) / span) * W
  if (edge === 'in') return { x: x1 - 4, y: tr.y, w: 8, h: tr.h, data: { kind: 'region-edge', id: regionId, edge: 'in', isOutput: false } }
  if (edge === 'out') return { x: x2 - 4, y: tr.y, w: 8, h: tr.h, data: { kind: 'region-edge', id: regionId, edge: 'out', isOutput: false } }
  return { x: x1 + 4, y: tr.y, w: Math.max(0, x2 - x1 - 8), h: tr.h, data: { kind: 'region', id: regionId, isOutput: false } }
}

export function anchorHit(snap: Snapshot, anchorId: number, space: 'input' | 'output' = 'input'): HitEntry {
  const list = space === 'input' ? snap.anchors : snap.beatAnchors
  const a = list.find(x => x.id === anchorId)
  if (!a) throw new Error(`Anchor ${anchorId} not found in ${space}`)
  const trId = space === 'input' ? 'markerin' : 'markerout'
  const tr = snap.tracks.find(t => t.id === trId)
  if (!tr) throw new Error(`${trId} track missing`)
  const W = snap.canvas.width
  const span = snap.view.end - snap.view.start
  const x = ((a.time - snap.view.start) / span) * W
  return { x: x - 5, y: tr.y, w: 10, h: tr.h, data: { kind: 'anchor', id: anchorId, space } }
}

export function sceneHit(snap: Snapshot, time: number): HitEntry {
  const tr = snap.tracks.find(t => t.id === 'scenes')
  if (!tr) throw new Error('scenes track missing')
  const W = snap.canvas.width
  const span = snap.view.end - snap.view.start
  const x = ((time - snap.view.start) / span) * W
  return { x: x - 6, y: tr.y, w: 12, h: tr.h, data: { kind: 'scene', time } }
}

export function minimapHit(): HitEntry {
  return { x: 0, y: 0, w: 1000, h: MINIMAP_H, data: { kind: 'minimap' } }
}

/** Build a hit entry for an output-space (clipout) region. */
export function outputRegionHit(snap: Snapshot, regionId: string, edge: 'in' | 'out' | 'body' = 'body'): HitEntry {
  const list = snap.regionsOutput ?? snap.regions
  const r = list.find(x => x.id === regionId)
  if (!r) throw new Error(`Output region ${regionId} not found`)
  const tr = snap.tracks.find(t => t.id === 'clipout')
  if (!tr) throw new Error('clipout track missing')
  const W = snap.canvas.width
  const span = snap.view.end - snap.view.start
  const x1 = ((r.inPoint - snap.view.start) / span) * W
  const x2 = ((r.outPoint - snap.view.start) / span) * W
  if (edge === 'in') return { x: x1 - 4, y: tr.y, w: 8, h: tr.h, data: { kind: 'region-edge', id: regionId, edge: 'in', isOutput: true } }
  if (edge === 'out') return { x: x2 - 4, y: tr.y, w: 8, h: tr.h, data: { kind: 'region-edge', id: regionId, edge: 'out', isOutput: true } }
  return { x: x1 + 4, y: tr.y, w: Math.max(0, x2 - x1 - 8), h: tr.h, data: { kind: 'region', id: regionId, isOutput: true } }
}

/** Convert a time value to a canvas-space clientX, given the snapshot view + default rect. */
export function timeToClientX(time: number, snap: Snapshot, canvasRect = DEFAULT_RECT): number {
  const span = snap.view.end - snap.view.start
  const frac = (time - snap.view.start) / span
  return canvasRect.left + frac * snap.canvas.width
}

// ── driveController ───────────────────────────────────────────────────────────

export interface DriverHandle {
  store: ReturnType<typeof makeStore>
  controller: ReturnType<typeof createTimelineController>
  /** Apply an intent array to the store, mirroring CanvasTimeline.applyIntents
   *  + the relevant WarpView/CenterColumn prop callbacks. */
  applyIntents: (intents: Intent[]) => void
  /** Get the current snapshot seeded from the store state (anchors, regions, etc.).
   *  Caller should pass any snapshot overrides (e.g. hits, view) via snap param. */
  makeSnap: (overrides?: SnapOverrides) => Snapshot
}

export interface DriverOptions {
  /** Initial store-seeding callback. Dispatch slice actions here. */
  seedStore: (store: ReturnType<typeof makeStore>) => void
}

/**
 * Wires a real Redux store + real timeline controller + intent applier.
 *
 * The intent applier mirrors CanvasTimeline.applyIntents plus WarpView's prop
 * callbacks so that gesture → intent → dispatch flows through production code.
 */
export function driveController(opts: DriverOptions): DriverHandle {
  const store = makeStore()
  opts.seedStore(store)
  const controller = createTimelineController()

  function applyIntents(intents: Intent[]): void {
    // Replay-frame boundary: reset slice's regions/anchors to preDrag values
    // before processing this pointer event's intents. Without this, fields
    // written by a prior frame's constraint cascade (e.g., anchor-lock
    // moving inner anchors while alt was held) persist into the current
    // frame's slice — defeating the replay invariant.
    beginReplayFrame(store.dispatch, store.getState as never)
    for (const i of intents) {
      switch (i.kind) {
        // ── commit intents → dispatched thunks (production path) ────────────
        case 'regionResize':
          if (i.isOutput) {
            store.dispatch(commitClipoutResize({
              id: i.id, inBeatTime: i.inPoint, outBeatTime: i.outPoint, altKey: i.altKey,
            }))
          } else {
            store.dispatch(moveRegionBounds({ id: i.id, inPoint: i.inPoint, outPoint: i.outPoint }))
          }
          break
        case 'regionMove':
          if (i.isOutput) {
            store.dispatch(commitClipoutPan({
              id: i.id, inBeatTime: i.inPoint, outBeatTime: i.outPoint, altKey: i.altKey,
            }))
          } else {
            store.dispatch(moveRegionBounds({ id: i.id, inPoint: i.inPoint, outPoint: i.outPoint }))
          }
          break
        case 'regionEntityMove':
          if (i.isOutput) {
            // Output-space body pan: pass cumulative delta — commitClipoutPan
            // resolves the absolute target from state.drag.preDrag so repeated
            // emissions during a drag converge rather than compounding.
            store.dispatch(commitClipoutPan({ id: i.id, delta: i.delta, altKey: i.altKey }))
          } else {
            store.dispatch(applyRegionEntityMove({ id: i.id, delta: i.delta }))
          }
          break
        case 'beatAnchorsChanged':
          store.dispatch(moveBeatAnchors(i.next))
          break
        case 'anchorsChanged':
          store.dispatch(moveAnchors(i.next))
          break
        case 'anchorEntityMove':
          store.dispatch(applyAnchorEntityMove({ entityId: i.entityId, time: i.time }))
          break
        case 'viewChange':
          store.dispatch(setView(i.view))
          break
        // ── gesture-store publishes ──────────────────────────────────────────
        // Live drag region bounds (pubDragRegion / pubDragRegions), live BPM
        // (pubLiveBpm), and live lockedBeats (pubLiveLockedBeats) have been removed
        // from the Intent union — the slice is now the live state.
        case 'pubDragTime':
          gesture.setDragTime(i.space, i.time)
          break
        case 'pubSnapHints':
          gesture.setSnapHints(i.space, i.times)
          break
        case 'pubScrubTime':
          gesture.setScrubTime(i.time)
          break
        case 'pubLasso':
          gesture.setLassoSelection(i.clipinIds, i.clipoutIds, i.origAnchorIds, i.beatAnchorIds, i.sceneTimes)
          break
        case 'pubClearGesture':
          gesture.clearAll()
          break
        case 'dragStart':
          store.dispatch(dragStart(snapshotPreDragState(store.getState())))
          break
        case 'dragEnd':
          store.dispatch(dragEnd())
          break
        case 'dragCancel':
          store.dispatch(cancelDrag())
          break
        case 'pubModifierKeys':
          break
        case 'pubHoveredAnchor':
          gesture.setHoveredAnchor(i.id)
          break
        case 'pubHoveredRegion':
          gesture.setHoveredRegion(i.id)
          break
        case 'pubHoveredScene':
          gesture.setHoveredScene(i.time)
          break
        case 'pubHoveredWarpLine':
          gesture.setHoveredWarpLine(i.id)
          break
        // ── canvas hints → noop in tests ─────────────────────────────────────
        case 'seek':
        case 'seekBeat':
        case 'redraw':
        case 'cursor':
        case 'thumbnailHover':
        case 'anchorAdd':
        case 'anchorDelete':
        case 'beatAnchorDelete':
        case 'anchorSelect':
        case 'beatAnchorSelect':
        case 'anchorContextMenu':
        case 'beatAnchorContextMenu':
        case 'sceneContextMenu':
        case 'regionContextMenu':
        case 'timelineContextMenu':
        case 'sceneAdd':
        case 'sceneDelete':
        case 'regionAdd':
        case 'regionSelect':
        case 'regionZoom':
        case 'timelineDeselect':
        case 'timelineDelete':
        case 'clipsSelectionChange':
        case 'scenesSelectionChange':
        case 'connectorSelectionChange':
          break
      }
    }
  }

  function makeSnap(overrides: SnapOverrides = {}): Snapshot {
    const state = store.getState()
    return makeSnapFromState(state, overrides)
  }

  return { store, controller, applyIntents, makeSnap }
}

/** Build a Snapshot from store state + optional overrides. Merges warp/region
 *  state so the controller's hit-test logic sees the current Redux state. */
function makeSnapFromState(
  state: ReturnType<ReturnType<typeof makeStore>['getState']>,
  overrides: SnapOverrides = {},
): Snapshot {
  const canvas = overrides.canvas ?? DEFAULT_CANVAS
  const tracks = overrides.tracks ?? buildLayout(overrides.warpCollapsed ?? false, canvas.height)
  return {
    view: overrides.view ?? state.ui?.view ?? DEFAULT_VIEW,
    duration: overrides.duration ?? 100,
    outputDuration: overrides.outputDuration ?? 100,
    maxDuration: overrides.maxDuration ?? 100,
    anchors: overrides.anchors ?? state.warp.origAnchors,
    beatAnchors: overrides.beatAnchors ?? state.warp.beatAnchors,
    linkedBeatIds: overrides.linkedBeatIds ?? selectLinkedAnchorIds(state as never),
    selectedOrigAnchorIds: overrides.selectedOrigAnchorIds ?? new Set(state.warp.selectedOrigIds),
    selectedBeatAnchorIds: overrides.selectedBeatAnchorIds ?? new Set(state.warp.selectedBeatIds),
    regions: overrides.regions ?? state.region.regions.map(r => ({
      id: r.id, inPoint: r.inPoint, outPoint: r.outPoint,
    })),
    regionsOutput: overrides.regionsOutput ?? state.region.regions.map(r => ({
      id: r.id, inPoint: r.inBeatTime, outPoint: r.outBeatTime,
    })),
    regionDetails: overrides.regionDetails ?? state.region.regions,
    selectedClipinIds: overrides.selectedClipinIds ?? new Set(),
    selectedClipoutIds: overrides.selectedClipoutIds ?? new Set(),
    scenes: overrides.scenes ?? [],
    selectedSceneTimes: overrides.selectedSceneTimes ?? new Set(),
    segments: overrides.segments ?? [],
    bpm: overrides.bpm ?? state.warp.bpm,
    beatOffset: overrides.beatOffset,
    snapInterval: overrides.snapInterval,
    snapOffset: overrides.snapOffset,
    followDrag: overrides.followDrag ?? false,
    warpCollapsed: overrides.warpCollapsed ?? false,
    canvas,
    tracks,
    hits: overrides.hits ?? [],
    playhead: overrides.playhead,
  }
}
