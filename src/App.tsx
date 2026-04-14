import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import VideoPlayer from './components/VideoPlayer'
import type { VideoPlayerHandle } from './components/VideoPlayer'
import WarpView from './components/WarpView'
import type { WarpViewHandle } from './components/WarpView'
import MarkerList from './components/MarkerList'
import ExportDialog from './components/ExportDialog'
import Toolbar from './components/Toolbar'
import MenuBar from './components/MenuBar'
import type { MenuDef } from './components/MenuBar'
import VideoFolderSidebar from './components/VideoFolderSidebar'
import RegionSidebar from './components/RegionSidebar'
import RegionInfoPanel from './components/RegionInfoPanel'
import { useProject } from './context/ProjectContext'
import './App.css'

const VIDEO_EXTS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v']
function hasVideoExt(p: string) {
  return VIDEO_EXTS.includes(p.split('.').pop()?.toLowerCase() ?? '')
}

// ── Layout constants ─────────────────────────────────────────────────────────

const MIN_TIMELINE = 100
const MAX_TIMELINE = 500
const DEFAULT_TIMELINE = 280

// ── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const {
    folderVideos,
    video,
    warpData,
    regions,
    activeRegionId,
    activeRegion,
    playhead,
    detectingBpm,
    markersLoaded,
    initialMarkers,
    loopBeats,
    trimToLoop,
    addToEnd,
    openFile,
    openFolder,
    loadFolderFromPath,
    selectVideo,
    closeVideo,
    setPlayhead,
    setWarpData,
    setDetectingBpm,
    setLoopBeats,
    setTrimToLoop,
    setAddToEnd,
    addRegion,
    deleteRegion,
    setActiveRegionId,
    updateRegionInOut,
    renameRegion,
    markerCountByPath,
  } = useProject()

  const [timelineHeight, setTimelineHeight] = useState(DEFAULT_TIMELINE)
  const [sidebarWidth, setSidebarWidth] = useState(170)
  const [clipSidebarWidth, setClipSidebarWidth] = useState(170)
  const [rightWidth, setRightWidth] = useState(280)
  const [gridDiv, setGridDiv] = useState(1)
  const [playing, setPlaying] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [isDragOver, setIsDragOver] = useState(false)
  const [pendingZoom, setPendingZoom] = useState<{ start: number; end: number } | null>(null)

  const playerRef = useRef<VideoPlayerHandle>(null)
  const warpRef = useRef<WarpViewHandle>(null)
  const vDragStart = useRef<{ y: number; h: number } | null>(null)
  const lDragStart = useRef<{ x: number; w: number } | null>(null)
  const rDragStart = useRef<{ x: number; w: number } | null>(null)
  const cDragStart = useRef<{ x: number; w: number } | null>(null)

  // Clear pendingZoom after it's consumed by WarpView on mount
  useEffect(() => {
    if (pendingZoom) setPendingZoom(null)
  }, [pendingZoom])

  // ── Drag and drop ─────────────────────────────────────────────────────────

  useEffect(() => {
    let unlisten: (() => void) | null = null

    import('@tauri-apps/api/webview').then(({ getCurrentWebview }) => {
      getCurrentWebview().onDragDropEvent(async (event) => {
        const e = event.payload
        if (e.type === 'enter' || e.type === 'over') {
          setIsDragOver(true)
          return
        }
        if (e.type === 'leave') {
          setIsDragOver(false)
          return
        }
        if (e.type === 'drop') {
          setIsDragOver(false)
          const paths = e.paths
          if (!paths || paths.length === 0) return

          // If any dropped path is a video file, load the first one
          const firstVideo = paths.find(hasVideoExt)
          if (firstVideo) {
            await selectVideo(firstVideo)
          } else {
            // Otherwise treat the first dropped path as a folder
            await loadFolderFromPath(paths[0])
          }
        }
      }).then(fn => { unlisten = fn })
    })

    return () => { unlisten?.() }
  }, [selectVideo, loadFolderFromPath])

  // ── Seek to region start when active region changes ──────────────────────

  useEffect(() => {
    if (activeRegion) {
      playerRef.current?.seek(activeRegion.inPoint)
    }
  }, [activeRegionId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Vertical resizer (timeline height) ────────────────────────────────────

  const handleResizerPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    vDragStart.current = { y: e.clientY, h: timelineHeight }
  }
  const handleResizerPointerMove = (e: React.PointerEvent) => {
    if (!vDragStart.current || !e.buttons) return
    setTimelineHeight(Math.max(MIN_TIMELINE, Math.min(MAX_TIMELINE,
      vDragStart.current.h - (e.clientY - vDragStart.current.y)
    )))
  }
  const handleResizerPointerUp = () => { vDragStart.current = null }

  // ── Left sidebar resizer ───────────────────────────────────────────────────

  const handleLeftResizerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    lDragStart.current = { x: e.clientX, w: sidebarWidth }
  }
  const handleLeftResizerMove = (e: React.PointerEvent) => {
    if (!lDragStart.current || !e.buttons) return
    setSidebarWidth(Math.max(120, Math.min(320, lDragStart.current.w + (e.clientX - lDragStart.current.x))))
  }
  const handleLeftResizerUp = () => { lDragStart.current = null }

  // ── Clip sidebar resizer ───────────────────────────────────────────────────

  const handleClipResizerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    cDragStart.current = { x: e.clientX, w: clipSidebarWidth }
  }
  const handleClipResizerMove = (e: React.PointerEvent) => {
    if (!cDragStart.current || !e.buttons) return
    setClipSidebarWidth(Math.max(120, Math.min(280, cDragStart.current.w + (e.clientX - cDragStart.current.x))))
  }
  const handleClipResizerUp = () => { cDragStart.current = null }

  // ── Right panel resizer ────────────────────────────────────────────────────

  const handleRightResizerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    rDragStart.current = { x: e.clientX, w: rightWidth }
  }
  const handleRightResizerMove = (e: React.PointerEvent) => {
    if (!rDragStart.current || !e.buttons) return
    setRightWidth(Math.max(200, Math.min(480, rDragStart.current.w - (e.clientX - rDragStart.current.x))))
  }
  const handleRightResizerUp = () => { rDragStart.current = null }

  // ── BPM handlers ──────────────────────────────────────────────────────────

  const handleBpmChange = useCallback((bpm: number) => {
    warpRef.current?.setBpm(bpm)
  }, [])

  const handleBpmDetect = useCallback(async () => {
    setDetectingBpm(true)
    await warpRef.current?.detectBpm()
    setDetectingBpm(false)
  }, [setDetectingBpm])

  // ── Menus ──────────────────────────────────────────────────────────────────

  const anchorCount = warpData?.origAnchors.length ?? 0

  const fileMenu: MenuDef = useMemo(() => ({
    label: 'File',
    items: [
      { label: 'Open File', shortcut: 'Ctrl+O', action: openFile },
      { label: 'Open Folder', shortcut: 'Ctrl+Shift+O', action: openFolder },
      { separator: true },
      { label: 'Import Markers', shortcut: 'Ctrl+I', action: () => warpRef.current?.triggerImport(), disabled: !video },
      { label: 'Export Markers', shortcut: 'Ctrl+E', action: () => warpRef.current?.exportMarkers(), disabled: !video || anchorCount === 0 },
      { separator: true },
      { label: 'Close Video', action: closeVideo, disabled: !video },
    ],
  }), [openFile, openFolder, closeVideo, video, anchorCount])

  const editMenu: MenuDef = useMemo(() => ({
    label: 'Edit',
    items: [
      { label: 'Undo', shortcut: 'Ctrl+Z', action: () => warpRef.current?.undo(), disabled: !video },
      { label: 'Redo', shortcut: 'Ctrl+Shift+Z', action: () => warpRef.current?.redo(), disabled: !video },
      { separator: true },
      { label: 'Select All', shortcut: 'Ctrl+A', action: () => warpRef.current?.selectAll(), disabled: !video || anchorCount === 0 },
      { label: 'Deselect', shortcut: 'Escape', action: () => warpRef.current?.deselect(), disabled: !video },
    ],
  }), [video, anchorCount])

  const viewMenu: MenuDef = useMemo(() => ({
    label: 'View',
    items: [
      { label: 'Zoom In', shortcut: 'Ctrl+=', action: () => warpRef.current?.zoomIn(), disabled: !video },
      { label: 'Zoom Out', shortcut: 'Ctrl+-', action: () => warpRef.current?.zoomOut(), disabled: !video },
      { label: 'Zoom to Fit', shortcut: 'Ctrl+0', action: () => warpRef.current?.zoomToFit(), disabled: !video },
    ],
  }), [video])

  const canExport = !!warpData && anchorCount >= 1

  const clipIn = activeRegion?.inPoint ?? undefined
  const clipOut = activeRegion?.outPoint ?? undefined

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="app">

      {/* Menu bar */}
      <MenuBar
        menus={[fileMenu, editMenu, viewMenu]}
        rightContent={
          <button
            className="menubar__export-btn"
            onClick={() => setExportOpen(true)}
            disabled={!canExport}
          >
            Export
          </button>
        }
      />

      {/* Body */}
      <div className="vj-body">
        {folderVideos.length > 0 && (
          <>
            <VideoFolderSidebar
              videos={folderVideos}
              selectedPath={video?.path ?? null}
              onOpenFolder={openFolder}
              onSelectVideo={selectVideo}
              width={sidebarWidth}
              markerCountByPath={markerCountByPath}
            />
            <div
              className="vj-panel-resizer"
              onPointerDown={handleLeftResizerDown}
              onPointerMove={handleLeftResizerMove}
              onPointerUp={handleLeftResizerUp}
            />
          </>
        )}

        {!video ? (
          <div className="app-empty">
            {folderVideos.length === 0
              ? <p className="app-empty__hint">Open a file or folder to get started</p>
              : <p className="app-empty__hint">Select a video from the sidebar</p>}
          </div>
        ) : !markersLoaded ? (
          <div className="app-empty">
            <p className="app-empty__hint">Loading...</p>
          </div>
        ) : (
          <>
            {/* Region sidebar (top) + info panel (bottom, aligned with timeline) */}
            <div style={{ width: clipSidebarWidth, flexShrink: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
              <RegionSidebar
                duration={video.duration}
                regions={regions}
                activeRegionId={activeRegionId}
                onSelectRegion={(id) => {
                  setActiveRegionId(id)
                  if (id) {
                    const region = regions.find(r => r.id === id)
                    if (region) {
                      playerRef.current?.seek(region.inPoint)
                      setPendingZoom({ start: region.inPoint, end: region.outPoint })
                    }
                  } else {
                    setPendingZoom(null)
                  }
                }}
                onAddRegion={addRegion}
                onDeleteRegion={deleteRegion}
                onRename={renameRegion}
                onUpdateInOut={updateRegionInOut}
                onExportRegion={(id) => {
                  setActiveRegionId(id)
                  setExportOpen(true)
                }}
              />
              {/* 5px spacer matching vj-resizer height */}
              <div style={{ height: 5, flexShrink: 0, background: '#1b1814' }} />
              <div style={{ height: timelineHeight, flexShrink: 0, overflow: 'hidden' }}>
                <RegionInfoPanel
                  activeRegion={activeRegion ?? null}
                  warpData={warpData}
                  duration={video.duration}
                  addToEnd={addToEnd}
                  onBpmChange={handleBpmChange}
                  onMinStretchChange={v => warpRef.current?.setMinStretch(v)}
                  onMaxStretchChange={v => warpRef.current?.setMaxStretch(v)}
                  onAddToEndChange={setAddToEnd}
                  onUpdateRegionInOut={updateRegionInOut}
                />
              </div>
            </div>
            <div
              className="vj-panel-resizer"
              onPointerDown={handleClipResizerDown}
              onPointerMove={handleClipResizerMove}
              onPointerUp={handleClipResizerUp}
            />

            <div className="vj-center">
              <div className="vj-breadcrumb">
                <span className="vj-breadcrumb__name">{video.originalName}</span>
                {activeRegion && (
                  <span className="vj-breadcrumb__region"> › {activeRegion.name}</span>
                )}
              </div>
              <div className="vj-player">
                <VideoPlayer
                  ref={playerRef}
                  src={video.videoUrl}
                  duration={video.duration}
                  onTimeUpdate={setPlayhead}
                  onPlayStateChange={setPlaying}
                />
              </div>

              <Toolbar
                playerRef={playerRef}
                duration={video.duration}
                fps={video.fps}
                playing={playing}
                currentTime={playhead}
                onMark={t => warpRef.current?.addAnchor(Math.max(0, t))}
                onJumpPrev={() => {
                  const sorted = [...(warpData?.origAnchors ?? [])].sort((a, b) => a.time - b.time)
                  const prev = sorted.filter(a => a.time < playhead - 0.05).pop()
                  if (prev) playerRef.current?.seek(prev.time)
                }}
                onJumpNext={() => {
                  const sorted = [...(warpData?.origAnchors ?? [])].sort((a, b) => a.time - b.time)
                  const next = sorted.find(a => a.time > playhead + 0.05)
                  if (next) playerRef.current?.seek(next.time)
                }}
                onZoomToRegion={() => {
                  const from = activeRegion?.inPoint ?? 0
                  const to = activeRegion?.outPoint ?? video.duration
                  warpRef.current?.zoomToRegion(from, to)
                }}
                onSetIn={activeRegion ? () => {
                  updateRegionInOut(activeRegion.id, Math.min(playhead, activeRegion.outPoint - 0.1), activeRegion.outPoint)
                } : undefined}
                onSetOut={activeRegion ? () => {
                  updateRegionInOut(activeRegion.id, activeRegion.inPoint, Math.max(playhead, activeRegion.inPoint + 0.1))
                } : undefined}
                bpm={warpData?.bpm}
                onBpmChange={handleBpmChange}
                onBpmDetect={handleBpmDetect}
                detectingBpm={detectingBpm}
                anchorCount={anchorCount}
                gridDiv={gridDiv}
                onGridDivChange={setGridDiv}
                onNewRegion={() => {
                  const beat = (warpData?.bpm ?? 120) > 0 ? 60 / (warpData?.bpm ?? 120) : 0.5
                  const halfSpan = Math.max(beat * 4, 2) / 2
                  const inPoint = Math.max(0, playhead - halfSpan)
                  const outPoint = Math.min(video.duration, playhead + halfSpan)
                  addRegion(inPoint, outPoint)
                }}
              />

              <div
                className="vj-resizer"
                onPointerDown={handleResizerPointerDown}
                onPointerMove={handleResizerPointerMove}
                onPointerUp={handleResizerPointerUp}
              />

              <div className="vj-timeline" style={{ height: timelineHeight }}>
                <WarpView
                  key={`${activeRegionId ?? 'default'}_${video.path}`}
                  ref={warpRef}
                  duration={video.duration}
                  initialBpm={initialMarkers?.bpm ?? 120}
                  initialMinStretch={initialMarkers?.minStretch}
                  initialMaxStretch={initialMarkers?.maxStretch}
                  addToEnd={addToEnd}
                  initialOrigAnchors={initialMarkers?.origAnchors}
                  initialBeatAnchors={initialMarkers?.beatAnchors}
                  playhead={playhead}
                  onSeek={t => playerRef.current?.seek(t)}
                  onDataChange={setWarpData}
                  videoPath={video.path}
                  trimToLoop={trimToLoop}
                  loopBeats={loopBeats}
                  gridDiv={gridDiv}
                  selectedIds={selectedIds}
                  onSelectionChange={setSelectedIds}
                  clipIn={clipIn}
                  clipOut={clipOut}
                  initialViewOverride={pendingZoom ?? undefined}
                  onSendToNewRegion={(inPoint, outPoint) =>
                    addRegion(inPoint, outPoint)
                  }
                  clipOverlays={regions.map(r => ({
                    id: r.id,
                    name: r.name,
                    inPoint: r.inPoint,
                    outPoint: r.outPoint,
                    active: r.id === activeRegionId,
                  }))}
                  onClipOverlaySelect={setActiveRegionId}
                  onClipOverlayCreate={addRegion}
                  onClipOverlayResize={(id, inP, outP) => updateRegionInOut(id, inP, outP)}
                  onClipOverlayMove={(id, inP, outP) => updateRegionInOut(id, inP, outP)}
                />
              </div>
            </div>

            <div
              className="vj-panel-resizer"
              onPointerDown={handleRightResizerDown}
              onPointerMove={handleRightResizerMove}
              onPointerUp={handleRightResizerUp}
            />
            {/* Right column: empty top area + markers panel aligned with timeline */}
            <div style={{ width: rightWidth, flexShrink: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: 1, minHeight: 0 }} />
              {/* 5px spacer matching vj-resizer height */}
              <div style={{ height: 5, flexShrink: 0, background: '#1b1814' }} />
              <div style={{ height: timelineHeight, flexShrink: 0, overflow: 'hidden' }}>
                <MarkerList
                  origAnchors={warpData?.origAnchors ?? []}
                  beatAnchors={warpData?.beatAnchors ?? []}
                  duration={video.duration}
                  fps={video.fps}
                  bpm={warpData?.bpm ?? 120}
                  beatZeroTime={warpData?.beatZeroTime ?? 0}
                  selectedIds={selectedIds}
                  onSelectionChange={setSelectedIds}
                  onSeek={t => playerRef.current?.seek(t)}
                  onClear={() => warpRef.current?.clearAnchors()}
                  onReset={() => warpRef.current?.resetAllLinks()}
                  onSnap={() => warpRef.current?.snapToBeat()}
                  onDeleteSelected={() => warpRef.current?.deleteSelected(selectedIds)}
                  onResetSelected={() => warpRef.current?.resetSelected(selectedIds)}
                  onSnapSelected={() => warpRef.current?.snapSelected(selectedIds)}
                />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Drag-over overlay */}
      {isDragOver && (
        <div className="app-drop-overlay">
          <div className="app-drop-overlay__inner">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
            </svg>
            <span>Drop video or folder</span>
          </div>
        </div>
      )}

      {/* Export dialog */}
      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        warpData={warpData}
        videoPath={video?.path ?? ''}
        originalName={video?.originalName ?? ''}
        loopBeats={loopBeats}
        addToEnd={addToEnd}
        trimToLoop={trimToLoop}
        regions={regions}
        activeRegionId={activeRegionId}
      />
    </div>
  )
}
