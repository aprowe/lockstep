import { useMemo, useRef } from 'react'
import type { View } from '../../types'
import { timeToViewPct } from '../../utils/view'
import { formatTime } from '../../utils/time'
import TrackRow from './TrackRow'
import './ThinRuler.css'

interface ThinRulerProps {
  view: View
  duration: number
  playhead?: number
  label?: string
  onSeek?: (time: number) => void
}

/** Max extra seconds above `duration` we let the user scrub towards. */
const SCRUB_HEADROOM = 0.001

/**
 * Thin time ruler — seconds ticks + labels. Click → seek. Shares the thin-row
 * rail so labels line up with the tracks below.
 */
export default function ThinRuler({ view, duration, playhead, label = 'Time', onSeek }: ThinRulerProps) {
  const ticks = useMemo(() => {
    const span = view.end - view.start
    if (span <= 0) return []
    // Aim for ~8 labels across the width. Step snaps to a nice value.
    const raw = span / 8
    const niceSteps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
    const step = niceSteps.find(s => s >= raw) ?? 600
    const first = Math.ceil(view.start / step) * step
    const out: { time: number; label: string }[] = []
    for (let t = first; t <= Math.min(view.end, duration) + 1e-6; t += step) {
      out.push({ time: t, label: formatTime(t) })
    }
    return out
  }, [view.start, view.end, duration])

  const bodyRef = useRef<HTMLElement | null>(null)
  const pctToTime = (pct: number) => {
    const span = view.end - view.start
    return Math.max(0, Math.min(duration + SCRUB_HEADROOM, view.start + pct * span))
  }
  const handleBgClick = (pct: number) => {
    if (!onSeek) return
    onSeek(pctToTime(pct))
  }
  const handlePointerDown = (pct: number, e: React.PointerEvent<HTMLDivElement>) => {
    if (!onSeek) return
    const target = e.currentTarget
    bodyRef.current = target
    target.setPointerCapture(e.pointerId)
    onSeek(pctToTime(pct))
    const onMove = (ev: PointerEvent) => {
      const rect = target.getBoundingClientRect()
      const p = (ev.clientX - rect.left) / rect.width
      onSeek(pctToTime(Math.max(0, Math.min(1, p))))
    }
    const onUp = () => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onUp)
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
    target.addEventListener('pointercancel', onUp)
  }

  return (
    <TrackRow
      label={label}
      kind="ruler"
      onBackgroundClick={handleBgClick}
      onBackgroundPointerDown={handlePointerDown}
    >
      {ticks.map((t, i) => {
        const x = timeToViewPct(t.time, view)
        if (x < -1 || x > 101) return null
        return (
          <span key={i} className="thin-ruler__tick" style={{ left: `${x}%` }}>
            <span className="thin-ruler__label">{t.label}</span>
          </span>
        )
      })}
      {playhead !== undefined && (() => {
        const x = timeToViewPct(playhead, view)
        if (x < -2 || x > 102) return null
        return <span className="thin-ruler__playhead" style={{ left: `${x}%` }} />
      })()}
    </TrackRow>
  )
}
