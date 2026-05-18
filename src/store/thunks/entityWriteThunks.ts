/**
 * Phase 1 entity-write thunks.
 *
 * Translates "logical" slice-shaped position writes into constraint-graph ops
 * dispatched via `constraintSlice.applyOp`. These thunks replace the old
 * slice reducers that wrote positions directly (`setOrigAnchorsFromTimeline`,
 * `moveOrigAnchor`, `moveBeatAnchor`, `updateRegionInOut`, `applyConformedClipout`,
 * `applyBpmEdit`, `applyBeatsEdit`, `applyLinkingEvent`, `resetRegionBoundary`).
 *
 * Each thunk is the single source of truth for one "logical edit" — call sites
 * dispatch the thunk and the thunk emits:
 *   1. The graph ops needed to update the position entities, and
 *   2. Any metadata updates to the warp / region slices (linkedBeatIds,
 *      bpm, lockedBeats, etc.) that don't live in the graph yet.
 *
 * No-op behavior with no constraints in the graph: each `applyOp` runs the
 * resolver pipeline against an empty constraint set, so the graph entities
 * mutate identically to a direct field assignment. Phase 2+ adds real
 * constraints; the call sites here don't need to change.
 */
import type { AppDispatch, RootState } from '../store'
import type { Anchor, Region } from '../../types'

import {
  addAnchor as addAnchorAction,
  removeAnchors as removeAnchorsAction,
  loadAnchors as loadAnchorsAction,
  resetBeatLinks as resetBeatLinksAction,
  setOrigAnchors as setOrigAnchorsAction,
  setBeatAnchors as setBeatAnchorsAction,
  clearAnchors as clearAnchorsAction,
  setBpm as setGlobalBpmAction,
  setAnchorLinked,
} from '../slices/warpSlice'
import {
  addRegion as addRegionAction,
  updateRegionBpm,
  updateRegionLockedBeats,
  _syncRegionPositions,
} from '../slices/regionSlice'
import {
  addAnchorOps,
  deleteAnchorOps,
  setAnchorOrigTimeOp,
  setAnchorBeatTimeOp,
  addRegionOps,
  setRegionInEdgeOp,
  setRegionOutEdgeOp,
} from '../graphBridge'
import { selectActiveRegion } from '../selectors'
import { effectiveBeatBounds } from '../../timeline/model/effectiveBounds'
import { commitLinkingEvent } from '../../timeline/model/linkingEvent'
import { clampRegionInOut } from '../../timeline/model/clampRegion'
import { OpKind } from '../../constraints'
import { anchorInId, anchorOutId, regionInId, regionOutId } from '../../constraints/ids'
import { initAnchorPair, unlinkAnchor } from '../../constraints/recipes'
import { dispatchPipelined } from '../../constraints/pipelineDispatch'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Return true when anchor `id` is linked, i.e. the beat side tracks the orig side.
 *  Reads from the slice's beatAnchors[id].linked field — absent or true means linked,
 *  false means diverged. */
function isAnchorLinked(state: RootState, id: number): boolean {
  const beat = state.warp.beatAnchors.find(a => a.id === id)
  return !beat || beat.linked !== false
}

// ─── Anchor writes ───────────────────────────────────────────────────────────

/** Add a new anchor pair at the given time (orig + beat both at `time`). */
export const applyAddAnchor =
  (payload: { id: number; time: number }) =>
  (dispatch: AppDispatch, getState: () => RootState) => {
    const { id, time } = payload
    dispatch(addAnchorAction({ id, time }))
    for (const op of addAnchorOps(id, time, time)) dispatchPipelined(dispatch, getState, op)
  }

/** Remove anchor pair(s) by ID. */
export const applyRemoveAnchors =
  (ids: number[]) =>
  (dispatch: AppDispatch, getState: () => RootState) => {
    dispatch(removeAnchorsAction(ids))
    for (const id of ids) {
      for (const op of deleteAnchorOps(id)) dispatchPipelined(dispatch, getState, op)
    }
  }

