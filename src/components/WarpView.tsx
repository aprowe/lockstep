import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties } from 'react'
import { analyzeAnchors } from '../api/warp'
import Timeline, { newAnchorId, bumpAnchorIdCounter } from './Timeline'
import WarpConnector from './WarpConnector'
import ContextMenu from './ContextMenu'
import type { ContextMenuState } from './ContextMenu'
import {
  buildSegments,
  computeOutputDuration,
  origBands,
  quantBands,
  snapAllToBeat,
} from '../utils/quantize'
import { clampView, initialView } from '../utils/view'
import type { Anchor, View, WarpData } from '../types'
import type { ClipOverlay } from './Timeline'
import './WarpView.css'

interface HistoryEntry {
  origAnchors: Anchor[]
  beatAnchors: Anchor[]
  linkedBeat: number[]
  beatZeroId: number | null
}

interface WarpViewProps {
  duration?: number
  initialBpm?: number
  initialMinStretch?: number
  initialMaxStretch?: number
  addToEnd?: boolean
  initialBeatZeroAnchorTime?: number
  initialOrigAnchors?: Anchor[]
  initialBeatAnchors?: Anchor[]
  playhead?: number
  onSeek?: (time: number) => void
  onDataChange?: (data: WarpData) => void
  videoPath?: string
  trimToLoop?: boolean
  loopBeats?: number | null
  gridDiv?: number
  selectedIds?: Set<number>
  onSelectionChange?: (ids: Set<number>) => void
  clipIn?: number
  clipOut?: number
  onSendToNewRegion?: (inPoint: number, outPoint: number) => void
  /** Clip blocks to overlay on the orig timeline */
  /** If set, overrides the default initial view on mount */
  initialViewOverride?: View
  clipOverlays?: ClipOverlay[]
  onClipOverlaySelect?: (id: string) => void
  onClipOverlayCreate?: (inPoint: number, outPoint: number) => void
  onClipOverlayResize?: (id: string, inPoint: number, outPoint: number) => void
  onClipOverlayMove?: (id: string, inPoint: number, outPoint: number) => void
}

export interface WarpViewHandle {
  addAnchor(time: number): void
  clearAnchors(): void
  resetAllLinks(): void
  setBpm(b: number): void
  setMinStretch(v: number): void
  setMaxStretch(v: number): void
  exportMarkers(): void
  triggerImport(): void
  detectBpm(): Promise<number | null>
  snapToBeat(): void
  deleteSelected(ids: Set<number>): void
  resetSelected(ids: Set<number>): void
  snapSelected(ids: Set<number>): void
  undo(): void
  redo(): void
  selectAll(): void
  deselect(): void
  zoomIn(): void
  zoomOut(): void
  zoomToFit(): void
  zoomToRegion(from: number, to: number): void
}

