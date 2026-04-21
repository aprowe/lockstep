import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { setHoverFrames } from '../../store/slices/thumbnailsSlice'
import type { Anchor, View, WarpSegment } from '../../types'
import { clampView, timeToViewPct } from '../../utils/view'
import SceneRow from '../SceneRow'
import SpeedStrip from '../SpeedStrip'
import WarpConnector from '../WarpConnector'
import ThinMinimap from './ThinMinimap'
import ThinRuler from './ThinRuler'
import MarkersTrack from './MarkersTrack'
import BarsTrack from './BarsTrack'
import BeatsTrack from './BeatsTrack'
import RegionBand, { type RegionBlock } from './RegionBand'
import ThumbnailStripTrack from './ThumbnailStripTrack'
import ThumbnailQueueDebug from '../ThumbnailQueueDebug'
import './ThinTimeline.css'

interface ThinTimelineProps {
  duration: number
  outputDuration: number
  view: View
  onViewChange: (v: View) => void
  maxDuration: number

  playhead?: number
  beatPlayhead?: number
  onSeek?: (time: number) => void
  onSeekBeat?: (beatTime: number) => void

  anchors: Anchor[]
  selectedAnchorIds: Set<number>
  onAnchorAdd?: (time: number) => void
  onAnchorDelete?: (id: number) => void
  onAnchorSelect?: (id: number, additive: boolean) => void
  onAnchorContextMenu?: (id: number, x: number, y: number) => void
  onAnchorsChange?: (next: Anchor[]) => void

  beatAnchors: Anchor[]
  onBeatAnchorDelete?: (id: number) => void
  onBeatAnchorSelect?: (id: number, additive: boolean) => void
  onBeatAnchorContextMenu?: (id: number, x: number, y: number) => void
  onBeatAnchorsChange?: (next: Anchor[]) => void

  snapInterval?: number
  snapOffset?: number
  snapTargetsInput?: number[]
  snapTargetsOutput?: number[]

  bpm: number
  beatOffset?: number
  /** Beat subdivision (1 = beats, 2 = eighths, 4 = sixteenths). Drives the
   *  visual beat grid inside the Beat row so it actually changes when the
   *  user flips the grid dropdown. */
  gridDiv?: number

  scenes: number[]
  onSceneAdd?: (time: number) => void
  onSceneDelete?: (time: number) => void
  onSceneContextMenu?: (time: number, x: number, y: number) => void

  /** Create a new region at the clicked time (double-click on empty region band). */
  onRegionAdd?: (time: number) => void
  /** Right-click on any empty timeline body — caller shows a global menu. */
  onTimelineContextMenu?: (time: number, x: number, y: number) => void

  regions: RegionBlock[]
  regionsOutput?: RegionBlock[]
  onRegionSelect?: (id: string) => void
  onRegionContextMenu?: (id: string, x: number, y: number) => void
  onRegionResize?: (id: string, inPoint: number, outPoint: number) => void
  onRegionMove?: (id: string, inPoint: number, outPoint: number) => void
  onRegionResizeOutput?: (id: string, inBeatTime: number, outBeatTime: number) => void
  onRegionMoveOutput?: (id: string, inBeatTime: number, outBeatTime: number) => void
  /** Double-click on a region — caller zooms the view to the region. */
  onRegionZoom?: (id: string) => void

  segments: WarpSegment[]
  clipIn?: number
  clipOut?: number
  beatClipIn?: number
  beatClipOut?: number
  clipFillColor?: string
  boundaryColor?: string
  linkedBoundaries?: boolean[]
  selectedBoundaries?: boolean[]
  onConnectorSelectionChange?: (ids: Set<number>) => void

  warpCollapsed?: boolean
  onToggleWarp?: () => void
}

const DEFAULT_FLEX: Record<string, number> = {
  time: 1, clipin: 1, scenes: 1, thumbs: 1, markerin: 1,
  warp: 1, markerout: 1, clipout: 1, beat: 1, speed: 1,
}