/**
 * Phase 2.5 — single-entity anchor move via the constraint graph.
 *
 * Dispatches ONE Move op for the PRIMARY grabbed entity (identified by its
 * graph entity ID string, e.g. `a7-in` or `a7-out`). The resolver's
 * lasso:main TranslateGroup propagates the implied delta to every other
 * selected entity — no manual follower iteration needed.
 *
 * Uses a Move op (delta-based) so the translate seed is explicit: the
 * resolver's TranslateGroup handler reads `delta` directly from `seedWrites`,
 * not by subtracting stale entity values.
 *
 * This replaces the whole-array `applyOrigAnchorsFromTimeline` /
 * `applyBeatAnchorsFromTimeline` path for drag commits. Bulk-load and
 * other non-drag paths still use the whole-array thunks.
 */
export const applyAnchorEntityMove =
  (payload: { entityId: string; time: number }) =>
  (dispatch: AppDispatch, getState: () => RootState) => {
    const { entityId, time } = payload
    // Determine current time from the slice (anchors are now the source of truth).
    // entityId is either `a{n}-in` (orig) or `a{n}-out` (beat).
    const state = getState()
    let currentTime: number | undefined
    let pairId: number | undefined
    const origMatch = entityId.match(/^a(\d+)-in$/)
    const beatMatch  = entityId.match(/^a(\d+)-out$/)
    if (origMatch) {
      pairId = parseInt(origMatch[1], 10)
      currentTime = state.warp.origAnchors.find(a => a.id === pairId)?.time
    } else if (beatMatch) {
      pairId = parseInt(beatMatch[1], 10)
      currentTime = state.warp.beatAnchors.find(a => a.id === pairId)?.time
    }
    if (currentTime === undefined || pairId === undefined) return
    // `time` is the absolute target. Residual = target - current; emitting this on every
    // pointerMove+pointerUp converges instead of compounding.
    const delta = time - currentTime
    if (Math.abs(delta) < 1e-12) return

    dispatchPipelined(dispatch, getState, { kind: OpKind.Move, id: entityId, delta })

    // Re-link check: when a BEAT anchor (anchor-out) is moved to exactly its
    // orig partner's time AND the pair is currently diverged, re-link it.
    // The reverse (orig dragged onto beat) is impossible while linked because
    // the pairlink propagation keeps them coupled; for a diverged pair, orig
    // moves don't touch the beat side, so this check is one-directional.
    if (beatMatch) {
      const post = getState()
      const beat = post.warp.beatAnchors.find(a => a.id === pairId)
      const orig = post.warp.origAnchors.find(a => a.id === pairId)
      if (beat && orig && beat.linked === false &&
          Math.abs(beat.time - orig.time) < 1e-6) {
        dispatch(setAnchorLinked({ id: pairId, linked: true }))
      }
    }
  }

/**
 * Phase 4 — single-entity region body move via the constraint graph.
 *
 * Accepts `{ id, delta }` — the region's slice id and the signed translate
 * from the entity's position at drag start (computed by the controller).
 * Dispatches ONE Move op (delta-based) on the clipin entity. A Move op seeds
 * BOTH `in` and `out` writes simultaneously, which is the translate signature
 * that `findTranslateDelta` recognises so the lasso:main TranslateGroup can
 * propagate to other selected clipin entities.
 *
 * Output-space body drags are routed to `commitClipoutPan` by the caller
 * (WarpView.handleRegionEntityMove) before reaching this thunk — this thunk
 * only handles input-space moves.
 *
 * Default-linked regions: the DirectedPair (Translate) constraint installed by
 * defaultLinkMirrorMiddleware propagates the clipin Move to clipout automatically
 * via the resolver. No explicit clipout Move is needed.
 *
 * Diverged regions: clipout has independent beat-space anchoring. Body drag
 * should move both clipin and clipout together. We dispatch an explicit clipout
 * Move with the same residual delta. Double-translate guard: if the lasso:main
 * TranslateGroup already contains the clipout entity, the lasso already
 * propagated the delta — skip the explicit Move to avoid double-translating.
 */
