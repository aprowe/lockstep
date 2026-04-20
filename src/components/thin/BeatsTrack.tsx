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
  onSeek?: (time: number) => void
}

/**
 * Thin beats track — like BarsTrack but finer. Shows individual beats (and
 * optional subdivisions) so users have a snap grid that isn't the coarse
 * bar lines. Hides when too zoomed out to stay readable.
 */
export default function BeatsTrack({ view, duration, bpm, beatOffset = 0, division = 1, onSeek }: BeatsTrackProps) {
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

    const out: { idx: number; time: number; downbeat: boolean }[] = []
    for (let i = firstIdx; i <= lastIdx; i += skip) {
      const t = beatOffset + i * beatSec
      if (t < 0 || t > duration) continue
      // Every 4th beat is a downbeat when we're showing every beat.
      out.push({ idx: i, time: t, downbeat: skip === 1 && i % (4 * Math.max(1, division)) === 0 })
    }
    return out
  }, [view.start, view.end, duration, bpm, beatOffset, division])

  return (
    <TrackRow label="Beats" kind="beats">
      {beats.map(b => {
        const x = timeToViewPct(b.time, view)
        if (x < -1 || x > 101) return null
        return (
          <button
            key={b.idx}
            type="button"
            className={`thin-beat${b.downbeat ? ' thin-beat--downbeat' : ''}`}
            style={{ left: `${x}%` }}
            title={`Beat ${b.idx} @ ${b.time.toFixed(3)}s`}
            onClick={() => onSeek?.(b.time)}
          />
        )
      })}
    </TrackRow>
  )
}
