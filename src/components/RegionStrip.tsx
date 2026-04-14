import { useCallback, useRef, useState } from 'react'
import type { Region } from '../types'
import ContextMenu from './ContextMenu'
import type { ContextMenuState } from './ContextMenu'
import './RegionStrip.css'

// ── Constants ────────────────────────────────────────────────────────────────

const EDGE_PX = 8
const MIN_DRAG_PX = 4
const MIN_REGION_SEC = 0.1

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }

function fmtTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = s % 60
  const ss = String(Math.floor(sec)).padStart(2, '0')
  const cs = String(Math.floor((sec % 1) * 100)).padStart(2, '0')
  return m > 0 ? `${m}:${ss}.${cs}` : `${ss}.${cs}s`
}

// ── Types ────────────────────────────────────────────────────────────────────

type Gesture =
  | null
  | { type: 'create'; startX: number; startTime: number; currentTime: number }
  | { type: 'move';   id: string; regionDur: number; offsetTime: number }
  | { type: 'resize-left';  id: string; fixedPoint: number }
  | { type: 'resize-right'; id: string; fixedPoint: number }

// ── Props ────────────────────────────────────────────────────────────────────

interface RegionStripProps {
  duration: number
  regions: Region[]
  activeRegionId: string | null
  playhead?: number
  onSelectRegion: (id: string | null) => void
  onAddRegion: (inPoint: number, outPoint: number) => void
  onUpdateInOut: (id: string, inPoint: number, outPoint: number) => void
  onDeleteRegion?: (id: string) => void
  onZoomToRegion?: (id: string) => void
  /** Called when user shift+scrolls over the strip — delta > 0 = zoom out */
  onShiftScroll?: (delta: number) => void
}

// ── Component ────────────────────────────────────────────────────────────────

export default function RegionStrip({
  duration,
  regions,
  activeRegionId,
  playhead,
  onSelectRegion,
  onAddRegion,
  onUpdateInOut,
  onDeleteRegion,
  onZoomToRegion,
  onShiftScroll,
}: RegionStripProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture>(null)
  const [preview, setPreview] = useState<{ inPoint: number; outPoint: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  const xToTime = useCallback((clientX: number): number => {
    const rect = trackRef.current!.getBoundingClientRect()
    return clamp((clientX - rect.left) / rect.width * duration, 0, duration)
  }, [duration])

  const timeToPercent = (t: number) => (t / duration) * 100

  // ── Pointer down ──────────────────────────────────────────────────────────

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    trackRef.current!.setPointerCapture(e.pointerId)

    const target = e.target as HTMLElement
    const regionEl = target.closest<HTMLElement>('[data-region-id]')

    if (regionEl) {
      const id = regionEl.dataset.regionId!
      const region = regions.find(r => r.id === id)!

      if (target.classList.contains('rstrip-handle--left')) {
        gesture.current = { type: 'resize-left', id, fixedPoint: region.outPoint }
      } else if (target.classList.contains('rstrip-handle--right')) {
        gesture.current = { type: 'resize-right', id, fixedPoint: region.inPoint }
      } else {
        const time = xToTime(e.clientX)
        gesture.current = { type: 'move', id, regionDur: region.outPoint - region.inPoint, offsetTime: time - region.inPoint }
      }
      onSelectRegion(id)
    } else {
      // Empty space — start create gesture
      const time = xToTime(e.clientX)
      gesture.current = { type: 'create', startX: e.clientX, startTime: time, currentTime: time }
      setPreview(null)
    }
  }, [regions, xToTime, onSelectRegion])

  // ── Pointer move ──────────────────────────────────────────────────────────

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const g = gesture.current
    if (!g) return

    const time = xToTime(e.clientX)

    if (g.type === 'create') {
      const moved = Math.abs(e.clientX - g.startX) >= MIN_DRAG_PX
      if (moved) {
        const inPoint = Math.min(g.startTime, time)
        const outPoint = Math.max(g.startTime, time)
        gesture.current = { ...g, currentTime: time }
        setPreview({ inPoint, outPoint })
      }
    } else if (g.type === 'move') {
      const inPoint = clamp(time - g.offsetTime, 0, duration - g.regionDur)
      onUpdateInOut(g.id, inPoint, inPoint + g.regionDur)
    } else if (g.type === 'resize-left') {
      onUpdateInOut(g.id, clamp(time, 0, g.fixedPoint - MIN_REGION_SEC), g.fixedPoint)
    } else if (g.type === 'resize-right') {
      onUpdateInOut(g.id, g.fixedPoint, clamp(time, g.fixedPoint + MIN_REGION_SEC, duration))
    }
  }, [xToTime, duration, onUpdateInOut])

  // ── Pointer up ────────────────────────────────────────────────────────────

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const g = gesture.current
    gesture.current = null
    setPreview(null)

    if (!g) return

    if (g.type === 'create') {
      const time = xToTime(e.clientX)
      const moved = Math.abs(e.clientX - g.startX) >= MIN_DRAG_PX
      if (moved) {
        const inPoint = Math.min(g.startTime, time)
        const outPoint = Math.max(g.startTime, time)
        if (outPoint - inPoint >= MIN_REGION_SEC) {
          onAddRegion(inPoint, outPoint)
          return
        }
      }
      // Click on empty space → go back to Full Video
      onSelectRegion(null)
    }
    // move/resize already committed live via onUpdateInOut
  }, [xToTime, onAddRegion, onSelectRegion])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="rstrip">
      <div
        ref={trackRef}
        className="rstrip-track"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={e => { if (e.buttons === 0) { gesture.current = null; setPreview(null) } }}
        onWheel={e => { if (e.shiftKey && onShiftScroll) { e.preventDefault(); onShiftScroll(e.deltaY) } }}
      >
        {/* Existing regions */}
        {regions.map(region => {
          const active = region.id === activeRegionId
          const leftPct = timeToPercent(region.inPoint)
          const widthPct = timeToPercent(region.outPoint - region.inPoint)
          const showLabel = widthPct > 4 // only show name if wide enough
          return (
            <div
              key={region.id}
              data-region-id={region.id}
              className={`rstrip-region${active ? ' rstrip-region--active' : ''}`}
              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
              title={`${region.name}  ${fmtTime(region.inPoint)} – ${fmtTime(region.outPoint)}`}
              onContextMenu={e => {
                e.preventDefault()
                e.stopPropagation()
                onSelectRegion(region.id)
                setContextMenu({
                  x: e.clientX, y: e.clientY,
                  items: [
                    { label: 'Zoom to region', action: () => onZoomToRegion?.(region.id), disabled: !onZoomToRegion },
                    { separator: true },
                    { label: 'Delete region', danger: true, action: () => onDeleteRegion?.(region.id), disabled: !onDeleteRegion },
                  ],
                })
              }}
            >
              <div className="rstrip-handle rstrip-handle--left" />
              {showLabel && <div className="rstrip-label">{region.name}</div>}
              <div className="rstrip-handle rstrip-handle--right" />
            </div>
          )
        })}

        {/* Create preview */}
        {preview && preview.outPoint - preview.inPoint > 0.001 && (
          <div
            className="rstrip-region rstrip-region--preview"
            style={{
              left: `${timeToPercent(preview.inPoint)}%`,
              width: `${timeToPercent(preview.outPoint - preview.inPoint)}%`,
            }}
          />
        )}

        {/* Playhead */}
        {playhead !== undefined && (
          <div
            className="rstrip-playhead"
            style={{ left: `${timeToPercent(playhead)}%` }}
          />
        )}
      </div>
      {contextMenu && (
        <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
      )}
    </div>
  )
}