export const applyRegionEntityMove =
  (payload: { id: string; delta: number }) =>
  (dispatch: AppDispatch, getState: () => RootState) => {
    const { id, delta: cumulativeDelta } = payload
    if (Math.abs(cumulativeDelta) < 1e-12) return
    const state = getState()
    const sliceR = state.region.regions.find(r => r.id === id)
    if (!sliceR) return
    // `cumulativeDelta` is from drag start (controller emits this on every
    // pointerMove + pointerUp). Convert to a residual delta against the
    // CURRENT slice position using preDrag as the anchor so repeated
    // dispatches during a drag converge instead of compounding.
    const preR = state.drag?.preDrag?.regions.find(r => r.id === id)
    const baseIn = preR ? preR.inPoint : sliceR.inPoint
    const residual = (baseIn + cumulativeDelta) - sliceR.inPoint
    if (Math.abs(residual) < 1e-12) return
    // Move op seeds both in+out writes together — translate signature — so the
    // lasso:main TranslateGroup sees it and propagates to follower clipin entities.
    // For default-linked regions the defaultlink DirectedPair propagates the
    // delta to the clipout in the same pipeline pass. For diverged regions the
    // pair is absent and the clipout stays put — diverged means the user owns
    // the clipout's beat-space anchoring; clipin moves don't drag it.
    dispatchPipelined(dispatch, getState, { kind: OpKind.Move, id: regionInId(id), delta: residual })

    // No linking-event commit during drag. ConformVisual now handles input-side
    // conform transiently in the constraint pipeline — engages while clipin
    // sits on the orig anchor, releases when clipin moves past. Permanently
    // committing via applyLinkingEvent here would set defaultLinked=false and
    // freeze inBeatTime at the beat anchor's time, breaking the release.
  }

/**
 * Apply a moved orig anchor (drag commit on a single anchor). If the anchor is
 * linked, also move the beat side to match.
 */
export const applyMoveOrigAnchor =
  (payload: { id: number; time: number }) =>
  (dispatch: AppDispatch, getState: () => RootState) => {
    const { id, time } = payload
    const state = getState()
    dispatchPipelined(dispatch, getState, setAnchorOrigTimeOp(id, time))
    if (isAnchorLinked(state, id)) {
      dispatchPipelined(dispatch, getState, setAnchorBeatTimeOp(id, time))
    }
  }

/**
 * Apply a whole-array orig-anchor update (e.g. multi-anchor drag commit on
 * the input track). Detects adds / removes / moves and dispatches the
 * corresponding graph ops + slice ID-list updates. Linked anchors get their
 * beat side updated to match.
 *
 * Match-the-legacy-contract: also wholesale-replaces the slice's
 * `origAnchors` list and aligns `beatAnchors`. Added anchors get a linked
 * beat side seeded at the same time.
 */
export const applyOrigAnchorsFromTimeline =
  (nextOrigAnchors: readonly Anchor[]) =>
  (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState()
    const prevOrigById = new Map(state.warp.origAnchors.map(a => [a.id, a]))
    const nextIds = new Set(nextOrigAnchors.map(a => a.id))

    const added = nextOrigAnchors.filter(a => !prevOrigById.has(a.id))
    const removedIds = state.warp.origAnchors.filter(a => !nextIds.has(a.id)).map(a => a.id)

    // Drop removed anchors from slice + graph.
    if (removedIds.length > 0) {
      dispatch(removeAnchorsAction(removedIds))
      for (const id of removedIds) {
        for (const op of deleteAnchorOps(id)) dispatchPipelined(dispatch, getState, op)
      }
    }
    // Add new anchors to both slice + graph (linked beat side defaults to orig time).
    for (const a of added) {
      dispatch(addAnchorAction({ id: a.id, time: a.time }))
      for (const op of addAnchorOps(a.id, a.time, a.time)) dispatchPipelined(dispatch, getState, op)
    }
    // Move existing anchors.
    const post = getState()
    for (const a of nextOrigAnchors) {
      if (!prevOrigById.has(a.id)) continue
      const prevT = prevOrigById.get(a.id)?.time
      if (prevT !== undefined && Math.abs(prevT - a.time) < 1e-12) continue
      dispatchPipelined(dispatch, getState, setAnchorOrigTimeOp(a.id, a.time))
      if (isAnchorLinked(post, a.id)) {
        dispatchPipelined(dispatch, getState, setAnchorBeatTimeOp(a.id, a.time))
      }
    }
    // Reassert slice ordering to match the input (some callers expect this).
    dispatch(setOrigAnchorsAction([...nextOrigAnchors]))
  }

