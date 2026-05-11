import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import {
  setTimelineThumbShow, setTimelineFollowDrag,
  setTimelineAlwaysAnchors, setTimelineAlwaysRegions, setTimelineAlwaysScenes,
  setWarpCollapsed, setGridDiv,
} from '../store/slices/uiSlice'
import type { RegionBlock } from './thin/RegionBand'
import type { Anchor, WarpSegment, View } from '../types'
import {
  IconWarpToggle, IconAlwaysAnchors, IconAlwaysRegions, IconAlwaysScenes,
  IconThumbStrip, IconFollowDrag, IconZoomToRegion,
} from './icons'
import { computeSnap, pixelsToSeconds } from '../utils/snap'
import { gesture, getSnapshot, useGesture } from '../store/gesture'
import { getUiScale } from '../uiScale'
import { useSetThumbnailHover } from './ThumbnailPopup'
import './CanvasTimeline.css'

// ── PALETTE ────────────────────────────────────────────────
const BG0    = '#0d0b09'
const BG2    = '#171410'
const BGWARP = '#13151c'
const BLACK  = '#000000'
const FG1    = '#e2dbd2'
const FG3    = '#a09488'
const FG4    = '#7a6e62'

const SP_INPUT  = 'hsl(195,75%,55%)'
const SP_WARP   = 'hsl(32,90%,55%)'
const SP_OUTPUT = 'hsl(280,55%,60%)'

const MARKER_COLOR  = 'hsl(195,75%,55%)'
const MARKER_HOVER  = 'hsl(195,75%,78%)'
const PLAYHEAD_COL  = 'hsl(0,90%,65%)'
const PLAYHEAD_GLOW = 'hsla(0,90%,65%,0.22)'
const SCENE_COLOR   = 'hsl(48,95%,62%)'
const THROUGH_COLOR = 'hsla(195,85%,75%,0.5)'
const THROUGH_HOVER = 'hsla(195,85%,70%,0.85)'
const BAR_TICK  = 'rgba(226,219,210,0.75)'
const BEAT_TICK = 'rgba(160,148,136,0.5)'
const SUB_TICK  = 'rgba(90,78,66,0.7)'
const GRID_BAR  = 'rgba(226,219,210,0.038)'
const GRID_BEAT = 'rgba(226,219,210,0.016)'

const CLIP_PALETTE = [
  { h: 0,   s: 75, l: 55 }, { h: 30,  s: 80, l: 52 },
  { h: 58,  s: 80, l: 48 }, { h: 115, s: 65, l: 45 },
  { h: 183, s: 65, l: 42 }, { h: 213, s: 70, l: 55 },
  { h: 270, s: 60, l: 55 }, { h: 305, s: 65, l: 52 },
]
function clipHsl(idx: number, alpha: number | null = null, lAdj = 0) {
  const c = CLIP_PALETTE[(idx ?? 0) % CLIP_PALETTE.length]
  const l = Math.max(0, Math.min(100, c.l + lAdj))
  return alpha == null ? `hsl(${c.h},${c.s}%,${l}%)` : `hsla(${c.h},${c.s}%,${l}%,${alpha})`
}

// ── LAYOUT ─────────────────────────────────────────────────
const RAIL_W    = 72
const MINIMAP_H = 24
const TRI_HALF  = 6
const TRI_H     = 9
const FONT      = 'ui-monospace, Consolas, monospace'

interface TrackDef { id: string; label: string; h: number; space: 'input' | 'warp' | 'output'; flex: number }
interface LayoutTrack extends TrackDef { y: number }

// flex weights mirror ThinTimeline's DEFAULT_FLEX — index/strip rows stay at
// their min height (flex 0), expressive rows grow to fill (flex 1).
const ALL_TRACKS: TrackDef[] = [
  { id: 'time',      label: 'Time',       h: 20, space: 'input',  flex: 1 },
  { id: 'scenes',    label: 'Scenes',     h: 18, space: 'input',  flex: 0 },
  { id: 'clipin',    label: 'Clip In',    h: 28, space: 'input',  flex: 1 },
  { id: 'markerin',  label: 'Anchor In',  h: 28, space: 'input',  flex: 1 },
  { id: 'warp',      label: 'Warp',       h: 44, space: 'warp',   flex: 1 },
  { id: 'markerout', label: 'Anchor Out', h: 28, space: 'output', flex: 1 },
  { id: 'clipout',   label: 'Clip Out',   h: 28, space: 'output', flex: 0 },
  { id: 'beat',      label: 'Beats',      h: 20, space: 'output', flex: 1 },
  { id: 'speed',     label: 'Speed',      h: 22, space: 'output', flex: 0 },
]

function buildLayout(warpCollapsed: boolean, totalH: number, overrides: Record<string, number> = {}): LayoutTrack[] {
  const visible = ALL_TRACKS.filter(def => !(warpCollapsed && def.space !== 'input'))
  const available = totalH - MINIMAP_H - 1 - visible.length // gaps between rows

  let usedH = 0
  let flexSum = 0
  for (const t of visible) {
    if (overrides[t.id] !== undefined) usedH += overrides[t.id]
    else { usedH += t.h; flexSum += t.flex }
  }
  const extra = Math.max(0, available - usedH)

  const result: LayoutTrack[] = []
  let y = MINIMAP_H + 1
  for (const def of visible) {
    let h: number
    if (overrides[def.id] !== undefined) h = overrides[def.id]
    else h = def.h + (flexSum > 0 ? (def.flex / flexSum) * extra : 0)
    result.push({ ...def, h, y })
    y += h + 1
  }
  return result
}

// ── TICK STRATEGIES ────────────────────────────────────────
const TARGET_PX = 60

const TIME_TIERS: [number, number][] = [
  [0.001,0.0002],[0.002,0.0005],[0.005,0.001],[0.01,0.002],[0.02,0.005],
  [0.05,0.01],[0.1,0.02],[0.2,0.05],[0.5,0.1],[1,0.2],[2,0.5],[5,1],
  [10,2],[15,5],[30,10],[60,15],[120,30],[300,60],[600,120],[1800,300],[3600,600],
]

interface TickLayer {
  spacingUnit: number
  styleKey: 'bar' | 'beat' | 'sub'
  tickHeight?: number
  isMajor?: boolean
  skipModulo?: number
  label?: ((unit: number) => string | null) | null
  labelStyle?: 'major' | 'minor'
}

function timeLayers(pps: number, span: number): TickLayer[] {
  let tier = TIME_TIERS[TIME_TIERS.length - 1]
  for (const t of TIME_TIERS) { if (t[0] * pps >= TARGET_PX) { tier = t; break } }
  const [major, sub] = tier
  const ratio = Math.round(major / sub)
  const layers: TickLayer[] = []
  if (sub * pps >= 6) layers.push({ spacingUnit: sub, styleKey: 'sub', tickHeight: 5, skipModulo: ratio })
  const decimals = major >= 1 ? 0 : span < 2 ? 3 : 2
  layers.push({
    spacingUnit: major, styleKey: 'bar', isMajor: true,
    label: (s) => {
      if (s < 0) return null
      const ip = Math.floor(s)
      if (decimals === 0) return `${String(ip).padStart(2, '0')}s`
      return `${String(ip).padStart(2, '0')}${(s - ip).toFixed(decimals).slice(1)}s`
    },
    labelStyle: 'major',
  })
  return layers
}

function barsLayers(ppb: number, bpb: number): TickLayer[] {
  const ppbar = ppb * bpb
  let barGroup = 1
  while (ppbar * barGroup < TARGET_PX) barGroup *= 2
  if (barGroup > 4096) barGroup = 4096
  const subBarGroup = barGroup >= 8 ? barGroup / 8 : barGroup >= 2 ? 1 : 0
  const show16 = barGroup === 1 && ppb / 4 >= 6
  const show8  = barGroup === 1 && !show16 && ppb / 2 >= 9
  const showBt = barGroup === 1 && ppb >= 22
  const lblBt  = barGroup === 1 && ppb >= 70
  const layers: TickLayer[] = []
  if (show16) layers.push({ spacingUnit: 0.25, styleKey: 'sub', tickHeight: 4, skipModulo: 4 })
  else if (show8) layers.push({ spacingUnit: 0.5, styleKey: 'sub', tickHeight: 5, skipModulo: 2 })
  if (showBt) {
    layers.push({
      spacingUnit: 1, styleKey: 'beat', tickHeight: 9, skipModulo: bpb,
      label: lblBt ? (b) => {
        const bar = Math.floor(b / bpb)
        return `${bar >= 0 ? bar + 1 : bar}.${Math.floor(b % bpb) + 1}`
      } : null,
      labelStyle: 'minor',
    })
  }
  if (subBarGroup > 0) layers.push({
    spacingUnit: subBarGroup * bpb, styleKey: 'beat', tickHeight: 11,
    skipModulo: barGroup / subBarGroup,
  })
  layers.push({
    spacingUnit: barGroup * bpb, styleKey: 'bar', isMajor: true,
    label: (b) => { const bar = Math.floor(b / bpb); return String(bar >= 0 ? bar + 1 : bar) },
    labelStyle: 'major',
  })
  return layers
}

// ── PROPS ──────────────────────────────────────────────────
const GRID_DIVS = [
  { label: '1/1', value: 1 }, { label: '1/2', value: 2 }, { label: '1/2T', value: 3 },
  { label: '1/4', value: 4 }, { label: '1/4T', value: 6 }, { label: '1/8', value: 8 },
]

export interface CanvasTimelineProps {
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
  gridDiv?: number
  scenes: number[]
  scannedRanges?: ReadonlyArray<{ start: number; end: number }>
  onSceneAdd?: (time: number) => void
  onSceneDelete?: (time: number) => void
  onSceneContextMenu?: (time: number, x: number, y: number) => void
  onRegionAdd?: (time: number) => void
  onTimelineContextMenu?: (time: number, x: number, y: number) => void
  regions: RegionBlock[]
  regionsOutput?: RegionBlock[]
  onRegionSelect?: (id: string) => void
  onRegionContextMenu?: (id: string, x: number, y: number) => void
  onRegionResize?: (id: string, inPoint: number, outPoint: number) => void
  onRegionMove?: (id: string, inPoint: number, outPoint: number) => void
  onRegionResizeOutput?: (id: string, inBeatTime: number, outBeatTime: number) => void
  onRegionMoveOutput?: (id: string, inBeatTime: number, outBeatTime: number) => void
  onRegionZoom?: (id: string) => void
  onZoomToRegion?: () => void
  onGridDivChange?: (div: number) => void
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
  selectedClipIds?: ReadonlySet<string>
  onClipsSelectionChange?: (ids: Set<string>) => void
  selectedSceneTimes?: ReadonlySet<number>
  onScenesSelectionChange?: (times: Set<number>) => void
  userSceneTimes?: ReadonlySet<number>
  onTimelineDelete?: () => void
  onTimelineDeselect?: () => void
  warpCollapsed?: boolean
  onToggleWarp?: () => void
}

