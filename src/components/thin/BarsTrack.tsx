import { useMemo } from 'react'
import type { View } from '../../types'
import { timeToViewPct } from '../../utils/view'
import TrackRow from './TrackRow'
import './BarsTrack.css'

interface BarsTrackProps {
  view: View
  duration: number
  bpm: number
  /** Beats per bar (default 4). */
  beatsPerBar?: number
  /** Time offset of the first beat (in seconds). Defaults to 0. */
  beatOffset?: number
  label?: string
  onSeek?: (time: number) => void
}

/**
 * Thin bars track — tick marks at bar boundaries (bpm-derived). Dense enough
 * to be a snap reference; click a tick to seek to that bar. Hides ticks
 * entirely when the view would be too dense to read (>~80 bars visible).
 */
export default function BarsTrack({ view, duration, bpm, beatsPerBar = 4, beatOffset = 0, label = 'Bars', onSeek }: BarsTrackProps) {
  const bars = useMemo(() => {
    if (!bpm || bpm <= 0) return []
    const barSec = (60 / bpm) * beatsPerBar
    if (barSec <= 0) return []

    const span = view.end - view.start
    const barsVisible = span / barSec
    // Too zoomed out — skip to avoid pixel-dense junk. Ruler already carries labels.
    if (barsVisible > 120) return []

    // Pick every-Nth bar so we show <= ~80 ticks.
    const skip = Math.max(1, Math.ceil(barsVisible / 80))

    // First bar ≥ view.start that's an integer-bar offset from beatOffset.
    const firstBarIdx = Math.ceil((view.start - beatOffset) / barSec)
    const lastBarIdx = Math.floor((Math.min(view.end, duration) - beatOffset) / barSec)

    const out: { idx: number; time: number; major: boolean }[] = []
    for (let i = firstBarIdx; i <= lastBarIdx; i += skip) {
      const t = beatOffset + i * barSec
      if (t < 0 || t > duration) continue
      // Major every 4 bars (phrase) when we can see enough of them.
      out.push({ idx: i, time: t, major: skip === 1 && i % 4 === 0 })
    }
    return out
  }, [view.start, view.end, duration, bpm, beatsPerBar, beatOffset])

  return (
    <TrackRow label={label} kind="bars">
      {bars.map(b => {
        const x = timeToViewPct(b.time, view)
        if (x < -1 || x > 101) return null
        return (
          <button
            key={b.idx}
            type="button"
            className={`thin-bar${b.major ? ' thin-bar--major' : ''}`}
            style={{ left: `${x}%` }}
            title={`Bar ${b.idx} @ ${b.time.toFixed(2)}s`}
            onClick={() => onSeek?.(b.time)}
          >
            <span className="thin-bar__label">{b.idx}</span>
          </button>
        )
      })}
    </TrackRow>
  )
}
