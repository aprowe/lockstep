import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Timeline from './Timeline'
import WarpConnector from './WarpConnector'
import SpeedStrip from './SpeedStrip'
import SceneRow from './SceneRow'
import ContextMenu from './ContextMenu'
import type { ContextMenuState } from './ContextMenu'
import {
  buildSegments,
  snapAllToBeat,
} from '../utils/quantize'
import { clampView, initialView, calcNewRegionBoundsFromScenes } from '../utils/view'
import type { Anchor, View } from '../types'
import type { ClipOverlay } from './Timeline'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import {
  selectSortedOrig,
  selectSortedBeat,
  selectOutputDuration,
  selectLinkedAnchorIds,
  selectSelectedIdsSet,
  selectActiveRegion,
  selectClipIn,
  selectClipOut,
  selectDimmedAnchorIds,
} from '../store/selectors'
import {
  setOrigAnchorsFromTimeline,
  setBeatAnchorsFromTimeline,
  removeAnchors,
  resetBeatLinks,
  clearAnchors,
  loadAnchors,
  setBpm,
  setBeatZeroId,
  setSelectedIds as setSelectedIdsAction,
  deselectAll,
  newAnchorId,
} from '../store/slices/warpSlice'
import { updateRegionBeatTimes } from '../store/slices/regionSlice'
import { setView as setReduxView, setWarpCollapsed } from '../store/slices/uiSlice'
import { undo as undoAction, redo as redoAction } from '../store/slices/historySlice'
import './WarpView.css'

interface WarpViewProps {
  onSeek?: (time: number) => void
  onSendToNewRegion?: (inPoint: number, outPoint: number) => void
  clipOverlays?: ClipOverlay[]
  onClipOverlaySelect?: (id: string) => void
  onClipOverlayCreate?: (inPoint: number, outPoint: number) => void
  onClipOverlayResize?: (id: string, inPoint: number, outPoint: number) => void
  onClipOverlayMove?: (id: string, inPoint: number, outPoint: number) => void
  onClipOverlayContextMenu?: (id: string, x: number, y: number) => void
  onClipOverlayZoom?: (id: string) => void
  /** Detected scene cut times in input (orig) seconds. */
  scenes?: number[]
}