/** Move a beat anchor (unlinks it from orig by removing the pair marker). */
export const applyMoveBeatAnchor =
  (payload: { id: number; time: number }) =>
  (dispatch: AppDispatch, getState: () => RootState) => {
    dispatchPipelined(dispatch, getState, setAnchorBeatTimeOp(payload.id, payload.time))
    dispatchPipelined(dispatch, getState, unlinkAnchor(anchorInId(payload.id)))
    // Record diverged state in the slice so isAnchorLinked() can read it directly.
    dispatch(setAnchorLinked({ id: payload.id, linked: false }))
  }

/**
 * Apply a whole-array beat-anchor update. Unlinks any anchors whose beat
 * position diverged from orig.
 */
export const applyBeatAnchorsFromTimeline =
  (nextBeatAnchors: readonly Anchor[]) =>
  (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState()
    const prevBeatById = new Map(state.warp.beatAnchors.map(a => [a.id, a]))

    // Wholesale-replace the beat anchor slice list. The original
    // `setBeatAnchorsFromTimeline` reducer assigned `state.beatAnchors = payload`
    // without touching origAnchors; we preserve that contract here for
    // back-compat with timeline drag harnesses.
    dispatch(setBeatAnchorsAction([...nextBeatAnchors]))

    // Update graph entities for beat anchors. When the beat time has diverged
    // from the orig, remove the defaultlink constraint.
    for (const a of nextBeatAnchors) {
      const prev = prevBeatById.get(a.id)
      if (!prev) {
        // New: add via AddAnchor op so the entity exists for downstream reads.
        dispatchPipelined(dispatch, getState, { kind: OpKind.AddAnchor, id: `a${a.id}-out`, time: a.time })
      } else if (Math.abs(prev.time - a.time) > 1e-12) {
        // Beat time diverged — remove pair marker if still linked.
        if (isAnchorLinked(state, a.id)) {
          dispatchPipelined(dispatch, getState, unlinkAnchor(anchorInId(a.id)))
          dispatch(setAnchorLinked({ id: a.id, linked: false }))
        }
        dispatchPipelined(dispatch, getState, setAnchorBeatTimeOp(a.id, a.time))
      }
    }

    // Silence unused — prevBeatById helps reason about diff semantics if extended.
    void prevBeatById
  }

/** Reset specified anchors' beat times to the matching orig time (re-link). */
export const applyResetBeatLinks =
  (ids: number[]) =>
  (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState()
    for (const id of ids) {
      // Read orig time from slice (source of truth).
      const origAnchor = state.warp.origAnchors.find(a => a.id === id)
      if (origAnchor !== undefined) {
        dispatchPipelined(dispatch, getState, setAnchorBeatTimeOp(id, origAnchor.time))
      }
      // Re-install the defaultlink pair if it was removed.
      if (!isAnchorLinked(state, id)) {
        for (const op of initAnchorPair(anchorInId(id), anchorOutId(id))) {
          dispatchPipelined(dispatch, getState, op)
        }
        dispatch(setAnchorLinked({ id, linked: true }))
      }
    }
    dispatch(resetBeatLinksAction(ids))
  }

/** Bulk-load anchors from a saved video state. Replaces slice ID lists and
 *  rebuilds the graph entries. The constraint graph is rebuilt via setGraph
 *  by the loader (videoThunks); this thunk only handles slice + per-anchor ops. */
export const applyLoadAnchors =
  (payload: { origAnchors: Anchor[]; beatAnchors: Anchor[]; beatZeroId?: number | null }) =>
  (dispatch: AppDispatch, getState: () => RootState) => {
    // First drop any prior entities (the load path almost always calls
    // setGraph on top of this, but be defensive).
    dispatch(loadAnchorsAction(payload))
    for (const a of payload.origAnchors) {
      const beat = payload.beatAnchors.find(b => b.id === a.id)
      for (const op of addAnchorOps(a.id, a.time, beat?.time ?? a.time)) {
        dispatchPipelined(dispatch, getState, op)
      }
    }
  }

