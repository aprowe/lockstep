import { useEffect, useMemo, useRef, useState } from 'react'
import type { WarpData, Region } from '../types'
import { startWarp, listenWarpProgress, saveOutput, pickExportFolder, saveToFolder, writeTextFile, revealInFolder } from '../api/warp'
import type { UnlistenFn } from '@tauri-apps/api/event'
import './ExportDialog.css'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ExportJob {
  label: string
  clipIn: number | null
  clipOut: number | null
  bpm: number
  addToEnd: boolean
}

interface ExportDialogProps {
  open: boolean
  onClose: () => void
  warpData: WarpData | null
  videoPath: string
  originalName: string
  loopBeats: number | null
  addToEnd: boolean
  trimToLoop: boolean
  regions: Region[]
  activeRegionId: string | null
}

type ExportMode = 'current' | 'all' | 'selected'

// ── Name pattern helpers ──────────────────────────────────────────────────────

/**
 * Available tokens: {name} {stem} {bpm} {beats} {in} {out} {n}
 */
function applyPattern(pattern: string, opts: {
  name: string
  stem: string
  bpm: number
  beats: number | null
  clipIn: number | null
  clipOut: number | null
  index: number
}): string {
  const pad2 = (n: number) => String(Math.floor(n)).padStart(2, '0')
  const fmtSec = (s: number | null) => {
    if (s === null) return '0'
    const m = Math.floor(s / 60), sec = s % 60
    return m > 0 ? `${m}m${pad2(sec)}s` : `${Math.floor(sec)}s`
  }
  return pattern
    .replace(/\{name\}/g, opts.name.replace(/\s+/g, '_'))
    .replace(/\{stem\}/g, opts.stem.replace(/\s+/g, '_'))
    .replace(/\{bpm\}/g, String(Math.round(opts.bpm)))
    .replace(/\{beats\}/g, opts.beats !== null ? String(opts.beats) : '')
    .replace(/\{in\}/g, fmtSec(opts.clipIn))
    .replace(/\{out\}/g, fmtSec(opts.clipOut))
    .replace(/\{n\}/g, String(opts.index + 1).padStart(2, '0'))
}

// ── Marker sidecar ────────────────────────────────────────────────────────────

function buildMarkerJson(warpData: WarpData, opts: {
  videoName: string
  exportFolder: string | null
}): string {
  const { origAnchors, beatAnchors, bpm, minStretch, maxStretch, addToEnd, beatZeroTime } = warpData
  return JSON.stringify({
    videoName: opts.videoName,
    exportFolder: opts.exportFolder,
    origAnchors, beatAnchors, bpm, minStretch, maxStretch, addToEnd, beatZeroTime,
  }, null, 2)
}

/** Given a saved video path like /foo/bar.mp4, writes /foo/bar.json */
async function writeMarkerSidecar(videoPath: string, warpData: WarpData, opts: {
  videoName: string
  exportFolder: string | null
}): Promise<void> {
  const jsonPath = videoPath.replace(/\.[^.]+$/, '.json')
  await writeTextFile(jsonPath, buildMarkerJson(warpData, opts))
}

