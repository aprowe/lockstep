import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { setHoverFrames } from '../../store/slices/thumbnailsSlice'
import { gesture, useGesture } from '../../store/gesture'
import type { Anchor, View, WarpSegment } from '../../types'
import { clampView, timeToViewPct, MIN_VISIBLE } from '../../utils/view'
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
import {
  IconWarpToggle, IconAlwaysAnchors, IconAlwaysRegions, IconAlwaysScenes,
  IconThumbStrip, IconQueueDebug, IconFollowDrag,
} from '../icons'
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
  /** Beat-anchor IDs that are linked to a source-side partner. Marker Out
   *  renders any beat anchor *not* in this set as a hollow circle. */
  linkedBeatIds?: ReadonlySet<number>
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
  /** Source-time ranges already scanned for cuts. The scene track shades
   *  these so the user can tell which slices have been analysed. */
  scannedRanges?: ReadonlyArray<{ start: number; end: number }>
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

  /** Clip-list selection — surfaces on the timeline as accent outlines and
   *  receives lasso updates when the drag covers the region bands. */
  selectedClipIds?: ReadonlySet<string>
  onClipsSelectionChange?: (ids: Set<string>) => void

  /** Scene-cut selection — diamonds in this set draw with an accent ring,
   *  and lasso gestures inside the scenes track update it. Identified by
   *  exact cut time. */
  selectedSceneTimes?: ReadonlySet<number>
  onScenesSelectionChange?: (times: Set<number>) => void

  /** Scene-cut times the operator placed by hand (vs. detected). Diamonds
   *  in this set render with a cooler hue so the user can tell their own
   *  boundaries apart from the auto-detected ones at a glance. */
  userSceneTimes?: ReadonlySet<number>

  /** Delete the union of every timeline-side selection. Fires from
   *  Delete / Backspace when the timeline has keyboard focus. */
  onTimelineDelete?: () => void
  /** Clear every timeline-side selection (clips + markers + scenes).
   *  Fires from Cmd/Ctrl+D and from a plain click in the empty timeline
   *  body (Policy B from docs/INTERACTION_DESIGN.md). */
  onTimelineDeselect?: () => void

  warpCollapsed?: boolean
  onToggleWarp?: () => void
}

// Rows where flex-grow is 0 stay pinned to their flex-basis (--thin-row-h)
// as the timeline expands — scenes, clip-out, and speed read as thin index
// strips that don't need extra vertical room. Users can still drag the
// resizer grip to grow them manually; the resizer re-proportions flex on
// drag so a 0-grow row can become non-zero if pulled open.
const DEFAULT_FLEX: Record<string, number> = {
  time: 1, clipin: 1, scenes: 0, thumbs: 1, markerin: 1,
  warp: 1, markerout: 1, clipout: 0, beat: 1, speed: 0,
}