/** Clear all anchor entities + slice ID lists. */
export const applyClearAnchors =
  () =>
  (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState()
    const ids = state.warp.origAnchors.map(a => a.id)
    dispatch(clearAnchorsAction())
    for (const id of ids) {
      for (const op of deleteAnchorOps(id)) dispatchPipelined(dispatch, getState, op)
    }
  }

/** Replace the orig-anchor list wholesale (rare — used by playhead-snap import). */
export const applySetOrigAnchors =
  (anchors: readonly Anchor[]) =>
  (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState()
    const prevIds = new Set(state.warp.origAnchors.map(a => a.id))
    const nextIds = new Set(anchors.map(a => a.id))
    const removedIds = [...prevIds].filter(id => !nextIds.has(id))
    dispatch(setOrigAnchorsAction([...anchors]))
    for (const id of removedIds) {
      for (const op of deleteAnchorOps(id)) dispatchPipelined(dispatch, getState, op)
    }
    for (const a of anchors) {
      if (prevIds.has(a.id)) {
        dispatchPipelined(dispatch, getState, setAnchorOrigTimeOp(a.id, a.time))
      } else {
        dispatchPipelined(dispatch, getState, { kind: OpKind.AddAnchor, id: `a${a.id}-in`, time: a.time })
      }
    }
  }

/** Replace the beat-anchor list wholesale. */
export const applySetBeatAnchors =
  (anchors: readonly Anchor[]) =>
  (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState()
    const prevIds = new Set(state.warp.beatAnchors.map(a => a.id))
    dispatch(setBeatAnchorsAction([...anchors]))
    for (const a of anchors) {
      if (prevIds.has(a.id)) {
        dispatchPipelined(dispatch, getState, setAnchorBeatTimeOp(a.id, a.time))
      } else {
        dispatchPipelined(dispatch, getState, { kind: OpKind.AddAnchor, id: `a${a.id}-out`, time: a.time })
      }
    }
  }

// ─── Region position writes ──────────────────────────────────────────────────

/**
 * Update a region's input-space bounds (inPoint / outPoint). Diverged beat-space
 * bounds (inBeatTime/outBeatTime) are left untouched.
 */
export const applyUpdateRegionInOut =
  (payload: { id: string; inPoint: number; outPoint: number }) =>
  (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState()
    const sliceR = state.region.regions.find(r => r.id === payload.id)
    if (!sliceR) return
    const next = clampRegionInOut(
      { inPoint: sliceR.inPoint, outPoint: sliceR.outPoint },
      { inPoint: payload.inPoint, outPoint: payload.outPoint },
    )
    // Default-linked regions: the DirectedPair propagates clipin→clipout via
    // the resolver automatically when defaultLinkMirrorMiddleware is active.
    // For diverged regions, clipout has independent beat-space anchoring.
    if (next.inPoint !== sliceR.inPoint) {
      dispatchPipelined(dispatch, getState, setRegionInEdgeOp(payload.id, 'in', next.inPoint))
    }
    if (next.outPoint !== sliceR.outPoint) {
      dispatchPipelined(dispatch, getState, setRegionInEdgeOp(payload.id, 'out', next.outPoint))
    }
    // For default-linked regions, also explicitly update the clipout entity
    // so selectActiveRegion returns the new beat-space bounds.
    if (sliceR.defaultLinked) {
      if (next.inPoint !== sliceR.inBeatTime) {
        dispatchPipelined(dispatch, getState, setRegionOutEdgeOp(payload.id, 'in', next.inPoint))
      }
      if (next.outPoint !== sliceR.outBeatTime) {
        dispatchPipelined(dispatch, getState, setRegionOutEdgeOp(payload.id, 'out', next.outPoint))
      }
    }
  }

/**
 * Update a region's beat-space bounds (inBeatTime / outBeatTime). Sets
 * defaultLinked = false (user is explicitly setting beat-space bounds).
 */
