import VideoFolderSidebar from '../../components/VideoFolderSidebar'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { openFolderThunk, selectVideoThunk } from '../../store/thunks/videoThunks'

export default function FileBrowserPanel() {
  const dispatch = useAppDispatch()
  const folderVideos = useAppSelector(s => s.video.folderVideos)
  const video = useAppSelector(s => s.video.video)
  const clipCountByPath = useAppSelector(s => s.video.clipCountByPath)

  return (
    <VideoFolderSidebar
      videos={folderVideos}
      selectedPath={video?.path ?? null}
      onOpenFolder={() => dispatch(openFolderThunk())}
      onSelectVideo={p => dispatch(selectVideoThunk(p))}
      clipCountByPath={clipCountByPath}
    />
  )
}
