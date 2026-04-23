import { useAppSelector } from '../../store/hooks'
import { formatTime } from '../../utils/time'
import { showInFolder } from '../../api/warp'
import './VideoInfoPanel.css'

/** Format a byte count as KB/MB/GB with one decimal of precision. */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

/** Bits/sec → human-readable kbps / Mbps. */
function formatBitrate(bps: number): string {
  if (bps < 1_000_000) return `${(bps / 1_000).toFixed(0)} kbps`
  return `${(bps / 1_000_000).toFixed(1)} Mbps`
}

/** Hz → kHz / Hz. */
function formatSampleRate(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${hz} Hz`
}

/** Total frames at the given fps (rounded). */
function frameCount(seconds: number, fps: number): number {
  return Math.round(seconds * fps)
}

/** Strip the basename off so the dir is shown separately — easier to read
 *  than a wrapping single-line path. */
function splitPath(p: string): { dir: string; name: string } {
  const norm = p.replace(/\\/g, '/')
  const i = norm.lastIndexOf('/')
  if (i < 0) return { dir: '', name: norm }
  return { dir: p.substring(0, i + 1), name: p.substring(i + 1) }
}

interface RowProps {
  label: string
  value: React.ReactNode
}

function Row({ label, value }: RowProps) {
  return (
    <>
      <div className="vinfo__label">{label}</div>
      <div className="vinfo__value">{value}</div>
    </>
  )
}

export default function VideoInfoPanel() {
  const video = useAppSelector(s => s.video.video)

  if (!video) return <div className="vj-empty-panel">No video</div>

  const { dir } = splitPath(video.path)
  const resolution = video.width && video.height ? `${video.width} × ${video.height}` : null
  const audioParts = [
    video.audioCodec,
    video.audioChannels != null ? `${video.audioChannels} ch` : null,
    video.audioSampleRate != null ? formatSampleRate(video.audioSampleRate) : null,
  ].filter(Boolean) as string[]

  return (
    <div className="vinfo">
      <div className="vinfo__name" title={video.originalName}>{video.originalName}</div>
      {dir && <div className="vinfo__dir" title={video.path}>{dir}</div>}

      <button
        type="button"
        className="vinfo__reveal"
        onClick={() => { showInFolder(video.path).catch(() => {}) }}
        title="Open the file's folder and select it"
      >
        Show in Folder
      </button>

      <div className="vinfo__grid">
        <Row label="Duration"   value={formatTime(video.duration)} />
        <Row label="Frames"     value={frameCount(video.duration, video.fps).toLocaleString()} />
        <Row label="Frame rate" value={`${video.fps.toFixed(2)} fps`} />
        {resolution &&
          <Row label="Resolution" value={resolution} />}
        {video.videoCodec &&
          <Row label="Video codec" value={video.videoCodec} />}
        {video.container &&
          <Row label="Container" value={video.container} />}
        {video.fileSize != null &&
          <Row label="File size" value={formatFileSize(video.fileSize)} />}
        {video.bitrate != null &&
          <Row label="Bitrate" value={formatBitrate(video.bitrate)} />}
        {audioParts.length > 0 &&
          <Row label="Audio" value={audioParts.join(' · ')} />}
      </div>
    </div>
  )
}