export const applyUpdateRegionBeatTimes =
  (payload: { id: string; inBeatTime: number; outBeatTime: number }) =>
  (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState()
    const sliceR = state.region.regions.find(r => r.id === payload.id)
    if (!sliceR) return
    dispatchPipelined(dispatch, getState, setRegionOutEdgeOp(payload.id, 'in', payload.inBeatTime))
    dispatchPipelined(dispatch, getState, setRegionOutEdgeOp(payload.id, 'out', payload.outBeatTime))
    dispatch(_syncRegionPositions({
      [payload.id]: {
        inBeatTime:    payload.inBeatTime,
        outBeatTime:   payload.outBeatTime,
        defaultLinked: false,
      },
    }))
  }

/** Reset a region's beat-space bounds back to the default-linked state. */
export const applyResetRegionBoundary =
  (payload: { id: string }) =>
  (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState()
    const sliceR = state.region.regions.find(r => r.id === payload.id)
    if (!sliceR) return
    dispatchPipelined(dispatch, getState, setRegionOutEdgeOp(payload.id, 'in', sliceR.inPoint))
    dispatchPipelined(dispatch, getState, setRegionOutEdgeOp(payload.id, 'out', sliceR.outPoint))
    dispatch(_syncRegionPositions({
      [payload.id]: {
        inBeatTime:    sliceR.inPoint,
        outBeatTime:   sliceR.outPoint,
        defaultLinked: true,
      },
    }))
  }

/** Commit a linking-event (input-side or output-side coincidence). Writes
 *  inBeatTime/outBeatTime to the clipout entity; updates lockedBeats; bpm and
 *  lock are echoed unchanged (lock-bypass design §3.2). */
export const applyLinkingEvent =
  (payload: {
    id: string
    edge: 'in' | 'out'
    side: 'input' | 'output'
    /** Beat-time of the paired BEAT anchor at the moment of commit. */
    beatAnchorTime: number
    origAnchors?: readonly Anchor[]
    beatAnchors?: readonly Anchor[]
  }) =>
  (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState()
    const r = state.region.regions.find(rr => rr.id === payload.id)
    if (!r) return
    // Build the materialised Region using the slice positions (now the source of truth).
    const matR: Region = {
      ...r,
      inPoint:     r.inPoint,
      outPoint:    r.outPoint,
      inBeatTime:  r.inBeatTime,
      outBeatTime: r.outBeatTime,
    }
    const synth: Anchor = { id: -1, time: payload.beatAnchorTime }
    const result = commitLinkingEvent({
      region: matR,
      edge: payload.edge,
      side: payload.side,
      beatAnchor: synth,
      origAnchors: payload.origAnchors ?? [],
      beatAnchors: payload.beatAnchors ?? [],
    })
    dispatchPipelined(dispatch, getState, setRegionOutEdgeOp(payload.id, 'in', result.inBeatTime))
    dispatchPipelined(dispatch, getState, setRegionOutEdgeOp(payload.id, 'out', result.outBeatTime))
    // Linking events: lockedBeats absorbs, bpm is unchanged (lock-bypass rule).
    // Write the intended meta values AFTER the SetEdge ops so they override
    // whatever the bpmDerivedConstraint computed during the Derive phase.
    dispatchPipelined(dispatch, getState, { kind: OpKind.SetValue, id: regionOutId(payload.id), field: 'lockedBeats', value: result.lockedBeats })
    dispatchPipelined(dispatch, getState, { kind: OpKind.SetValue, id: regionOutId(payload.id), field: 'bpm', value: r.bpm })
    dispatch(updateRegionLockedBeats({ id: payload.id, lockedBeats: result.lockedBeats }))
    // Linking events explicitly diverge the clipout — record that in the slice.
    dispatch(_syncRegionPositions({
      [payload.id]: {
        inBeatTime:    result.inBeatTime,
        outBeatTime:   result.outBeatTime,
        defaultLinked: false,
      },
    }))
  }

