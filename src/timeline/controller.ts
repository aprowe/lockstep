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
import { smallestVisibleBeatGridSec } from './model/snapTarget'
import { anchorInId, anchorOutId, regionInId, regionOutId } from '../constraints/ids'
import { findSnapCandidates, movementClosure } from '../constraints'
import type { EntityId } from '../constraints/types'
import { isClipOut } from '../constraints/ids'

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
  // Anchor group ids for the dragged space. For an input drag, we capture
  // every id in selectedOrigAnchorIds; for an output drag, selectedBeatAnchorIds.
  const spaceSelectedIds = space === 'input'
    ? snap.selectedOrigAnchorIds
    : snap.selectedBeatAnchorIds
  const anchorIdsInSelection = wasSelected ? new Set(spaceSelectedIds) : new Set<number>()
  anchorIdsInSelection.add(id)

  // capturedSpaces is for the PRIMARY anchor only. Drives intent emission:
  // only an anchorEntityMove for a space is emitted when that space is captured.
  // Follower propagation happens via the resolver's lasso:main TranslateGroup.
  const primaryInputCaptured = space === 'input'
    ? true
    : (forcePairCapture || snap.selectedOrigAnchorIds.has(id))
  const primaryBeatCaptured = space === 'output'
    ? true
    : (forcePairCapture || snap.selectedBeatAnchorIds.has(id))

  // Region group: every selected region's bounds at drag start. Empty when
  // the dragged anchor was not in the selection — a non-selected click
  // does NOT pull the existing selection into this drag.
  let regionGroupIds: ReadonlySet<string> | undefined
  let origRegionBounds: Map<string, { inPoint: number; outPoint: number }> | undefined
  const spaceClipIds = space === 'input' ? snap.selectedClipinIds : snap.selectedClipoutIds
  if (wasSelected && spaceClipIds.size > 0) {
    regionGroupIds = new Set(spaceClipIds)
    origRegionBounds = new Map()
    for (const gid of regionGroupIds) {
      const gr = snap.regions.find(rr => rr.id === gid)
      if (gr) origRegionBounds.set(gid, { inPoint: gr.inPoint, outPoint: gr.outPoint })
    }
  }

  const isPair = primaryInputCaptured && primaryBeatCaptured

  // Resolve partner's pre-drag time (input drag → beat partner; output drag → orig partner)
  let partnerOrigTime = origTime
  if (isPair) {
    if (space === 'input') {
      const ab = snap.beatAnchors.find(a => a.id === id)
      if (ab) partnerOrigTime = ab.time
    } else {
      const ai = snap.anchors.find(a => a.id === id)
      if (ai) partnerOrigTime = ai.time
    }
  }

  return {
    kind: 'anchor',
    id,
    space,
    origTime,
    startClientX,
    startClientY,
    moved: false,
    pendingSelect,
    isPair,
    groupIds: anchorIdsInSelection,
    capturedSpaces: { input: primaryInputCaptured, beat: primaryBeatCaptured },
    partnerOrigTime,
    regionGroupIds,
    origRegionBounds,
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
  }
  // Slice B: for output-space body pan, capture all beat-anchor original
  // times so handleRegionMoveMove can compute beatAnchorsChanged inline
  // when effectiveAnchorLock is true.
  if (isOutput) {
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
    startClientX,
    startClientY,
    moved: false,
    pendingSelect,
    lastAltKey: false,
    groupIds: regionGroupIds,
    origBounds,
    anchorGroupIds,
    origInputAnchorTimes,
    origBeatAnchorTimes,
  }
}

/**
 * Phase 7: convert findSnapCandidates results to time values for snap-hint rendering.
 * When the constraint graph has a SnapTarget for (entityId, field), this provides
 * the "nearby targets" list used by the canvas snap highlight layer.
 * Grid candidates (entityId='grid') carry their value directly on the candidate.
 */
function constraintSnapHints(
  snap: Snapshot,
  entityId: string,
  field: 'time' | 'in' | 'out',
  currentValue: number,
  bodyOtherEdge?: number,
): number[] | null {
  if (!snap.constraintGraph) return null
  // bodyOtherEdge: when the dragged entity is a clip body (both edges
  // moving rigidly), pass the OTHER edge's current value so evaluateSnap
  // can consider cross-edge alignment (e.g. dragged in-edge snapping to
  // another clip's out-edge). For edge-mode drags this is undefined and
  // evaluateSnap falls back to single-field comparison.
  const candidates = findSnapCandidates(snap.constraintGraph, entityId, field, currentValue, bodyOtherEdge)
  if (candidates.length === 0) return null
  return candidates.map(c => c.value)
}

