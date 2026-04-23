import { useCallback, useMemo, useRef } from 'react'
import VideoPlayer from '../components/VideoPlayer'
import Filmstrip from '../components/Filmstrip'
import WarpView from '../components/WarpView'
import Toolbar from '../components/Toolbar'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { selectActiveRegion, selectSelectedIdsSet, selectWarpData } from '../store/selectors'
import {
  setOrigAnchorsFromTimeline,
  setPlayhead as setPlayheadAction,
  newAnchorId,
  removeAnchors as removeAnchorsAction,
  setSelectedIds as setSelectedAnchorIdsAction,
} from '../store/slices/warpSlice'
import {
  addRegion as addRegionAction,
  deleteRegion as deleteRegionAction,
  setActiveRegionId as setActiveRegionIdAction,
  updateRegionInOut as updateRegionInOutAction,
  updateRegionBeatTimes as updateRegionBeatTimesAction,
} from '../store/slices/regionSlice'
import {
  setPlaying as setPlayingAction,
  setExportOpen as setExportOpenAction,
  setView as setViewAction,
  setTimelineHeight as setTimelineHeightAction,
  setGridDiv as setGridDivAction,
} from '../store/slices/uiSlice'
import { addCut as addSceneCutAction, deleteCut as deleteSceneCutAction } from '../store/slices/sceneSlice'
import { setListSelection, setPendingEdit } from '../store/slices/listsSlice'
import { calcZoomToRegion, calcNewRegionBoundsFromScenes, calcNewRegionBoundsUpToNext } from '../utils/view'
import { findPreviousTarget } from '../utils/navigation'
import { filterCutsByMinGap } from '../utils/sceneFilter'
import type { View } from '../types'
import { useDockBridge } from './DockContext'

const MIN_TIMELINE = 60
/** Reserved space for everything *above* the timeline inside .vj-center —
 *  breadcrumb (~40) + minimum video pane (~125) + toolbar (~50) + resizer (~5).
 *  Without enough headroom here the player gets squeezed to nothing and the
 *  timeline grows past the bottom of the dockview panel. */
const MIN_PLAYER_HEIGHT = 220

/**
 * The fixed center column: video player + filmstrip + toolbar above the
 * timeline, separated by a vertical resizer. Lives inside a locked dockview
 * group so it can't be dragged or accept drops; everything else docks around
 * it.
 */
