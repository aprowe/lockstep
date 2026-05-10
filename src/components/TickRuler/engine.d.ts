import type { TickLayer } from './strategies'
import type { TickRulerTheme } from './themes'

export const RULER_H: 44

export interface ZoomMapper {
  sliderToZoom(slider: number): number
  zoomToSlider(zoom: number): number
}

export function makeZoomMapper(min: number, max: number): ZoomMapper

export function resizeCanvas(canvas: HTMLCanvasElement): {
  ctx: CanvasRenderingContext2D
  cssW: number
  cssH: number
}

export function drawRuler(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  viewH: number,
  layers: TickLayer[],
  scroll: number,
  ppu: number,
  theme: TickRulerTheme,
  playheadUnit: number,
  fontFamily: string,
): void
