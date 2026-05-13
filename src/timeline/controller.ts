import type {
  Snapshot,
  Intent,
  DragState,
  PendingSelect,
  PointerEventLike,
  WheelEventLike,
  KeyEventLike,
  Space,
} from './types'
import type { Anchor } from '../types'
import type { RegionBlock } from './types'
import { MINIMAP_H } from './layout'
import { hitAt } from './hitTest'
import { minimapRecenter, dragPan, wheelZoom, wheelPan } from './view'
import { computeSnap, pixelsToSeconds, type SnapTarget, type SnapGrid } from '../utils/snap'
import {
  anchorDragInputTargets, anchorDragOutputGrid,
  regionDragTargets, snapCandidates,
} from './model/snapTarget'

/**
 * Pure gesture state machine for CanvasTimeline.
 *
 * The controller is stateful only for in-flight drags. All inputs flow
 * through a per-event `Snapshot`. All outputs flow through a returned
 * `Intent[]` list. No React, no Redux, no DOM access — that's the wrapper's
 * job.
 */
export interface Controller {
  pointerDown(e: PointerEventLike, snap: Snapshot): Intent[]
  pointerMove(e: PointerEventLike, snap: Snapshot): Intent[]
  pointerUp(snap: Snapshot): Intent[]
  cancel(): Intent[]
  wheel(e: WheelEventLike, snap: Snapshot): Intent[]
  doubleClick(e: PointerEventLike, snap: Snapshot): Intent[]
  contextMenu(e: PointerEventLike, snap: Snapshot): Intent[]
  keyDown(e: KeyEventLike): Intent[]
  getDragState(): DragState | null
}

function mx(e: PointerEventLike): number {
  return e.clientX - e.canvasRect.left
}

function my(e: PointerEventLike): number {
  return e.clientY - e.canvasRect.top
}

function pxToT(px: number, snap: Snapshot): number {
  const w = snap.canvas.width || 1
  return snap.view.start + (px / w) * (snap.view.end - snap.view.start)
}

/** Click → drag threshold (squared) in pixels. Once cursor movement from
 *  pointerDown exceeds this distance, the gesture is a drag and the
 *  pendingSelect emit is discarded on pointerUp. Same threshold used by the
 *  lasso (4 px). */
const DRAG_THRESHOLD_PX_SQ = 16

/** Update `moved` once the cursor crossed the click→drag threshold. */
function markMovedIfBeyondThreshold(
  drag: { startClientX: number; startClientY: number; moved: boolean },
  e: PointerEventLike,
): void {
  if (drag.moved) return
  const dx = e.clientX - drag.startClientX
  const dy = e.clientY - drag.startClientY
  if (dx * dx + dy * dy >= DRAG_THRESHOLD_PX_SQ) drag.moved = true
}

/** Build a combined-selection anchor drag state. When `wasSelected` is true,
 *  every selected anchor in BOTH spaces and every selected region is
 *  captured. Otherwise only the dragged anchor's space is populated.
 *
 *  Selection is no longer emitted on pointerDown — see the call site for the
 *  `pendingSelect[]` flushed on pointerUp click. */
function buildAnchorDrag(
  snap: Snapshot,
  id: number,
  space: 'input' | 'output',
  origTime: number,
  wasSelected: boolean,
  forcePairCapture: boolean,
  startClientX: number,
  startClientY: number,
  pendingSelect: PendingSelect[],
): Extract<DragState, { kind: 'anchor' }> {
  const liveAnchors: Anchor[] = [...snap.anchors]
  const liveBeatAnchors: Anchor[] = [...snap.beatAnchors]

  // Anchor group ids for the dragged space. For an input drag, we capture
  // every id in selectedOrigAnchorIds; for an output drag, selectedBeatAnchorIds.
  // The partner space is only included when the SAME id is also in the
  // partner's selection set (fully selected) or when forcePairCapture is true.
  const spaceSelectedIds = space === 'input'
    ? snap.selectedOrigAnchorIds
    : snap.selectedBeatAnchorIds
  const anchorIdsInSelection = wasSelected ? new Set(spaceSelectedIds) : new Set<number>()
  anchorIdsInSelection.add(id)

  // Per-space pairing: each id is captured ONLY in the spaces it's selected
  // in (plus the dragged-space partner if forcePairCapture, for conformed
  // boundaries). A lasso in only the input track captures input anchors;
  // their beat partners stay put unless those beat partners were ALSO
  // lassoed (and thus are in selectedBeatAnchorIds).
  const origInputTimes = new Map<number, number>()
  const origBeatTimes = new Map<number, number>()
  for (const gid of anchorIdsInSelection) {
    const isDragged = gid === id
    const wantInput = space === 'input'
      ? (isDragged || snap.selectedOrigAnchorIds.has(gid))
      : (isDragged ? (forcePairCapture || snap.selectedOrigAnchorIds.has(gid)) : snap.selectedOrigAnchorIds.has(gid))
    const wantBeat = space === 'output'
      ? (isDragged || snap.selectedBeatAnchorIds.has(gid))
      : (isDragged ? (forcePairCapture || snap.selectedBeatAnchorIds.has(gid)) : snap.selectedBeatAnchorIds.has(gid))
    if (wantInput) {
      const ai = snap.anchors.find(a => a.id === gid)
      if (ai) origInputTimes.set(gid, ai.time)
    }
    if (wantBeat) {
      const ab = snap.beatAnchors.find(a => a.id === gid)
      if (ab) origBeatTimes.set(gid, ab.time)
    }
  }

  // Region group: every selected region's bounds at drag start. Empty when
  // the dragged anchor was not in the selection — a non-selected click
  // does NOT pull the existing selection into this drag (the existing
  // selection is preserved unchanged because no select intent fires).
  let regionGroupIds: ReadonlySet<string> | undefined
  let origRegionBounds: Map<string, { inPoint: number; outPoint: number }> | undefined
  // Space-aware clip group: input-space anchor drag pulls clipin selections;
  // output-space anchor drag pulls clipout selections.
  const spaceClipIds = space === 'input' ? snap.selectedClipinIds : snap.selectedClipoutIds
  if (wasSelected && spaceClipIds.size > 0) {
    regionGroupIds = new Set(spaceClipIds)
    origRegionBounds = new Map()
    for (const gid of regionGroupIds) {
      const gr = snap.regions.find(rr => rr.id === gid)
      if (gr) origRegionBounds.set(gid, { inPoint: gr.inPoint, outPoint: gr.outPoint })
    }
  }

  const isPair = origInputTimes.has(id) && origBeatTimes.has(id)

  return {
    kind: 'anchor',
    id,
    space,
    origTime,
    liveAnchors,
    liveBeatAnchors,
    startClientX,
    startClientY,
    moved: false,
    pendingSelect,
    isPair,
    groupIds: anchorIdsInSelection,
    origInputTimes,
    origBeatTimes,
    regionGroupIds,
    origRegionBounds,
    liveRegionBounds: undefined,
  }
}

/** Build a combined-selection region-move drag state. When `wasSelected` is
 *  true, every selected region and every selected anchor (both spaces) is
 *  captured. Otherwise only the dragged region is populated. */
