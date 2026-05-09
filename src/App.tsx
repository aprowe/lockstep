import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import VideoPlayer from './components/VideoPlayer'
import type { VideoPlayerHandle } from './components/VideoPlayer'
import Filmstrip from './components/Filmstrip'
import WarpView from './components/WarpView'
import ExportDialog from './components/ExportDialog'
import Toolbar from './components/Toolbar'
import MenuBar from './components/MenuBar'
import type { MenuDef, MenuEntry } from './components/MenuBar'
import { buildFileMenu, buildEditMenu, buildViewMenu } from './menus'
import { stepUiScale, resetUiScale, UI_SCALE_STEP } from './uiScale'
import { calcZoomToRegion, calcNewRegionBoundsFromScenes, calcNewRegionBoundsUpToNext } from './utils/view'
import { findPreviousTarget } from './utils/navigation'
import type { View } from './types'
import PanelDock, { PANEL_LIST, type PanelDockHandle } from './layout/PanelDock'
import { DockBridgeProvider } from './layout/DockContext'
import ContextMenu from './components/ContextMenu'
import type { ContextMenuState } from './components/ContextMenu'
import ThumbnailPopup, { ThumbnailHoverProvider } from './components/ThumbnailPopup'
import SettingsDialog from './components/SettingsDialog'
import AboutDialog from './components/AboutDialog'
import HotkeySheet from './components/HotkeySheet'
import { IconDropVideo } from './components/icons'
import { snapAllToBeat } from './utils/quantize'
import { undo as undoAction, redo as redoAction } from './store/slices/historySlice'
import {
  setRegions as setRegionsAction,
  addRegion as addRegionAction,
  deleteRegion as deleteRegionAction,
  setActiveRegionId as setActiveRegionIdAction,
  updateRegionInOut as updateRegionInOutAction,
  updateRegionBeatTimes as updateRegionBeatTimesAction,
  updateRegionLock as updateRegionLockAction,
  updateRegionTriggerMode as updateRegionTriggerModeAction,
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
import { ensureSceneListener } from './store/thunks/sceneThunks'
import { ensureWarpListener } from './store/thunks/jobsThunks'
import { setMinGap as setSceneMinGapAction, addCut as addSceneCutAction, deleteCut as deleteSceneCutAction } from './store/slices/sceneSlice'
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
  setRightWidth as setRightWidthAction,
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
function hasLlcExt(p: string) {
  return p.split('.').pop()?.toLowerCase() === 'llc'
}

// ── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const dispatch = useAppDispatch()

  // ── Redux state ─────────────────────────────────────────────────────────
  const video = useAppSelector(s => s.video.video)
  const folderVideos = useAppSelector(s => s.video.folderVideos)
  const markerCountByPath = useAppSelector(s => s.video.markerCountByPath)
  const detectingBpm = useAppSelector(s => s.video.detectingBpm)
  const regions = useAppSelector(s => s.region.regions)
  const activeRegionId = useAppSelector(s => s.region.activeRegionId)
  const activeRegion = useAppSelector(selectActiveRegionRedux)
  const view = useAppSelector(s => s.ui.view)
  const loopBeats = useAppSelector(s => s.warp.loopBeats)
  const trimToLoop = useAppSelector(s => s.warp.trimToLoop)
  const addToEnd = useAppSelector(s => s.warp.addToEnd)
  const videoPath = video?.path ?? null

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
  const exportOpen = useAppSelector(s => s.ui.exportOpen)
  const setExportOpen = (v: boolean) => dispatch(setExportOpenAction(v))
  const [exportOpenOnLog, setExportOpenOnLog] = useState(false)
  const [exportFocusJobId, setExportFocusJobId] = useState<string | null>(null)
  const runningJobs = useAppSelector(s => s.jobs.jobs.filter(j => j.status === 'running'))
  const allJobs = useAppSelector(s => s.jobs.jobs)
  const totalJobsCount = allJobs.length
  const totalProgressSum = allJobs.reduce((sum, j) => sum + j.progress, 0)
  const aggPct = totalJobsCount > 0 ? totalProgressSum / totalJobsCount * 100 : 0
  const completedJobsCount = allJobs.filter(j => j.status !== 'running').length
  const aggLabel = totalJobsCount > 0 ? `${completedJobsCount}/${totalJobsCount}` : ''
  const selectedClipIds = useAppSelector(s => s.lists.selection.clips)
  const [clipContextMenu, setClipContextMenu] = useState<ContextMenuState | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [pendingZoom, setPendingZoom] = useState<{ start: number; end: number } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [hotkeysOpen, setHotkeysOpen] = useState(false)

  // ? opens the keyboard shortcuts cheat sheet (definition lives in src/hotkeys.ts).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.key === '?') { e.preventDefault(); setHotkeysOpen(o => !o) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const playerRef = useRef<VideoPlayerHandle>(null)

  // Bridge of imperative App-level APIs (player ref, dialog state, floating
  // context menu) to dockview-mounted panels. Inline-rename state moved to
  // lists.pendingEdit. useMemo so panels don't see a fresh identity each
  // App render.
  const dockBridge = useMemo(() => ({
    seek: (t: number) => playerRef.current?.seek(t),
    setExportOpen: (open: boolean) => dispatch(setExportOpenAction(open)),
    openExportLog: (jobId: string) => {
      setExportFocusJobId(jobId)
      setExportOpenOnLog(true)
      dispatch(setExportOpenAction(true))
    },
    playerRef,
    setClipContextMenu,
  }), [dispatch])

  const rDragStart = useRef<{ x: number; w: number } | null>(null)

  // Imperative handle into PanelDock — lets the View menu reset the layout
  // and toggle individual panels. Visible panel ids re-render the menu so the
  // ✓ check marks reflect the live dock state.
  const dockHandleRef = useRef<PanelDockHandle | null>(null)
  const [visiblePanelIds, setVisiblePanelIds] = useState<ReadonlySet<string>>(new Set())

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
          // If a LosslessCut .llc project is dropped, import it: load the
          // referenced video and populate regions from cutSegments.
          const firstLlc = paths.find(hasLlcExt)
          if (firstLlc) {
            const { openLlcProjectThunk } = await import('./store/thunks/videoThunks')
            await dispatch(openLlcProjectThunk(firstLlc))
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

  // ── Theme: mirror settings.theme onto <html data-theme="…"> so the
  //     theme tokens cascade. Settings are persisted in localStorage by the
  //     slice; this effect just keeps the DOM in sync with the redux value.

  const theme = useAppSelector(s => s.settings.theme)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // ── Scene detection: register listener (detection itself is user-driven
  //     from the Scenes panel — we never kick it off automatically). ───────

  useEffect(() => { dispatch(ensureSceneListener()) }, [dispatch])

  // ── Tasks panel: register the warp-progress listener once on mount so
  //     every warp job (even those launched while the panel is closed) shows
  //     up in the jobs list. Idempotent — repeat dispatches are no-ops. ─────

  useEffect(() => { dispatch(ensureWarpListener()) }, [dispatch])

  // ── Seek to region start when active region changes ──────────────────────

  useEffect(() => {
    if (activeRegion) {
      playerRef.current?.seek(activeRegion.inPoint)
    }
  }, [activeRegionId]) // eslint-disable-line react-hooks/exhaustive-deps

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
    openSettings: () => setSettingsOpen(true),
  }), [video, anchorCount])

  const viewMenu: MenuDef = useMemo(() => buildViewMenu({
    increaseUiScale: () => stepUiScale(UI_SCALE_STEP),
    decreaseUiScale: () => stepUiScale(-UI_SCALE_STEP),
    resetUiScale: () => resetUiScale(),
    resetPanelLayout: () => dockHandleRef.current?.resetLayout(),
    togglePanel: id => dockHandleRef.current?.togglePanel(id),
    panels: PANEL_LIST,
    visiblePanelIds,
    showShortcuts: () => setHotkeysOpen(true),
  }), [visiblePanelIds])

  const brandMenu: MenuEntry[] = useMemo(() => [
    { label: 'About Lockstep', action: () => setAboutOpen(true) },
    { separator: true },
    { label: 'Settings…', shortcut: 'Ctrl+,', action: () => setSettingsOpen(true) },
    { separator: true },
    { label: 'Quit', shortcut: 'Ctrl+Q', action: async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      try { await getCurrentWindow().close() } catch { /* non-Tauri context */ }
    } },
  ], [])

  const canExport = !!video

  const clipIn = activeRegion?.inPoint ?? undefined
  const clipOut = activeRegion?.outPoint ?? undefined
  const clipInBeatTime = activeRegion?.inBeatTime
  const clipOutBeatTime = activeRegion?.outBeatTime

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <ThumbnailHoverProvider>
    <div className="app">

      {/* Menu bar */}
      <MenuBar
        menus={[fileMenu, editMenu, viewMenu]}
        brandMenu={brandMenu}
        rightContent={
          <div className="menubar__right-actions">
            {runningJobs.length > 0 && (
              <button
                className="menubar__jobs-bar"
                onClick={() => { setExportOpenOnLog(true); setExportOpen(true) }}
                title={`${runningJobs.length} task${runningJobs.length > 1 ? 's' : ''} running — ${aggLabel}`}
              >
                <span className="menubar__jobs-label">{aggLabel}</span>
                <div className="menubar__jobs-track">
                  <div className="menubar__jobs-fill" style={{ width: `${aggPct}%` }} />
                </div>
              </button>
            )}
            <button
              className="menubar__export-btn"
              onClick={() => { setExportOpenOnLog(false); setExportOpen(true) }}
              disabled={!canExport}
            >
              Export
            </button>
          </div>
        }
      />

      {/* Body — PanelDock renders unconditionally so the file-browser panel
          is reachable even before a video is loaded. The center column
          shows the empty / loading state itself. */}
      <DockBridgeProvider value={dockBridge}>
      <div className="vj-body">
        <PanelDock
          ref={dockHandleRef}
          onPanelsChange={ids => setVisiblePanelIds(new Set(ids))}
        />
      </div>
      </DockBridgeProvider>

      {/* Drag-over overlay */}
      {isDragOver && (
        <div className="app-drop-overlay">
          <div className="app-drop-overlay__inner">
            <IconDropVideo size={48} />
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
        onClose={() => { setExportOpen(false); setExportOpenOnLog(false); setExportFocusJobId(null) }}
        openOnLogTab={exportOpenOnLog}
        initialLogJobId={exportFocusJobId}
        warpData={warpData}
        videoPath={video?.path ?? ''}
        originalName={video?.originalName ?? ''}
        videoFps={video?.fps}
        loopBeats={loopBeats}
        addToEnd={addToEnd}
        trimToLoop={trimToLoop}
        regions={regions}
        activeRegionId={activeRegionId}
        selectedClipIds={selectedClipIds}
      />
      <ThumbnailPopup />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <HotkeySheet open={hotkeysOpen} onClose={() => setHotkeysOpen(false)} />
    </div>
    </ThumbnailHoverProvider>
  )
}
