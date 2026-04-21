import { useMemo } from 'react'
import type { View } from '../../types'
import { timeToViewPct } from '../../utils/view'
import TrackRow from './TrackRow'
import './BeatsTrack.css'

interface BeatsTrackProps {
  view: View
  duration: number
  bpm: number
  beatOffset?: number
  /** Optional sub-beat division (1 = beats, 2 = eighths, etc.). */
  division?: number
  label?: string
  onSeek?: (time: number) => void
}

/**
 * Thin beats track — like BarsTrack but finer. Shows individual beats (and
 * optional subdivisions) so users have a snap grid that isn't the coarse
 * bar lines. Hides when too zoomed out to stay readable.
 */
export default function BeatsTrack({ view, duration, bpm, beatOffset = 0, division = 1, label = 'Beats', onSeek }: BeatsTrackProps) {
  const beats = useMemo(() => {
    if (!bpm || bpm <= 0) return []
    const beatSec = (60 / bpm) / Math.max(1, division)
    if (beatSec <= 0) return []

    const span = view.end - view.start
    const ticksVisible = span / beatSec
    // Only show when we can actually resolve beats (~≤ 200 ticks).
    if (ticksVisible > 240) return []

    const skip = Math.max(1, Math.ceil(ticksVisible / 240))
    const firstIdx = Math.ceil((view.start - beatOffset) / beatSec)
    const lastIdx = Math.floor((Math.min(view.end, duration) - beatOffset) / beatSec)

    const div = Math.max(1, division)
    const ticksPerBar = 4 * div
    // rank: 0 = downbeat (tallest), 1 = whole beat, 2+ = subdivisions
    // (finer subdivisions get higher ranks → shorter ticks).
    const rankOf = (i: number): number => {
      if (i % ticksPerBar === 0) return 0
      if (i % div === 0) return 1
      for (let k = 1; div / Math.pow(2, k) >= 1; k++) {
        const step = div / Math.pow(2, k)
        if (Number.isInteger(step) && i % step === 0) return 1 + k
      }
      return 2
    }
    const out: { idx: number; time: number; downbeat: boolean; rank: number; barIdx: number | null; beatInBar: number }[] = []
    for (let i = firstIdx; i <= lastIdx; i += skip) {
      const t = beatOffset + i * beatSec
      if (t < 0 || t > duration) continue
      const downbeat = skip === 1 && i % ticksPerBar === 0
      const onWholeBeat = i % div === 0
      const rank = rankOf(i)
      const barIdx = downbeat ? Math.floor(i / ticksPerBar) : null
      const beatInBar = onWholeBeat ? (Math.floor(i / div) % 4) + 1 : 0
      out.push({ idx: i, time: t, downbeat, rank, barIdx, beatInBar })
    }
    return out
  }, [view.start, view.end, duration, bpm, beatOffset, division])

  return (
    <TrackRow label={label} kind="beats">
      {beats.map(b => {
        const x = timeToViewPct(b.time, view)
        if (x < -1 || x > 101) return null
        const showBarNumber = b.downbeat && b.barIdx !== null
        const showBeatNumber = !b.downbeat && b.beatInBar > 0
        return (
          <button
            key={b.idx}
            type="button"
            className={`thin-beat thin-beat--rank-${Math.min(b.rank, 4)}${b.downbeat ? ' thin-beat--downbeat' : ''}`}
            style={{ left: `${x}%` }}
            title={`Beat ${b.idx} @ ${b.time.toFixed(3)}s`}
            onClick={() => onSeek?.(b.time)}
          >
            {showBarNumber && (
              <span className="thin-beat__label thin-beat__label--bar">{b.barIdx! + 1}</span>
            )}
            {showBeatNumber && (
              <span className="thin-beat__label">{b.beatInBar}</span>
            )}
          </button>
        )
      })}
    </TrackRow>
  )
}
