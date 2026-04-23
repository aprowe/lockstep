import { useCallback, useState } from 'react'
import RegionInfoPanel from '../../components/RegionInfoPanel'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import {
  updateRegionInOut as updateRegionInOutAction,
  updateRegionBeatTimes as updateRegionBeatTimesAction,
  updateRegionLock as updateRegionLockAction,
  updateRegionTriggerMode as updateRegionTriggerModeAction,
} from '../../store/slices/regionSlice'
import { setBpm as setBpmAction, setBeatZeroId, setAddToEnd as setAddToEndAction } from '../../store/slices/warpSlice'
import { selectActiveRegion, selectWarpData } from '../../store/selectors'

export default function ClipInfoPanel() {
  const dispatch = useAppDispatch()
  const video = useAppSelector(s => s.video.video)
  const activeRegion = useAppSelector(selectActiveRegion)
  const activeRegionId = useAppSelector(s => s.region.activeRegionId)
  const warpData = useAppSelector(selectWarpData)
  const addToEnd = useAppSelector(s => s.warp.addToEnd)
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

  // Reverse-look-up the orig-time of the beat-zero anchor so the picker can
  // surface it as the "Start at" selection.
  const beatZeroOrigTime = (() => {
    if (!warpData) return null
    const zeroBA = warpData.beatAnchors.find(ba => Math.abs(ba.time - warpData.beatZeroTime) < 0.001)
    if (!zeroBA) return null
    return warpData.origAnchors.find(oa => oa.id === zeroBA.id)?.time ?? null
  })()

  return (
    <RegionInfoPanel
      activeRegion={activeRegion ?? null}
      warpData={warpData}
      duration={video.duration}
      addToEnd={addToEnd}
      onBpmChange={bpm => dispatch(setBpmAction(bpm))}
      onAddToEndChange={v => dispatch(setAddToEndAction(v))}
      onUpdateRegionInOut={(id, inP, outP) =>
        dispatch(updateRegionInOutAction({ id, inPoint: inP, outPoint: outP }))
      }
      onUpdateRegionBeatTimes={(id, inBT, outBT) =>
        dispatch(updateRegionBeatTimesAction({ id, inBeatTime: inBT, outBeatTime: outBT }))
      }
      beatZeroOrigTime={beatZeroOrigTime}
      onStartAtChange={origTime => {
        if (origTime === null) { dispatch(setBeatZeroId(null)); return }
        const anchor = origAnchors.find(a => Math.abs(a.time - origTime) < 0.001)
        if (anchor) dispatch(setBeatZeroId(anchor.id))
      }}
      onLockChange={(lock, lockedBeats) => {
        if (activeRegionId) dispatch(updateRegionLockAction({ id: activeRegionId, lock, lockedBeats }))
      }}
      onTriggerModeChange={v => {
        if (activeRegionId) dispatch(updateRegionTriggerModeAction({ id: activeRegionId, triggerMode: v }))
      }}
      onBpmDetect={handleBpmDetect}
      detectingBpm={detectingBpm}
    />
  )
}