export default function CenterColumn() {
  const dispatch = useAppDispatch()
  const { playerRef, setExportOpen, setClipContextMenu } = useDockBridge()

  const video = useAppSelector(s => s.video.video)
  const videoPath = video?.path ?? null
  const playhead = useAppSelector(s => s.warp.playhead)
  const playing = useAppSelector(s => s.ui.playing)
  const view = useAppSelector(s => s.ui.view)
  const timelineHeight = useAppSelector(s => s.ui.timelineHeight)
  const gridDiv = useAppSelector(s => s.ui.gridDiv)
  const warpData = useAppSelector(selectWarpData)
  const origAnchors = useAppSelector(s => s.warp.origAnchors)
  const regions = useAppSelector(s => s.region.regions)
  const activeRegionId = useAppSelector(s => s.region.activeRegionId)
  const activeRegion = useAppSelector(selectActiveRegion)
  const sceneCuts = useAppSelector(s => videoPath ? s.scene.cutsByPath[videoPath] ?? [] : [])
  const sceneMinGap = useAppSelector(s => videoPath ? s.scene.minGapByPath[videoPath] : undefined) ?? 2
  const filteredSceneCuts = filterCutsByMinGap(sceneCuts, sceneMinGap)
  // Multi-selection set from the clips list — surfaced on the timeline so
  // drag/edit gestures show which clips are about to be affected.
  const selectedClipIds = useAppSelector(s => s.lists.selection.clips)
  const selectedClipSet = useMemo(() => new Set(selectedClipIds), [selectedClipIds])
  const selectedAnchorIds = useAppSelector(selectSelectedIdsSet)

  // Delete the union of every timeline-side selection in one shot. Fires
  // from Delete / Backspace when the timeline root has keyboard focus.
  const handleTimelineDelete = useCallback(() => {
    if (selectedClipIds.length > 0) {
      for (const id of selectedClipIds) dispatch(deleteRegionAction(id))
      dispatch(setListSelection({ list: 'clips', ids: [] }))
    }
    if (selectedAnchorIds.size > 0) {
      dispatch(removeAnchorsAction([...selectedAnchorIds]))
      dispatch(setSelectedAnchorIdsAction([]))
    }
  }, [selectedClipIds, selectedAnchorIds, dispatch])

  // Clear every timeline-side selection — Cmd+D and the empty-click
  // deselect (Policy B from docs/INTERACTION_DESIGN.md).
  const handleTimelineDeselect = useCallback(() => {
    if (selectedClipIds.length > 0) dispatch(setListSelection({ list: 'clips', ids: [] }))
    if (selectedAnchorIds.size > 0) dispatch(setSelectedAnchorIdsAction([]))
  }, [selectedClipIds, selectedAnchorIds, dispatch])

  // Saved viewport from before the user zoomed into a region — restored when
  // the same zoom action toggles back out.
  const preZoomView = useRef<View | null>(null)
  // Tracks the start of a drag on the player/timeline divider.
  const vDragStart = useRef<{ y: number; h: number } | null>(null)

  const folderVideos = useAppSelector(s => s.video.folderVideos)
  const markersLoaded = useAppSelector(s => s.video.markersLoaded)

  // Empty / loading state — rendered in the center slot whenever there's
  // no usable video, so the rest of the dock (file browser etc.) stays
  // reachable around it.
  if (!video) {
    return (
      <div className="vj-center vj-center--empty">
        <p className="vj-center__hint">
          {folderVideos.length === 0
            ? 'Open a file or folder to get started'
            : 'Select a video from the Files panel'}
        </p>
      </div>
    )
  }
  if (!markersLoaded) {
    return (
      <div className="vj-center vj-center--empty">
        <p className="vj-center__hint">Loading…</p>
      </div>
    )
  }

  const setActiveRegionId = (id: string | null) => dispatch(setActiveRegionIdAction(id))

  const addRegion = (inPoint: number, outPoint: number) => {
    const id = `region_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const name = `Clip ${regions.length + 1}`
    dispatch(addRegionAction({
      id, name, inPoint, outPoint,
      bpm: warpData?.bpm ?? 120, minStretch: 0.5, maxStretch: 2.0, addToEnd: false,
    }))
    return id
  }
  const duplicateRegion = (srcId: string) => {
    const src = regions.find(r => r.id === srcId)
    if (!src) return null
    const span = src.outPoint - src.inPoint
    const inPoint = Math.min(src.outPoint, video.duration - span)
    const outPoint = Math.min(inPoint + span, video.duration)
    const id = `region_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    dispatch(addRegionAction({
      ...src, id, name: `Clip ${regions.length + 1}`, inPoint, outPoint,
      inBeatTime: undefined, outBeatTime: undefined,
    }))
    return id
  }
  const deleteRegion = (id: string) => dispatch(deleteRegionAction(id))
  const updateRegionInOut = (id: string, inP: number, outP: number) =>
    dispatch(updateRegionInOutAction({ id, inPoint: inP, outPoint: outP }))
  const updateRegionBeatTimes = (id: string, inBT?: number, outBT?: number) =>
    dispatch(updateRegionBeatTimesAction({ id, inBeatTime: inBT, outBeatTime: outBT }))

  // Vertical resizer between the player area and the timeline.
  const handleResizerPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    vDragStart.current = { y: e.clientY, h: timelineHeight }
  }
  const handleResizerPointerMove = (e: React.PointerEvent) => {
    if (!vDragStart.current || !e.buttons) return
    // .vj-center is sized to fill its dockview panel — clientHeight here is
    // the actual visible area we have to share between player and timeline.
    // Falling back to window.innerHeight (the old default) let the timeline
    // grow past the panel edge inside the dock.
    const body = (e.currentTarget as HTMLElement).closest('.vj-center') as HTMLElement | null
    if (!body) return
    const maxTimeline = Math.max(MIN_TIMELINE, body.clientHeight - MIN_PLAYER_HEIGHT)
    const desired = vDragStart.current.h - (e.clientY - vDragStart.current.y)
    dispatch(setTimelineHeightAction(Math.max(MIN_TIMELINE, Math.min(maxTimeline, desired))))
  }
  const handleResizerPointerUp = () => { vDragStart.current = null }

  return (
    <div className="vj-center">
      <div className="vj-breadcrumb">
        <span className="vj-breadcrumb__name">{video.originalName}</span>
        {activeRegion && (
          <span className="vj-breadcrumb__region"> › {activeRegion.name}</span>
        )}
      </div>
      <div className="vj-player">
        <div className="vj-player__video">
          <VideoPlayer
            ref={playerRef}
            src={video.videoUrl}
            duration={video.duration}
            onTimeUpdate={t => dispatch(setPlayheadAction(t))}
            onPlayStateChange={v => dispatch(setPlayingAction(v))}
          />
        </div>
        <Filmstrip
          onSeekFrame={frame => {
            if (video.fps > 0) playerRef.current?.seek(frame / video.fps)
          }}
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
          const times = (warpData?.origAnchors ?? []).map(a => a.time)
          const prev = findPreviousTarget(times, playhead, playing)
          if (prev !== undefined) playerRef.current?.seek(prev)
        }}
        onJumpNext={() => {
          const sorted = [...(warpData?.origAnchors ?? [])].sort((a, b) => a.time - b.time)
          const next = sorted.find(a => a.time > playhead + 0.05)
          if (next) playerRef.current?.seek(next.time)
        }}
        onZoomToRegion={() => {
          const from = activeRegion?.inPoint ?? 0
          const to = activeRegion?.outPoint ?? video.duration
          const { nextView, previousView } = calcZoomToRegion(view, from, to, preZoomView.current)
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
          if (playhead > activeRegion.outPoint) {
            const { inPoint, outPoint } = calcNewRegionBoundsUpToNext(
              playhead, view.end - view.start, regions, video.duration,
            )
            const id = addRegion(inPoint, outPoint)
            if (id) setActiveRegionId(id)
          } else {
            updateRegionInOut(activeRegion.id, playhead, activeRegion.outPoint)
          }
        } : () => {
          const id = addRegion(playhead, video.duration)
          if (id) setActiveRegionId(id)
        }}
        onSetOut={activeRegion ? () => {
          if (playhead < activeRegion.inPoint) {
            const { inPoint, outPoint } = calcNewRegionBoundsUpToNext(
              playhead, view.end - view.start, regions, video.duration,
            )
            const id = addRegion(inPoint, outPoint)
            if (id) setActiveRegionId(id)
          } else {
            updateRegionInOut(activeRegion.id, activeRegion.inPoint, playhead)
          }
        } : () => {
          const id = addRegion(0, Math.max(playhead, 0.1))
          if (id) setActiveRegionId(id)
        }}
        gridDiv={gridDiv}
        onGridDivChange={v => dispatch(setGridDivAction(v))}
        onNewRegion={() => {
          const { inPoint, outPoint } = calcNewRegionBoundsFromScenes(playhead, view, sceneCuts, video.duration)
          addRegion(inPoint, outPoint)
        }}
        onPrevRegion={regions.length > 1 ? () => {
          const inPoints = regions.map(r => r.inPoint)
          const prev = findPreviousTarget(inPoints, playhead, playing)
          if (prev === undefined) return
          const target = regions.find(r => r.inPoint === prev)
          if (target) {
            setActiveRegionId(target.id)
            playerRef.current?.seek(target.inPoint)
          }
        } : undefined}
        onNextRegion={regions.length > 1 ? () => {
          const sorted = [...regions].sort((a, b) => a.inPoint - b.inPoint)
          const idx = sorted.findIndex(r => r.id === activeRegionId)
          const next = idx < sorted.length - 1 ? sorted[idx + 1] : null
          if (next) setActiveRegionId(next.id)
        } : undefined}
        onDeleteRegion={activeRegion ? () => deleteRegion(activeRegion.id) : undefined}
        onNewScene={videoPath ? () => dispatch(addSceneCutAction({ path: videoPath, cut: playhead })) : undefined}
        onPrevScene={(filteredSceneCuts.length > 0) ? () => {
          const prev = findPreviousTarget(filteredSceneCuts, playhead, playing)
          if (prev !== undefined) playerRef.current?.seek(prev)
        } : undefined}
        onNextScene={(filteredSceneCuts.length > 0) ? () => {
          const next = [...filteredSceneCuts].sort((a, b) => a - b).find(t => t > playhead + 0.001)
          if (next !== undefined) playerRef.current?.seek(next)
        } : undefined}
        clipBeatCount={activeRegion ? (() => {
          const bpm = warpData?.bpm ?? 0
          if (bpm <= 0) return null
          const beat = 60 / bpm
          const beatSpan = (activeRegion.outBeatTime ?? activeRegion.outPoint) - (activeRegion.inBeatTime ?? activeRegion.inPoint)
          return beatSpan / beat
        })() : null}
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
          scenes={filteredSceneCuts}
          onSceneAdd={t => {
            if (videoPath) dispatch(addSceneCutAction({ path: videoPath, cut: t }))
          }}
          onSceneDelete={t => {
            if (videoPath) dispatch(deleteSceneCutAction({ path: videoPath, cut: t }))
          }}
          onSendToNewRegion={(inPoint, outPoint) => addRegion(inPoint, outPoint)}
          onRegionAdd={t => {
            const { inPoint, outPoint } = calcNewRegionBoundsFromScenes(
              t, view, sceneCuts, video.duration,
            )
            addRegion(inPoint, outPoint)
          }}
          clipOverlays={regions.map(r => ({
            id: r.id,
            name: r.name,
            inPoint: r.inPoint,
            outPoint: r.outPoint,
            active: r.id === activeRegionId,
            selected: selectedClipSet.has(r.id),
            colorIndex: r.colorIndex,
          }))}
          onClipOverlaySelect={id => {
            setActiveRegionId(id)
            if (id) {
              const region = regions.find(r => r.id === id)
              if (region) playerRef.current?.seek(region.inPoint)
            }
          }}
          selectedClipIds={selectedClipSet}
          onClipsSelectionChange={ids => dispatch(setListSelection({ list: 'clips', ids: [...ids] }))}
          onTimelineDelete={handleTimelineDelete}
          onTimelineDeselect={handleTimelineDeselect}
          onClipOverlayResize={(id, inP, outP) => updateRegionInOut(id, inP, outP)}
          onClipOverlayMove={(id, inP, outP) => updateRegionInOut(id, inP, outP)}
          onClipOverlayZoom={id => {
            const region = regions.find(r => r.id === id)
            if (!region) return
            const { nextView, previousView } = calcZoomToRegion(view, region.inPoint, region.outPoint, preZoomView.current)
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
                { label: 'Rename', action: () => { setActiveRegionId(id); dispatch(setPendingEdit({ list: 'clips', id })) } },
                { label: 'Duplicate', action: () => {
                  const newId = duplicateRegion(id)
                  if (newId) setActiveRegionId(newId)
                } },
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
  )
}
