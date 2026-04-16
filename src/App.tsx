import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import VideoPlayer from './components/VideoPlayer'
import type { VideoPlayerHandle } from './components/VideoPlayer'
import WarpView from './components/WarpView'
import MarkerList from './components/MarkerList'
import ExportDialog from './components/ExportDialog'
import Toolbar from './components/Toolbar'
import MenuBar from './components/MenuBar'
import type { MenuDef } from './components/MenuBar'
import { buildFileMenu, buildEditMenu, buildViewMenu } from './menus'
import { calcZoomToRegion } from './utils/view'
import type { View } from './types'
import VideoFolderSidebar from './components/VideoFolderSidebar'
import RegionSidebar from './components/RegionSidebar'
import RegionInfoPanel from './components/RegionInfoPanel'
import ContextMenu from './components/ContextMenu'
import type { ContextMenuState } from './components/ContextMenu'
import { snapAllToBeat } from './utils/quantize'
import { calcNewRegionBounds } from './utils/view'
import { undo as undoAction, redo as redoAction } from './store/slices/historySlice'
import {
  setRegions as setRegionsAction,
  addRegion as addRegionAction,
  deleteRegion as deleteRegionAction,
  setActiveRegionId as setActiveRegionIdAction,
  updateRegionInOut as updateRegionInOutAction,
  updateRegionBeatTimes as updateRegionBeatTimesAction,
  updateRegionLock as updateRegionLockAction,
  renameRegion as renameRegionAction,
} from './store/slices/regionSlice'
import {
  openFileThunk,
  openFolderThunk,
  loadFolderFromPathThunk,
  selectVideoThunk,
  closeVideoThunk,
  resetVideoDataThunk,
  openJsonFileThunk,
} from './store/thunks/videoThunks'
import { useAppDispatch, useAppSelector } from './store/hooks'
import { setDetectingBpm as setDetectingBpmAction } from './store/slices/videoSlice'
import {
  setOrigAnchorsFromTimeline,
  removeAnchors,
  resetBeatLinks,
  clearAnchors,
  loadAnchors,
  setBpm as setBpmAction,
  setBeatZeroId,
  setSelectedIds as setSelectedIdsWarp,
  selectAll as selectAllWarp,
  deselectAll as deselectAllWarp,
  setPlayhead as setPlayheadAction,
  setLoopBeats as setLoopBeatsAction,
  setTrimToLoop as setTrimToLoopAction,
  setAddToEnd as setAddToEndAction,
  newAnchorId,
  setBeatAnchorsFromTimeline,
} from './store/slices/warpSlice'
import {
  selectSelectedIdsSet,
  selectWarpData,
  selectActiveRegion as selectActiveRegionRedux,
} from './store/selectors'
import { store } from './store/store'
import {
  setTimelineHeight as setTimelineHeightAction,
  setSidebarWidth as setSidebarWidthAction,
  setClipSidebarWidth as setClipSidebarWidthAction,
  setRightWidth as setRightWidthAction,
  setSidebarCollapsed as setSidebarCollapsedAction,
  setGridDiv as setGridDivAction,
  setPlaying as setPlayingAction,
  setExportOpen as setExportOpenAction,
  setView as setViewAction,
} from './store/slices/uiSlice'
import './App.css'

const VIDEO_EXTS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v']
function hasVideoExt(p: string) {
  return VIDEO_EXTS.includes(p.split('.').pop()?.toLowerCase() ?? '')
}
function hasJsonExt(p: string) {
  return p.split('.').pop()?.toLowerCase() === 'json'
}

// ── Layout constants ─────────────────────────────────────────────────────────

const MIN_TIMELINE = 100
const MAX_TIMELINE = 500
const DEFAULT_TIMELINE = 280

// ── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const dispatch = useAppDispatch()

  // ── Redux state ─────────────────────────────────────────────────────────
  const video = useAppSelector(s => s.video.video)
  const folderVideos = useAppSelector(s => s.video.folderVideos)
  const markerCountByPath = useAppSelector(s => s.video.markerCountByPath)
  const detectingBpm = useAppSelector(s => s.video.detectingBpm)
  const markersLoaded = useAppSelector(s => s.video.markersLoaded)
  const regions = useAppSelector(s => s.region.regions)
  const activeRegionId = useAppSelector(s => s.region.activeRegionId)
  const activeRegion = useAppSelector(selectActiveRegionRedux)
  const view = useAppSelector(s => s.ui.view)
  const loopBeats = useAppSelector(s => s.warp.loopBeats)
  const trimToLoop = useAppSelector(s => s.warp.trimToLoop)
  const addToEnd = useAppSelector(s => s.warp.addToEnd)

  // ── Dispatch helpers ────────────────────────────────────────────────────
  const openFile = () => dispatch(openFileThunk())
  const openFolder = () => dispatch(openFolderThunk())
  const loadFolderFromPath = (p: string) => dispatch(loadFolderFromPathThunk(p))
  const selectVideo = (p: string) => dispatch(selectVideoThunk(p))
  const closeVideo = () => dispatch(closeVideoThunk())
  const resetVideoData = () => dispatch(resetVideoDataThunk())
  const openJsonFile = () => dispatch(openJsonFileThunk())
  const setDetectingBpm = (v: boolean) => dispatch(setDetectingBpmAction(v))
  const setLoopBeats = (v: number | null) => dispatch(setLoopBeatsAction(v))
  const setTrimToLoop = (v: boolean) => dispatch(setTrimToLoopAction(v))
  const setAddToEnd = (v: boolean) => dispatch(setAddToEndAction(v))
  const addRegion = (inPoint: number, outPoint: number) => {
    const id = `region_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const name = `Clip ${regions.length + 1}`
    dispatch(addRegionAction({
      id, name, inPoint, outPoint,
      bpm: warpBpm, minStretch: 0.5, maxStretch: 2.0, addToEnd: false,
    }))
    return id
  }
  const duplicateRegion = (srcId: string) => {
    const src = regions.find(r => r.id === srcId)
    if (!src) return null
    const span = src.outPoint - src.inPoint
    const maxTime = video?.duration ?? Infinity
    const inPoint = Math.min(src.outPoint, maxTime - span)
    const outPoint = Math.min(inPoint + span, maxTime)
    const id = `region_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    dispatch(addRegionAction({
      ...src, id, name: `Clip ${regions.length + 1}`, inPoint, outPoint,
      inBeatTime: undefined, outBeatTime: undefined,
    }))
    return id
  }
  const deleteRegion = (id: string) => dispatch(deleteRegionAction(id))
  const setActiveRegionId = (id: string | null) => dispatch(setActiveRegionIdAction(id))
  const updateRegionInOut = (id: string, inP: number, outP: number) =>
    dispatch(updateRegionInOutAction({ id, inPoint: inP, outPoint: outP }))
  const updateRegionBeatTimes = (id: string, inBT?: number, outBT?: number) =>
    dispatch(updateRegionBeatTimesAction({ id, inBeatTime: inBT, outBeatTime: outBT }))
  const renameRegion = (id: string, name: string) =>
    dispatch(renameRegionAction({ id, name }))
  const updateRegionLock = (id: string, lock: 'bpm' | 'beats', lockedBeats?: number) =>
    dispatch(updateRegionLockAction({ id, lock, lockedBeats }))
  const timelineHeight = useAppSelector(s => s.ui.timelineHeight)
  const sidebarWidth = useAppSelector(s => s.ui.sidebarWidth)
  const sidebarCollapsed = useAppSelector(s => s.ui.sidebarCollapsed)
  const clipSidebarWidth = useAppSelector(s => s.ui.clipSidebarWidth)
  const rightWidth = useAppSelector(s => s.ui.rightWidth)
  const gridDiv = useAppSelector(s => s.ui.gridDiv)
  const playing = useAppSelector(s => s.ui.playing)
  const exportOpen = useAppSelector(s => s.ui.exportOpen)
  const setTimelineHeight = (v: number) => dispatch(setTimelineHeightAction(v))
  const setSidebarWidth = (v: number) => dispatch(setSidebarWidthAction(v))
  const setSidebarCollapsed = (v: boolean) => dispatch(setSidebarCollapsedAction(v))
  const setClipSidebarWidth = (v: number) => dispatch(setClipSidebarWidthAction(v))
  const setRightWidth = (v: number) => dispatch(setRightWidthAction(v))
  const setGridDiv = (v: number) => dispatch(setGridDivAction(v))
  const setPlaying = (v: boolean) => dispatch(setPlayingAction(v))
  const setExportOpen = (v: boolean) => dispatch(setExportOpenAction(v))
  const selectedIds = useAppSelector(selectSelectedIdsSet)
  const setSelectedIds = useCallback(
    (ids: Set<number>) => dispatch(setSelectedIdsWarp([...ids])),
    [dispatch],
  )
  const [clipContextMenu, setClipContextMenu] = useState<ContextMenuState | null>(null)
  const [pendingRenameId, setPendingRenameId] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [pendingZoom, setPendingZoom] = useState<{ start: number; end: number } | null>(null)

  const playerRef = useRef<VideoPlayerHandle>(null)
  const preZoomView = useRef<View | null>(null)
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
            return
          }
          // If a .json sidecar is dropped, find its sibling video and load both
          const firstJson = paths.find(hasJsonExt)
          if (firstJson) {
            try {
              const { readJsonSidecarForVideo } = await import('./api/warp')
              const { videoPath } = await readJsonSidecarForVideo(firstJson)
              await selectVideo(videoPath)
            } catch (err: any) {
              if (!String(err).includes('cancelled')) console.error('JSON drop failed:', err)
            }
            return
          }
          // Otherwise treat the first dropped path as a folder
          await loadFolderFromPath(paths[0])
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

  const playhead = useAppSelector(s => s.warp.playhead)
  const warpData = useAppSelector(selectWarpData)
  const origAnchors = useAppSelector(s => s.warp.origAnchors)
  const beatAnchorsForSnap = useAppSelector(s => s.warp.beatAnchors)
  const warpBpm = useAppSelector(s => s.warp.bpm)

  const handleBpmChange = useCallback((bpm: number) => {
    dispatch(setBpmAction(bpm))
  }, [])

  const handleBpmDetect = useCallback(async () => {
    if (origAnchors.length < 2) return
    setDetectingBpm(true)
    try {
      const { analyzeAnchors } = await import('./api/warp')
      const data = await analyzeAnchors(origAnchors.map(a => a.time))
      if (data.bpm && data.bpm > 0) dispatch(setBpmAction(data.bpm))
    } catch {}
    setDetectingBpm(false)
  }, [setDetectingBpm, origAnchors, dispatch])

  // ── Menus ──────────────────────────────────────────────────────────────────

  const anchorCount = warpData?.origAnchors.length ?? 0

  const fileMenu: MenuDef = useMemo(() => buildFileMenu({
    video, anchorCount, openFile, openFolder, openJsonFile, resetVideoData, closeVideo,
    importMarkers: () => document.getElementById('marker-import')?.click(),
    exportMarkers: () => { /* TODO: export via thunk */ },
  }), [openFile, openFolder, openJsonFile, resetVideoData, closeVideo, video, anchorCount])

  const editMenu: MenuDef = useMemo(() => buildEditMenu({
    video, anchorCount,
    undo: () => dispatch(undoAction()),
    redo: () => dispatch(redoAction()),
    selectAll: () => dispatch(selectAllWarp()),
    deselect: () => dispatch(deselectAllWarp()),
  }), [video, anchorCount])

  const viewMenu: MenuDef = useMemo(() => buildViewMenu({
    video,
    zoomIn: () => {
      const v = store.getState().ui.view
      const mid = (v.start + v.end) / 2
      const span = (v.end - v.start) / 1.5
      dispatch(setViewAction({ start: mid - span / 2, end: mid + span / 2 }))
    },
    zoomOut: () => {
      const v = store.getState().ui.view
      const mid = (v.start + v.end) / 2
      const span = (v.end - v.start) * 1.5
      dispatch(setViewAction({ start: mid - span / 2, end: mid + span / 2 }))
    },
    zoomToFit: () => {
      dispatch(setViewAction({ start: 0, end: video?.duration ?? 60 }))
    },
  }), [video])

  const canExport = !!video

  const clipIn = activeRegion?.inPoint ?? undefined
  const clipOut = activeRegion?.outPoint ?? undefined
  const clipInBeatTime = activeRegion?.inBeatTime
  const clipOutBeatTime = activeRegion?.outBeatTime

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
            {sidebarCollapsed ? (
              <div className="vj-sidebar-collapsed" onClick={() => setSidebarCollapsed(false)} title="Expand file browser">
                <span className="vj-sidebar-collapsed__icon">▶</span>
              </div>
            ) : (
              <VideoFolderSidebar
                videos={folderVideos}
                selectedPath={video?.path ?? null}
                onOpenFolder={openFolder}
                onSelectVideo={selectVideo}
                width={sidebarWidth}
                markerCountByPath={markerCountByPath}
                onCollapse={() => setSidebarCollapsed(true)}
              />
            )}
            {!sidebarCollapsed && (
              <div
                className="vj-panel-resizer"
                onPointerDown={handleLeftResizerDown}
                onPointerMove={handleLeftResizerMove}
                onPointerUp={handleLeftResizerUp}
              />
            )}
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
                    if (region) playerRef.current?.seek(region.inPoint)
                  }
                }}
                onAddRegion={() => {
                  const { inPoint, outPoint } = calcNewRegionBounds(playhead, view.end - view.start, video.duration)
                  addRegion(inPoint, outPoint)
                }}
                onDeleteRegion={deleteRegion}
                onRename={renameRegion}
                onUpdateInOut={updateRegionInOut}
                onExportRegion={(id) => {
                  setActiveRegionId(id)
                  setExportOpen(true)
                }}
                onDuplicateRegion={(id) => {
                  const newId = duplicateRegion(id)
                  if (newId) setActiveRegionId(newId)
                }}
                onResetBoundaries={(id) => updateRegionBeatTimes(id, undefined, undefined)}
                pendingRenameId={pendingRenameId}
                onPendingRenameConsumed={() => setPendingRenameId(null)}
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
                  onAddToEndChange={setAddToEnd}
                  onUpdateRegionInOut={updateRegionInOut}
                  beatZeroOrigTime={(() => {
                    if (!warpData) return null
                    const zeroBA = warpData.beatAnchors.find(ba => Math.abs(ba.time - warpData.beatZeroTime) < 0.001)
                    if (!zeroBA) return null
                    return warpData.origAnchors.find(oa => oa.id === zeroBA.id)?.time ?? null
                  })()}
                  onStartAtChange={origTime => {
                    if (origTime === null) { dispatch(setBeatZeroId(null)); return }
                    const anchor = origAnchors.find(a => Math.abs(a.time - origTime) < 0.001)
                    if (anchor) dispatch(setBeatZeroId(anchor.id))
                  }}
                  onLockChange={(lock, lockedBeats) => {
                    if (activeRegionId) updateRegionLock(activeRegionId, lock, lockedBeats)
                  }}
                  onBpmDetect={handleBpmDetect}
                  detectingBpm={detectingBpm}
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
                  onTimeUpdate={t => dispatch(setPlayheadAction(t))}
                  onPlayStateChange={setPlaying}
                />
              </div>

              <Toolbar
                playerRef={playerRef}
                duration={video.duration}
                fps={video.fps}
                playing={playing}
                currentTime={playhead}
                onMark={t => dispatch(setOrigAnchorsFromTimeline([...origAnchors, { id: newAnchorId(), time: Math.max(0, t) }]))}
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
                  const currentView = store.getState().ui.view
                  const { nextView, previousView } = calcZoomToRegion(currentView, from, to, preZoomView.current)
                  if (previousView !== null) preZoomView.current = previousView
                  else preZoomView.current = null
                  dispatch(setViewAction(nextView))
                }}
                onJumpRegionStart={activeRegion ? () => {
                  playerRef.current?.seek(activeRegion.inPoint)
                } : undefined}
                onJumpRegionEnd={activeRegion ? () => {
                  playerRef.current?.seek(activeRegion.outPoint)
                } : undefined}
                onSetIn={activeRegion ? () => {
                  updateRegionInOut(activeRegion.id, playhead, activeRegion.outPoint)
                } : () => {
                  // Full Video: create a new region from playhead to end
                  const id = addRegion(playhead, video.duration)
                  if (id) setActiveRegionId(id)
                }}
                onSetOut={activeRegion ? () => {
                  updateRegionInOut(activeRegion.id, activeRegion.inPoint, playhead)
                } : () => {
                  // Full Video: create a new region from start to playhead
                  const id = addRegion(0, Math.max(playhead, 0.1))
                  if (id) setActiveRegionId(id)
                }}
                gridDiv={gridDiv}
                onGridDivChange={setGridDiv}
                onNewRegion={() => {
                  const { inPoint, outPoint } = calcNewRegionBounds(playhead, view.end - view.start, video.duration)
                  addRegion(inPoint, outPoint)
                }}
                onPrevRegion={regions.length > 1 ? () => {
                  const sorted = [...regions].sort((a, b) => a.inPoint - b.inPoint)
                  const idx = sorted.findIndex(r => r.id === activeRegionId)
                  const prev = idx > 0 ? sorted[idx - 1] : null
                  if (prev) setActiveRegionId(prev.id)
                } : undefined}
                onNextRegion={regions.length > 1 ? () => {
                  const sorted = [...regions].sort((a, b) => a.inPoint - b.inPoint)
                  const idx = sorted.findIndex(r => r.id === activeRegionId)
                  const next = idx < sorted.length - 1 ? sorted[idx + 1] : null
                  if (next) setActiveRegionId(next.id)
                } : undefined}
                onDeleteRegion={activeRegion ? () => deleteRegion(activeRegion.id) : undefined}
              />

              <div
                className="vj-resizer"
                onPointerDown={handleResizerPointerDown}
                onPointerMove={handleResizerPointerMove}
                onPointerUp={handleResizerPointerUp}
              />

              <div className="vj-timeline" style={{ height: timelineHeight }}>
                <WarpView
                  onSeek={t => playerRef.current?.seek(t)}
                  onSendToNewRegion={(inPoint, outPoint) =>
                    addRegion(inPoint, outPoint)
                  }
                  clipOverlays={regions.map((r, idx) => ({
                    id: r.id,
                    name: r.name,
                    inPoint: r.inPoint,
                    outPoint: r.outPoint,
                    active: r.id === activeRegionId,
                    colorIndex: idx,
                  }))}
                  onClipOverlaySelect={setActiveRegionId}
                  onClipOverlayCreate={addRegion}
                  onClipOverlayResize={(id, inP, outP) => updateRegionInOut(id, inP, outP)}
                  onClipOverlayMove={(id, inP, outP) => updateRegionInOut(id, inP, outP)}
                  onClipOverlayZoom={(id) => {
                    const region = regions.find(r => r.id === id)
                    if (!region) return
                    const currentView = store.getState().ui.view
                    const { nextView, previousView } = calcZoomToRegion(currentView, region.inPoint, region.outPoint, preZoomView.current)
                    if (previousView !== null) preZoomView.current = previousView
                    else preZoomView.current = null
                    dispatch(setViewAction(nextView))
                  }}
                  onClipOverlayContextMenu={(id, x, y) => {
                    const region = regions.find(r => r.id === id)
                    if (!region) return
                    setClipContextMenu({
                      x, y,
                      title: region.name,
                      items: [
                        { label: 'Rename', action: () => { setActiveRegionId(id); setPendingRenameId(id) } },
                        { label: 'Duplicate', action: () => {
                          const newId = duplicateRegion(id)
                          if (newId) setActiveRegionId(newId)
                        }},
                        { label: 'Export', action: () => { setActiveRegionId(id); setExportOpen(true) } },
                        { separator: true as const },
                        { label: 'Reset boundaries', action: () => updateRegionBeatTimes(id, undefined, undefined),
                          disabled: region.inBeatTime === undefined && region.outBeatTime === undefined },
                        { label: 'Delete', action: () => deleteRegion(id), danger: true },
                      ],
                    })
                  }}
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
                  origAnchors={origAnchors.filter(a =>
                    activeRegion ? a.time >= activeRegion.inPoint - 0.001 && a.time <= activeRegion.outPoint + 0.001 : true
                  )}
                  beatAnchors={beatAnchorsForSnap}
                  duration={video.duration}
                  fps={video.fps}
                  bpm={warpBpm}
                  beatZeroTime={warpData?.beatZeroTime ?? 0}
                  selectedIds={selectedIds}
                  onSelectionChange={setSelectedIds}
                  onSeek={t => playerRef.current?.seek(t)}
                  onClear={() => dispatch(clearAnchors())}
                  onReset={() => dispatch(resetBeatLinks(origAnchors.map(a => a.id)))}
                  onSnap={() => {
                    const b = warpBpm > 0 ? 60 / warpBpm / gridDiv : 0
                    if (b <= 0) return
                    const snapped = snapAllToBeat(beatAnchorsForSnap, b, warpData?.beatZeroTime ?? 0)
                    dispatch(setBeatAnchorsFromTimeline(snapped))
                  }}
                  onDeleteSelected={() => dispatch(removeAnchors([...selectedIds]))}
                  onResetSelected={() => dispatch(resetBeatLinks([...selectedIds]))}
                  onSnapSelected={() => {
                    const b = warpBpm > 0 ? 60 / warpBpm / gridDiv : 0
                    if (b <= 0) return
                    const toSnap = beatAnchorsForSnap.filter(a => selectedIds.has(a.id))
                    const snapped = snapAllToBeat(toSnap, b, warpData?.beatZeroTime ?? 0)
                    const snapMap = new Map(snapped.map(a => [a.id, a.time]))
                    dispatch(setBeatAnchorsFromTimeline(
                      beatAnchorsForSnap.map(a => snapMap.has(a.id) ? { ...a, time: snapMap.get(a.id)! } : a)
                    ))
                  }}
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
      {clipContextMenu && (
        <ContextMenu menu={clipContextMenu} onClose={() => setClipContextMenu(null)} />
      )}
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
