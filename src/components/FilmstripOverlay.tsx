import { useMemo } from 'react'
import type { Anchor } from '../types'
import './FilmstripOverlay.css'

/**
 * Thin gutter that sits above the Filmstrip thumbnails and shows where
 * scene cuts and beat markers fall inside the visible 7-frame window
 * (issue #32). Mirrors the filmstrip's 7-slot grid: position is
 * `(frameInWindow / SLOTS) * 100%`, so symbols stay aligned with the
 * thumbnail underneath them as the playhead rolls and slots scroll.
 *
 * The playhead always sits at the center slot, so we draw it at the
 * fixed 50% position — same color treatment as the timeline playhead.
 */

interface FilmstripOverlayProps {
  /** Frame number of the *center* thumbnail (the slot the playhead is on). */
  playheadFrame: number
  fps: number
  /** Number of slots in the filmstrip. Must match `Filmstrip`'s SLOTS. */
  slots: number
  scenes: number[]
  markers: Anchor[]
  /** Click on a tick → seek the player there. Skipped when omitted. */
  onSeekFrame?: (frame: number) => void
}

export default function FilmstripOverlay({
  playheadFrame, fps, slots, scenes, markers, onSeekFrame,
}: FilmstripOverlayProps) {
  // Window in *fractional slot index* space, ranging 0..slots. A scene
  // cut at exactly the leftmost slot's start = 0; the rightmost slot's
  // end = `slots`. Anything outside [0, slots] is off-strip.
  const half = Math.floor(slots / 2)
  const firstFrame = playheadFrame - half

  const sceneTicks = useMemo(() => {
    if (fps <= 0) return [] as Array<{ x: number; time: number }>
    const out: Array<{ x: number; time: number }> = []
    for (const t of scenes) {
      const frameT = t * fps
      const slotIdx = frameT - firstFrame
      if (slotIdx < 0 || slotIdx > slots) continue
      out.push({ x: (slotIdx / slots) * 100, time: t })
    }
    return out
  }, [scenes, fps, firstFrame, slots])

  const markerTicks = useMemo(() => {
    if (fps <= 0) return [] as Array<{ x: number; id: number; time: number }>
    const out: Array<{ x: number; id: number; time: number }> = []
    for (const m of markers) {
      const frameT = m.time * fps
      const slotIdx = frameT - firstFrame
      if (slotIdx < 0 || slotIdx > slots) continue
      out.push({ x: (slotIdx / slots) * 100, id: m.id, time: m.time })
    }
    return out
  }, [markers, fps, firstFrame, slots])

  const empty = sceneTicks.length === 0 && markerTicks.length === 0

  return (
    <div
      className={`filmstrip-overlay${empty ? ' filmstrip-overlay--empty' : ''}`}
      role="img"
      aria-label={`${markerTicks.length} marker(s), ${sceneTicks.length} scene cut(s) near playhead`}
    >
      {/* Scenes layer. Triangles point down so they read as "cut here" — same
       *  glyph the SceneRow uses on the timeline. */}
      {sceneTicks.map(({ x, time }) => (
        <button
          key={`scene-${time}`}
          type="button"
          className="filmstrip-overlay__scene"
          style={{ left: `${x}%` }}
          title={`Scene cut @ ${time.toFixed(3)}s`}
          onClick={onSeekFrame && fps > 0 ? () => onSeekFrame(Math.round(time * fps)) : undefined}
          tabIndex={onSeekFrame ? 0 : -1}
        />
      ))}

      {/* Markers layer. Vertical tick rather than a triangle so it doesn't
       *  fight the scene glyphs visually. */}
      {markerTicks.map(({ x, id, time }) => (
        <button
          key={`marker-${id}`}
          type="button"
          className="filmstrip-overlay__marker"
          style={{ left: `${x}%` }}
          title={`Marker @ ${time.toFixed(3)}s`}
          onClick={onSeekFrame && fps > 0 ? () => onSeekFrame(Math.round(time * fps)) : undefined}
          tabIndex={onSeekFrame ? 0 : -1}
        />
      ))}

      {/* Playhead caret. Always at 50% since the filmstrip centers the
       *  playhead's frame. Decorative — doesn't intercept clicks. */}
      <div className="filmstrip-overlay__playhead" aria-hidden="true" />
    </div>
  )
}