export default function WarpView({
  onSeek,
  onSendToNewRegion,
  clipOverlays,
  onClipOverlaySelect,
  onClipOverlayCreate,
  onClipOverlayResize,
  onClipOverlayMove,
  onClipOverlayContextMenu,
  onClipOverlayZoom,
  scenes: scenesProp,
}: WarpViewProps) {
  const dispatch = useAppDispatch()

  // ── Redux state ─────────────────────────────────────────────────────────────
  const origAnchors = useAppSelector(s => s.warp.origAnchors)
  const beatAnchors = useAppSelector(s => s.warp.beatAnchors)
  const bpm = useAppSelector(s => s.warp.bpm)
  const beatZeroId = useAppSelector(s => s.warp.beatZeroId)
  const trimToLoop = useAppSelector(s => s.warp.trimToLoop)
  const addToEnd = useAppSelector(s => s.warp.addToEnd)
  const playhead = useAppSelector(s => s.warp.playhead)
  const gridDiv = useAppSelector(s => s.ui.gridDiv)
  const warpCollapsed = useAppSelector(s => s.ui.warpCollapsed)
  const duration = useAppSelector(s => s.video.video?.duration ?? 60)

  const activeRegion = useAppSelector(selectActiveRegion)
  const clipIn = useAppSelector(selectClipIn)
  const clipOut = useAppSelector(selectClipOut)
  const clipInBeatTime = activeRegion?.inBeatTime
  const clipOutBeatTime = activeRegion?.outBeatTime
  const regionLock = activeRegion?.lock

  const sortedOrig = useAppSelector(selectSortedOrig)
  const sortedBeat = useAppSelector(selectSortedBeat)
  const outputDuration = useAppSelector(selectOutputDuration)
  const linkedAnchorIds = useAppSelector(selectLinkedAnchorIds)
  const selectedIds = useAppSelector(selectSelectedIdsSet)
  const dimmedAnchorIds = useAppSelector(selectDimmedAnchorIds)

  // ── Local state (gestures, view, menus) ─────────────────────────────────────
  const reduxView = useAppSelector(s => s.ui.view)
  const [view, setView] = useState<View>(reduxView)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [shiftHeld, setShiftHeld] = useState(false)
  const [panning, setPanning] = useState(false)
  const [mouseOver, setMouseOver] = useState(false)
  const [selectionOrigin, setSelectionOrigin] = useState<'orig' | 'beat'>('orig')
  const [scenesExpanded, setScenesExpanded] = useState(false)
  const [hoveredScene, setHoveredScene] = useState<number | null>(null)
  const [dragTime, setDragTime] = useState<number | null>(null)

  const warpContainerRef = useRef<HTMLDivElement>(null)
  const connectorRef = useRef<HTMLDivElement>(null)
  const panGesture = useRef<{ lastX: number; width: number } | null>(null)
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

  const effectiveBeatZeroId = useMemo(() => {
    if (beatZeroId !== null && sortedBeat.some(a => a.id === beatZeroId)) return beatZeroId
    if (clipIn !== undefined) return null
    return sortedBeat[0]?.id ?? null
  }, [beatZeroId, sortedBeat, clipIn])

  const beatOffset = useMemo(() => {
    if (clipIn === undefined) return sortedBeat[0]?.time ?? 0
    if (beatZeroId !== null) {
      const z = sortedBeat.find(a => a.id === beatZeroId)
      if (z) return z.time
    }
    return clipInBeatTime ?? clipIn
  }, [clipIn, clipInBeatTime, sortedBeat, beatZeroId])

  const effectiveOutputDuration = trimToLoop && beat > 0
    ? Math.floor(outputDuration / beat) * beat
    : outputDuration

  const maxDuration = Math.max(duration, outputDuration)

  const scenes = useMemo(() => scenesProp ?? [], [scenesProp])

  // Scene throughlines are hidden by default. They appear for the hovered scene
  // marker, or for the 2 nearest scenes on each side of a dragging anchor/clip.
  const visibleScenes = useMemo(() => {
    if (hoveredScene !== null) return [hoveredScene]
    if (dragTime !== null && scenes.length > 0) {
      const before: number[] = []
      const after: number[] = []
      for (const t of scenes) {
        if (t <= dragTime) before.push(t)
        else after.push(t)
      }
      return [...before.slice(-2), ...after.slice(0, 2)]
    }
    return []
  }, [hoveredScene, dragTime, scenes])

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

  const origToBeat = useCallback((t: number): number => {
    if (clipIn !== undefined && t < clipIn) return t
    if (clipOut !== undefined && t > clipOut) return t
    if (scopedOrig.length === 0) return t
    for (let i = 0; i < scopedOrig.length - 1; i++) {
      const o0 = scopedOrig[i].time, o1 = scopedOrig[i + 1].time
      const b0 = scopedBeat[i].time, b1 = scopedBeat[i + 1].time
      if (t >= o0 && t <= o1) {
        const frac = o1 > o0 ? (t - o0) / (o1 - o0) : 0
        return b0 + frac * (b1 - b0)
      }
    }
    return t
  }, [scopedOrig, scopedBeat, clipIn, clipOut])

  const beatToOrig = useCallback((t: number): number => {
    if (clipIn !== undefined && t < clipIn) return t
    if (clipOut !== undefined && t > clipOut) return t
    if (scopedBeat.length === 0) return t
    for (let i = 0; i < scopedBeat.length - 1; i++) {
      const b0 = scopedBeat[i].time, b1 = scopedBeat[i + 1].time
      const o0 = scopedOrig[i].time, o1 = scopedOrig[i + 1].time
      if (t >= b0 && t <= b1) {
        const frac = b1 > b0 ? (t - b0) / (b1 - b0) : 0
        return o0 + frac * (o1 - o0)
      }
    }
    return t
  }, [scopedOrig, scopedBeat, clipIn, clipOut])

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
      inPoint: origToBeat(c.inPoint),
      outPoint: origToBeat(c.outPoint),
    })),
    [clipOverlays, origToBeat],
  )

  const activeRegionPalette = useMemo(() => {
    const active = clipOverlays?.find(c => c.active)
    if (!active) return null
    const PALETTE = [[0,75,55],[30,80,52],[58,80,48],[115,65,45],[183,65,42],[213,70,55],[270,60,55],[305,65,52]]
    const [h,s,l] = PALETTE[(active.colorIndex ?? 0) % 8]
    return {
      fill: `hsla(${h},${s}%,${l}%,0.06)`,
      solid: `hsl(${h},${s}%,${l}%)`,
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

  const linkedBoundaries = useMemo(
    () => segmentAnchors.map(a => a.id < 0 || linkedAnchorIds.has(a.id)),
    [segmentAnchors, linkedAnchorIds],
  )

  const selectedBoundaries = useMemo(
    () => segmentAnchors.map(a => selectedIds.has(a.id)),
    [segmentAnchors, selectedIds],
  )

  const getBeatAnchorBounds = useCallback(
    (id: number): { min: number; max: number } => {
      const beatIdx = sortedBeat.findIndex(a => a.id === id)
      const origIdx = sortedOrig.findIndex(a => a.id === id)
      if (beatIdx === -1 || origIdx === -1) return { min: 0, max: outputDuration }
      let min = 0, max = outputDuration
      if (origIdx > 0) {
        const origSpan = sortedOrig[origIdx].time - sortedOrig[origIdx - 1].time
        const prevBeat = sortedBeat[beatIdx - 1]?.time ?? 0
        min = Math.max(min, prevBeat + 0 * origSpan)
        max = Math.min(max, prevBeat + Infinity * origSpan)
      }
      if (origIdx < sortedOrig.length - 1) {
        const origSpan = sortedOrig[origIdx + 1].time - sortedOrig[origIdx].time
        const nextBeat = sortedBeat[beatIdx + 1]?.time ?? outputDuration
        min = Math.max(min, nextBeat - Infinity * origSpan)
        max = Math.min(max, nextBeat - 0 * origSpan)
      }
      return { min, max }
    },
    [sortedBeat, sortedOrig, outputDuration],
  )

  // ── Selection helpers ─────────────────────────────────────────────────────
  const setSelectedIds = useCallback(
    (ids: Set<number>) => dispatch(setSelectedIdsAction([...ids])),
    [dispatch],
  )
  const setSelectedIdsOrig = useCallback(
    (ids: Set<number>) => { setSelectionOrigin('orig'); dispatch(setSelectedIdsAction([...ids])) },
    [dispatch],
  )
  const setSelectedIdsBeat = useCallback(
    (ids: Set<number>) => { setSelectionOrigin('beat'); dispatch(setSelectedIdsAction([...ids])) },
    [dispatch],
  )

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleOrigChange = useCallback(
    (next: Anchor[]) => dispatch(setOrigAnchorsFromTimeline(next)),
    [dispatch],
  )

  const handleBeatChange = useCallback(
    (next: Anchor[]) => dispatch(setBeatAnchorsFromTimeline(next)),
    [dispatch],
  )

  const handleBeatAnchorReset = useCallback(
    (id: number) => dispatch(resetBeatLinks([id])),
    [dispatch],
  )

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null
      const inInput = !!active && (
        active.tagName === 'INPUT' ||
        active.tagName === 'TEXTAREA' ||
        active.tagName === 'SELECT' ||
        active.isContentEditable
      )
      // Don't override browser editing shortcuts while typing.
      if (inInput) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const ids = [...selectedIds]
        if (ids.length > 0) {
          e.preventDefault()
          dispatch(removeAnchors(ids))
        }
        return
      }
      if (!e.ctrlKey && !e.metaKey) return
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); dispatch(undoAction()) }
      if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); dispatch(redoAction()) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedIds, dispatch])

  // ── Scroll-zoom on connector ──────────────────────────────────────────────
  const maxDurationRef = useRef(maxDuration); maxDurationRef.current = maxDuration
  const handleViewChangeRef = useRef(handleViewChange); handleViewChangeRef.current = handleViewChange

  useEffect(() => {
    const el = connectorRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const v = viewRef.current
      const span = v.end - v.start
      const rect = el.getBoundingClientRect()
      const cursorTime = v.start + ((e.clientX - rect.left) / rect.width) * span
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15
      const newSpan = span * factor
      const ratio = (cursorTime - v.start) / span
      const ns = cursorTime - ratio * newSpan
      handleViewChangeRef.current({ start: ns, end: ns + newSpan })
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  // ── Middle-mouse or shift+drag pan ────────────────────────────────────────
  useEffect(() => {
    const el = warpContainerRef.current
    if (!el) return

    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(true) }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') { setShiftHeld(false); panGesture.current = null; setPanning(false) }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    const onDown = (e: PointerEvent) => {
      // Middle mouse button or shift+left click
      if (e.button === 1 || (e.shiftKey && e.button === 0)) { /* pan */ } else return
      e.stopPropagation()
      const rect = el.getBoundingClientRect()
      el.setPointerCapture(e.pointerId)
      panGesture.current = { lastX: e.clientX, width: rect.width }
      setPanning(true)
    }
    const onMove = (e: PointerEvent) => {
      const g = panGesture.current
      if (!g || !e.buttons) return
      const v = viewRef.current
      const span = v.end - v.start
      const delta = ((g.lastX - e.clientX) / g.width) * span
      handleViewChangeRef.current({ start: v.start + delta, end: v.end + delta })
      panGesture.current = { ...g, lastX: e.clientX }
    }
    const onUp = () => { panGesture.current = null; setPanning(false) }

    el.addEventListener('pointerdown', onDown, { capture: true })
    el.addEventListener('pointermove', onMove, { capture: true })
    el.addEventListener('pointerup', onUp, { capture: true })
    el.addEventListener('pointercancel', onUp, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      el.removeEventListener('pointerdown', onDown, { capture: true })
      el.removeEventListener('pointermove', onMove, { capture: true })
      el.removeEventListener('pointerup', onUp, { capture: true })
      el.removeEventListener('pointercancel', onUp, { capture: true })
    }
  }, [])

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
        dispatch(loadAnchors({ origAnchors: newOrig, beatAnchors: newBeat, linkedBeatIds: [] }))
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
    const curSel = selectedIds
    const targetIds = curSel.has(id) ? curSel : new Set([id])
    if (!curSel.has(id)) dispatch(setSelectedIdsAction([id]))

    setContextMenu({
      x, y,
      items: [
        {
          label: targetIds.size > 1 ? `Delete ${targetIds.size} markers` : 'Delete marker',
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
            label: 'Send to new region',
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

  const handleTrackContextMenu = useCallback((time: number, x: number, y: number) => {
    setContextMenu({
      x, y,
      items: [
        {
          label: 'Add marker here',
          action: () => {
            const clamped = Math.max(0, Math.min(duration, time))
            dispatch(setOrigAnchorsFromTimeline([...origAnchors, { id: newAnchorId(), time: clamped }]))
          },
        },
        { separator: true },
        {
          label: 'Zoom to fit',
          action: () => handleViewChangeRef.current({ start: 0, end: maxDurationRef.current }),
        },
        {
          label: 'Zoom to region',
          action: () => handleViewChangeRef.current({ start: clipIn ?? 0, end: clipOut ?? duration }),
          disabled: clipIn === undefined && clipOut === undefined,
        },
        ...(onClipOverlayCreate ? [
          { separator: true as const },
          {
            label: 'New region here',
            action: () => {
              const { inPoint, outPoint } = calcNewRegionBoundsFromScenes(time, reduxView, scenes, duration)
              onClipOverlayCreate(inPoint, outPoint)
            },
          },
        ] : []),
      ],
    })
  }, [duration, clipIn, clipOut, origAnchors, onClipOverlayCreate, beat, dispatch, reduxView, scenes])

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
      <Timeline
        duration={duration}
        bpm={bpm}
        gridDiv={gridDiv}
        anchors={origAnchors}
        onAnchorsChange={handleOrigChange}
        view={view}
        onViewChange={handleViewChange}
        maxDuration={maxDuration}
        playhead={playhead}
        onRulerClick={onSeek}
        onAnchorClick={onSeek}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIdsOrig}
        primarySelection={selectionOrigin === 'orig'}
        clipIn={clipIn}
        clipOut={clipOut}
        onAnchorContextMenu={handleAnchorContextMenu}
        onTrackContextMenu={handleTrackContextMenu}
        clipOverlays={clipOverlays}
        onClipOverlaySelect={onClipOverlaySelect}
        onClipOverlayCreate={onClipOverlayCreate}
        onClipOverlayResize={onClipOverlayResize}
        onClipOverlayMove={onClipOverlayMove}
        onClipOverlayContextMenu={onClipOverlayContextMenu}
        onClipOverlayZoom={onClipOverlayZoom}
        beatRangeStart={clipIn}
        beatRangeEnd={clipOut}
        onTrackScrub={onSeek}
        linkedAnchorIds={linkedAnchorIds}
        dimmedAnchorIds={dimmedAnchorIds}
        minimapRegions={clipOverlays}
        belowRulerContent={
          <SceneRow
            scenes={scenes}
            view={view}
            duration={duration}
            expanded={scenesExpanded}
            onSceneClick={onSeek}
            onSceneHover={setHoveredScene}
          />
        }
        throughlines={scenes}
        activeThroughlines={visibleScenes}
        snapTargets={scenes}
        onDragPositionChange={setDragTime}
        rowLabels={{
          minimap: 'Overview',
          ruler: 'Time',
          belowRuler: (
            <button
              className="warp-view__scene-toggle"
              onClick={() => setScenesExpanded(v => !v)}
              title={scenesExpanded ? 'Collapse scenes' : 'Expand scenes'}
            >
              <span>Scenes</span>
              <span className="warp-view__scene-chevron">{scenesExpanded ? '▾' : '▸'}</span>
            </button>
          ),
          track: (
            <button
              className="warp-view__collapse-toggle"
              onClick={() => dispatch(setWarpCollapsed(!warpCollapsed))}
              title={warpCollapsed ? 'Show warp / beats / bars / speed' : 'Hide warp / beats / bars / speed'}
            >
              <span>Source</span>
              <span className="warp-view__collapse-chevron">{warpCollapsed ? '▸' : '▾'}</span>
            </button>
          ),
        }}
      />
      {warpCollapsed ? null : <><WarpConnector
        ref={connectorRef}
        segments={segments}
        view={view}
        origDuration={duration}
        outputDuration={outputDuration}
        clipIn={clipIn}
        clipOut={clipOut}
        beatClipIn={beatClipIn}
        beatClipOut={beatClipOut}
        clipFillColor={activeRegionPalette?.fill}
        boundaryColor={activeRegionPalette?.solid}
        linkedBoundaries={linkedBoundaries}
        selectedBoundaries={selectedBoundaries}
        anchors={origAnchors}
        onSelectionChange={setSelectedIds}
        railLabel="Warp"
      />
      <Timeline
        flip
        duration={outputDuration}
        trimAt={trimToLoop ? effectiveOutputDuration : undefined}
        bpm={bpm}
        gridDiv={gridDiv}
        anchors={quantAnchors}
        onAnchorsChange={handleBeatChange}
        snapInterval={beat}
        snapOffset={beatOffset}
        musicalRuler
        noAdd
        noRemove
        onAnchorDblClick={handleBeatAnchorReset}
        getBounds={getBeatAnchorBounds}
        view={view}
        onViewChange={handleViewChange}
        maxDuration={maxDuration}
        anchorZeroId={clipIn !== undefined ? (effectiveBeatZeroId ?? undefined) : undefined}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIdsBeat}
        primarySelection={selectionOrigin === 'beat'}
        onAnchorContextMenu={handleAnchorContextMenu}
        playhead={beatPlayhead}
        onRulerClick={seekFromBeat}
        onAnchorClick={seekFromBeat}
        onTrackScrub={seekFromBeat}
        clipIn={beatClipIn}
        clipOut={beatClipOut}
        clipOverlays={beatClipOverlays}
        onClipOverlaySelect={onClipOverlaySelect}
        onClipOverlayContextMenu={onClipOverlayContextMenu}
        onClipOverlayResize={(id, inP, outP) => {
          if (activeRegion && clipOverlays?.find(c => c.id === id)) {
            dispatch(updateRegionBeatTimes({ id: activeRegion.id, inBeatTime: inP, outBeatTime: outP }))
          }
        }}
        beatRangeStart={beatClipIn}
        beatRangeEnd={beatClipOut}
        linkedAnchorIds={linkedAnchorIds}
        clipResizeSnapTargets={clipIn !== undefined ? [clipIn, clipOut ?? duration] : undefined}
        clipResizeNoGridSnap={regionLock === 'beats'}
        belowRulerContent={
          <SpeedStrip
            segments={segments}
            view={view}
            outputDuration={outputDuration}
          />
        }
        throughlines={quantAnchors.map(a => a.time)}
        rowLabels={{
          track: 'Beats',
          ruler: 'Bars',
          belowRuler: 'Speed',
        }}
      /></>}
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