type SectionSpace = 'input' | 'output' | 'warp'
type ThroughKind = 'anchor' | 'region' | 'scene' | 'snap'
type ThroughStyle = 'selected' | 'hover' | 'dotted' | 'snap'

interface ThroughLine {
  key: string
  /** x% in input space, or null to skip input sections. */
  inputX: number | null
  /** x% in output space, or null to skip output sections. */
  outputX: number | null
  kind: ThroughKind
  style: ThroughStyle
}

export default function ThinTimeline({
  duration, outputDuration, view, onViewChange, maxDuration,
  playhead, beatPlayhead, onSeek, onSeekBeat,
  anchors, selectedAnchorIds,
  onAnchorAdd, onAnchorDelete, onAnchorSelect, onAnchorContextMenu, onAnchorsChange,
  beatAnchors,
  onBeatAnchorDelete, onBeatAnchorSelect, onBeatAnchorContextMenu, onBeatAnchorsChange,
  snapInterval, snapOffset = 0, snapTargetsInput, snapTargetsOutput,
  bpm, beatOffset = 0, gridDiv = 1,
  scenes, onSceneAdd, onSceneDelete, onSceneContextMenu,
  onRegionAdd, onTimelineContextMenu,
  regions, regionsOutput,
  onRegionSelect, onRegionContextMenu,
  onRegionResize, onRegionMove, onRegionResizeOutput, onRegionMoveOutput, onRegionZoom,
  segments, clipIn, clipOut, beatClipIn, beatClipOut,
  clipFillColor, boundaryColor, linkedBoundaries, selectedBoundaries,
  onConnectorSelectionChange,
  warpCollapsed = false, onToggleWarp,
}: ThinTimelineProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const connectorRef = useRef<HTMLDivElement>(null)
  const [hoverPct, setHoverPct] = useState<number | null>(null)
  const [flexBy, setFlexBy] = useState<Record<string, number>>(DEFAULT_FLEX)
  const [hoveredAnchorId, setHoveredAnchorId] = useState<number | null>(null)
  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null)
  const [hoveredSceneTime, setHoveredSceneTime] = useState<number | null>(null)
  const [lassoRange, setLassoRange] = useState<{ startPct: number; endPct: number } | null>(null)
  const lassoRef = useRef<{ startPct: number; startedAdditive: boolean; initialIds: Set<number> } | null>(null)

  // Through-line visibility toggles. Markers are on by default (existing
  // behavior); regions and scenes show on interaction only unless toggled on.
  const [alwaysAnchors, setAlwaysAnchors] = useState(true)
  const [alwaysRegions, setAlwaysRegions] = useState(false)
  const [alwaysScenes, setAlwaysScenes] = useState(false)
  const [thumbStripEnabled, setThumbStripEnabled] = useState(false)
  const [queueDebugOpen, setQueueDebugOpen] = useState(false)

  // Hover frames — lowest-priority thumbnail tier. Dispatch the 5-frame window
  // under the cursor so Filmstrip's priority push picks it up. Using a ref to
  // dedupe by signature avoids flooding the store on every mousemove pixel.
  const dispatch = useAppDispatch()
  const videoFileHash = useAppSelector(s => s.video.video?.fileHash)
  const videoFps = useAppSelector(s => s.video.video?.fps ?? 0)
  const lastHoverSigRef = useRef<string>('')
  useEffect(() => {
    if (!videoFileHash || videoFps <= 0) return
    if (hoverPct === null) {
      if (lastHoverSigRef.current !== '') {
        lastHoverSigRef.current = ''
        dispatch(setHoverFrames({ fileHash: videoFileHash, frames: [] }))
      }
      return
    }
    const t = view.start + hoverPct * (view.end - view.start)
    const center = Math.max(0, Math.floor(t * videoFps))
    const frames = [center - 2, center - 1, center, center + 1, center + 2]
      .filter(f => f >= 0)
    const sig = frames.join(',')
    if (sig === lastHoverSigRef.current) return
    lastHoverSigRef.current = sig
    dispatch(setHoverFrames({ fileHash: videoFileHash, frames }))
  }, [dispatch, videoFileHash, videoFps, hoverPct, view.start, view.end])
  // Playhead-follows-drag: when on, dragging a marker moves the playhead too.
  const [followDrag, setFollowDrag] = useState(false)

  const onInDragTime = useCallback(
    (t: number | null) => { if (followDrag && t !== null) onSeek?.(t) },
    [followDrag, onSeek],
  )
  const onOutDragTime = useCallback(
    (t: number | null) => { if (followDrag && t !== null) onSeekBeat?.(t) },
    [followDrag, onSeekBeat],
  )

  // Live snap hints reported by the currently-dragging row.
  const [snapHintsIn, setSnapHintsIn] = useState<number[]>([])
  const [snapHintsOut, setSnapHintsOut] = useState<number[]>([])
  const onInSnapHints = useCallback(
    (t: number[] | null) => setSnapHintsIn(t ?? []),
    [],
  )
  const onOutSnapHints = useCallback(
    (t: number[] | null) => setSnapHintsOut(t ?? []),
    [],
  )

  const throughLines = useMemo<ThroughLine[]>(() => {
    const out: ThroughLine[] = []

    const origById = new Map(anchors.map(a => [a.id, a.time]))
    const beatById = new Map(beatAnchors.map(a => [a.id, a.time]))
    const anchorIds = new Set<number>([...origById.keys(), ...beatById.keys()])
    for (const id of anchorIds) {
      const selected = selectedAnchorIds.has(id)
      const hovered = hoveredAnchorId === id
      if (!selected && !hovered && !alwaysAnchors) continue
      const inT = origById.get(id)
      const outT = beatById.get(id)
      out.push({
        key: `a-${id}`,
        inputX: inT !== undefined ? timeToViewPct(inT, view) : null,
        outputX: outT !== undefined ? timeToViewPct(outT, view) : null,
        kind: 'anchor',
        style: selected ? 'selected' : hovered ? 'hover' : 'dotted',
      })
    }

    const regSeen = new Set<string>()
    const pushRegion = (rid: string, style: ThroughStyle) => {
      if (regSeen.has(rid)) return
      regSeen.add(rid)
      const rIn = regions.find(r => r.id === rid)
      const rOut = regionsOutput?.find(r => r.id === rid)
      if (!rIn && !rOut) return
      const inStart = rIn?.inPoint ?? rOut!.inPoint
      const inEnd = rIn?.outPoint ?? rOut!.outPoint
      const outStart = rOut?.inPoint ?? inStart
      const outEnd = rOut?.outPoint ?? inEnd
      out.push({
        key: `r-${rid}-in`,
        inputX: timeToViewPct(inStart, view),
        outputX: timeToViewPct(outStart, view),
        kind: 'region',
        style,
      })
      out.push({
        key: `r-${rid}-out`,
        inputX: timeToViewPct(inEnd, view),
        outputX: timeToViewPct(outEnd, view),
        kind: 'region',
        style,
      })
    }
    for (const r of regions) if (r.active) pushRegion(r.id, 'selected')
    if (hoveredRegionId) pushRegion(hoveredRegionId, 'hover')
    if (alwaysRegions) {
      for (const r of regions) pushRegion(r.id, 'dotted')
    }

    // Scenes live in input space only — output side stays null so the line
    // does not continue past the warp row.
    const scenesToShow = new Set<number>()
    if (alwaysScenes) for (const s of scenes) scenesToShow.add(s)
    if (hoveredSceneTime !== null) scenesToShow.add(hoveredSceneTime)
    for (const t of scenesToShow) {
      const style: ThroughStyle = hoveredSceneTime === t ? 'hover' : 'dotted'
      out.push({
        key: `sc-${t}`,
        inputX: timeToViewPct(t, view),
        outputX: null,
        kind: 'scene',
        style,
      })
    }

    for (const t of snapHintsIn) {
      out.push({
        key: `snap-in-${t}`,
        inputX: timeToViewPct(t, view),
        outputX: null,
        kind: 'snap',
        style: 'snap',
      })
    }
    for (const t of snapHintsOut) {
      out.push({
        key: `snap-out-${t}`,
        inputX: null,
        outputX: timeToViewPct(t, view),
        kind: 'snap',
        style: 'snap',
      })
    }

    return out
  }, [
    anchors, beatAnchors, selectedAnchorIds, hoveredAnchorId,
    hoveredRegionId, regions, regionsOutput,
    scenes, hoveredSceneTime,
    alwaysAnchors, alwaysRegions, alwaysScenes,
    snapHintsIn, snapHintsOut,
    view,
  ])

  // Pre-partition by space so each section only iterates the subset it needs
  // to render. Big win when there are many markers and many sections.
  const inputLines = useMemo(() => throughLines.filter(tl => tl.inputX !== null), [throughLines])
  const outputLines = useMemo(() => throughLines.filter(tl => tl.outputX !== null), [throughLines])
  const warpLines = useMemo(
    () => throughLines.filter(tl => tl.inputX !== null && tl.outputX !== null),
    [throughLines],
  )

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = rootRef.current
    if (!el) return
    e.preventDefault()
    const body = el.querySelector<HTMLDivElement>('.thin-row__body')
    const rect = body ? body.getBoundingClientRect() : el.getBoundingClientRect()
    const span = view.end - view.start
    const cursorTime = view.start + ((e.clientX - rect.left) / rect.width) * span
    const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15
    const newSpan = span * factor
    const ratio = (cursorTime - view.start) / span
    const ns = cursorTime - ratio * newSpan
    onViewChange(clampView(ns, ns + newSpan, maxDuration))
  }, [view.start, view.end, maxDuration, onViewChange])

  const playheadInX = useMemo(() => {
    if (playhead === undefined) return null
    return timeToViewPct(playhead, view)
  }, [playhead, view])

  const playheadOutX = useMemo(() => {
    const t = beatPlayhead ?? playhead
    if (t === undefined) return null
    return timeToViewPct(t, view)
  }, [beatPlayhead, playhead, view])

  const onBodyMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const body = (e.currentTarget.querySelector('.thin-row__body') as HTMLElement | null)
      ?? e.currentTarget
    const rect = body.getBoundingClientRect()
    const pct = (e.clientX - rect.left) / rect.width
    setHoverPct(Math.max(0, Math.min(1, pct)))
  }, [])

  // ── Selection lasso ───────────────────────────────────────────────────────
  const bodyPctFromClientX = useCallback((clientX: number): number | null => {
    const body = rootRef.current?.querySelector('.thin-row__body') as HTMLElement | null
    if (!body) return null
    const rect = body.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  }, [])

  const isLassoTarget = useCallback((target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false
    if (target.closest('button')) return false
    if (target.closest('.thin-region')) return false
    if (target.closest('.thin-timeline__toolbar')) return false
    if (target.closest('.thin-timeline__resizer')) return false
    if (target.closest('.thin-minimap')) return false
    if (target.closest('.warp-connector')) return false
    if (target.closest('.thumb-queue-debug')) return false
    return true
  }, [])

  const computeLassoIds = useCallback((startPct: number, endPct: number): Set<number> => {
    const span = view.end - view.start
    const lo = view.start + Math.min(startPct, endPct) * span
    const hi = view.start + Math.max(startPct, endPct) * span
    const ids = new Set<number>()
    for (const a of anchors) if (a.time >= lo && a.time <= hi) ids.add(a.id)
    for (const a of beatAnchors) if (a.time >= lo && a.time <= hi) ids.add(a.id)
    return ids
  }, [anchors, beatAnchors, view.start, view.end])

  const onRootPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    if (e.shiftKey && !e.ctrlKey && !e.metaKey) return // shift+drag = pan
    if (!isLassoTarget(e.target)) return
    const pct = bodyPctFromClientX(e.clientX)
    if (pct === null) return
    const additive = e.ctrlKey || e.metaKey
    const initialIds = additive ? new Set(selectedAnchorIds) : new Set<number>()
    lassoRef.current = { startPct: pct, startedAdditive: additive, initialIds }
    rootRef.current?.setPointerCapture(e.pointerId)
    setLassoRange({ startPct: pct, endPct: pct })
    if (!additive) onConnectorSelectionChange?.(new Set())
  }, [isLassoTarget, bodyPctFromClientX, selectedAnchorIds, onConnectorSelectionChange])

  const onRootPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const g = lassoRef.current
    if (!g) return
    const pct = bodyPctFromClientX(e.clientX)
    if (pct === null) return
    setLassoRange({ startPct: g.startPct, endPct: pct })
    const hit = computeLassoIds(g.startPct, pct)
    const merged = new Set(g.initialIds)
    for (const id of hit) merged.add(id)
    onConnectorSelectionChange?.(merged)
  }, [bodyPctFromClientX, computeLassoIds, onConnectorSelectionChange])

  const onRootPointerUp = useCallback(() => {
    if (!lassoRef.current) return
    lassoRef.current = null
    setLassoRange(null)
  }, [])

  const onRootContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!onTimelineContextMenu) return
    if (!isLassoTarget(e.target)) return
    const pct = bodyPctFromClientX(e.clientX)
    if (pct === null) return
    e.preventDefault()
    const t = view.start + pct * (view.end - view.start)
    onTimelineContextMenu(t, e.clientX, e.clientY)
  }, [onTimelineContextMenu, isLassoTarget, bodyPctFromClientX, view.start, view.end])

  const onResizeStart = useCallback((e: React.PointerEvent<HTMLDivElement>, aboveId: string, belowId: string) => {
    e.preventDefault()
    e.stopPropagation()
    const container = rootRef.current
    if (!container) return
    const aboveEl = container.querySelector<HTMLDivElement>(`[data-section="${aboveId}"]`)
    const belowEl = container.querySelector<HTMLDivElement>(`[data-section="${belowId}"]`)
    if (!aboveEl || !belowEl) return
    const hAbove = aboveEl.getBoundingClientRect().height
    const hBelow = belowEl.getBoundingClientRect().height
    const hSum = hAbove + hBelow
    if (hSum <= 0) return
    const startY = e.clientY
    const sAbove = flexBy[aboveId]
    const sBelow = flexBy[belowId]
    const fSum = sAbove + sBelow
    const MIN_PX = 14
    const onMove = (ev: PointerEvent) => {
      const dy = ev.clientY - startY
      const nAbove = Math.max(MIN_PX, Math.min(hSum - MIN_PX, hAbove + dy))
      const fAbove = (nAbove / hSum) * fSum
      const fBelow = fSum - fAbove
      setFlexBy(prev => ({ ...prev, [aboveId]: fAbove, [belowId]: fBelow }))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    document.body.style.cursor = 'ns-resize'
  }, [flexBy])

  const sections: Array<{ id: string; space: SectionSpace; node: React.ReactNode }> = []

  sections.push({
    id: 'time',
    space: 'input',
    node: (
      <ThinRuler
        label="Time"
        view={view}
        duration={duration}
        playhead={playhead}
        onSeek={onSeek}
      />
    ),
  })
  sections.push({
    id: 'clipin',
    space: 'input',
    node: (
      <RegionBand
        label="Clip In"
        kind="input"
        regions={regions}
        view={view}
        snapTargets={snapTargetsInput}
        onSelect={onRegionSelect}
        onContextMenu={onRegionContextMenu}
        onResize={onRegionResize}
        onMove={onRegionMove}
        onZoom={onRegionZoom}
        onHoverChange={setHoveredRegionId}
        onSnapHintsChange={onInSnapHints}
        onBackgroundAdd={onRegionAdd}
        onBackgroundContextMenu={onTimelineContextMenu}
      />
    ),
  })
  sections.push({
    id: 'scenes',
    space: 'input',
    node: (
      <div className="thin-timeline__scene-wrapper">
        <div className="thin-row__rail thin-row__rail--inline">Scenes</div>
        <div className="thin-timeline__scene-body">
          <SceneRow
            scenes={scenes}
            view={view}
            duration={duration}
            playhead={playhead}
            onSceneClick={onSeek}
            onSceneHover={setHoveredSceneTime}
            onSceneAdd={onSceneAdd}
            onSceneDelete={onSceneDelete}
            onSceneContextMenu={onSceneContextMenu}
            onBackgroundContextMenu={onTimelineContextMenu}
          />
        </div>
      </div>
    ),
  })
  if (thumbStripEnabled) {
    sections.push({
      id: 'thumbs',
      space: 'input',
      node: (
        <ThumbnailStripTrack
          scenes={scenes}
          duration={duration}
          view={view}
          onSeek={onSeek}
        />
      ),
    })
  }
  sections.push({
    id: 'markerin',
    space: 'input',
    node: (
      <MarkersTrack
        label="Marker In"
        anchors={anchors}
        view={view}
        duration={duration}
        selectedIds={selectedAnchorIds}
        snapTargets={snapTargetsInput}
        onSeek={onSeek}
        onAdd={onAnchorAdd}
        onDelete={onAnchorDelete}
        onSelect={onAnchorSelect}
        onContextMenu={onAnchorContextMenu}
        onBackgroundContextMenu={onTimelineContextMenu}
        onAnchorsChange={onAnchorsChange}
        onHoverChange={setHoveredAnchorId}
        onSnapHintsChange={onInSnapHints}
        onDragTimeChange={onInDragTime}
      />
    ),
  })

  if (!warpCollapsed) {
    sections.push({
      id: 'warp',
      space: 'warp',
      node: (
        <WarpConnector
          ref={connectorRef}
          segments={segments}
          view={view}
          origDuration={duration}
          outputDuration={outputDuration}
          clipIn={clipIn}
          clipOut={clipOut}
          beatClipIn={beatClipIn}
          beatClipOut={beatClipOut}
          clipFillColor={clipFillColor}
          boundaryColor={boundaryColor}
          linkedBoundaries={linkedBoundaries}
          selectedBoundaries={selectedBoundaries}
          anchors={anchors}
          onSelectionChange={onConnectorSelectionChange}
          railLabel="Warp"
        />
      ),
    })
    sections.push({
      id: 'markerout',
      space: 'output',
      node: (
        <MarkersTrack
          label="Marker Out"
          anchors={beatAnchors}
          view={view}
          duration={outputDuration}
          selectedIds={selectedAnchorIds}
          snapInterval={snapInterval}
          snapOffset={snapOffset}
          snapTargets={snapTargetsOutput}
          onSeek={onSeekBeat}
          onDelete={onBeatAnchorDelete}
          onSelect={onBeatAnchorSelect}
          onContextMenu={onBeatAnchorContextMenu}
          onBackgroundContextMenu={onTimelineContextMenu}
          onAnchorsChange={onBeatAnchorsChange}
          onHoverChange={setHoveredAnchorId}
          onSnapHintsChange={onOutSnapHints}
          onDragTimeChange={onOutDragTime}
        />
      ),
    })
    if (regionsOutput) {
      sections.push({
        id: 'clipout',
        space: 'output',
        node: (
          <RegionBand
            label="Clip Out"
            kind="output"
            regions={regionsOutput}
            view={view}
            hideLabels
            snapInterval={snapInterval}
            snapOffset={snapOffset}
            snapTargets={snapTargetsOutput}
            onSelect={onRegionSelect}
            onContextMenu={onRegionContextMenu}
            onResize={onRegionResizeOutput}
            onMove={onRegionMoveOutput}
            onZoom={onRegionZoom}
            onHoverChange={setHoveredRegionId}
            onSnapHintsChange={onOutSnapHints}
            onBackgroundContextMenu={onTimelineContextMenu}
          />
        ),
      })
    }
  }

  sections.push({
    id: 'beat',
    space: warpCollapsed ? 'input' : 'output',
    node: (
      <BeatsTrack
        view={view}
        duration={duration}
        bpm={bpm}
        beatOffset={beatOffset}
        division={gridDiv}
        onSeek={warpCollapsed ? onSeek : onSeekBeat}
      />
    ),
  })

  if (!warpCollapsed) {
    sections.push({
      id: 'speed',
      space: 'output',
      node: (
        <div className="thin-timeline__speed-wrapper">
          <div className="thin-row__rail thin-row__rail--inline">Speed</div>
          <div className="thin-timeline__speed-body">
            <SpeedStrip
              segments={segments}
              view={view}
              outputDuration={outputDuration}
            />
          </div>
        </div>
      ),
    })
  }

  const renderThroughLine = (tl: ThroughLine, space: SectionSpace) => {
    if (space === 'warp') {
      if (tl.inputX === null || tl.outputX === null) return null
      return (
        <line
          key={tl.key}
          x1={tl.inputX}
          y1={0}
          x2={tl.outputX}
          y2={100}
          className={`thin-timeline__through-stroke thin-timeline__through-stroke--${tl.kind}-${tl.style}`}
          vectorEffect="non-scaling-stroke"
        />
      )
    }
    const x = space === 'input' ? tl.inputX : tl.outputX
    if (x === null || x < -2 || x > 102) return null
    return (
      <div
        key={tl.key}
        className={`thin-timeline__through-line thin-timeline__through-line--${tl.kind}-${tl.style}`}
        style={{ left: `${x}%` }}
      />
    )
  }

  const renderPlayhead = (space: SectionSpace, sectionId: string) => {
    const thick = sectionId === 'time' || sectionId === 'beat'
    const cls = `thin-timeline__playhead thin-timeline__playhead--${thick ? 'thick' : 'thin'}`
    if (space === 'warp') {
      if (playheadInX === null || playheadOutX === null) return null
      return (
        <svg
          className="thin-timeline__playhead-svg"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <line
            x1={playheadInX}
            y1={0}
            x2={playheadOutX}
            y2={100}
            className="thin-timeline__playhead-stroke"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )
    }
    const x = space === 'input' ? playheadInX : playheadOutX
    if (x === null || x < -2 || x > 102) return null
    return <div className={cls} style={{ left: `${x}%` }} />
  }

  return (
    <div
      ref={rootRef}
      className="thin-timeline"
      onWheel={handleWheel}
      onMouseMove={onBodyMouseMove}
      onMouseLeave={() => setHoverPct(null)}
      onPointerDown={onRootPointerDown}
      onPointerMove={onRootPointerMove}
      onPointerUp={onRootPointerUp}
      onPointerCancel={onRootPointerUp}
      onContextMenu={onRootContextMenu}
    >
      <ThinMinimap
        duration={maxDuration}
        view={view}
        onViewChange={onViewChange}
        anchors={anchors}
        regions={regions}
      />

      {sections.map((s, i) => (
        <Fragment key={s.id}>
          {i > 0 && (
            <div className="thin-timeline__resizer">
              <div
                className="thin-timeline__resizer-grip"
                onPointerDown={(e) => onResizeStart(e, sections[i - 1].id, s.id)}
                title="Drag to resize rows"
              />
            </div>
          )}
          <div
            className="thin-timeline__section"
            data-section={s.id}
            style={{ flex: `${flexBy[s.id]} 0 var(--thin-row-h)` }}
          >
            {s.node}
            <div className="thin-timeline__through-overlay">
              {s.space === 'warp' ? (
                <svg
                  className="thin-timeline__through-svg"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                >
                  {warpLines.map(tl => renderThroughLine(tl, s.space))}
                </svg>
              ) : (
                (s.space === 'input' ? inputLines : outputLines).map(tl => renderThroughLine(tl, s.space))
              )}
              {renderPlayhead(s.space, s.id)}
              {hoverPct !== null && (
                <div
                  className="thin-timeline__hover"
                  style={{ left: `${hoverPct * 100}%` }}
                />
              )}
            </div>
          </div>
        </Fragment>
      ))}

      <div className="thin-timeline__toolbar">
        <button
          type="button"
          className={`thin-toolbar__btn${warpCollapsed ? '' : ' thin-toolbar__btn--active'}`}
          onClick={onToggleWarp}
          title={warpCollapsed ? 'Show warp views (warp, marker out, clip out, speed)' : 'Hide warp views'}
          aria-pressed={!warpCollapsed}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M2 4 L14 4 M2 8 L10 12 M14 8 L6 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <span className="thin-toolbar__sep" />

        <button
          type="button"
          className={`thin-toolbar__btn${alwaysAnchors ? ' thin-toolbar__btn--active' : ''}`}
          onClick={() => setAlwaysAnchors(v => !v)}
          title="Always show through-lines for markers"
          aria-pressed={alwaysAnchors}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 1 L8 15" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" />
            <circle cx="8" cy="8" r="2" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          className={`thin-toolbar__btn${alwaysRegions ? ' thin-toolbar__btn--active' : ''}`}
          onClick={() => setAlwaysRegions(v => !v)}
          title="Always show through-lines for clip/region edges"
          aria-pressed={alwaysRegions}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="3" y="6" width="10" height="4" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <path d="M3 1 L3 15 M13 1 L13 15" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" />
          </svg>
        </button>
        <button
          type="button"
          className={`thin-toolbar__btn${alwaysScenes ? ' thin-toolbar__btn--active' : ''}`}
          onClick={() => setAlwaysScenes(v => !v)}
          title="Always show through-lines for scene changes"
          aria-pressed={alwaysScenes}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 1 L8 15" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" />
            <path d="M8 5 L11 8 L8 11 L5 8 Z" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          className={`thin-toolbar__btn${thumbStripEnabled ? ' thin-toolbar__btn--active' : ''}`}
          onClick={() => setThumbStripEnabled(v => !v)}
          title="Show a thumbnail at each scene marker"
          aria-pressed={thumbStripEnabled}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="1" y="5" width="4" height="6" fill="none" stroke="currentColor" strokeWidth="1" />
            <rect x="6" y="5" width="4" height="6" fill="none" stroke="currentColor" strokeWidth="1" />
            <rect x="11" y="5" width="4" height="6" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button
          type="button"
          className={`thin-toolbar__btn${queueDebugOpen ? ' thin-toolbar__btn--active' : ''}`}
          onClick={() => setQueueDebugOpen(v => !v)}
          title="Thumbnail queue debug panel"
          aria-pressed={queueDebugOpen}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="2" y="3" width="12" height="10" fill="none" stroke="currentColor" strokeWidth="1" />
            <path d="M4 6 L12 6 M4 9 L10 9 M4 11 L8 11" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>

        <span className="thin-toolbar__sep" />

        <button
          type="button"
          className={`thin-toolbar__btn${followDrag ? ' thin-toolbar__btn--active' : ''}`}
          onClick={() => setFollowDrag(v => !v)}
          title="Playhead follows dragged markers"
          aria-pressed={followDrag}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 2 L8 14" stroke="currentColor" strokeWidth="1.5" />
            <path d="M3 8 L13 8" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" />
            <circle cx="8" cy="8" r="2" fill="currentColor" />
          </svg>
        </button>
      </div>

      {queueDebugOpen && (
        <ThumbnailQueueDebug onClose={() => setQueueDebugOpen(false)} />
      )}

      {lassoRange && (() => {
        const lo = Math.min(lassoRange.startPct, lassoRange.endPct) * 100
        const hi = Math.max(lassoRange.startPct, lassoRange.endPct) * 100
        return (
          <div className="thin-timeline__lasso-overlay">
            <div
              className="thin-timeline__lasso"
              style={{ left: `${lo}%`, width: `${hi - lo}%` }}
            />
          </div>
        )
      })()}
    </div>
  )
}