function buildRegionDrag(
  snap: Snapshot,
  id: string,
  isOutput: boolean,
  r: RegionBlock,
  anchorX: number,
  wasSelected: boolean,
  startClientX: number,
  startClientY: number,
  pendingSelect: PendingSelect[],
): Extract<DragState, { kind: 'region-move' }> {
  const list = isOutput ? (snap.regionsOutput ?? snap.regions) : snap.regions
  // Space-aware group: clipout drag uses selectedClipoutIds; clipin drag uses selectedClipinIds.
  const spaceClipIds = isOutput ? snap.selectedClipoutIds : snap.selectedClipinIds
  const regionGroupIds: ReadonlySet<string> = wasSelected
    ? new Set(spaceClipIds)
    : new Set([id])
  const origBounds = new Map<string, { inPoint: number; outPoint: number }>()
  for (const gid of regionGroupIds) {
    const gr = list.find(rr => rr.id === gid)
    if (gr) origBounds.set(gid, { inPoint: gr.inPoint, outPoint: gr.outPoint })
  }
  // Always ensure the dragged id is included.
  if (!origBounds.has(id)) origBounds.set(id, { inPoint: r.inPoint, outPoint: r.outPoint })

  // Anchor group: empty unless the region was selected AND anchors are too.
  let anchorGroupIds: ReadonlySet<number> | undefined
  let origInputAnchorTimes: Map<number, number> | undefined
  let origBeatAnchorTimes: Map<number, number> | undefined
  let liveAnchors: Anchor[] | undefined
  let liveBeatAnchors: Anchor[] | undefined
  // For combined region+anchor drags, capture ALL uniquely-selected anchor
  // ids (union of orig and beat selected sets) so any selected anchor moves
  // with the region pan. Both spaces are moved by the same time delta.
  const allSelectedAnchorIds = new Set([
    ...snap.selectedOrigAnchorIds,
    ...snap.selectedBeatAnchorIds,
  ])
  if (wasSelected && allSelectedAnchorIds.size > 0 && !isOutput) {
    anchorGroupIds = allSelectedAnchorIds
    origInputAnchorTimes = new Map()
    origBeatAnchorTimes = new Map()
    for (const gid of anchorGroupIds) {
      const ai = snap.anchors.find(a => a.id === gid)
      if (ai) origInputAnchorTimes.set(gid, ai.time)
      const ab = snap.beatAnchors.find(a => a.id === gid)
      if (ab) origBeatAnchorTimes.set(gid, ab.time)
    }
    liveAnchors = [...snap.anchors]
    liveBeatAnchors = [...snap.beatAnchors]
  }
  // Slice B: for output-space body pan, always capture all beat anchors and
  // their original times so pointerMove can translate those inside the region
  // when effectiveAnchorLock is true. This is independent of the combined-
  // selection anchor group above (which is input-space only).
  if (isOutput) {
    liveBeatAnchors = [...snap.beatAnchors]
    origBeatAnchorTimes = new Map()
    for (const a of snap.beatAnchors) origBeatAnchorTimes.set(a.id, a.time)
  }

  return {
    kind: 'region-move',
    id,
    isOutput,
    origIn: r.inPoint,
    origOut: r.outPoint,
    anchorX,
    liveRegion: null,
    startClientX,
    startClientY,
    moved: false,
    pendingSelect,
    lastAltKey: false,
    groupIds: regionGroupIds,
    origBounds,
    liveBoundsList: undefined,
    anchorGroupIds,
    origInputAnchorTimes,
    origBeatAnchorTimes,
    liveAnchors,
    liveBeatAnchors,
  }
}

/**
 * Handle pointerMove for an active anchor drag.
 * Mutates `drag` (updates liveAnchors / liveBeatAnchors / liveRegionBounds)
 * and returns the intents for this frame.
 */
function handleAnchorMove(
  drag: Extract<DragState, { kind: 'anchor' }>,
  e: PointerEventLike,
  snap: Snapshot,
): Intent[] {
  const intents: Intent[] = []
  const x = e.clientX - e.canvasRect.left
  const W = snap.canvas.width || 1
  const viewSpan = snap.view.end - snap.view.start
  markMovedIfBeyondThreshold(drag, e)
  const raw = pxToT(x, snap)
  const thresholdSec = pixelsToSeconds(8, W, viewSpan)
  const hintThresholdSec = pixelsToSeconds(24, W, viewSpan)
  let snapped = raw
  const isPairDrag = !!(
    drag.origInputTimes && drag.origBeatTimes &&
    drag.origInputTimes.has(drag.id) && drag.origBeatTimes.has(drag.id)
  )
  if (isPairDrag) {
    const clientDx = e.clientX - drag.startClientX
    const rawDelta = (clientDx / W) * viewSpan
    const origInputT = drag.origInputTimes!.get(drag.id)!
    const origBeatT  = drag.origBeatTimes!.get(drag.id)!
    const rawInputSubject = origInputT + rawDelta
    const rawBeatSubject  = origBeatT  + rawDelta

    const inputTargets = anchorDragInputTargets(snap.scenes, snap.regions)
    const outputGrid = anchorDragOutputGrid(
      snap.snapInterval, snap.snapOffset ?? 0, viewSpan, W, snap.bpm,
    )

    const inputResult = computeSnap({
      subjects: [rawInputSubject], targets: inputTargets, thresholdSec,
    })
    const outputResult = computeSnap({
      subjects: [rawBeatSubject], grid: outputGrid ?? undefined, thresholdSec,
    })

    let chosenDelta = 0
    let chosenHintSpace: Space = drag.space
    let chosenHintTargets: number[] = []
    const inAbs  = inputResult.hit  ? Math.abs(inputResult.delta)  : Infinity
    const outAbs = outputResult.hit ? Math.abs(outputResult.delta) : Infinity
    if (inAbs <= outAbs && Number.isFinite(inAbs)) {
      chosenDelta = inputResult.delta
      chosenHintSpace = 'input'
      chosenHintTargets = snapCandidates(
        [rawInputSubject], inputTargets, undefined, hintThresholdSec,
      )
    } else if (Number.isFinite(outAbs)) {
      chosenDelta = outputResult.delta
      chosenHintSpace = 'output'
      chosenHintTargets = outputResult.hit ? [outputResult.hit.target.time] : []
    }
    snapped = drag.origTime + rawDelta + chosenDelta
    intents.push({ kind: 'pubSnapHints', space: chosenHintSpace, times: chosenHintTargets })
  } else {
    let targets: SnapTarget[] = []
    let grid: SnapGrid | undefined
    if (drag.space === 'input') {
      targets = anchorDragInputTargets(snap.scenes, snap.regions)
    } else {
      const g = anchorDragOutputGrid(
        snap.snapInterval, snap.snapOffset ?? 0, viewSpan, W, snap.bpm,
      )
      if (g) grid = g
    }
    const result = computeSnap({ subjects: [raw], targets, grid, thresholdSec })
    snapped = raw + result.delta
    const hints = drag.space === 'output'
      ? (result.hit ? [result.hit.target.time] : [])
      : snapCandidates(
          [raw], targets,
          grid ? { interval: grid.interval, offset: grid.offset ?? 0 } : undefined,
          hintThresholdSec,
        )
    intents.push({ kind: 'pubSnapHints', space: drag.space, times: hints })
  }
  intents.push({ kind: 'pubDragTime', space: drag.space, time: snapped })

  const t = Math.max(0, snapped)
  const delta = t - drag.origTime
  const groupIds = drag.groupIds ?? new Set([drag.id])
  const origInputTimes = drag.origInputTimes
  const origBeatTimes = drag.origBeatTimes
  if (origInputTimes && origInputTimes.size > 0) {
    drag.liveAnchors = drag.liveAnchors.map(a => {
      if (!groupIds.has(a.id)) return a
      const o = origInputTimes.get(a.id)
      if (o === undefined) return a
      return { ...a, time: Math.max(0, o + delta) }
    })
  }
  if (origBeatTimes && origBeatTimes.size > 0) {
    drag.liveBeatAnchors = drag.liveBeatAnchors.map(a => {
      if (!groupIds.has(a.id)) return a
      const o = origBeatTimes.get(a.id)
      if (o === undefined) return a
      return { ...a, time: Math.max(0, o + delta) }
    })
  }
  if (drag.regionGroupIds && drag.origRegionBounds) {
    const MAX = snap.duration
    const live: { id: string; inPoint: number; outPoint: number }[] = []
    for (const gid of drag.regionGroupIds) {
      const orig = drag.origRegionBounds.get(gid)
      if (!orig) continue
      const gDur = orig.outPoint - orig.inPoint
      const gIn = Math.max(0, Math.min(MAX - gDur, orig.inPoint + delta))
      const gOut = gIn + gDur
      live.push({ id: gid, inPoint: gIn, outPoint: gOut })
    }
    drag.liveRegionBounds = live
  }
  {
    const anchorDragNow = drag
    if (anchorDragNow.moved) {
      const inputChanged = anchorDragNow.origInputTimes && anchorDragNow.origInputTimes.size > 0 &&
        anchorDragNow.liveAnchors.some(a => {
          const o = anchorDragNow.origInputTimes!.get(a.id)
          return o !== undefined && o !== a.time
        })
      const beatChanged = anchorDragNow.origBeatTimes && anchorDragNow.origBeatTimes.size > 0 &&
        anchorDragNow.liveBeatAnchors.some(a => {
          const o = anchorDragNow.origBeatTimes!.get(a.id)
          return o !== undefined && o !== a.time
        })
      if (inputChanged) {
        intents.push({ kind: 'anchorsChanged', next: anchorDragNow.liveAnchors })
      }
      if (beatChanged) {
        intents.push({ kind: 'beatAnchorsChanged', next: anchorDragNow.liveBeatAnchors })
      }
      if (anchorDragNow.liveRegionBounds) {
        for (const lr of anchorDragNow.liveRegionBounds) {
          intents.push({ kind: 'regionMove', id: lr.id, inPoint: lr.inPoint, outPoint: lr.outPoint, isOutput: false, altKey: false })
        }
      }
      // Bug G/H: For output-space drags with linked region edges, emit a
      // regionResize (isOutput) intent so the slice gets live beat-bounds
      // updates, making the clipout edge follow the anchor continuously.
      if (anchorDragNow.space === 'output' && anchorDragNow.linkedOutputEdges && anchorDragNow.linkedOutputEdges.length > 0) {
        const liveBeatT = anchorDragNow.liveBeatAnchors.find(a => a.id === anchorDragNow.id)?.time
          ?? (anchorDragNow.origBeatTimes?.get(anchorDragNow.id) ?? anchorDragNow.origTime) + delta
        for (const le of anchorDragNow.linkedOutputEdges) {
          const newIn  = le.edge === 'in'  ? liveBeatT : le.origInBeatTime
          const newOut = le.edge === 'out' ? liveBeatT : le.origOutBeatTime
          intents.push({ kind: 'regionResize', id: le.regionId, inPoint: newIn, outPoint: newOut, isOutput: true, altKey: false })
        }
      }
    }
  }

  if (snap.followDrag) {
    if (drag.space === 'input') intents.push({ kind: 'seek', time: t })
    else intents.push({ kind: 'seekBeat', time: t })
  }
  intents.push({ kind: 'redraw' })
  return intents
}

