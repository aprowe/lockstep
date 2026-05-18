export const TARGET_PX = 60

export const TIME_TIERS: [number, number][] = [
  [5,1],[10,2],[15,5],[30,10],[60,15],[120,30],[300,60],[600,120],[1800,300],[3600,600],
]

export interface TickLayer {
  spacingUnit: number
  styleKey: 'bar' | 'beat' | 'sub'
  tickHeight?: number
  isMajor?: boolean
  skipModulo?: number
  label?: ((unit: number) => string | null) | null
  labelStyle?: 'major' | 'minor'
}

export function timeLayers(pps: number): TickLayer[] {
  let tier = TIME_TIERS[TIME_TIERS.length - 1]
  for (const t of TIME_TIERS) { if (t[0] * pps >= TARGET_PX) { tier = t; break } }
  const [major, sub] = tier
  const ratio = Math.round(major / sub)
  const layers: TickLayer[] = []
  if (sub * pps >= 6) layers.push({ spacingUnit: sub, styleKey: 'sub', tickHeight: 5, skipModulo: ratio })
  layers.push({
    spacingUnit: major, styleKey: 'bar', isMajor: true,
    label: (s) => {
      if (s < 0) return null
      const totalSec = Math.round(s)
      const m = Math.floor(totalSec / 60)
      const sec = totalSec % 60
      return `${m}:${String(sec).padStart(2, '0')}`
    },
    labelStyle: 'major',
  })
  return layers
}

export function barsLayers(ppb: number, bpb: number): TickLayer[] {
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
