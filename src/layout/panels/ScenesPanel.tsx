import SceneList from '../../components/SceneList'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { setMinGap as setSceneMinGapAction, deleteCut as deleteSceneCutAction } from '../../store/slices/sceneSlice'
import { detectScenesThunk, cancelSceneDetectionThunk } from '../../store/thunks/sceneThunks'
import { setView as setViewAction } from '../../store/slices/uiSlice'
import { ensureTimeInView } from '../../utils/view'
import { useDockBridge } from '../DockContext'

export default function ScenesPanel() {
  const dispatch = useAppDispatch()
  const { seek } = useDockBridge()
  const video = useAppSelector(s => s.video.video)
  const videoPath = video?.path ?? null
  const regions = useAppSelector(s => s.region.regions)
  const view = useAppSelector(s => s.ui.view)
  const sceneCuts = useAppSelector(s => videoPath ? s.scene.cutsByPath[videoPath] ?? [] : [])
  const sceneStatus = useAppSelector(s => videoPath ? s.scene.statusByPath[videoPath] ?? 'idle' : 'idle')
  const sceneProgress = useAppSelector(s => videoPath ? s.scene.progressByPath[videoPath] ?? 0 : 0)
  const sceneError = useAppSelector(s => videoPath ? s.scene.errorByPath[videoPath] : undefined)
  const sceneThreshold = useAppSelector(s => videoPath ? s.scene.thresholdByPath[videoPath] : undefined) ?? 10
  const sceneMinGap = useAppSelector(s => videoPath ? s.scene.minGapByPath[videoPath] : undefined) ?? 2

  if (!video) return <div className="vj-empty-panel">No video</div>

  return (
    <SceneList
      cuts={sceneCuts}
      status={sceneStatus}
      progress={sceneProgress}
      error={sceneError}
      threshold={sceneThreshold}
      duration={video.duration}
      regions={regions}
      view={view}
      onSeek={t => {
        seek(t)
        const nextView = ensureTimeInView(view, t, video.duration)
        if (nextView !== view) dispatch(setViewAction(nextView))
      }}
      onRecompute={t => {
        if (videoPath) dispatch(detectScenesThunk({ path: videoPath, threshold: t }))
      }}
      minGap={sceneMinGap}
      onMinGapChange={g => {
        if (videoPath) dispatch(setSceneMinGapAction({ path: videoPath, minGap: g }))
      }}
      onSceneDelete={t => {
        if (videoPath) dispatch(deleteSceneCutAction({ path: videoPath, cut: t }))
      }}
      onCancel={() => dispatch(cancelSceneDetectionThunk())}
    />
  )
}
