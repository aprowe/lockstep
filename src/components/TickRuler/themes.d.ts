export interface TickRulerTheme {
  rulerBg: string
  laneBg: string
  barTick: string
  beatTick: string
  subTick: string
  gridBar: string
  gridBeat: string
  gridSub: string
  labelMajor: string
  labelMinor: string
  playhead: string
  playheadGlow: string
  rulerBorder: string
}

export type TickRulerThemeName = 'ableton' | 'bitwig' | 'logic' | 'lockstep'

export const TICK_RULER_THEMES: Record<TickRulerThemeName, TickRulerTheme>
