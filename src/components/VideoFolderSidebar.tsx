import type { VideoEntry } from '../api/video'
import './VideoFolderSidebar.css'

interface VideoFolderSidebarProps {
  videos: VideoEntry[]
  selectedPath: string | null
  onOpenFolder: () => void
  onSelectVideo: (path: string) => void
}

export default function VideoFolderSidebar({
  videos,
  selectedPath,
  onOpenFolder,
  onSelectVideo,
}: VideoFolderSidebarProps) {
  return (
    <div className="vf-sidebar">
      <div className="vf-sidebar__header">
        <span className="vf-sidebar__title">Files</span>
        <button
          className="vf-sidebar__open-btn"
          onClick={onOpenFolder}
          title="Open folder"
        >
          ⊕
        </button>
      </div>

      {videos.length === 0 ? (
        <div className="vf-sidebar__empty">
          <button className="vf-sidebar__open-folder-btn" onClick={onOpenFolder}>
            Open Folder
          </button>
        </div>
      ) : (
        <div className="vf-sidebar__list">
          {videos.map(v => (
            <div
              key={v.path}
              className={`vf-entry${selectedPath === v.path ? ' vf-entry--active' : ''}`}
              onClick={() => onSelectVideo(v.path)}
              title={v.path}
            >
              <span className="vf-entry__icon">▶</span>
              <span className="vf-entry__name">{v.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
