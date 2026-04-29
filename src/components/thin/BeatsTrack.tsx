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

    const div = Math.max(1, division)
    const ticksPerBar = 4 * div
    const span = view.end - view.start
    // Visible counts at each rank — drives a graceful zoom-out where the
    // finest subdivisions drop out first, then whole beats, leaving only
    // downbeats at extreme zoom-out, instead of everything disappearing
    // at once.
    const visibleSubs = span / beatSec
    const visibleBeats = visibleSubs / div
    const visibleBars = visibleBeats / 4
    const SHOW_SUB_MAX = 24      // subdivisions readable up to ~24 visible
    const SHOW_BEAT_MAX = 48     // whole beats up to ~48 visible
    const SHOW_DOWNBEAT_MAX = 96  // downbeats stay the longest
    const maxRank =
      visibleSubs <= SHOW_SUB_MAX ? 99
      : visibleBeats <= SHOW_BEAT_MAX ? 1
      : visibleBars <= SHOW_DOWNBEAT_MAX ? 0
      : -1
    if (maxRank < 0) return []

    const firstIdx = Math.ceil((view.start - beatOffset) / beatSec)
    const lastIdx = Math.floor((Math.min(view.end, duration) - beatOffset) / beatSec)

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
    for (let i = firstIdx; i <= lastIdx; i++) {
      const rank = rankOf(i)
      if (rank > maxRank) continue
      const t = beatOffset + i * beatSec
      if (t < 0 || t > duration) continue
      const downbeat = i % ticksPerBar === 0
      const onWholeBeat = i % div === 0
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
          </button>
        )
      })}
    </TrackRow>
  )
}
