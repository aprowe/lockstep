import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { VideoInfo, WarpData, Region, SavedVideoState, Anchor } from '../types'
import type { VideoEntry } from '../api/video'
import { openFolder, openVideo, loadVideoFromPath, listFolderVideos } from '../api/video'
import { saveVideoState, loadVideoState, getFileHash } from '../api/storage'

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
  initialMarkers: SavedVideoState['defaultRegion'] | null
  loopBeats: number | null
  trimToLoop: boolean
  addToEnd: boolean
  /** Number of orig markers saved for each video path in the current folder */
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
  addRegion: (inPoint: number, outPoint: number) => void
  addRegionWithMarkers: (inPoint: number, outPoint: number, markers: {
    origAnchors: Anchor[]
    beatAnchors: Anchor[]
    bpm: number
    minStretch: number
    maxStretch: number
    beatZeroAnchorTime: number | null
  }) => void
  deleteRegion: (id: string) => void
  setActiveRegionId: (id: string | null) => void
  updateRegionInOut: (id: string, inPoint: number, outPoint: number) => void
  renameRegion: (id: string, name: string) => void
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
  const [defaultRegionMarkers, setDefaultRegionMarkers] = useState<SavedVideoState['defaultRegion'] | null>(null)
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
  const defaultRegionMarkersRef = useRef<SavedVideoState['defaultRegion'] | null>(null)
  defaultRegionMarkersRef.current = defaultRegionMarkers
  const loopBeatsRef = useRef(loopBeats)
  const trimToLoopRef = useRef(trimToLoop)
  const addToEndRef = useRef(addToEnd)
  loopBeatsRef.current = loopBeats
  trimToLoopRef.current = trimToLoop
  addToEndRef.current = addToEnd

  // Compute initialMarkers from activeRegionId
  const initialMarkers: SavedVideoState['defaultRegion'] | null = (() => {
    if (activeRegionId === null) {
      return defaultRegionMarkers
    }
    const region = regions.find(r => r.id === activeRegionId)
    if (!region) return defaultRegionMarkers
    return {
      origAnchors: region.origAnchors,
      beatAnchors: region.beatAnchors,
      bpm: region.bpm,
      minStretch: region.minStretch,
      maxStretch: region.maxStretch,
      beatZeroAnchorTime: region.beatZeroAnchorTime,
      loopBeats: region.loopBeats,
      trimToLoop: region.trimToLoop,
      addToEnd: region.addToEnd,
    }
  })()

  const activeRegion = activeRegionId !== null
    ? (regions.find(r => r.id === activeRegionId) ?? null)
    : null

  // ── Load markers from backend when video changes ─────────────────────────
  useEffect(() => {
    if (!video) {
      setDefaultRegionMarkers(null)
      setRegions([])
      setActiveRegionIdState(null)
      setMarkersLoaded(true)
      return
    }
    setMarkersLoaded(false)
    loadVideoState(video.fileHash).then(state => {
      const dr = state?.defaultRegion ?? null
      setDefaultRegionMarkers(dr)
      setRegions(state?.regions ?? [])
      setActiveRegionIdState(null)
      setLoopBeats(dr?.loopBeats ?? null)
      setTrimToLoop(dr?.trimToLoop ?? false)
      setAddToEnd(dr?.addToEnd ?? false)
      setMarkersLoaded(true)
      // Update sidebar count for this video
      const count = dr?.origAnchors?.length ?? 0
      setMarkerCountByPath(prev => ({ ...prev, [video.path]: count }))
    }).catch(() => {
      setDefaultRegionMarkers(null)
      setRegions([])
      setActiveRegionIdState(null)
      setLoopBeats(null)
      setTrimToLoop(false)
      setAddToEnd(false)
      setMarkersLoaded(true)
    })
  }, [video])

  // ── Sync warp data changes to active region ───────────────────────────────
  useEffect(() => {
    if (!warpData) return
    const curRegionId = activeRegionIdRef.current
    if (curRegionId !== null) {
      setRegions(prev => prev.map(r =>
        r.id === curRegionId
          ? {
              ...r,
              origAnchors: warpData.origAnchors,
              beatAnchors: warpData.beatAnchors,
              bpm: warpData.bpm,
              minStretch: warpData.minStretch,
              maxStretch: warpData.maxStretch,
              beatZeroAnchorTime: warpData.beatZeroTime,
            }
          : r
      ))
    } else {
      setDefaultRegionMarkers(prev => prev === null ? null : {
        ...prev,
        origAnchors: warpData.origAnchors,
        beatAnchors: warpData.beatAnchors,
        bpm: warpData.bpm,
        minStretch: warpData.minStretch,
        maxStretch: warpData.maxStretch,
        beatZeroAnchorTime: warpData.beatZeroTime,
      })
    }
  }, [warpData])

  // ── Sync loop/trim/addToEnd to active region ──────────────────────────────
  useEffect(() => {
    const curRegionId = activeRegionIdRef.current
    if (curRegionId !== null) {
      setRegions(prev => prev.map(r =>
        r.id === curRegionId
          ? { ...r, loopBeats, trimToLoop, addToEnd }
          : r
      ))
    }
  }, [loopBeats, trimToLoop, addToEnd])

  // ── Persist warp data + loop settings to backend on change ──────────────
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleSave = useCallback(() => {
    const vid = videoRef.current
    if (!vid) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      const wd = warpDataRef.current
      const dr = defaultRegionMarkersRef.current
      const state: SavedVideoState = {
        version: 2,
        defaultRegion: {
          origAnchors: wd?.origAnchors ?? dr?.origAnchors ?? [],
          beatAnchors: wd?.origAnchors != null ? (wd.beatAnchors ?? []) : (dr?.beatAnchors ?? []),
          bpm: wd?.bpm ?? dr?.bpm ?? 120,
          minStretch: wd?.minStretch ?? dr?.minStretch ?? 0.5,
          maxStretch: wd?.maxStretch ?? dr?.maxStretch ?? 2.0,
          beatZeroAnchorTime: wd?.beatZeroTime ?? dr?.beatZeroAnchorTime ?? null,
          loopBeats: loopBeatsRef.current,
          trimToLoop: trimToLoopRef.current,
          addToEnd: addToEndRef.current,
        },
        regions: regionsRef.current,
      }
      saveVideoState(vid.fileHash, state).catch(() => { /* best effort */ })
      // Keep sidebar count in sync with current marker count
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
    // Asynchronously populate marker counts for each entry
    entries.forEach(entry => {
      getFileHash(entry.path)
        .then(hash => loadVideoState(hash))
        .then(state => {
          const count = state?.defaultRegion?.origAnchors?.length ?? 0
          setMarkerCountByPath(prev => ({ ...prev, [entry.path]: count }))
        })
        .catch(() => { /* no saved state = 0 markers, skip */ })
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
    setDefaultRegionMarkers(null)
  }, [])

  // Flush current warp data to the outgoing region/defaultRegion, then switch
  const setActiveRegionId = useCallback((id: string | null) => {
    const outgoingId = activeRegionIdRef.current
    const wd = warpDataRef.current

    // Flush current warp data to outgoing region/default
    if (wd) {
      if (outgoingId !== null) {
        setRegions(prev => prev.map(r =>
          r.id === outgoingId
            ? {
                ...r,
                origAnchors: wd.origAnchors,
                beatAnchors: wd.beatAnchors,
                bpm: wd.bpm,
                minStretch: wd.minStretch,
                maxStretch: wd.maxStretch,
                beatZeroAnchorTime: wd.beatZeroTime,
                loopBeats: loopBeatsRef.current,
                trimToLoop: trimToLoopRef.current,
                addToEnd: addToEndRef.current,
              }
            : r
        ))
      } else {
        setDefaultRegionMarkers({
          origAnchors: wd.origAnchors,
          beatAnchors: wd.beatAnchors,
          bpm: wd.bpm,
          minStretch: wd.minStretch,
          maxStretch: wd.maxStretch,
          beatZeroAnchorTime: wd.beatZeroTime,
          loopBeats: loopBeatsRef.current,
          trimToLoop: trimToLoopRef.current,
          addToEnd: addToEndRef.current,
        })
      }
    }

    // Switch active region
    setActiveRegionIdState(id)
    setWarpData(null)

    // Load loop settings from incoming region
    if (id !== null) {
      const incoming = regionsRef.current.find(r => r.id === id)
      if (incoming) {
        setLoopBeats(incoming.loopBeats ?? null)
        setTrimToLoop(incoming.trimToLoop ?? false)
        setAddToEnd(incoming.addToEnd ?? false)
      }
    } else {
      const dr = defaultRegionMarkersRef.current
      setLoopBeats(dr?.loopBeats ?? null)
      setTrimToLoop(dr?.trimToLoop ?? false)
      setAddToEnd(dr?.addToEnd ?? false)
    }
  }, [])

  const addRegion = useCallback((inPoint: number, outPoint: number) => {
    const existingCount = regionsRef.current.length
    const name = `Clip ${existingCount + 1}`
    const id = `region_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const newRegion: Region = {
      id,
      name,
      inPoint,
      outPoint,
      origAnchors: [],
      beatAnchors: [],
      bpm: 120,
      minStretch: 0.5,
      maxStretch: 2.0,
      beatZeroAnchorTime: null,
      trimToLoop: false,
      loopBeats: null,
      addToEnd: false,
    }
    setRegions(prev => [...prev, newRegion])
    // Auto-select the new region
    setActiveRegionId(id)
  }, [setActiveRegionId])

  const addRegionWithMarkers = useCallback((
    inPoint: number,
    outPoint: number,
    markers: {
      origAnchors: Anchor[]
      beatAnchors: Anchor[]
      bpm: number
      minStretch: number
      maxStretch: number
      beatZeroAnchorTime: number | null
    },
  ) => {
    const existingCount = regionsRef.current.length
    const name = `Clip ${existingCount + 1}`
    const id = `region_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const newRegion: Region = {
      id,
      name,
      inPoint,
      outPoint,
      origAnchors: markers.origAnchors,
      beatAnchors: markers.beatAnchors,
      bpm: markers.bpm,
      minStretch: markers.minStretch,
      maxStretch: markers.maxStretch,
      beatZeroAnchorTime: markers.beatZeroAnchorTime,
      trimToLoop: false,
      loopBeats: null,
      addToEnd: false,
    }
    setRegions(prev => [...prev, newRegion])
    setActiveRegionId(id)
  }, [setActiveRegionId])

  const deleteRegion = useCallback((id: string) => {
    setRegions(prev => prev.filter(r => r.id !== id))
    if (activeRegionIdRef.current === id) {
      // Go back to default (full video)
      setActiveRegionIdState(null)
      setWarpData(null)
      const dr = defaultRegionMarkersRef.current
      setLoopBeats(dr?.loopBeats ?? null)
      setTrimToLoop(dr?.trimToLoop ?? false)
      setAddToEnd(dr?.addToEnd ?? false)
    }
  }, [])

  const updateRegionInOut = useCallback((id: string, inPoint: number, outPoint: number) => {
    setRegions(prev => prev.map(r => r.id === id ? { ...r, inPoint, outPoint } : r))
  }, [])

  const renameRegion = useCallback((id: string, name: string) => {
    setRegions(prev => prev.map(r => r.id === id ? { ...r, name } : r))
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
    addRegionWithMarkers,
    deleteRegion,
    setActiveRegionId,
    updateRegionInOut,
    renameRegion,
  }

  return (
    <ProjectContext.Provider value={ctx}>
      {children}
    </ProjectContext.Provider>
  )
}
