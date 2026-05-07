import { useCallback, useState } from 'react'
import RegionInfoPanel from '../../components/RegionInfoPanel'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import {
  updateRegionInOut as updateRegionInOutAction,
  updateRegionBeatTimes as updateRegionBeatTimesAction,
  updateRegionLock as updateRegionLockAction,
} from '../../store/slices/regionSlice'
import { setBpm as setBpmAction } from '../../store/slices/warpSlice'
import { selectActiveRegion, selectWarpData } from '../../store/selectors'

export default function ClipInfoPanel() {
  const dispatch = useAppDispatch()
  const video = useAppSelector(s => s.video.video)
  const activeRegion = useAppSelector(selectActiveRegion)
  const activeRegionId = useAppSelector(s => s.region.activeRegionId)
  const warpData = useAppSelector(selectWarpData)
  const origAnchors = useAppSelector(s => s.warp.origAnchors)
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
      onBpmChange={bpm => dispatch(setBpmAction(bpm))}
      onUpdateRegionInOut={(id, inP, outP) =>
        dispatch(updateRegionInOutAction({ id, inPoint: inP, outPoint: outP }))
      }
      onUpdateRegionBeatTimes={(id, inBT, outBT) =>
        dispatch(updateRegionBeatTimesAction({ id, inBeatTime: inBT, outBeatTime: outBT }))
      }
      onLockChange={(lock, lockedBeats) => {
        if (activeRegionId) dispatch(updateRegionLockAction({ id: activeRegionId, lock, lockedBeats }))
      }}
      onBpmDetect={handleBpmDetect}
      detectingBpm={detectingBpm}
    />
  )
}