// ── HIT LIST (module-level, single instance) ──────────────
interface HitEntry { x: number; y: number; w: number; h: number; data: unknown }
let hits: HitEntry[] = []
const clearHits = () => { hits = [] }
const addHit = (x: number, y: number, w: number, h: number, data: unknown) =>
  hits.push({ x, y, w, h, data })
const hitAt = (px: number, py: number): unknown => {
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i]
    if (px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h) return h.data
  }
  return null
}

// ── SNAP ──────────────────────────────────────────────────
function snapTime(t: number, interval?: number, offset = 0): number {
  if (!interval || interval <= 0) return t
  return Math.round((t - offset) / interval) * interval + offset
}

/** Smallest grid spacing (seconds) currently drawn by the beat ruler at this
 *  zoom. The output-space snap interval is clamped to be no finer than this
 *  so we never snap to ticks the user can't see. */
function smallestVisibleBeatGridSec(viewSpanSec: number, canvasW: number, bpm: number): number {
  if (bpm <= 0 || canvasW <= 0 || viewSpanSec <= 0) return Number.POSITIVE_INFINITY
  const beatSec = 60 / bpm
  const pps = canvasW / viewSpanSec
  const ppb = pps * beatSec
  const bpb = 4
  const ppbar = ppb * bpb
  let barGroup = 1
  while (ppbar * barGroup < TARGET_PX) barGroup *= 2
  if (barGroup > 4096) barGroup = 4096
  if (barGroup > 1) {
    // Match barsLayers' subBarGroup logic — sub-bar ticks are drawn at this
    // spacing alongside the bar-group majors, so they're valid snap targets.
    const subBarGroup = barGroup >= 8 ? barGroup / 8 : 1
    return subBarGroup * bpb * beatSec
  }
  if (ppb / 4 >= 6) return 0.25 * beatSec
  if (ppb / 2 >= 9) return 0.5 * beatSec
  if (ppb >= 22) return 1 * beatSec
  return bpb * beatSec
}

function snapCandidates(
  subjects: readonly number[],
  targets: readonly { time: number }[],
  grid: { interval: number; offset: number } | undefined,
  thresholdSec: number,
): number[] {
  const seen = new Set<number>()
  for (const t of targets) {
    for (const s of subjects) {
      if (Math.abs(t.time - s) <= thresholdSec) { seen.add(t.time); break }
    }
  }
  if (grid && grid.interval > 0) {
    for (const s of subjects) {
      const lo = Math.ceil((s - thresholdSec - grid.offset) / grid.interval)
      const hi = Math.floor((s + thresholdSec - grid.offset) / grid.interval)
      for (let i = lo; i <= hi; i++) seen.add(grid.offset + i * grid.interval)
    }
  }
  // Keep only the nearest 2 candidates on each side of the subject group
  const center = subjects.reduce((a, b) => a + b, 0) / Math.max(1, subjects.length)
  const all = Array.from(seen)
  const left  = all.filter(t => t <  center).sort((a, b) => b - a).slice(0, 2)
  const right = all.filter(t => t >= center).sort((a, b) => a - b).slice(0, 2)
  return [...left, ...right]
}

