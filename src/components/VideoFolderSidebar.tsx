import type { VideoEntry } from '../api/video'
import './VideoFolderSidebar.css'

interface VideoFolderSidebarProps {
  videos: VideoEntry[]
  selectedPath: string | null
  onOpenFolder: () => void
  onSelectVideo: (path: string) => void
  width?: number
  clipCountByPath?: Record<string, number>
  onCollapse?: () => void
}

export default function VideoFolderSidebar({
  videos,
  selectedPath,
  onOpenFolder,
  onSelectVideo,
  width,
  clipCountByPath = {},
  onCollapse,
}: VideoFolderSidebarProps) {
  return (
    <div className="vf-sidebar" style={width !== undefined ? { width } : undefined}>
      <div className="vf-sidebar__header">
        <span className="vf-sidebar__title">Files</span>
        <button
          className="vf-sidebar__open-btn"
          onClick={onOpenFolder}
          title="Open folder"
        >
          ⊕
        </button>
        {onCollapse && (
          <button
            className="vf-sidebar__collapse-btn"
            onClick={onCollapse}
            title="Collapse sidebar"
          >
            ◀
          </button>
        )}
      </div>

      {videos.length === 0 ? (
        <div className="vf-sidebar__empty">
          <button className="vf-sidebar__open-folder-btn" onClick={onOpenFolder}>
            Open Folder
          </button>
        </div>
      ) : (
        <div
          className="vf-sidebar__list"
          tabIndex={0}
          onKeyDown={e => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
            if (videos.length === 0) return
            const dir = e.key === 'ArrowDown' ? 1 : -1
            const idx = videos.findIndex(v => v.path === selectedPath)
            const nextIdx = idx < 0
              ? (dir > 0 ? 0 : videos.length - 1)
              : Math.max(0, Math.min(videos.length - 1, idx + dir))
            const next = videos[nextIdx]
            if (!next || next.path === selectedPath) { e.preventDefault(); return }
            e.preventDefault()
            onSelectVideo(next.path)
          }}
        >
          {videos.map(v => {
            const count = clipCountByPath[v.path]
            return (
              <div
                key={v.path}
                className={`vf-entry${selectedPath === v.path ? ' vf-entry--active' : ''}`}
                onClick={() => onSelectVideo(v.path)}
                title={v.path}
              >
                <span className="vf-entry__icon">▶</span>
                <span className="vf-entry__name">{v.name}</span>
                {count != null && count > 0 && (
                  <span className="vf-entry__markers" title={`${count} clip${count === 1 ? '' : 's'}`}>
                    {count}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