/**
 * Handle pointerMove for an active region-edge drag.
 * Mutates `drag` (updates liveRegion / liveBeatAnchors) and returns intents.
 */
function handleRegionEdgeMove(
  drag: Extract<DragState, { kind: 'region-edge' }>,
  e: PointerEventLike,
  snap: Snapshot,
): Intent[] {
  const intents: Intent[] = []
  const x = e.clientX - e.canvasRect.left
  const W = snap.canvas.width || 1
  const viewSpan = snap.view.end - snap.view.start
  markMovedIfBeyondThreshold(drag, e)
  drag.lastAltKey = e.altKey
  const raw = pxToT(x, snap)
  const MAX = drag.isOutput ? snap.outputDuration : snap.duration
  const thresholdSec = pixelsToSeconds(8, W, viewSpan)
  const hintThresholdSec = pixelsToSeconds(24, W, viewSpan)
  const space = drag.isOutput ? 'output' : 'input'
  const regionList = drag.isOutput ? (snap.regionsOutput ?? snap.regions) : snap.regions
  // Output-space edge resize with lock='beats' changes BPM → grid is in motion.
  const edgeGridChanging = drag.isOutput && snap.clipLock === 'beats'
  // selfRegion: use the canonical input-space bounds from regionDetails so
  // the snap targets are the raw clipin inPoint/outPoint values — no
  // projection through the warp map needed or desired.
  const edgeDragId = drag.id
  const edgeSelfRegionDetail = edgeGridChanging
    ? snap.regionDetails.find(rd => rd.id === edgeDragId)
    : undefined
  const { targets, grid } = regionDragTargets({
    isOutput: drag.isOutput,
    anchors: snap.anchors,
    beatAnchors: snap.beatAnchors,
    scenes: snap.scenes,
    regions: regionList,
    excludeId: drag.id,
    viewSpan, canvasWidth: W, bpm: snap.bpm,
    snapInterval: snap.snapInterval,
    snapOffset: snap.snapOffset ?? 0,
    gridChanging: edgeGridChanging,
    selfRegion: edgeSelfRegionDetail
      ? { inPoint: edgeSelfRegionDetail.inPoint, outPoint: edgeSelfRegionDetail.outPoint }
      : undefined,
  })
  const result = computeSnap({ subjects: [raw], targets, grid, thresholdSec })
  const snapped = raw + result.delta
  const hints = snapCandidates(
    [raw], targets,
    grid ? { interval: grid.interval, offset: grid.offset ?? 0 } : undefined,
    hintThresholdSec,
  )
  intents.push({ kind: 'pubSnapHints', space, times: hints })
  intents.push({ kind: 'pubDragTime', space, time: snapped })

  if (drag.edge === 'in') {
    const newIn = Math.max(0, Math.min(drag.origOut - 0.1, snapped))
    drag.liveRegion = { id: drag.id, inPoint: newIn, outPoint: drag.origOut }
  } else {
    const newOut = Math.max(drag.origIn + 0.1, Math.min(MAX, snapped))
    drag.liveRegion = { id: drag.id, inPoint: drag.origIn, outPoint: newOut }
  }
  // liveRegion is stored on dragState for canvas rendering via liveOverrides.
  // Live BPM / lockedBeats are now committed to the slice on every pointerMove
  // (via the regionResize intent below → onRegionResizeOutput → commitClipoutResize
  // → applyConformedClipout), so no gesture-store publish is needed here.
  // Slice B: live beat-anchor rescale during output-space edge drag.
  // effectiveAnchorLock = (clipAnchorLock ?? false) XOR lastAltKey.
  // When effectiveAnchorLock && lock='beats': proportionally rescale beat
  // anchors that lie inside [origIn, origOut] so the canvas shows them
  // moving with the clip boundary before the commit fires on pointerUp.
  if (drag.isOutput && drag.liveRegion && drag.liveBeatAnchors && drag.origBeatAnchorTimes) {
    const effectiveAnchorLock = (snap.clipAnchorLock ?? false) !== drag.lastAltKey // XOR
    const shouldRescale = effectiveAnchorLock && snap.clipLock === 'beats'
    // Extract narrowed-drag fields to locals so TS doesn't lose the union
    // narrowing inside the .map() callback.
    const edgeOrigBeatTimes = drag.origBeatAnchorTimes
    const edgeOrigIn = drag.origIn
    const edgeOrigOut = drag.origOut
    if (shouldRescale) {
      const oldLength = edgeOrigOut - edgeOrigIn
      const newLength = drag.liveRegion.outPoint - drag.liveRegion.inPoint
      if (oldLength > 1e-9 && newLength > 1e-9) {
        const scaleFactor = newLength / oldLength
        const newIn = drag.liveRegion.inPoint
        drag.liveBeatAnchors = drag.liveBeatAnchors.map(a => {
          const origTime = edgeOrigBeatTimes.get(a.id) ?? a.time
          if (origTime >= edgeOrigIn && origTime <= edgeOrigOut) {
            return { ...a, time: newIn + (origTime - edgeOrigIn) * scaleFactor }
          }
          return { ...a, time: origTime }
        })
      }
    } else {
      // No Slice-B rescale: clear liveBeatAnchors so liveBeatAnchorOverrides
      // returns [] and draw() falls through to p.beatAnchors (the freshly
      // committed Redux slice values). Syncing from snap.beatAnchors here
      // would use stale positions — snap is built before applyIntents fires
      // commitClipoutResize, so it is always one render cycle behind.
      drag.liveBeatAnchors = undefined
    }
  }
  // Live commit: dispatch region resize on every pointerMove (after threshold).
  // For output-space drags also commit beat-anchor changes.
  {
    const edgeDragNow = drag
    if (edgeDragNow.moved && edgeDragNow.liveRegion) {
      intents.push({
        kind: 'regionResize',
        id: edgeDragNow.liveRegion.id,
        inPoint: edgeDragNow.liveRegion.inPoint,
        outPoint: edgeDragNow.liveRegion.outPoint,
        isOutput: edgeDragNow.isOutput,
        altKey: edgeDragNow.lastAltKey,
      })
      if (edgeDragNow.isOutput && edgeDragNow.liveBeatAnchors && edgeDragNow.origBeatAnchorTimes) {
        const edgeBeatOrigTimes = edgeDragNow.origBeatAnchorTimes
        const edgeLiveBeatAnchors = edgeDragNow.liveBeatAnchors
        const beatAnchorsChanged = edgeLiveBeatAnchors.some(a => {
          const o = edgeBeatOrigTimes.get(a.id)
          return o !== undefined && o !== a.time
        })
        if (beatAnchorsChanged) {
          intents.push({ kind: 'beatAnchorsChanged', next: edgeLiveBeatAnchors })
        }
      }
    }
  }
  intents.push({ kind: 'redraw' })
  return intents
}

