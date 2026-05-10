export type TickStyleKey = 'sub' | 'beat' | 'bar'
export type TickLabelStyle = 'major' | 'minor'

export interface TickLayer {
  spacingUnit: number
  styleKey: TickStyleKey
  tickHeight?: number
  isMajor?: boolean
  skipModulo?: number
  label?: ((unit: number) => string | null) | null
  labelStyle?: TickLabelStyle
}

export interface BarsState {
  mode: 'bars'
  zoom: number
  beatsPerBar: number
}

export interface TimeState {
  mode: 'time'
  zoom: number
}

export type StrategyState = BarsState | TimeState

export function barsLayers(state: BarsState): TickLayer[]
export function timeLayers(state: TimeState): TickLayer[]
export function chooseLayers(state: StrategyState): TickLayer[]

export function formatTimeLabel(seconds: number, major: number): string
export function formatBBT(beats: number, beatsPerBar: number): string
export function formatHMS(seconds: number): string