/**
 * Compute whether the BPM grid is in motion for the given entity.
 * The grid is anchored at a clipout's `in`, spacing = 60/bpm. It's in
 * motion when:
 *   - any clipout is in the movement closure AND
 *   - the gesture shape would shift/scale that clipout's position or BPM.
 *
 * Per gesture:
 *   - body-pan: both clipout edges shift → grid translates → IN MOTION.
 *   - anchor: closure may include a clipout → IN MOTION if yes.
 *   - edge-resize in: clipout.in moves → IN MOTION.
 *   - edge-resize out + lockMode='bpm': bpm stays, in stays → NOT in motion.
 *   - edge-resize out + lockMode='beats': bpm changes → IN MOTION.
 */
function gridInMotionFor(
  snap: Snapshot,
  entityId: EntityId,
  gesture: 'body-pan' | 'anchor' | 'edge-in' | 'edge-out',
): boolean {
  if (!snap.constraintGraph) return false
  const closure = movementClosure(snap.constraintGraph, entityId)
  let hasClipout = false
  for (const id of closure) {
    if (isClipOut(id)) { hasClipout = true; break }
  }
  if (!hasClipout) return false
  if (gesture === 'body-pan' || gesture === 'anchor' || gesture === 'edge-in') return true
  // edge-out: only in motion when lockMode='beats' (bpm changes)
  return snap.constraintGraph.globals.lockMode === 'beats'
}

/**
 * Compute the beat-grid params for a snapStart intent.
 * Returns undefined when no grid applies (input space, body-pan, or
 * gridInMotion for the gesture shape).
 */
function computeGridForSnap(
  snap: Snapshot,
  entityId: EntityId,
  gesture: 'body-pan' | 'anchor' | 'edge-in' | 'edge-out',
): { interval: number; offset: number } | undefined {
  if (!snap.snapInterval || snap.snapInterval <= 0) return undefined
  if (gridInMotionFor(snap, entityId, gesture)) return undefined
  const viewSpan = snap.view.end - snap.view.start
  const W = snap.canvas.width || 1
  const minVisible = smallestVisibleBeatGridSec(viewSpan, W, snap.bpm)
  if (!Number.isFinite(minVisible)) return undefined
  return {
    interval: Math.max(snap.snapInterval, minVisible),
    offset:   snap.snapOffset ?? 0,
  }
}

