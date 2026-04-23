import { useCallback } from 'react'
import MarkerList from '../../components/MarkerList'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import {
  clearAnchors,
  removeAnchors,
  resetBeatLinks,
  setBeatAnchorsFromTimeline,
  setSelectedIds as setSelectedIdsAction,
} from '../../store/slices/warpSlice'
import { selectActiveRegion, selectSelectedIdsSet, selectWarpData } from '../../store/selectors'
import { snapAllToBeat } from '../../utils/quantize'
import { useDockBridge } from '../DockContext'

export default function MarkersPanel() {
  const dispatch = useAppDispatch()
  const { seek } = useDockBridge()
  const video = useAppSelector(s => s.video.video)
  const origAnchors = useAppSelector(s => s.warp.origAnchors)
  const beatAnchors = useAppSelector(s => s.warp.beatAnchors)
  const warpBpm = useAppSelector(s => s.warp.bpm)
  const warpData = useAppSelector(selectWarpData)
  const activeRegion = useAppSelector(selectActiveRegion)
  const selectedIds = useAppSelector(selectSelectedIdsSet)
  const gridDiv = useAppSelector(s => s.ui.gridDiv)

  const setSelectedIds = useCallback(
    (ids: Set<number>) => dispatch(setSelectedIdsAction([...ids])),
    [dispatch],
  )

  if (!video) return <div className="vj-empty-panel">No video</div>

  const beatStep = warpBpm > 0 ? 60 / warpBpm / gridDiv : 0

  // Markers shown for the active region only — App-level handlers used to
  // pre-filter; preserve that scoping here.
  const visibleAnchors = activeRegion
    ? origAnchors.filter(
        a => a.time >= activeRegion.inPoint - 0.001 && a.time <= activeRegion.outPoint + 0.001,
      )
    : origAnchors

  return (
    <MarkerList
      origAnchors={visibleAnchors}
      beatAnchors={beatAnchors}
      duration={video.duration}
      fps={video.fps}
      bpm={warpBpm}
      beatZeroTime={warpData?.beatZeroTime ?? 0}
      selectedIds={selectedIds}
      onSelectionChange={setSelectedIds}
      onSeek={t => seek(t)}
      onClear={() => dispatch(clearAnchors())}
      onReset={() => dispatch(resetBeatLinks(origAnchors.map(a => a.id)))}
      onSnap={() => {
        if (beatStep <= 0) return
        const snapped = snapAllToBeat(beatAnchors, beatStep, warpData?.beatZeroTime ?? 0)
        dispatch(setBeatAnchorsFromTimeline(snapped))
      }}
      onDeleteSelected={() => dispatch(removeAnchors([...selectedIds]))}
      onResetSelected={() => dispatch(resetBeatLinks([...selectedIds]))}
      onSnapSelected={() => {
        if (beatStep <= 0) return
        const toSnap = beatAnchors.filter(a => selectedIds.has(a.id))
        const snapped = snapAllToBeat(toSnap, beatStep, warpData?.beatZeroTime ?? 0)
        const snapMap = new Map(snapped.map(a => [a.id, a.time]))
        dispatch(setBeatAnchorsFromTimeline(
          beatAnchors.map(a => snapMap.has(a.id) ? { ...a, time: snapMap.get(a.id)! } : a),
        ))
      }}
    />
  )
}
