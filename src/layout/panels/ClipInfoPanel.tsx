import { useCallback, useState } from 'react'
import RegionInfoPanel from '../../components/RegionInfoPanel'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import {
  updateRegionInOut as updateRegionInOutAction,
  updateRegionBeatTimes as updateRegionBeatTimesAction,
  updateRegionLockedBeats as updateRegionLockedBeatsAction,
  renameRegion as renameRegionAction,
  resetRegionBoundary as resetRegionBoundaryAction,
  applyBpmEdit as applyBpmEditAction,
  applyBeatsEdit as applyBeatsEditAction,
} from '../../store/slices/regionSlice'
import { setBpm as setBpmAction } from '../../store/slices/warpSlice'
import { setLockMode as setLockModeAction } from '../../store/slices/uiSlice'
import { selectActiveRegion, selectWarpData, selectEffectiveBeatBoundsForActive } from '../../store/selectors'

export default function ClipInfoPanel() {
  const dispatch = useAppDispatch()
  const video = useAppSelector(s => s.video.video)
  const activeRegion = useAppSelector(selectActiveRegion)
  const activeRegionId = useAppSelector(s => s.region.activeRegionId)
  const warpData = useAppSelector(selectWarpData)
  const origAnchors = useAppSelector(s => s.warp.origAnchors)
  const beatAnchors = useAppSelector(s => s.warp.beatAnchors)
  const effectiveBounds = useAppSelector(selectEffectiveBeatBoundsForActive)
  const lockMode = useAppSelector(s => s.ui.lockMode)
  const [detectingBpm, setDetectingBpm] = useState(false)

  const handleBpmDetect = useCallback(async () => {
    if (origAnchors.length < 2) return
    setDetectingBpm(true)
    try {
      const { analyzeAnchors } = await import('../../api/warp')
      const data = await analyzeAnchors(origAnchors.map(a => a.time))
      if (data.bpm && data.bpm > 0) dispatch(setBpmAction(data.bpm))
    } catch { /* ignore — best effort */ }
    setDetectingBpm(false)
  }, [origAnchors, dispatch])

  if (!video) return <div className="vj-empty-panel">No video</div>

  return (
    <RegionInfoPanel
      activeRegion={activeRegion ?? null}
      warpData={warpData}
      duration={video.duration}
      effectiveBounds={effectiveBounds}
      onBpmChange={bpm => dispatch(setBpmAction(bpm))}
      onUpdateRegionInOut={(id, inP, outP) =>
        dispatch(updateRegionInOutAction({ id, inPoint: inP, outPoint: outP }))
      }
      onUpdateRegionBeatTimes={(id, inBT, outBT) =>
        dispatch(updateRegionBeatTimesAction({ id, inBeatTime: inBT, outBeatTime: outBT }))
      }
      onRename={(id, name) => dispatch(renameRegionAction({ id, name }))}
      lockMode={lockMode}
      onLockChange={(lock, lockedBeats) => {
        dispatch(setLockModeAction(lock))
        if (activeRegionId && lockedBeats !== undefined) {
          dispatch(updateRegionLockedBeatsAction({ id: activeRegionId, lockedBeats }))
        }
      }}
      onBpmDetect={handleBpmDetect}
      detectingBpm={detectingBpm}
      onApplyBpmEdit={(newBpm, stretch) => {
        if (activeRegionId) dispatch(applyBpmEditAction({ id: activeRegionId, newBpm, stretch, origAnchors, beatAnchors }))
      }}
      onApplyBeatsEdit={(newLockedBeats, stretch) => {
        if (activeRegionId) dispatch(applyBeatsEditAction({ id: activeRegionId, newLockedBeats, stretch, origAnchors, beatAnchors }))
      }}
      onResetBoundary={() => {
        if (activeRegionId) dispatch(resetRegionBoundaryAction({ id: activeRegionId }))
      }}
    />
  )
}
