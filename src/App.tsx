import { useCallback, useRef, useState } from 'react'
import VideoPlayer from './components/VideoPlayer'
import type { VideoPlayerHandle } from './components/VideoPlayer'
import WarpView from './components/WarpView'
import type { WarpViewHandle } from './components/WarpView'
import WarpPanel from './components/WarpPanel'
import ClipSidebar from './components/ClipSidebar'
import VideoFolderSidebar from './components/VideoFolderSidebar'
import { openFolder, loadVideoFromPath } from './api/video'
import type { VideoEntry } from './api/video'
import type { WarpData, Anchor, VideoInfo, Clip } from './types'
import './App.css'

// ── Marker persistence ───────────────────────────────────────────────────────

interface SavedMarkers {
  origAnchors: Anchor[]
  beatAnchors: Anchor[]
  bpm: number
  minStretch?: number
  maxStretch?: number
  addToEnd?: boolean
  beatZeroAnchorTime?: number
  trimToLoop?: boolean
  loopBeats?: number | null
}

function markerKey(fileHash: string, clipId?: string) {
  return clipId ? `vjt_markers_${fileHash}_${clipId}` : `vjt_markers_${fileHash}`
}
function clipsKey(fileHash: string) { return `vjt_clips_${fileHash}` }

function loadMarkers(fileHash: string, clipId?: string): SavedMarkers | null {
  try { const raw = localStorage.getItem(markerKey(fileHash, clipId)); return raw ? JSON.parse(raw) : null }
  catch { return null }
}

function saveMarkersToStorage(
  fileHash: string,
  data: WarpData,
  opts: { trimToLoop: boolean; loopBeats: number | null; addToEnd: boolean },
  clipId?: string,
) {
  try {
    localStorage.setItem(markerKey(fileHash, clipId), JSON.stringify({
      origAnchors: data.origAnchors, beatAnchors: data.beatAnchors, bpm: data.bpm,
      minStretch: data.minStretch, maxStretch: data.maxStretch, addToEnd: opts.addToEnd,
      beatZeroAnchorTime: data.beatZeroTime, trimToLoop: opts.trimToLoop, loopBeats: opts.loopBeats,
    }))
  } catch { /* storage full */ }
}

function loadClips(fileHash: string): Clip[] {
  try { const raw = localStorage.getItem(clipsKey(fileHash)); return raw ? JSON.parse(raw) : [] }
  catch { return [] }
}

function saveClips(fileHash: string, clips: Clip[]) {
  try { localStorage.setItem(clipsKey(fileHash), JSON.stringify(clips)) }
  catch { /* storage full */ }
}

// ── Layout constants ─────────────────────────────────────────────────────────

const MIN_PLAYER = 120
const MAX_PLAYER = 700
const DEFAULT_PLAYER = 380

// ── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [folderVideos, setFolderVideos] = useState<VideoEntry[]>([])
  const [video, setVideo] = useState<VideoInfo | null>(null)
  const [warpData, setWarpData] = useState<WarpData | null>(null)
  const [playhead, setPlayhead] = useState(0)
  const [playerHeight, setPlayerHeight] = useState(DEFAULT_PLAYER)

  const [trimToLoop, setTrimToLoop] = useState(false)
  const [loopBeats, setLoopBeats] = useState<number | null>(null)
  const [addToEnd, setAddToEnd] = useState(false)

  const [clips, setClips] = useState<Clip[]>([])
  const [activeClipId, setActiveClipId] = useState<string | null>(null)

  const playerRef = useRef<VideoPlayerHandle>(null)
  const warpRef = useRef<WarpViewHandle>(null)
  const dragStart = useRef<{ y: number; h: number } | null>(null)
  const videoRef = useRef<VideoInfo | null>(null)
  videoRef.current = video
  const playheadRef = useRef(playhead)
  playheadRef.current = playhead

  const trimToLoopRef = useRef(trimToLoop); trimToLoopRef.current = trimToLoop
  const loopBeatsRef = useRef(loopBeats); loopBeatsRef.current = loopBeats
  const addToEndRef = useRef(addToEnd); addToEndRef.current = addToEnd
  const activeClipIdRef = useRef(activeClipId); activeClipIdRef.current = activeClipId
  const clipsRef = useRef(clips); clipsRef.current = clips

  // ── Resizer ────────────────────────────────────────────────────────────────

  const handleResizerPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragStart.current = { y: e.clientY, h: playerHeight }
  }
  const handleResizerPointerMove = (e: React.PointerEvent) => {
    if (!dragStart.current || !e.buttons) return
    setPlayerHeight(Math.max(MIN_PLAYER, Math.min(MAX_PLAYER,
      dragStart.current.h + (e.clientY - dragStart.current.y)
    )))
  }
  const handleResizerPointerUp = () => { dragStart.current = null }

  // ── Video / folder loading ─────────────────────────────────────────────────

  const loadVideo = useCallback((info: VideoInfo) => {
    const fullMarkers = loadMarkers(info.fileHash)
    const savedClips = loadClips(info.fileHash)
    setVideo(info)
    setWarpData(null)
    setPlayhead(0)
    setActiveClipId(null)
    setClips(savedClips)
    if (fullMarkers?.trimToLoop !== undefined) setTrimToLoop(fullMarkers.trimToLoop)
    if (fullMarkers?.loopBeats !== undefined) setLoopBeats(fullMarkers.loopBeats ?? null)
    if (fullMarkers?.addToEnd !== undefined) setAddToEnd(fullMarkers.addToEnd)
  }, [])

  const handleOpenFolder = useCallback(async () => {
    const entries = await openFolder()
    if (entries !== null) {
      setFolderVideos(entries)
      setVideo(null)
      setWarpData(null)
      setPlayhead(0)
    }
  }, [])

  const handleSelectVideo = useCallback(async (path: string) => {
    try { loadVideo(await loadVideoFromPath(path)) }
    catch (e: any) { console.error('Failed to load video:', e) }
  }, [loadVideo])

  const handleCloseVideo = useCallback(() => {
    setVideo(null); setWarpData(null); setPlayhead(0)
    setActiveClipId(null); setClips([])
  }, [])

  // ── Warp data change ───────────────────────────────────────────────────────

  const handleDataChange = useCallback((data: WarpData) => {
    setWarpData(data)
    const vid = videoRef.current
    const clipId = activeClipIdRef.current ?? undefined
    const activeClip = clipId ? clipsRef.current.find(c => c.id === clipId) : null
    if (vid) saveMarkersToStorage(vid.fileHash, data, {
      trimToLoop: activeClip ? activeClip.trimToLoop : trimToLoopRef.current,
      loopBeats: activeClip ? activeClip.loopBeats : loopBeatsRef.current,
      addToEnd: activeClip ? activeClip.addToEnd : addToEndRef.current,
    }, clipId)
  }, [])

  // ── Clip management ────────────────────────────────────────────────────────

  const updateClips = (next: Clip[]) => { setClips(next); if (video) saveClips(video.fileHash, next) }

  const handleAddClip = () => {
    if (!video) return
    const id = crypto.randomUUID()
    const n = clips.length + 1
    const newClip: Clip = {
      id, name: `clip_${String(n).padStart(3, '0')}`,
      inPoint: playheadRef.current, outPoint: video.duration,
      trimToLoop: false, loopBeats: null, addToEnd: false,
    }
    updateClips([...clips, newClip]); setActiveClipId(id); setWarpData(null)
  }
  const handleDeleteClip = (id: string) => {
    updateClips(clips.filter(c => c.id !== id))
    if (activeClipId === id) { setActiveClipId(null); setWarpData(null) }
  }
  const handleSetIn = (id: string) =>
    updateClips(clips.map(c => c.id === id ? { ...c, inPoint: Math.min(playheadRef.current, c.outPoint - 0.1) } : c))
  const handleSetOut = (id: string) =>
    updateClips(clips.map(c => c.id === id ? { ...c, outPoint: Math.max(playheadRef.current, c.inPoint + 0.1) } : c))
  const handleRenameClip = (id: string, name: string) =>
    updateClips(clips.map(c => c.id === id ? { ...c, name } : c))
  const handleSelectClip = (id: string) => {
    if (id === activeClipId) return
    setActiveClipId(id); setWarpData(null)
    const clip = clips.find(c => c.id === id)
    if (clip) playerRef.current?.seek(clip.inPoint)
  }
  const handleSelectFull = () => { if (activeClipId !== null) { setActiveClipId(null); setWarpData(null) } }

  // ── Active clip helpers ────────────────────────────────────────────────────

  const activeClip = activeClipId ? clips.find(c => c.id === activeClipId) ?? null : null
  const clipIn = activeClip?.inPoint ?? null
  const clipOut = activeClip?.outPoint ?? null
  const clipOffset = clipIn ?? 0
  const warpDuration = activeClip ? activeClip.outPoint - activeClip.inPoint : (video?.duration ?? 0)

  const activeTrimToLoop = activeClip ? activeClip.trimToLoop : trimToLoop
  const activeLoopBeats = activeClip ? activeClip.loopBeats : loopBeats
  const activeAddToEnd = activeClip ? activeClip.addToEnd : addToEnd

  const setActiveTrimToLoop = (v: boolean) => activeClip
    ? updateClips(clips.map(c => c.id === activeClip.id ? { ...c, trimToLoop: v } : c))
    : setTrimToLoop(v)
  const setActiveLoopBeats = (v: number | null) => activeClip
    ? updateClips(clips.map(c => c.id === activeClip.id ? { ...c, loopBeats: v } : c))
    : setLoopBeats(v)
  const setActiveAddToEnd = (v: boolean) => activeClip
    ? updateClips(clips.map(c => c.id === activeClip.id ? { ...c, addToEnd: v } : c))
    : setAddToEnd(v)

  const warpInitMarkers = video ? loadMarkers(video.fileHash, activeClipId ?? undefined) : null

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="app">

      {/* Left: file browser */}
      <VideoFolderSidebar
        videos={folderVideos}
        selectedPath={video?.path ?? null}
        onOpenFolder={handleOpenFolder}
        onSelectVideo={handleSelectVideo}
      />

      {!video ? (
        /* Empty state: prompt to open folder / select video */
        <div className="app-empty">
          {folderVideos.length === 0
            ? <p className="app-empty__hint">Open a folder to browse video files</p>
            : <p className="app-empty__hint">Select a video from the sidebar</p>}
        </div>
      ) : (
        <>
          {/* Center: video player + dual timeline */}
          <div className="vj-center">

            <div className="vj-player" style={{ height: playerHeight }}>
              <VideoPlayer
                ref={playerRef}
                src={video.videoUrl}
                duration={video.duration}
                fps={video.fps}
                onTimeUpdate={setPlayhead}
                onMark={t => warpRef.current?.addAnchor(Math.max(0, t - clipOffset))}
              />
            </div>

            <div
              className="vj-resizer"
              onPointerDown={handleResizerPointerDown}
              onPointerMove={handleResizerPointerMove}
              onPointerUp={handleResizerPointerUp}
            />

            <div className="vj-timeline">
              {activeClip && (
                <div className="vj-clip-bar">
                  <button className="vj-clip-back" onClick={handleSelectFull}>← Full Video</button>
                  <span className="vj-clip-name">{activeClip.name}</span>
                  <span className="vj-clip-range">
                    {(clipIn ?? 0).toFixed(2)}s – {(clipOut ?? video.duration).toFixed(2)}s
                  </span>
                </div>
              )}

              <WarpView
                key={activeClipId ?? `full_${video.path}`}
                ref={warpRef}
                duration={warpDuration}
                initialBpm={warpInitMarkers?.bpm ?? 120}
                initialMinStretch={warpInitMarkers?.minStretch}
                initialMaxStretch={warpInitMarkers?.maxStretch}
                addToEnd={activeAddToEnd}
                initialBeatZeroAnchorTime={warpInitMarkers?.beatZeroAnchorTime}
                initialOrigAnchors={warpInitMarkers?.origAnchors}
                initialBeatAnchors={warpInitMarkers?.beatAnchors}
                playhead={Math.max(0, playhead - clipOffset)}
                onSeek={t => playerRef.current?.seek(t + clipOffset)}
                onDataChange={handleDataChange}
                videoPath={video.path}
                trimToLoop={activeTrimToLoop}
                loopBeats={activeLoopBeats}
              />
            </div>
          </div>

          {/* Right: settings + clip list */}
          <div className="vj-right-panel">
            <WarpPanel
              warpRef={warpRef}
              warpData={warpData}
              videoPath={video.path}
              originalName={activeClip ? activeClip.name : video.originalName}
              trimToLoop={activeTrimToLoop}
              onTrimToLoopChange={setActiveTrimToLoop}
              loopBeats={activeLoopBeats}
              onLoopBeatsChange={setActiveLoopBeats}
              addToEnd={activeAddToEnd}
              onAddToEndChange={setActiveAddToEnd}
              onNew={handleCloseVideo}
              clipIn={clipIn}
              clipOut={clipOut}
            />
            <ClipSidebar
              clips={clips}
              activeClipId={activeClipId}
              videoDuration={video.duration}
              playhead={playhead}
              onSelectFull={handleSelectFull}
              onSelectClip={handleSelectClip}
              onAddClip={handleAddClip}
              onDeleteClip={handleDeleteClip}
              onSetIn={handleSetIn}
              onSetOut={handleSetOut}
              onRenameClip={handleRenameClip}
            />
          </div>
        </>
      )}
    </div>
  )
}