// ── COMPONENT ─────────────────────────────────────────────
export default function CanvasTimeline(props: CanvasTimelineProps) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const propsRef   = useRef(props)
  propsRef.current = props

  const alwaysAnchors = useAppSelector(s => s.ui.timelineAlwaysAnchors)
  const alwaysRegions = useAppSelector(s => s.ui.timelineAlwaysRegions)
  const alwaysScenes  = useAppSelector(s => s.ui.timelineAlwaysScenes)
  const followDrag    = useAppSelector(s => s.ui.timelineFollowDrag)

  const snapHintsIn  = useGesture(s => s.snapHintsIn)
  const snapHintsOut = useGesture(s => s.snapHintsOut)
  const gestDragTime = useGesture(s => s.dragTime)

  // ── Track layout ────────────────────────────────────────
  const [containerH, setContainerH] = useState(0)
  const [rowOverrides, setRowOverrides] = useState<Record<string, number>>({})
  const rowResizeRef = useRef<{ aboveId: string; belowId: string; startY: number; hAbove: number; hBelow: number } | null>(null)

  const setThumbnailHover = useSetThumbnailHover()

  // UI scale — read once, update when the global ui-scale-change event fires.
  // Drives both DOM (via CSS calc(var(--ui-scale))) and canvas (via this state).
  const [uiScale, setUiScaleState] = useState<number>(() => getUiScale())
  useEffect(() => {
    const handler = (e: Event) => setUiScaleState((e as CustomEvent).detail as number)
    window.addEventListener('ui-scale-change', handler)
    return () => window.removeEventListener('ui-scale-change', handler)
  }, [])

  const warpCollapsed = props.warpCollapsed ?? false
  const tracks = useMemo(
    () => containerH > 0 ? buildLayout(warpCollapsed, containerH, rowOverrides) : [],
    [warpCollapsed, containerH, rowOverrides],
  )
  const tracksRef = useRef<LayoutTrack[]>([])
  tracksRef.current = tracks

  // ── Theme colors (read once, updated on theme change) ───
  const themeRef = useRef({
    bg0: BG0, bg2: BG2, bg4: '#1c1915', bgInset: '#131110', bgWarp: BGWARP, fg1: FG1, fg3: FG3, fg4: FG4,
    border: '#2c2720',
    fg1Rgb: '226,219,210', beatRgb: '255,240,220', playheadRgb: '240,92,92',
    spaceInput: SP_INPUT, spaceInputHi: MARKER_HOVER, spaceWarp: SP_WARP, spaceOutput: SP_OUTPUT,
    playhead: PLAYHEAD_COL, sceneCut: SCENE_COLOR,
    sceneCutHi: 'hsl(48,100%,72%)', sceneCutBd: 'hsl(40,90%,45%)',
    sceneCutActive: 'hsl(48,100%,78%)', sceneCutActiveBd: 'hsl(48,100%,88%)',
    snapColor: 'hsl(140,80%,65%)', snapActive: 'hsl(50,100%,60%)',
  })
  useEffect(() => {
    const read = () => {
      const s = getComputedStyle(document.documentElement)
      const g = (v: string) => s.getPropertyValue(v).trim()
      themeRef.current = {
        bg0:         g('--bg-0')         || BG0,
        bg2:         g('--bg-2')         || BG2,
        bg4:         g('--bg-4')         || '#1c1915',
        bgInset:     g('--bg-inset')     || '#131110',
        bgWarp:      g('--wp-bg')        || BGWARP,
        border:      g('--border')       || '#2c2720',
        fg1:         g('--fg-1')         || FG1,
        fg3:         g('--fg-3')         || FG3,
        fg4:         g('--fg-4')         || FG4,
        fg1Rgb:      g('--fg-1-rgb')     || '226,219,210',
        beatRgb:     g('--beat-rgb')     || '255,240,220',
        playheadRgb: g('--playhead-rgb') || '240,92,92',
        spaceInput:  g('--space-input')  || SP_INPUT,
        spaceInputHi:g('--blue-light')   || MARKER_HOVER,
        spaceWarp:   g('--space-warp')   || SP_WARP,
        spaceOutput: g('--space-output') || SP_OUTPUT,
        playhead:    g('--playhead')     || PLAYHEAD_COL,
        sceneCut:    g('--scene-cut')    || SCENE_COLOR,
        sceneCutHi:        g('--scene-cut-hi')        || 'hsl(48,100%,72%)',
        sceneCutBd:        g('--scene-cut-bd')        || 'hsl(40,90%,45%)',
        sceneCutActive:    g('--scene-cut-active')    || 'hsl(48,100%,78%)',
        sceneCutActiveBd:  g('--scene-cut-active-bd') || 'hsl(48,100%,88%)',
        snapColor:   g('--snap')         || 'hsl(140,80%,65%)',
        snapActive:  g('--snap-active')  || 'hsl(50,100%,60%)',
      }
      drawRef.current()
    }
    read()
    const obs = new MutationObserver(read)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })
    return () => obs.disconnect()
  }, [])

  // ── Hover state ──────────────────────────────────────────
  const hoverAnchorId = useRef<number | null>(null)
  const hoverRegionId = useRef<string | null>(null)
  const hoverRegionEdge = useRef<{ id: string; edge: 'in' | 'out' } | null>(null)
  const hoverSceneTime = useRef<number | null>(null)
  const hoverX        = useRef<number | null>(null)
  const [hoverTrackId, setHoverTrackId] = useState<string | null>(null)

  // Live anchor arrays during drag
  const liveAnchorsIn  = useRef<Anchor[]>([])
  const liveAnchorsOut = useRef<Anchor[]>([])
  const liveRegion = useRef<{ id: string; inPoint: number; outPoint: number } | null>(null)
  const lassoAnchorIds  = useRef<Set<number>>(new Set())
  const lassoClipIds    = useRef<Set<string>>(new Set())
  const lassoSceneTimes = useRef<Set<number>>(new Set())

  type DragKind =
    | { kind: 'seek'; space: 'input' | 'output' }
    | { kind: 'pan'; startX: number; startView: View }
    | { kind: 'minimap'; startX: number; startView: View }
    | { kind: 'anchor'; id: number; space: 'input' | 'output'; origTime: number }
    | { kind: 'region-edge'; id: string; edge: 'in' | 'out'; isOutput: boolean; origIn: number; origOut: number }
    | { kind: 'region-move'; id: string; isOutput: boolean; origIn: number; origOut: number; anchorX: number }
    | { kind: 'lasso'; startX: number; startY: number; curX: number; curY: number; additive: boolean; initialAnchorIds: Set<number>; initialClipIds: Set<string>; initialSceneTimes: Set<number>; active: boolean }

  const dragRef = useRef<DragKind | null>(null)

  // ── DRAW ────────────────────────────────────────────────
  function draw() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
    if (!ctx) return
    const p = propsRef.current

    const dpr  = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    const W = rect.width, H = rect.height
    if (W === 0 || H === 0) return

    if (canvas.width  !== Math.round(W * dpr) ||
        canvas.height !== Math.round(H * dpr)) {
      canvas.width  = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const tracks = tracksRef.current
    if (!tracks.length) return
    const byId = (id: string) => tracks.find(t => t.id === id)

    const th = themeRef.current
    // Shadow module-level palette with theme values so every draw picks up current theme
    /* eslint-disable @typescript-eslint/no-shadow */
    const BG0    = th.bg0,    BG2 = th.bg2,  BGWARP = th.bgWarp
    const FG1    = th.fg1,    FG3 = th.fg3
    void (th.fg4) // FG4 unused in draw but kept on themeRef for completeness
    const BAR_TICK  = `rgba(${th.fg1Rgb},0.75)`
    const BEAT_TICK = `rgba(${th.fg1Rgb},0.45)`
    const SUB_TICK  = `rgba(${th.fg1Rgb},0.28)`
    const GRID_BAR  = `rgba(${th.fg1Rgb},0.038)`
    const GRID_BEAT = `rgba(${th.fg1Rgb},0.016)`
    const MARKER_COLOR  = th.spaceInput
    const MARKER_HOVER  = th.spaceInputHi
    const PLAYHEAD_COL  = th.playhead
    const PLAYHEAD_GLOW = `rgba(${th.playheadRgb},0.22)`
    const SCENE_COLOR   = th.sceneCut
    const THROUGH_COLOR = `hsla(${th.fg1Rgb},0.5)`
    const THROUGH_HOVER = `hsla(${th.fg1Rgb},0.85)`
    // UI scale only applies to text-bearing elements per design intent —
    // tick labels and scene/anchor sizes remain pixel-stable.
    const SC = uiScale
    /* eslint-enable @typescript-eslint/no-shadow */

    const view = p.view
    const tX   = (t: number) => ((t - view.start) / (view.end - view.start)) * W
    const xToT = (x: number) => view.start + (x / W) * (view.end - view.start)

    const beatOffset = p.beatOffset ?? 0
    const bpm        = p.bpm
    const beatSec    = 60 / bpm

    const anchors    = liveAnchorsIn.current.length  ? liveAnchorsIn.current  : p.anchors
    const beatAnchors = liveAnchorsOut.current.length ? liveAnchorsOut.current : p.beatAnchors
    const beatById = new Map<number, number>()
    for (const b of beatAnchors) beatById.set(b.id, b.time)
    // Anchors paired by id and sorted by input time; everything that
    // connects input ↔ output anchors must iterate these pairs.
    const anchorPairs: { id: number; inT: number; outT: number }[] = []
    for (const a of anchors) {
      const outT = beatById.get(a.id)
      if (outT !== undefined) anchorPairs.push({ id: a.id, inT: a.time, outT })
    }
    anchorPairs.sort((a, b) => a.inT - b.inT)

    function spaceRange(space: 'input' | 'warp' | 'output') {
      const ts = tracks.filter(t => t.space === space)
      if (!ts.length) return null
      return { top: ts[0].y, bottom: ts[ts.length - 1].y + ts[ts.length - 1].h }
    }

    function inputToOutput(inputTime: number): number {
      if (!p.segments.length || p.duration <= 0) return inputTime
      const inputPct = (inputTime / p.duration) * 100
      for (const seg of p.segments) {
        if (inputPct >= seg.origLeft - 1e-6 && inputPct <= seg.origRight + 1e-6) {
          const span = seg.origRight - seg.origLeft
          const t = span > 0 ? (inputPct - seg.origLeft) / span : 0
          return ((seg.quantLeft + t * (seg.quantRight - seg.quantLeft)) / 100) * p.outputDuration
        }
      }
      return (p.outputDuration / p.duration) * inputTime
    }

    function setFont(size: number, bold: boolean) {
      ctx.font = `${bold ? '600 ' : ''}${Math.round(size * SC)}px ${FONT}`
    }

    clearHits()

    // ── Backgrounds ──────────────────────────────────────
    ctx.fillStyle = BG0
    ctx.fillRect(0, 0, W, H)
    for (const tr of tracks) {
      ctx.fillStyle = BG0
      ctx.fillRect(0, tr.y, W, tr.h)
      ctx.fillStyle = th.border
      ctx.fillRect(0, tr.y + tr.h, W, 1)
    }

    // ── Minimap ──────────────────────────────────────────
    const maxDur = Math.max(p.duration, p.outputDuration)
    ctx.fillStyle = th.bgInset
    ctx.fillRect(0, 0, W, MINIMAP_H)
    const barH = 6, barY = Math.round((MINIMAP_H - barH) / 2)
    for (const r of p.regions) {
      const x1 = (r.inPoint  / maxDur) * W
      const x2 = (r.outPoint / maxDur) * W
      const isSel = r.active || r.selected
      ctx.fillStyle = clipHsl(r.colorIndex ?? 0, isSel ? 0.65 : 0.45)
      ctx.fillRect(x1, barY, x2 - x1, barH)
      ctx.strokeStyle = clipHsl(r.colorIndex ?? 0, isSel ? 1 : 0.9)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x1 + 0.5, barY); ctx.lineTo(x1 + 0.5, barY + barH)
      ctx.moveTo(x2 - 0.5, barY); ctx.lineTo(x2 - 0.5, barY + barH)
      ctx.stroke()
    }
    for (const a of anchors) {
      const x = (a.time / maxDur) * W
      ctx.fillStyle = MARKER_COLOR
      ctx.globalAlpha = 0.6
      ctx.fillRect(Math.round(x), barY, 1, barH)
      ctx.globalAlpha = 1
    }
    const visibleSpan = view.end - view.start
    if (maxDur > 0 && visibleSpan < maxDur - 0.001) {
      const vx1 = (view.start / maxDur) * W
      const vx2 = (view.end   / maxDur) * W
      const vInset = 2
      const { beatRgb } = themeRef.current
      ctx.fillStyle = `rgba(${beatRgb},0.1)`
      ctx.fillRect(vx1, vInset, vx2 - vx1, MINIMAP_H - vInset * 2)
      ctx.strokeStyle = `rgba(${beatRgb},0.75)`
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.roundRect(vx1 + 0.5, vInset + 0.5, Math.max(0, vx2 - vx1 - 1), MINIMAP_H - vInset * 2 - 1, 4)
      ctx.stroke()
    }
    const phm = ((p.playhead ?? 0) / maxDur) * W
    ctx.fillStyle = PLAYHEAD_COL
    ctx.fillRect(Math.round(phm), 0, 1, MINIMAP_H)
    ctx.fillStyle = th.border
    ctx.fillRect(0, MINIMAP_H, W, 1)
    addHit(0, 0, W, MINIMAP_H, { kind: 'minimap' })

    // ── Clip into canvas area ─────────────────────────────
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, MINIMAP_H + 1, W, H)
    ctx.clip()

    // ── Time ruler ───────────────────────────────────────
    {
      const tr = byId('time')
      if (tr) {
        const pps  = W / (view.end - view.start)
        const span = view.end - view.start
        for (const layer of timeLayers(pps, span)) {
          const su       = layer.spacingUnit
          const first    = Math.floor(view.start / su) - 1
          const last     = Math.ceil(view.end    / su) + 1
          const tkClr    = layer.styleKey === 'bar' ? BAR_TICK : SUB_TICK
          const gdClr    = layer.styleKey === 'bar' ? GRID_BAR : GRID_BEAT
          const tickTop  = layer.isMajor ? tr.y + 3 : tr.y + tr.h - (layer.tickHeight ?? 6)

          const trWarp = byId('warp')
          const inpBot = (spaceRange('input')?.bottom ?? tr.y + tr.h) + (trWarp ? trWarp.h / 2 : 0)
          ctx.strokeStyle = gdClr; ctx.lineWidth = 1; ctx.beginPath()
          for (let i = first; i <= last; i++) {
            if (layer.skipModulo && i % layer.skipModulo === 0) continue
            const t = i * su
            if (t < 0 || t > p.duration + 1e-6) continue
            const x = Math.round(tX(t)) + 0.5
            if (x < 0 || x > W) continue
            ctx.moveTo(x, tr.y + tr.h); ctx.lineTo(x, inpBot)
          }
          ctx.stroke()

          ctx.strokeStyle = tkClr; ctx.lineWidth = 1; ctx.beginPath()
          for (let i = first; i <= last; i++) {
            if (layer.skipModulo && i % layer.skipModulo === 0) continue
            const t = i * su
            if (t < 0 || t > p.duration + 1e-6) continue
            const x = Math.round(tX(t)) + 0.5
            if (x < 0 || x > W) continue
            ctx.moveTo(x, tickTop); ctx.lineTo(x, tr.y + tr.h - 1)
          }
          ctx.stroke()

          if (layer.label) {
            const isMaj = layer.labelStyle === 'major'
            ctx.fillStyle = isMaj ? FG1 : FG3
            setFont(isMaj ? 10 : 9, isMaj)
            ctx.textAlign = 'left'; ctx.textBaseline = 'top'
            for (let i = first; i <= last; i++) {
              if (layer.skipModulo && i % layer.skipModulo === 0) continue
              const t = i * su; if (t < 0) continue
              const x = Math.round(tX(t)); if (x < 0 || x > W) continue
              const text = layer.label(t); if (text == null) continue
              ctx.fillText(text, x + 3, tr.y + (isMaj ? 3 : 5))
            }
          }
        }
      }
    }

    // ── Scenes ───────────────────────────────────────────
    {
      const tr = byId('scenes')
      if (tr) {
        if (p.scannedRanges) {
          ctx.fillStyle = `rgba(${th.fg1Rgb},0.04)`
          for (const sr of p.scannedRanges) {
            const x1 = tX(sr.start), x2 = tX(sr.end)
            if (x2 < 0 || x1 > W) continue
            const xLo = Math.max(x1, 0), xHi = Math.min(x2, W)
            // Thin strip at bottom of track so the scene track BG itself stays uniform
            ctx.fillRect(xLo, tr.y + tr.h - 2, xHi - xLo, 2)
          }
        }
        const cy = tr.y + tr.h / 2
        // Diamond spans the full track height — active state uses color only,
        // not a size bump, to keep edges flush with the track.
        const baseR = tr.h / 2
        const playhead = p.playhead ?? -1
        const PLAYHEAD_TOL = 0.05
        for (const t of p.scenes) {
          const x = tX(t)
          if (x < -10 || x > W + 10) continue
          const isUser   = p.userSceneTimes?.has(t) ?? false
          const isSel    = p.selectedSceneTimes?.has(t) ?? false
          const isHov    = hoverSceneTime.current === t
          const isActive = playhead >= 0 && Math.abs(t - playhead) <= PLAYHEAD_TOL
          const R = baseR
          const fill = isActive
            ? th.sceneCutActive
            : isHov
              ? th.sceneCutHi
              : isUser
                ? 'hsl(195,75%,62%)'
                : SCENE_COLOR
          ctx.fillStyle = fill
          ctx.globalAlpha = (alwaysScenes || isSel || isHov || isActive) ? 1 : 0.85
          ctx.beginPath()
          ctx.moveTo(x, cy - R); ctx.lineTo(x + R, cy)
          ctx.lineTo(x, cy + R); ctx.lineTo(x - R, cy)
          ctx.closePath()
          ctx.fill()
          // Always-on hairline border (matches ThinTimeline)
          ctx.strokeStyle = isActive ? th.sceneCutActiveBd : th.sceneCutBd
          ctx.lineWidth = 1
          ctx.stroke()
          // Selected ring — light blue outer ring on top of the bd
          if (isSel) {
            ctx.strokeStyle = 'hsl(195,100%,75%)'
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(x, cy - R - 1.5); ctx.lineTo(x + R + 1.5, cy)
            ctx.lineTo(x, cy + R + 1.5); ctx.lineTo(x - R - 1.5, cy)
            ctx.closePath()
            ctx.stroke()
          }
          ctx.globalAlpha = 1
          const hitR = Math.ceil(R + 2)
          addHit(x - hitR, tr.y, hitR * 2, tr.h, { kind: 'scene', time: t })
        }
      }
    }

    // ── Clip regions (helper) ─────────────────────────────
    function drawRegions(tr: LayoutTrack | undefined, regions: RegionBlock[], isOutput: boolean) {
      if (!tr) return
      const lAdj = isOutput ? -18 : 0
      for (const r of regions) {
        const x1 = tX(r.inPoint), x2 = tX(r.outPoint)
        if (x2 < 0 || x1 > W) continue
        const cx1 = Math.max(x1, 0), cx2 = Math.min(x2, W), cw = cx2 - cx1
        const isHov = hoverRegionId.current === r.id
        const isSel = r.selected || r.active

        ctx.fillStyle = clipHsl(r.colorIndex ?? 0, isHov ? 0.45 : isSel ? 0.38 : 0.32, lAdj)
        ctx.fillRect(cx1, tr.y + 2, cw, tr.h - 4)
        ctx.strokeStyle = clipHsl(r.colorIndex ?? 0, isSel ? 1 : isHov ? 1 : 0.95, lAdj)
        ctx.lineWidth = isSel ? 1.5 : 1
        ctx.strokeRect(cx1 + 0.5, tr.y + 2.5, cw - 1, tr.h - 5)

        if (cw > 20 && r.label && !isOutput) {
          ctx.fillStyle = FG1; ctx.globalAlpha = 0.9
          setFont(10, true)
          ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
          ctx.save(); ctx.beginPath()
          ctx.rect(cx1 + 1, tr.y + 2, cw - 2, tr.h - 4); ctx.clip()
          ctx.fillText(r.label, cx1 + 5, tr.y + tr.h / 2)
          ctx.restore(); ctx.globalAlpha = 1
        }

        // Body hit registered FIRST so edges (added below) win at overlap.
        addHit(cx1, tr.y, cw, tr.h, { kind: 'region', id: r.id, isOutput })
        const edgeHov = hoverRegionEdge.current
        const hovIn   = edgeHov?.id === r.id && edgeHov.edge === 'in'
        const hovOut  = edgeHov?.id === r.id && edgeHov.edge === 'out'
        if (x1 >= -2) {
          if (hovIn) {
            ctx.fillStyle = clipHsl(r.colorIndex ?? 0, 1, lAdj + 25)
            ctx.fillRect(x1, tr.y + 2, 3, tr.h - 4)
          }
          addHit(x1 - 5, tr.y, 10, tr.h, { kind: 'region-edge', id: r.id, edge: 'in', isOutput })
        }
        if (x2 <= W + 2) {
          if (hovOut) {
            ctx.fillStyle = clipHsl(r.colorIndex ?? 0, 1, lAdj + 25)
            ctx.fillRect(x2 - 3, tr.y + 2, 3, tr.h - 4)
          }
          addHit(x2 - 5, tr.y, 10, tr.h, { kind: 'region-edge', id: r.id, edge: 'out', isOutput })
        }
      }
    }

    drawRegions(byId('clipin'),  p.regions, false)
    drawRegions(byId('clipout'), p.regionsOutput ?? p.regions, true)

    // ── Through-lines ────────────────────────────────────
    {
      const inp  = spaceRange('input')
      const out  = spaceRange('output')
      const warp = byId('warp')
      ctx.setLineDash([2, 2]); ctx.lineWidth = 1

      for (const pair of anchorPairs) {
        const hov = hoverAnchorId.current === pair.id
        const sel = p.selectedAnchorIds.has(pair.id)
        if (!hov && !sel && !alwaysAnchors) continue
        ctx.strokeStyle = hov ? THROUGH_HOVER : sel ? 'hsla(195,85%,75%,0.7)' : THROUGH_COLOR

        const inX = tX(pair.inT), outX = tX(pair.outT)
        if (inp && inX >= 0 && inX <= W) {
          ctx.beginPath(); ctx.moveTo(inX + 0.5, inp.top); ctx.lineTo(inX + 0.5, inp.bottom); ctx.stroke()
        }
        if (warp) {
          ctx.beginPath(); ctx.moveTo(inX + 0.5, warp.y); ctx.lineTo(outX + 0.5, warp.y + warp.h); ctx.stroke()
        }
        if (out && outX >= 0 && outX <= W) {
          ctx.beginPath(); ctx.moveTo(outX + 0.5, out.top); ctx.lineTo(outX + 0.5, out.bottom); ctx.stroke()
        }
      }

      if (alwaysRegions) {
        for (const r of p.regions) {
          ctx.strokeStyle = clipHsl(r.colorIndex ?? 0, 0.5)
          for (const inT of [r.inPoint, r.outPoint]) {
            const inX  = tX(inT)
            const outT = inputToOutput(inT)
            const outX = tX(outT)
            if (inp && inX >= 0 && inX <= W) {
              ctx.beginPath(); ctx.moveTo(inX + 0.5, inp.top); ctx.lineTo(inX + 0.5, inp.bottom); ctx.stroke()
            }
            if (warp) {
              ctx.beginPath(); ctx.moveTo(inX + 0.5, warp.y); ctx.lineTo(outX + 0.5, warp.y + warp.h); ctx.stroke()
            }
            if (out && outX >= 0 && outX <= W) {
              ctx.beginPath(); ctx.moveTo(outX + 0.5, out.top); ctx.lineTo(outX + 0.5, out.bottom); ctx.stroke()
            }
          }
        }
      }

      if (alwaysScenes || (p.selectedSceneTimes && p.selectedSceneTimes.size > 0)) {
        if (inp) {
          for (const t of p.scenes) {
            const isSel  = p.selectedSceneTimes?.has(t) ?? false
            if (!alwaysScenes && !isSel) continue
            const x = tX(t)
            if (x < 0 || x > W) continue
            const isUser = p.userSceneTimes?.has(t) ?? false
            ctx.strokeStyle = isUser
              ? 'hsla(195,75%,62%,0.6)'
              : `hsla(48,95%,62%,${isSel ? '0.75' : '0.45'})`
            ctx.beginPath(); ctx.moveTo(x + 0.5, inp.top); ctx.lineTo(x + 0.5, inp.bottom); ctx.stroke()
          }
        }
      }

      ctx.setLineDash([])
    }

    // ── Region envelopes (markerin → warp → markerout as one shape) ──
    {
      const trMIn  = byId('markerin')
      const trMOut = byId('markerout')
      const trWarp = byId('warp')
      if (trMIn) {
        const rOut = p.regionsOutput ?? p.regions
        const n = Math.min(p.regions.length, rOut.length)
        for (let ri = 0; ri < n; ri++) {
          const rIn = p.regions[ri], rO = rOut[ri]
          const x0 = tX(rIn.inPoint),  x1 = tX(rIn.outPoint)
          const x3 = tX(rO.inPoint),   x2 = tX(rO.outPoint)
          if (Math.max(x1, x2) < 0 || Math.min(x0, x3) > W) continue
          const cIdx = rIn.colorIndex ?? 0

          // Single-polygon fill spanning all three rows
          const topY = trMIn.y
          const botY = trMOut ? trMOut.y + trMOut.h : trWarp ? trWarp.y + trWarp.h : trMIn.y + trMIn.h
          const warpTopY = trWarp ? trWarp.y : trMIn.y + trMIn.h
          const warpBotY = trWarp ? trWarp.y + trWarp.h : warpTopY
          ctx.fillStyle = clipHsl(cIdx, 0.12)
          ctx.beginPath()
          ctx.moveTo(x0, topY)
          ctx.lineTo(x1, topY)
          ctx.lineTo(x1, warpTopY)
          ctx.lineTo(x2, warpBotY)
          ctx.lineTo(x2, botY)
          ctx.lineTo(x3, botY)
          ctx.lineTo(x3, warpBotY)
          ctx.lineTo(x0, warpTopY)
          ctx.closePath(); ctx.fill()

          // Continuous outline (left side, then right side)
          ctx.strokeStyle = clipHsl(cIdx, 0.6)
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(x0 + 0.5, topY)
          ctx.lineTo(x0 + 0.5, warpTopY)
          if (trWarp) ctx.lineTo(x3 + 0.5, warpBotY)
          if (trMOut) ctx.lineTo(x3 + 0.5, botY)
          ctx.stroke()
          ctx.beginPath()
          ctx.moveTo(x1 - 0.5, topY)
          ctx.lineTo(x1 - 0.5, warpTopY)
          if (trWarp) ctx.lineTo(x2 - 0.5, warpBotY)
          if (trMOut) ctx.lineTo(x2 - 0.5, botY)
          ctx.stroke()
        }
      }
    }

    // ── Warp zone (anchor diagonals only — region fills are above) ───
    {
      const tr = byId('warp')
      if (tr) {
        const inY  = tr.y, outY = tr.y + tr.h
        ctx.save(); ctx.beginPath()
        ctx.rect(0, inY, W, tr.h); ctx.clip()

        ctx.strokeStyle = SP_WARP; ctx.lineWidth = 1
        for (const pair of anchorPairs) {
          const ix = tX(pair.inT), ox = tX(pair.outT)
          ctx.beginPath(); ctx.moveTo(ix + 0.5, inY); ctx.lineTo(ox + 0.5, outY); ctx.stroke()
        }

        ctx.restore()
        ctx.fillStyle = th.border
        ctx.fillRect(0, inY - 1, W, 1)
        ctx.fillRect(0, outY, W, 1)
      }
    }

    // ── Snap highlights (gesture store, during drag) ──────
    {
      const inp = spaceRange('input')
      const out = spaceRange('output')
      const SNAP_EPS = 1e-6
      const activeIn  = gestDragTime?.space === 'input'  ? gestDragTime.time : null
      const activeOut = gestDragTime?.space === 'output' ? gestDragTime.time : null

      function drawSnapHint(t: number, range: { top: number; bottom: number } | null, isActive: boolean) {
        if (!range) return
        const x = Math.round(tX(t)) + 0.5
        if (x < 0 || x > W) return
        ctx.strokeStyle = isActive ? th.snapActive : th.snapColor
        ctx.globalAlpha = isActive ? 0.95 : 0.6
        ctx.lineWidth   = isActive ? 1.5 : 1
        ctx.setLineDash([3, 3])
        ctx.beginPath(); ctx.moveTo(x, range.top); ctx.lineTo(x, range.bottom); ctx.stroke()
        ctx.setLineDash([])
        ctx.globalAlpha = 1
      }

      for (const t of snapHintsIn) {
        const isActive = activeIn !== null && Math.abs(activeIn - t) < SNAP_EPS
        drawSnapHint(t, inp, isActive)
      }
      for (const t of snapHintsOut) {
        const isActive = activeOut !== null && Math.abs(activeOut - t) < SNAP_EPS
        drawSnapHint(t, out, isActive)
      }
    }

    // ── Anchor markers ───────────────────────────────────
    function drawAnchorIn(x: number, tr: LayoutTrack, hov: boolean, sel: boolean) {
      if (x < -TRI_HALF - 2 || x > W + TRI_HALF + 2) return
      const col = hov ? MARKER_HOVER : sel ? 'hsl(195,85%,78%)' : MARKER_COLOR
      ctx.strokeStyle = col; ctx.lineWidth = hov ? 2 : 1.5
      const apexY = tr.y + TRI_H
      ctx.beginPath()
      ctx.moveTo(x - TRI_HALF, tr.y); ctx.lineTo(x + TRI_HALF, tr.y); ctx.lineTo(x, apexY)
      ctx.closePath()
      ctx.fillStyle = sel && !hov ? 'hsla(195,85%,70%,0.35)' : col
      ctx.fill()
      ctx.stroke()
      ctx.beginPath(); ctx.moveTo(x, apexY); ctx.lineTo(x, tr.y + tr.h - 1); ctx.stroke()
    }
    function drawAnchorOut(x: number, tr: LayoutTrack, hov: boolean, linked: boolean) {
      if (x < -TRI_HALF - 2 || x > W + TRI_HALF + 2) return
      const col = hov ? MARKER_HOVER : MARKER_COLOR
      ctx.strokeStyle = col; ctx.lineWidth = hov ? 2 : 1.5
      const apexY = tr.y + tr.h - TRI_H
      ctx.beginPath()
      ctx.moveTo(x - TRI_HALF, tr.y + tr.h); ctx.lineTo(x + TRI_HALF, tr.y + tr.h); ctx.lineTo(x, apexY)
      ctx.closePath()
      if (linked) {
        ctx.fillStyle = col; ctx.fill()
      } else {
        ctx.globalAlpha = 0.55; ctx.stroke(); ctx.globalAlpha = 1
      }
      if (linked) ctx.stroke()
      ctx.beginPath(); ctx.moveTo(x, tr.y + 1); ctx.lineTo(x, apexY); ctx.stroke()
    }

    const trIn  = byId('markerin')
    const trOut = byId('markerout')

    if (trIn) {
      for (const a of anchors) {
        const x = tX(a.time)
        const hov = hoverAnchorId.current === a.id
        const sel = p.selectedAnchorIds.has(a.id)
        drawAnchorIn(x, trIn, hov, sel)
        addHit(x - TRI_HALF - 2, trIn.y, (TRI_HALF + 2) * 2, trIn.h,
          { kind: 'anchor', id: a.id, space: 'input' })
      }
    }
    if (trOut) {
      for (const a of beatAnchors) {
        const x = tX(a.time)
        const hov = hoverAnchorId.current === a.id
        const linked = !p.linkedBeatIds || p.linkedBeatIds.has(a.id)
        drawAnchorOut(x, trOut, hov, linked)
        addHit(x - TRI_HALF - 2, trOut.y, (TRI_HALF + 2) * 2, trOut.h,
          { kind: 'anchor', id: a.id, space: 'output' })
      }
    }

    // ── Beat ruler ───────────────────────────────────────
    {
      const tr = byId('beat')
      if (tr) {
        const pps  = W / (view.end - view.start)
        const ppb  = pps * beatSec
        const bpb  = 4
        for (const layer of barsLayers(ppb, bpb)) {
          const su            = layer.spacingUnit
          const vStartB       = (view.start - beatOffset) / beatSec
          const vEndB         = (view.end   - beatOffset) / beatSec
          const firstIdx      = Math.floor(vStartB / su) - 1
          const lastIdx       = Math.ceil(vEndB    / su) + 1
          const tkClr = layer.styleKey === 'bar' ? BAR_TICK : layer.styleKey === 'beat' ? BEAT_TICK : SUB_TICK
          const gdClr = layer.styleKey === 'bar' ? GRID_BAR : layer.styleKey === 'beat' ? GRID_BEAT : 'rgba(0,0,0,0)'
          const tickTop = layer.isMajor ? tr.y + 2 : tr.y + tr.h - (layer.tickHeight ?? 6)

          const outRange = spaceRange('output')
          const beatTr = byId('beat')
          const trWarp = byId('warp')
          const outTop = (outRange?.top ?? tr.y) - (trWarp ? trWarp.h / 2 : 0)
          const outBot = beatTr ? beatTr.y + beatTr.h : (outRange?.bottom ?? tr.y + tr.h)
          ctx.strokeStyle = gdClr; ctx.lineWidth = 1; ctx.beginPath()
          for (let i = firstIdx; i <= lastIdx; i++) {
            if (layer.skipModulo && i % layer.skipModulo === 0) continue
            const bv = i * su
            const t  = beatOffset + bv * beatSec
            if (t < -1e-6 || t > p.outputDuration + 1e-6) continue
            const x = Math.round(tX(t)) + 0.5
            if (x < 0 || x > W) continue
            ctx.moveTo(x, outTop); ctx.lineTo(x, outBot)
          }
          ctx.stroke()

          ctx.strokeStyle = tkClr; ctx.lineWidth = layer.isMajor ? 1.5 : 1; ctx.beginPath()
          for (let i = firstIdx; i <= lastIdx; i++) {
            if (layer.skipModulo && i % layer.skipModulo === 0) continue
            const bv = i * su
            const t  = beatOffset + bv * beatSec
            if (t < -1e-6 || t > p.outputDuration + 1e-6) continue
            const x = Math.round(tX(t)) + 0.5
            if (x < 0 || x > W) continue
            ctx.moveTo(x, tickTop); ctx.lineTo(x, tr.y + tr.h - 1)
          }
          ctx.stroke()

          if (layer.label) {
            const isMaj = layer.labelStyle === 'major'
            ctx.fillStyle = isMaj ? FG1 : FG3
            setFont(isMaj ? 10 : 9, isMaj)
            ctx.textAlign = 'left'; ctx.textBaseline = 'top'
            for (let i = firstIdx; i <= lastIdx; i++) {
              if (layer.skipModulo && i % layer.skipModulo === 0) continue
              const bv = i * su
              const t  = beatOffset + bv * beatSec
              if (t < -1e-6 || t > p.outputDuration + 1e-6) continue
              const x = Math.round(tX(t)); if (x < 0 || x > W) continue
              const text = layer.label(bv); if (text == null) continue
              ctx.fillText(text, x + 3, tr.y + (isMaj ? 2 : 5))
            }
          }
        }
      }
    }

    // ── Speed strip ──────────────────────────────────────
    {
      const tr = byId('speed')
      if (tr) {
        for (let i = 0; i < anchorPairs.length - 1; i++) {
          const inSpan  = anchorPairs[i + 1].inT  - anchorPairs[i].inT
          const outSpan = anchorPairs[i + 1].outT - anchorPairs[i].outT
          if (inSpan <= 0) continue
          const speed = outSpan / inSpan
          const x1  = tX(anchorPairs[i].outT)
          const x2  = tX(anchorPairs[i + 1].outT)
          const cx1 = Math.max(x1, 0), cx2 = Math.min(x2, W)
          if (cx2 <= cx1) continue
          // Symmetric deviation: 0 at 1×, 1 at 2× or 0.5×.
          // ±10% (dev ≤ 0.1) is a deadband — no color.
          // Above that, ramp linearly to 0.5 opacity by 2× / 0.5×.
          const dev = speed >= 1 ? speed - 1 : 1 / speed - 1
          const a = dev <= 0.1 ? 0 : Math.min(0.5, 0.5 * (dev - 0.1) / 0.9)
          if (a > 0) {
            ctx.fillStyle = speed < 1 ? `rgba(96,165,250,${a})` : `rgba(239,68,68,${a})`
            ctx.fillRect(cx1 + 1, tr.y + 3, cx2 - cx1 - 2, tr.h - 6)
          }
          if (cx2 - cx1 > 28) {
            ctx.fillStyle = FG3; setFont(9, false)
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
            ctx.fillText(`${speed.toFixed(2)}×`, (cx1 + cx2) / 2, tr.y + tr.h / 2)
          }
        }
      }
    }

    // ── Playhead ─────────────────────────────────────────
    {
      const inp  = spaceRange('input')
      const out  = spaceRange('output')
      const warp = byId('warp')
      const timeTr = byId('time')

      const inPx  = tX(p.playhead ?? 0)
      const outPx = tX(p.beatPlayhead ?? p.playhead ?? 0)

      function vline(x: number, y1: number, y2: number, glow: boolean) {
        const px = Math.round(x) + 0.5
        if (px < -2 || px > W + 2) return
        if (glow) {
          ctx.strokeStyle = PLAYHEAD_GLOW; ctx.lineWidth = 3
          ctx.beginPath(); ctx.moveTo(px, y1); ctx.lineTo(px, y2); ctx.stroke()
        }
        ctx.strokeStyle = PLAYHEAD_COL; ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(px, y1); ctx.lineTo(px, y2); ctx.stroke()
      }

      if (inp) vline(inPx, inp.top, inp.bottom, true)
      if (warp) {
        ctx.strokeStyle = PLAYHEAD_GLOW; ctx.lineWidth = 3
        ctx.beginPath(); ctx.moveTo(inPx + 0.5, warp.y); ctx.lineTo(outPx + 0.5, warp.y + warp.h); ctx.stroke()
        ctx.strokeStyle = PLAYHEAD_COL; ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(inPx + 0.5, warp.y); ctx.lineTo(outPx + 0.5, warp.y + warp.h); ctx.stroke()
      }
      if (out) vline(outPx, out.top, out.bottom, true)

      if (timeTr && inPx >= 0 && inPx <= W) {
        const ax = Math.round(inPx)
        ctx.fillStyle = PLAYHEAD_COL
        ctx.beginPath()
        ctx.moveTo(ax - 5, timeTr.y)
        ctx.lineTo(ax + 6, timeTr.y)
        ctx.lineTo(ax + 0.5, timeTr.y + 8)
        ctx.closePath(); ctx.fill()
      }
    }

    // ── Hover cursor ─────────────────────────────────────
    if (hoverX.current !== null) {
      const bot = tracks.length ? tracks[tracks.length - 1].y + tracks[tracks.length - 1].h : H
      ctx.strokeStyle = 'rgba(226,219,210,0.08)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(hoverX.current + 0.5, MINIMAP_H + 1)
      ctx.lineTo(hoverX.current + 0.5, bot)
      ctx.stroke()
    }

    // ── Lasso rect ───────────────────────────────────────
    {
      const ld = dragRef.current
      if (ld?.kind === 'lasso' && ld.active) {
        const lx = Math.min(ld.startX, ld.curX)
        const lw = Math.abs(ld.curX - ld.startX)
        const rawLoY = Math.min(ld.startY, ld.curY)
        const rawHiY = Math.max(ld.startY, ld.curY)
        const covT = tracks.filter(t => t.y < rawHiY && t.y + t.h > rawLoY)
        const ly = covT.length > 0 ? covT[0].y : rawLoY
        const lh = covT.length > 0 ? covT[covT.length - 1].y + covT[covT.length - 1].h - ly : rawHiY - rawLoY
        ctx.fillStyle = 'rgba(100,180,255,0.07)'
        ctx.fillRect(lx, ly, lw, lh)
        ctx.strokeStyle = 'rgba(100,180,255,0.75)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(lx + 0.5, ly); ctx.lineTo(lx + 0.5, ly + lh)
        ctx.moveTo(lx + lw - 0.5, ly); ctx.lineTo(lx + lw - 0.5, ly + lh)
        ctx.stroke()
      }
    }

    ctx.restore()  // end canvas clip
  }

  const drawRef = useRef(draw)
  drawRef.current = draw

  // Redraw whenever any visual input changes
  useEffect(() => {
    drawRef.current()
  }, [
    tracks,
    props.view, props.playhead, props.beatPlayhead,
    props.anchors, props.beatAnchors,
    props.regions, props.regionsOutput,
    props.scenes, props.bpm, props.beatOffset,
    alwaysAnchors, alwaysRegions, alwaysScenes,
    snapHintsIn, snapHintsOut, gestDragTime,
  ])

  // Resize observer — drives containerH which recomputes tracks
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(entries => {
      setContainerH(entries[0].contentRect.height)
    })
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  // ── INTERACTIONS ──────────────────────────────────────
  function clampView(v: View): View {
    const p = propsRef.current
    const span = v.end - v.start
    const max  = Math.max(p.duration, p.outputDuration)
    if (v.start < 0) return { start: 0, end: span }
    if (v.end > max + span * 0.05) return { start: max - span, end: max }
    return v
  }

  function pxToT(px: number): number {
    const p = propsRef.current
    const W = canvasRef.current?.getBoundingClientRect().width ?? 1
    return p.view.start + (px / W) * (p.view.end - p.view.start)
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const p     = propsRef.current
    const rect  = e.currentTarget.getBoundingClientRect()
    const mx    = e.clientX - rect.left
    const my    = e.clientY - rect.top

    // Minimap
    if (my >= 0 && my < MINIMAP_H) {
      const max  = Math.max(p.duration, p.outputDuration)
      const t    = (mx / rect.width) * max
      const span = p.view.end - p.view.start
      p.onViewChange(clampView({ start: t - span / 2, end: t + span / 2 }))
      dragRef.current = { kind: 'minimap', startX: e.clientX, startView: p.view }
      return
    }

    const hit = hitAt(mx, my) as Record<string, unknown> | null

    if (hit?.kind === 'anchor') {
      const { id, space } = hit as { id: number; space: 'input' | 'output' }
      liveAnchorsIn.current  = [...p.anchors]
      liveAnchorsOut.current = [...p.beatAnchors]
      const anchor = space === 'input'
        ? p.anchors.find(a => a.id === id)
        : p.beatAnchors.find(a => a.id === id)
      dragRef.current = { kind: 'anchor', id, space, origTime: anchor?.time ?? 0 }
      p.onAnchorSelect?.(id, e.shiftKey || e.metaKey)
      return
    }

    if (hit?.kind === 'region-edge') {
      const { id, edge, isOutput } = hit as { id: string; edge: 'in' | 'out'; isOutput: boolean }
      const r = isOutput
        ? (p.regionsOutput ?? p.regions).find(r => r.id === id)
        : p.regions.find(r => r.id === id)
      if (r) dragRef.current = {
        kind: 'region-edge', id, edge, isOutput,
        origIn: r.inPoint, origOut: r.outPoint,
      }
      p.onRegionSelect?.(id)
      return
    }

    if (hit?.kind === 'region') {
      const { id, isOutput } = hit as { id: string; isOutput: boolean }
      const r = isOutput
        ? (p.regionsOutput ?? p.regions).find(r => r.id === id)
        : p.regions.find(r => r.id === id)
      if (r) dragRef.current = {
        kind: 'region-move', id, isOutput,
        origIn: r.inPoint, origOut: r.outPoint, anchorX: mx,
      }
      p.onRegionSelect?.(id)
      return
    }

    if (e.altKey || e.button === 1) {
      dragRef.current = { kind: 'pan', startX: e.clientX, startView: p.view }
      return
    }

    // Click on time / beat ruler scrubs the playhead — no lasso, no deselect
    const trUnder = tracksRef.current.find(t => my >= t.y && my < t.y + t.h)
    if (trUnder && (trUnder.id === 'time' || trUnder.id === 'beat')) {
      const space: 'input' | 'output' = trUnder.id === 'beat' ? 'output' : 'input'
      const MAX = space === 'output' ? p.outputDuration : p.duration
      const t = Math.max(0, Math.min(MAX, pxToT(mx)))
      if (space === 'output') p.onSeekBeat?.(t)
      else p.onSeek?.(t)
      dragRef.current = { kind: 'seek', space }
      return
    }

    // Arm lasso — deselect+seek fires on mouseup only if drag threshold not crossed
    const additive = e.ctrlKey || e.metaKey
    dragRef.current = {
      kind: 'lasso',
      startX: mx, startY: my, curX: mx, curY: my,
      additive,
      initialAnchorIds: additive ? new Set(p.selectedAnchorIds) : new Set(),
      initialClipIds:   additive ? new Set(p.selectedClipIds   ?? []) : new Set(),
      initialSceneTimes: additive ? new Set(p.selectedSceneTimes ?? []) : new Set(),
      active: false,
    }
  }

  function handleDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const p   = propsRef.current
    const rect = e.currentTarget.getBoundingClientRect()
    const mx  = e.clientX - rect.left
    const my  = e.clientY - rect.top
    const hit = hitAt(mx, my) as Record<string, unknown> | null

    if (hit?.kind === 'anchor') {
      if (hit.space === 'input') p.onAnchorDelete?.(hit.id as number)
      else p.onBeatAnchorDelete?.(hit.id as number)
      return
    }
    if (hit?.kind === 'region') {
      p.onRegionZoom?.(hit.id as string)
      return
    }
    if (hit?.kind === 'scene') {
      p.onSceneDelete?.(hit.time as number)
      return
    }

    // Empty-track double-click: behavior depends on which row we're in
    const t = Math.max(0, pxToT(mx))
    const tr = tracksRef.current.find(tr => my >= tr.y && my < tr.y + tr.h)
    if (!tr) return
    if (tr.id === 'scenes')        p.onSceneAdd?.(t)
    else if (tr.id === 'clipin')   p.onRegionAdd?.(t)
    else if (tr.id === 'markerin') p.onAnchorAdd?.(t)
    // time/beat/warp/markerout/clipout/speed → no-op
  }

  function handleContextMenu(e: React.MouseEvent<HTMLCanvasElement>) {
    e.preventDefault()
    const p   = propsRef.current
    const rect = e.currentTarget.getBoundingClientRect()
    const mx  = e.clientX - rect.left
    const my  = e.clientY - rect.top
    const hit = hitAt(mx, my) as Record<string, unknown> | null
    if (hit?.kind === 'anchor' && hit.space === 'input') {
      p.onAnchorContextMenu?.(hit.id as number, e.clientX, e.clientY)
    } else if (hit?.kind === 'region') {
      p.onRegionContextMenu?.(hit.id as string, e.clientX, e.clientY)
    } else if (hit?.kind === 'scene') {
      p.onSceneContextMenu?.(hit.time as number, e.clientX, e.clientY)
    } else {
      p.onTimelineContextMenu?.(pxToT(mx), e.clientX, e.clientY)
    }
  }

  function handleWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    e.preventDefault()
    const p    = propsRef.current
    const rect = e.currentTarget.getBoundingClientRect()
    const mx   = e.clientX - rect.left
    const W    = rect.width

    if (e.ctrlKey || e.metaKey) {
      const factor   = Math.exp(-e.deltaY * 0.002)
      const unitAt   = pxToT(mx)
      const span     = p.view.end - p.view.start
      const newSpan  = Math.max(0.1, Math.min(p.maxDuration * 2, span / factor))
      const newStart = unitAt - mx / W * newSpan
      p.onViewChange(clampView({ start: newStart, end: newStart + newSpan }))
    } else {
      const span  = p.view.end - p.view.start
      const px    = (e.shiftKey && e.deltaX === 0) ? e.deltaY : (e.deltaX !== 0 ? e.deltaX : e.deltaY)
      const delta = px / W * span
      p.onViewChange(clampView({ start: p.view.start + delta, end: p.view.end + delta }))
    }
  }

  function handleMouseMove(e: MouseEvent) {
    if (rowResizeRef.current) {
      const { aboveId, belowId, startY, hAbove, hBelow } = rowResizeRef.current
      const hSum = hAbove + hBelow
      const MIN_PX = 14
      const dy = e.clientY - startY
      const newAbove = Math.max(MIN_PX, Math.min(hSum - MIN_PX, hAbove + dy))
      const newBelow = hSum - newAbove
      setRowOverrides(prev => ({ ...prev, [aboveId]: newAbove, [belowId]: newBelow }))
      return
    }

    const canvas = canvasRef.current
    if (!canvas) return
    const p    = propsRef.current
    const rect = canvas.getBoundingClientRect()
    const mx   = e.clientX - rect.left
    const my   = e.clientY - rect.top
    const W    = rect.width

    hoverX.current = mx

    const drag = dragRef.current
    if (!drag) {
      // Hover detection
      const hit = hitAt(mx, my) as Record<string, unknown> | null
      const newAnchorHov = hit?.kind === 'anchor' ? (hit.id as number) : null
      const newRegionHov = (hit?.kind === 'region' || hit?.kind === 'region-edge')
        ? (hit.id as string) : null
      const newEdgeHov = hit?.kind === 'region-edge'
        ? { id: hit.id as string, edge: hit.edge as 'in' | 'out' } : null
      const newSceneHov = hit?.kind === 'scene' ? (hit.time as number) : null
      const trUnder = tracksRef.current.find(t => my >= t.y && my < t.y + t.h)
      const newTrackHov = trUnder?.id ?? null
      if (newTrackHov !== hoverTrackId) setHoverTrackId(newTrackHov)
      const prevEdge = hoverRegionEdge.current
      const edgeChanged = (prevEdge?.id !== newEdgeHov?.id) || (prevEdge?.edge !== newEdgeHov?.edge)
      if (
        newAnchorHov !== hoverAnchorId.current ||
        newRegionHov !== hoverRegionId.current ||
        newSceneHov !== hoverSceneTime.current ||
        edgeChanged
      ) {
        // Drive the global scene-thumbnail popup when the hovered scene
        // changes. Position it horizontally over the diamond, vertically
        // anchored at the scenes track top so the popup floats above it.
        if (newSceneHov !== hoverSceneTime.current) {
          if (newSceneHov !== null) {
            const trScenes = tracksRef.current.find(t => t.id === 'scenes')
            const W2 = rect.width
            const view = propsRef.current.view
            const xPct = (newSceneHov - view.start) / (view.end - view.start)
            const clientX = rect.left + xPct * W2
            const clientY = rect.top + (trScenes?.y ?? 0)
            setThumbnailHover({ time: newSceneHov, x: clientX, y: clientY })
          } else {
            setThumbnailHover(null)
          }
        }
        hoverAnchorId.current = newAnchorHov
        hoverRegionId.current = newRegionHov
        hoverRegionEdge.current = newEdgeHov
        hoverSceneTime.current = newSceneHov
        drawRef.current()
      } else {
        drawRef.current()
      }
      if (hit?.kind === 'region-edge') canvas.style.cursor = 'ew-resize'
      else if (hit?.kind === 'anchor' || hit?.kind === 'region') canvas.style.cursor = 'grab'
      else if (hit?.kind === 'scene') canvas.style.cursor = 'pointer'
      else canvas.style.cursor = ''
      return
    }
    if (drag.kind === 'anchor' || drag.kind === 'region-move') canvas.style.cursor = 'grabbing'
    else if (drag.kind === 'region-edge') canvas.style.cursor = 'ew-resize'
    else canvas.style.cursor = ''

    if (drag.kind === 'minimap') {
      const max  = Math.max(p.duration, p.outputDuration)
      const t    = (mx / W) * max
      const span = p.view.end - p.view.start
      p.onViewChange(clampView({ start: t - span / 2, end: t + span / 2 }))
      return
    }

    if (drag.kind === 'pan') {
      const span = drag.startView.end - drag.startView.start
      const dx   = (e.clientX - drag.startX) / W * span
      p.onViewChange(clampView({ start: drag.startView.start - dx, end: drag.startView.end - dx }))
      return
    }

    if (drag.kind === 'seek') {
      const MAX = drag.space === 'output' ? p.outputDuration : p.duration
      const t = Math.max(0, Math.min(MAX, pxToT(mx)))
      gesture.setScrubTime(t)
      if (drag.space === 'output') p.onSeekBeat?.(t)
      else p.onSeek?.(t)
      return
    }

    if (drag.kind === 'anchor') {
      const raw = pxToT(mx)
      const canvasW     = canvasRef.current!.getBoundingClientRect().width
      const thresholdSec     = pixelsToSeconds(8,  canvasW, p.view.end - p.view.start)
      const hintThresholdSec = pixelsToSeconds(24, canvasW, p.view.end - p.view.start)
      // markerin: snap to scenes + clip boundaries (no grid)
      // markerout: snap to BPM grid only
      let targets: { time: number; source: 'scene' | 'anchor' }[] = []
      let grid: { interval: number; offset: number } | undefined
      if (drag.space === 'input') {
        for (const t of p.scenes) targets.push({ time: t, source: 'scene' })
        for (const r of p.regions) {
          targets.push({ time: r.inPoint,  source: 'scene' })
          targets.push({ time: r.outPoint, source: 'scene' })
        }
      } else {
        if (p.snapInterval && p.snapInterval > 0) {
          const minVisible = smallestVisibleBeatGridSec(p.view.end - p.view.start, canvasW, p.bpm)
          grid = { interval: Math.max(p.snapInterval, minVisible), offset: p.snapOffset ?? 0 }
        }
      }
      const result = computeSnap({ subjects: [raw], targets, grid, thresholdSec })
      const snapped = raw + result.delta
      // markerout: only show the active snap (confirm hint); markerin: show nearby candidates.
      const hints = drag.space === 'output'
        ? (result.hit ? [result.hit.target.time] : [])
        : snapCandidates([raw], targets, grid, hintThresholdSec)
      gesture.setSnapHints(drag.space === 'input' ? 'input' : 'output', hints)
      gesture.setDragTime(drag.space === 'input' ? 'input' : 'output', snapped)
      const t = Math.max(0, snapped)
      if (drag.space === 'input') {
        liveAnchorsIn.current = liveAnchorsIn.current.map(a =>
          a.id === drag.id ? { ...a, time: t } : a)
      } else {
        liveAnchorsOut.current = liveAnchorsOut.current.map(a =>
          a.id === drag.id ? { ...a, time: t } : a)
      }
      if (followDrag) {
        if (drag.space === 'input') p.onSeek?.(t)
        else p.onSeekBeat?.(t)
      }
      drawRef.current()
      return
    }

    // Clip snap targets: anchors (markerin or markerout) + scenes (input only) + other clip edges
    function clipSnapTargets(isOutput: boolean, excludeId: string): { targets: { time: number; source: 'scene' | 'anchor' }[]; grid?: { interval: number; offset: number } } {
      const targets: { time: number; source: 'scene' | 'anchor' }[] = []
      const anchorList = isOutput ? p.beatAnchors : p.anchors
      for (const a of anchorList) targets.push({ time: a.time, source: 'anchor' })
      if (!isOutput) for (const t of p.scenes) targets.push({ time: t, source: 'scene' })
      const otherRegions = isOutput ? (p.regionsOutput ?? p.regions) : p.regions
      for (const r of otherRegions) {
        if (r.id === excludeId) continue
        targets.push({ time: r.inPoint,  source: 'scene' })
        targets.push({ time: r.outPoint, source: 'scene' })
      }
      let grid: { interval: number; offset: number } | undefined
      if (isOutput && p.snapInterval && p.snapInterval > 0) {
        const canvasW = canvasRef.current?.getBoundingClientRect().width ?? 1
        const minVisible = smallestVisibleBeatGridSec(p.view.end - p.view.start, canvasW, p.bpm)
        grid = { interval: Math.max(p.snapInterval, minVisible), offset: p.snapOffset ?? 0 }
      }
      return { targets, grid }
    }

    if (drag.kind === 'region-edge') {
      const raw = pxToT(mx)
      const MAX = drag.isOutput ? p.outputDuration : p.duration
      const canvasW     = canvasRef.current!.getBoundingClientRect().width
      const thresholdSec     = pixelsToSeconds(8,  canvasW, p.view.end - p.view.start)
      const hintThresholdSec = pixelsToSeconds(24, canvasW, p.view.end - p.view.start)
      const space = drag.isOutput ? 'output' : 'input'
      const { targets, grid } = clipSnapTargets(drag.isOutput, drag.id)
      const result = computeSnap({ subjects: [raw], targets, grid, thresholdSec })
      const snapped = raw + result.delta
      gesture.setSnapHints(space, snapCandidates([raw], targets, grid, hintThresholdSec))
      gesture.setDragTime(space, snapped)
      if (drag.edge === 'in') {
        const newIn = Math.max(0, Math.min(drag.origOut - 0.1, snapped))
        liveRegion.current = { id: drag.id, inPoint: newIn, outPoint: drag.origOut }
      } else {
        const newOut = Math.max(drag.origIn + 0.1, Math.min(MAX, snapped))
        liveRegion.current = { id: drag.id, inPoint: drag.origIn, outPoint: newOut }
      }
      gesture.setDragRegion(drag.id, liveRegion.current.inPoint, liveRegion.current.outPoint)
      return
    }

    if (drag.kind === 'region-move') {
      const raw      = pxToT(mx)
      const MAX      = drag.isOutput ? p.outputDuration : p.duration
      const dur      = drag.origOut - drag.origIn
      const canvasW  = canvasRef.current!.getBoundingClientRect().width
      const thresholdSec     = pixelsToSeconds(8,  canvasW, p.view.end - p.view.start)
      const hintThresholdSec = pixelsToSeconds(24, canvasW, p.view.end - p.view.start)
      const space = drag.isOutput ? 'output' : 'input'
      const { targets, grid } = clipSnapTargets(drag.isOutput, drag.id)
      const rawIn  = drag.origIn + (raw - pxToT(drag.anchorX))
      const rawOut = rawIn + dur
      const result = computeSnap({ subjects: [rawIn, rawOut], targets, grid, thresholdSec })
      const newIn  = Math.max(0, Math.min(MAX - dur, rawIn + result.delta))
      const newOut = newIn + dur
      const snappedEdge = result.hit?.subjectIndex === 1 ? newOut : newIn
      gesture.setSnapHints(space, snapCandidates([rawIn, rawOut], targets, grid, hintThresholdSec))
      gesture.setDragTime(space, snappedEdge)
      liveRegion.current = { id: drag.id, inPoint: newIn, outPoint: newOut }
      gesture.setDragRegion(drag.id, newIn, newOut)
      return
    }

    if (drag.kind === 'lasso') {
      const dx = mx - drag.startX, dy = my - drag.startY
      if (!drag.active && dx * dx + dy * dy < 16) return
      if (!drag.active) {
        drag.active = true
        lassoAnchorIds.current  = new Set(drag.initialAnchorIds)
        lassoClipIds.current    = new Set(drag.initialClipIds)
        lassoSceneTimes.current = new Set(drag.initialSceneTimes)
        gesture.setLassoSelection(lassoClipIds.current, lassoAnchorIds.current, lassoSceneTimes.current)
      }
      drag.curX = mx
      drag.curY = my

      const tracks = tracksRef.current
      const loY = Math.min(drag.startY, my), hiY = Math.max(drag.startY, my)
      const covered = tracks.filter(t => t.y < hiY && t.y + t.h > loY)
      const wantIn     = covered.some(t => t.id === 'markerin' || t.id === 'warp')
      const wantOut    = covered.some(t => t.id === 'markerout' || t.id === 'warp')
      const wantClips  = covered.some(t => t.id === 'clipin' || t.id === 'clipout')
      const wantScenes = covered.some(t => t.id === 'scenes')

      const canvasW = canvasRef.current?.getBoundingClientRect().width ?? 1
      const loT = pxToT(Math.max(Math.min(drag.startX, mx), 0))
      const hiT = pxToT(Math.min(Math.max(drag.startX, mx), canvasW))

      if (wantIn || wantOut) {
        const ids = new Set(drag.initialAnchorIds)
        if (wantIn)  for (const a of p.anchors)     if (a.time >= loT && a.time <= hiT) ids.add(a.id)
        if (wantOut) for (const a of p.beatAnchors)  if (a.time >= loT && a.time <= hiT) ids.add(a.id)
        lassoAnchorIds.current = ids
      }
      if (wantClips) {
        const ids = new Set(drag.initialClipIds)
        for (const r of p.regions) if (r.outPoint > loT && r.inPoint < hiT) ids.add(r.id)
        lassoClipIds.current = ids
      }
      if (wantScenes) {
        const times = new Set(drag.initialSceneTimes)
        for (const t of p.scenes) if (t >= loT && t <= hiT) times.add(t)
        lassoSceneTimes.current = times
      }
      gesture.setLassoSelection(lassoClipIds.current, lassoAnchorIds.current, lassoSceneTimes.current)
      drawRef.current()
      return
    }
  }

  function handleMouseUp() {
    rowResizeRef.current = null
    if (canvasRef.current) canvasRef.current.style.cursor = ''
    const drag = dragRef.current
    const p    = propsRef.current
    if (drag?.kind === 'anchor') {
      if (drag.space === 'input' && liveAnchorsIn.current.length)
        p.onAnchorsChange?.(liveAnchorsIn.current)
      if (drag.space === 'output' && liveAnchorsOut.current.length)
        p.onBeatAnchorsChange?.(liveAnchorsOut.current)
    }
    if (drag?.kind === 'region-edge' || drag?.kind === 'region-move') {
      const r = liveRegion.current
      if (r) {
        if (drag.kind === 'region-edge') {
          if (drag.isOutput) p.onRegionResizeOutput?.(r.id, r.inPoint, r.outPoint)
          else p.onRegionResize?.(r.id, r.inPoint, r.outPoint)
        } else {
          if (drag.isOutput) p.onRegionMoveOutput?.(r.id, r.inPoint, r.outPoint)
          else p.onRegionMove?.(r.id, r.inPoint, r.outPoint)
        }
      }
      liveRegion.current = null
    }
    if (drag?.kind === 'lasso' && drag.active) {
      p.onConnectorSelectionChange?.(lassoAnchorIds.current)
      p.onClipsSelectionChange?.(lassoClipIds.current)
      p.onScenesSelectionChange?.(lassoSceneTimes.current)
      lassoAnchorIds.current  = new Set()
      lassoClipIds.current    = new Set()
      lassoSceneTimes.current = new Set()
    }
    if (drag?.kind === 'lasso' && !drag.active && !drag.additive) {
      p.onTimelineDeselect?.()
      const t = Math.max(0, Math.min(p.duration, pxToT(drag.startX)))
      p.onSeek?.(t)
    }
    liveAnchorsIn.current  = []
    liveAnchorsOut.current = []
    dragRef.current = null
    gesture.clearAll()
    drawRef.current()
  }

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [followDrag])

  function handleGripMouseDown(aboveId: string, belowId: string, e: React.MouseEvent) {
    e.preventDefault()
    const above = tracksRef.current.find(t => t.id === aboveId)
    const below = tracksRef.current.find(t => t.id === belowId)
    if (!above || !below) return
    rowResizeRef.current = { aboveId, belowId, startY: e.clientY, hAbove: above.h, hBelow: below.h }
  }

  // ── RENDER ────────────────────────────────────────────
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      propsRef.current.onTimelineDelete?.()
      e.preventDefault()
      return
    }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'd') {
      propsRef.current.onTimelineDeselect?.()
      e.preventDefault()
    }
  }

  const inpRange  = (() => { const ts = tracks.filter(t => t.space === 'input');  if (!ts.length) return null; return { top: ts[0].y, height: ts[ts.length-1].y + ts[ts.length-1].h - ts[0].y } })()
  const warpTrack = tracks.find(t => t.id === 'warp')
  const outRange  = (() => { const ts = tracks.filter(t => t.space === 'output'); if (!ts.length) return null; return { top: ts[0].y, height: ts[ts.length-1].y + ts[ts.length-1].h - ts[0].y } })()

  return (
    <div className="canvas-timeline" tabIndex={0} onKeyDown={handleKeyDown}>
      <div className="canvas-timeline__body">
        <div className="canvas-timeline__rail">
          <div className="canvas-timeline__rail-minimap">OVERVIEW</div>
          <div className="canvas-timeline__rail-sep" />
          {tracks.map((tr, i) => (
            <Fragment key={tr.id}>
              <div
                className={`canvas-timeline__rail-row${hoverTrackId === tr.id ? ' canvas-timeline__rail-row--hover' : ''}`}
                style={{ height: tr.h }}
              >
                {tr.label.toUpperCase()}
              </div>
              {i < tracks.length - 1 && (
                <div className="canvas-timeline__rail-grip" onMouseDown={e => handleGripMouseDown(tr.id, tracks[i + 1].id, e)} />
              )}
            </Fragment>
          ))}
          {inpRange  && <div className="ct-accent ct-accent--input"  style={{ top: inpRange.top,  height: inpRange.height  }} />}
          {warpTrack && <div className="ct-accent ct-accent--warp"   style={{ top: warpTrack.y,   height: warpTrack.h      }} />}
          {outRange  && <div className="ct-accent ct-accent--output" style={{ top: outRange.top,  height: outRange.height  }} />}
        </div>
        <canvas
          ref={canvasRef}
          className="canvas-timeline__canvas"
          onMouseDown={handleMouseDown}
          onDoubleClick={handleDoubleClick}
          onContextMenu={handleContextMenu}
          onWheel={handleWheel}
          onMouseLeave={e => {
            hoverX.current = null
            hoverAnchorId.current = null
            hoverRegionId.current = null
            hoverRegionEdge.current = null
            hoverSceneTime.current = null
            setHoverTrackId(null)
            setThumbnailHover(null)
            e.currentTarget.style.cursor = ''
            drawRef.current()
          }}
        />
      </div>
    </div>
  )
}

