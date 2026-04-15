import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { VideoInfo, WarpData, Region, SavedVideoState, Anchor } from '../types'
import type { VideoEntry } from '../api/video'
import { openFolder, openVideo, loadVideoFromPath, listFolderVideos } from '../api/video'
import { saveVideoState, loadVideoState, getFileHash } from '../api/storage'
import {
  checkVideoSidecar,
  writeVideoSidecar,
  deleteVideoSidecar,
  openJsonFile as openJsonFileApi,
} from '../api/warp'

// ── State shape ─────────────────────────────────────────────────────────────

interface ProjectState {
  folderVideos: VideoEntry[]
  video: VideoInfo | null
  warpData: WarpData | null
  regions: Region[]
  activeRegionId: string | null
  activeRegion: Region | null
  playhead: number
  detectingBpm: boolean
  markersLoaded: boolean
  /** Global markers for the current video (always the full set) */
  initialMarkers: SavedVideoState['defaultRegion'] | null
  loopBeats: number | null
  trimToLoop: boolean
  addToEnd: boolean
  markerCountByPath: Record<string, number>
}

// ── Actions exposed by the context ──────────────────────────────────────────

interface ProjectActions {
  openFile: () => Promise<void>
  openFolder: () => Promise<void>
  loadFolderFromPath: (path: string) => Promise<void>
  selectVideo: (path: string) => Promise<void>
  closeVideo: () => void
  setPlayhead: (t: number) => void
  setWarpData: (data: WarpData) => void
  setDetectingBpm: (v: boolean) => void
  setLoopBeats: (v: number | null) => void
  setTrimToLoop: (v: boolean) => void
  setAddToEnd: (v: boolean) => void
  addRegion: (inPoint: number, outPoint: number) => string
  duplicateRegion: (id: string) => string | null
  deleteRegion: (id: string) => void
  setActiveRegionId: (id: string | null) => void
  updateRegionInOut: (id: string, inPoint: number, outPoint: number) => void
  updateRegionBeatTimes: (id: string, inBeatTime?: number, outBeatTime?: number) => void
  updateRegionLock: (id: string, lock: 'bpm' | 'beats', lockedBeats?: number) => void
  renameRegion: (id: string, name: string) => void
  openJsonFile: () => Promise<void>
  resetVideoData: () => Promise<void>
}

type ProjectCtx = ProjectState & ProjectActions

const ProjectContext = createContext<ProjectCtx | null>(null)

export function useProject(): ProjectCtx {
  const ctx = useContext(ProjectContext)
  if (!ctx) throw new Error('useProject must be used inside <ProjectProvider>')
  return ctx
}