/**
 * Handle pointerMove for an active anchor drag.
 * Computes intent payloads inline from `origTime + delta` against the snapshot.
 * No live* mirror state is mutated — the controller is intent-pure.
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
  let snapped = raw
  const isPairDrag = drag.isPair
  if (isPairDrag) {
    const clientDx = e.clientX - drag.startClientX
    const rawDelta = (clientDx / W) * viewSpan
    // For pair drags, drag.origTime is the dragged-space pre-drag position
    // and drag.partnerOrigTime is the partner-space pre-drag position.
    const draggedInputT = drag.space === 'input' ? drag.origTime : drag.partnerOrigTime
    const draggedBeatT  = drag.space === 'output' ? drag.origTime : drag.partnerOrigTime
    const rawInputSubject = draggedInputT + rawDelta
    const rawBeatSubject  = draggedBeatT  + rawDelta

    // Resolver snaps via SnapTarget installed at pointerDown.
    // Controller shows raw position (1-frame lag acceptable).
    const inputHints = constraintSnapHints(snap, anchorInId(drag.id), 'time', rawInputSubject) ?? []
    const outputHints = constraintSnapHints(snap, anchorOutId(drag.id), 'time', rawBeatSubject) ?? []
    const chosenHintSpace: Space = inputHints.length > 0 ? 'input' : 'output'
    const chosenHintTargets = inputHints.length > 0 ? inputHints : outputHints
    snapped = drag.origTime + rawDelta
    intents.push({ kind: 'pubSnapHints', space: chosenHintSpace, times: chosenHintTargets })
  } else {
    // Resolver snaps via SnapTarget installed at pointerDown.
    snapped = raw
    const entityIdForSnap = drag.space === 'input' ? anchorInId(drag.id) : anchorOutId(drag.id)
    const hints = constraintSnapHints(snap, entityIdForSnap, 'time', raw) ?? []
    intents.push({ kind: 'pubSnapHints', space: drag.space, times: hints })
  }
  intents.push({ kind: 'pubDragTime', space: drag.space, time: snapped })

  const t = Math.max(0, snapped)
  const delta = t - drag.origTime
  drag.lastTime = t

  if (drag.moved) {
    // Emit single-entity anchorEntityMove for the PRIMARY grabbed anchor's
    // captured spaces. Followers propagate via lasso:main TranslateGroup.
    // We derive the new times directly from origTime + delta — for pair
    // drags, both spaces translate by the same delta from their respective
    // pre-drag positions stored on drag.partnerOrigTime.
    const origInputT = drag.space === 'input' ? drag.origTime : drag.partnerOrigTime
    const origBeatT  = drag.space === 'output' ? drag.origTime : drag.partnerOrigTime

    if (drag.capturedSpaces.input) {
      const newT = Math.max(0, origInputT + delta)
      intents.push({ kind: 'anchorEntityMove', entityId: anchorInId(drag.id), time: newT })
    }
    if (drag.capturedSpaces.beat) {
      const newT = Math.max(0, origBeatT + delta)
      intents.push({ kind: 'anchorEntityMove', entityId: anchorOutId(drag.id), time: newT })
    }

    // Combined anchor+region drag: emit regionEntityMove for the PRIMARY
    // grabbed region. Follower regions propagate via lasso:main.
    if (drag.regionGroupIds && drag.origRegionBounds && drag.regionGroupIds.size > 0) {
      // Pick the same primary order the previous implementation used: first
      // entry in the group iteration order (insertion order of the Set).
      const firstId = drag.regionGroupIds.values().next().value as string | undefined
      if (firstId !== undefined) {
        const orig = drag.origRegionBounds.get(firstId)
        if (orig) {
          const MAX = snap.duration
          const gDur = orig.outPoint - orig.inPoint
          const gIn = Math.max(0, Math.min(MAX - gDur, orig.inPoint + delta))
          const primaryDelta = gIn - orig.inPoint
          intents.push({ kind: 'regionEntityMove', id: firstId, delta: primaryDelta, isOutput: false, altKey: false })
        }
      }
    }

    // For output-space drags with linked region edges, emit regionResize
    // (isOutput) so the clipout edge follows the anchor continuously.
    if (drag.space === 'output' && drag.linkedOutputEdges && drag.linkedOutputEdges.length > 0) {
      const liveBeatT = origBeatT + delta
      for (const le of drag.linkedOutputEdges) {
        const newIn  = le.edge === 'in'  ? liveBeatT : le.origInBeatTime
        const newOut = le.edge === 'out' ? liveBeatT : le.origOutBeatTime
        intents.push({ kind: 'regionResize', id: le.regionId, inPoint: newIn, outPoint: newOut, isOutput: true, altKey: false })
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
 * Computes new edge position + Slice-B beat-anchor rescale inline. No
 * live* mirror state is mutated — only `moved` and `lastAltKey`.
 */