const WarpView = forwardRef<WarpViewHandle, WarpViewProps>(function WarpView({
  duration = 60,
  initialBpm = 120,
  initialMinStretch,
  initialMaxStretch,
  addToEnd = false,
  initialBeatZeroAnchorTime,
  initialOrigAnchors,
  initialBeatAnchors,
  playhead,
  onSeek,
  onDataChange,
  videoPath,
  trimToLoop = false,
  loopBeats,
  gridDiv = 1,
  selectedIds: selectedIdsProp,
  onSelectionChange: onSelectionChangeProp,
  clipIn,
  clipOut,
  onSendToNewRegion,
  initialViewOverride,
  clipOverlays,
  onClipOverlaySelect,
  onClipOverlayCreate,
  onClipOverlayResize,
  onClipOverlayMove,
}, ref) {
  // Selection: use props if provided, else internal state
  const [internalSelectedIds, setInternalSelectedIds] = useState<Set<number>>(new Set())
  const selectedIds = selectedIdsProp ?? internalSelectedIds
  const setSelectedIds = onSelectionChangeProp ?? setInternalSelectedIds
  const [origAnchors, setOrigAnchors] = useState<Anchor[]>(() => {
    const anchors = initialOrigAnchors ?? []
    bumpAnchorIdCounter(anchors)
    return anchors
  })
  const [beatAnchors, setBeatAnchors] = useState<Anchor[]>(() => {
    const anchors = initialBeatAnchors ?? []
    bumpAnchorIdCounter(anchors)
    return anchors
  })
  const linkedBeat = useRef<Set<number>>(new Set())

  const historyStack = useRef<HistoryEntry[]>([{
    origAnchors: initialOrigAnchors ?? [],
    beatAnchors: initialBeatAnchors ?? [],
    linkedBeat: [],
    beatZeroId: null,
  }])
  const historyIdx = useRef(0)
  const isApplyingHistory = useRef(false)
  const [view, setView] = useState<View>(() => initialViewOverride ?? initialView(duration, initialBpm))
  const [bpm, setBpm] = useState(initialBpm)
  const [minStretch, setMinStretch] = useState(initialMinStretch ?? 0.5)
  const [maxStretch, setMaxStretch] = useState(initialMaxStretch ?? 2.0)
  const [beatZeroId, setBeatZeroId] = useState<number | null>(() => {
    if (initialBeatZeroAnchorTime == null || !initialBeatAnchors) return null
    const match = initialBeatAnchors.find(a => Math.abs(a.time - initialBeatZeroAnchorTime) < 0.001)
    return match?.id ?? null
  })

  useEffect(() => {
    const timer = setTimeout(() => {
      if (isApplyingHistory.current) { isApplyingHistory.current = false; return }
      const entry: HistoryEntry = {
        origAnchors: [...origAnchors],
        beatAnchors: [...beatAnchors],
        linkedBeat: [...linkedBeat.current],
        beatZeroId,
      }
      const cur = historyStack.current[historyIdx.current]
      if (cur &&
          cur.origAnchors.length === entry.origAnchors.length &&
          cur.beatAnchors.length === entry.beatAnchors.length &&
          cur.beatZeroId === entry.beatZeroId &&
          cur.origAnchors.every((a, i) => a.id === entry.origAnchors[i].id && Math.abs(a.time - entry.origAnchors[i].time) < 0.0001) &&
          cur.beatAnchors.every((a, i) => a.id === entry.beatAnchors[i].id && Math.abs(a.time - entry.beatAnchors[i].time) < 0.0001)) return
      historyStack.current = historyStack.current.slice(0, historyIdx.current + 1)
      historyStack.current.push(entry)
      if (historyStack.current.length > 100) historyStack.current.shift()
      historyIdx.current = historyStack.current.length - 1
    }, 400)
    return () => clearTimeout(timer)
  }, [origAnchors, beatAnchors, beatZeroId]) // eslint-disable-line react-hooks/exhaustive-deps

  const undo = useCallback(() => {
    if (historyIdx.current <= 0) return
    historyIdx.current--
    const entry = historyStack.current[historyIdx.current]
    isApplyingHistory.current = true
    setOrigAnchors(entry.origAnchors)
    setBeatAnchors(entry.beatAnchors)
    linkedBeat.current = new Set(entry.linkedBeat)
    setBeatZeroId(entry.beatZeroId)
  }, [])

  const redo = useCallback(() => {
    if (historyIdx.current >= historyStack.current.length - 1) return
    historyIdx.current++
    const entry = historyStack.current[historyIdx.current]
    isApplyingHistory.current = true
    setOrigAnchors(entry.origAnchors)
    setBeatAnchors(entry.beatAnchors)
    linkedBeat.current = new Set(entry.linkedBeat)
    setBeatZeroId(entry.beatZeroId)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement
      const inInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')
      if (!inInput && (e.key === 'Delete' || e.key === 'Backspace')) {
        const ids = selectedIdsRef.current
        if (ids.size > 0) {
          e.preventDefault()
          ids.forEach(id => linkedBeat.current.delete(id))
          setOrigAnchors(prev => prev.filter(a => !ids.has(a.id)))
          setBeatAnchors(prev => prev.filter(a => !ids.has(a.id)))
          setSelectedIds(new Set())
        }
        return
      }
      if (!e.ctrlKey && !e.metaKey) return
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, setSelectedIds])

  const beat = 60 / bpm

  const sortedOrig = useMemo(
    () => [...origAnchors].sort((a, b) => a.time - b.time),
    [origAnchors],
  )
  const sortedBeat = useMemo(
    () => sortedOrig.map(oa => beatAnchors.find(ba => ba.id === oa.id)!).filter(Boolean),
    [sortedOrig, beatAnchors],
  )

  const outputDuration = useMemo(
    () => computeOutputDuration(sortedOrig, sortedBeat, duration),
    [sortedOrig, sortedBeat, duration],
  )

  const effectiveBeatZeroId = useMemo(() => {
    if (beatZeroId !== null && sortedBeat.some(a => a.id === beatZeroId)) return beatZeroId
    // In clip mode, no default zero — clip inPoint is implicitly beat zero
    if (clipIn !== undefined) return null
    return sortedBeat[0]?.id ?? null
  }, [beatZeroId, sortedBeat, clipIn])

  const beatOffset = useMemo(
    () => {
      // Full video: no beat-zero concept, just start from first anchor
      if (clipIn === undefined) return sortedBeat[0]?.time ?? 0
      // Clip mode: if a marker is designated as beat-zero, use it; otherwise clipIn
      if (beatZeroId !== null) {
        const z = sortedBeat.find(a => a.id === beatZeroId)
        if (z) return z.time
      }
      return clipIn
    },
    [clipIn, sortedBeat, beatZeroId],
  )

  const firstBeatTime = sortedBeat[0]?.time ?? 0
  const preBeatDur = beatOffset - firstBeatTime


  useEffect(() => {
    const firstOrig = [...origAnchors].sort((a, b) => a.time - b.time)[0]
    const offset = firstOrig ? beatAnchors.find(b => b.id === firstOrig.id)?.time ?? 0 : 0
    setBeatAnchors(prev =>
      prev.map(ba => {
        if (linkedBeat.current.has(ba.id)) return ba
        const snapped = offset + Math.round((ba.time - offset) / beat) * beat
        return { ...ba, time: snapped }
      }),
    )
  }, [bpm]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onDataChange?.({ origAnchors, beatAnchors, bpm, minStretch, maxStretch, beatZeroTime: beatOffset, addToEnd })
  }, [origAnchors, beatAnchors, bpm, minStretch, maxStretch, beatOffset, addToEnd]) // eslint-disable-line react-hooks/exhaustive-deps

  const effectiveOutputDuration = trimToLoop && beat > 0
    ? Math.floor(outputDuration / beat) * beat
    : outputDuration

  const maxDuration = Math.max(duration, outputDuration)

  const segments = useMemo(() => {
    // When a clip is active, inject its boundaries as synthetic anchors
    // so the connector draws trapezoids from clipIn→firstMarker and lastMarker→clipOut
    if (clipIn === undefined && clipOut === undefined) {
      return buildSegments(sortedOrig, sortedBeat, duration, outputDuration)
    }
    // Piecewise-linear interpolation helper (inline to avoid circular deps)
    const interpOrigToBeat = (t: number): number => {
      if (sortedOrig.length === 0) return t
      if (t <= sortedOrig[0].time) {
        if (sortedOrig.length < 2) return sortedBeat[0]?.time ?? t
        const o0 = sortedOrig[0].time, o1 = sortedOrig[1].time
        const b0 = sortedBeat[0].time, b1 = sortedBeat[1].time
        const rate = o1 > o0 ? (b1 - b0) / (o1 - o0) : 1
        return b0 + (t - o0) * rate
      }
      for (let i = 0; i < sortedOrig.length - 1; i++) {
        const o0 = sortedOrig[i].time, o1 = sortedOrig[i + 1].time
        const b0 = sortedBeat[i].time, b1 = sortedBeat[i + 1].time
        if (t >= o0 && t <= o1) {
          const frac = o1 > o0 ? (t - o0) / (o1 - o0) : 0
          return b0 + frac * (b1 - b0)
        }
      }
      const last = sortedOrig.length - 1
      const o0 = sortedOrig[last - 1]?.time ?? 0, o1 = sortedOrig[last].time
      const b0 = sortedBeat[last - 1]?.time ?? 0, b1 = sortedBeat[last].time
      const rate = o1 > o0 ? (b1 - b0) / (o1 - o0) : 1
      return b1 + (t - o1) * rate
    }
    const augOrig = [...sortedOrig]
    const augBeat = [...sortedBeat]
    const EPS = 1e-6
    if (clipIn !== undefined && (augOrig.length === 0 || augOrig[0].time - clipIn > EPS)) {
      augOrig.unshift({ id: -9998, time: clipIn })
      augBeat.unshift({ id: -9998, time: interpOrigToBeat(clipIn) })
    }
    if (clipOut !== undefined && (augOrig.length === 0 || clipOut - augOrig[augOrig.length - 1].time > EPS)) {
      augOrig.push({ id: -9999, time: clipOut })
      augBeat.push({ id: -9999, time: interpOrigToBeat(clipOut) })
    }
    return buildSegments(augOrig, augBeat, duration, outputDuration)
  }, [sortedOrig, sortedBeat, duration, outputDuration, clipIn, clipOut])

  // Piecewise-linear mapping: source time → beat time and vice versa
  const origToBeat = useCallback((t: number): number => {
    if (sortedOrig.length === 0) return t
    for (let i = 0; i < sortedOrig.length - 1; i++) {
      const o0 = sortedOrig[i].time, o1 = sortedOrig[i + 1].time
      const b0 = sortedBeat[i].time, b1 = sortedBeat[i + 1].time
      if (t >= o0 && t <= o1) {
        const frac = o1 > o0 ? (t - o0) / (o1 - o0) : 0
        return b0 + frac * (b1 - b0)
      }
    }
    // Before first or after last anchor — linear extrapolation from nearest segment
    if (t < sortedOrig[0].time && sortedOrig.length >= 2) {
      const o0 = sortedOrig[0].time, o1 = sortedOrig[1].time
      const b0 = sortedBeat[0].time, b1 = sortedBeat[1].time
      const rate = o1 > o0 ? (b1 - b0) / (o1 - o0) : 1
      return b0 + (t - o0) * rate
    }
    const last = sortedOrig.length - 1
    if (t > sortedOrig[last].time && last >= 1) {
      const o0 = sortedOrig[last - 1].time, o1 = sortedOrig[last].time
      const b0 = sortedBeat[last - 1].time, b1 = sortedBeat[last].time
      const rate = o1 > o0 ? (b1 - b0) / (o1 - o0) : 1
      return b1 + (t - o1) * rate
    }
    return sortedBeat[0]?.time ?? t
  }, [sortedOrig, sortedBeat])

  const beatToOrig = useCallback((t: number): number => {
    if (sortedBeat.length === 0) return t
    for (let i = 0; i < sortedBeat.length - 1; i++) {
      const b0 = sortedBeat[i].time, b1 = sortedBeat[i + 1].time
      const o0 = sortedOrig[i].time, o1 = sortedOrig[i + 1].time
      if (t >= b0 && t <= b1) {
        const frac = b1 > b0 ? (t - b0) / (b1 - b0) : 0
        return o0 + frac * (o1 - o0)
      }
    }
    if (t < sortedBeat[0].time && sortedBeat.length >= 2) {
      const b0 = sortedBeat[0].time, b1 = sortedBeat[1].time
      const o0 = sortedOrig[0].time, o1 = sortedOrig[1].time
      const rate = b1 > b0 ? (o1 - o0) / (b1 - b0) : 1
      return o0 + (t - b0) * rate
    }
    const last = sortedBeat.length - 1
    if (t > sortedBeat[last].time && last >= 1) {
      const b0 = sortedBeat[last - 1].time, b1 = sortedBeat[last].time
      const o0 = sortedOrig[last - 1].time, o1 = sortedOrig[last].time
      const rate = b1 > b0 ? (o1 - o0) / (b1 - b0) : 1
      return o1 + (t - b1) * rate
    }
    return sortedOrig[0]?.time ?? t
  }, [sortedOrig, sortedBeat])

  const beatPlayhead = useMemo(
    () => playhead !== undefined ? origToBeat(playhead) : undefined,
    [playhead, origToBeat],
  )

  const seekFromBeat = useCallback(
    (beatTime: number) => onSeek?.(Math.max(0, Math.min(duration, beatToOrig(beatTime)))),
    [onSeek, duration, beatToOrig],
  )

  const handleViewChange = useCallback(
    (v: View) => setView(clampView(v.start, v.end, maxDuration)),
    [maxDuration],
  )

  // ── Shift+drag-to-pan anywhere in the WarpView ─────────────────────────────

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const warpContainerRef = useRef<HTMLDivElement>(null)
  const connectorRef = useRef<HTMLDivElement>(null)
  const [shiftHeld, setShiftHeld] = useState(false)
  const [panning, setPanning] = useState(false)
  const [mouseOver, setMouseOver] = useState(false)
  const panGesture = useRef<{ lastX: number; width: number } | null>(null)
  // Stable refs so capture-phase handlers never go stale
  const viewRef = useRef(view); viewRef.current = view
  const maxDurationRef = useRef(maxDuration); maxDurationRef.current = maxDuration
  const handleViewChangeRef = useRef(handleViewChange); handleViewChangeRef.current = handleViewChange

  // Scroll-zoom on the warp connector (mirrors Timeline's wheel handler)
  useEffect(() => {
    const el = connectorRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      if (!e.shiftKey) return
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
      if (!e.shiftKey || e.button !== 0) return
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
  }, []) // stable via refs

  const handleOrigChange = (next: Anchor[]) => {
    const prevIds = new Set(origAnchors.map(a => a.id))
    const nextIds = new Set(next.map(a => a.id))
    const added = next.filter(a => !prevIds.has(a.id))
    const removedIds = [...prevIds].filter(id => !nextIds.has(id))
    const moved = next.filter(a => {
      const prev = origAnchors.find(p => p.id === a.id)
      return prev && prev.time !== a.time
    })

    for (const a of added) linkedBeat.current.add(a.id)
    for (const id of removedIds) {
      linkedBeat.current.delete(id)
      if (id === beatZeroId) setBeatZeroId(null)
    }

    setBeatAnchors(prev => {
      const addedIds = new Set(added.map(a => a.id))
      // Remove deleted anchors AND any stale entries matching new anchor IDs
      let updated = prev.filter(a => !removedIds.includes(a.id) && !addedIds.has(a.id))
      for (const a of added) {
        updated = [...updated, { id: a.id, time: a.time }]
      }
      for (const m of moved) {
        if (linkedBeat.current.has(m.id)) {
          updated = updated.map(ba => ba.id === m.id ? { ...ba, time: m.time } : ba)
        }
      }
      return updated
    })
    setOrigAnchors(next)
  }

  // Stable refs so imperative handle methods always see current values
  const beatRef = useRef(beat)
  beatRef.current = beat
  const gridDivRef = useRef(gridDiv)
  gridDivRef.current = gridDiv
  const beatOffsetRef = useRef(beatOffset)
  beatOffsetRef.current = beatOffset
  const origAnchorsRef = useRef(origAnchors); origAnchorsRef.current = origAnchors
  const beatAnchorsRef = useRef(beatAnchors); beatAnchorsRef.current = beatAnchors
  const selectedIdsRef = useRef(selectedIds); selectedIdsRef.current = selectedIds

  const importRef = useRef<HTMLInputElement>(null)

  const exportMarkers = useCallback(() => {
    const beatZeroAnchorTime = beatAnchors.find(a => a.id === effectiveBeatZeroId)?.time
    const payload = {
      origAnchors, beatAnchors, bpm, minStretch, maxStretch, addToEnd,
      ...(beatZeroAnchorTime != null ? { beatZeroAnchorTime } : {}),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `markers_${Math.round(bpm)}bpm.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [origAnchors, beatAnchors, bpm, minStretch, maxStretch, addToEnd, effectiveBeatZeroId])

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
        linkedBeat.current.clear()
        setOrigAnchors(newOrig)
        setBeatAnchors(newBeat)
        if (data.bpm > 0) setBpm(data.bpm)
        if (data.minStretch > 0) setMinStretch(data.minStretch)
        if (data.maxStretch > 0) setMaxStretch(data.maxStretch)
        if (data.beatZeroAnchorTime != null) {
          const match = newBeat.find(a => Math.abs(a.time - data.beatZeroAnchorTime) < 0.001)
          setBeatZeroId(match?.id ?? null)
        } else {
          setBeatZeroId(null)
        }
      } catch { /* invalid JSON */ }
    }
    reader.readAsText(file)
    e.target.value = ''
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleBeatChange = useCallback((next: Anchor[]) => {
    for (const a of next) {
      const prev = beatAnchors.find(b => b.id === a.id)
      if (prev && prev.time !== a.time) linkedBeat.current.delete(a.id)
    }
    setBeatAnchors(next)
  }, [beatAnchors])

  const handleBeatAnchorReset = useCallback(
    (id: number) => {
      const orig = origAnchors.find(a => a.id === id)
      if (!orig) return
      linkedBeat.current.add(id)
      setBeatAnchors(prev => prev.map(a => a.id === id ? { ...a, time: orig.time } : a))
    },
    [origAnchors],
  )

  const handleSetBeatZero = useCallback(
    (id: number) => {
      // Toggle off if already the zero marker
      setBeatZeroId(prev => prev === id ? null : id)
    },
    [],
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
        min = Math.max(min, prevBeat + minStretch * origSpan)
        max = Math.min(max, prevBeat + maxStretch * origSpan)
      }
      if (origIdx < sortedOrig.length - 1) {
        const origSpan = sortedOrig[origIdx + 1].time - sortedOrig[origIdx].time
        const nextBeat = sortedBeat[beatIdx + 1]?.time ?? outputDuration
        min = Math.max(min, nextBeat - maxStretch * origSpan)
        max = Math.min(max, nextBeat - minStretch * origSpan)
      }
      return { min, max }
    },
    [sortedBeat, sortedOrig, minStretch, maxStretch, outputDuration, effectiveBeatZeroId],
  )

  const quantAnchors: Anchor[] = useMemo(
    () => sortedBeat.map(a => ({ id: a.id, time: a.time })),
    [sortedBeat],
  )

  useImperativeHandle(ref, () => ({
    addAnchor(time: number) {
      const clamped = Math.max(0, Math.min(duration, time))
      handleOrigChange([...origAnchors, { id: newAnchorId(), time: clamped }])
    },
    clearAnchors() {
      linkedBeat.current.clear()
      setOrigAnchors([])
      setBeatAnchors([])
    },
    resetAllLinks() {
      setOrigAnchors(prev => {
        setBeatAnchors(prev.map(a => ({ ...a })))
        prev.forEach(a => linkedBeat.current.add(a.id))
        return prev
      })
    },
    deleteSelected(ids: Set<number>) {
      if (ids.size === 0) return
      ids.forEach(id => linkedBeat.current.delete(id))
      setOrigAnchors(prev => prev.filter(a => !ids.has(a.id)))
      setBeatAnchors(prev => prev.filter(a => !ids.has(a.id)))
      setSelectedIds(new Set())
    },
    resetSelected(ids: Set<number>) {
      if (ids.size === 0) return
      const origMap = new Map(origAnchors.map(a => [a.id, a.time]))
      setBeatAnchors(prev => prev.map(a => {
        if (!ids.has(a.id)) return a
        linkedBeat.current.add(a.id)
        return { ...a, time: origMap.get(a.id) ?? a.time }
      }))
    },
    snapSelected(ids: Set<number>) {
      if (ids.size === 0) return
      const b = beatRef.current / gridDivRef.current
      const offset = beatOffsetRef.current
      if (!b || b <= 0) return
      setBeatAnchors(prev => {
        const toSnap = prev.filter(a => ids.has(a.id))
        const snapped = snapAllToBeat(toSnap, b, offset)
        const snapMap = new Map(snapped.map(a => [a.id, a.time]))
        return prev.map(a => {
          if (!snapMap.has(a.id)) return a
          linkedBeat.current.delete(a.id)
          return { ...a, time: snapMap.get(a.id)! }
        })
      })
    },
    setBpm(b: number) { setBpm(b) },
    setMinStretch(v: number) { setMinStretch(v) },
    setMaxStretch(v: number) { setMaxStretch(v) },
    exportMarkers,
    triggerImport() { importRef.current?.click() },
    async detectBpm(): Promise<number | null> {
      if (origAnchors.length < 2) return null
      try {
        const data = await analyzeAnchors(origAnchors.map(a => a.time))
        if (data.bpm && data.bpm > 0) { setBpm(data.bpm); return data.bpm }
      } catch {}
      return null
    },
    snapToBeat() {
      const b = beatRef.current / gridDivRef.current
      const offset = beatOffsetRef.current
      if (!b || b <= 0) return
      setBeatAnchors(prev => {
        const snapped = snapAllToBeat(prev, b, offset)
        snapped.forEach(a => linkedBeat.current.delete(a.id))
        return snapped
      })
    },
    undo,
    redo,
    selectAll() { setSelectedIds(new Set(origAnchors.map(a => a.id))) },
    deselect() { setSelectedIds(new Set()) },
    zoomIn() {
      const v = viewRef.current
      const mid = (v.start + v.end) / 2
      const span = (v.end - v.start) / 1.5
      handleViewChangeRef.current({ start: mid - span / 2, end: mid + span / 2 })
    },
    zoomOut() {
      const v = viewRef.current
      const mid = (v.start + v.end) / 2
      const span = (v.end - v.start) * 1.5
      handleViewChangeRef.current({ start: mid - span / 2, end: mid + span / 2 })
    },
    zoomToFit() {
      handleViewChangeRef.current({ start: 0, end: maxDurationRef.current })
    },
    zoomToRegion(from: number, to: number) {
      handleViewChangeRef.current({ start: from, end: to })
    },
  }), [origAnchors, duration, exportMarkers, undo, redo]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Context menu builders ─────────────────────────────────────────────────

  const handleAnchorContextMenu = useCallback((id: number, x: number, y: number) => {
    const curSel = selectedIdsRef.current
    const targetIds = curSel.has(id) ? curSel : new Set([id])
    if (!curSel.has(id)) setSelectedIds(new Set([id]))

    setContextMenu({
      x, y,
      items: [
        {
          label: targetIds.size > 1 ? `Delete ${targetIds.size} markers` : 'Delete marker',
          danger: true,
          action: () => {
            const ids = targetIds
            ids.forEach(i => linkedBeat.current.delete(i))
            setOrigAnchors(prev => prev.filter(a => !ids.has(a.id)))
            setBeatAnchors(prev => prev.filter(a => !ids.has(a.id)))
            setSelectedIds(new Set())
          },
        },
        {
          label: targetIds.size > 1 ? 'Reset links' : 'Reset link',
          action: () => {
            const ids = targetIds
            const origMap = new Map(origAnchorsRef.current.map(a => [a.id, a.time]))
            setBeatAnchors(prev => prev.map(a => {
              if (!ids.has(a.id)) return a
              linkedBeat.current.add(a.id)
              return { ...a, time: origMap.get(a.id) ?? a.time }
            }))
          },
        },
        {
          label: 'Snap to beat',
          action: () => {
            const ids = targetIds
            const b = beatRef.current / gridDivRef.current
            const offset = beatOffsetRef.current
            if (!b || b <= 0) return
            setBeatAnchors(prev => {
              const toSnap = prev.filter(a => ids.has(a.id))
              const snapped = snapAllToBeat(toSnap, b, offset)
              const snapMap = new Map(snapped.map(a => [a.id, a.time]))
              return prev.map(a => {
                if (!snapMap.has(a.id)) return a
                linkedBeat.current.delete(a.id)
                return { ...a, time: snapMap.get(a.id)! }
              })
            })
          },
        },
        ...(onSendToNewRegion ? [
          { separator: true as const },
          {
            label: 'Send to new region',
            action: () => {
              const ids = targetIds
              const selOrig = origAnchorsRef.current.filter(a => ids.has(a.id))
              if (selOrig.length === 0) return
              const times = selOrig.map(a => a.time)
              const inPoint = Math.min(...times)
              const outPoint = Math.max(...times)
              onSendToNewRegion(inPoint, outPoint)
            },
          },
        ] : []),
      ],
    })
  }, [setSelectedIds, onSendToNewRegion])

  const handleTrackContextMenu = useCallback((time: number, x: number, y: number) => {
    setContextMenu({
      x, y,
      items: [
        {
          label: 'Add marker here',
          action: () => {
            const clamped = Math.max(0, Math.min(duration, time))
            handleOrigChange([...origAnchorsRef.current, { id: newAnchorId(), time: clamped }])
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
              // Create a small region: 4 beats wide centered on click, clamped to video
              const halfSpan = Math.max(beat * 4, 2) / 2
              const inPoint = Math.max(0, time - halfSpan)
              const outPoint = Math.min(duration, time + halfSpan)
              onClipOverlayCreate(inPoint, outPoint)
            },
          },
        ] : []),
      ],
    })
  }, [duration, clipIn, clipOut, handleOrigChange, onClipOverlayCreate, beat])

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
    >
      <Timeline
        duration={duration}
        bpm={bpm}
        gridDiv={gridDiv}
        anchors={origAnchors}
        onAnchorsChange={handleOrigChange}
        bands={origBands(segments)}
        view={view}
        onViewChange={handleViewChange}
        maxDuration={maxDuration}
        playhead={playhead}
        onRulerClick={onSeek}
        onAnchorClick={onSeek}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        clipIn={clipIn}
        clipOut={clipOut}
        onAnchorContextMenu={handleAnchorContextMenu}
        onTrackContextMenu={handleTrackContextMenu}
        clipOverlays={clipOverlays}
        onClipOverlaySelect={onClipOverlaySelect}
        onClipOverlayCreate={onClipOverlayCreate}
        onClipOverlayResize={onClipOverlayResize}
        onClipOverlayMove={onClipOverlayMove}
        beatRangeStart={clipIn}
        beatRangeEnd={clipOut}
        onTrackScrub={onSeek}
      />
      <WarpConnector
        ref={connectorRef}
        segments={segments}
        view={view}
        origDuration={duration}
        outputDuration={outputDuration}
        clipIn={clipIn}
        clipOut={clipOut}
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
        bands={quantBands(segments)}
        view={view}
        onViewChange={handleViewChange}
        maxDuration={maxDuration}
        anchorZeroId={clipIn !== undefined ? (effectiveBeatZeroId ?? undefined) : undefined}
        onAnchorSetZero={clipIn !== undefined ? handleSetBeatZero : undefined}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        onAnchorContextMenu={handleAnchorContextMenu}
        playhead={beatPlayhead}
        onRulerClick={seekFromBeat}
        onAnchorClick={seekFromBeat}
        onTrackScrub={seekFromBeat}
        clipOverlays={clipOverlays}
        onClipOverlaySelect={onClipOverlaySelect}
        beatRangeStart={clipIn}
        beatRangeEnd={clipOut}
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
})

export default WarpView