/**
 * Handle pointerMove for an active region-move (body pan) drag.
 * Mutates `drag` (updates liveRegion / liveBoundsList / liveBeatAnchors / liveAnchors)
 * and returns intents.
 */
function handleRegionMoveMove(
  drag: Extract<DragState, { kind: 'region-move' }>,
  e: PointerEventLike,
  snap: Snapshot,
): Intent[] {
  const intents: Intent[] = []
  const x = e.clientX - e.canvasRect.left
  const W = snap.canvas.width || 1
  const viewSpan = snap.view.end - snap.view.start
  markMovedIfBeyondThreshold(drag, e)
  drag.lastAltKey = e.altKey
  const raw = pxToT(x, snap)
  const MAX = drag.isOutput ? snap.outputDuration : snap.duration
  const dur = drag.origOut - drag.origIn
  const thresholdSec = pixelsToSeconds(8, W, viewSpan)
  const hintThresholdSec = pixelsToSeconds(24, W, viewSpan)
  const space = drag.isOutput ? 'output' : 'input'
  const regionList = drag.isOutput ? (snap.regionsOutput ?? snap.regions) : snap.regions
  // Output-space body pan always changes beat-grid offset → grid is in motion.
  const moveGridChanging = drag.isOutput
  // selfRegion: use the canonical input-space bounds from regionDetails so
  // the snap targets are the raw clipin inPoint/outPoint values.
  const moveDragId = drag.id
  const moveSelfRegionDetail = moveGridChanging
    ? snap.regionDetails.find(rd => rd.id === moveDragId)
    : undefined
  const { targets, grid } = regionDragTargets({
    isOutput: drag.isOutput,
    anchors: snap.anchors,
    beatAnchors: snap.beatAnchors,
    scenes: snap.scenes,
    regions: regionList,
    excludeId: drag.id,
    viewSpan, canvasWidth: W, bpm: snap.bpm,
    snapInterval: snap.snapInterval,
    snapOffset: snap.snapOffset ?? 0,
    gridChanging: moveGridChanging,
    selfRegion: moveSelfRegionDetail
      ? { inPoint: moveSelfRegionDetail.inPoint, outPoint: moveSelfRegionDetail.outPoint }
      : undefined,
  })
  const rawIn = drag.origIn + (raw - pxToT(drag.anchorX, snap))
  const rawOut = rawIn + dur
  const result = computeSnap({ subjects: [rawIn, rawOut], targets, grid, thresholdSec })
  const newIn = Math.max(0, Math.min(MAX - dur, rawIn + result.delta))
  const newOut = newIn + dur
  const snappedEdge = result.hit?.subjectIndex === 1 ? newOut : newIn
  const hints = snapCandidates(
    [rawIn, rawOut], targets,
    grid ? { interval: grid.interval, offset: grid.offset ?? 0 } : undefined,
    hintThresholdSec,
  )
  intents.push({ kind: 'pubSnapHints', space, times: hints })
  intents.push({ kind: 'pubDragTime', space, time: snappedEdge })

  // Always update liveRegion for pointerUp — both input and output space.
  drag.liveRegion = { id: drag.id, inPoint: newIn, outPoint: newOut }

  // liveRegion stored on dragState for canvas rendering; no gesture-store publish.

  // Multi-select: apply the SAME time delta (newIn - drag.origIn) to
  // every captured region, clamped to [0, MAX] preserving each
  // region's own length. Stored on dragState for canvas rendering via
  // liveOverrides; committed to the slice via regionMove intents below.
  const deltaT = newIn - drag.origIn
  if (drag.groupIds && drag.origBounds && drag.groupIds.size > 1) {
    const live: { id: string; inPoint: number; outPoint: number }[] = []
    for (const gid of drag.groupIds) {
      const orig = drag.origBounds.get(gid)
      if (!orig) continue
      const gDur = orig.outPoint - orig.inPoint
      const gIn = Math.max(0, Math.min(MAX - gDur, orig.inPoint + deltaT))
      const gOut = gIn + gDur
      live.push({ id: gid, inPoint: gIn, outPoint: gOut })
    }
    drag.liveBoundsList = live
  }
  // Slice B: live beat-anchor translate during output-space (clipout) body
  // pan. effectiveAnchorLock = (clipAnchorLock ?? false) XOR lastAltKey.
  // When effectiveAnchorLock: translate anchors inside [origIn, origOut]
  // by the same delta as the region, so they move with the clip body live.
  if (drag.isOutput && drag.liveBeatAnchors && drag.origBeatAnchorTimes) {
    const effectiveAnchorLock = (snap.clipAnchorLock ?? false) !== drag.lastAltKey // XOR
    if (effectiveAnchorLock) {
      const panOrigBeatTimes = drag.origBeatAnchorTimes
      const panOrigIn = drag.origIn
      const panOrigOut = drag.origOut
      drag.liveBeatAnchors = drag.liveBeatAnchors.map(a => {
        const origTime = panOrigBeatTimes.get(a.id) ?? a.time
        if (origTime >= panOrigIn && origTime <= panOrigOut) {
          return { ...a, time: origTime + deltaT }
        }
        return { ...a, time: origTime }
      })
    } else {
      // !effectiveAnchorLock: conformed anchors are carried by commitClipoutPan.
      // Clear liveBeatAnchors so liveBeatAnchorOverrides returns [] and draw()
      // falls through to p.beatAnchors (the freshly committed Redux values).
      // Keeping stale origTimes here would override the correct committed positions.
      drag.liveBeatAnchors = undefined
    }
  }
  // Combined drag: shift every captured anchor by the same delta in
  // BOTH spaces (input-space only — output-space region drags don't
  // carry combined anchor groups).
  if (!drag.isOutput && drag.anchorGroupIds && drag.liveAnchors && drag.liveBeatAnchors) {
    const orInput = drag.origInputAnchorTimes
    const orBeat = drag.origBeatAnchorTimes
    const anchorIds = drag.anchorGroupIds
    if (orInput) {
      drag.liveAnchors = drag.liveAnchors.map(a => {
        if (!anchorIds.has(a.id)) return a
        const o = orInput.get(a.id)
        if (o === undefined) return a
        return { ...a, time: Math.max(0, o + deltaT) }
      })
    }
    if (orBeat) {
      drag.liveBeatAnchors = drag.liveBeatAnchors.map(a => {
        if (!anchorIds.has(a.id)) return a
        const o = orBeat.get(a.id)
        if (o === undefined) return a
        return { ...a, time: Math.max(0, o + deltaT) }
      })
    }
  }
  // Live commit: dispatch region moves on every pointerMove (after threshold).
  // History + persistence skip during drag.active; dragEnd fires the snapshot.
  {
    const moveDragNow = drag
    if (moveDragNow.moved) {
      if (moveDragNow.liveRegion) {
        intents.push({
          kind: 'regionMove',
          id: moveDragNow.liveRegion.id,
          inPoint: moveDragNow.liveRegion.inPoint,
          outPoint: moveDragNow.liveRegion.outPoint,
          isOutput: moveDragNow.isOutput,
          altKey: moveDragNow.lastAltKey,
        })
      }
      if (moveDragNow.liveBoundsList) {
        for (const lr of moveDragNow.liveBoundsList) {
          if (lr.id === moveDragNow.id) continue
          intents.push({
            kind: 'regionMove',
            id: lr.id,
            inPoint: lr.inPoint,
            outPoint: lr.outPoint,
            isOutput: moveDragNow.isOutput,
            altKey: moveDragNow.lastAltKey,
          })
        }
      }
      // Combined drag: commit anchor changes too (input-space region-move only).
      // Output-space (clipout) pans handle anchor translation inside commitClipoutPan.
      if (!moveDragNow.isOutput && moveDragNow.liveAnchors && moveDragNow.origInputAnchorTimes && moveDragNow.origInputAnchorTimes.size > 0) {
        const moveOrigInputTimes = moveDragNow.origInputAnchorTimes
        const moveLiveAnchors = moveDragNow.liveAnchors
        const inputChanged = moveLiveAnchors.some(a => {
          const o = moveOrigInputTimes.get(a.id)
          return o !== undefined && o !== a.time
        })
        if (inputChanged) {
          intents.push({ kind: 'anchorsChanged', next: moveLiveAnchors })
        }
      }
      if (!moveDragNow.isOutput && moveDragNow.liveBeatAnchors && moveDragNow.origBeatAnchorTimes && moveDragNow.origBeatAnchorTimes.size > 0) {
        const moveOrigBeatTimes = moveDragNow.origBeatAnchorTimes
        const moveLiveBeatAnchors = moveDragNow.liveBeatAnchors
        const beatChanged = moveLiveBeatAnchors.some(a => {
          const o = moveOrigBeatTimes.get(a.id)
          return o !== undefined && o !== a.time
        })
        if (beatChanged) {
          intents.push({ kind: 'beatAnchorsChanged', next: moveLiveBeatAnchors })
        }
      }
    }
  }
  intents.push({ kind: 'redraw' })
  return intents
}