function handleRegionEdgeMove(
  drag: Extract<DragState, { kind: 'region-edge' }>,
  e: PointerEventLike,
  snap: Snapshot,
): Intent[] {
  const intents: Intent[] = []
  const x = e.clientX - e.canvasRect.left
  markMovedIfBeyondThreshold(drag, e)
  drag.lastAltKey = e.altKey
  const raw = pxToT(x, snap)
  const MAX = drag.isOutput ? snap.outputDuration : snap.duration
  const space = drag.isOutput ? 'output' : 'input'
  const edgeEntityId = drag.isOutput ? regionOutId(drag.id) : regionInId(drag.id)
  const snapped = raw
  const hints = constraintSnapHints(snap, edgeEntityId, drag.edge, raw) ?? []
  intents.push({ kind: 'pubSnapHints', space, times: hints })
  intents.push({ kind: 'pubDragTime', space, time: snapped })

  // Compute new edge bounds inline.
  let newIn: number, newOut: number
  if (drag.edge === 'in') {
    newIn = Math.max(0, Math.min(drag.origOut - 0.1, snapped))
    newOut = drag.origOut
  } else {
    newIn = drag.origIn
    newOut = Math.max(drag.origIn + 0.1, Math.min(MAX, snapped))
  }
  drag.lastIn = newIn
  drag.lastOut = newOut

  if (drag.moved) {
    intents.push({
      kind: 'regionResize',
      id: drag.id,
      inPoint: newIn,
      outPoint: newOut,
      isOutput: drag.isOutput,
      altKey: drag.lastAltKey,
    })
    // Slice B: rescale beat anchors that lay inside [origIn, origOut] when
    // effectiveAnchorLock && lock='beats'. Otherwise the slice's beatAnchors
    // remain authoritative (no override needed).
    if (drag.isOutput && drag.origBeatAnchorTimes) {
      const effectiveAnchorLock = (snap.clipAnchorLock ?? false) !== drag.lastAltKey // XOR
      const shouldRescale = effectiveAnchorLock && snap.clipLock === 'beats'
      if (shouldRescale) {
        const oldLength = drag.origOut - drag.origIn
        const newLength = newOut - newIn
        if (oldLength > 1e-9 && newLength > 1e-9) {
          const scaleFactor = newLength / oldLength
          const origMap = drag.origBeatAnchorTimes
          const origIn = drag.origIn
          const origOut = drag.origOut
          const next: Anchor[] = []
          let changed = false
          for (const a of snap.beatAnchors) {
            const orig = origMap.get(a.id) ?? a.time
            const inside = orig >= origIn && orig <= origOut
            const nextTime = inside ? newIn + (orig - origIn) * scaleFactor : orig
            if (Math.abs(nextTime - orig) > 1e-9) changed = true
            next.push({ ...a, time: nextTime })
          }
          if (changed) intents.push({ kind: 'beatAnchorsChanged', next })
        }
      }
    }
  }
  intents.push({ kind: 'redraw' })
  return intents
}

/**
 * Handle pointerMove for an active region-move (body pan) drag.
 * Computes payloads inline from origIn/origOut + delta. No live* mirror state.
 */
function handleRegionMoveMove(
  drag: Extract<DragState, { kind: 'region-move' }>,
  e: PointerEventLike,
  snap: Snapshot,
): Intent[] {
  const intents: Intent[] = []
  const x = e.clientX - e.canvasRect.left
  markMovedIfBeyondThreshold(drag, e)
  drag.lastAltKey = e.altKey
  const raw = pxToT(x, snap)
  const MAX = drag.isOutput ? snap.outputDuration : snap.duration
  const dur = drag.origOut - drag.origIn
  const space = drag.isOutput ? 'output' : 'input'
  const moveEntityId = drag.isOutput ? regionOutId(drag.id) : regionInId(drag.id)
  const rawIn = drag.origIn + (raw - pxToT(drag.anchorX, snap))
  const rawOut = rawIn + dur
  const newIn = Math.max(0, Math.min(MAX - dur, rawIn))
  const newOut = newIn + dur
  // Body-pan hints: pass the OTHER edge as bodyOtherEdge so evaluateSnap
  // considers cross-edge alignment.
  const inHints = constraintSnapHints(snap, moveEntityId, 'in', rawIn, rawOut) ?? []
  const outHints = constraintSnapHints(snap, moveEntityId, 'out', rawOut, rawIn) ?? []
  const hints = [...new Set([...inHints, ...outHints])]
  intents.push({ kind: 'pubSnapHints', space, times: hints })
  intents.push({ kind: 'pubDragTime', space, time: newIn })

  const deltaT = newIn - drag.origIn
  drag.lastDelta = deltaT

  if (drag.moved) {
    intents.push({
      kind: 'regionEntityMove',
      id: drag.id,
      delta: deltaT,
      isOutput: drag.isOutput,
      altKey: drag.lastAltKey,
    })
    // Combined region+anchor drag: emit anchorEntityMove for the primary
    // anchor in each space. Follower anchors propagate via lasso:main.
    // Input-space only — output-space pans handle anchor translation in commitClipoutPan.
    if (!drag.isOutput && drag.origInputAnchorTimes && drag.origInputAnchorTimes.size > 0) {
      const firstInputId = drag.origInputAnchorTimes.keys().next().value as number
      const orig = drag.origInputAnchorTimes.get(firstInputId)!
      const newT = Math.max(0, orig + deltaT)
      intents.push({ kind: 'anchorEntityMove', entityId: anchorInId(firstInputId), time: newT })
    }
    if (!drag.isOutput && drag.origBeatAnchorTimes && drag.origBeatAnchorTimes.size > 0) {
      const firstBeatId = drag.origBeatAnchorTimes.keys().next().value as number
      const orig = drag.origBeatAnchorTimes.get(firstBeatId)!
      const newT = Math.max(0, orig + deltaT)
      intents.push({ kind: 'anchorEntityMove', entityId: anchorOutId(firstBeatId), time: newT })
    }
  }
  intents.push({ kind: 'redraw' })
  return intents
}

