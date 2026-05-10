/**
 * TickRuler canvas engine. Generic over the unit (beats or seconds).
 * Caller provides layer descriptors via strategies.js.
 */

export const RULER_H = 44

/** Log-scaled zoom slider helpers. min/max are in "pixels per unit". */
export function makeZoomMapper(min, max) {
  const range = Math.log(max / min)
  return {
    sliderToZoom: (s) => min * Math.exp((s / 1000) * range),
    zoomToSlider: (z) => Math.round((Math.log(z / min) / range) * 1000),
  }
}

/** Resize a canvas to fill its bounding rect with proper DPR scaling. */
export function resizeCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  const cssW = rect.width
  const cssH = rect.height
  canvas.width = Math.round(cssW * dpr)
  canvas.height = Math.round(cssH * dpr)
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { ctx, cssW, cssH }
}

/**
 * Draw a complete tick ruler.
 *
 * @param ctx           CanvasRenderingContext2D (already DPR-scaled)
 * @param viewW         CSS-pixel width
 * @param viewH         CSS-pixel height
 * @param layers        TickLayer[] from a strategy
 * @param scroll        pixel offset from unit 0
 * @param ppu           pixels per unit (zoom)
 * @param theme         TickRulerTheme
 * @param playheadUnit  current playhead position in units
 * @param fontFamily    CSS font-family stack to use for labels
 */
export function drawRuler(ctx, viewW, viewH, layers, scroll, ppu, theme, playheadUnit, fontFamily) {
  // Backgrounds
  ctx.fillStyle = theme.laneBg
  ctx.fillRect(0, RULER_H, viewW, viewH - RULER_H)
  ctx.fillStyle = theme.rulerBg
  ctx.fillRect(0, 0, viewW, RULER_H)

  for (const layer of layers) drawLayer(ctx, viewW, viewH, layer, scroll, ppu, theme, fontFamily)

  // Ruler bottom border
  ctx.strokeStyle = theme.rulerBorder
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, RULER_H - 0.5)
  ctx.lineTo(viewW, RULER_H - 0.5)
  ctx.stroke()

  drawPlayhead(ctx, viewW, viewH, playheadUnit, scroll, ppu, theme)
}

function styleColors(layer, theme) {
  if (layer.styleKey === 'bar') return { tick: theme.barTick, grid: theme.gridBar }
  if (layer.styleKey === 'beat') return { tick: theme.beatTick, grid: theme.gridBeat }
  return { tick: theme.subTick, grid: theme.gridSub }
}

function drawLayer(ctx, viewW, viewH, layer, scroll, ppu, theme, fontFamily) {
  const spacingPx = layer.spacingUnit * ppu
  if (spacingPx <= 0) return
  const firstIdx = Math.floor(scroll / spacingPx) - 1
  const lastIdx = Math.ceil((scroll + viewW) / spacingPx) + 1

  const { tick: tickColor, grid: gridColor } = styleColors(layer, theme)
  const tickTop = layer.isMajor ? 4 : RULER_H - (layer.tickHeight ?? 8)

  // Lane grid lines
  ctx.strokeStyle = gridColor
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = firstIdx; i <= lastIdx; i++) {
    if (layer.skipModulo && i % layer.skipModulo === 0) continue
    const x = Math.round(i * spacingPx - scroll) + 0.5
    ctx.moveTo(x, RULER_H)
    ctx.lineTo(x, viewH)
  }
  ctx.stroke()

  // Ruler ticks
  ctx.strokeStyle = tickColor
  ctx.beginPath()
  for (let i = firstIdx; i <= lastIdx; i++) {
    if (layer.skipModulo && i % layer.skipModulo === 0) continue
    const x = Math.round(i * spacingPx - scroll) + 0.5
    ctx.moveTo(x, tickTop)
    ctx.lineTo(x, RULER_H - 1)
  }
  ctx.stroke()

  // Labels
  if (layer.label) {
    const isMajor = layer.labelStyle === 'major'
    ctx.fillStyle = isMajor ? theme.labelMajor : theme.labelMinor
    ctx.font = `${isMajor ? 'bold 11px' : '10px'} ${fontFamily}`
    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'
    for (let i = firstIdx; i <= lastIdx; i++) {
      if (layer.skipModulo && i % layer.skipModulo === 0) continue
      const unit = i * layer.spacingUnit
      if (unit < 0) continue
      const text = layer.label(unit)
      if (text == null) continue
      const x = Math.round(unit * ppu - scroll)
      ctx.fillText(text, x + 4, isMajor ? 5 : 6)
    }
  }
}

function drawPlayhead(ctx, viewW, viewH, playheadUnit, scroll, ppu, theme) {
  const px = Math.round(playheadUnit * ppu - scroll) + 0.5
  if (px < -2 || px > viewW + 2) return
  ctx.strokeStyle = theme.playheadGlow
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(px, 0)
  ctx.lineTo(px, viewH)
  ctx.stroke()
  ctx.strokeStyle = theme.playhead
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(px, 0)
  ctx.lineTo(px, viewH)
  ctx.stroke()
  ctx.fillStyle = theme.playhead
  ctx.beginPath()
  ctx.moveTo(px - 0.5, 0)
  ctx.lineTo(px + 7, 0)
  ctx.lineTo(px - 0.5, 7)
  ctx.closePath()
  ctx.fill()
}