// ── TOOLBAR ───────────────────────────────────────────────────────────────────

export interface CanvasTimelineToolbarProps {
  warpCollapsed?: boolean
  onToggleWarp?: () => void
  onZoomToRegion?: () => void
  gridDiv?: number
  onGridDivChange?: (div: number) => void
}

export function CanvasTimelineToolbar({
  warpCollapsed = false,
  onToggleWarp,
  onZoomToRegion,
  gridDiv,
  onGridDivChange,
}: CanvasTimelineToolbarProps) {
  const dispatch      = useAppDispatch()
  const alwaysAnchors = useAppSelector(s => s.ui.timelineAlwaysAnchors)
  const alwaysRegions = useAppSelector(s => s.ui.timelineAlwaysRegions)
  const alwaysScenes  = useAppSelector(s => s.ui.timelineAlwaysScenes)
  const followDrag    = useAppSelector(s => s.ui.timelineFollowDrag)
  const thumbMode     = useAppSelector(s => s.ui.timelineThumbShow ? 'show' : 'none')

  const [uiScale, setUiScaleState] = useState<number>(() => getUiScale())
  useEffect(() => {
    const handler = (e: Event) => setUiScaleState((e as CustomEvent).detail as number)
    window.addEventListener('ui-scale-change', handler)
    return () => window.removeEventListener('ui-scale-change', handler)
  }, [])
  const iconSize = Math.round(16 * uiScale)

  return (
    <div className="canvas-timeline__toolbar">
      <button
        type="button"
        className={`ct-btn ct-btn--warp${warpCollapsed ? '' : ' ct-btn--active'}`}
        onClick={onToggleWarp}
        title={warpCollapsed ? 'Show warp views' : 'Hide warp views'}
      >
        <IconWarpToggle size={iconSize} />
      </button>
      <button
        type="button"
        className={`ct-btn ct-btn--thumbs${thumbMode === 'show' ? ' ct-btn--active' : ''}`}
        onClick={() => dispatch(setTimelineThumbShow(thumbMode !== 'show'))}
        title={thumbMode === 'show' ? 'Hide thumbnails' : 'Show thumbnails'}
      >
        <IconThumbStrip size={iconSize} />
      </button>

      <span className="ct-sep" />

      <button
        type="button"
        className={`ct-btn ct-btn--zoom${onZoomToRegion ? '' : ' ct-btn--disabled'}`}
        onClick={onZoomToRegion}
        disabled={!onZoomToRegion}
        title="Zoom to active clip"
      >
        <IconZoomToRegion size={iconSize} />
      </button>

      <span className="ct-sep" />

      <button
        type="button"
        className={`ct-btn ct-btn--follow${followDrag ? ' ct-btn--active' : ''}`}
        onClick={() => dispatch(setTimelineFollowDrag(!followDrag))}
        title="Playhead follows dragged anchors"
      >
        <IconFollowDrag size={iconSize} />
      </button>

      <span className="ct-sep" />

      <button
        type="button"
        className={`ct-btn ct-btn--anchors${alwaysAnchors ? ' ct-btn--active' : ''}`}
        onClick={() => dispatch(setTimelineAlwaysAnchors(!alwaysAnchors))}
        title="Always show anchor through-lines"
      >
        <IconAlwaysAnchors size={iconSize} />
      </button>
      <button
        type="button"
        className={`ct-btn ct-btn--regions${alwaysRegions ? ' ct-btn--active' : ''}`}
        onClick={() => dispatch(setTimelineAlwaysRegions(!alwaysRegions))}
        title="Always show region edge through-lines"
      >
        <IconAlwaysRegions size={iconSize} />
      </button>
      <button
        type="button"
        className={`ct-btn ct-btn--scenes${alwaysScenes ? ' ct-btn--active' : ''}`}
        onClick={() => dispatch(setTimelineAlwaysScenes(!alwaysScenes))}
        title="Always show scene through-lines"
      >
        <IconAlwaysScenes size={iconSize} />
      </button>

      <span className="ct-sep" />

      {onGridDivChange && (
        <>
          <span className="ct-spacer" />
          <div className="ct-grid-group">
            <span className="ct-grid-label">Grid</span>
            <select
              className="ct-select"
              value={gridDiv ?? 1}
              onChange={e => onGridDivChange(parseInt(e.target.value))}
            >
              {GRID_DIVS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
          </div>
        </>
      )}
    </div>
  )
}
