import { useCallback, useMemo, useRef, useState } from 'react'
import type { Anchor, View, WarpSegment } from '../../types'
import { clampView, timeToViewPct } from '../../utils/view'
import SceneRow from '../SceneRow'
import SpeedStrip from '../SpeedStrip'
import WarpConnector from '../WarpConnector'
import ThinMinimap from './ThinMinimap'
import ThinRuler from './ThinRuler'
import MarkersTrack from './MarkersTrack'
import BarsTrack from './BarsTrack'
import RegionBand, { type RegionBlock } from './RegionBand'
import './ThinTimeline.css'

interface ThinTimelineProps {
  duration: number
  outputDuration: number
  view: View
  onViewChange: (v: View) => void
  maxDuration: number

  playhead?: number
  beatPlayhead?: number
  onSeek?: (time: number) => void
  onSeekBeat?: (beatTime: number) => void

  anchors: Anchor[]
  selectedAnchorIds: Set<number>
  onAnchorAdd?: (time: number) => void
  onAnchorDelete?: (id: number) => void
  onAnchorSelect?: (id: number, additive: boolean) => void
  onAnchorContextMenu?: (id: number, x: number, y: number) => void

  beatAnchors: Anchor[]
  onBeatAnchorDelete?: (id: number) => void
  onBeatAnchorSelect?: (id: number, additive: boolean) => void
  onBeatAnchorContextMenu?: (id: number, x: number, y: number) => void

  bpm: number
  beatOffset?: number

  scenes: number[]
  onSceneAdd?: (time: number) => void
  onSceneDelete?: (time: number) => void

  regions: RegionBlock[]
  regionsOutput?: RegionBlock[]
  onRegionSelect?: (id: string) => void
  onRegionContextMenu?: (id: string, x: number, y: number) => void

  segments: WarpSegment[]
  clipIn?: number
  clipOut?: number
  beatClipIn?: number
  beatClipOut?: number
  clipFillColor?: string
  boundaryColor?: string
  linkedBoundaries?: boolean[]
  selectedBoundaries?: boolean[]
  onConnectorSelectionChange?: (ids: Set<number>) => void
}

/**
 * Experimental thin-track timeline. Renders one narrow row per type so
 * each marker kind lives in its own lane. Order: Minimap → Time → Clip In
 * → Scenes → Marker In → Warp → Marker Out → Clip Out → Beat → Speed.
 */
export default function ThinTimeline({
  duration, outputDuration, view, onViewChange, maxDuration,
  playhead, beatPlayhead, onSeek, onSeekBeat,
  anchors, selectedAnchorIds,
  onAnchorAdd, onAnchorDelete, onAnchorSelect, onAnchorContextMenu,
  beatAnchors,
  onBeatAnchorDelete, onBeatAnchorSelect, onBeatAnchorContextMenu,
  bpm, beatOffset = 0,
  scenes, onSceneAdd, onSceneDelete,
  regions, regionsOutput,
  onRegionSelect, onRegionContextMenu,
  segments, clipIn, clipOut, beatClipIn, beatClipOut,
  clipFillColor, boundaryColor, linkedBoundaries, selectedBoundaries,
  onConnectorSelectionChange,
}: ThinTimelineProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const connectorRef = useRef<HTMLDivElement>(null)
  const [hoverPct, setHoverPct] = useState<number | null>(null)

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
      <ThinMinimap
        duration={maxDuration}
        view={view}
        onViewChange={onViewChange}
        anchors={anchors}
        regions={regions}
      />

      <ThinRuler
        label="Time"
        view={view}
        duration={duration}
        playhead={playhead}
        onSeek={onSeek}
      />

      <RegionBand
        label="Clip In"
        kind="input"
        regions={regions}
        view={view}
        onSelect={onRegionSelect}
        onContextMenu={onRegionContextMenu}
      />

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
        label="Marker In"
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

      <WarpConnector
        ref={connectorRef}
        segments={segments}
        view={view}
        origDuration={duration}
        outputDuration={outputDuration}
        clipIn={clipIn}
        clipOut={clipOut}
        beatClipIn={beatClipIn}
        beatClipOut={beatClipOut}
        clipFillColor={clipFillColor}
        boundaryColor={boundaryColor}
        linkedBoundaries={linkedBoundaries}
        selectedBoundaries={selectedBoundaries}
        anchors={anchors}
        onSelectionChange={onConnectorSelectionChange}
        railLabel="Warp"
      />

      <MarkersTrack
        label="Marker Out"
        anchors={beatAnchors}
        view={view}
        duration={outputDuration}
        selectedIds={selectedAnchorIds}
        onSeek={onSeekBeat}
        onDelete={onBeatAnchorDelete}
        onSelect={onBeatAnchorSelect}
        onContextMenu={onBeatAnchorContextMenu}
      />

      {regionsOutput && (
        <RegionBand
          label="Clip Out"
          kind="output"
          regions={regionsOutput}
          view={view}
          onSelect={onRegionSelect}
          onContextMenu={onRegionContextMenu}
        />
      )}

      <BarsTrack
        label="Beat"
        view={view}
        duration={duration}
        bpm={bpm}
        beatOffset={beatOffset}
        onSeek={onSeek}
      />

      <div className="thin-timeline__speed-wrapper">
        <div className="thin-row__rail thin-row__rail--inline">Speed</div>
        <div className="thin-timeline__speed-body">
          <SpeedStrip
            segments={segments}
            view={view}
            outputDuration={outputDuration}
          />
        </div>
      </div>

      {playheadX !== null && (
        <div className="thin-timeline__playhead" style={{ left: `calc(var(--thin-rail-w) + ${playheadX}% * (100% - var(--thin-rail-w)) / 100)` }} />
      )}
      {hoverPct !== null && (
        <div className="thin-timeline__hover" style={{ left: `calc(var(--thin-rail-w) + ${hoverPct * 100}% * (100% - var(--thin-rail-w)) / 100)` }} />
      )}
    </div>
  )
}