type SectionSpace = 'input' | 'output' | 'warp'
type ThroughKind = 'anchor' | 'region' | 'scene' | 'snap' | 'beat'
type ThroughStyle = 'selected' | 'hover' | 'dotted' | 'snap' | 'snap-active' | 'down' | 'whole' | 'sub'

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
  beatAnchors, linkedBeatIds,
  onBeatAnchorDelete, onBeatAnchorSelect, onBeatAnchorContextMenu, onBeatAnchorsChange,
  snapInterval, snapOffset = 0, snapTargetsInput, snapTargetsOutput,
  bpm, beatOffset = 0, gridDiv = 1,
  scenes, scannedRanges, onSceneAdd, onSceneDelete, onSceneContextMenu,
  onRegionAdd, onTimelineContextMenu,
  regions, regionsOutput,
  onRegionSelect, onRegionContextMenu,
  onRegionResize, onRegionMove, onRegionResizeOutput, onRegionMoveOutput, onRegionZoom,
  segments, clipIn, clipOut, beatClipIn, beatClipOut,
  clipFillColor, boundaryColor, linkedBoundaries, selectedBoundaries,
  onConnectorSelectionChange,
  selectedClipIds, onClipsSelectionChange,
  selectedSceneTimes, onScenesSelectionChange, userSceneTimes,
  onTimelineDelete, onTimelineDeselect,
  warpCollapsed = false, onToggleWarp,
}: ThinTimelineProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const connectorRef = useRef<HTMLDivElement>(null)
  const [hoverPct, setHoverPct] = useState<number | null>(null)
  const [flexBy, setFlexBy] = useState<Record<string, number>>(DEFAULT_FLEX)
  // Transient pointer state lives in the shared gesture store — see
  // src/store/gesture.ts. Subscribing here via selector keeps the existing
  // render shape; children (MarkersTrack, RegionBand, SceneRow) publish
  // directly into the store.
  const hoveredAnchorId = useGesture(s => s.hoveredAnchorId)
  const hoveredRegionId = useGesture(s => s.hoveredRegionId)
  const hoveredSceneTime = useGesture(s => s.hoveredSceneTime)
  const snapHintsIn = useGesture(s => s.snapHintsIn)
  const snapHintsOut = useGesture(s => s.snapHintsOut)
  const dragTime = useGesture(s => s.dragTime)
  const [lassoRange, setLassoRange] = useState<{
    /** Horizontal extents in % of the body width (0..1). */
    startPct: number
    endPct: number
    /** Starting section — always included in the vertical span. */
    startSectionId: string | null
    /** Section under the pointer right now. Same as start → single-track;
     *  different → span whole rows from start → current (inclusive). */
    currentSectionId: string | null
  } | null>(null)
  const lassoRef = useRef<{
    startPct: number
    startClientX: number
    startClientY: number
    startSectionId: string | null
    startedAdditive: boolean
    initialIds: Set<number>
    /** Snapshot of clip selection at lasso-arm — additive starts merge from here. */
    initialClipIds: Set<string>
    /** Snapshot of scene-cut selection at lasso-arm — same merge rules. */
    initialSceneTimes: Set<number>
    /** Pointer id captured by root; undefined before drag threshold exceeded. */
    pointerId?: number
    /** Has the drag moved far enough to activate the lasso? */
    active: boolean
  } | null>(null)
  const LASSO_DRAG_THRESHOLD = 4 // px

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
  // Drives the marker hit flash — only fires while actually playing, not
  // while scrubbing. See MarkersTrack#flashing.
  const playing = useAppSelector(s => s.ui.playing)
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
  // The drag time lives in the gesture store; we just forward it on change.
  const [followDrag, setFollowDrag] = useState(false)
  useEffect(() => {
    if (!followDrag || !dragTime) return
    if (dragTime.space === 'input') onSeek?.(dragTime.time)
    else onSeekBeat?.(dragTime.time)
  }, [followDrag, dragTime, onSeek, onSeekBeat])

  // Stale-hover sweep: if the hovered anchor/region/scene has disappeared
  // from the underlying list (view change, filter, etc.), drop the stale id
  // in the gesture store so phantom through-lines don't linger.
  useEffect(() => {
    if (hoveredAnchorId !== null
      && !anchors.some(a => a.id === hoveredAnchorId)
      && !beatAnchors.some(a => a.id === hoveredAnchorId)) {
      gesture.setHoveredAnchor(null)
    }
  }, [anchors, beatAnchors, hoveredAnchorId])
  useEffect(() => {
    if (hoveredRegionId !== null
      && !regions.some(r => r.id === hoveredRegionId)
      && !(regionsOutput ?? regions).some(r => r.id === hoveredRegionId)) {
      gesture.setHoveredRegion(null)
    }
  }, [regions, regionsOutput, hoveredRegionId])
  useEffect(() => {
    if (hoveredSceneTime !== null && !scenes.includes(hoveredSceneTime)) {
      gesture.setHoveredScene(null)
    }
  }, [scenes, hoveredSceneTime])

  const throughLines = useMemo<ThroughLine[]>(() => {
    const out: ThroughLine[] = []

    // Viewport cull. Drop lines whose endpoints are both off the same side
    // of the visible pct range — a slanted line with one end well to the
    // left and the other well to the right still crosses the viewport.
    const BOUND = 2
    const pairVisible = (inX: number | null, outX: number | null): boolean => {
      if (inX === null && outX === null) return false
      if (inX === null) return outX! >= -BOUND && outX! <= 100 + BOUND
      if (outX === null) return inX >= -BOUND && inX <= 100 + BOUND
      if (inX < -BOUND && outX < -BOUND) return false
      if (inX > 100 + BOUND && outX > 100 + BOUND) return false
      return true
    }

    const origById = new Map(anchors.map(a => [a.id, a.time]))
    const beatById = new Map(beatAnchors.map(a => [a.id, a.time]))
    const anchorIds = new Set<number>([...origById.keys(), ...beatById.keys()])
    for (const id of anchorIds) {
      const hovered = hoveredAnchorId === id
      // Selection no longer draws a through-line — only hover and the
      // explicit "always show" toggle do.
      if (!hovered && !alwaysAnchors) continue
      const inT = origById.get(id)
      const outT = beatById.get(id)
      const inputX = inT !== undefined ? timeToViewPct(inT, view) : null
      const outputX = outT !== undefined ? timeToViewPct(outT, view) : null
      if (!pairVisible(inputX, outputX)) continue
      out.push({
        key: `a-${id}`,
        inputX,
        outputX,
        kind: 'anchor',
        style: hovered ? 'hover' : 'dotted',
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
      const startInX = timeToViewPct(inStart, view)
      const startOutX = timeToViewPct(outStart, view)
      const endInX = timeToViewPct(inEnd, view)
      const endOutX = timeToViewPct(outEnd, view)
      if (pairVisible(startInX, startOutX)) {
        out.push({ key: `r-${rid}-in`, inputX: startInX, outputX: startOutX, kind: 'region', style })
      }
      if (pairVisible(endInX, endOutX)) {
        out.push({ key: `r-${rid}-out`, inputX: endInX, outputX: endOutX, kind: 'region', style })
      }
    }
    // Active regions don't get automatic through-lines — the band already
    // shades the span between in/out. Through-lines only on hover or when the
    // "always show region lines" toggle is on.
    if (hoveredRegionId) pushRegion(hoveredRegionId, 'hover')
    if (alwaysRegions) {
      for (const r of regions) pushRegion(r.id, 'dotted')
    }

    // Scenes live in input space only — output side stays null so the line
    // does not continue past the warp row. Selected cuts always show; the
    // 'always-show' toggle and hover supplement that with weaker styles.
    const scenesToShow = new Set<number>()
    if (alwaysScenes) for (const s of scenes) scenesToShow.add(s)
    if (hoveredSceneTime !== null) scenesToShow.add(hoveredSceneTime)
    if (selectedSceneTimes) for (const t of selectedSceneTimes) scenesToShow.add(t)
    for (const t of scenesToShow) {
      const inputX = timeToViewPct(t, view)
      if (!pairVisible(inputX, null)) continue
      const isSelected = selectedSceneTimes?.has(t) ?? false
      const style: ThroughStyle = isSelected
        ? 'selected'
        : hoveredSceneTime === t ? 'hover' : 'dotted'
      out.push({ key: `sc-${t}`, inputX, outputX: null, kind: 'scene', style })
    }

    // Snap hint times can duplicate (e.g. a marker sitting on a beat grid
     // position shows up from both sources). Dedupe before rendering or React
     // complains about duplicate keys.
    // The hint at the currently-snapped drag time is highlighted (snap-active).
    const SNAP_EPS = 1e-6
    const activeIn = dragTime?.space === 'input' ? dragTime.time : null
    const activeOut = dragTime?.space === 'output' ? dragTime.time : null
    for (const t of new Set(snapHintsIn)) {
      const inputX = timeToViewPct(t, view)
      if (!pairVisible(inputX, null)) continue
      const style: ThroughStyle = activeIn !== null && Math.abs(activeIn - t) < SNAP_EPS ? 'snap-active' : 'snap'
      out.push({ key: `snap-in-${t}`, inputX, outputX: null, kind: 'snap', style })
    }
    for (const t of new Set(snapHintsOut)) {
      const outputX = timeToViewPct(t, view)
      if (!pairVisible(null, outputX)) continue
      const style: ThroughStyle = activeOut !== null && Math.abs(activeOut - t) < SNAP_EPS ? 'snap-active' : 'snap'
      out.push({ key: `snap-out-${t}`, inputX: null, outputX, kind: 'snap', style })
    }

    // Beat ticks across every output-space row. Same density-based graceful
    // degradation as BeatsTrack: subdivisions drop first, then whole beats,
    // leaving only downbeats at extreme zoom-out instead of cutting off at a
    // hard tick-count threshold.
    if (bpm > 0) {
      const div = Math.max(1, gridDiv)
      const beatSec = (60 / bpm) / div
      if (beatSec > 0) {
        const span = view.end - view.start
        const visibleSubs = span / beatSec
        const visibleBeats = visibleSubs / div
        const visibleBars = visibleBeats / 4
        const SHOW_SUB_MAX = 24
        const SHOW_BEAT_MAX = 48
        const SHOW_DOWNBEAT_MAX = 96
        const maxRank =
          visibleSubs <= SHOW_SUB_MAX ? 99
          : visibleBeats <= SHOW_BEAT_MAX ? 1
          : visibleBars <= SHOW_DOWNBEAT_MAX ? 0
          : -1
        if (maxRank >= 0) {
          const firstIdx = Math.ceil((view.start - beatOffset) / beatSec)
          const lastIdx = Math.floor((Math.min(view.end, outputDuration) - beatOffset) / beatSec)
          const ticksPerBar = 4 * div
          for (let i = firstIdx; i <= lastIdx; i++) {
            const rank =
              i % ticksPerBar === 0 ? 0
              : i % div === 0 ? 1
              : 2
            if (rank > maxRank) continue
            const t = beatOffset + i * beatSec
            if (t < 0 || t > outputDuration) continue
            const x = timeToViewPct(t, view)
            if (x < -2 || x > 102) continue
            const style: ThroughStyle =
              rank === 0 ? 'down'
              : rank === 1 ? 'whole'
              : 'sub'
            out.push({ key: `beat-${i}`, inputX: null, outputX: x, kind: 'beat', style })
          }
        }
      }
    }

    return out
  }, [
    anchors, beatAnchors, hoveredAnchorId,
    hoveredRegionId, regions, regionsOutput,
    scenes, hoveredSceneTime, selectedSceneTimes,
    alwaysAnchors, alwaysRegions, alwaysScenes,
    snapHintsIn, snapHintsOut, dragTime,
    view, bpm, beatOffset, gridDiv, outputDuration,
  ])

  // Section layouts drive the single global through-line overlay (see below).
  // Measured in pixels relative to rootRef so each line can draw one continuous
  // path across every section it passes through, bridging the resizer gaps
  // that used to break the visual into per-section fragments.
  interface SectionLayout {
    id: string
    space: SectionSpace
    top: number
    bottom: number
  }
  const [layouts, setLayouts] = useState<SectionLayout[]>([])

  // Collapse contiguous same-space sections into one span so a single vertical
  // stroke covers the whole group (resizer gaps disappear). Then bridge the
  // gaps between neighbouring spans by snapping each pair to their shared
  // midpoint — otherwise the vertical input stroke ends ~1px short of the
  // warp slant's top endpoint and the visual looks broken at the seam.
  interface SectionSpan { space: SectionSpace; top: number; bottom: number }
  const spans = useMemo<SectionSpan[]>(() => {
    const out: SectionSpan[] = []
    for (const l of layouts) {
      const last = out[out.length - 1]
      if (last && last.space === l.space) last.bottom = l.bottom
      else out.push({ space: l.space, top: l.top, bottom: l.bottom })
    }
    for (let i = 0; i < out.length - 1; i++) {
      const mid = (out[i].bottom + out[i + 1].top) / 2
      out[i].bottom = mid
      out[i + 1].top = mid
    }
    return out
  }, [layouts])

  // Wheel zoom must call preventDefault to stop the page from scrolling, but
  // React attaches onWheel as a passive listener (preventDefault becomes a
  // no-op + console warning). Bind a native non-passive listener instead.
  //
  //   plain vertical wheel  → zoom toward cursor
  //   horizontal wheel      → pan view (covers tilt-wheel mice + trackpad
  //                                     two-finger horizontal swipe)
  //   shift + vertical wheel → pan view (single-axis mice without a
  //                                     horizontal wheel)
  const handleWheelNative = useCallback((e: WheelEvent) => {
    const el = rootRef.current
    if (!el) return
    e.preventDefault()
    const body = el.querySelector<HTMLDivElement>('.thin-row__body')
    const rect = body ? body.getBoundingClientRect() : el.getBoundingClientRect()
    const span = view.end - view.start

    const horizontalIntent = e.deltaX !== 0 || (e.shiftKey && e.deltaY !== 0)
    if (horizontalIntent) {
      // Convert wheel-pixels to view-time using the body width as the
      // reference span. clampView preserves the existing span, so panning
      // past either edge stops cleanly without changing zoom level.
      const px = e.deltaX !== 0 ? e.deltaX : e.deltaY
      const dt = (px / Math.max(1, rect.width)) * span
      onViewChange(clampView(view.start + dt, view.end + dt, maxDuration))
      return
    }

    // Vertical wheel = zoom toward the cursor's view-time.
    const cursorTime = view.start + ((e.clientX - rect.left) / rect.width) * span
    const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15
    // If we're already at the zoom floor or ceiling, bail — otherwise the
    // span gets clamped to a fixed value but `start` still slides toward
    // the cursor, which the user sees as the window scooting forward.
    const rawSpan = span * factor
    const clampedSpan = Math.max(MIN_VISIBLE, Math.min(maxDuration, rawSpan))
    if (Math.abs(clampedSpan - span) < 1e-6) return
    const ratio = (cursorTime - view.start) / span
    const ns = cursorTime - ratio * clampedSpan
    onViewChange(clampView(ns, ns + clampedSpan, maxDuration))
  }, [view.start, view.end, maxDuration, onViewChange])

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheelNative, { passive: false })
    return () => el.removeEventListener('wheel', handleWheelNative)
  }, [handleWheelNative])

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
    if (target.closest('.thin-row--minimap')) return false
    if (target.closest('.thumb-queue-debug')) return false
    const section = target.closest('[data-section]') as HTMLElement | null
    if (section) {
      const id = section.dataset.section
      if (id === 'time' || id === 'beat') return false
    }
    return true
  }, [])

  /** Return the [data-section] id containing the element at the given client point. */
  const sectionIdAt = useCallback((clientX: number, clientY: number): string | null => {
    const root = rootRef.current
    if (!root) return null
    const el = document.elementFromPoint(clientX, clientY)
    if (!(el instanceof Element)) return null
    const sec = el.closest<HTMLElement>('[data-section]')
    if (!sec || !root.contains(sec)) return null
    return sec.dataset.section ?? null
  }, [])

  /**
   * Set of section ids the lasso rectangle covers. Walks DOM order to find
   * the slice between `startId` and `currentId` inclusive. Returning `null`
   * means "scope unknown" (e.g. elementFromPoint failed) — callers should
   * fall back to unconstrained behavior in that case.
   */
  const getCrossedSectionIds = useCallback((
    startId: string | null,
    currentId: string | null,
  ): ReadonlySet<string> | null => {
    if (!startId) return null
    if (!currentId || currentId === startId) return new Set([startId])
    const root = rootRef.current
    if (!root) return new Set([startId])
    const all = Array.from(root.querySelectorAll<HTMLElement>('[data-section]'))
      .map(el => el.dataset.section ?? '')
      .filter(Boolean)
    const startIdx = all.indexOf(startId)
    const currentIdx = all.indexOf(currentId)
    if (startIdx < 0 || currentIdx < 0) return new Set([startId])
    const [lo, hi] = startIdx <= currentIdx ? [startIdx, currentIdx] : [currentIdx, startIdx]
    return new Set(all.slice(lo, hi + 1))
  }, [])

  /**
   * Lasso → set of in-range anchor ids. The set of allowed pools is keyed
   * to which sections the lasso rectangle actually crosses, so a marker-only
   * lasso ignores beat anchors (and vice versa); a span that bridges
   * markerin → markerout (e.g. through warp) pulls from both. `null` means
   * scope-unknown — fall back to both pools so we don't silently drop hits.
   */
  const computeLassoIds = useCallback((
    startPct: number, endPct: number,
    allowed: ReadonlySet<string> | null,
  ): Set<number> => {
    const span = view.end - view.start
    const lo = view.start + Math.min(startPct, endPct) * span
    const hi = view.start + Math.max(startPct, endPct) * span
    const ids = new Set<number>()
    const wantIn = allowed === null || allowed.has('markerin') || allowed.has('warp')
    const wantOut = allowed === null || allowed.has('markerout') || allowed.has('warp')
    if (wantIn) for (const a of anchors) if (a.time >= lo && a.time <= hi) ids.add(a.id)
    if (wantOut) for (const a of beatAnchors) if (a.time >= lo && a.time <= hi) ids.add(a.id)
    return ids
  }, [anchors, beatAnchors, view.start, view.end])

  /**
   * Clip lasso — a clip is hit when its [in, out] range overlaps the lasso
   * range at all. Only contributes when the lasso rectangle covers a clip
   * band (clipin / clipout); marker- or warp-only lassos leave clips alone.
   */
  const computeLassoClipIds = useCallback((
    startPct: number, endPct: number,
    allowed: ReadonlySet<string> | null,
  ): Set<string> => {
    const span = view.end - view.start
    const lo = view.start + Math.min(startPct, endPct) * span
    const hi = view.start + Math.max(startPct, endPct) * span
    const ids = new Set<string>()
    const allowsClips = allowed === null
      || allowed.has('clipin') || allowed.has('clipout')
    if (!allowsClips) return ids
    for (const r of regions) {
      if (r.outPoint > lo && r.inPoint < hi) ids.add(r.id)
    }
    return ids
  }, [regions, view.start, view.end])

  /**
   * Scene-cut lasso — only contributes when the rectangle covers the scenes
   * row. Scenes live in input space only, so they never participate in any
   * cross-track span that doesn't actually include `scenes`.
   */
  const computeLassoSceneTimes = useCallback((
    startPct: number, endPct: number,
    allowed: ReadonlySet<string> | null,
  ): Set<number> => {
    const span = view.end - view.start
    const lo = view.start + Math.min(startPct, endPct) * span
    const hi = view.start + Math.max(startPct, endPct) * span
    const times = new Set<number>()
    const allowsScenes = allowed === null || allowed.has('scenes')
    if (!allowsScenes) return times
    for (const t of scenes) {
      if (t >= lo && t <= hi) times.add(t)
    }
    return times
  }, [scenes, view.start, view.end])

  const onRootPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    if (e.shiftKey && !e.ctrlKey && !e.metaKey) return // shift+drag = pan
    if (!isLassoTarget(e.target)) return
    const pct = bodyPctFromClientX(e.clientX)
    if (pct === null) return
    const additive = e.ctrlKey || e.metaKey
    const initialIds = additive ? new Set(selectedAnchorIds) : new Set<number>()
    const initialClipIds = additive ? new Set(selectedClipIds ?? []) : new Set<string>()
    const initialSceneTimes = additive ? new Set(selectedSceneTimes ?? []) : new Set<number>()
    const sectionId = sectionIdAt(e.clientX, e.clientY)
    // NOTE: don't capture the pointer or show a lasso yet — only arm it. If the
    // user clicks without moving past LASSO_DRAG_THRESHOLD, the click/dblclick
    // dispatches normally on the target. This matters for double-clicks on
    // tracks (e.g. scene row) that create a new object at the cursor.
    lassoRef.current = {
      startPct: pct,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startSectionId: sectionId,
      startedAdditive: additive,
      initialIds,
      initialClipIds,
      initialSceneTimes,
      active: false,
    }
  }, [isLassoTarget, bodyPctFromClientX, sectionIdAt, selectedAnchorIds, selectedClipIds, selectedSceneTimes])

  const onRootPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const g = lassoRef.current
    if (!g) return
    const pct = bodyPctFromClientX(e.clientX)
    if (pct === null) return

    // Activate once the pointer has moved past the drag threshold. Only then
    // do we capture the pointer + start drawing the lasso.
    if (!g.active) {
      const dx = e.clientX - g.startClientX
      const dy = e.clientY - g.startClientY
      if (dx * dx + dy * dy < LASSO_DRAG_THRESHOLD * LASSO_DRAG_THRESHOLD) return
      g.active = true
      g.pointerId = e.pointerId
      rootRef.current?.setPointerCapture(e.pointerId)
      if (!g.startedAdditive) {
        onConnectorSelectionChange?.(new Set())
        onClipsSelectionChange?.(new Set())
        onScenesSelectionChange?.(new Set())
      }
    }

    // The lasso rectangle's vertical extent = the slice of sections from
    // the start row to the row the pointer is currently over. Each pool
    // (anchors / clips / scenes) only contributes from sections inside
    // that slice, so a lasso that never touches the clip band can't pick
    // up clips even when it crosses three other rows.
    const here = sectionIdAt(e.clientX, e.clientY)
    const allowed = getCrossedSectionIds(g.startSectionId, here)
    setLassoRange({
      startPct: g.startPct,
      endPct: pct,
      startSectionId: g.startSectionId,
      currentSectionId: here,
    })
    const hit = computeLassoIds(g.startPct, pct, allowed)
    const merged = new Set(g.initialIds)
    for (const id of hit) merged.add(id)
    onConnectorSelectionChange?.(merged)

    // Clips run in a parallel selection space. Same merge rules — additive
    // gestures keep the prior selection; non-additive starts fresh.
    const hitClips = computeLassoClipIds(g.startPct, pct, allowed)
    const mergedClips = new Set(g.initialClipIds)
    for (const id of hitClips) mergedClips.add(id)
    onClipsSelectionChange?.(mergedClips)

    // Scenes — same again. Selection by time means we don't need a separate
    // id-time map since cuts are uniquely identified by their value.
    const hitScenes = computeLassoSceneTimes(g.startPct, pct, allowed)
    const mergedScenes = new Set(g.initialSceneTimes)
    for (const t of hitScenes) mergedScenes.add(t)
    onScenesSelectionChange?.(mergedScenes)
  }, [bodyPctFromClientX, sectionIdAt, getCrossedSectionIds, computeLassoIds, computeLassoClipIds, computeLassoSceneTimes, onConnectorSelectionChange, onClipsSelectionChange, onScenesSelectionChange])

  const onRootPointerUp = useCallback(() => {
    const g = lassoRef.current
    if (!g) return
    // Plain click on empty timeline body (no drag, no modifier):
    //   - clear every timeline-side selection (Policy B from INTERACTION_DESIGN)
    //   - move the input playhead to the click position
    // Drag is handled by the ruler row itself (continuous scrub) — every
    // other track only seeks on click, not on drag.
    if (!g.active && !g.startedAdditive) {
      onTimelineDeselect?.()
      const t = view.start + g.startPct * (view.end - view.start)
      onSeek?.(t)
    }
    lassoRef.current = null
    setLassoRange(null)
  }, [onTimelineDeselect, onSeek, view.start, view.end])

  // Keyboard scope is "the timeline has focus" — root div is tabIndex=0.
  // Delete / Backspace → delete union of clip + marker selections.
  // Cmd/Ctrl+D → clear every timeline-side selection.
  const onRootKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      onTimelineDelete?.()
      e.preventDefault()
      return
    }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'd') {
      onTimelineDeselect?.()
      e.preventDefault()
    }
  }, [onTimelineDelete, onTimelineDeselect])

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
    id: 'scenes',
    space: 'input',
    node: (
      <div className="thin-timeline__scene-wrapper">
        <div className="thin-row__rail thin-row__rail--inline">Scenes</div>
        <div className="thin-timeline__scene-body">
          <SceneRow
            scenes={scenes}
            scannedRanges={scannedRanges}
            view={view}
            duration={duration}
            playhead={playhead}
            onSceneClick={onSeek}
            onSceneAdd={onSceneAdd}
            onSceneDelete={onSceneDelete}
            onSceneContextMenu={onSceneContextMenu}
            onBackgroundContextMenu={onTimelineContextMenu}
            selectedTimes={selectedSceneTimes}
            userTimes={userSceneTimes}
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
    id: 'clipin',
    space: 'input',
    node: (
      <RegionBand
        label="Clip In"
        kind="input"
        regions={regions}
        view={view}
        duration={duration}
        snapTargets={snapTargetsInput}
        onSelect={onRegionSelect}
        onContextMenu={onRegionContextMenu}
        onResize={onRegionResize}
        onMove={onRegionMove}
        onZoom={onRegionZoom}
        onBackgroundAdd={onRegionAdd}
        onBackgroundContextMenu={onTimelineContextMenu}
      />
    ),
  })
  sections.push({
    id: 'markerin',
    space: 'input',
    node: (
      <MarkersTrack
        label="Marker In"
        space="input"
        anchors={anchors}
        view={view}
        duration={duration}
        playhead={playhead}
        playing={playing}
        selectedIds={selectedAnchorIds}
        snapTargets={snapTargetsInput}
        regions={regions}
        onSeek={onSeek}
        onAdd={onAnchorAdd}
        onDelete={onAnchorDelete}
        onSelect={onAnchorSelect}
        onContextMenu={onAnchorContextMenu}
        onBackgroundContextMenu={onTimelineContextMenu}
        onAnchorsChange={onAnchorsChange}
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
          regionEdges={regions.map(r => {
            const o = regionsOutput?.find(x => x.id === r.id)
            return {
              id: r.id,
              origIn: r.inPoint,
              origOut: r.outPoint,
              beatIn: o?.inPoint ?? r.inPoint,
              beatOut: o?.outPoint ?? r.outPoint,
              colorIndex: r.colorIndex ?? 0,
            }
          })}
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
          space="output"
          anchors={beatAnchors}
          linkedIds={linkedBeatIds}
          view={view}
          duration={outputDuration}
          playhead={beatPlayhead ?? playhead}
          playing={playing}
          selectedIds={selectedAnchorIds}
          snapInterval={snapInterval}
          snapOffset={snapOffset}
          snapTargets={snapTargetsOutput}
          regions={regionsOutput}
          onSeek={onSeekBeat}
          onDelete={onBeatAnchorDelete}
          onSelect={onBeatAnchorSelect}
          onContextMenu={onBeatAnchorContextMenu}
          onBackgroundContextMenu={onTimelineContextMenu}
          onAnchorsChange={onBeatAnchorsChange}
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
            duration={outputDuration}
            hideLabels
            snapInterval={snapInterval}
            snapOffset={snapOffset}
            snapTargets={snapTargetsOutput}
            onSelect={onRegionSelect}
            onContextMenu={onRegionContextMenu}
            onResize={onRegionResizeOutput}
            onMove={onRegionMoveOutput}
            onZoom={onRegionZoom}
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

  // Re-measure section bounds whenever the section set changes (id or space)
  // or anything resizes. Drives the global through-line overlay. The effect
  // also re-subscribes the ResizeObserver to the new section elements.
  const sectionKey = sections.map(s => s.id + ':' + s.space).join('|')
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const recompute = () => {
      const rootRect = root.getBoundingClientRect()
      const next: SectionLayout[] = []
      const els = root.querySelectorAll<HTMLElement>('[data-section]')
      for (const el of els) {
        const id = el.dataset.section
        const space = el.dataset.space as SectionSpace | undefined
        if (!id || !space) continue
        const r = el.getBoundingClientRect()
        next.push({
          id, space,
          top: r.top - rootRect.top,
          bottom: r.bottom - rootRect.top,
        })
      }
      setLayouts(prev => {
        if (prev.length !== next.length) return next
        for (let i = 0; i < next.length; i++) {
          const a = prev[i]; const b = next[i]
          if (a.id !== b.id || a.space !== b.space
            || Math.abs(a.top - b.top) > 0.5 || Math.abs(a.bottom - b.bottom) > 0.5) {
            return next
          }
        }
        return prev
      })
    }
    recompute()
    const ro = new ResizeObserver(recompute)
    ro.observe(root)
    const els = root.querySelectorAll<HTMLElement>('[data-section]')
    for (const el of els) ro.observe(el)
    return () => ro.disconnect()
  }, [sectionKey])

  /**
   * Translucent band showing each clip's in→out range across the marker
   * tracks (markerin / markerout). Every region gets a band — the active
   * one's just sits on top of any overlapping siblings via z-index. The
   * warp section draws its own slanted quad and is skipped here.
   */
  // Marker In / Marker Out get thin colored edge lines at each region's in /
  // out — no fill in between. The full-fill region color stays on the Clip In
  // / Clip Out bands; these edges are just to anchor the region boundary
  // visually across the marker rows.
  const regionBandsFor = (space: SectionSpace, sectionId: string): React.ReactNode => {
    if (sectionId !== 'markerin' && sectionId !== 'markerout') return null
    const sourceRegions = space === 'input' ? regions : (regionsOutput ?? regions)
    if (sourceRegions.length === 0) return null
    return sourceRegions.map(r => {
      const left = timeToViewPct(r.inPoint, view)
      const right = timeToViewPct(r.outPoint, view)
      const width = right - left
      if (width <= 0 || right < -1 || left > 101) return null
      const colorCls = `clip-overlay--color-${(r.colorIndex ?? 0) % 8}`
      return (
        <div
          key={`rband-${r.id}`}
          className={`thin-timeline__region-band ${colorCls}`}
          style={{ left: `${left}%`, width: `${width}%` }}
        />
      )
    })
  }

  const overlayTop = layouts.length > 0 ? layouts[0].top : 0
  const overlayBottom = layouts.length > 0 ? layouts[layouts.length - 1].bottom : 0
  const overlayHeight = Math.max(0, overlayBottom - overlayTop)

  // Beat through-strokes stop at the top of the Speed row — those bars are
  // about playback speed, not beat structure, so the grid would just clutter.
  const speedLayoutTop = layouts.find(l => l.id === 'speed')?.top
  const beatMaxY = speedLayoutTop !== undefined ? speedLayoutTop - overlayTop : Infinity

  /** One continuous group per through-line: a vertical stroke in each input /
   *  output span and a slanted stroke across any warp span. y-coords are
   *  pixels relative to the SVG origin (overlayTop). */
  const renderGlobalThroughLine = (tl: ThroughLine) => {
    const cls = `thin-timeline__through-stroke thin-timeline__through-stroke--${tl.kind}-${tl.style}`
    // Anchors already get a dotted link across the warp row from WarpConnector,
    // so skip the warp span segment for kind=anchor to avoid double-drawing.
    const skipWarp = tl.kind === 'anchor'
    const segs: React.ReactNode[] = []
    for (let i = 0; i < spans.length; i++) {
      const sp = spans[i]
      const y1 = sp.top - overlayTop
      const y2 = tl.kind === 'beat' ? Math.min(sp.bottom - overlayTop, beatMaxY) : sp.bottom - overlayTop
      if (y2 <= y1) continue
      if (sp.space === 'input' && tl.inputX !== null) {
        segs.push(<line key={i} x1={tl.inputX} y1={y1} x2={tl.inputX} y2={y2} className={cls} vectorEffect="non-scaling-stroke" />)
      } else if (sp.space === 'output' && tl.outputX !== null) {
        segs.push(<line key={i} x1={tl.outputX} y1={y1} x2={tl.outputX} y2={y2} className={cls} vectorEffect="non-scaling-stroke" />)
      } else if (sp.space === 'warp' && !skipWarp && tl.inputX !== null && tl.outputX !== null) {
        segs.push(<line key={i} x1={tl.inputX} y1={y1} x2={tl.outputX} y2={y2} className={cls} vectorEffect="non-scaling-stroke" />)
      }
    }
    if (segs.length === 0) return null
    return <g key={tl.key}>{segs}</g>
  }

  /** Continuous playhead across every span — vertical in input/output, slanted
   *  across warp. Rendered inside the global SVG so it flows over the resizer
   *  gaps the same way through-lines do. */
  const renderGlobalPlayhead = () => {
    if (playheadInX === null && playheadOutX === null) return null
    const segs: React.ReactNode[] = []
    for (let i = 0; i < spans.length; i++) {
      const sp = spans[i]
      const y1 = sp.top - overlayTop
      const y2 = sp.bottom - overlayTop
      if (sp.space === 'input' && playheadInX !== null) {
        segs.push(<line key={i} x1={playheadInX} y1={y1} x2={playheadInX} y2={y2} className="thin-timeline__playhead-stroke" vectorEffect="non-scaling-stroke" />)
      } else if (sp.space === 'output' && playheadOutX !== null) {
        segs.push(<line key={i} x1={playheadOutX} y1={y1} x2={playheadOutX} y2={y2} className="thin-timeline__playhead-stroke" vectorEffect="non-scaling-stroke" />)
      } else if (sp.space === 'warp' && playheadInX !== null && playheadOutX !== null) {
        segs.push(<line key={i} x1={playheadInX} y1={y1} x2={playheadOutX} y2={y2} className="thin-timeline__playhead-stroke" vectorEffect="non-scaling-stroke" />)
      }
    }
    return segs.length > 0 ? <g>{segs}</g> : null
  }

  /** Hover cursor — one continuous vertical stroke at the pointer's body-%
   *  across every span. hoverPct is already clamped to [0,1] of the body width. */
  const renderGlobalHoverCursor = () => {
    if (hoverPct === null || overlayHeight <= 0) return null
    const x = hoverPct * 100
    return <line x1={x} y1={0} x2={x} y2={overlayHeight} className="thin-timeline__hover-stroke" vectorEffect="non-scaling-stroke" />
  }

  return (
    <div
      ref={rootRef}
      className="thin-timeline"
      tabIndex={0}
      onMouseMove={onBodyMouseMove}
      onMouseLeave={() => setHoverPct(null)}
      onPointerDown={onRootPointerDown}
      onPointerMove={onRootPointerMove}
      onPointerUp={onRootPointerUp}
      onPointerCancel={onRootPointerUp}
      onContextMenu={onRootContextMenu}
      onKeyDown={onRootKeyDown}
    >
      <ThinMinimap
        duration={maxDuration}
        view={view}
        onViewChange={onViewChange}
        anchors={anchors}
        regions={regions}
        playhead={playhead}
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
            data-space={s.space}
            style={{ flex: `${flexBy[s.id]} 0 var(--thin-row-h)` }}
          >
            {s.node}
            <div className="thin-timeline__through-overlay">
              {regionBandsFor(s.space, s.id)}
              {/* Playhead, hover cursor and through-lines live in the global
               *  SVG overlay below so they flow continuously across section
               *  resizer gaps. Keep the overlay here only for region bands. */}
            </div>
          </div>
        </Fragment>
      ))}

      {/* Global through-line overlay — paints after every section, so lines
       *  sit on top of markers / diamonds / region blocks. Pointer-events are
       *  off, so clicks still land on the underlying rows. Grouping contiguous
       *  same-space sections into spans produces one continuous stroke per
       *  line across the whole vertical stack, resizer gaps included. */}
      {layouts.length > 0 && overlayHeight > 0 && (
        <svg
          className="thin-timeline__global-through"
          viewBox={`0 0 100 ${overlayHeight}`}
          preserveAspectRatio="none"
          style={{ top: `${overlayTop}px`, height: `${overlayHeight}px` }}
        >
          {throughLines.map(renderGlobalThroughLine)}
          {renderGlobalPlayhead()}
          {renderGlobalHoverCursor()}
        </svg>
      )}

      {/* Down-pointing playhead arrow above the Time ruler — classic NLE/DAW
       *  look. The arrow sits at the top of the first section; its point
       *  marks the playhead time, and the stroke from the SVG overlay picks
       *  up below it. Non-scaling CSS triangle keeps crisp edges regardless
       *  of viewport width. */}
      {playheadInX !== null && layouts.length > 0 && (
        <div
          className="thin-timeline__playhead-arrow-layer"
          style={{ top: `${overlayTop}px` }}
        >
          <div
            className="thin-timeline__playhead-arrow"
            style={{ left: `${playheadInX}%` }}
          />
        </div>
      )}

      {/* Order: view toggles → drag behavior → through-line toggles → debug.
       *  Each `--<kind>` modifier hooks the icon color to the item it controls
       *  when active, so e.g. the scenes toggle lights up in scene-cut yellow. */}
      <div className="thin-timeline__toolbar">
        <button
          type="button"
          className={`thin-toolbar__btn thin-toolbar__btn--warp${warpCollapsed ? '' : ' thin-toolbar__btn--active'}`}
          onClick={onToggleWarp}
          title={warpCollapsed ? 'Show warp views (warp, marker out, clip out, speed)' : 'Hide warp views'}
          aria-pressed={!warpCollapsed}
        >
          <IconWarpToggle aria-hidden="true" size={18} />
        </button>
        <button
          type="button"
          className={`thin-toolbar__btn thin-toolbar__btn--thumbs${thumbStripEnabled ? ' thin-toolbar__btn--active' : ''}`}
          onClick={() => setThumbStripEnabled(v => !v)}
          title="Show a thumbnail at each scene marker"
          aria-pressed={thumbStripEnabled}
        >
          <IconThumbStrip aria-hidden="true" size={18} />
        </button>

        <span className="thin-toolbar__sep" />

        <button
          type="button"
          className={`thin-toolbar__btn thin-toolbar__btn--follow${followDrag ? ' thin-toolbar__btn--active' : ''}`}
          onClick={() => setFollowDrag(v => !v)}
          title="Playhead follows dragged markers"
          aria-pressed={followDrag}
        >
          <IconFollowDrag aria-hidden="true" size={18} />
        </button>

        <span className="thin-toolbar__sep" />

        <button
          type="button"
          className={`thin-toolbar__btn thin-toolbar__btn--anchors${alwaysAnchors ? ' thin-toolbar__btn--active' : ''}`}
          onClick={() => setAlwaysAnchors(v => !v)}
          title="Always show through-lines for markers"
          aria-pressed={alwaysAnchors}
        >
          <IconAlwaysAnchors aria-hidden="true" size={18} />
        </button>
        <button
          type="button"
          className={`thin-toolbar__btn thin-toolbar__btn--regions${alwaysRegions ? ' thin-toolbar__btn--active' : ''}`}
          onClick={() => setAlwaysRegions(v => !v)}
          title="Always show through-lines for clip/region edges"
          aria-pressed={alwaysRegions}
        >
          <IconAlwaysRegions aria-hidden="true" size={18} />
        </button>
        <button
          type="button"
          className={`thin-toolbar__btn thin-toolbar__btn--scenes${alwaysScenes ? ' thin-toolbar__btn--active' : ''}`}
          onClick={() => setAlwaysScenes(v => !v)}
          title="Always show through-lines for scene changes"
          aria-pressed={alwaysScenes}
        >
          <IconAlwaysScenes aria-hidden="true" size={18} />
        </button>

        <span className="thin-toolbar__sep" />

        <button
          type="button"
          className={`thin-toolbar__btn thin-toolbar__btn--debug${queueDebugOpen ? ' thin-toolbar__btn--active' : ''}`}
          onClick={() => setQueueDebugOpen(v => !v)}
          title="Thumbnail queue debug panel"
          aria-pressed={queueDebugOpen}
        >
          <IconQueueDebug aria-hidden="true" size={18} />
        </button>
      </div>

      {queueDebugOpen && (
        <ThumbnailQueueDebug onClose={() => setQueueDebugOpen(false)} />
      )}

      {lassoRange && (() => {
        const lo = Math.min(lassoRange.startPct, lassoRange.endPct) * 100
        const hi = Math.max(lassoRange.startPct, lassoRange.endPct) * 100
        const root = rootRef.current
        // Whole-track expansion: the vertical span always starts at the start
        // section's row. If the pointer is still inside the start section we
        // stay single-track; otherwise we expand to cover every whole row
        // between start and current (inclusive).
        let overlayStyle: React.CSSProperties | undefined
        const singleTrack = !!lassoRange.startSectionId
          && lassoRange.currentSectionId === lassoRange.startSectionId
        if (root && lassoRange.startSectionId) {
          const startSec = root.querySelector<HTMLElement>(`[data-section="${lassoRange.startSectionId}"]`)
          const currSec = lassoRange.currentSectionId && lassoRange.currentSectionId !== lassoRange.startSectionId
            ? root.querySelector<HTMLElement>(`[data-section="${lassoRange.currentSectionId}"]`)
            : null
          if (startSec) {
            const rootRect = root.getBoundingClientRect()
            const startRect = startSec.getBoundingClientRect()
            let top = startRect.top
            let bottom = startRect.bottom
            if (currSec) {
              const currRect = currSec.getBoundingClientRect()
              top = Math.min(top, currRect.top)
              bottom = Math.max(bottom, currRect.bottom)
            }
            overlayStyle = {
              top: `${top - rootRect.top}px`,
              height: `${bottom - top}px`,
              bottom: 'auto',
            }
          }
        }
        return (
          <div className="thin-timeline__lasso-overlay" style={overlayStyle}>
            <div
              className={`thin-timeline__lasso${singleTrack ? ' thin-timeline__lasso--single' : ' thin-timeline__lasso--rect'}`}
              style={{ left: `${lo}%`, width: `${hi - lo}%` }}
            />
          </div>
        )
      })()}
    </div>
  )
}