export function createTimelineController(): Controller {
  let drag: DragState | null = null

  function pointerDown(e: PointerEventLike, snap: Snapshot): Intent[] {
    // Right-click is handled by contextMenu(); do not arm any drag state.
    if (e.button === 2) return []

    // Shift-drag pans the timeline. Arm pan immediately and skip all
    // hit-testing so lasso / anchor / region drags cannot fire.
    if (e.shiftKey) {
      drag = { kind: 'pan', startClientX: e.clientX, startView: snap.view }
      return []
    }

    const intents: Intent[] = []
    const x = mx(e)
    const y = my(e)

    // 1) Minimap
    if (y >= 0 && y < MINIMAP_H) {
      const nextView = minimapRecenter(snap.view, x, snap.canvas.width, snap.maxDuration)
      intents.push({ kind: 'viewChange', view: nextView })
      drag = { kind: 'minimap', startClientX: e.clientX, startView: snap.view }
      return intents
    }

    const hit = hitAt(snap.hits, x, y) as Record<string, unknown> | null

    // 2) Anchor hit — combined-selection drag.
    //    pointerDown does NOT change selection. The select intent is
    //    deferred to pointerUp via `pendingSelect`. If the gesture moves
    //    past the click→drag threshold (4 px), the pending select is
    //    discarded — drag committed its move and selection stays as it was.
    //    When the dragged anchor is in the current selection, capture every
    //    selected ANCHOR in BOTH spaces and every selected REGION so the
    //    drag's time delta applies uniformly across kinds. When the dragged
    //    anchor is NOT in the current selection, capture ONLY the dragged
    //    id (single-object drag — other selected things stay put).
    if (hit && hit.kind === 'anchor') {
      const id = hit.id as number
      const space = hit.space as 'input' | 'output'
      const anchor = space === 'input'
        ? snap.anchors.find(a => a.id === id)
        : snap.beatAnchors.find(a => a.id === id)
      // "Was selected" means: is the clicked anchor's id in the selection for
      // its own space? (Input anchor → check selectedOrigAnchorIds; beat anchor
      // → check selectedBeatAnchorIds.) This determines whether this pointer-
      // down should initiate a combined-group drag or a single-anchor drag.
      const wasSelected = space === 'input'
        ? snap.selectedOrigAnchorIds.has(id)
        : snap.selectedBeatAnchorIds.has(id)
      const additive = e.shiftKey || e.metaKey || e.ctrlKey
      // Combined-drag capture flag: capture the entire current selection
      // when the user grabbed an already-selected anchor without an
      // additive modifier. Additive (shift/cmd/ctrl) implies "I'm building
      // selection, not initiating a coordinated move."
      const captureGroup = wasSelected && !additive
      // For an input-space anchor that sits on a region's inPoint or outPoint
      // (conformed), also capture the paired beat anchor so it moves with the
      // input anchor live. This mirrors the symmetric behavior of output-space
      // anchor drags moving linked clipout edges (Bug G/H / linkedOutputEdges).
      const LINK_TOL = 1e-4
      const isConformedInput = space === 'input' && anchor !== undefined &&
        snap.regionDetails.some(rd =>
          Math.abs(anchor.time - rd.inPoint) < LINK_TOL ||
          Math.abs(anchor.time - rd.outPoint) < LINK_TOL,
        )
      const pendingSelect: PendingSelect[] = [
        space === 'input'
          ? { kind: 'anchorSelect', id, additive }
          : { kind: 'beatAnchorSelect', id, additive },
      ]
      drag = buildAnchorDrag(
        snap, id, space, anchor?.time ?? 0,
        captureGroup, isConformedInput,
        e.clientX, e.clientY,
        pendingSelect,
      )
      // Bug G/H: For output-space anchor drags, record any region edge whose
      // beat-space boundary (inBeatTime / outBeatTime) is coincident with
      // this anchor at drag start. These edges will follow the anchor live.
      if (space === 'output' && anchor && snap.regionDetails.length > 0) {
        const linkedOutputEdges: Extract<DragState, { kind: 'anchor' }>['linkedOutputEdges'] = []
        const LINK_TOL = 1e-4
        for (const rd of snap.regionDetails) {
          const inBeat  = rd.inBeatTime  ?? rd.inPoint
          const outBeat = rd.outBeatTime ?? rd.outPoint
          if (Math.abs(anchor.time - inBeat) < LINK_TOL) {
            linkedOutputEdges.push({ regionId: rd.id, edge: 'in', origInBeatTime: inBeat, origOutBeatTime: outBeat })
          } else if (Math.abs(anchor.time - outBeat) < LINK_TOL) {
            linkedOutputEdges.push({ regionId: rd.id, edge: 'out', origInBeatTime: inBeat, origOutBeatTime: outBeat })
          }
        }
        if (drag.kind === 'anchor') drag.linkedOutputEdges = linkedOutputEdges
      }
      intents.push({ kind: 'dragStart' })
      return intents
    }

    // 2b) Warp-line hit — arms a combined anchor drag with BOTH partners
    //     captured. pointerDown does NOT emit selection — the pair-select
    //     fires on pointerUp ONLY when the gesture stays under the click
    //     threshold (i.e. it was a click, not a drag).
    //     Defensive: only arm when both partners exist.
    if (hit && hit.kind === 'warp-line') {
      const id = hit.id as number
      const inAnchor = snap.anchors.find(a => a.id === id)
      const beatAnchor = snap.beatAnchors.find(a => a.id === id)
      if (inAnchor && beatAnchor) {
        const additive = e.shiftKey || e.metaKey || e.ctrlKey
        const pendingSelect: PendingSelect[] = [
          { kind: 'anchorSelect', id, additive },
          { kind: 'beatAnchorSelect', id, additive },
        ]
        // Build a combined-anchor drag that includes BOTH partners regardless
        // of the live selection (the user just grabbed the pair; even if the
        // selection slice hasn't received the new ids yet, we know they
        // belong in this drag).
        const dragState = buildAnchorDrag(
          snap, id, 'input', inAnchor.time,
          true, true,
          e.clientX, e.clientY,
          pendingSelect,
        )
        // Force-include both partners in the capture maps even when nothing
        // else was selected.
        if (!dragState.origInputTimes!.has(id)) dragState.origInputTimes!.set(id, inAnchor.time)
        if (!dragState.origBeatTimes!.has(id)) dragState.origBeatTimes!.set(id, beatAnchor.time)
        dragState.isPair = true
        drag = dragState
        intents.push({ kind: 'dragStart' })
        return intents
      }
      // No partner: fall through; the hit is effectively inert.
    }

    // 3) Region edge hit — select deferred to pointerUp.
    if (hit && hit.kind === 'region-edge') {
      const id = hit.id as string
      const edge = hit.edge as 'in' | 'out'
      const isOutput = Boolean(hit.isOutput)
      const list = isOutput ? (snap.regionsOutput ?? snap.regions) : snap.regions
      const r = list.find(rr => rr.id === id)
      if (r) {
        // For output-space edge drags, capture all beat anchors + their
        // original times for Slice B live rescale/translate preview.
        let liveBeatAnchors: Anchor[] | undefined
        let origBeatAnchorTimes: Map<number, number> | undefined
        if (isOutput) {
          liveBeatAnchors = [...snap.beatAnchors]
          origBeatAnchorTimes = new Map()
          for (const a of snap.beatAnchors) origBeatAnchorTimes.set(a.id, a.time)
        }
        drag = {
          kind: 'region-edge',
          id,
          edge,
          isOutput,
          origIn: r.inPoint,
          origOut: r.outPoint,
          liveRegion: null,
          startClientX: e.clientX,
          startClientY: e.clientY,
          moved: false,
          pendingSelect: [{ kind: 'regionSelect', id }],
          lastAltKey: e.altKey,
          liveBeatAnchors,
          origBeatAnchorTimes,
        }
        intents.push({ kind: 'dragStart' })
      }
      return intents
    }

    // 4) Region body hit — combined-selection drag with select deferred to
    //    pointerUp. When the clicked region is in the current selection,
    //    capture every selected REGION and every selected ANCHOR (both
    //    spaces). When NOT, capture ONLY the clicked region (single-object
    //    drag — other selected regions stay put).
    if (hit && hit.kind === 'region') {
      const id = hit.id as string
      const isOutput = Boolean(hit.isOutput)
      const list = isOutput ? (snap.regionsOutput ?? snap.regions) : snap.regions
      const r = list.find(rr => rr.id === id)
      if (r) {
        // Space-aware: clipout drag checks selectedClipoutIds; clipin checks selectedClipinIds.
        const spaceClipIds = isOutput ? snap.selectedClipoutIds : snap.selectedClipinIds
        const wasSelected = spaceClipIds.has(id)
        drag = buildRegionDrag(
          snap, id, isOutput, r, x, wasSelected,
          e.clientX, e.clientY,
          [{ kind: 'regionSelect', id }],
        )
        if (drag.kind === 'region-move') drag.lastAltKey = e.altKey
        intents.push({ kind: 'dragStart' })
      }
      return intents
    }

    // 5) Alt or middle-button → pan
    if (e.altKey || e.button === 1) {
      drag = { kind: 'pan', startClientX: e.clientX, startView: snap.view }
      return intents
    }

    // 6) Ruler hit (time/beat)
    const trUnder = snap.tracks.find(t => y >= t.y && y < t.y + t.h)
    if (trUnder && (trUnder.id === 'time' || trUnder.id === 'beat')) {
      const space: 'input' | 'output' = trUnder.id === 'beat' ? 'output' : 'input'
      const MAX = space === 'output' ? snap.outputDuration : snap.duration
      const t = Math.max(0, Math.min(MAX, pxToT(x, snap)))
      if (space === 'output') intents.push({ kind: 'seekBeat', time: t })
      else intents.push({ kind: 'seek', time: t })
      drag = { kind: 'seek', space }
      return intents
    }

    // 7) Empty area — arm lasso
    const additive = e.ctrlKey || e.metaKey
    drag = {
      kind: 'lasso',
      startX: x,
      startY: y,
      curX: x,
      curY: y,
      additive,
      initialOrigAnchorIds: additive ? new Set(snap.selectedOrigAnchorIds) : new Set(),
      initialBeatAnchorIds: additive ? new Set(snap.selectedBeatAnchorIds) : new Set(),
      initialClipinIds: additive ? new Set(snap.selectedClipinIds) : new Set(),
      initialClipoutIds: additive ? new Set(snap.selectedClipoutIds) : new Set(),
      initialSceneTimes: additive ? new Set(snap.selectedSceneTimes) : new Set(),
      active: false,
      lassoOrigAnchorIds: new Set(),
      lassoBeatAnchorIds: new Set(),
      lassoClipinIds: new Set(),
      lassoClipoutIds: new Set(),
      lassoSceneTimes: new Set(),
    }
    return intents
  }

  function pointerMove(e: PointerEventLike, snap: Snapshot): Intent[] {
    const intents: Intent[] = []
    const x = mx(e)
    const y = my(e)
    const W = snap.canvas.width || 1
    const viewSpan = snap.view.end - snap.view.start

    // ── Hover (no active drag) ───────────────────────────────
    if (!drag) {
      const hit = hitAt(snap.hits, x, y) as Record<string, unknown> | null
      const newAnchorHov = hit?.kind === 'anchor' ? (hit.id as number) : null
      const newRegionHov = (hit?.kind === 'region' || hit?.kind === 'region-edge')
        ? (hit.id as string) : null
      const newSceneHov = hit?.kind === 'scene' ? (hit.time as number) : null
      const newWarpLineHov = hit?.kind === 'warp-line' ? (hit.id as number) : null

      intents.push({ kind: 'pubHoveredAnchor', id: newAnchorHov })
      intents.push({ kind: 'pubHoveredRegion', id: newRegionHov })
      intents.push({ kind: 'pubHoveredScene', time: newSceneHov })
      intents.push({ kind: 'pubHoveredWarpLine', id: newWarpLineHov })

      // Thumbnail hover popup for scenes — compute screen-space position
      if (newSceneHov !== null) {
        const trScenes = snap.tracks.find(t => t.id === 'scenes')
        const xPct = (newSceneHov - snap.view.start) / Math.max(0.0001, viewSpan)
        const clientX = e.canvasRect.left + xPct * W
        const clientY = e.canvasRect.top + (trScenes?.y ?? 0)
        intents.push({ kind: 'thumbnailHover', payload: { time: newSceneHov, x: clientX, y: clientY } })
      } else {
        intents.push({ kind: 'thumbnailHover', payload: null })
      }

      // Cursor based on hit kind
      let cursor: '' | 'grab' | 'grabbing' | 'ew-resize' | 'pointer' = ''
      if (hit?.kind === 'region-edge') cursor = 'ew-resize'
      else if (hit?.kind === 'anchor' || hit?.kind === 'region' || hit?.kind === 'warp-line') cursor = 'grab'
      else if (hit?.kind === 'scene') cursor = 'pointer'
      intents.push({ kind: 'cursor', cursor })
      intents.push({ kind: 'redraw' })
      return intents
    }

    // ── Active drag — publish modifier keys + cursor up front ───────────────
    intents.push({ kind: 'pubModifierKeys', alt: e.altKey, shift: e.shiftKey })

    // Shift held mid-drag: cancel the current drag (revert any live motion) and
    // convert to a pan so the timeline follows the pointer instead of moving objects.
    if (e.shiftKey && drag.kind !== 'pan' && drag.kind !== 'minimap' && drag.kind !== 'seek') {
      if (drag.kind === 'anchor' || drag.kind === 'region-edge' || drag.kind === 'region-move') {
        intents.push({ kind: 'dragCancel' })
        intents.push({ kind: 'pubClearGesture' })
      }
      drag = { kind: 'pan', startClientX: e.clientX, startView: snap.view }
      // Fall through to the pan handler below.
    }

    if (drag.kind === 'anchor' || drag.kind === 'region-move') {
      intents.push({ kind: 'cursor', cursor: 'grabbing' })
    } else if (drag.kind === 'region-edge') {
      intents.push({ kind: 'cursor', cursor: 'ew-resize' })
    } else {
      intents.push({ kind: 'cursor', cursor: '' })
    }

    // ── pan ──────────────────────────────────────────────────
    if (drag.kind === 'pan') {
      const nextView = dragPan(drag.startView, W, e.clientX - drag.startClientX, snap.maxDuration)
      intents.push({ kind: 'viewChange', view: nextView })
      return intents
    }

    // ── minimap (drag) ───────────────────────────────────────
    if (drag.kind === 'minimap') {
      const nextView = minimapRecenter(snap.view, x, W, snap.maxDuration)
      intents.push({ kind: 'viewChange', view: nextView })
      return intents
    }

    // ── seek ────────────────────────────────────────────────
    if (drag.kind === 'seek') {
      const MAX = drag.space === 'output' ? snap.outputDuration : snap.duration
      const t = Math.max(0, Math.min(MAX, pxToT(x, snap)))
      intents.push({ kind: 'pubScrubTime', time: t })
      if (drag.space === 'output') intents.push({ kind: 'seekBeat', time: t })
      else intents.push({ kind: 'seek', time: t })
      return intents
    }

    // ── anchor ──────────────────────────────────────────────
    if (drag.kind === 'anchor') {
      return [...intents, ...handleAnchorMove(drag, e, snap)]
    }

    // ── region-edge ─────────────────────────────────────────
    if (drag.kind === 'region-edge') {
      return [...intents, ...handleRegionEdgeMove(drag, e, snap)]
    }

    // ── region-move ─────────────────────────────────────────
    if (drag.kind === 'region-move') {
      return [...intents, ...handleRegionMoveMove(drag, e, snap)]
    }

    // ── lasso ───────────────────────────────────────────────
    if (drag.kind === 'lasso') {
      const dx = x - drag.startX
      const dy = y - drag.startY
      if (!drag.active && dx * dx + dy * dy < 16) return []
      if (!drag.active) {
        drag.active = true
        drag.lassoOrigAnchorIds = new Set(drag.initialOrigAnchorIds)
        drag.lassoBeatAnchorIds = new Set(drag.initialBeatAnchorIds)
        drag.lassoClipinIds = new Set(drag.initialClipinIds)
        drag.lassoClipoutIds = new Set(drag.initialClipoutIds)
        drag.lassoSceneTimes = new Set(drag.initialSceneTimes)
        intents.push({
          kind: 'pubLasso',
          clipinIds: drag.lassoClipinIds,
          clipoutIds: drag.lassoClipoutIds,
          origAnchorIds: drag.lassoOrigAnchorIds,
          beatAnchorIds: drag.lassoBeatAnchorIds,
          sceneTimes: drag.lassoSceneTimes,
        })
      }
      drag.curX = x
      drag.curY = y

      const loY = Math.min(drag.startY, y), hiY = Math.max(drag.startY, y)
      const covered = snap.tracks.filter(t => t.y < hiY && t.y + t.h > loY)
      // Separate track coverage for input vs output anchor rows.
      const wantIn = covered.some(t => t.id === 'markerin' || t.id === 'warp')
      const wantOut = covered.some(t => t.id === 'markerout' || t.id === 'warp')
      // Per-space clip coverage: clipin and clipout are independent tracks.
      const wantClipin  = covered.some(t => t.id === 'clipin')
      const wantClipout = covered.some(t => t.id === 'clipout')
      const wantScenes = covered.some(t => t.id === 'scenes')

      const loT = pxToT(Math.max(Math.min(drag.startX, x), 0), snap)
      const hiT = pxToT(Math.min(Math.max(drag.startX, x), W), snap)

      {
        // Orig-space anchors: only when lasso covers the markerin or warp track.
        const ids = new Set(drag.initialOrigAnchorIds)
        if (wantIn) for (const a of snap.anchors) if (a.time >= loT && a.time <= hiT) ids.add(a.id)
        drag.lassoOrigAnchorIds = ids
      }
      {
        // Beat-space anchors: only when lasso covers the markerout or warp track.
        const ids = new Set(drag.initialBeatAnchorIds)
        if (wantOut) for (const a of snap.beatAnchors) if (a.time >= loT && a.time <= hiT) ids.add(a.id)
        drag.lassoBeatAnchorIds = ids
      }
      {
        // Clipin regions: only when lasso covers the clipin track.
        const ids = new Set(drag.initialClipinIds)
        if (wantClipin) for (const r of snap.regions) if (r.outPoint > loT && r.inPoint < hiT) ids.add(r.id)
        drag.lassoClipinIds = ids
      }
      {
        // Clipout regions: only when lasso covers the clipout track.
        // Uses regionsOutput bounds for time comparison (output-space positions).
        const ids = new Set(drag.initialClipoutIds)
        if (wantClipout) {
          const outList = snap.regionsOutput ?? snap.regions
          for (const r of outList) if (r.outPoint > loT && r.inPoint < hiT) ids.add(r.id)
        }
        drag.lassoClipoutIds = ids
      }
      {
        const times = new Set(drag.initialSceneTimes)
        if (wantScenes) for (const t of snap.scenes) if (t >= loT && t <= hiT) times.add(t)
        drag.lassoSceneTimes = times
      }
      intents.push({
        kind: 'pubLasso',
        clipinIds: drag.lassoClipinIds,
        clipoutIds: drag.lassoClipoutIds,
        origAnchorIds: drag.lassoOrigAnchorIds,
        beatAnchorIds: drag.lassoBeatAnchorIds,
        sceneTimes: drag.lassoSceneTimes,
      })
      intents.push({ kind: 'redraw' })
      return intents
    }

    return intents
  }

  function pointerUp(snap: Snapshot): Intent[] {
    const intents: Intent[] = []
    const d = drag
    if (d) {
      if (d.kind === 'anchor') {
        if (!d.moved) {
          // Click (no drag): flush the deferred selection intents and emit
          // no move commits. The drag was armed at pointerDown but the user
          // released before crossing the threshold.
          for (const ps of d.pendingSelect) intents.push(ps)
        } else {
          // Combined-selection anchor drag. The drag can move anchors in
          // BOTH spaces and clipping regions. Emit anchorsChanged only when
          // any captured input anchor actually moved; same for beatAnchors;
          // emit regionMove per captured region whose bounds changed.
          const inputChanged = d.liveAnchors.some(a => {
            const orig = snap.anchors.find(s => s.id === a.id)
            return !orig || orig.time !== a.time
          })
          const beatChanged = d.liveBeatAnchors.some(a => {
            const orig = snap.beatAnchors.find(s => s.id === a.id)
            return !orig || orig.time !== a.time
          })
          if (inputChanged && d.origInputTimes && d.origInputTimes.size > 0) {
            intents.push({ kind: 'anchorsChanged', next: d.liveAnchors })
          }
          if (beatChanged && d.origBeatTimes && d.origBeatTimes.size > 0) {
            intents.push({ kind: 'beatAnchorsChanged', next: d.liveBeatAnchors })
          }
          if (d.liveRegionBounds) {
            for (const lr of d.liveRegionBounds) {
              const orig = d.origRegionBounds?.get(lr.id)
              if (!orig || (orig.inPoint === lr.inPoint && orig.outPoint === lr.outPoint)) continue
              intents.push({
                kind: 'regionMove',
                id: lr.id,
                inPoint: lr.inPoint,
                outPoint: lr.outPoint,
                isOutput: false,
                altKey: false,
              })
            }
          }
          // Bug G/H commit: emit final regionResize (isOutput) for any
          // output-linked region edges so beat bounds are persisted.
          if (d.space === 'output' && d.linkedOutputEdges && d.linkedOutputEdges.length > 0) {
            // The dragged beat anchor's final position is in liveBeatAnchors.
            const finalBeatT = d.liveBeatAnchors.find(a => a.id === d.id)?.time ?? d.origTime
            for (const le of d.linkedOutputEdges) {
              const newIn  = le.edge === 'in'  ? finalBeatT : le.origInBeatTime
              const newOut = le.edge === 'out' ? finalBeatT : le.origOutBeatTime
              // Only emit if the anchor actually moved.
              if (Math.abs(newIn - le.origInBeatTime) < 1e-9 && Math.abs(newOut - le.origOutBeatTime) < 1e-9) continue
              intents.push({ kind: 'regionResize', id: le.regionId, inPoint: newIn, outPoint: newOut, isOutput: true, altKey: false })
            }
          }
        }
      } else if (d.kind === 'region-edge') {
        if (!d.moved) {
          for (const ps of d.pendingSelect) intents.push(ps)
        } else if (d.liveRegion) {
          intents.push({
            kind: 'regionResize',
            id: d.liveRegion.id,
            inPoint: d.liveRegion.inPoint,
            outPoint: d.liveRegion.outPoint,
            isOutput: d.isOutput,
            altKey: d.lastAltKey,
          })
        }
      } else if (d.kind === 'region-move') {
        if (!d.moved) {
          for (const ps of d.pendingSelect) intents.push(ps)
        } else {
        // Primary region commit (always for the dragged region when its
        // liveRegion was published).
        if (d.liveRegion) {
          intents.push({
            kind: 'regionMove',
            id: d.liveRegion.id,
            inPoint: d.liveRegion.inPoint,
            outPoint: d.liveRegion.outPoint,
            isOutput: d.isOutput,
            altKey: d.lastAltKey,
          })
        }
        // Multi-select: every OTHER captured region also commits.
        if (d.liveBoundsList) {
          for (const lr of d.liveBoundsList) {
            if (lr.id === d.id) continue
            intents.push({
              kind: 'regionMove',
              id: lr.id,
              inPoint: lr.inPoint,
              outPoint: lr.outPoint,
              isOutput: d.isOutput,
              altKey: d.lastAltKey,
            })
          }
        }
        // Combined drag: captured anchors commit too (input-space only).
        // Output-space (clipout) pans handle anchor translation inside commitClipoutPan.
        if (!d.isOutput && d.liveAnchors && d.origInputAnchorTimes && d.origInputAnchorTimes.size > 0) {
          const inputChanged = d.liveAnchors.some(a => {
            const orig = snap.anchors.find(s => s.id === a.id)
            return !orig || orig.time !== a.time
          })
          if (inputChanged) {
            intents.push({ kind: 'anchorsChanged', next: d.liveAnchors })
          }
        }
        if (!d.isOutput && d.liveBeatAnchors && d.origBeatAnchorTimes && d.origBeatAnchorTimes.size > 0) {
          const beatChanged = d.liveBeatAnchors.some(a => {
            const orig = snap.beatAnchors.find(s => s.id === a.id)
            return !orig || orig.time !== a.time
          })
          if (beatChanged) {
            intents.push({ kind: 'beatAnchorsChanged', next: d.liveBeatAnchors })
          }
        }
        }
      } else if (d.kind === 'lasso') {
        if (d.active) {
          intents.push({ kind: 'connectorSelectionChange', origIds: d.lassoOrigAnchorIds, beatIds: d.lassoBeatAnchorIds })
          intents.push({ kind: 'clipsSelectionChange', clipinIds: d.lassoClipinIds, clipoutIds: d.lassoClipoutIds })
          intents.push({ kind: 'scenesSelectionChange', times: d.lassoSceneTimes })
        } else {
          // Click without drag in empty area:
          //  - If something was selected at click time (and no modifier), this
          //    click clears the selection and the playhead STAYS where it is.
          //  - If nothing was selected, the click seeks the playhead.
          //  - Ctrl/Cmd held (additive) always seeks and never clears selection.
          const hadSelection = !d.additive && (
            snap.selectedOrigAnchorIds.size > 0 ||
            snap.selectedBeatAnchorIds.size > 0 ||
            snap.selectedClipinIds.size > 0 ||
            snap.selectedClipoutIds.size > 0 ||
            snap.selectedSceneTimes.size > 0
          )
          if (!d.additive) intents.push({ kind: 'timelineDeselect' })
          if (d.additive || !hadSelection) {
            const t = Math.max(0, Math.min(snap.duration, pxToT(d.startX, snap)))
            intents.push({ kind: 'seek', time: t })
          }
        }
      }
      // seek / pan / minimap: no commit intents
    }
    // dragEnd fires for content-dragging kinds (anchor / region-edge /
    // region-move). Seek, pan, minimap and lasso never fired dragStart so
    // they must not fire dragEnd either.
    if (d && (d.kind === 'anchor' || d.kind === 'region-edge' || d.kind === 'region-move')) {
      intents.push({ kind: 'dragEnd' })
    }
    intents.push({ kind: 'pubClearGesture' })
    intents.push({ kind: 'cursor', cursor: '' })
    intents.push({ kind: 'redraw' })
    drag = null
    return intents
  }

  function cancel(): Intent[] {
    const d = drag
    drag = null
    const intents: Intent[] = [{ kind: 'pubClearGesture' }]
    if (d && (d.kind === 'anchor' || d.kind === 'region-edge' || d.kind === 'region-move')) {
      intents.push({ kind: 'dragCancel' })
    }
    return intents
  }

  function wheel(e: WheelEventLike, snap: Snapshot): Intent[] {
    const x = e.clientX - e.canvasRect.left
    const y = e.clientY - e.canvasRect.top
    const W = snap.canvas.width || 1
    // Wheel over the minimap always zooms, anchored at the cursor's time position.
    if (y >= 0 && y < MINIMAP_H) {
      const nextView = wheelZoom(snap.view, x, W, e.deltaY, snap.maxDuration)
      return [{ kind: 'viewChange', view: nextView }]
    }
    if (e.ctrlKey || e.metaKey) {
      const nextView = wheelZoom(snap.view, x, W, e.deltaY, snap.maxDuration)
      return [{ kind: 'viewChange', view: nextView }]
    }
    const nextView = wheelPan(snap.view, W, e.deltaX, e.deltaY, e.shiftKey, snap.maxDuration)
    return [{ kind: 'viewChange', view: nextView }]
  }

  function doubleClick(e: PointerEventLike, snap: Snapshot): Intent[] {
    const x = mx(e)
    const y = my(e)
    const hit = hitAt(snap.hits, x, y) as Record<string, unknown> | null
    if (hit?.kind === 'anchor') {
      const id = hit.id as number
      if (hit.space === 'input') return [{ kind: 'anchorDelete', id }]
      return [{ kind: 'beatAnchorDelete', id }]
    }
    if (hit?.kind === 'region') {
      return [{ kind: 'regionZoom', id: hit.id as string }]
    }
    if (hit?.kind === 'scene') {
      return [{ kind: 'sceneDelete', time: hit.time as number }]
    }
    const t = Math.max(0, pxToT(x, snap))
    const tr = snap.tracks.find(tt => y >= tt.y && y < tt.y + tt.h)
    if (!tr) return []
    if (tr.id === 'scenes') return [{ kind: 'sceneAdd', time: t }]
    if (tr.id === 'clipin') return [{ kind: 'regionAdd', time: t }]
    if (tr.id === 'markerin') return [{ kind: 'anchorAdd', time: t }]
    return []
  }

  function contextMenu(e: PointerEventLike, snap: Snapshot): Intent[] {
    const x = mx(e)
    const y = my(e)
    const hit = hitAt(snap.hits, x, y) as Record<string, unknown> | null
    if (hit?.kind === 'anchor') {
      const id = hit.id as number
      // FIX: original only handled input space; output right-clicks were silently dropped.
      if (hit.space === 'input') {
        return [{ kind: 'anchorContextMenu', id, x: e.clientX, y: e.clientY }]
      }
      return [{ kind: 'beatAnchorContextMenu', id, x: e.clientX, y: e.clientY }]
    }
    if (hit?.kind === 'region') {
      return [{ kind: 'regionContextMenu', id: hit.id as string, x: e.clientX, y: e.clientY }]
    }
    if (hit?.kind === 'scene') {
      return [{ kind: 'sceneContextMenu', time: hit.time as number, x: e.clientX, y: e.clientY }]
    }
    return [{ kind: 'timelineContextMenu', time: pxToT(x, snap), x: e.clientX, y: e.clientY }]
  }

  function keyDown(e: KeyEventLike): Intent[] {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      return [{ kind: 'timelineDelete' }]
    }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'd') {
      return [{ kind: 'timelineDeselect' }]
    }
    return []
  }

  function getDragState(): DragState | null {
    return drag
  }

  return {
    pointerDown,
    pointerMove,
    pointerUp,
    cancel,
    wheel,
    doubleClick,
    contextMenu,
    keyDown,
    getDragState,
  }
}