/** Commit a conformed clipout (resize / pan / boundary conform). Writes
 *  inBeatTime/outBeatTime to clipout entity. The bpmDerivedConstraint in the
 *  graph fires in the Derive phase and updates meta[clipoutId].bpm / .lockedBeats;
 *  graphMirrorMiddleware then projects those back to region.bpm / .lockedBeats. */
export const applyConformedClipout =
  (payload: {
    id: string
    inBeatTime: number
    outBeatTime: number
    origAnchors?: readonly Anchor[]
    beatAnchors?: readonly Anchor[]
  }) =>
  (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState()
    const r = state.region.regions.find(rr => rr.id === payload.id)
    if (!r) return
    const newLength = payload.outBeatTime - payload.inBeatTime
    if (newLength <= 0) return
    // If this is the first explicit clipout edit (lockedBeats not yet tracked),
    // bootstrap it from the region's bpm so the bpmDerivedConstraint can maintain
    // the invariant after the SetEdge.
    const outId = regionOutId(payload.id)
    if (r.bpm !== undefined && r.lockedBeats === undefined) {
      dispatchPipelined(dispatch, getState, { kind: OpKind.SetValue, id: outId, field: 'lockedBeats', value: 0 })
    }
    dispatchPipelined(dispatch, getState, setRegionOutEdgeOp(payload.id, 'in',  payload.inBeatTime))
    dispatchPipelined(dispatch, getState, setRegionOutEdgeOp(payload.id, 'out', payload.outBeatTime))
    // Re-read post-SetEdge values from the slice (pipeline has written them).
    const postState = getState()
    const postR = postState.region.regions.find(rr => rr.id === payload.id)
    const syncedIn  = postR?.inBeatTime  ?? payload.inBeatTime
    const syncedOut = postR?.outBeatTime ?? payload.outBeatTime
    // Re-link check: if the post-commit clipout matches the clipin exactly
    // (in input space ↔ beat space alignment), the region is effectively
    // default-linked again. This is the "snap clipout onto its twin re-links"
    // gesture. Otherwise mark diverged.
    const matchesClipin =
      postR !== undefined &&
      Math.abs(syncedIn  - postR.inPoint)  < 1e-6 &&
      Math.abs(syncedOut - postR.outPoint) < 1e-6
    dispatch(_syncRegionPositions({
      [payload.id]: {
        inBeatTime:    syncedIn,
        outBeatTime:   syncedOut,
        defaultLinked: matchesClipin,
      },
    }))
  }

/** Direct BPM edit with grid-vs-stretch branching (design §6.4 / §11). */
export const applyBpmEdit =
  (payload: {
    id: string
    newBpm: number
    /** true = stretch model (length rescales, lockedBeats preserved).
     *  false = grid model (length stays, lockedBeats recomputes). */
    stretch: boolean
    origAnchors?: readonly Anchor[]
    beatAnchors?: readonly Anchor[]
  }) =>
  (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState()
    const r = state.region.regions.find(rr => rr.id === payload.id)
    if (!r) return
    const { inBeatTime, outBeatTime } = effectiveBeatBounds(
      r, payload.origAnchors ?? [], payload.beatAnchors ?? [],
    )
    const outId = regionOutId(payload.id)
    if (payload.stretch) {
      const oldLength = outBeatTime - inBeatTime
      const lockedBeats = r.lockedBeats ?? (oldLength * r.bpm) / 60
      const newLength = (60 * lockedBeats) / payload.newBpm
      dispatchPipelined(dispatch, getState, setRegionOutEdgeOp(payload.id, 'in', inBeatTime))
      dispatchPipelined(dispatch, getState, setRegionOutEdgeOp(payload.id, 'out', inBeatTime + newLength))
      // Override meta after SetEdge so the intended bpm/lockedBeats survive
      // the bpmDerivedConstraint's Derive pass.
      dispatchPipelined(dispatch, getState, { kind: OpKind.SetValue, id: outId, field: 'bpm',         value: payload.newBpm })
      dispatchPipelined(dispatch, getState, { kind: OpKind.SetValue, id: outId, field: 'lockedBeats', value: lockedBeats })
      dispatch(updateRegionBpm({ id: payload.id, bpm: payload.newBpm }))
      dispatch(updateRegionLockedBeats({ id: payload.id, lockedBeats }))
      // Stretch mode commits explicit beat-space bounds — record in slice.
      dispatch(_syncRegionPositions({
        [payload.id]: {
          inBeatTime,
          outBeatTime:   inBeatTime + newLength,
          defaultLinked: false,
        },
      }))
    } else {
      const length = outBeatTime - inBeatTime
      const lockedBeats = (length * payload.newBpm) / 60
      // Grid model: length stays, lockedBeats recomputes. Update meta directly.
      dispatchPipelined(dispatch, getState, { kind: OpKind.SetValue, id: outId, field: 'bpm',         value: payload.newBpm })
      dispatchPipelined(dispatch, getState, { kind: OpKind.SetValue, id: outId, field: 'lockedBeats', value: lockedBeats })
      dispatch(updateRegionBpm({ id: payload.id, bpm: payload.newBpm }))
      dispatch(updateRegionLockedBeats({ id: payload.id, lockedBeats }))
    }
    // Mirror to legacy global bpm so consumers that haven't migrated to
    // per-region (ExportDialog default, persistence default, BPM detect)
    // stay in sync with what the user just typed.
    dispatch(setGlobalBpmAction(payload.newBpm))
  }

