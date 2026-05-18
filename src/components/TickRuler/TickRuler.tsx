import { useEffect, useRef } from 'react'
import { drawRuler, RULER_H, resizeCanvas } from './engine.js'
import { chooseLayers } from './strategies.js'
import type { StrategyState } from './strategies'
import { TICK_RULER_THEMES } from './themes.js'
import type { TickRulerTheme, TickRulerThemeName } from './themes'
import './TickRuler.css'

type Mode = 'bars' | 'time'

interface CommonProps {
  /** pixels per unit. bars: per beat. time: per second. */
  zoom: number
  /** pixel offset from unit 0. Always >= 0. */
  scroll: number
  /** playhead position in units (beats or seconds). */
  playhead: number
  /** Optional snap, in units. 0 / undefined = no snap. */
  snap?: number
  /** Theme name or full theme object. */
  theme?: TickRulerThemeName | TickRulerTheme
  /** Called when the user clicks/drags to seek. Already snapped. */
  onSeek?: (unit: number) => void
  /** Called on Ctrl/Cmd+wheel or pinch zoom. Provides next zoom + scroll. */
  onZoom?: (zoom: number, scroll: number) => void
  /** Called when the user pans (wheel without modifier, alt+drag). */
  onScroll?: (scroll: number) => void
  /** Bounds for zoom changes. Defaults: 0.025..600 for bars, 0.05..1000 for time. */
  zoomMin?: number
  zoomMax?: number
}

interface BarsProps extends CommonProps {
  mode: 'bars'
  beatsPerBar: number
}

interface TimeProps extends CommonProps {
  mode: 'time'
}

export type TickRulerProps = BarsProps | TimeProps

function snap(value: number, snapAmount?: number) {
  if (!snapAmount) return value
  return Math.round(value / snapAmount) * snapAmount
}

function resolveTheme(theme: TickRulerProps['theme']): TickRulerTheme {
  if (!theme) return TICK_RULER_THEMES.lockstep
  if (typeof theme === 'string') return TICK_RULER_THEMES[theme]
  return theme
}

export default function TickRuler(props: TickRulerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<{ mode: 'scrub' | 'pan'; startX: number; startScroll: number } | null>(null)
  const touchRef = useRef<
    | { mode: 'scrub' }
    | { mode: 'pinch'; distance0: number; zoom0: number; unitAtCenter: number }
    | null
  >(null)
  const propsRef = useRef(props)
  propsRef.current = props

  const defaultZMin = props.mode === 'time' ? 0.05 : 0.025
  const defaultZMax = props.mode === 'time' ? 1000 : 600
  const zMin = props.zoomMin ?? defaultZMin
  const zMax = props.zoomMax ?? defaultZMax

  // Draw whenever inputs change.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const draw = () => {
      const { ctx, cssW, cssH } = resizeCanvas(canvas)
      const p = propsRef.current
      const stratState: StrategyState =
        p.mode === 'bars'
          ? { mode: 'bars', zoom: p.zoom, beatsPerBar: p.beatsPerBar }
          : { mode: 'time', zoom: p.zoom }
      const layers = chooseLayers(stratState)
      const themeObj = resolveTheme(p.theme)
      const fontFamily = getComputedStyle(canvas).fontFamily || 'monospace'
      drawRuler(ctx, cssW, cssH, layers, p.scroll, p.zoom, themeObj, p.playhead, fontFamily)
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [
    props.mode,
    props.zoom,
    props.scroll,
    props.playhead,
    props.theme,
    'beatsPerBar' in props ? props.beatsPerBar : undefined,
  ])

  function pxToUnit(px: number) {
    return (px + propsRef.current.scroll) / propsRef.current.zoom
  }

  function emitSeek(px: number) {
    const p = propsRef.current
    if (!p.onSeek) return
    let u = pxToUnit(px)
    u = snap(u, p.snap)
    if (u < 0) u = 0
    p.onSeek(u)
  }

  function emitZoom(deltaFactor: number, anchorPx: number) {
    const p = propsRef.current
    if (!p.onZoom) return
    const unitAt = pxToUnit(anchorPx)
    const next = Math.max(zMin, Math.min(zMax, p.zoom * deltaFactor))
    const nextScroll = Math.max(0, unitAt * next - anchorPx)
    p.onZoom(next, nextScroll)
  }

  function emitScroll(delta: number) {
    const p = propsRef.current
    if (!p.onScroll) return
    p.onScroll(Math.max(0, p.scroll + delta))
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    if (e.altKey || e.button === 1) {
      dragRef.current = { mode: 'pan', startX: e.clientX, startScroll: propsRef.current.scroll }
      e.preventDefault()
      return
    }
    emitSeek(x)
    dragRef.current = { mode: 'scrub', startX: e.clientX, startScroll: propsRef.current.scroll }
  }

  useEffect(() => {
    function move(e: MouseEvent) {
      const drag = dragRef.current
      if (!drag) return
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      if (drag.mode === 'pan') {
        const dx = e.clientX - drag.startX
        propsRef.current.onScroll?.(Math.max(0, drag.startScroll - dx))
      } else {
        emitSeek(e.clientX - rect.left)
      }
    }
    function up() { dragRef.current = null }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY * 0.002)
      emitZoom(factor, e.clientX - rect.left)
    } else {
      emitScroll(e.deltaX !== 0 ? e.deltaX : e.deltaY)
    }
  }

  function onTouchStart(e: React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    if (e.touches.length === 1) {
      emitSeek(e.touches[0].clientX - rect.left)
      touchRef.current = { mode: 'scrub' }
    } else if (e.touches.length === 2) {
      const t0 = e.touches[0], t1 = e.touches[1]
      const cx = (t0.clientX + t1.clientX) / 2 - rect.left
      const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY)
      touchRef.current = {
        mode: 'pinch',
        distance0: dist,
        zoom0: propsRef.current.zoom,
        unitAtCenter: pxToUnit(cx),
      }
    }
  }

  function onTouchMove(e: React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault()
    const t = touchRef.current
    if (!t) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (t.mode === 'scrub' && e.touches.length === 1) {
      emitSeek(e.touches[0].clientX - rect.left)
    } else if (t.mode === 'pinch' && e.touches.length >= 2) {
      const t0 = e.touches[0], t1 = e.touches[1]
      const cx = (t0.clientX + t1.clientX) / 2 - rect.left
      const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY)
      const ratio = dist / t.distance0
      const next = Math.max(zMin, Math.min(zMax, t.zoom0 * ratio))
      const nextScroll = Math.max(0, t.unitAtCenter * next - cx)
      propsRef.current.onZoom?.(next, nextScroll)
    }
  }

  function onTouchEnd(e: React.TouchEvent<HTMLCanvasElement>) {
    if (e.touches.length === 0) touchRef.current = null
  }

  return (
    <canvas
      ref={canvasRef}
      className="tick-ruler-canvas"
      onMouseDown={onMouseDown}
      onWheel={onWheel}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    />
  )
}

export { RULER_H }