// ── Provider ────────────────────────────────────────────────────────────────

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [folderVideos, setFolderVideos] = useState<VideoEntry[]>([])
  const [video, setVideo] = useState<VideoInfo | null>(null)
  const [warpData, setWarpData] = useState<WarpData | null>(null)
  const [regions, setRegions] = useState<Region[]>([])
  const [activeRegionId, setActiveRegionIdState] = useState<string | null>(null)
  const [playhead, setPlayhead] = useState(0)
  const [detectingBpm, setDetectingBpm] = useState(false)
  const [markersLoaded, setMarkersLoaded] = useState(false)
  const [globalMarkers, setGlobalMarkers] = useState<SavedVideoState['defaultRegion'] | null>(null)
  const [loopBeats, setLoopBeats] = useState<number | null>(null)
  const [trimToLoop, setTrimToLoop] = useState(false)
  const [addToEnd, setAddToEnd] = useState(false)
  const [markerCountByPath, setMarkerCountByPath] = useState<Record<string, number>>({})

  // Refs for stable access in callbacks
  const videoRef = useRef<VideoInfo | null>(null)
  videoRef.current = video
  const warpDataRef = useRef<WarpData | null>(null)
  warpDataRef.current = warpData
  const activeRegionIdRef = useRef<string | null>(null)
  activeRegionIdRef.current = activeRegionId
  const regionsRef = useRef<Region[]>([])
  regionsRef.current = regions
  const globalMarkersRef = useRef<SavedVideoState['defaultRegion'] | null>(null)
  globalMarkersRef.current = globalMarkers
  const loopBeatsRef = useRef(loopBeats)
  const trimToLoopRef = useRef(trimToLoop)
  const addToEndRef = useRef(addToEnd)
  loopBeatsRef.current = loopBeats
  trimToLoopRef.current = trimToLoop
  addToEndRef.current = addToEnd

  // initialMarkers: always the global set, with BPM/stretch overridden from active region
  const initialMarkers: SavedVideoState['defaultRegion'] | null = (() => {
    if (!globalMarkers) return null
    if (activeRegionId === null) return globalMarkers
    const region = regions.find(r => r.id === activeRegionId)
    if (!region) return globalMarkers
    return {
      ...globalMarkers,
      bpm: region.bpm,
      minStretch: region.minStretch,
      maxStretch: region.maxStretch,
      addToEnd: region.addToEnd,
      beatZeroAnchorTime: null, // inPoint is beat zero for regions
    }
  })()

  const activeRegion = activeRegionId !== null
    ? (regions.find(r => r.id === activeRegionId) ?? null)
    : null

  // ── Load markers from backend when video changes ─────────────────────────
  useEffect(() => {
    if (!video) {
      setGlobalMarkers(null)
      setRegions([])
      setActiveRegionIdState(null)
      setMarkersLoaded(true)
      return
    }
    setMarkersLoaded(false)

    const doLoad = async () => {
      let state: SavedVideoState | null = null

      // Prefer sidecar next to the video file (portable project file)
      try {
        const sidecarContent = await checkVideoSidecar(video.path)
        if (sidecarContent) {
          state = JSON.parse(sidecarContent) as SavedVideoState
        }
      } catch { /* sidecar unreadable or malformed — fall through */ }

      // Fall back to internal hash-based storage
      if (!state) {
        try {
          state = await loadVideoState(video.fileHash)
        } catch { /* no internal state */ }
      }

      const dr = state?.defaultRegion ?? null
      setGlobalMarkers(dr)
      // Migrate old regions: strip anchor arrays
      const loadedRegions = (state?.regions ?? []).map((r: any) => ({
        id: r.id,
        name: r.name,
        inPoint: r.inPoint,
        outPoint: r.outPoint,
        bpm: r.bpm ?? 120,
        minStretch: r.minStretch ?? 0.5,
        maxStretch: r.maxStretch ?? 2.0,
        addToEnd: r.addToEnd ?? false,
      }))
      setRegions(loadedRegions)
      setActiveRegionIdState(null)
      setLoopBeats(dr?.loopBeats ?? null)
      setTrimToLoop(dr?.trimToLoop ?? false)
      setAddToEnd(dr?.addToEnd ?? false)
      setMarkersLoaded(true)
      const count = dr?.origAnchors?.length ?? 0
      setMarkerCountByPath(prev => ({ ...prev, [video.path]: count }))
    }

    doLoad().catch(() => {
      setGlobalMarkers(null)
      setRegions([])
      setActiveRegionIdState(null)
      setLoopBeats(null)
      setTrimToLoop(false)
      setAddToEnd(false)
      setMarkersLoaded(true)
    })
  }, [video])

  // ── Sync warp data changes to global markers + active region BPM/stretch ──
  useEffect(() => {
    if (!warpData) return
    // Always update global markers (anchors are global)
    setGlobalMarkers(prev => ({
      origAnchors: warpData.origAnchors,
      beatAnchors: warpData.beatAnchors,
      bpm: warpData.bpm,
      minStretch: warpData.minStretch,
      maxStretch: warpData.maxStretch,
      beatZeroAnchorTime: prev?.beatZeroAnchorTime ?? warpData.beatZeroTime,
      loopBeats: prev?.loopBeats,
      trimToLoop: prev?.trimToLoop,
      addToEnd: prev?.addToEnd,
    }))
    // If a region is active, sync BPM/stretch to the region
    const curRegionId = activeRegionIdRef.current
    if (curRegionId !== null) {
      setRegions(prev => prev.map(r =>
        r.id === curRegionId
          ? { ...r, bpm: warpData.bpm, minStretch: warpData.minStretch, maxStretch: warpData.maxStretch }
          : r
      ))
    }
  }, [warpData])

  // ── Sync addToEnd to active region ────────────────────────────────────────
  useEffect(() => {
    const curRegionId = activeRegionIdRef.current
    if (curRegionId !== null) {
      setRegions(prev => prev.map(r =>
        r.id === curRegionId ? { ...r, addToEnd } : r
      ))
    }
  }, [addToEnd])

  // ── Persist to backend on change ──────────────────────────────────────────
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleSave = useCallback(() => {
    const vid = videoRef.current
    if (!vid) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      const wd = warpDataRef.current
      const gm = globalMarkersRef.current
      const state: SavedVideoState = {
        version: 2,
        defaultRegion: {
          origAnchors: wd?.origAnchors ?? gm?.origAnchors ?? [],
          beatAnchors: wd?.origAnchors != null ? (wd.beatAnchors ?? []) : (gm?.beatAnchors ?? []),
          bpm: wd?.bpm ?? gm?.bpm ?? 120,
          minStretch: wd?.minStretch ?? gm?.minStretch ?? 0.5,
          maxStretch: wd?.maxStretch ?? gm?.maxStretch ?? 2.0,
          beatZeroAnchorTime: wd?.beatZeroTime ?? gm?.beatZeroAnchorTime ?? null,
          loopBeats: loopBeatsRef.current,
          trimToLoop: trimToLoopRef.current,
          addToEnd: addToEndRef.current,
        },
        regions: regionsRef.current,
      }
      // Save to internal hash-based storage
      saveVideoState(vid.fileHash, state).catch(() => { /* best effort */ })
      // Also write sidecar next to the source video (portable project file)
      try {
        await writeVideoSidecar(vid.path, JSON.stringify(state, null, 2))
      } catch { /* read-only location or other failure — best effort */ }
      const count = state.defaultRegion.origAnchors.length
      setMarkerCountByPath(prev => ({ ...prev, [vid.path]: count }))
    }, 500)
  }, [])

  useEffect(() => { scheduleSave() }, [warpData, loopBeats, trimToLoop, addToEnd, regions, scheduleSave])

  // ── Actions ──────────────────────────────────────────────────────────────

  const loadVideo = useCallback((info: VideoInfo) => {
    setVideo(info)
    setWarpData(null)
    setPlayhead(0)
  }, [])

  const openFileAction = useCallback(async () => {
    try {
      const info = await openVideo()
      if (info) { setFolderVideos([]); loadVideo(info) }
    } catch (e: any) {
      console.error('Failed to open file:', e)
    }
  }, [loadVideo])

  const applyFolderEntries = useCallback((entries: VideoEntry[]) => {
    setFolderVideos(entries)
    setVideo(null)
    setWarpData(null)
    setPlayhead(0)
    setMarkerCountByPath({})
    entries.forEach(entry => {
      getFileHash(entry.path)
        .then(hash => loadVideoState(hash))
        .then(state => {
          const count = state?.defaultRegion?.origAnchors?.length ?? 0
          setMarkerCountByPath(prev => ({ ...prev, [entry.path]: count }))
        })
        .catch(() => {})
    })
  }, [])

  const openFolderAction = useCallback(async () => {
    try {
      const entries = await openFolder()
      if (entries !== null) applyFolderEntries(entries)
    } catch (e: any) {
      console.error('Failed to open folder:', e)
    }
  }, [applyFolderEntries])

  const loadFolderFromPathAction = useCallback(async (path: string) => {
    try {
      const entries = await listFolderVideos(path)
      applyFolderEntries(entries)
    } catch (e: any) {
      console.error('Failed to load folder from path:', e)
    }
  }, [applyFolderEntries])

  const selectVideoAction = useCallback(async (path: string) => {
    try { loadVideo(await loadVideoFromPath(path)) }
    catch (e: any) { console.error('Failed to load video:', e) }
  }, [loadVideo])

  const closeVideoAction = useCallback(() => {
    setVideo(null)
    setWarpData(null)
    setPlayhead(0)
    setLoopBeats(null)
    setTrimToLoop(false)
    setAddToEnd(false)
    setRegions([])
    setActiveRegionIdState(null)
    setGlobalMarkers(null)
  }, [])

  // Flush warp data to global markers, then switch region
  const setActiveRegionId = useCallback((id: string | null) => {
    const wd = warpDataRef.current

    // Flush current warp data to global markers
    if (wd) {
      setGlobalMarkers(prev => ({
        origAnchors: wd.origAnchors,
        beatAnchors: wd.beatAnchors,
        bpm: wd.bpm,
        minStretch: wd.minStretch,
        maxStretch: wd.maxStretch,
        beatZeroAnchorTime: prev?.beatZeroAnchorTime ?? wd.beatZeroTime,
        loopBeats: prev?.loopBeats,
        trimToLoop: prev?.trimToLoop,
        addToEnd: prev?.addToEnd,
      }))
      // Flush BPM/stretch to outgoing region
      const outgoingId = activeRegionIdRef.current
      if (outgoingId !== null) {
        setRegions(prev => prev.map(r =>
          r.id === outgoingId
            ? { ...r, bpm: wd.bpm, minStretch: wd.minStretch, maxStretch: wd.maxStretch, addToEnd: addToEndRef.current }
            : r
        ))
      }
    }

    // Switch active region
    setActiveRegionIdState(id)
    setWarpData(null)

    // Load settings from incoming region
    if (id !== null) {
      const incoming = regionsRef.current.find(r => r.id === id)
      if (incoming) {
        setAddToEnd(incoming.addToEnd ?? false)
      }
    } else {
      const gm = globalMarkersRef.current
      setLoopBeats(gm?.loopBeats ?? null)
      setTrimToLoop(gm?.trimToLoop ?? false)
      setAddToEnd(gm?.addToEnd ?? false)
    }
  }, [])

  const addRegion = useCallback((inPoint: number, outPoint: number) => {
    const existingCount = regionsRef.current.length
    const name = `Clip ${existingCount + 1}`
    const id = `region_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    // Inherit BPM from current warp data or global markers
    const wd = warpDataRef.current
    const gm = globalMarkersRef.current
    const newRegion: Region = {
      id,
      name,
      inPoint,
      outPoint,
      bpm: wd?.bpm ?? gm?.bpm ?? 120,
      minStretch: wd?.minStretch ?? gm?.minStretch ?? 0.5,
      maxStretch: wd?.maxStretch ?? gm?.maxStretch ?? 2.0,
      addToEnd: false,
    }
    setRegions(prev => [...prev, newRegion])
    return id
  }, [])

  const duplicateRegion = useCallback((id: string): string | null => {
    const source = regionsRef.current.find(r => r.id === id)
    if (!source) return null
    const span = source.outPoint - source.inPoint
    const vid = videoRef.current
    const maxTime = vid ? vid.duration : Infinity
    const inPoint = Math.min(source.outPoint, maxTime - span)
    const outPoint = Math.min(inPoint + span, maxTime)
    const newId = `region_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const newRegion: Region = {
      id: newId,
      name: `Clip ${regionsRef.current.length + 1}`,
      inPoint,
      outPoint,
      bpm: source.bpm,
      minStretch: source.minStretch,
      maxStretch: source.maxStretch,
      addToEnd: source.addToEnd,
    }
    setRegions(prev => [...prev, newRegion])
    return newId
  }, [])

  const deleteRegion = useCallback((id: string) => {
    setRegions(prev => prev.filter(r => r.id !== id))
    if (activeRegionIdRef.current === id) {
      setActiveRegionIdState(null)
      setWarpData(null)
      const gm = globalMarkersRef.current
      setLoopBeats(gm?.loopBeats ?? null)
      setTrimToLoop(gm?.trimToLoop ?? false)
      setAddToEnd(gm?.addToEnd ?? false)
    }
  }, [])

  const updateRegionInOut = useCallback((id: string, inPoint: number, outPoint: number) => {
    // Reset beat boundary times when the orig boundaries change
    setRegions(prev => prev.map(r => r.id === id ? { ...r, inPoint, outPoint, inBeatTime: undefined, outBeatTime: undefined } : r))
  }, [])

  const updateRegionBeatTimes = useCallback((id: string, inBeatTime?: number, outBeatTime?: number) => {
    setRegions(prev => prev.map(r => r.id === id ? { ...r, inBeatTime, outBeatTime } : r))
  }, [])

  const updateRegionLock = useCallback((id: string, lock: 'bpm' | 'beats', lockedBeats?: number) => {
    setRegions(prev => prev.map(r => r.id === id ? { ...r, lock, lockedBeats } : r))
  }, [])

  const renameRegion = useCallback((id: string, name: string) => {
    setRegions(prev => prev.map(r => r.id === id ? { ...r, name } : r))
  }, [])

  /** Open a .json sidecar picker → find sibling video → load both. */
  const openJsonFileAction = useCallback(async () => {
    try {
      const { videoPath } = await openJsonFileApi()
      const info = await loadVideoFromPath(videoPath)
      setFolderVideos([])
      loadVideo(info)
    } catch (e: any) {
      const msg = String(e)
      if (msg.includes('cancelled')) return
      console.error('Failed to open marker JSON:', e)
    }
  }, [loadVideo])

  /** Reset all data for the current video (clears markers, regions, deletes sidecar). */
  const resetVideoDataAction = useCallback(async () => {
    const vid = videoRef.current
    if (!vid) return

    // Clear in-memory state
    setGlobalMarkers(null)
    setRegions([])
    setActiveRegionIdState(null)
    setWarpData(null)
    setLoopBeats(null)
    setTrimToLoop(false)
    setAddToEnd(false)

    // Overwrite internal storage with empty state
    const emptyState: SavedVideoState = {
      version: 2,
      defaultRegion: {
        origAnchors: [],
        beatAnchors: [],
        bpm: 120,
        minStretch: 0.5,
        maxStretch: 2.0,
        beatZeroAnchorTime: null,
        loopBeats: null,
        trimToLoop: false,
        addToEnd: false,
      },
      regions: [],
    }
    saveVideoState(vid.fileHash, emptyState).catch(() => {})
    // Delete sidecar next to source video
    deleteVideoSidecar(vid.path).catch(() => {})
    setMarkerCountByPath(prev => ({ ...prev, [vid.path]: 0 }))
  }, [])

  const ctx: ProjectCtx = {
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
    markerCountByPath,
    openFile: openFileAction,
    openFolder: openFolderAction,
    loadFolderFromPath: loadFolderFromPathAction,
    selectVideo: selectVideoAction,
    closeVideo: closeVideoAction,
    setPlayhead,
    setWarpData,
    setDetectingBpm,
    setLoopBeats,
    setTrimToLoop,
    setAddToEnd,
    addRegion,
    duplicateRegion,
    deleteRegion,
    setActiveRegionId,
    updateRegionInOut,
    updateRegionBeatTimes,
    updateRegionLock,
    renameRegion,
    openJsonFile: openJsonFileAction,
    resetVideoData: resetVideoDataAction,
  }

  return (
    <ProjectContext.Provider value={ctx}>
      {children}
    </ProjectContext.Provider>
  )
}
