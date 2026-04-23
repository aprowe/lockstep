import RegionSidebar from '../../components/RegionSidebar'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import {
  addRegion as addRegionAction,
  deleteRegion as deleteRegionAction,
  setActiveRegionId as setActiveRegionIdAction,
  updateRegionInOut as updateRegionInOutAction,
  updateRegionBeatTimes as updateRegionBeatTimesAction,
  renameRegion as renameRegionAction,
} from '../../store/slices/regionSlice'
import { setExportOpen as setExportOpenAction } from '../../store/slices/uiSlice'
import { calcNewRegionBoundsFromScenes } from '../../utils/view'
import { useDockBridge } from '../DockContext'

export default function ClipsPanel() {
  const dispatch = useAppDispatch()
  const { seek, pendingRenameId, setPendingRenameId } = useDockBridge()
  const video = useAppSelector(s => s.video.video)
  const regions = useAppSelector(s => s.region.regions)
  const activeRegionId = useAppSelector(s => s.region.activeRegionId)
  const playhead = useAppSelector(s => s.warp.playhead)
  const view = useAppSelector(s => s.ui.view)
  const warpBpm = useAppSelector(s => s.warp.bpm)
  const sceneCuts = useAppSelector(s => video ? s.scene.cutsByPath[video.path] ?? [] : [])

  if (!video) return <div className="vj-empty-panel">No video</div>

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
    const maxTime = video.duration
    const inPoint = Math.min(src.outPoint, maxTime - span)
    const outPoint = Math.min(inPoint + span, maxTime)
    const id = `region_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    dispatch(addRegionAction({
      ...src, id, name: `Clip ${regions.length + 1}`, inPoint, outPoint,
      inBeatTime: undefined, outBeatTime: undefined,
    }))
    return id
  }

  return (
    <RegionSidebar
      duration={video.duration}
      regions={regions}
      activeRegionId={activeRegionId}
      onSelectRegion={id => {
        dispatch(setActiveRegionIdAction(id))
        if (id) {
          const region = regions.find(r => r.id === id)
          if (region) seek(region.inPoint)
        }
      }}
      onAddRegion={() => {
        const { inPoint, outPoint } = calcNewRegionBoundsFromScenes(
          playhead, view, sceneCuts, video.duration,
        )
        addRegion(inPoint, outPoint)
      }}
      onDeleteRegion={id => dispatch(deleteRegionAction(id))}
      onRename={(id, name) => dispatch(renameRegionAction({ id, name }))}
      onUpdateInOut={(id, inP, outP) =>
        dispatch(updateRegionInOutAction({ id, inPoint: inP, outPoint: outP }))
      }
      onExportRegion={id => {
        dispatch(setActiveRegionIdAction(id))
        dispatch(setExportOpenAction(true))
      }}
      onDuplicateRegion={id => {
        const newId = duplicateRegion(id)
        if (newId) dispatch(setActiveRegionIdAction(newId))
      }}
      onResetBoundaries={id =>
        dispatch(updateRegionBeatTimesAction({ id, inBeatTime: undefined, outBeatTime: undefined }))
      }
      pendingRenameId={pendingRenameId}
      onPendingRenameConsumed={() => setPendingRenameId(null)}
    />
  )
}
