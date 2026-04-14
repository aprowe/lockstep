import { useEffect, useRef, useState } from 'react'
import type { WarpData, Region } from '../types'
import { startWarp, listenWarpProgress, saveOutput } from '../api/warp'
import type { UnlistenFn } from '@tauri-apps/api/event'
import './ExportDialog.css'

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
  const unlistenRef = useRef<UnlistenFn | null>(null)
  const cancelRef = useRef(false)

  const [mode, setMode] = useState<ExportMode>('current')
  const [selectedRegionIds, setSelectedRegionIds] = useState<Set<string>>(new Set())

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setStatus('idle')
      setProgress(0)
      setError(null)
      setOutputPaths([])
      setSavedCount(0)
      setCurrentJobIdx(0)
      setTotalJobs(0)
      cancelRef.current = false
      // Default mode: if a clip is active, export current; else full video
      setMode(activeRegionId ? 'current' : 'current')
      setSelectedRegionIds(new Set(regions.map(r => r.id)))
    }
  }, [open, activeRegionId, regions])

  useEffect(() => () => { unlistenRef.current?.() }, [])

  const activeRegion = regions.find(r => r.id === activeRegionId) ?? null
  const bpm = warpData?.bpm ?? 120
  const canProcess = !!warpData && (warpData.origAnchors.length ?? 0) >= 1

  const buildJobs = (): ExportJob[] => {
    if (mode === 'current') {
      return [{
        label: activeRegion ? activeRegion.name : 'Full Video',
        clipIn: activeRegion?.inPoint ?? null,
        clipOut: activeRegion?.outPoint ?? null,
        bpm: activeRegion?.bpm ?? bpm,
        addToEnd: activeRegion?.addToEnd ?? addToEnd,
      }]
    }
    const list = mode === 'all' ? regions : regions.filter(r => selectedRegionIds.has(r.id))
    if (list.length === 0) {
      return [{
        label: 'Full Video',
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

  const process = async () => {
    if (!warpData || !videoPath) return
    const jobs = buildJobs()
    setStatus('processing')
    setTotalJobs(jobs.length)
    setOutputPaths([])
    setError(null)
    cancelRef.current = false

    const results: string[] = []

    for (let i = 0; i < jobs.length; i++) {
      if (cancelRef.current) break
      const job = jobs[i]
      setCurrentJobIdx(i)
      setCurrentJobLabel(job.label)
      setProgress(0)

      try {
        const pairs = [...warpData.origAnchors]
          .sort((a, b) => a.time - b.time)
          .map(oa => ({
            orig: oa.time,
            beat: warpData.beatAnchors.find(ba => ba.id === oa.id)?.time ?? oa.time,
          }))

        const jobId = await startWarp({
          path: videoPath,
          orig_times: pairs.map(p => p.orig),
          beat_times: pairs.map(p => p.beat),
          bpm: job.bpm,
          beat_zero_time: warpData.beatZeroTime ?? 0,
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
    }
  }

  const handleSave = async (idx: number) => {
    const path = outputPaths[idx]
    if (!path) return
    setSaving(true)
    try {
      const jobs = buildJobs()
      const job = jobs[idx]
      const baseName = originalName.replace(/\.[^.]+$/, '')
      const suffix = job?.label && job.label !== 'Full Video'
        ? `_${job.label.replace(/\s+/g, '_')}`
        : '_warped'
      const suggestedName = `${baseName}${suffix}_${Math.round(job?.bpm ?? bpm)}bpm.mp4`
      await saveOutput({ source_path: path, suggested_name: suggestedName })
      setSavedCount(prev => prev + 1)
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
      const baseName = originalName.replace(/\.[^.]+$/, '')
      for (let i = 0; i < outputPaths.length; i++) {
        const job = jobs[i]
        const suffix = job?.label && job.label !== 'Full Video'
          ? `_${job.label.replace(/\s+/g, '_')}`
          : '_warped'
        const suggestedName = `${baseName}${suffix}_${Math.round(job?.bpm ?? bpm)}bpm.mp4`
        await saveOutput({ source_path: outputPaths[i], suggested_name: suggestedName })
      }
      setSavedCount(outputPaths.length)
    } catch (e: any) {
      if (!String(e).includes('cancelled')) setError(e.message ?? String(e))
    } finally {
      setSaving(false)
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

  return (
    <div className="export-overlay" onClick={handleClose}>
      <div className="export-dialog" onClick={e => e.stopPropagation()}>
        <div className="export-dialog__header">
          <span className="export-dialog__title">Export</span>
          <button className="export-dialog__close" onClick={handleClose}>
            {status === 'processing' ? 'Cancel' : '\u2715'}
          </button>
        </div>

        <div className="export-dialog__body">
          {/* Mode selector */}
          {hasRegions && status === 'idle' && (
            <div className="export-dialog__modes">
              <button
                className={`export-dialog__mode${mode === 'current' ? ' export-dialog__mode--active' : ''}`}
                onClick={() => setMode('current')}
              >
                {activeRegion ? activeRegion.name : 'Full Video'}
              </button>
              <button
                className={`export-dialog__mode${mode === 'all' ? ' export-dialog__mode--active' : ''}`}
                onClick={() => setMode('all')}
              >
                All Clips ({regions.length})
              </button>
              <button
                className={`export-dialog__mode${mode === 'selected' ? ' export-dialog__mode--active' : ''}`}
                onClick={() => setMode('selected')}
              >
                Select...
              </button>
            </div>
          )}

          {/* Clip selector for 'selected' mode */}
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
                  <span className="export-dialog__clip-bpm">{Math.round(r.bpm)} bpm</span>
                </label>
              ))}
            </div>
          )}

          {/* Options */}
          {status === 'idle' && (
            <>
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
            </>
          )}

          {/* Processing status */}
          {status === 'processing' && totalJobs > 1 && (
            <div className="export-dialog__job-info">
              {currentJobLabel} ({currentJobIdx + 1}/{totalJobs})
            </div>
          )}
        </div>

        <div className="export-dialog__footer">
          {status === 'error' && (
            <span className="export-dialog__error" title={error ?? ''}>{error}</span>
          )}

          {status === 'processing' ? (
            <div className="export-dialog__progress">
              <div className="export-dialog__progress-fill" style={{
                width: `${((currentJobIdx + progress) / totalJobs) * 100}%`
              }} />
            </div>
          ) : status === 'done' && outputPaths.length > 0 ? (
            <div className="export-dialog__results">
              {outputPaths.length === 1 ? (
                <button className="export-dialog__save" onClick={() => handleSave(0)} disabled={saving}>
                  {saving ? '...' : savedCount > 0 ? 'Saved' : 'Save MP4'}
                </button>
              ) : (
                <>
                  <button className="export-dialog__save" onClick={handleSaveAll} disabled={saving}>
                    {saving ? '...' : savedCount >= outputPaths.length ? 'All Saved' : `Save All (${outputPaths.length})`}
                  </button>
                  <div className="export-dialog__result-list">
                    {outputPaths.map((_, i) => {
                      const jobs = buildJobs()
                      return (
                        <button
                          key={i}
                          className="export-dialog__result-item"
                          onClick={() => handleSave(i)}
                          disabled={saving}
                        >
                          {jobs[i]?.label ?? `Clip ${i + 1}`}
                        </button>
                      )
                    })}
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
              {mode === 'current' || !hasRegions
                ? 'Process'
                : mode === 'all'
                  ? `Process ${regions.length} Clips`
                  : `Process ${selectedRegionIds.size} Clips`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
