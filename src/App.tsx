import { useCallback, useRef, useState } from 'react'
import VideoPlayer from './components/VideoPlayer'
import type { VideoPlayerHandle } from './components/VideoPlayer'
import WarpView from './components/WarpView'
import type { WarpViewHandle } from './components/WarpView'
import WarpPanel from './components/WarpPanel'
import ClipSidebar from './components/ClipSidebar'
import { openVideo } from './api/video'
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

function clipsKey(fileHash: string) {
  return `vjt_clips_${fileHash}`
}

function loadMarkers(fileHash: string, clipId?: string): SavedMarkers | null {
  try {
    const raw = localStorage.getItem(markerKey(fileHash, clipId))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveMarkersToStorage(
  fileHash: string,
  data: WarpData,
  opts: { trimToLoop: boolean; loopBeats: number | null; addToEnd: boolean },
  clipId?: string,
) {
  try {
    localStorage.setItem(markerKey(fileHash, clipId), JSON.stringify({
      origAnchors: data.origAnchors,
      beatAnchors: data.beatAnchors,
      bpm: data.bpm,
      minStretch: data.minStretch,
      maxStretch: data.maxStretch,
      addToEnd: opts.addToEnd,
      beatZeroAnchorTime: data.beatZeroTime,
      trimToLoop: opts.trimToLoop,
      loopBeats: opts.loopBeats,
    }))
  } catch { /* storage full */ }
}

function loadClips(fileHash: string): Clip[] {
  try {
    const raw = localStorage.getItem(clipsKey(fileHash))
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveClips(fileHash: string, clips: Clip[]) {
  try {
    localStorage.setItem(clipsKey(fileHash), JSON.stringify(clips))
  } catch { /* storage full */ }
}

// ── Layout constants ─────────────────────────────────────────────────────────

const MIN_TOP = 120
const MAX_TOP = 700
const DEFAULT_TOP = 420

// ── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [video, setVideo] = useState<VideoInfo | null>(null)
  const [warpData, setWarpData] = useState<WarpData | null>(null)
  const [playhead, setPlayhead] = useState(0)
  const [topHeight, setTopHeight] = useState(DEFAULT_TOP)

  // Full-video warp settings
  const [trimToLoop, setTrimToLoop] = useState(false)
  const [loopBeats, setLoopBeats] = useState<number | null>(null)
  const [addToEnd, setAddToEnd] = useState(false)

  // Clips
  const [clips, setClips] = useState<Clip[]>([])
  const [activeClipId, setActiveClipId] = useState<string | null>(null)

  const playerRef = useRef<VideoPlayerHandle>(null)
  const warpRef = useRef<WarpViewHandle>(null)
  const dragStart = useRef<{ y: number; h: number } | null>(null)
  const videoRef = useRef<VideoInfo | null>(null)
  videoRef.current = video
  const playheadRef = useRef(playhead)
  playheadRef.current = playhead

  // Refs for saving markers without stale closure issues
  const trimToLoopRef = useRef(trimToLoop)
  trimToLoopRef.current = trimToLoop
  const loopBeatsRef = useRef(loopBeats)
  loopBeatsRef.current = loopBeats
  const addToEndRef = useRef(addToEnd)
  addToEndRef.current = addToEnd
  const activeClipIdRef = useRef(activeClipId)
  activeClipIdRef.current = activeClipId
  const clipsRef = useRef(clips)
  clipsRef.current = clips

  // ── Resizer ────────────────────────────────────────────────────────────────

  const handleResizerPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragStart.current = { y: e.clientY, h: topHeight }
  }
  const handleResizerPointerMove = (e: React.PointerEvent) => {
    if (!dragStart.current || !e.buttons) return
    setTopHeight(Math.max(MIN_TOP, Math.min(MAX_TOP,
      dragStart.current.h + (e.clientY - dragStart.current.y)
    )))
  }
  const handleResizerPointerUp = () => { dragStart.current = null }

  // ── Video load ─────────────────────────────────────────────────────────────

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

  const handleOpen = useCallback(async () => {
    const info = await openVideo()
    if (info) loadVideo(info)
  }, [loadVideo])

  // ── Warp data change (persists markers) ────────────────────────────────────

  const handleDataChange = useCallback((data: WarpData) => {
    setWarpData(data)
    const vid = videoRef.current
    const clipId = activeClipIdRef.current ?? undefined
    const activeClip = clipId ? clipsRef.current.find(c => c.id === clipId) : null
    if (vid) saveMarkersToStorage(
      vid.fileHash,
      data,
      {
        trimToLoop: activeClip ? activeClip.trimToLoop : trimToLoopRef.current,
        loopBeats: activeClip ? activeClip.loopBeats : loopBeatsRef.current,
        addToEnd: activeClip ? activeClip.addToEnd : addToEndRef.current,
      },
      clipId,
    )
  }, [])

  // ── Clip management ────────────────────────────────────────────────────────

  const updateClips = (next: Clip[]) => {
    setClips(next)
    if (video) saveClips(video.fileHash, next)
  }

  const handleAddClip = () => {
    if (!video) return
    const id = crypto.randomUUID()
    const inPoint = playheadRef.current
    const outPoint = video.duration
    const n = clips.length + 1
    const newClip: Clip = {
      id,
      name: `clip_${String(n).padStart(3, '0')}`,
      inPoint,
      outPoint,
      trimToLoop: false,
      loopBeats: null,
      addToEnd: false,
    }
    updateClips([...clips, newClip])
    setActiveClipId(id)
    setWarpData(null)
  }

  const handleDeleteClip = (id: string) => {
    const next = clips.filter(c => c.id !== id)
    updateClips(next)
    if (activeClipId === id) {
      setActiveClipId(null)
      setWarpData(null)
    }
  }

  const handleSetIn = (id: string) => {
    updateClips(clips.map(c =>
      c.id === id ? { ...c, inPoint: Math.min(playheadRef.current, c.outPoint - 0.1) } : c
    ))
  }

  const handleSetOut = (id: string) => {
    updateClips(clips.map(c =>
      c.id === id ? { ...c, outPoint: Math.max(playheadRef.current, c.inPoint + 0.1) } : c
    ))
  }

  const handleRenameClip = (id: string, name: string) => {
    updateClips(clips.map(c => c.id === id ? { ...c, name } : c))
  }

  const handleSelectClip = (id: string) => {
    if (id === activeClipId) return
    setActiveClipId(id)
    setWarpData(null)
    // Seek video to clip start
    const clip = clips.find(c => c.id === id)
    if (clip) playerRef.current?.seek(clip.inPoint)
  }

  const handleSelectFull = () => {
    if (activeClipId === null) return
    setActiveClipId(null)
    setWarpData(null)
  }

  // ── Active clip warp settings ──────────────────────────────────────────────

  const activeClip = activeClipId ? clips.find(c => c.id === activeClipId) ?? null : null
  const clipIn = activeClip?.inPoint ?? null
  const clipOut = activeClip?.outPoint ?? null
  const clipOffset = clipIn ?? 0
  const warpDuration = activeClip ? activeClip.outPoint - activeClip.inPoint : (video?.duration ?? 0)

  const activeTrimToLoop = activeClip ? activeClip.trimToLoop : trimToLoop
  const activeLoopBeats = activeClip ? activeClip.loopBeats : loopBeats
  const activeAddToEnd = activeClip ? activeClip.addToEnd : addToEnd

  const setActiveTrimToLoop = (v: boolean) => {
    if (activeClip) updateClips(clips.map(c => c.id === activeClip.id ? { ...c, trimToLoop: v } : c))
    else setTrimToLoop(v)
  }
  const setActiveLoopBeats = (v: number | null) => {
    if (activeClip) updateClips(clips.map(c => c.id === activeClip.id ? { ...c, loopBeats: v } : c))
    else setLoopBeats(v)
  }
  const setActiveAddToEnd = (v: boolean) => {
    if (activeClip) updateClips(clips.map(c => c.id === activeClip.id ? { ...c, addToEnd: v } : c))
    else setAddToEnd(v)
  }

  // WarpView marker init for current context (full video or clip)
  const warpInitMarkers = video
    ? loadMarkers(video.fileHash, activeClipId ?? undefined)
    : null

  // ── Landing screen ─────────────────────────────────────────────────────────

  if (!video) {
    return (
      <div className="app app--upload">
        <div className="upload-screen">
          <div className="upload-screen__logo">VJ</div>
          <p className="upload-screen__hint">Select a video to place beat markers</p>
          <button className="upload-screen__btn" onClick={handleOpen}>
            Open Video
          </button>
        </div>
      </div>
    )
  }

  // ── Main layout ────────────────────────────────────────────────────────────

  return (
    <div className="app">
      <div className="warp-editor">

        {/* Video player — always full video */}
        <div className="warp-editor__top" style={{ height: topHeight }}>
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
          className="warp-editor__resizer"
          onPointerDown={handleResizerPointerDown}
          onPointerMove={handleResizerPointerMove}
          onPointerUp={handleResizerPointerUp}
        />

        {/* Bottom: sidebar + warp content */}
        <div className="warp-editor__bottom">
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

          <div className="warp-editor__content">
            {/* Clip label when inside a clip */}
            {activeClip && (
              <div className="warp-editor__clip-bar">
                <button className="warp-editor__clip-back" onClick={handleSelectFull}>← Full Video</button>
                <span className="warp-editor__clip-name">{activeClip.name}</span>
                <span className="warp-editor__clip-range">
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
              onNew={handleOpen}
              clipIn={clipIn}
              clipOut={clipOut}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
