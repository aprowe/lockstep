import { useCallback, useMemo, useRef, useState } from 'react'
import type { Anchor, View } from '../../types'
import { clampView, timeToViewPct } from '../../utils/view'
import SceneRow from '../SceneRow'
import ThinRuler from './ThinRuler'
import MarkersTrack from './MarkersTrack'
import BarsTrack from './BarsTrack'
import BeatsTrack from './BeatsTrack'
import RegionBand, { type RegionBlock } from './RegionBand'
import './ThinTimeline.css'

interface ThinTimelineProps {
  duration: number
  view: View
  onViewChange: (v: View) => void
  maxDuration: number

  playhead?: number
  onSeek?: (time: number) => void

  anchors: Anchor[]
  selectedAnchorIds: Set<number>
  onAnchorAdd?: (time: number) => void
  onAnchorDelete?: (id: number) => void
  onAnchorSelect?: (id: number, additive: boolean) => void
  onAnchorContextMenu?: (id: number, x: number, y: number) => void

  bpm: number
  beatOffset?: number
  /** When true, render the thin Beats row. The user opts in per clip via
   *  the presence of anchors (warp is being used). */
  showBeats?: boolean

  scenes: number[]
  onSceneAdd?: (time: number) => void
  onSceneDelete?: (time: number) => void

  regions: RegionBlock[]
  regionsOutput?: RegionBlock[]
  onRegionSelect?: (id: string) => void
  onRegionContextMenu?: (id: string, x: number, y: number) => void
}

/**
 * Experimental thin-track timeline. Stacks narrow per-type rows (ruler,
 * regions-in, scenes, markers, bars, regions-out) so each track stays focused
 * on one marker type instead of the Ableton-style source track piling them
 * all into one lane.
 *
 * Scope for this MVP: non-warped workflows — seek + add/delete scenes and
 * markers, snap to bars, see region spans. Warp/beats/speed rows are not
 * wired yet; when warpCollapsed is false in the parent view the existing
 * Timeline pair still renders the warp section below.
 */
export default function ThinTimeline({
  duration, view, onViewChange, maxDuration,
  playhead, onSeek,
  anchors, selectedAnchorIds,
  onAnchorAdd, onAnchorDelete, onAnchorSelect, onAnchorContextMenu,
  bpm, beatOffset = 0, showBeats = false,
  scenes, onSceneAdd, onSceneDelete,
  regions, regionsOutput,
  onRegionSelect, onRegionContextMenu,
}: ThinTimelineProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [hoverPct, setHoverPct] = useState<number | null>(null)

  // Scroll-zoom — cursor-centered, matches WarpView's gesture.
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = rootRef.current
    if (!el) return
    e.preventDefault()
    const body = el.querySelector<HTMLDivElement>('.thin-row__body')
    const rect = body ? body.getBoundingClientRect() : el.getBoundingClientRect()
    const span = view.end - view.start
    const cursorTime = view.start + ((e.clientX - rect.left) / rect.width) * span
    const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15
    const newSpan = span * factor
    const ratio = (cursorTime - view.start) / span
    const ns = cursorTime - ratio * newSpan
    onViewChange(clampView(ns, ns + newSpan, maxDuration))
  }, [view.start, view.end, maxDuration, onViewChange])

  const playheadX = useMemo(() => {
    if (playhead === undefined) return null
    const x = timeToViewPct(playhead, view)
    return x < -2 || x > 102 ? null : x
  }, [playhead, view])

  const onBodyMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const body = (e.currentTarget.querySelector('.thin-row__body') as HTMLElement | null)
      ?? e.currentTarget
    const rect = body.getBoundingClientRect()
    const pct = (e.clientX - rect.left) / rect.width
    setHoverPct(Math.max(0, Math.min(1, pct)))
  }, [])

  return (
    <div
      ref={rootRef}
      className="thin-timeline"
      onWheel={handleWheel}
      onMouseMove={onBodyMouseMove}
      onMouseLeave={() => setHoverPct(null)}
    >
      <ThinRuler
        view={view}
        duration={duration}
        playhead={playhead}
        onSeek={onSeek}
      />

      {regions.length > 0 && (
        <RegionBand
          label="Regions"
          kind="input"
          regions={regions}
          view={view}
          onSelect={onRegionSelect}
          onContextMenu={onRegionContextMenu}
        />
      )}

      {/* Scene row reuses the existing SceneRow so thumbnail + diamond styling
          stays consistent with the scene sidebar. Expanded mode is deferred
          until we wire a toggle into the thin layout. */}
      <div className="thin-timeline__scene-wrapper">
        <div className="thin-row__rail thin-row__rail--inline">Scenes</div>
        <div className="thin-timeline__scene-body">
          <SceneRow
            scenes={scenes}
            view={view}
            duration={duration}
            playhead={playhead}
            onSceneClick={onSeek}
            onSceneAdd={onSceneAdd}
            onSceneDelete={onSceneDelete}
          />
        </div>
      </div>

      <MarkersTrack
        anchors={anchors}
        view={view}
        duration={duration}
        selectedIds={selectedAnchorIds}
        onSeek={onSeek}
        onAdd={onAnchorAdd}
        onDelete={onAnchorDelete}
        onSelect={onAnchorSelect}
        onContextMenu={onAnchorContextMenu}
      />

      <BarsTrack
        view={view}
        duration={duration}
        bpm={bpm}
        beatOffset={beatOffset}
        onSeek={onSeek}
      />

      {showBeats && (
        <BeatsTrack
          view={view}
          duration={duration}
          bpm={bpm}
          beatOffset={beatOffset}
          onSeek={onSeek}
        />
      )}

      {regionsOutput && regionsOutput.length > 0 && (
        <RegionBand
          label="Out"
          kind="output"
          regions={regionsOutput}
          view={view}
          onSelect={onRegionSelect}
          onContextMenu={onRegionContextMenu}
        />
      )}

      {/* Full-stack playhead line that crosses every row. Absolute positioned
          in the content column, offset by the rail width so it sits on top
          of the actual time-mapped area. */}
      {playheadX !== null && (
        <div className="thin-timeline__playhead" style={{ left: `calc(var(--thin-rail-w) + ${playheadX}% * (100% - var(--thin-rail-w)) / 100)` }} />
      )}
      {hoverPct !== null && (
        <div className="thin-timeline__hover" style={{ left: `calc(var(--thin-rail-w) + ${hoverPct * 100}% * (100% - var(--thin-rail-w)) / 100)` }} />
      )}
    </div>
  )
}