/** Phase 7: generate snapEnd intents to remove SnapTarget constraints installed at
 *  pointerDown. Mirrors snapStart emissions exactly — same (entityId, field) pairs. */
function snapIntentsFromDrag(d: DragState | null): Intent[] {
  if (!d) return []
  if (d.kind === 'anchor') {
    if (d.isPair) {
      // Warp-line drag — both in and out anchors have SnapTargets.
      // Pair drag installs only anchor-in snap; beat partner follows via
      // the pairlink:* DirectedPair. snapEnd only needs to clear the orig.
      return [
        { kind: 'snapEnd', entityId: anchorInId(d.id), field: 'time' },
      ]
    }
    // Single-space drag — one SnapTarget for the grabbed space.
    const entityId = d.space === 'input' ? anchorInId(d.id) : anchorOutId(d.id)
    return [{ kind: 'snapEnd', entityId, field: 'time' }]
  }
  if (d.kind === 'region-edge') {
    const entityId = d.isOutput ? regionOutId(d.id) : regionInId(d.id)
    return [{ kind: 'snapEnd', entityId, field: d.edge }]
  }
  if (d.kind === 'region-move') {
    // Body-pan installs ONE body-mode SnapTarget with field='in'. Remove that.
    const entityId = d.isOutput ? regionOutId(d.id) : regionInId(d.id)
    return [{ kind: 'snapEnd', entityId, field: 'in' }]
  }
  return []
}