/** Beats-count edit from the clip info panel.
 *
 *  Always changes LENGTH to accommodate the new beat count (preserves BPM).
 *  - Default-linked region: BOTH clipin AND clipout grow/shrink. The clip
 *    represents the same span in input and beat space (linked), so both
 *    boundaries reflect the new length.
 *  - Diverged region: only clipout changes. Clipin's input-space bounds
 *    are independent of the beat count.
 *
 *  `payload.stretch` is currently ignored — kept on the signature for
 *  back-compat with existing callers. */
export const applyBeatsEdit =
  (payload: {
    id: string
    newLockedBeats: number
    stretch?: boolean
    origAnchors?: readonly Anchor[]
    beatAnchors?: readonly Anchor[]
  }) =>
  (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState()
    const r = state.region.regions.find(rr => rr.id === payload.id)
    if (!r || r.bpm <= 0) return
    const outId = regionOutId(payload.id)
    const newLength = (60 * payload.newLockedBeats) / r.bpm
    if (newLength <= 0) return

    // Clipout: extend right edge from current in to in + newLength.
    const clipoutInBeat = r.inBeatTime
    dispatchPipelined(dispatch, getState,
      setRegionOutEdgeOp(payload.id, 'out', clipoutInBeat + newLength))

    if (r.defaultLinked) {
      // Linked region: also extend clipin's right edge in input space so the
      // pair stays aligned. The defaultlink DirectedPair (Translate) is for
      // full-body translates only — it does NOT propagate single-edge writes
      // — so we dispatch the clipin SetEdge explicitly here.
      dispatchPipelined(dispatch, getState,
        setRegionInEdgeOp(payload.id, 'out', r.inPoint + newLength))
    }

    // Override meta after the SetEdge ops so bpmDerivedConstraint doesn't
    // recompute lockedBeats from the new length / current bpm — we want the
    // typed lockedBeats preserved exactly.
    dispatchPipelined(dispatch, getState,
      { kind: OpKind.SetValue, id: outId, field: 'lockedBeats', value: payload.newLockedBeats })
    dispatchPipelined(dispatch, getState,
      { kind: OpKind.SetValue, id: outId, field: 'bpm', value: r.bpm })
    dispatch(updateRegionLockedBeats({ id: payload.id, lockedBeats: payload.newLockedBeats }))
  }

// ─── Region create ───────────────────────────────────────────────────────────

/** Add a new region — slice metadata + clipin/clipout entities.
 *  Ensures inBeatTime/outBeatTime are seeded to inPoint/outPoint and
 *  defaultLinked is set appropriately if not supplied by the caller. */
export const applyAddRegion =
  (region: Region) =>
  (dispatch: AppDispatch, getState: () => RootState) => {
    dispatch(addRegionAction(region))
    for (const op of addRegionOps(region)) dispatchPipelined(dispatch, getState, op)
  }