/** Extract parent folder from a file path (works with / and \) */
function parentFolder(filePath: string): string {
  const norm = filePath.replace(/\\/g, '/')
  const idx = norm.lastIndexOf('/')
  return idx > 0 ? filePath.substring(0, idx) : filePath
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ExportDialog({
  open, onClose, warpData, videoPath, originalName,
  loopBeats, addToEnd, trimToLoop, regions, activeRegionId,
}: ExportDialogProps) {
  const [fadeAtLoop, setFadeAtLoop] = useState(false)
  const [normalizeBpm, setNormalizeBpm] = useState(false)
  const [status, setStatus] = useState<'idle' | 'processing' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState(0)
  const [currentJobLabel, setCurrentJobLabel] = useState('')
  const [currentJobIdx, setCurrentJobIdx] = useState(0)
  const [totalJobs, setTotalJobs] = useState(0)
  const [outputPaths, setOutputPaths] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  const [savedFolder, setSavedFolder] = useState<string | null>(null)
  const unlistenRef = useRef<UnlistenFn | null>(null)
  const cancelRef = useRef(false)

  const [mode, setMode] = useState<ExportMode>('current')
  const [selectedRegionIds, setSelectedRegionIds] = useState<Set<string>>(new Set())

  // Output settings — default folder is the video's parent folder
  const videoFolder = useMemo(() => videoPath ? parentFolder(videoPath) : null, [videoPath])
  const [customFolder, setCustomFolder] = useState<string | null>(null)
  const destFolder = customFolder ?? videoFolder
  const [namePattern, setNamePattern] = useState('{name}_{bpm}bpm')
  const baseName = originalName.replace(/\.[^.]+$/, '')  // stem of source video

  useEffect(() => {
    if (open) {
      setStatus('idle')
      setProgress(0)
      setError(null)
      setOutputPaths([])
      setSavedCount(0)
      setSavedFolder(null)
      setCurrentJobIdx(0)
      setTotalJobs(0)
      cancelRef.current = false
      setSelectedRegionIds(new Set(regions.map(r => r.id)))
    }
  }, [open, regions])

  useEffect(() => () => { unlistenRef.current?.() }, [])

  const activeRegion = regions.find(r => r.id === activeRegionId) ?? null
  const bpm = warpData?.bpm ?? 120
  // Allow export even with no markers (passthrough / cut only)
  const canProcess = !!warpData || (videoPath.length > 0)
  const hasMarkers = !!warpData && (warpData.origAnchors.length ?? 0) >= 1

  const buildJobs = (): ExportJob[] => {
    if (mode === 'current') {
      return [{
        label: activeRegion ? activeRegion.name : baseName,
        clipIn: activeRegion?.inPoint ?? null,
        clipOut: activeRegion?.outPoint ?? null,
        bpm: activeRegion?.bpm ?? bpm,
        addToEnd: activeRegion?.addToEnd ?? addToEnd,
      }]
    }
    const list = mode === 'all' ? regions : regions.filter(r => selectedRegionIds.has(r.id))
    if (list.length === 0) {
      return [{
        label: baseName,
        clipIn: null,
        clipOut: null,
        bpm,
        addToEnd,
      }]
    }
    return list.map(r => ({
      label: r.name,
      clipIn: r.inPoint,
      clipOut: r.outPoint,
      bpm: r.bpm,
      addToEnd: r.addToEnd,
    }))
  }

  const getFileName = (job: ExportJob, index: number) => {
    const name = applyPattern(namePattern, {
      name: job.label,
      stem: baseName,
      bpm: job.bpm,
      beats: loopBeats,
      clipIn: job.clipIn,
      clipOut: job.clipOut,
      index,
    })
    return `${name}.mp4`
  }

  const process = async () => {
    if (!videoPath) return
    const jobs = buildJobs()
    setStatus('processing')
    setTotalJobs(jobs.length)
    setOutputPaths([])
    setError(null)
    setSavedFolder(null)
    cancelRef.current = false

    const results: string[] = []

    for (let i = 0; i < jobs.length; i++) {
      if (cancelRef.current) break
      const job = jobs[i]
      setCurrentJobIdx(i)
      setCurrentJobLabel(job.label)
      setProgress(0)

      try {
        // If no markers, use empty arrays (passthrough trim only)
        const pairs = hasMarkers
          ? [...(warpData!.origAnchors)]
              .sort((a, b) => a.time - b.time)
              .map(oa => ({
                orig: oa.time,
                beat: warpData!.beatAnchors.find(ba => ba.id === oa.id)?.time ?? oa.time,
              }))
          : []

        const jobId = await startWarp({
          path: videoPath,
          orig_times: pairs.map(p => p.orig),
          beat_times: pairs.map(p => p.beat),
          bpm: job.bpm,
          beat_zero_time: warpData?.beatZeroTime ?? 0,
          add_to_end: job.addToEnd,
          fade_at_loop: fadeAtLoop && job.addToEnd,
          trim_to_loop: trimToLoop,
          loop_beats: loopBeats ?? null,
          normalize_bpm: normalizeBpm,
          clip_in: job.clipIn ?? null,
          clip_out: job.clipOut ?? null,
        })

        const outputPath = await new Promise<string>((resolve, reject) => {
          listenWarpProgress(payload => {
            if (payload.job_id !== jobId) return
            setProgress(payload.percent ?? 0)
            if (payload.status === 'done' && payload.output_path) {
              unlistenRef.current?.()
              resolve(payload.output_path)
            }
            if (payload.status === 'error') {
              unlistenRef.current?.()
              reject(new Error(payload.error ?? 'Unknown error'))
            }
          }).then(ul => { unlistenRef.current = ul })
        })

        results.push(outputPath)
      } catch (e: any) {
        setStatus('error')
        setError(`${job.label}: ${e.message ?? String(e)}`)
        return
      }
    }

    if (!cancelRef.current) {
      setOutputPaths(results)
      setStatus('done')

      // Auto-save to folder if one is selected
      if (destFolder && results.length > 0) {
        const jobs2 = buildJobs()
        setSaving(true)
        try {
          for (let i = 0; i < results.length; i++) {
            const fileName = getFileName(jobs2[i], i)
            const savedPath = await saveToFolder({ source_path: results[i], dest_folder: destFolder, file_name: fileName })
            if (warpData) await writeMarkerSidecar(savedPath, warpData, { videoName: originalName, exportFolder: destFolder })
          }
          setSavedCount(results.length)
          setSavedFolder(destFolder)
        } catch (e: any) {
          if (!String(e).includes('cancelled')) setError(e.message ?? String(e))
        } finally {
          setSaving(false)
        }
      }
    }
  }

  const handleSaveOne = async (idx: number) => {
    const path = outputPaths[idx]
    if (!path) return
    setSaving(true)
    try {
      const jobs = buildJobs()
      const fileName = getFileName(jobs[idx], idx)
      let savedPath: string
      if (destFolder) {
        savedPath = await saveToFolder({ source_path: path, dest_folder: destFolder, file_name: fileName })
      } else {
        savedPath = await saveOutput({ source_path: path, suggested_name: fileName })
      }
      if (warpData) await writeMarkerSidecar(savedPath, warpData, { videoName: originalName, exportFolder: destFolder })
      setSavedCount(prev => prev + 1)
      setSavedFolder(parentFolder(savedPath))
    } catch (e: any) {
      if (!String(e).includes('cancelled')) setError(e.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAll = async () => {
    setSaving(true)
    try {
      const jobs = buildJobs()
      let lastFolder: string | null = null
      for (let i = 0; i < outputPaths.length; i++) {
        const fileName = getFileName(jobs[i], i)
        let savedPath: string
        if (destFolder) {
          savedPath = await saveToFolder({ source_path: outputPaths[i], dest_folder: destFolder, file_name: fileName })
        } else {
          savedPath = await saveOutput({ source_path: outputPaths[i], suggested_name: fileName })
        }
        if (warpData) await writeMarkerSidecar(savedPath, warpData, { videoName: originalName, exportFolder: destFolder })
        lastFolder = parentFolder(savedPath)
      }
      setSavedCount(outputPaths.length)
      if (lastFolder) setSavedFolder(lastFolder)
    } catch (e: any) {
      if (!String(e).includes('cancelled')) setError(e.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  const handlePickFolder = async () => {
    try {
      const folder = await pickExportFolder()
      setCustomFolder(folder)
    } catch {
      // cancelled
    }
  }

  const handleClose = () => {
    if (status === 'processing') {
      cancelRef.current = true
      return
    }
    onClose()
  }

  const toggleRegion = (id: string) => {
    setSelectedRegionIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (!open) return null

  const hasRegions = regions.length > 0
  const jobs = buildJobs()
  const previewName = jobs.length > 0 ? getFileName(jobs[0], 0) : ''

  return (
    <div className="export-overlay" onClick={handleClose}>
      <div className="export-dialog" onClick={e => e.stopPropagation()}>

        <div className="export-dialog__header">
          <span className="export-dialog__title">Export</span>
          <button className="export-dialog__close" onClick={handleClose}>
            {status === 'processing' ? 'Cancel' : '✕'}
          </button>
        </div>

        <div className="export-dialog__body">

          {/* Clip mode selector */}
          {hasRegions && status === 'idle' && (
            <div className="export-dialog__modes">
              <button
                className={`export-dialog__mode${mode === 'current' ? ' export-dialog__mode--active' : ''}`}
                onClick={() => setMode('current')}
                title={activeRegion ? activeRegion.name : 'Full Video'}
              >
                {activeRegion ? activeRegion.name : 'Full Video'}
              </button>
              <button
                className={`export-dialog__mode${mode === 'all' ? ' export-dialog__mode--active' : ''}`}
                onClick={() => setMode('all')}
              >
                All ({regions.length})
              </button>
              <button
                className={`export-dialog__mode${mode === 'selected' ? ' export-dialog__mode--active' : ''}`}
                onClick={() => setMode('selected')}
              >
                Select
              </button>
            </div>
          )}

          {/* Clip selector */}
          {mode === 'selected' && status === 'idle' && (
            <div className="export-dialog__clip-list">
              {regions.map(r => (
                <label key={r.id} className="export-dialog__clip-item">
                  <input
                    type="checkbox"
                    checked={selectedRegionIds.has(r.id)}
                    onChange={() => toggleRegion(r.id)}
                  />
                  <span className="export-dialog__clip-name">{r.name}</span>
                  <span className="export-dialog__clip-bpm">{Math.round(r.bpm)}</span>
                </label>
              ))}
            </div>
          )}

          {/* Output folder + name pattern */}
          {status === 'idle' && (
            <div className="export-dialog__output">
              <div className="export-dialog__row">
                <span className="export-dialog__row-label">Folder</span>
                <button
                  className="export-dialog__folder-btn"
                  onClick={handlePickFolder}
                  title={destFolder ?? ''}
                >
                  <span className="export-dialog__folder-path">{destFolder ?? 'Choose…'}</span>
                </button>
                {customFolder && (
                  <button className="export-dialog__folder-clear" onClick={() => setCustomFolder(null)} title="Reset to video folder">✕</button>
                )}
              </div>
              <div className="export-dialog__row">
                <span className="export-dialog__row-label">Name</span>
                <input
                  className="export-dialog__pattern"
                  value={namePattern}
                  onChange={e => setNamePattern(e.target.value)}
                  spellCheck={false}
                />
              </div>
              <div className="export-dialog__preview">{previewName}</div>
              <div className="export-dialog__tokens">
                {['{name}', '{stem}', '{bpm}', '{beats}', '{in}', '{out}', '{n}'].map(t => (
                  <button
                    key={t}
                    className="export-dialog__token"
                    onClick={() => setNamePattern(p => p + t)}
                  >{t}</button>
                ))}
              </div>
            </div>
          )}

          {/* Options */}
          {status === 'idle' && (
            <div className="export-dialog__options">
              {addToEnd && (
                <label className="export-dialog__check">
                  <input type="checkbox" checked={fadeAtLoop} onChange={e => setFadeAtLoop(e.target.checked)} />
                  Fade at loop
                </label>
              )}
              <label className="export-dialog__check">
                <input type="checkbox" checked={normalizeBpm} onChange={e => setNormalizeBpm(e.target.checked)} />
                Normalize BPM
              </label>
            </div>
          )}

          {/* Processing status */}
          {status === 'processing' && (
            <div className="export-dialog__job-info">
              {totalJobs > 1 ? `${currentJobLabel} (${currentJobIdx + 1}/${totalJobs})` : currentJobLabel}
            </div>
          )}

        </div>

        <div className="export-dialog__footer">
          {status === 'error' && (
            <span className="export-dialog__error" title={error ?? ''}>{error}</span>
          )}

          {status === 'processing' ? (
            <div className="export-dialog__progress">
              <div
                className="export-dialog__progress-fill"
                style={{ width: `${((currentJobIdx + progress) / Math.max(totalJobs, 1)) * 100}%` }}
              />
            </div>
          ) : status === 'done' && outputPaths.length > 0 ? (
            <div className="export-dialog__results">
              {outputPaths.length === 1 ? (
                <div className="export-dialog__results-row">
                  <button className="export-dialog__save" onClick={() => handleSaveOne(0)} disabled={saving}>
                    {saving ? '…' : savedCount > 0 ? '✓ Saved' : destFolder ? '✓ Saved' : 'Save MP4'}
                  </button>
                  {savedFolder && (
                    <button
                      className="export-dialog__open-folder"
                      onClick={() => revealInFolder(savedFolder)}
                      title={savedFolder}
                    >
                      Open Folder
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className="export-dialog__results-row">
                    <button className="export-dialog__save" onClick={handleSaveAll} disabled={saving || savedCount >= outputPaths.length}>
                      {saving ? '…' : savedCount >= outputPaths.length ? `✓ All Saved` : `Save All (${outputPaths.length})`}
                    </button>
                    {savedFolder && (
                      <button
                        className="export-dialog__open-folder"
                        onClick={() => revealInFolder(savedFolder)}
                        title={savedFolder}
                      >
                        Open Folder
                      </button>
                    )}
                  </div>
                  <div className="export-dialog__result-list">
                    {outputPaths.map((_, i) => (
                      <button
                        key={i}
                        className="export-dialog__result-item"
                        onClick={() => handleSaveOne(i)}
                        disabled={saving}
                      >
                        {jobs[i]?.label ?? `Clip ${i + 1}`}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <button
              className="export-dialog__process"
              onClick={process}
              disabled={!canProcess || (mode === 'selected' && selectedRegionIds.size === 0)}
            >
              {mode === 'all'
                ? `Process ${regions.length}`
                : mode === 'selected'
                  ? `Process ${selectedRegionIds.size}`
                  : 'Process'}
            </button>
          )}
        </div>

      </div>
    </div>
  )
}