export function createTimelineController(): Controller {
  let drag: DragState | null = null
  /** Phase 7: true when snapStart intents were emitted at this drag's pointerDown.
   *  Only set when snap.constraintGraph was present; mirrors whether snapEnd
   *  intents should be emitted on pointerUp / cancel. */
  let snapInstalledForDrag = false

  function pointerDown(e: PointerEventLike, snap: Snapshot): Intent[] {
    // Right-click is handled by contextMenu(); do not arm any drag state.
    if (e.button === 2) return []

    // Shift-drag pans the timeline. Arm pan immediately and skip all
    // hit-testing so lasso / anchor / region drags cannot fire.
    if (e.shiftKey) {
      drag = { kind: 'pan', startClientX: e.clientX, startView: snap.view }
      return []
    }

    snapInstalledForDrag = false
    const intents: Intent[] = []
    const x = mx(e)
    const y = my(e)
    const W = snap.canvas.width || 1
    const viewSpanI = snap.view.end - snap.view.start

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
      // anchor drags moving linked clipout edges (linkedOutputEdges).
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
      // For output-space anchor drags, record any region edge whose
      // beat-space boundary (inBeatTime / outBeatTime) is coincident with
      // this anchor at drag start. These edges will follow the anchor live.
      if (space === 'output' && anchor && snap.regionDetails.length > 0) {
        const linkedOutputEdges: Extract<DragState, { kind: 'anchor' }>['linkedOutputEdges'] = []
        const LINK_TOL = 1e-4
        for (const rd of snap.regionDetails) {
          const inBeat  = rd.inBeatTime
          const outBeat = rd.outBeatTime
          if (Math.abs(anchor.time - inBeat) < LINK_TOL) {
            linkedOutputEdges.push({ regionId: rd.id, edge: 'in', origInBeatTime: inBeat, origOutBeatTime: outBeat })
          } else if (Math.abs(anchor.time - outBeat) < LINK_TOL) {
            linkedOutputEdges.push({ regionId: rd.id, edge: 'out', origInBeatTime: inBeat, origOutBeatTime: outBeat })
          }
        }
        if (drag.kind === 'anchor') drag.linkedOutputEdges = linkedOutputEdges
      }
      intents.push({ kind: 'dragStart' })
      // Phase 7: install SnapTarget for the dragged anchor (only when the
      // constraint graph is available in the snapshot).
      if (snap.constraintGraph) {
        const pxPerUnit = W / viewSpanI
        const entityId = space === 'input' ? anchorInId(id) : anchorOutId(id)
        // Input-space anchor: no beat grid. Output-space: include grid only
        // when the anchor's closure doesn't move the grid.
        const anchorGrid = space === 'output'
          ? computeGridForSnap(snap, anchorOutId(id), 'anchor')
          : undefined
        intents.push({ kind: 'snapStart', entityId, field: 'time', pxPerUnit, grid: anchorGrid, gestureRole: 'anchor' })
        snapInstalledForDrag = true
      }
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
        // Force-pair: both spaces are captured for the primary, partner's
        // beat-space pre-drag time is `beatAnchor.time`.
        dragState.capturedSpaces = { input: true, beat: true }
        dragState.partnerOrigTime = beatAnchor.time
        dragState.isPair = true
        drag = dragState
        intents.push({ kind: 'dragStart' })
        // Install SnapTarget on the ORIG anchor only. The beat partner follows
        // via the `pairlink:*` DirectedPair (Translate) installed by
        // initAnchorPair — so snap evaluates against input-space targets
        // (anchor-in cohort, clipin cohort, scenes), and the beat anchor
        // tracks whatever value the orig snaps to.
        if (snap.constraintGraph) {
          const pxPerUnit = W / viewSpanI
          intents.push({ kind: 'snapStart', entityId: anchorInId(id), field: 'time', pxPerUnit, gestureRole: 'anchor' })
          snapInstalledForDrag = true
        }
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
        // For output-space edge drags, capture beat-anchor original times
        // so handleRegionEdgeMove can compute Slice-B rescale inline.
        let origBeatAnchorTimes: Map<number, number> | undefined
        if (isOutput) {
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
          startClientX: e.clientX,
          startClientY: e.clientY,
          moved: false,
          pendingSelect: [{ kind: 'regionSelect', id }],
          lastAltKey: e.altKey,
          origBeatAnchorTimes,
        }
        intents.push({ kind: 'dragStart' })
        // Phase 7: install SnapTarget for the dragged region edge.
        // For output-space edge drags: include grid for 'out' edge only when
        // lockMode='bpm' (grid not in motion). 'in' edge always moves the grid.
        // Input-space drags: no beat grid.
        if (snap.constraintGraph) {
          const pxPerUnit = W / viewSpanI
          const entityId = isOutput ? regionOutId(id) : regionInId(id)
          const edgeGesture = edge === 'in' ? 'edge-in' : 'edge-out'
          const edgeGrid = isOutput
            ? computeGridForSnap(snap, entityId, edgeGesture)
            : undefined
          intents.push({ kind: 'snapStart', entityId, field: edge, pxPerUnit, grid: edgeGrid, gestureRole: isOutput ? 'edge' : undefined })
          snapInstalledForDrag = true
        }
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
        // Phase 7: install ONE body-mode SnapTarget for the dragged region.
        // Body mode (set by snapToSiblings when gestureRole='body') snaps the
        // body rigidly: if either edge is near a target, both edges shift by
        // the same delta — length is preserved. Previously we installed two
        // separate edge-mode SnapTargets, which fired independently and could
        // shift each edge by a different amount mid-drag (visible thrash).
        // No beat-grid snap for body pans (grid moves with the drag).
        if (snap.constraintGraph) {
          const pxPerUnit = W / viewSpanI
          const entityId = isOutput ? regionOutId(id) : regionInId(id)
          intents.push({ kind: 'snapStart', entityId, field: 'in', pxPerUnit, gestureRole: 'body' })
          snapInstalledForDrag = true
        }
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
          // Click (no drag): flush the deferred selection intents.
          for (const ps of d.pendingSelect) intents.push(ps)
        } else {
          // Single-entity commit. Use the controller's record of the last
          // computed position (d.lastTime) — populated by handleAnchorMove.
          const finalT = d.lastTime ?? d.origTime
          const delta = finalT - d.origTime
          const finalInputT = Math.max(0, (d.space === 'input' ? d.origTime : d.partnerOrigTime) + delta)
          const finalBeatT  = Math.max(0, (d.space === 'output' ? d.origTime : d.partnerOrigTime) + delta)
          if (d.capturedSpaces.input) {
            intents.push({ kind: 'anchorEntityMove', entityId: anchorInId(d.id), time: finalInputT })
          }
          if (d.capturedSpaces.beat) {
            intents.push({ kind: 'anchorEntityMove', entityId: anchorOutId(d.id), time: finalBeatT })
          }
          // Combined anchor+region drag: emit regionEntityMove for the PRIMARY
          // grabbed region using the same delta.
          if (d.regionGroupIds && d.origRegionBounds && d.regionGroupIds.size > 0) {
            const firstId = d.regionGroupIds.values().next().value as string | undefined
            if (firstId !== undefined) {
              const orig = d.origRegionBounds.get(firstId)
              if (orig) {
                const MAX = snap.duration
                const gDur = orig.outPoint - orig.inPoint
                const gIn = Math.max(0, Math.min(MAX - gDur, orig.inPoint + delta))
                intents.push({ kind: 'regionEntityMove', id: firstId, delta: gIn - orig.inPoint, isOutput: false, altKey: false })
              }
            }
          }
          // Commit: emit final regionResize (isOutput) for output-linked edges.
          if (d.space === 'output' && d.linkedOutputEdges && d.linkedOutputEdges.length > 0) {
            for (const le of d.linkedOutputEdges) {
              const newIn  = le.edge === 'in'  ? finalBeatT : le.origInBeatTime
              const newOut = le.edge === 'out' ? finalBeatT : le.origOutBeatTime
              if (Math.abs(newIn - le.origInBeatTime) < 1e-9 && Math.abs(newOut - le.origOutBeatTime) < 1e-9) continue
              intents.push({ kind: 'regionResize', id: le.regionId, inPoint: newIn, outPoint: newOut, isOutput: true, altKey: false })
            }
          }
        }
      } else if (d.kind === 'region-edge') {
        if (!d.moved) {
          for (const ps of d.pendingSelect) intents.push(ps)
        } else {
          // Re-emit final regionResize using the controller's last computed bounds.
          const newIn = d.lastIn ?? d.origIn
          const newOut = d.lastOut ?? d.origOut
          intents.push({
            kind: 'regionResize',
            id: d.id,
            inPoint: newIn,
            outPoint: newOut,
            isOutput: d.isOutput,
            altKey: d.lastAltKey,
          })
        }
      } else if (d.kind === 'region-move') {
        if (!d.moved) {
          for (const ps of d.pendingSelect) intents.push(ps)
        } else {
          const deltaT = d.lastDelta ?? 0
          intents.push({
            kind: 'regionEntityMove',
            id: d.id,
            delta: deltaT,
            isOutput: d.isOutput,
            altKey: d.lastAltKey,
          })
          // Combined drag: emit anchorEntityMove for the primary anchor in each space.
          if (!d.isOutput && d.origInputAnchorTimes && d.origInputAnchorTimes.size > 0) {
            const firstInputId = d.origInputAnchorTimes.keys().next().value as number
            const orig = d.origInputAnchorTimes.get(firstInputId)!
            intents.push({ kind: 'anchorEntityMove', entityId: anchorInId(firstInputId), time: Math.max(0, orig + deltaT) })
          }
          if (!d.isOutput && d.origBeatAnchorTimes && d.origBeatAnchorTimes.size > 0) {
            const firstBeatId = d.origBeatAnchorTimes.keys().next().value as number
            const orig = d.origBeatAnchorTimes.get(firstBeatId)!
            intents.push({ kind: 'anchorEntityMove', entityId: anchorOutId(firstBeatId), time: Math.max(0, orig + deltaT) })
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
    // Phase 7: remove SnapTarget constraints installed at pointerDown.
    if (snapInstalledForDrag) {
      for (const si of snapIntentsFromDrag(d)) intents.push(si)
      snapInstalledForDrag = false
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
    // Phase 7: remove SnapTarget constraints installed at pointerDown.
    if (snapInstalledForDrag) {
      for (const si of snapIntentsFromDrag(d)) intents.push(si)
      snapInstalledForDrag = false
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
