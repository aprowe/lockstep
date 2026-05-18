import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ContextMenu from './ContextMenu'
import CanvasTimeline, { CanvasTimelineToolbar } from './CanvasTimeline'
import type { RegionBlock } from '../timeline/types'
import type { ContextMenuState } from './ContextMenu'
import {
  buildSegments,
  snapAllToBeat,
} from '../utils/quantize'
import { clampView } from '../utils/view'
import { clipHsl } from '../timeline/palette'
import type { Anchor, View, ClipOverlay } from '../types'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import {
  selectSortedOrig,
  selectSortedBeat,
  selectOutputDuration,
  selectLinkedAnchorIds,
  selectSelectedOrigIdsSet,
  selectSelectedBeatIdsSet,
  selectSelectedIdsUnion,
  selectActiveRegion,
  selectClipIn,
  selectClipOut,
  selectEffectiveBeatBoundsForActive,
  selectConstraintGraph,
} from '../store/selectors'
import {
  setOrigAnchorsFromTimeline,
  setBeatAnchorsFromTimeline,
  removeAnchors,
  resetBeatLinks,
  loadAnchors,
  setBpm,
  setBeatZeroId,
  setSelectedOrigIds as setSelectedOrigIdsAction,
  setSelectedBeatIds as setSelectedBeatIdsAction,
  setSelectedBothIds as setSelectedBothIdsAction,
  newAnchorId,
} from '../store/slices/warpSlice'
import { setView as setReduxView, setWarpCollapsed, setGridDiv } from '../store/slices/uiSlice'
import { commitClipoutResize, commitClipoutPan } from '../store/thunks/clipoutThunks'
import { moveAnchors, moveBeatAnchors } from '../store/thunks/regionThunks'
import { applyAnchorEntityMove, applyRegionEntityMove } from '../store/thunks/entityWriteThunks'
import { regionOutId, anchorOutId } from '../constraints/ids'
import { snapToSiblings } from '../constraints/recipes'
import {
  setSnapInstall,
  clearSnapInstall,
  addCarryPair,
  clearAllCarry,
} from '../store/slices/dragCtxSlice'
import {
  origToBeat as beatMapOrigToBeat,
  beatToOrig as beatMapBeatToOrig,
  buildPairsFromAligned,
} from '../timeline/model/beatMap'
import { useTimelineKeyboardShortcuts } from './hooks/useTimelineKeyboardShortcuts'
import { usePanGesture } from './hooks/usePanGesture'
import './WarpView.css'

interface WarpViewProps {
  onSeek?: (time: number) => void
  onSendToNewRegion?: (inPoint: number, outPoint: number) => void
  clipOverlays?: ClipOverlay[]
  onClipOverlaySelect?: (id: string) => void
  /** Per-space clip selection. A region id in `selectedClipinIds` means only
   *  its input-space copy is selected; `selectedClipoutIds` for the output track.
   *  Independent of the single active region — drives the clip-list multi-select set. */
  selectedClipinIds?: ReadonlySet<string>
  selectedClipoutIds?: ReadonlySet<string>
  onClipsSelectionChange?: (clipinIds: Set<string>, clipoutIds: Set<string>) => void
  /** Lasso-driven scene-cut selection. Identified by exact cut time;
   *  surfaces on the timeline as accent-ringed diamonds. */
  selectedSceneTimes?: ReadonlySet<number>
  onScenesSelectionChange?: (times: Set<number>) => void
  /** User-placed scene cuts — passed through so the timeline tints them
   *  with a cooler hue than auto-detected ones. */
  userSceneTimes?: ReadonlySet<number>
  /** Timeline-focused Delete / Backspace deletes the union of clip +
   *  marker + scene selections; Cmd+D / empty-click clears them. */
  onTimelineDelete?: () => void
  onTimelineDeselect?: () => void
  onClipOverlayResize?: (id: string, inPoint: number, outPoint: number) => void
  onClipOverlayMove?: (id: string, inPoint: number, outPoint: number, altKey: boolean) => void
  onClipOverlayContextMenu?: (id: string, x: number, y: number) => void
  onClipOverlayZoom?: (id: string) => void
  /** Detected scene cut times in input (orig) seconds. */
  scenes?: number[]
  /** Source-time ranges that have actually been scanned for cuts. Drives the
   *  subtle "scanned" tint on the scene track so the user can see what
   *  ffmpeg has covered vs. what's still un-scanned. */
  scannedRanges?: ReadonlyArray<{ start: number; end: number }>
  /** Add a scene cut at this time (click on empty scene row background). */
  onSceneAdd?: (time: number) => void
  /** Delete the scene cut at this time (shift-click or right-click on diamond). */
  onSceneDelete?: (time: number) => void
  /** Create a new region with a sensible span around this time. */
  onRegionAdd?: (time: number) => void
  /** Zoom timeline to the active clip's in/out range. */
  onZoomToRegion?: () => void
}

export default function WarpView({
  onSeek,
  onSendToNewRegion,
  clipOverlays,
  onClipOverlaySelect,
  selectedClipinIds, selectedClipoutIds, onClipsSelectionChange,
  selectedSceneTimes, onScenesSelectionChange, userSceneTimes,
  onTimelineDelete, onTimelineDeselect,
  onClipOverlayResize,
  onClipOverlayMove,
  onClipOverlayContextMenu,
  onClipOverlayZoom,
  scenes: scenesProp,
  scannedRanges,
  onSceneAdd,
  onSceneDelete,
  onRegionAdd,
  onZoomToRegion,
}: WarpViewProps) {
  const dispatch = useAppDispatch()

  // ── Redux state ─────────────────────────────────────────────────────────────
  const origAnchors = useAppSelector(s => s.warp.origAnchors)
  const beatAnchors = useAppSelector(s => s.warp.beatAnchors)
  // BPM is per-region after Phase 6 — the grid follows the active region's
  // clipout. Fall back to the legacy global only when no region is active.
  const globalBpm = useAppSelector(s => s.warp.bpm)
  const activeRegionBpm = useAppSelector(s => selectActiveRegion(s)?.bpm)
  const bpm = activeRegionBpm ?? globalBpm
  const beatZeroId = useAppSelector(s => s.warp.beatZeroId)
  const playhead = useAppSelector(s => s.warp.playhead)
  const gridDiv = useAppSelector(s => s.ui.gridDiv)
  const smoothPan = useAppSelector(s => s.settings.smoothPan)
  const warpCollapsed = useAppSelector(s => s.ui.warpCollapsed)
  const duration = useAppSelector(s => s.video.video?.duration ?? 60)

  const activeRegion = useAppSelector(selectActiveRegion)
  const clipIn = useAppSelector(selectClipIn)
  const clipOut = useAppSelector(selectClipOut)
  // Raw (render-path) beat times — used for segments, beatClipOverlays, etc.
  const clipInBeatTime = activeRegion?.inBeatTime
  const clipOutBeatTime = activeRegion?.outBeatTime
  // Effective bounds — used for computation (clipLockedBeats, beatOffset).
  const effectiveBounds = useAppSelector(selectEffectiveBeatBoundsForActive)

  const sortedOrig = useAppSelector(selectSortedOrig)
  const sortedBeat = useAppSelector(selectSortedBeat)
  const outputDuration = useAppSelector(selectOutputDuration)
  const linkedAnchorIds = useAppSelector(selectLinkedAnchorIds)
  const selectedOrigIds = useAppSelector(selectSelectedOrigIdsSet)
  const selectedBeatIds = useAppSelector(selectSelectedBeatIdsSet)
  /** Union of orig + beat selected ids — used for Delete key and segment highlighting. */
  const selectedIds = useAppSelector(selectSelectedIdsUnion)
  const allRegions = useAppSelector(s => s.region.regions)
  const anchorLock = useAppSelector(s => s.ui.anchorLock)
  const lockMode = useAppSelector(s => s.ui.lockMode)
  const constraintGraph = useAppSelector(selectConstraintGraph)
  const constraintEntities = constraintGraph.entities

  // ── Local state (gestures, view, menus) ─────────────────────────────────────
  const reduxView = useAppSelector(s => s.ui.view)
  const [view, setView] = useState<View>(reduxView)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [shiftHeld, setShiftHeld] = useState(false)
  const [panning, setPanning] = useState(false)
  const [mouseOver, setMouseOver] = useState(false)

  const warpContainerRef = useRef<HTMLDivElement>(null)
const importRef = useRef<HTMLInputElement>(null)

  // Sync local view to Redux (debounced on idle)
  const viewSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const viewRef = useRef(view); viewRef.current = view

  const syncViewToRedux = useCallback(() => {
    if (viewSyncTimer.current) clearTimeout(viewSyncTimer.current)
    viewSyncTimer.current = setTimeout(() => {
      dispatch(setReduxView(viewRef.current))
    }, 100)
  }, [dispatch])

  // When Redux view changes externally (e.g. region switch), update local
  useEffect(() => {
    setView(reduxView)
  }, [reduxView])

  // ── Derived values ──────────────────────────────────────────────────────────
  const beat = 60 / bpm

  const clipLockedBeats = useMemo(() => {
    if (!activeRegion || lockMode !== 'beats') return undefined
    if (activeRegion.lockedBeats && activeRegion.lockedBeats > 0) return activeRegion.lockedBeats
    // Use effective bounds so input-anchor conform is reflected in the span.
    const effIn = effectiveBounds?.inBeatTime ?? activeRegion.inBeatTime
    const effOut = effectiveBounds?.outBeatTime ?? activeRegion.outBeatTime
    const beatSpan = effOut - effIn
    return beat > 0 ? beatSpan / beat : undefined
  }, [activeRegion, lockMode, beat, effectiveBounds])

  const beatOffset = useMemo(() => {
    if (clipIn === undefined) return sortedBeat[0]?.time ?? 0
    if (beatZeroId !== null) {
      const z = sortedBeat.find(a => a.id === beatZeroId)
      if (z) return z.time
    }
    // Use effective in-beat so input-anchor conform shifts the beat grid origin.
    return effectiveBounds?.inBeatTime ?? clipInBeatTime ?? clipIn
  }, [clipIn, clipInBeatTime, effectiveBounds, sortedBeat, beatZeroId])

  const maxDuration = Math.max(duration, outputDuration)

  const scenes = useMemo(() => scenesProp ?? [], [scenesProp])

  // ── Segments (with synthetic clip boundary anchors) ────────────────────────
  const { segments, segmentAnchors } = useMemo(() => {
    if (clipIn === undefined && clipOut === undefined) {
      return { segments: buildSegments(sortedOrig, sortedBeat, duration, outputDuration), segmentAnchors: sortedOrig }
    }
    const augOrig = [...sortedOrig]
    const augBeat = [...sortedBeat]
    const EPS = 0.01
    if (clipIn !== undefined && (augOrig.length === 0 || augOrig[0].time - clipIn > EPS)) {
      augOrig.unshift({ id: -9998, time: clipIn })
      augBeat.unshift({ id: -9998, time: clipInBeatTime ?? clipIn })
    }
    if (clipOut !== undefined && (augOrig.length === 0 || clipOut - augOrig[augOrig.length - 1].time > EPS)) {
      augOrig.push({ id: -9999, time: clipOut })
      augBeat.push({ id: -9999, time: clipOutBeatTime ?? clipOut })
    }
    return { segments: buildSegments(augOrig, augBeat, duration, outputDuration), segmentAnchors: augOrig }
  }, [sortedOrig, sortedBeat, duration, outputDuration, clipIn, clipOut, clipInBeatTime, clipOutBeatTime])

  // ── Region-scoped mapping ─────────────────────────────────────────────────
  const { scopedOrig, scopedBeat } = useMemo(() => {
    if (clipIn === undefined && clipOut === undefined) {
      return { scopedOrig: sortedOrig, scopedBeat: sortedBeat }
    }
    const EPS = 0.01
    const cIn = clipIn ?? 0
    const cOut = clipOut ?? duration
    const filteredOrig = sortedOrig.filter(a => a.time >= cIn - EPS && a.time <= cOut + EPS)
    const filteredBeat = filteredOrig.map(oa => sortedBeat.find(ba => ba.id === oa.id) ?? { id: oa.id, time: oa.time })
    const augO = [...filteredOrig]
    const augB = [...filteredBeat]
    if (clipIn !== undefined && (augO.length === 0 || augO[0].time - clipIn > EPS)) {
      augO.unshift({ id: -9998, time: clipIn })
      augB.unshift({ id: -9998, time: clipInBeatTime ?? clipIn })
    }
    if (clipOut !== undefined && (augO.length === 0 || clipOut - augO[augO.length - 1].time > EPS)) {
      augO.push({ id: -9999, time: clipOut })
      augB.push({ id: -9999, time: clipOutBeatTime ?? clipOut })
    }
    return { scopedOrig: augO, scopedBeat: augB }
  }, [sortedOrig, sortedBeat, clipIn, clipOut, clipInBeatTime, clipOutBeatTime, duration])

  // Build pairs once from the scoped aligned arrays; reused by both origToBeat and beatToOrig.
  const scopedPairs = useMemo(
    () => buildPairsFromAligned(scopedOrig, scopedBeat),
    [scopedOrig, scopedBeat],
  )

  const origToBeat = useCallback((t: number): number => {
    if (clipIn !== undefined && t < clipIn) return t
    if (clipOut !== undefined && t > clipOut) return t
    return beatMapOrigToBeat(t, scopedPairs)
  }, [scopedPairs, clipIn, clipOut])

  const beatToOrig = useCallback((t: number): number => {
    if (clipIn !== undefined && t < clipIn) return t
    if (clipOut !== undefined && t > clipOut) return t
    return beatMapBeatToOrig(t, scopedPairs)
  }, [scopedPairs, clipIn, clipOut])

  const beatPlayhead = useMemo(
    () => playhead !== undefined ? origToBeat(playhead) : undefined,
    [playhead, origToBeat],
  )

  const beatClipIn = useMemo(
    () => clipIn !== undefined ? origToBeat(clipIn) : undefined,
    [clipIn, origToBeat],
  )
  const beatClipOut = useMemo(
    () => clipOut !== undefined ? origToBeat(clipOut) : undefined,
    [clipOut, origToBeat],
  )

  const beatClipOverlays = useMemo(
    () => clipOverlays?.map(c => ({
      ...c,
      // Use explicit beat-space boundaries when set (default-linked regions
      // fall back to projecting the input-space bounds through origToBeat).
      // This ensures conformClipoutToBeatAnchors matches against the actual
      // beat-space edge values rather than the warp-projected input points.
      inPoint: c.inBeatTime ?? origToBeat(c.inPoint),
      outPoint: c.outBeatTime ?? origToBeat(c.outPoint),
    })),
    [clipOverlays, origToBeat],
  )

  const activeRegionPalette = useMemo(() => {
    const active = clipOverlays?.find(c => c.active)
    if (!active) return null
    return {
      fill: clipHsl(active.colorIndex ?? 0, 0.06),
      solid: clipHsl(active.colorIndex ?? 0),
    }
  }, [clipOverlays])

  const seekFromBeat = useCallback(
    (beatTime: number) => onSeek?.(Math.max(0, Math.min(duration, beatToOrig(beatTime)))),
    [onSeek, duration, beatToOrig],
  )

  const handleViewChange = useCallback(
    (v: View) => {
      const clamped = clampView(v.start, v.end, maxDuration)
      setView(clamped)
      syncViewToRedux()
    },
    [maxDuration, syncViewToRedux],
  )

  const quantAnchors: Anchor[] = useMemo(
    () => sortedBeat.map(a => ({ id: a.id, time: a.time })),
    [sortedBeat],
  )

  const snapTargetsInput = useMemo(
    () => [...scenes, ...origAnchors.map(a => a.time)],
    [scenes, origAnchors],
  )
  const snapTargetsOutput = useMemo(() => {
    const beatTimes = quantAnchors.map(a => a.time)
    if (clipIn === undefined) return beatTimes
    return [...beatTimes, beatClipIn ?? 0, beatClipOut ?? outputDuration]
  }, [quantAnchors, clipIn, beatClipIn, beatClipOut, outputDuration])

  const linkedBoundaries = useMemo(
    () => segmentAnchors.map(a => a.id < 0 || linkedAnchorIds.has(a.id)),
    [segmentAnchors, linkedAnchorIds],
  )

  const selectedBoundaries = useMemo(
    () => segmentAnchors.map(a => selectedIds.has(a.id)),
    [segmentAnchors, selectedIds],
  )

  // ── Selection helpers ─────────────────────────────────────────────────────
  /** Lasso commit: set orig and beat selection from the two separate id sets. */
  const handleConnectorSelectionChange = useCallback(
    (origIds: Set<number>, beatIds: Set<number>) => {
      dispatch(setSelectedOrigIdsAction([...origIds]))
      dispatch(setSelectedBeatIdsAction([...beatIds]))
    },
    [dispatch],
  )

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleOrigChange = useCallback(
    (next: Anchor[]) => dispatch(moveAnchors(next)),
    [dispatch],
  )

  const handleBeatChange = useCallback(
    (next: Anchor[]) => dispatch(moveBeatAnchors(next)),
    [dispatch],
  )

  /** Phase 2.5: single-entity anchor entity move — dispatches one SetValue op
   *  so the resolver can propagate via lasso:main TranslateGroup. */
  const handleAnchorEntityMove = useCallback(
    (entityId: string, time: number) => dispatch(applyAnchorEntityMove({ entityId, time })),
    [dispatch],
  )

  /** Phase 2.5: single-entity region body move — dispatches Move ops on the
   *  primary clipin entity; resolver propagates to followers via lasso:main.
   *  delta is the signed translate from the entity's position at drag start.
   *  Output-space drags are routed to commitClipoutPan (absolute beat times
   *  are recovered from the current clipout entity in the constraint graph). */
  const handleRegionEntityMove = useCallback(
    (id: string, delta: number, isOutput: boolean, altKey: boolean) => {
      if (isOutput) {
        // Output-space body pan: delegate to commitClipoutPan with a delta.
        // commitClipoutPan resolves the absolute target from state.drag.preDrag
        // so repeated emissions during a drag (live pointerMove + pointerUp
        // commit) converge instead of compounding.
        if (clipOverlays?.find(c => c.id === id)) {
          dispatch(commitClipoutPan({ id, delta, altKey }))
        }
      } else {
        dispatch(applyRegionEntityMove({ id, delta }))
      }
    },
    [dispatch, clipOverlays],
  )

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useTimelineKeyboardShortcuts(selectedIds)

  // ── Middle-mouse or shift+drag pan ────────────────────────────────────────
  usePanGesture(warpContainerRef, viewRef, handleViewChange, setShiftHeld, setPanning)

  // ── Import handler ────────────────────────────────────────────────────────
  const importMarkers = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target!.result as string)
        if (!Array.isArray(data.origAnchors) || !Array.isArray(data.beatAnchors)) return
        const idMap = new Map<number, number>()
        const newOrig: Anchor[] = data.origAnchors.map((a: Anchor) => {
          const id = newAnchorId()
          idMap.set(a.id, id)
          return { id, time: a.time }
        })
        const newBeat: Anchor[] = data.beatAnchors.map((a: Anchor) => ({
          id: idMap.get(a.id) ?? newAnchorId(),
          time: a.time,
        }))
        dispatch(loadAnchors({ origAnchors: newOrig, beatAnchors: newBeat }))
        if (data.bpm > 0) dispatch(setBpm(data.bpm))
        if (data.beatZeroAnchorTime != null) {
          const match = newBeat.find(a => Math.abs(a.time - data.beatZeroAnchorTime) < 0.001)
          dispatch(setBeatZeroId(match?.id ?? null))
        } else {
          dispatch(setBeatZeroId(null))
        }
      } catch { /* invalid JSON */ }
    }
    reader.readAsText(file)
    e.target.value = ''
  }, [dispatch])

  // ── Context menu builders ─────────────────────────────────────────────────
  const handleAnchorContextMenu = useCallback((id: number, x: number, y: number) => {
    // Context menu on an input anchor: use the union of both spaces for the
    // "target set" (so a multi-selection of both spaces gets deleted together),
    // but if this anchor isn't already selected, select it in orig space.
    const curSel = selectedIds
    const targetIds = curSel.has(id) ? curSel : new Set([id])
    if (!curSel.has(id)) {
      dispatch(setSelectedOrigIdsAction([id]))
      dispatch(setSelectedBeatIdsAction([]))
    }

    setContextMenu({
      x, y,
      items: [
        {
          label: targetIds.size > 1 ? `Delete ${targetIds.size} anchors` : 'Delete anchor',
          danger: true,
          action: () => {
            dispatch(removeAnchors([...targetIds]))
          },
        },
        {
          label: targetIds.size > 1 ? 'Reset links' : 'Reset link',
          action: () => dispatch(resetBeatLinks([...targetIds])),
        },
        {
          label: 'Snap to beat',
          action: () => {
            const b = beat / gridDiv
            const offset = beatOffset
            if (!b || b <= 0) return
            const toSnap = beatAnchors.filter(a => targetIds.has(a.id))
            const snapped = snapAllToBeat(toSnap, b, offset)
            dispatch(setBeatAnchorsFromTimeline(
              beatAnchors.map(a => {
                const s = snapped.find(sa => sa.id === a.id)
                return s ? { ...a, time: s.time } : a
              }),
            ))
          },
        },
        ...(onSendToNewRegion ? [
          { separator: true as const },
          {
            label: 'Send to new clip',
            action: () => {
              const selOrig = origAnchors.filter(a => targetIds.has(a.id))
              if (selOrig.length === 0) return
              const times = selOrig.map(a => a.time)
              onSendToNewRegion(Math.min(...times), Math.max(...times))
            },
          },
        ] : []),
      ],
    })
  }, [selectedIds, dispatch, beat, gridDiv, beatOffset, beatAnchors, origAnchors, onSendToNewRegion])

  // ── Thin-layout region mapping ────────────────────────────────────────────
  // Per-space selection: clipin track uses selectedClipinIds; clipout uses selectedClipoutIds.
  // Falls back to the overlay's own `selected` field when no external set is provided.
  const thinRegions: RegionBlock[] = useMemo(
    () => (clipOverlays ?? []).map(c => ({
      id: c.id,
      inPoint: c.inPoint,
      outPoint: c.outPoint,
      colorIndex: c.colorIndex,
      active: c.active,
      selected: selectedClipinIds ? selectedClipinIds.has(c.id) : c.selected,
      label: c.name,
    })),
    [clipOverlays, selectedClipinIds],
  )

  const thinRegionsOut: RegionBlock[] = useMemo(
    () => (beatClipOverlays ?? []).map(c => ({
      id: c.id,
      inPoint: c.inPoint,
      outPoint: c.outPoint,
      colorIndex: c.colorIndex,
      active: c.active,
      selected: selectedClipoutIds ? selectedClipoutIds.has(c.id) : c.selected,
      label: c.name,
    })),
    [beatClipOverlays, selectedClipoutIds],
  )

  const handleThinAnchorAdd = useCallback((time: number) => {
    const clamped = Math.max(0, Math.min(duration, time))
    dispatch(setOrigAnchorsFromTimeline([...origAnchors, { id: newAnchorId(), time: clamped }]))
  }, [duration, origAnchors, dispatch])

  const handleThinAnchorDelete = useCallback((id: number) => {
    dispatch(removeAnchors([id]))
  }, [dispatch])

  const handleThinAnchorSelect = useCallback((id: number, additive: boolean) => {
    if (additive) {
      const next = new Set(selectedOrigIds)
      if (next.has(id)) next.delete(id); else next.add(id)
      dispatch(setSelectedOrigIdsAction([...next]))
    } else {
      dispatch(setSelectedOrigIdsAction([id]))
      // Clear beat selection when starting a fresh input-only selection.
      dispatch(setSelectedBeatIdsAction([]))
    }
  }, [dispatch, selectedOrigIds])

  const handleThinBeatAnchorDelete = useCallback((id: number) => {
    dispatch(removeAnchors([id]))
  }, [dispatch])

  const handleThinBeatAnchorSelect = useCallback((id: number, additive: boolean) => {
    if (additive) {
      const next = new Set(selectedBeatIds)
      if (next.has(id)) next.delete(id); else next.add(id)
      dispatch(setSelectedBeatIdsAction([...next]))
    } else {
      dispatch(setSelectedBeatIdsAction([id]))
      // Clear orig selection when starting a fresh beat-only selection.
      dispatch(setSelectedOrigIdsAction([]))
    }
  }, [dispatch, selectedBeatIds])

  const handleSceneContextMenu = useCallback((time: number, x: number, y: number) => {
    setContextMenu({
      x, y,
      items: [
        { label: 'Seek to scene', action: () => onSeek?.(time) },
        ...(onSceneDelete ? [{
          label: 'Delete scene',
          danger: true as const,
          action: () => onSceneDelete(time),
        }] : []),
      ],
    })
  }, [onSeek, onSceneDelete])

  const handleTimelineContextMenu = useCallback((time: number, x: number, y: number) => {
    setContextMenu({
      x, y,
      items: [
        {
          label: 'Create anchor here',
          action: () => handleThinAnchorAdd(time),
        },
        ...(onSceneAdd ? [{
          label: 'Create scene here',
          action: () => onSceneAdd(time),
        }] : []),
        ...(onRegionAdd ? [{
          label: 'Create clip here',
          action: () => onRegionAdd(time),
        }] : []),
      ],
    })
  }, [handleThinAnchorAdd, onSceneAdd, onRegionAdd])

  // ── Render ────────────────────────────────────────────────────────────────
  const warpCursor = panning
    ? { cursor: 'grabbing' }
    : (shiftHeld && mouseOver) ? { cursor: 'grab' } : {}

  return (
    <div
      ref={warpContainerRef}
      className="warp-view"
      style={warpCursor}
      onMouseEnter={() => setMouseOver(true)}
      onMouseLeave={() => setMouseOver(false)}
      onMouseDown={e => { if (e.button === 1) e.preventDefault() }}
    >
      <CanvasTimeline
        duration={duration}
        outputDuration={outputDuration}
        view={view}
        onViewChange={handleViewChange}
        maxDuration={maxDuration}
        playhead={playhead}
        beatPlayhead={beatPlayhead}
        onSeek={onSeek}
        onSeekBeat={seekFromBeat}
        anchors={origAnchors}
        selectedOrigAnchorIds={selectedOrigIds}
        selectedBeatAnchorIds={selectedBeatIds}
        onAnchorAdd={handleThinAnchorAdd}
        onAnchorDelete={handleThinAnchorDelete}
        onAnchorSelect={handleThinAnchorSelect}
        onAnchorContextMenu={handleAnchorContextMenu}
        onAnchorsChange={handleOrigChange}
        onAnchorEntityMove={handleAnchorEntityMove}
        beatAnchors={quantAnchors}
        linkedBeatIds={linkedAnchorIds}
        onBeatAnchorDelete={handleThinBeatAnchorDelete}
        onBeatAnchorSelect={handleThinBeatAnchorSelect}
        onBeatAnchorContextMenu={handleAnchorContextMenu}
        onBeatAnchorsChange={handleBeatChange}
        snapInterval={beat / gridDiv}
        snapOffset={beatOffset}
        gridDiv={gridDiv}
        snapTargetsInput={snapTargetsInput}
        snapTargetsOutput={snapTargetsOutput}
        bpm={bpm}
        beatOffset={beatOffset}
        clipLock={activeRegion ? lockMode : undefined}
        clipLockedBeats={clipLockedBeats}
        clipAnchorLock={anchorLock}
        smoothPan={smoothPan}
        scenes={scenes}
        scannedRanges={scannedRanges}
        onSceneAdd={onSceneAdd}
        onSceneDelete={onSceneDelete}
        onSceneContextMenu={handleSceneContextMenu}
        onRegionAdd={onRegionAdd}
        onTimelineContextMenu={handleTimelineContextMenu}
        regions={thinRegions}
        regionsOutput={thinRegionsOut}
        regionDetails={allRegions}
        onRegionSelect={onClipOverlaySelect}
        onRegionContextMenu={onClipOverlayContextMenu}
        onRegionResize={onClipOverlayResize}
        onRegionMove={onClipOverlayMove}
        onRegionEntityMove={handleRegionEntityMove}
        onRegionMoveOutput={(id, inP, outP, altKey) => {
          if (clipOverlays?.find(c => c.id === id)) {
            dispatch(commitClipoutPan({ id, inBeatTime: inP, outBeatTime: outP, altKey }))
          }
        }}
        onRegionResizeOutput={(id, inP, outP, altKey) => {
          if (clipOverlays?.find(c => c.id === id)) {
            dispatch(commitClipoutResize({ id, inBeatTime: inP, outBeatTime: outP, altKey }))
          }
        }}
        onCarryStart={(regionId, edge, anchorId) => {
          dispatch(addCarryPair({ clipOutId: regionOutId(regionId), edge, anchorOutId: anchorOutId(anchorId) }))
        }}
        onCarryEnd={(_regionId) => {
          dispatch(clearAllCarry())
        }}
        onSnapStart={(entityId, field, pxPerUnit, grid, gestureRole) => {
          const op = snapToSiblings(entityId, field, constraintGraph, pxPerUnit, 8, grid, gestureRole)
          if (op.kind === 'add_constraint' && op.constraint.kind === 'snap_target') {
            const snap = op.constraint as {
              id: string; field: 'time' | 'in' | 'out'; threshold: number
              grid?: { interval: number; offset: number }; mode?: 'edge' | 'body'
              targets: Array<{ entityId: string; field: 'time' | 'in' | 'out' }>
            }
            dispatch(setSnapInstall({
              entityId:  snap.id,
              field:     snap.field,
              threshold: snap.threshold,
              grid:      snap.grid,
              mode:      snap.mode,
              targets:   snap.targets,
            }))
          }
        }}
        onSnapEnd={(_entityId, _field) => {
          dispatch(clearSnapInstall())
        }}
        constraintGraph={constraintGraph}
        onRegionZoom={onClipOverlayZoom}
        segments={segments}
        clipIn={clipIn}
        clipOut={clipOut}
        beatClipIn={beatClipIn}
        beatClipOut={beatClipOut}
        clipFillColor={activeRegionPalette?.fill}
        boundaryColor={activeRegionPalette?.solid}
        linkedBoundaries={linkedBoundaries}
        selectedBoundaries={selectedBoundaries}
        onConnectorSelectionChange={handleConnectorSelectionChange}
        selectedClipinIds={selectedClipinIds}
        selectedClipoutIds={selectedClipoutIds}
        onClipsSelectionChange={onClipsSelectionChange}
        selectedSceneTimes={selectedSceneTimes}
        userSceneTimes={userSceneTimes}
        onScenesSelectionChange={onScenesSelectionChange}
        onTimelineDelete={onTimelineDelete}
        onTimelineDeselect={onTimelineDeselect}
        warpCollapsed={warpCollapsed}
      />
      <CanvasTimelineToolbar
        warpCollapsed={warpCollapsed}
        onToggleWarp={() => dispatch(setWarpCollapsed(!warpCollapsed))}
        onZoomToRegion={onZoomToRegion}
        gridDiv={gridDiv}
        onGridDivChange={v => dispatch(setGridDiv(v))}
      />
      <input
        ref={importRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={importMarkers}
      />
      {contextMenu && (
        <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
      )}
    </div>
  )
}
